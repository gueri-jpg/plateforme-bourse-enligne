"""
Router "Parametres OTP" (US-32, US-33).

Endpoints :
  - GET /api/admin/parametres/otp : lit la configuration globale OTP
  - PUT /api/admin/parametres/otp : met a jour la configuration globale OTP
    (activation globale + regle de frequence)

Tables concernees :
  - administration.parametres_otp (ligne unique de configuration courante)
  - administration.otp_utilisateur (etat OTP par utilisateur, mis a jour en
    cascade si l'activation globale est activee/desactivee)
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, model_validator

from app.auth import UtilisateurAuthentifie, administrateur_requis
from app.db import get_connection, get_dict_cursor
from app.keycloak_client import keycloak_admin_client

router = APIRouter(prefix="/api/admin/parametres/otp", tags=["Administration - OTP"])


# ----------------------------------------------------------------------
# Schemas Pydantic
# ----------------------------------------------------------------------
FREQUENCES_VALIDES = ("chaque_connexion", "apres_n_jours", "apres_n_connexions")


class ParametresOtp(BaseModel):
    """Configuration globale de l'authentification a deux facteurs (OTP)."""

    otp_actif_global: bool = Field(
        ..., description="Indique si l'OTP est impose a tous les investisseurs (US-32)."
    )
    otp_frequence_type: str = Field(
        ...,
        description="Regle de frequence : 'chaque_connexion', 'apres_n_jours' ou 'apres_n_connexions' (US-33).",
    )
    otp_frequence_valeur: int | None = Field(
        None,
        gt=0,
        description="Valeur N associee a la regle de frequence (obligatoire sauf pour 'chaque_connexion').",
    )

    @model_validator(mode="after")
    def _valider_coherence_frequence(self) -> "ParametresOtp":
        if self.otp_frequence_type not in FREQUENCES_VALIDES:
            raise ValueError(
                f"otp_frequence_type doit etre l'une des valeurs : {', '.join(FREQUENCES_VALIDES)}"
            )
        if self.otp_frequence_type == "chaque_connexion" and self.otp_frequence_valeur is not None:
            raise ValueError(
                "otp_frequence_valeur doit etre absent (null) lorsque otp_frequence_type='chaque_connexion'."
            )
        if self.otp_frequence_type != "chaque_connexion" and self.otp_frequence_valeur is None:
            raise ValueError(
                "otp_frequence_valeur est obligatoire (et > 0) lorsque otp_frequence_type != 'chaque_connexion'."
            )
        return self


class ParametresOtpReponse(ParametresOtp):
    """Reponse enrichie avec les metadonnees de tracabilite."""

    date_maj: str
    modifie_par: str | None = None


