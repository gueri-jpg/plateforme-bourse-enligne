"""
Router "OTP par utilisateur" (US-24, US-32).

Endpoints :
  - GET /api/utilisateurs/moi/otp        : consulte l'etat OTP de son propre compte
  - PUT /api/utilisateurs/moi/otp        : active/desactive l'OTP pour son propre compte
  - GET /api/admin/utilisateurs/{id}/otp : consulte l'etat OTP d'un utilisateur (admin)
  - PUT /api/admin/utilisateurs/{id}/otp : active/desactive l'OTP d'un utilisateur (admin)

Table concernee : administration.otp_utilisateur (cf. db/init.sql), en
relation 1-1 avec identite.utilisateurs.

Synchronisation Keycloak : chaque activation/desactivation declenche
l'ajout/retrait de la Required Action "CONFIGURE_TOTP" sur l'utilisateur
Keycloak correspondant (cf. app/keycloak_client.py).
"""

from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import UtilisateurAuthentifie, administrateur_requis, investisseur_requis
from app.db import get_connection, get_dict_cursor
from app.keycloak_client import keycloak_admin_client

router = APIRouter(tags=["OTP utilisateur"])


# ----------------------------------------------------------------------
# Schemas Pydantic
# ----------------------------------------------------------------------
class OtpUtilisateurReponse(BaseModel):
    """Etat OTP courant d'un utilisateur."""

    utilisateur_id: str
    otp_active: bool
    date_derniere_verif_otp: str | None = None
    nb_connexions_depuis_derniere_verif: int
    date_maj: str
    # Indique si la valeur peut etre modifiee par l'investisseur lui-meme,
    # c.a.d. si l'OTP n'est pas impose globalement (US-24 / US-32)
    modifiable_par_investisseur: bool


class OtpUtilisateurRequete(BaseModel):
    """Corps de requete PUT pour activer/desactiver l'OTP d'un utilisateur."""

    otp_active: bool = Field(..., description="true = activer l'OTP, false = le desactiver.")


# ----------------------------------------------------------------------
# Fonctions utilitaires partagees
# ----------------------------------------------------------------------
def _lire_otp_actif_global(conn) -> bool:
    """Lit l'indicateur global administration.parametres_otp.otp_actif_global."""
    with conn.cursor() as cur:
        cur.execute(
            "SELECT otp_actif_global FROM administration.parametres_otp ORDER BY id DESC LIMIT 1"
        )
        ligne = cur.fetchone()
        return bool(ligne[0]) if ligne else False


def _recuperer_utilisateur_par_id(conn, utilisateur_id: UUID) -> dict | None:
    """Recupere id + keycloak_user_id d'un utilisateur applicatif par son UUID local."""
    with get_dict_cursor(conn) as cur:
        cur.execute(
            "SELECT id, keycloak_user_id FROM identite.utilisateurs WHERE id = %s",
            (str(utilisateur_id),),
        )
        return cur.fetchone()


def _recuperer_utilisateur_par_keycloak_id(conn, keycloak_user_id: str) -> dict | None:
    """Recupere id + keycloak_user_id d'un utilisateur applicatif par son sub Keycloak."""
    with get_dict_cursor(conn) as cur:
        cur.execute(
            "SELECT id, keycloak_user_id FROM identite.utilisateurs WHERE keycloak_user_id = %s",
            (keycloak_user_id,),
        )
        return cur.fetchone()


def _lire_ou_creer_otp_utilisateur(conn, utilisateur_id) -> dict:
    """
    Retourne la ligne administration.otp_utilisateur pour l'utilisateur
    donne. Si elle n'existe pas encore (aucune ligne par defaut a
    l'inscription), elle est creee avec otp_active=false.
    """
    with get_dict_cursor(conn) as cur:
        cur.execute(
            """
            SELECT utilisateur_id, otp_active, date_derniere_verif_otp,
                   nb_connexions_depuis_derniere_verif, date_maj
            FROM administration.otp_utilisateur
            WHERE utilisateur_id = %s
            """,
            (str(utilisateur_id),),
        )
        ligne = cur.fetchone()

        if ligne is None:
            cur.execute(
                """
                INSERT INTO administration.otp_utilisateur (utilisateur_id, otp_active)
                VALUES (%s, false)
                RETURNING utilisateur_id, otp_active, date_derniere_verif_otp,
                          nb_connexions_depuis_derniere_verif, date_maj
                """,
                (str(utilisateur_id),),
            )
            ligne = cur.fetchone()
            conn.commit()

        return ligne


def _construire_reponse(ligne: dict, otp_actif_global: bool) -> OtpUtilisateurReponse:
    return OtpUtilisateurReponse(
        utilisateur_id=str(ligne["utilisateur_id"]),
        otp_active=ligne["otp_active"],
        date_derniere_verif_otp=(
            ligne["date_derniere_verif_otp"].isoformat() if ligne["date_derniere_verif_otp"] else None
        ),
        nb_connexions_depuis_derniere_verif=ligne["nb_connexions_depuis_derniere_verif"],
        date_maj=ligne["date_maj"].isoformat(),
        # Si l'OTP est impose globalement, l'investisseur ne peut pas le
        # desactiver lui-meme (US-32 prevaut sur US-24)
        modifiable_par_investisseur=not otp_actif_global,
    )


