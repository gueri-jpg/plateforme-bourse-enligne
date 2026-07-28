"""
Router ordres : passer, lister, modifier, annuler des ordres boursiers.

Flux FIX 5.0/FIXT.1.1 (simulation LSE Millennium Exchange — MIT202, heures BVC
Casablanca) :
  1. Réception de l'ordre via l'API REST
  2. Construction d'un message FIX applicatif (New Order Single 35=D, Cancel
     Request 35=F, Cancel/Replace Request 35=G, Mass Cancel Request 35=q)
  3. Envoi au moteur de matching simulé (fix_engine)
  4. Réception d'un FIX Execution Report (35=8), Cancel Reject (35=9) ou Mass
     Cancel Report (35=r)
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
    build_new_order, build_cancel_request, build_replace_request, build_mass_cancel_request,
    ORD_TYPE_MARKET, ORD_TYPE_LIMIT, ORD_TYPE_STOP, ORD_TYPE_STOP_LIMIT,
    ORD_TYPE_PEGGED, ORD_TYPE_OFFSET,
    SIDE_BUY, SIDE_SELL,
    TIF_DAY, TIF_IOC, TIF_FOK, TIF_OPG, TIF_ATC, TIF_GFX, TIF_GFA, TIF_GFS, TIF_GTD,
    DISPLAY_METHOD_RANDOM, DISPLAY_METHOD_HIDDEN,
    PRE_TRADE_ANONYMITY_NAMED, PRE_TRADE_ANONYMITY_ANON,
    TRADING_SESSION_ID_CPX,
    MASS_CANCEL_ALL_ORDERS, MASS_CANCEL_FOR_INSTRUMENT,
    MASS_CANCEL_FOR_GROUP, MASS_CANCEL_FOR_INSTRUMENT_GROUP,
    PASSIVE_ONLY_NO_VISIBLE_MATCH,
)
from app.services.fix_engine import (
    process_new_order, process_cancel, process_replace, process_mass_cancel,
    get_order_book_snapshot,
)

log = logging.getLogger(__name__)
router = APIRouter(prefix="/api/ordres", tags=["Ordres"])

_CASABLANCA = ZoneInfo("Africa/Casablanca")


# ── Schémas ───────────────────────────────────────────────────────────────────

_TYPES_AVEC_PRIX_LIMITE = ("limite", "stop_limite", "iceberg", "cache")
_TYPES_AVEC_PRIX_MARCHE = ("marche", "stop")
_TIF_AVEC_ECHEANCE = ("gtd", "gtt")


class OrdreIn(BaseModel):
    instrument_code: str = Field(..., min_length=1, max_length=20)
    sens:            str = Field(..., pattern="^(achat|vente)$")
    type_ordre:      str = Field(
        ...,
        pattern="^(marche|limite|stop|stop_limite|iceberg|cache|pegged|offset)$",
    )
    quantite:        int = Field(..., gt=0)
    prix_limite:     Optional[float] = Field(None, gt=0)
    prix_marche:     Optional[float] = Field(None, gt=0)
    time_in_force:   str = Field(
        "day",
        pattern="^(day|gtc|ioc|fok|opg|atc|gfx|gfa|gfs|gtd|gtt|cpx)$",
    )

    # Stop / Stop Limit
    stop_px:             Optional[float] = Field(None, gt=0)
    # Iceberg (display_qty + display_method=None ou "random") / Hidden (display_method="hidden")
    display_qty:         Optional[int]   = Field(None, gt=0)
    display_method:      Optional[str]   = Field(None, pattern="^(random|hidden)$")
    # Pegged (MES)
    min_qty:             Optional[int]   = Field(None, gt=0)
    # Named (par défaut anonyme, "Y")
    pre_trade_anonymity: str             = Field("Y", pattern="^(Y|N)$")
    # GTD / GTT
    expire_time:         Optional[datetime] = None
    expire_date:         Optional[str]      = Field(None, pattern=r"^\d{4}-\d{2}-\d{2}$")
    # Offset (points de base vs Dynamic Reference Price)
    offset_bp:           Optional[float] = None
    # GroupID (27017) — bucket 1-255 pour un Mass Cancel ciblé ultérieur
    # (530=56/57) ; None = non groupé ("0" côté FIX/DB).
    group_id:            Optional[str] = Field(
        None, pattern=r"^([1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])$",
    )
    # PassiveOnlyOrder (27010) — rejette l'ordre s'il agresserait (croiserait)
    # une contrepartie visible au repos, plutôt que de l'exécuter comme
    # agresseur ("post-only"). Cf. fix_engine._PASSIVE_ONLY_REJECT_ON_CROSS :
    # ce moteur simulé n'a pas de table de tick size, donc les nuances 100/1/2/3
    # de MIT202 (BBO/1 palier/2 paliers) sont toutes traitées comme 99.
    passive_only:        bool = False

    @model_validator(mode="after")
    def check_prix(self):
        if self.type_ordre in _TYPES_AVEC_PRIX_LIMITE and not self.prix_limite:
            raise ValueError(f"prix_limite requis pour un ordre '{self.type_ordre}'.")
        if self.type_ordre in _TYPES_AVEC_PRIX_MARCHE and not self.prix_marche:
            raise ValueError(f"prix_marche requis pour un ordre '{self.type_ordre}'.")
        if self.type_ordre in ("stop", "stop_limite") and self.stop_px is None:
            raise ValueError("stop_px requis pour un ordre Stop/Stop Limit.")
        if self.type_ordre == "iceberg" and self.display_qty is None:
            raise ValueError("display_qty requis pour un ordre Iceberg.")
        if self.type_ordre == "iceberg" and self.display_qty and self.display_qty >= self.quantite:
            raise ValueError("display_qty doit être strictement inférieur à quantite (Iceberg).")
        if self.type_ordre == "offset":
            if self.offset_bp is None:
                raise ValueError("offset_bp requis pour un ordre Offset.")
            if self.time_in_force != "atc":
                raise ValueError("Un ordre Offset ne peut être soumis qu'avec time_in_force='atc' (2.1.1.2).")
        if self.type_ordre == "pegged" and self.min_qty is None:
            self.min_qty = None  # MES optionnel pour Pegged
        if self.time_in_force in _TIF_AVEC_ECHEANCE:
            if self.time_in_force == "gtd" and not self.expire_date:
                raise ValueError("expire_date requis pour time_in_force='gtd'.")
            if self.time_in_force == "gtt" and not self.expire_time:
                raise ValueError("expire_time requis pour time_in_force='gtt'.")
            if self.expire_date and self.expire_time:
                raise ValueError("expire_date et expire_time sont mutuellement exclusifs.")
        return self


class OrdreModifIn(BaseModel):
    """Order Cancel/Replace Request (35=G) — modification quantité/prix d'un ordre limite vivant."""
    quantite:    Optional[int]   = Field(None, gt=0)
    prix_limite: Optional[float] = Field(None, gt=0)
    # GroupID (27017) — permet de (re)grouper un ordre vivant pour un Mass
    # Cancel ciblé ultérieur ; None laisse la valeur courante inchangée.
    group_id:    Optional[str]   = Field(
        None, pattern=r"^([1-9][0-9]?|1[0-9]{2}|2[0-4][0-9]|25[0-5])$",
    )

    @model_validator(mode="after")
    def check_au_moins_un_champ(self):
        if self.quantite is None and self.prix_limite is None and self.group_id is None:
            raise ValueError("Au moins quantite, prix_limite ou group_id doit être fourni.")
        return self


