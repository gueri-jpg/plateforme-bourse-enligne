"""
Router "Suppression de compte" (self-service).

Endpoint :
  - DELETE /api/utilisateurs/moi : supprime definitivement son propre
    compte (donnees PostgreSQL + utilisateur Keycloak).

Utilise notamment par les tests fonctionnels (tests/fonctionnels/), qui
creent un compte reel a chaque execution (cf. deploy.yml, job
"tests-fonctionnels", execute apres deploiement contre la production) et
doivent nettoyer ce compte + ses donnees en fin de test. Ce runner CI n'a
acces qu'a la surface HTTPS publique (pas d'acces direct a PostgreSQL ni a
l'API admin Keycloak) : ce endpoint est donc le seul point d'entree
possible pour ce nettoyage.

Ordre de suppression PostgreSQL (cf. db/init.sql) :
  1. ordres.ordres (ON DELETE RESTRICT depuis portefeuille.comptes : doit
     etre supprime AVANT l'utilisateur, sinon la suppression echoue) —
     entraine en cascade ordres.executions.
  2. identite.utilisateurs — entraine en cascade profil_kyc,
     journal_securite, administration.otp_utilisateur,
     portefeuille.comptes (-> positions, historique.mouvements_compte).
  3. Utilisateur Keycloak, via app/keycloak_client.py.
"""

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.auth import UtilisateurAuthentifie, investisseur_requis
from app.db import get_connection
from app.keycloak_client import keycloak_admin_client

router = APIRouter(tags=["Compte utilisateur"])


@router.delete("/api/utilisateurs/moi", status_code=status.HTTP_204_NO_CONTENT)
def supprimer_mon_compte(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """
    Supprime definitivement le compte de l'utilisateur authentifie : ses
    ordres, son portefeuille, son profil KYC, et son utilisateur Keycloak.

    Irreversible. Le token utilise pour cet appel devient invalide dans les
    faits (l'utilisateur Keycloak sous-jacent n'existe plus).
    """
    with get_connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT id FROM identite.utilisateurs WHERE keycloak_user_id = %s",
                (utilisateur.keycloak_user_id,),
            )
            ligne = cur.fetchone()
            if ligne is None:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Utilisateur applicatif introuvable (synchronisation identite manquante).",
                )
            utilisateur_id = ligne[0]

            # 1. Supprimer les ordres avant l'utilisateur (ON DELETE RESTRICT
            #    sur ordres.ordres.compte_id -> portefeuille.comptes).
            cur.execute(
                """
                DELETE FROM ordres.ordres
                WHERE compte_id IN (
                    SELECT id FROM portefeuille.comptes WHERE utilisateur_id = %s
                )
                """,
                (str(utilisateur_id),),
            )

            # 2. Supprimer l'utilisateur applicatif (cascade vers profil_kyc,
            #    journal_securite, otp_utilisateur, comptes -> positions,
            #    mouvements_compte).
            cur.execute(
                "DELETE FROM identite.utilisateurs WHERE id = %s",
                (str(utilisateur_id),),
            )

        # 3. Supprimer l'utilisateur Keycloak. En cas d'echec, on annule les
        #    suppressions PostgreSQL pour eviter un compte orphelin cote
        #    Keycloak sans donnees applicatives (ou l'inverse).
        try:
            keycloak_admin_client.supprimer_utilisateur(utilisateur.keycloak_user_id)
        except HTTPException:
            conn.rollback()
            raise

        conn.commit()
