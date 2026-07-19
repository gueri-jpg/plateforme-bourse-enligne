"""Router ordres : passer, lister et annuler des ordres boursiers."""
import uuid
from datetime import datetime
from typing import Annotated
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.auth import UtilisateurAuthentifie, investisseur_requis
from app.db import get_connection, get_dict_cursor

_CASABLANCA = ZoneInfo("Africa/Casablanca")

def _marche_ouvert() -> bool:
    """BVC ouverte lundi-vendredi 09h00-15h30 heure de Casablanca."""
    now = datetime.now(tz=_CASABLANCA)
    if now.weekday() >= 5:
        return False
    mins = now.hour * 60 + now.minute
    return 540 <= mins < 930

router = APIRouter(prefix="/api/ordres", tags=["Ordres"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class OrdreIn(BaseModel):
    instrument_code: str = Field(..., min_length=1, max_length=20)
    sens: str = Field(..., pattern="^(achat|vente)$")
    type_ordre: str = Field(..., pattern="^(marche|limite)$")
    quantite: int = Field(..., gt=0)
    prix_limite: float | None = Field(None, gt=0)
    prix_marche: float | None = Field(None, gt=0)  # prix courant pour les ordres au marché

    @model_validator(mode="after")
    def check_prix(self):
        if self.type_ordre == "limite" and not self.prix_limite:
            raise ValueError("prix_limite requis pour un ordre à cours limité.")
        if self.type_ordre == "marche" and not self.prix_marche:
            raise ValueError("prix_marche requis pour un ordre au marché.")
        return self


# ── Helpers DB ────────────────────────────────────────────────────────────────

def _get_compte_id(conn, keycloak_user_id: str) -> str | None:
    with get_dict_cursor(conn) as cur:
        cur.execute(
            """SELECT c.id FROM portefeuille.comptes c
               JOIN identite.utilisateurs u ON u.id = c.utilisateur_id
               WHERE u.keycloak_user_id = %s""",
            (keycloak_user_id,),
        )
        row = cur.fetchone()
        return str(row["id"]) if row else None


def _get_or_create_instrument(conn, code: str) -> str:
    """Retourne l'UUID DB de l'instrument, le crée si inconnu."""
    with get_dict_cursor(conn) as cur:
        cur.execute(
            "SELECT id FROM marche.instruments WHERE UPPER(code) = UPPER(%s)",
            (code.upper(),),
        )
        row = cur.fetchone()
        if row:
            return str(row["id"])
        # Création à la volée pour les instruments BVC non pré-chargés
        new_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO marche.instruments (id, code, nom, type, actif)
               VALUES (%s, %s, %s, 'action', true)
               ON CONFLICT (code) DO NOTHING""",
            (new_id, code.upper(), code.upper()),
        )
        conn.commit()
        # Re-lire en cas de conflit
        cur.execute(
            "SELECT id FROM marche.instruments WHERE UPPER(code) = UPPER(%s)",
            (code.upper(),),
        )
        return str(cur.fetchone()["id"])


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("")
def lister_ordres(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Retourne les 100 derniers ordres de l'investisseur."""
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """SELECT o.id, o.sens, o.type_ordre, o.quantite, o.prix_limite,
                          o.statut, o.date_creation,
                          i.code AS instrument_code, i.nom AS instrument_nom,
                          e.prix_execution, e.quantite_executee, e.montant_total
                   FROM ordres.ordres o
                   JOIN marche.instruments i ON i.id = o.instrument_id
                   JOIN portefeuille.comptes c ON c.id = o.compte_id
                   JOIN identite.utilisateurs u ON u.id = c.utilisateur_id
                   LEFT JOIN ordres.executions e ON e.ordre_id = o.id
                   WHERE u.keycloak_user_id = %s
                   ORDER BY o.date_creation DESC
                   LIMIT 100""",
                (utilisateur.keycloak_user_id,),
            )
            rows = [dict(r) for r in cur.fetchall()]

    return [
        {
            "id": str(r["id"]),
            "instrument": r["instrument_code"],
            "nom": r["instrument_nom"],
            "sens": r["sens"],
            "type": r["type_ordre"],
            "quantite": int(r["quantite"]),
            "prix_limite": float(r["prix_limite"]) if r["prix_limite"] else None,
            "statut": r["statut"],
            "prix_execution": float(r["prix_execution"]) if r["prix_execution"] else None,
            "quantite_executee": float(r["quantite_executee"]) if r["quantite_executee"] else None,
            "montant_total": float(r["montant_total"]) if r["montant_total"] else None,
            "date": r["date_creation"].isoformat() if r["date_creation"] else None,
        }
        for r in rows
    ]


@router.post("")
def passer_ordre(
    data: OrdreIn,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Place un ordre d'achat ou de vente."""
    # Scénario 3 : SCA obligatoire avant tout ordre (y compris après SSO banque→bourse)
    from app.routers.inter_service import sca_valide_pour
    if not sca_valide_pour(utilisateur.email):
        raise HTTPException(
            status_code=403,
            detail={"code": "sca_requis", "message": "Authentification forte requise avant de passer un ordre."},
        )

    with get_connection() as conn:
        compte_id = _get_compte_id(conn, utilisateur.keycloak_user_id)
        if not compte_id:
            raise HTTPException(400, "Portefeuille introuvable. Finalisez votre inscription.")

        instrument_id = _get_or_create_instrument(conn, data.instrument_code)
        prix_exec = data.prix_marche if data.type_ordre == "marche" else data.prix_limite
        montant_total = round(data.quantite * prix_exec, 2)

        with get_dict_cursor(conn) as cur:
            # Verrouillage du compte
            cur.execute(
                "SELECT solde_especes FROM portefeuille.comptes WHERE id = %s FOR UPDATE",
                (compte_id,),
            )
            solde = float(cur.fetchone()["solde_especes"])

            if data.sens == "achat":
                if solde < montant_total:
                    raise HTTPException(
                        400,
                        f"Solde insuffisant — disponible : {solde:.2f}, requis : {montant_total:.2f} MAD.",
                    )
            else:
                cur.execute(
                    """SELECT quantite FROM portefeuille.positions
                       WHERE compte_id = %s AND instrument_id = %s""",
                    (compte_id, instrument_id),
                )
                pos = cur.fetchone()
                qtd = float(pos["quantite"]) if pos else 0.0
                if qtd < data.quantite:
                    raise HTTPException(
                        400,
                        f"Quantité insuffisante — détenus : {qtd}, demandé : {data.quantite}.",
                    )

            ordre_id = str(uuid.uuid4())

            # Pour les ordres au marché : prix_limite doit être NULL (contrainte DB)
            db_prix_limite = data.prix_limite if data.type_ordre == "limite" else None
            statut_initial = "execute" if (data.type_ordre == "marche" and _marche_ouvert()) else "en_attente"

            cur.execute(
                """INSERT INTO ordres.ordres
                   (id, compte_id, instrument_id, sens, type_ordre, quantite, prix_limite, statut)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    ordre_id, compte_id, instrument_id,
                    data.sens, data.type_ordre,
                    data.quantite, db_prix_limite, statut_initial,
                ),
            )

            if statut_initial == "execute":
                # Mise à jour du compte et des positions
                if data.sens == "achat":
                    cur.execute(
                        """UPDATE portefeuille.comptes
                           SET solde_especes = solde_especes - %s, date_maj = NOW()
                           WHERE id = %s""",
                        (montant_total, compte_id),
                    )
                    cur.execute(
                        """INSERT INTO portefeuille.positions
                           (id, compte_id, instrument_id, quantite, prix_revient_moyen)
                           VALUES (%s, %s, %s, %s, %s)
                           ON CONFLICT (compte_id, instrument_id)
                           DO UPDATE SET
                             quantite = portefeuille.positions.quantite + EXCLUDED.quantite,
                             prix_revient_moyen = (
                               portefeuille.positions.quantite * portefeuille.positions.prix_revient_moyen
                               + EXCLUDED.quantite * EXCLUDED.prix_revient_moyen
                             ) / (portefeuille.positions.quantite + EXCLUDED.quantite)""",
                        (str(uuid.uuid4()), compte_id, instrument_id, data.quantite, prix_exec),
                    )
                    cur.execute(
                        """INSERT INTO historique.mouvements_compte
                           (compte_id, type_mouvement, montant, instrument_id, ordre_id)
                           VALUES (%s, 'execution_achat', %s, %s, %s)""",
                        (compte_id, montant_total, instrument_id, ordre_id),
                    )
                else:
                    cur.execute(
                        """UPDATE portefeuille.comptes
                           SET solde_especes = solde_especes + %s, date_maj = NOW()
                           WHERE id = %s""",
                        (montant_total, compte_id),
                    )
                    cur.execute(
                        """UPDATE portefeuille.positions
                           SET quantite = quantite - %s
                           WHERE compte_id = %s AND instrument_id = %s""",
                        (data.quantite, compte_id, instrument_id),
                    )
                    cur.execute(
                        """DELETE FROM portefeuille.positions
                           WHERE compte_id = %s AND instrument_id = %s AND quantite <= 0""",
                        (compte_id, instrument_id),
                    )
                    cur.execute(
                        """INSERT INTO historique.mouvements_compte
                           (compte_id, type_mouvement, montant, instrument_id, ordre_id)
                           VALUES (%s, 'execution_vente', %s, %s, %s)""",
                        (compte_id, montant_total, instrument_id, ordre_id),
                    )

                cur.execute(
                    """INSERT INTO ordres.executions
                       (id, ordre_id, prix_execution, quantite_executee, montant_total)
                       VALUES (%s, %s, %s, %s, %s)""",
                    (str(uuid.uuid4()), ordre_id, prix_exec, data.quantite, montant_total),
                )

        conn.commit()

    verb = "d'achat" if data.sens == "achat" else "de vente"
    if statut_initial == "execute":
        msg = f"Ordre {verb} de {data.quantite} × {data.instrument_code} exécuté à {prix_exec:.2f} MAD."
    elif data.type_ordre == "marche":
        msg = f"Marché fermé — ordre {verb} de {data.quantite} × {data.instrument_code} sera exécuté à l'ouverture."
    else:
        msg = f"Ordre limité {verb} de {data.quantite} × {data.instrument_code} transmis (seuil : {prix_exec:.2f} MAD)."

    return {
        "id": ordre_id,
        "statut": statut_initial,
        "prix_execution": prix_exec if statut_initial == "execute" else None,
        "montant_total": montant_total if statut_initial == "execute" else None,
        "message": msg,
    }


@router.put("/{ordre_id}/annuler")
def annuler_ordre(
    ordre_id: str,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Annule un ordre en_attente."""
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """SELECT o.id, o.statut
                   FROM ordres.ordres o
                   JOIN portefeuille.comptes c ON c.id = o.compte_id
                   JOIN identite.utilisateurs u ON u.id = c.utilisateur_id
                   WHERE o.id = %s AND u.keycloak_user_id = %s""",
                (ordre_id, utilisateur.keycloak_user_id),
            )
            ordre = cur.fetchone()
            if not ordre:
                raise HTTPException(404, "Ordre introuvable.")
            if dict(ordre)["statut"] != "en_attente":
                raise HTTPException(400, f"Impossible d'annuler un ordre '{ordre['statut']}'.")

            cur.execute(
                "UPDATE ordres.ordres SET statut = 'annule', date_maj = NOW() WHERE id = %s",
                (ordre_id,),
            )
        conn.commit()

    return {"succes": True, "message": "Ordre annulé."}