def _appliquer_modification_otp(conn, utilisateur_id, keycloak_user_id: str, otp_active: bool) -> dict:
    """Met a jour otp_utilisateur, synchronise Keycloak, et retourne la ligne a jour."""
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO administration.otp_utilisateur (utilisateur_id, otp_active, date_maj)
            VALUES (%s, %s, now())
            ON CONFLICT (utilisateur_id)
            DO UPDATE SET otp_active = EXCLUDED.otp_active, date_maj = now()
            RETURNING utilisateur_id, otp_active, date_derniere_verif_otp,
                      nb_connexions_depuis_derniere_verif, date_maj
            """,
            (str(utilisateur_id), otp_active),
        )
        colonnes = [desc[0] for desc in cur.description]
        ligne = dict(zip(colonnes, cur.fetchone()))

    # Synchronisation Keycloak : ajoute/retire la Required Action CONFIGURE_TOTP
    try:
        keycloak_admin_client.definir_otp_utilisateur(
            keycloak_user_id=str(keycloak_user_id), otp_active=otp_active
        )
    except HTTPException:
        conn.rollback()
        raise

    conn.commit()
    return ligne


# ----------------------------------------------------------------------
# GET /api/utilisateurs/moi/otp
# ----------------------------------------------------------------------
@router.get("/api/utilisateurs/moi/otp", response_model=OtpUtilisateurReponse)
def lire_mon_otp(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Retourne l'etat OTP courant de l'utilisateur authentifie (US-24)."""
    with get_connection() as conn:
        ligne_utilisateur = _recuperer_utilisateur_par_keycloak_id(conn, utilisateur.keycloak_user_id)
        if ligne_utilisateur is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Utilisateur applicatif introuvable (synchronisation identite manquante).",
            )

        otp_actif_global = _lire_otp_actif_global(conn)
        ligne_otp = _lire_ou_creer_otp_utilisateur(conn, ligne_utilisateur["id"])

    return _construire_reponse(ligne_otp, otp_actif_global)


# ----------------------------------------------------------------------
# PUT /api/utilisateurs/moi/otp
# ----------------------------------------------------------------------
@router.put("/api/utilisateurs/moi/otp", response_model=OtpUtilisateurReponse)
def modifier_mon_otp(
    requete: OtpUtilisateurRequete,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """
    Active ou desactive l'OTP pour son propre compte (US-24).

    Refuse (409 Conflict) si `administration.parametres_otp.otp_actif_global`
    est `true` et que l'investisseur tente de DESACTIVER l'OTP (l'activation
    individuelle reste toujours possible).
    """
    with get_connection() as conn:
        ligne_utilisateur = _recuperer_utilisateur_par_keycloak_id(conn, utilisateur.keycloak_user_id)
        if ligne_utilisateur is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Utilisateur applicatif introuvable (synchronisation identite manquante).",
            )

        otp_actif_global = _lire_otp_actif_global(conn)

        if otp_actif_global and not requete.otp_active:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "L'OTP est impose globalement par l'administrateur "
                    "(administration.parametres_otp.otp_actif_global = true) : "
                    "vous ne pouvez pas le desactiver pour votre compte."
                ),
            )

        ligne_otp = _appliquer_modification_otp(
            conn,
            utilisateur_id=ligne_utilisateur["id"],
            keycloak_user_id=str(ligne_utilisateur["keycloak_user_id"]),
            otp_active=requete.otp_active,
        )

    return _construire_reponse(ligne_otp, otp_actif_global)


# ----------------------------------------------------------------------
# GET /api/admin/utilisateurs/{id}/otp
# ----------------------------------------------------------------------
@router.get("/api/admin/utilisateurs/{utilisateur_id}/otp", response_model=OtpUtilisateurReponse)
def lire_otp_utilisateur(
    utilisateur_id: UUID,
    _utilisateur: Annotated[UtilisateurAuthentifie, Depends(administrateur_requis)],
):
    """Retourne l'etat OTP courant d'un utilisateur donne (vue administrateur)."""
    with get_connection() as conn:
        ligne_utilisateur = _recuperer_utilisateur_par_id(conn, utilisateur_id)
        if ligne_utilisateur is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Utilisateur '{utilisateur_id}' introuvable.",
            )

        otp_actif_global = _lire_otp_actif_global(conn)
        ligne_otp = _lire_ou_creer_otp_utilisateur(conn, ligne_utilisateur["id"])

    return _construire_reponse(ligne_otp, otp_actif_global)


# ----------------------------------------------------------------------
# PUT /api/admin/utilisateurs/{id}/otp
# ----------------------------------------------------------------------
@router.put("/api/admin/utilisateurs/{utilisateur_id}/otp", response_model=OtpUtilisateurReponse)
def modifier_otp_utilisateur(
    utilisateur_id: UUID,
    requete: OtpUtilisateurRequete,
    _utilisateur: Annotated[UtilisateurAuthentifie, Depends(administrateur_requis)],
):
    """
    Active ou desactive l'OTP pour un utilisateur specifique (US-32),
    sans restriction (l'administrateur peut imposer/lever l'OTP
    individuellement, independamment de `otp_actif_global`).
    """
    with get_connection() as conn:
        ligne_utilisateur = _recuperer_utilisateur_par_id(conn, utilisateur_id)
        if ligne_utilisateur is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Utilisateur '{utilisateur_id}' introuvable.",
            )

        otp_actif_global = _lire_otp_actif_global(conn)

        ligne_otp = _appliquer_modification_otp(
            conn,
            utilisateur_id=ligne_utilisateur["id"],
            keycloak_user_id=str(ligne_utilisateur["keycloak_user_id"]),
            otp_active=requete.otp_active,
        )

    return _construire_reponse(ligne_otp, otp_actif_global)