# ── Mappings FIX ──────────────────────────────────────────────────────────────

_SENS_TO_FIX = {"achat": SIDE_BUY, "vente": SIDE_SELL}
_TYPE_TO_FIX = {
    "marche":      ORD_TYPE_MARKET,
    "limite":      ORD_TYPE_LIMIT,
    "stop":        ORD_TYPE_STOP,
    "stop_limite": ORD_TYPE_STOP_LIMIT,
    "iceberg":     ORD_TYPE_LIMIT,   # Iceberg = ordre limite + DisplayQty/DisplayMethod
    "cache":       ORD_TYPE_LIMIT,   # Hidden  = ordre limite + DisplayMethod=hidden
    "pegged":      ORD_TYPE_PEGGED,
    "offset":      ORD_TYPE_OFFSET,
}
# "gtc" n'existe pas dans l'énumération TimeInForce de MIT202 (LSE ne supporte
# pas un ordre valable indéfiniment) : mappé sur TIF_DAY côté FIX. "gtt" n'a
# pas non plus de valeur FIX dédiée : il s'exprime via TIF_GTD + ExpireTime
# (126) au lieu d'ExpireDate (432) — cf. fix_messages.py pour le détail.
_TIF_TO_FIX = {
    "day": TIF_DAY, "gtc": TIF_DAY, "ioc": TIF_IOC, "fok": TIF_FOK,
    "opg": TIF_OPG, "atc": TIF_ATC, "gfx": TIF_GFX, "gfa": TIF_GFA, "gfs": TIF_GFS,
    "gtd": TIF_GTD, "gtt": TIF_GTD,
    # CPX n'est pas une valeur TimeInForce FIX — c'est un bloc de session
    # (TradingSessionID=336="a") porté par un ordre DAY, cf. fix_messages.py.
    "cpx": TIF_DAY,
}


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
    # CumQty (14)/AvgPx (6) sont cumulatifs sur la vie d'un ordre FIX (6.4.5) :
    # un Order Cancel/Replace peut déclencher un remplissage supplémentaire sur
    # un ordre déjà partiellement exécuté, d'où l'upsert plutôt qu'un INSERT
    # simple (ordre_id est UNIQUE dans ordres.executions).
    cur.execute(
        """INSERT INTO ordres.executions
           (id, ordre_id, prix_execution, quantite_executee, montant_total)
           VALUES (%s, %s, %s, %s, %s)
           ON CONFLICT (ordre_id) DO UPDATE SET
             prix_execution = (
               (ordres.executions.prix_execution * ordres.executions.quantite_executee
                + EXCLUDED.prix_execution * EXCLUDED.quantite_executee)
               / (ordres.executions.quantite_executee + EXCLUDED.quantite_executee)
             ),
             quantite_executee = ordres.executions.quantite_executee + EXCLUDED.quantite_executee,
             montant_total      = ordres.executions.montant_total + EXCLUDED.montant_total,
             horodatage_execution = NOW()""",
        (str(uuid.uuid4()), ordre_id, prix_exec, quantite, montant_total),
    )