# ----------------------------------------------------------------------
# GET /api/admin/parametres/otp
# ----------------------------------------------------------------------
@router.get("", response_model=ParametresOtpReponse)
def lire_parametres_otp(
    _utilisateur: Annotated[UtilisateurAuthentifie, Depends(administrateur_requis)],
):
    """Retourne la configuration globale courante de l'OTP (administration.parametres_otp)."""
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT otp_actif_global, otp_frequence_type, otp_frequence_valeur,
                       date_maj, modifie_par
                FROM administration.parametres_otp
                ORDER BY id DESC
                LIMIT 1
                """
            )
            ligne = cur.fetchone()

    if ligne is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aucune configuration OTP trouvee en base.",
        )

    return ParametresOtpReponse(
        otp_actif_global=ligne["otp_actif_global"],
        otp_frequence_type=ligne["otp_frequence_type"],
        otp_frequence_valeur=ligne["otp_frequence_valeur"],
        date_maj=ligne["date_maj"].isoformat(),
        modifie_par=str(ligne["modifie_par"]) if ligne["modifie_par"] else None,
    )


# ----------------------------------------------------------------------
# PUT /api/admin/parametres/otp
# ----------------------------------------------------------------------
@router.put("", response_model=ParametresOtpReponse)
def mettre_a_jour_parametres_otp(
    parametres: ParametresOtp,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(administrateur_requis)],
):
    """
    Met a jour administration.parametres_otp (US-32, US-33).

    Si `otp_actif_global` devient `true`, l'OTP est impose a TOUS les
    investisseurs : pour chaque utilisateur du schema identite ayant le
    role investisseur, on positionne `otp_utilisateur.otp_active = true`
    (creation de la ligne si absente) et on synchronise Keycloak en
    ajoutant la Required Action "CONFIGURE_TOTP".

    Si `otp_actif_global` redevient `false`, l'imposition globale est
    levee : les overrides individuels (`otp_utilisateur.otp_active`)
    existants sont conserves tels quels (chaque utilisateur garde son
    etat individuel, cf. docs/architecture.md section 2.7.2), seule la
    contrainte globale est retiree. Aucune desactivation en cascade n'est
    effectuee automatiquement (US-24 : choix individuel preserve).
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            # Identification de l'administrateur (pour modifie_par)
            cur.execute(
                "SELECT id FROM identite.utilisateurs WHERE keycloak_user_id = %s",
                (utilisateur.keycloak_user_id,),
            )
            ligne_utilisateur = cur.fetchone()
            modifie_par = ligne_utilisateur[0] if ligne_utilisateur else None

            # 1. Mise a jour de la configuration globale (ligne unique courante)
            cur.execute(
                """
                UPDATE administration.parametres_otp
                SET otp_actif_global = %s,
                    otp_frequence_type = %s,
                    otp_frequence_valeur = %s,
                    date_maj = now(),
                    modifie_par = %s
                WHERE id = (SELECT id FROM administration.parametres_otp ORDER BY id DESC LIMIT 1)
                RETURNING otp_actif_global, otp_frequence_type, otp_frequence_valeur, date_maj, modifie_par
                """,
                (
                    parametres.otp_actif_global,
                    parametres.otp_frequence_type,
                    parametres.otp_frequence_valeur,
                    modifie_par,
                ),
            )
            ligne_maj = cur.fetchone()

            if ligne_maj is None:
                conn.rollback()
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Aucune configuration OTP a mettre a jour.",
                )

            # 2. Tracabilite
            if modifie_par is not None:
                cur.execute(
                    """
                    INSERT INTO identite.journal_securite (utilisateur_id, type_evenement, details)
                    VALUES (%s, 'modification_parametre', %s)
                    """,
                    (
                        modifie_par,
                        f'{{"parametre": "otp", '
                        f'"otp_actif_global": {str(parametres.otp_actif_global).lower()}, '
                        f'"otp_frequence_type": "{parametres.otp_frequence_type}", '
                        f'"otp_frequence_valeur": {parametres.otp_frequence_valeur if parametres.otp_frequence_valeur is not None else "null"}}}',
                    ),
                )

            # 3. Si activation globale : propager a tous les investisseurs
            utilisateurs_a_synchroniser: list[tuple] = []
            if parametres.otp_actif_global:
                cur.execute(
                    """
                    SELECT u.id, u.keycloak_user_id
                    FROM identite.utilisateurs u
                    WHERE u.statut = 'actif'
                    """
                )
                investisseurs = cur.fetchall()

                for utilisateur_id, keycloak_user_id in investisseurs:
                    cur.execute(
                        """
                        INSERT INTO administration.otp_utilisateur (utilisateur_id, otp_active, date_maj)
                        VALUES (%s, true, now())
                        ON CONFLICT (utilisateur_id)
                        DO UPDATE SET otp_active = true, date_maj = now()
                        """,
                        (utilisateur_id,),
                    )
                    utilisateurs_a_synchroniser.append((keycloak_user_id, True))

            # 4. Synchronisation Keycloak (ajout/retrait Required Action CONFIGURE_TOTP)
            try:
                for keycloak_user_id, otp_active in utilisateurs_a_synchroniser:
                    keycloak_admin_client.definir_otp_utilisateur(
                        keycloak_user_id=str(keycloak_user_id), otp_active=otp_active
                    )
            except HTTPException:
                conn.rollback()
                raise

            conn.commit()

    return ParametresOtpReponse(
        otp_actif_global=ligne_maj[0],
        otp_frequence_type=ligne_maj[1],
        otp_frequence_valeur=ligne_maj[2],
        date_maj=ligne_maj[3].isoformat(),
        modifie_par=str(ligne_maj[4]) if ligne_maj[4] else None,
    )
