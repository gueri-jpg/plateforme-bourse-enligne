"""
Router ordres : passer, lister, annuler des ordres boursiers.

Flux FIX 4.4 (simulation LSE, heures BVC Casablanca) :
  1. Réception de l'ordre via l'API REST
  2. Construction d'un message FIX New Order Single (35=D)
  3. Envoi au moteur de matching simulé (fix_engine)
  4. Réception d'un FIX Execution Report (35=8)
  5. Mise à jour de la base de données selon le résultat
"""
import uuid
import logging
from datetime import datetime
from typing import Annotated, Optional
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, model_validator

from app.auth import UtilisateurAuthentifie, investisseur_requis
from app.db import get_connection, get_dict_cursor
from app.services.fix_messages import (
    build_new_order, build_cancel_request,
    ORD_TYPE_MARKET, ORD_TYPE_LIMIT,
    SIDE_BUY, SIDE_SELL,
    TIF_DAY, TIF_GTC, TIF_IOC, TIF_FOK,
)
from app.services.fix_engine import (
    process_new_order, process_cancel,
    get_order_book_snapshot,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ordres", tags=["Ordres"])

_CASABLANCA = ZoneInfo("Africa/Casablanca")


# ── Schémas ───────────────────────────────────────────────────────────────────

class OrdreIn(BaseModel):
    instrument_code: str = Field(..., min_length=1, max_length=20)
    sens:            str = Field(..., pattern="^(achat|vente)$")
    type_ordre:      str = Field(..., pattern="^(marche|limite)$")
    quantite:        int = Field(..., gt=0)
    prix_limite:     Optional[float] = Field(None, gt=0)
    prix_marche:     Optional[float] = Field(None, gt=0)
    time_in_force:   str = Field("day", pattern="^(day|gtc|ioc|fok)$")

    @model_validator(mode="after")
    def check_prix(self):
        if self.type_ordre == "limite" and not self.prix_limite:
            raise ValueError("prix_limite requis pour un ordre à cours limité.")
        if self.type_ordre == "marche" and not self.prix_marche:
            raise ValueError("prix_marche requis pour un ordre au marché.")
        return self


# ── Mappings FIX ──────────────────────────────────────────────────────────────

_SENS_TO_FIX = {"achat": SIDE_BUY, "vente": SIDE_SELL}
_TYPE_TO_FIX = {"marche": ORD_TYPE_MARKET, "limite": ORD_TYPE_LIMIT}
_TIF_TO_FIX  = {"day": TIF_DAY, "gtc": TIF_GTC, "ioc": TIF_IOC, "fok": TIF_FOK}


# ── Helpers DB ────────────────────────────────────────────────────────────────

def _get_compte_id(conn, keycloak_user_id: str) -> Optional[str]:
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
    with get_dict_cursor(conn) as cur:
        cur.execute(
            "SELECT id FROM marche.instruments WHERE UPPER(code) = UPPER(%s)",
            (code.upper(),),
        )
        row = cur.fetchone()
        if row:
            return str(row["id"])
        new_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO marche.instruments (id, code, nom, type, actif)
               VALUES (%s, %s, %s, 'action', true)
               ON CONFLICT (code) DO NOTHING""",
            (new_id, code.upper(), code.upper()),
        )
        conn.commit()
        cur.execute(
            "SELECT id FROM marche.instruments WHERE UPPER(code) = UPPER(%s)",
            (code.upper(),),
        )
        return str(cur.fetchone()["id"])


def _appliquer_execution(
    cur,
    compte_id: str,
    instrument_id: str,
    ordre_id: str,
    sens: str,
    prix_exec: float,
    quantite: int,
    montant_total: float,
) -> None:
    """Met à jour le solde, les positions et l'historique après exécution FIX."""
    if sens == "achat":
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
            (str(uuid.uuid4()), compte_id, instrument_id, quantite, prix_exec),
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
            (quantite, compte_id, instrument_id),
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
        (str(uuid.uuid4()), ordre_id, prix_exec, quantite, montant_total),
    )


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
            "id":                 str(r["id"]),
            "instrument":         r["instrument_code"],
            "nom":                r["instrument_nom"],
            "sens":               r["sens"],
            "type":               r["type_ordre"],
            "quantite":           int(r["quantite"]),
            "prix_limite":        float(r["prix_limite"]) if r["prix_limite"] else None,
            "statut":             r["statut"],
            "prix_execution":     float(r["prix_execution"]) if r["prix_execution"] else None,
            "quantite_executee":  float(r["quantite_executee"]) if r["quantite_executee"] else None,
            "montant_total":      float(r["montant_total"]) if r["montant_total"] else None,
            "date":               r["date_creation"].isoformat() if r["date_creation"] else None,
        }
        for r in rows
    ]


