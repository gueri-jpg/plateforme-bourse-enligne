"""
Router "Devise de la plateforme" (US-34).

Endpoints :
  - GET /api/admin/parametres/devise : lit la devise par defaut courante
  - PUT /api/admin/parametres/devise : met a jour la devise par defaut

Table concernee : administration.parametres_plateforme (cf. db/init.sql).

Important (cf. docs/architecture.md section 3.7 et 3.3) : la modification
de `devise_par_defaut` ne s'applique QU'AUX NOUVEAUX comptes crees apres la
modification (le trigger `portefeuille.trg_comptes_devise_par_defaut`
applique la devise par defaut courante uniquement a l'INSERT). Les comptes
existants conservent leur devise d'origine - aucun effet retroactif.
"""

import re
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field, field_validator

from app.auth import UtilisateurAuthentifie, administrateur_requis
from app.db import get_connection, get_dict_cursor

router = APIRouter(prefix="/api/admin/parametres/devise", tags=["Administration - Devise"])


# Expression reguliere de validation d'un code devise ISO 4217
# (3 lettres majuscules, ex: EUR, USD, MAD)
_REGEX_CODE_ISO_4217 = re.compile(r"^[A-Z]{3}$")


# ----------------------------------------------------------------------
# Schemas Pydantic
# ----------------------------------------------------------------------
class ParametresDevise(BaseModel):
    """Devise par defaut de la plateforme (code ISO 4217)."""

    devise_par_defaut: str = Field(
        ..., min_length=3, max_length=3,
        description="Code devise ISO 4217 (3 lettres majuscules, ex: EUR, USD, MAD).",
    )

    @field_validator("devise_par_defaut")
    @classmethod
    def _valider_code_iso(cls, valeur: str) -> str:
        valeur = valeur.upper()
        if not _REGEX_CODE_ISO_4217.match(valeur):
            raise ValueError("devise_par_defaut doit etre un code ISO 4217 de 3 lettres (ex: EUR, USD, MAD).")
        return valeur


class ParametresDeviseReponse(ParametresDevise):
    """Reponse enrichie avec les metadonnees de tracabilite."""

    date_maj: str
    modifie_par: str | None = None


# ----------------------------------------------------------------------
# GET /api/admin/parametres/devise
# ----------------------------------------------------------------------
@router.get("", response_model=ParametresDeviseReponse)
def lire_devise_plateforme(
    _utilisateur: Annotated[UtilisateurAuthentifie, Depends(administrateur_requis)],
):
    """Retourne la devise par defaut courante de la plateforme (US-34)."""
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """
                SELECT devise_par_defaut, date_maj, modifie_par
                FROM administration.parametres_plateforme
                ORDER BY id DESC
                LIMIT 1
                """
            )
            ligne = cur.fetchone()

    if ligne is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Aucune configuration de plateforme trouvee en base.",
        )

    return ParametresDeviseReponse(
        devise_par_defaut=ligne["devise_par_defaut"],
        date_maj=ligne["date_maj"].isoformat(),
        modifie_par=str(ligne["modifie_par"]) if ligne["modifie_par"] else None,
    )


# ----------------------------------------------------------------------
# PUT /api/admin/parametres/devise
# ----------------------------------------------------------------------
@router.put("", response_model=ParametresDeviseReponse)
def mettre_a_jour_devise_plateforme(
    parametres: ParametresDevise,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(administrateur_requis)],
):
    """
    Met a jour administration.parametres_plateforme.devise_par_defaut (US-34).

    Aucune synchronisation Keycloak n'est necessaire pour ce parametre
    (purement applicatif, cf. docs/architecture.md section 5.6). Le
    changement n'affecte que les comptes crees APRES cette modification
    (cf. trigger portefeuille.trg_comptes_devise_par_defaut, db/init.sql).
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

            cur.execute(
                """
                UPDATE administration.parametres_plateforme
                SET devise_par_defaut = %s,
                    date_maj = now(),
                    modifie_par = %s
                WHERE id = (SELECT id FROM administration.parametres_plateforme ORDER BY id DESC LIMIT 1)
                RETURNING devise_par_defaut, date_maj, modifie_par
                """,
                (parametres.devise_par_defaut, modifie_par),
            )
            ligne_maj = cur.fetchone()

            if ligne_maj is None:
                conn.rollback()
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Aucune configuration de plateforme a mettre a jour.",
                )

            # Tracabilite
            if modifie_par is not None:
                cur.execute(
                    """
                    INSERT INTO identite.journal_securite (utilisateur_id, type_evenement, details)
                    VALUES (%s, 'modification_parametre', %s)
                    """,
                    (
                        modifie_par,
                        f'{{"parametre": "devise_par_defaut", "nouvelle_valeur": "{parametres.devise_par_defaut}"}}',
                    ),
                )

            conn.commit()

    return ParametresDeviseReponse(
        devise_par_defaut=ligne_maj[0],
        date_maj=ligne_maj[1].isoformat(),
        modifie_par=str(ligne_maj[2]) if ligne_maj[2] else None,
    )