def _appliquer_evenements_annexes(cur, annexes: list[dict]) -> None:
    """
    Répercute en DB les "événements annexes" retournés par le moteur FIX —
    expiration GTD/GTT/DAY, déclenchement Stop, croisement CPX — constatés
    sur D'AUTRES ordres que celui de la requête HTTP en cours (sweep
    paresseux, cf. fix_engine._expirer_ordres / _trigger_stops / _resoudre_cpx).
    """
    for ev in annexes:
        cur.execute(
            "SELECT compte_id, instrument_id, sens FROM ordres.ordres WHERE id = %s",
            (ev["order_id"],),
        )
        row = cur.fetchone()
        if not row:
            continue
        cur.execute(
            "UPDATE ordres.ordres SET statut = %s, date_maj = NOW() WHERE id = %s",
            (ev["statut"], ev["order_id"]),
        )
        prix_exec = ev.get("prix_execution")
        qte_exec  = ev.get("quantite_executee")
        if prix_exec and qte_exec:
            montant = round(prix_exec * qte_exec, 2)
            _appliquer_execution(
                cur, str(row["compte_id"]), str(row["instrument_id"]), ev["order_id"],
                row["sens"], prix_exec, qte_exec, montant,
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
    Place un ordre via le protocole FIX 5.0/FIXT.1.1 (simulation LSE Millennium
    Exchange — MIT202, heures BVC).

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
        # Pegged/Offset n'ont pas de prix connu à la soumission (calculé par le
        # moteur au midpoint du BBO / depuis le DRP) : le contrôle de solde
        # amont ne peut pas être exact et est donc différé — seule
        # l'exécution réelle (prix_exec/qte_exec) impacte le solde en pratique.
        prix_ref      = data.prix_marche if data.type_ordre == "marche" else data.prix_limite
        montant_total = round(data.quantite * prix_ref, 2) if prix_ref else None

        with get_dict_cursor(conn) as cur:
            # Verrouillage pessimiste du compte
            cur.execute(
                "SELECT solde_especes FROM portefeuille.comptes WHERE id = %s FOR UPDATE",
                (compte_id,),
            )
            solde = float(cur.fetchone()["solde_especes"])

            if data.sens == "achat" and montant_total is not None and solde < montant_total:
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

            # display_method_fix porte la valeur FIX (tag 1084 : "3"=Random,
            # "4"=Hidden) ; db_display_method porte la valeur sémantique
            # attendue par la colonne DB ('random'/'hidden' — cf. contrainte
            # ordres_display_method_check). Les deux divergent volontairement.
            display_qty_fix     = None
            display_method_fix  = None
            db_display_method   = None
            if data.type_ordre == "cache":
                display_qty_fix, display_method_fix, db_display_method = 0, DISPLAY_METHOD_HIDDEN, "hidden"
            elif data.type_ordre == "iceberg":
                display_qty_fix = data.display_qty
                if data.display_method == "random":
                    display_method_fix, db_display_method = DISPLAY_METHOD_RANDOM, "random"

            pre_trade_anonymity_fix = (
                PRE_TRADE_ANONYMITY_NAMED if data.pre_trade_anonymity == "N" else PRE_TRADE_ANONYMITY_ANON
            )
            expire_time_fix = data.expire_time.strftime("%Y%m%d-%H:%M:%S.%f") if data.expire_time else None
            expire_date_fix = data.expire_date.replace("-", "") if data.expire_date else None
            trading_session_id_fix = TRADING_SESSION_ID_CPX if data.time_in_force == "cpx" else None
            stop_px_fix = data.stop_px if data.type_ordre in ("stop", "stop_limite") else None
            passive_only_fix = PASSIVE_ONLY_NO_VISIBLE_MATCH if data.passive_only else None

            fix_msg   = build_new_order(
                cl_ord_id       = cl_ord_id,
                trader_group_id = compte_id,
                symbol          = data.instrument_code.upper(),
                side            = _SENS_TO_FIX[data.sens],
                ord_type        = _TYPE_TO_FIX[data.type_ordre],
                quantity        = data.quantite,
                price           = data.prix_limite,
                time_in_force   = _TIF_TO_FIX[data.time_in_force],
                stop_px             = stop_px_fix,
                display_qty         = display_qty_fix,
                display_method      = display_method_fix,
                min_qty             = data.min_qty,
                pre_trade_anonymity = pre_trade_anonymity_fix,
                expire_time         = expire_time_fix,
                expire_date         = expire_date_fix,
                offset_bp           = data.offset_bp,
                trading_session_id  = trading_session_id_fix,
                passive_only_order  = passive_only_fix,
                group_id            = data.group_id,
            )
            # Injecter le prix marché dans le tag 99 pour le moteur — uniquement
            # pour les ordres réellement Market (le tag 99 des ordres Stop/Stop
            # Limit porte déjà StopPx, injecté par build_new_order ci-dessus).
            if data.prix_marche and data.type_ordre == "marche":
                fix_msg = fix_msg.rstrip("\x01") + f"\x0199={data.prix_marche:.4f}\x01"

            log.info("[FIX OUT] %s", fix_msg.replace("\x01", "|"))

            # ── Étape 2 : envoyer au moteur de matching simulé ───────────────
            exec_report, result = process_new_order(fix_msg)

            log.info("[FIX IN]  %s", exec_report.replace("\x01", "|"))
            log.info("[FIX RESULT] %s", result)

            statut    = result["statut"]
            prix_exec = result.get("prix_execution")
            qte_exec  = result.get("quantite_executee", 0)
            annexes   = result.get("evenements_annexes", [])

            # ── Étape 3 : persister l'ordre en DB ────────────────────────────
            # prix_limite est NULL pour marche/stop (contrainte DB) même si
            # fourni par erreur ; libre pour pegged/offset (plafond optionnel).
            db_prix_lim = None if data.type_ordre in ("marche", "stop") else data.prix_limite

            cur.execute(
                """INSERT INTO ordres.ordres
                   (id, compte_id, instrument_id, sens, type_ordre,
                    quantite, prix_limite, statut, time_in_force,
                    stop_px, display_qty, display_method, min_qty,
                    pre_trade_anonymity, expire_time, expire_date, offset_bp, group_id)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s,
                           %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (
                    ordre_id, compte_id, instrument_id,
                    data.sens, data.type_ordre,
                    data.quantite, db_prix_lim, statut, data.time_in_force,
                    stop_px_fix, display_qty_fix, db_display_method, data.min_qty,
                    data.pre_trade_anonymity, data.expire_time, data.expire_date, data.offset_bp,
                    data.group_id or "0",
                ),
            )

            # ── Étape 4 : appliquer l'exécution si le moteur l'a exécuté ────
            if statut in ("execute", "partiellement_execute") and prix_exec:
                montant_exec = round(qte_exec * prix_exec, 2)
                _appliquer_execution(
                    cur, compte_id, instrument_id, ordre_id,
                    data.sens, prix_exec, qte_exec, montant_exec,
                )

            # ── Étape 5 : répercuter les événements annexes (expirations, ───
            # déclenchements Stop, croisements CPX) sur d'AUTRES ordres ─────
            _appliquer_evenements_annexes(cur, annexes)

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
                """SELECT o.id, o.compte_id, o.statut, o.sens, o.quantite,
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
            # Un ordre partiellement exécuté a un reliquat vivant dans le
            # carnet (comme un ordre en_attente) : il doit pouvoir être annulé
            # au même titre — cohérent avec modifier_ordre qui autorise déjà
            # les deux statuts.
            if dict(ordre)["statut"] not in ("en_attente", "partiellement_execute"):
                raise HTTPException(400, f"Impossible d'annuler un ordre '{ordre['statut']}'.")

            # ── Construire FIX Cancel Request (35=F) ─────────────────────────
            cl_ord_id = str(uuid.uuid4())
            fix_cancel = build_cancel_request(
                orig_cl_ord_id  = ordre_id,
                cl_ord_id       = cl_ord_id,
                order_id        = ordre_id,
                trader_group_id = str(ordre["compte_id"]),
                symbol          = ordre["symbol"],
                side            = _SENS_TO_FIX[ordre["sens"]],
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
            _appliquer_evenements_annexes(cur, result.get("evenements_annexes", []))
        conn.commit()

    return {"succes": True, "message": "Ordre annulé via FIX Cancel Request (35=F)."}


@router.put("/{ordre_id}/modifier")
def modifier_ordre(
    ordre_id: str,
    data: OrdreModifIn,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """
    Modifie la quantité et/ou le prix limite d'un ordre vivant via FIX Order
    Cancel/Replace Request (35=G). Le sens et l'instrument ne sont pas
    modifiables (section 2.1.2.3) ; seuls les ordres à cours limité peuvent
    être modifiés.

    Si le remaniement fait croiser le carnet (ex : prix relevé), l'exécution
    déclenchée est appliquée au portefeuille comme pour un ordre neuf.
    """
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """SELECT o.id, o.compte_id, o.statut, o.sens, o.type_ordre,
                          o.quantite, o.prix_limite, o.group_id, o.time_in_force,
                          o.expire_time, o.expire_date, i.code AS symbol
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
            if ordre["statut"] not in ("en_attente", "partiellement_execute"):
                raise HTTPException(400, f"Impossible de modifier un ordre '{ordre['statut']}'.")
            if ordre["type_ordre"] != "limite":
                raise HTTPException(400, "Seuls les ordres à cours limité peuvent être modifiés.")

            nouvelle_qte   = data.quantite if data.quantite is not None else int(ordre["quantite"])
            nouveau_prix   = data.prix_limite if data.prix_limite is not None else float(ordre["prix_limite"])
            nouveau_groupe = data.group_id if data.group_id is not None else ordre.get("group_id", "0")
            compte_id      = str(ordre["compte_id"])

            # GTD/GTT (2.10.20) : le moteur FIX rejette un remaniement d'ordre
            # GTD/GTT qui ne reconduit pas exactement le même type d'expiration
            # (ExpireTime XOR ExpireDate, jamais aucun des deux). Comme cet
            # endpoint n'expose pas encore la modification de l'échéance,
            # on reconduit systématiquement la valeur d'origine de l'ordre.
            expire_time_fix = ordre["expire_time"].strftime("%Y%m%d-%H:%M:%S.%f") if ordre.get("expire_time") else None
            expire_date_fix = ordre["expire_date"].strftime("%Y%m%d") if ordre.get("expire_date") else None

            # ── Construire FIX Cancel/Replace Request (35=G) ─────────────────
            cl_ord_id = str(uuid.uuid4())
            fix_replace = build_replace_request(
                orig_cl_ord_id  = ordre_id,
                cl_ord_id       = cl_ord_id,
                order_id        = ordre_id,
                trader_group_id = compte_id,
                symbol          = ordre["symbol"],
                side            = _SENS_TO_FIX[ordre["sens"]],
                ord_type        = _TYPE_TO_FIX[ordre["type_ordre"]],
                order_qty       = nouvelle_qte,
                price           = nouveau_prix,
                group_id        = nouveau_groupe,
                expire_time     = expire_time_fix,
                expire_date     = expire_date_fix,
            )
            log.info("[FIX OUT] %s", fix_replace.replace("\x01", "|"))

            exec_report, result = process_replace(fix_replace)
            log.info("[FIX IN]  %s", exec_report.replace("\x01", "|"))

            if "erreur" in result:
                raise HTTPException(400, result["erreur"])

            statut = result["statut"]
            cur.execute(
                """UPDATE ordres.ordres
                   SET quantite = %s, prix_limite = %s, statut = %s, group_id = %s, date_maj = NOW()
                   WHERE id = %s""",
                (nouvelle_qte, nouveau_prix, statut, nouveau_groupe, ordre_id),
            )

            prix_exec = result.get("prix_execution")
            qte_exec  = result.get("quantite_executee") or 0
            if statut in ("execute", "partiellement_execute") and prix_exec:
                instrument_id = _get_or_create_instrument(conn, ordre["symbol"])
                montant_exec  = round(qte_exec * prix_exec, 2)
                _appliquer_execution(
                    cur, compte_id, instrument_id, ordre_id,
                    ordre["sens"], prix_exec, qte_exec, montant_exec,
                )
            _appliquer_evenements_annexes(cur, result.get("evenements_annexes", []))
        conn.commit()

    return {
        "succes":            True,
        "statut":            statut,
        "prix_execution":    prix_exec,
        "quantite_executee": qte_exec or None,
        "message":           "Ordre modifié via FIX Order Cancel/Replace Request (35=G).",
    }


@router.put("/annuler-tout")
def annuler_tous_ordres(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
    symbol: Optional[str] = None,
    group_id: Optional[str] = None,
):
    """
    Annule tous les ordres en_attente/partiellement_execute de l'utilisateur via
    FIX Order Mass Cancel Request (35=q). Restreint à un instrument si `symbol`
    est fourni, et/ou à un GroupID (27017) si `group_id` est fourni (530=56/57
    — For Group / For Instrument For Group), sinon tous les ordres du compte
    (section 2.1.2.2/6.4.3).
    """
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """SELECT c.id AS compte_id FROM portefeuille.comptes c
                   JOIN identite.utilisateurs u ON u.id = c.utilisateur_id
                   WHERE u.keycloak_user_id = %s""",
                (utilisateur.keycloak_user_id,),
            )
            row = cur.fetchone()
            if not row:
                raise HTTPException(400, "Portefeuille introuvable.")
            compte_id = str(row["compte_id"])

            cl_ord_id = str(uuid.uuid4())
            if group_id:
                mass_cancel_type = MASS_CANCEL_FOR_INSTRUMENT_GROUP if symbol else MASS_CANCEL_FOR_GROUP
            else:
                mass_cancel_type = MASS_CANCEL_FOR_INSTRUMENT if symbol else MASS_CANCEL_ALL_ORDERS
            fix_mass_cancel = build_mass_cancel_request(
                cl_ord_id                = cl_ord_id,
                mass_cancel_request_type = mass_cancel_type,
                trader_group_id          = compte_id,
                symbol                   = symbol.upper() if symbol else None,
                group_id                 = group_id,
            )
            log.info("[FIX OUT] %s", fix_mass_cancel.replace("\x01", "|"))

            reports, result = process_mass_cancel(fix_mass_cancel)
            for r in reports:
                log.info("[FIX IN]  %s", r.replace("\x01", "|"))

            if "erreur" in result:
                raise HTTPException(400, result["erreur"])

            order_ids = result.get("order_ids", [])
            if order_ids:
                # ::uuid[] requis : psycopg2 adapte une liste Python en text[],
                # et Postgres ne compare pas uuid = text sans cast explicite.
                cur.execute(
                    """UPDATE ordres.ordres
                       SET statut = 'annule', date_maj = NOW()
                       WHERE id = ANY(%s::uuid[]) AND compte_id = %s""",
                    (order_ids, compte_id),
                )
        conn.commit()

    return {
        "succes":  True,
        "annules": len(result.get("order_ids", [])),
        "message": "Ordres annulés via FIX Order Mass Cancel Request (35=q).",
    }


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