@router.post("")
def passer_ordre(
    data: OrdreIn,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """
    Place un ordre via le protocole FIX 4.4 (simulation LSE, heures BVC).

    Flux :
      1. Validation du solde / positions
      2. Construction FIX New Order Single (35=D)
      3. Envoi au moteur de matching simulé
      4. Réception FIX Execution Report (35=8)
      5. Mise à jour DB selon statut retourné
    """
    with get_connection() as conn:
        compte_id = _get_compte_id(conn, utilisateur.keycloak_user_id)
        if not compte_id:
            raise HTTPException(400, "Portefeuille introuvable. Finalisez votre inscription.")

        instrument_id = _get_or_create_instrument(conn, data.instrument_code)
        prix_ref      = data.prix_marche if data.type_ordre == "marche" else data.prix_limite
        montant_total = round(data.quantite * prix_ref, 2)

        with get_dict_cursor(conn) as cur:
            # Verrouillage pessimiste du compte
            cur.execute(
                "SELECT solde_especes FROM portefeuille.comptes WHERE id = %s FOR UPDATE",
                (compte_id,),
            )
            solde = float(cur.fetchone()["solde_especes"])

            if data.sens == "achat" and solde < montant_total:
                raise HTTPException(
                    400,
                    f"Solde insuffisant — disponible : {solde:.2f} MAD, requis : {montant_total:.2f} MAD.",
                )
            if data.sens == "vente":
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

            # ── Étape 1 : construire le message FIX New Order Single (35=D) ──
            # ordre_id = cl_ord_id : même UUID pour la DB et le carnet FIX,
            # ce qui permet à l'annulation de retrouver l'ordre par son ID DB.
            ordre_id  = str(uuid.uuid4())
            cl_ord_id = ordre_id
            fix_msg   = build_new_order(
                cl_ord_id     = cl_ord_id,
                symbol        = data.instrument_code.upper(),
                side          = _SENS_TO_FIX[data.sens],
                ord_type      = _TYPE_TO_FIX[data.type_ordre],
                quantity      = data.quantite,
                price         = data.prix_limite,
                time_in_force = _TIF_TO_FIX[data.time_in_force],
            )
            # Injecter le prix marché dans le tag 99 pour le moteur
            if data.prix_marche:
                fix_msg = fix_msg.rstrip("\x01") + f"\x0199={data.prix_marche:.4f}\x01"

            log.info("[FIX OUT] %s", fix_msg.replace("\x01", "|"))

            # ── Étape 2 : envoyer au moteur de matching simulé ───────────────
            exec_report, result = process_new_order(fix_msg)

            log.info("[FIX IN]  %s", exec_report.replace("\x01", "|"))
            log.info("[FIX RESULT] %s", result)

            statut    = result["statut"]
            prix_exec = result.get("prix_execution")
            qte_exec  = result.get("quantite_executee", 0)

            # ── Étape 3 : persister l'ordre en DB ────────────────────────────
            db_prix_lim  = data.prix_limite if data.type_ordre == "limite" else None

            cur.execute(
                """INSERT INTO ordres.ordres
                   (id, compte_id, instrument_id, sens, type_ordre,
                    quantite, prix_limite, statut)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    ordre_id, compte_id, instrument_id,
                    data.sens, data.type_ordre,
                    data.quantite, db_prix_lim, statut,
                ),
            )

            # ── Étape 4 : appliquer l'exécution si le moteur l'a exécuté ────
            if statut in ("execute", "partiellement_execute") and prix_exec:
                montant_exec = round(qte_exec * prix_exec, 2)
                _appliquer_execution(
                    cur, compte_id, instrument_id, ordre_id,
                    data.sens, prix_exec, qte_exec, montant_exec,
                )

        conn.commit()

    # ── Réponse ───────────────────────────────────────────────────────────────
    verb = "d'achat" if data.sens == "achat" else "de vente"
    if statut == "execute":
        msg = (
            f"✓ Ordre FIX {verb} de {data.quantite} × {data.instrument_code} "
            f"exécuté à {prix_exec:.2f} MAD."
        )
    elif statut == "partiellement_execute":
        msg = (
            f"⚡ Ordre FIX {verb} partiellement exécuté : "
            f"{qte_exec}/{data.quantite} × {data.instrument_code} à {prix_exec:.2f} MAD."
        )
    elif statut == "en_attente":
        msg = (
            f"⏳ Ordre FIX {verb} de {data.quantite} × {data.instrument_code} "
            f"en attente dans le carnet."
        )
    elif statut == "annule":
        msg = f"✗ Ordre FIX {verb} annulé — {result.get('raison', '')}."
    else:
        msg = f"✗ Ordre FIX {verb} rejeté — {result.get('raison', '')}."

    return {
        "id":                 ordre_id,
        "fix_cl_ord_id":      cl_ord_id,
        "statut":             statut,
        "prix_execution":     prix_exec,
        "quantite_executee":  qte_exec if qte_exec else None,
        "montant_total":      round(qte_exec * prix_exec, 2) if prix_exec and qte_exec else None,
        "message":            msg,
    }


@router.put("/{ordre_id}/annuler")
def annuler_ordre(
    ordre_id: str,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """
    Annule un ordre en_attente via FIX Order Cancel Request (35=F).
    Retourne un FIX Execution Report (35=8) ou Cancel Reject (35=9).
    """
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """SELECT o.id, o.statut, o.sens, o.quantite,
                          i.code AS symbol
                   FROM ordres.ordres o
                   JOIN marche.instruments i ON i.id = o.instrument_id
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

            # ── Construire FIX Cancel Request (35=F) ─────────────────────────
            cl_ord_id = str(uuid.uuid4())
            fix_cancel = build_cancel_request(
                orig_cl_ord_id = ordre_id,
                cl_ord_id      = cl_ord_id,
                order_id       = ordre_id,
                symbol         = ordre["symbol"],
                side           = _SENS_TO_FIX[ordre["sens"]],
                quantity       = ordre["quantite"],
            )

            log.info("[FIX OUT] %s", fix_cancel.replace("\x01", "|"))

            # ── Envoyer au moteur ─────────────────────────────────────────────
            exec_report, result = process_cancel(fix_cancel)

            log.info("[FIX IN]  %s", exec_report.replace("\x01", "|"))

            if "erreur" in result:
                raise HTTPException(400, result["erreur"])

            cur.execute(
                "UPDATE ordres.ordres SET statut = 'annule', date_maj = NOW() WHERE id = %s",
                (ordre_id,),
            )
        conn.commit()

    return {"succes": True, "message": "Ordre annulé via FIX Cancel Request (35=F)."}


@router.get("/carnet/{symbol}")
def carnet_ordres(
    symbol: str,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """
    Retourne le carnet d'ordres en mémoire pour un instrument (snapshot).
    Bids (acheteurs) triés par prix décroissant, Asks (vendeurs) par prix croissant.
    """
    return get_order_book_snapshot(symbol.upper())
