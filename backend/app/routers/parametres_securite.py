"""
Router "Parametres de securite" (US-30, US-31).

Endpoints :
  - GET /api/admin/parametres/securite : lit la configuration courante
  - PUT /api/admin/parametres/securite : met a jour la configuration et
    synchronise Keycloak (Brute Force Detection + SSO Session Idle)

Table concernee : administration.parametres_securite (cf. db/init.sql),
modelisee comme une "ligne unique" representant la configuration courante
(cf. docs/architecture.md section 3.7).
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field

from app.auth import UtilisateurAuthentifie, administrateur_requis
from app.db import get_connection, get_dict_cursor
from app.keycloak_client import keycloak_admin_client

router = APIRouter(prefix="/api/admin/parametres/securite", tags=["Administration - Securite"])


# ----------------------------------------------------------------------
# Schemas Pydantic
# ----------------------------------------------------------------------
class ParametresSecurite(BaseModel):
    """Representation de la configuration courante des seuils de securite."""

    max_tentatives_echouees: int = Field(
        ..., ge=3, le=10,
        description="Nombre de tentatives de connexion echouees avant blocage temporaire (3 a 10).",
    )
    duree_expiration_session_minutes: int = Field(
        ..., ge=5, le=120,
        description="Duree d'inactivite avant expiration automatique de session, en minutes (5 a 120).",
    )


class ParametresSecuriteReponse(ParametresSecurite):
    """Reponse enrichie avec les metadonnees de tracabilite."""

    date_maj: str
    modifie_par: str | None = None


# ----------------------------------------------------------------------
# GET /api/admin/parametres/securite
# ----------------------------------------------------------------------
@router.get("", response_model=ParametresSecuriteReponse)
def lire_parametres_securite(
    _utilisateur: Annotated[UtilisateurAuthentifie, Depends(administrateur_requis)],
):
    """
    Retourne la configuration courante des seuils de securite
    (administration.parametres_securite), reservee aux administrateurs.
    """
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT max_tentatives_echouees,
                       duree_expiration_session_minutes,
                       date_maj,
                       modifie_par
                FROM administration.parametres_securite
                ORDER BY id DESC
                LIMIT 1
                """
            )
            ligne = cur.fetchone()

    if ligne is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aucune configuration de securite trouvee en base.",
        )

    return ParametresSecuriteReponse(
        max_tentatives_echouees=ligne["max_tentatives_echouees"],
        duree_expiration_session_minutes=ligne["duree_expiration_session_minutes"],
        date_maj=ligne["date_maj"].isoformat(),
        modifie_par=str(ligne["modifie_par"]) if ligne["modifie_par"] else None,
    )


# ----------------------------------------------------------------------
# PUT /api/admin/parametres/securite
# ----------------------------------------------------------------------
@router.put("", response_model=ParametresSecuriteReponse)
def mettre_a_jour_parametres_securite(
    parametres: ParametresSecurite,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(administrateur_requis)],
):
    """
    Met a jour administration.parametres_securite, puis synchronise
    immediatement Keycloak via l'Admin REST API :
      - bruteForceProtected = true, failureFactor = max_tentatives_echouees (US-30)
      - ssoSessionIdleTimeout = duree_expiration_session_minutes * 60 (US-31)

    Les bornes (3-10 et 5-120) sont deja appliquees par Pydantic (Field
    ge/le) ET par les contraintes CHECK de la table en base de donnees
    (double validation, cf. db/init.sql).

    En cas d'echec de la synchronisation Keycloak, la transaction
    PostgreSQL est annulee (rollback) afin de garantir la coherence entre
    la base "bourse_db" et la configuration du realm.
    """
    # Recherche de l'utilisateur applicatif correspondant au "sub" Keycloak,
    # pour tracer "modifie_par" (FK -> identite.utilisateurs).
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM identite.utilisateurs WHERE keycloak_user_id = %s",
                (utilisateur.keycloak_user_id,),
            )
            ligne_utilisateur = cur.fetchone()
            modifie_par = ligne_utilisateur[0] if ligne_utilisateur else None

            # 1. Mise a jour de la configuration en base (ligne unique courante)
            cur.execute(
                """
                UPDATE administration.parametres_securite
                SET max_tentatives_echouees = %s,
                    duree_expiration_session_minutes = %s,
                    date_maj = now(),
                    modifie_par = %s
                WHERE id = (SELECT id FROM administration.parametres_securite ORDER BY id DESC LIMIT 1)
                RETURNING max_tentatives_echouees, duree_expiration_session_minutes, date_maj, modifie_par
                """,
                (
                    parametres.max_tentatives_echouees,
                    parametres.duree_expiration_session_minutes,
                    modifie_par,
                ),
            )
            ligne_maj = cur.fetchone()

            if ligne_maj is None:
                conn.rollback()
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Aucune configuration de securite a mettre a jour.",
                )

            # 2. Tracabilite dans identite.journal_securite (US specs section 5)
            if modifie_par is not None:
                cur.execute(
                    """
                    INSERT INTO identite.journal_securite (utilisateur_id, type_evenement, details)
                    VALUES (%s, 'modification_parametre', %s)
                    """,
                    (
                        modifie_par,
                        f'{{"parametre": "securite", '
                        f'"max_tentatives_echouees": {parametres.max_tentatives_echouees}, '
                        f'"duree_expiration_session_minutes": {parametres.duree_expiration_session_minutes}}}',
                    ),
                )

            # 3. Synchronisation Keycloak (US-30, US-31). En cas d'echec,
            #    on annule la transaction PostgreSQL pour rester coherent.
            try:
                keycloak_admin_client.synchroniser_parametres_securite(
                    max_tentatives_echouees=parametres.max_tentatives_echouees,
                    duree_expiration_session_minutes=parametres.duree_expiration_session_minutes,
                )
            except HTTPException:
                conn.rollback()
                raise

            # Tout s'est bien passe : on valide la transaction PostgreSQL
            conn.commit()

    return ParametresSecuriteReponse(
        max_tentatives_echouees=ligne_maj[0],
        duree_expiration_session_minutes=ligne_maj[1],
        date_maj=ligne_maj[2].isoformat(),
        modifie_par=str(ligne_maj[3]) if ligne_maj[3] else None,
    )
