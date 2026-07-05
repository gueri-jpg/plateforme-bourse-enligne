"""Router portefeuille : compte espèces, positions, dépôts, comptes titres."""
import uuid
from datetime import date
from typing import Annotated, Optional

import requests as _requests
from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, Field

from app.auth import UtilisateurAuthentifie, investisseur_requis
from app.config import settings
from app.db import get_connection, get_dict_cursor

router = APIRouter(prefix="/api/portefeuille", tags=["Portefeuille"])

# ── Types de compte titres ────────────────────────────────────────────────────
TYPES_COMPTE = {"actions", "obligations", "opcvm", "mixte"}

# ── Migrations douces ─────────────────────────────────────────────────────────

def _ensure_columns():
    """Ajoute les colonnes manquantes si elles n'existent pas encore."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "ALTER TABLE historique.mouvements_compte "
                    "ADD COLUMN IF NOT EXISTS reference_externe VARCHAR(140)"
                )
                cur.execute(
                    "ALTER TABLE portefeuille.comptes "
                    "ADD COLUMN IF NOT EXISTS iban VARCHAR(35)"
                )
                cur.execute(
                    "ALTER TABLE portefeuille.comptes "
                    "ADD COLUMN IF NOT EXISTS numero VARCHAR(15)"
                )
                cur.execute(
                    "ALTER TABLE portefeuille.comptes "
                    "ADD COLUMN IF NOT EXISTS type VARCHAR(30) DEFAULT 'mixte'"
                )
                cur.execute(
                    "ALTER TABLE portefeuille.comptes "
                    "ADD COLUMN IF NOT EXISTS statut VARCHAR(20) DEFAULT 'actif'"
                )
                cur.execute(
                    "ALTER TABLE portefeuille.comptes "
                    "ADD COLUMN IF NOT EXISTS date_ouverture DATE DEFAULT CURRENT_DATE"
                )
                # Contrainte unique sur numero (si pas encore présente)
                try:
                    cur.execute(
                        "ALTER TABLE portefeuille.comptes "
                        "ADD CONSTRAINT comptes_numero_unique UNIQUE (numero)"
                    )
                except Exception:
                    pass  # contrainte déjà présente
            conn.commit()
    except Exception:
        pass


_ensure_columns()


# ── Génération IBAN + numéro de compte titres ─────────────────────────────────

def _generate_iban(compte_id: str) -> str:
    """Génère un IBAN marocain standard (MOD97) — 28 chars, BBAN 24 chiffres décimaux."""
    # UUID → entier 128 bits → 24 chiffres décimaux (pas de lettres A-F)
    bban = str(int(compte_id.replace("-", ""), 16) % (10 ** 24)).zfill(24)
    check = 98 - (int(bban + "221000") % 97)  # MA=2210, 00 placeholder
    return f"MA{check:02d}{bban}"


def _generate_numero(compte_id: str) -> str:
    """Génère un numéro de compte titres au format CT-XXXXXXXX."""
    return "CT-" + compte_id.replace("-", "")[:8].upper()


def _fix_comptes():
    """Corrige les IBANs et génère les numéros manquants au démarrage."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id, iban, numero FROM portefeuille.comptes")
                rows = cur.fetchall()
                for row in rows:
                    cid = str(row[0])
                    updates = {}
                    correct_iban = _generate_iban(cid)
                    iban = row[1]
                    # Migrer : NULL, ancien format MA00..., ou ancien format 24 chars (hex BBAN)
                    if not iban or iban == f"MA00{cid.replace('-','')[:20].upper()}" or len(iban) != 28:
                        updates["iban"] = correct_iban
                    if not row[2]:
                        updates["numero"] = _generate_numero(cid)
                    if updates:
                        set_clause = ", ".join(f"{k} = %s" for k in updates)
                        cur.execute(
                            f"UPDATE portefeuille.comptes SET {set_clause} WHERE id = %s",
                            list(updates.values()) + [cid],
                        )
            conn.commit()
    except Exception:
        pass


_fix_comptes()


# ── Helpers DB ────────────────────────────────────────────────────────────────

def _get_or_create_utilisateur(conn, utilisateur: UtilisateurAuthentifie) -> str:
    with get_dict_cursor(conn) as cur:
        cur.execute(
            "SELECT id FROM identite.utilisateurs WHERE keycloak_user_id = %s",
            (utilisateur.keycloak_user_id,),
        )
        row = cur.fetchone()
        if row:
            return str(row["id"])
        new_id = str(uuid.uuid4())
        cur.execute(
            """INSERT INTO identite.utilisateurs
               (id, keycloak_user_id, email, nom, prenom, statut)
               VALUES (%s, %s, %s, %s, %s, 'actif')""",
            (
                new_id,
                utilisateur.keycloak_user_id,
                utilisateur.email.lower(),
                utilisateur.claims.get("family_name") or "",
                utilisateur.claims.get("given_name") or "",
            ),
        )
        conn.commit()
        return new_id


def _get_or_create_compte(conn, utilisateur_id: str, type_compte: str = "mixte") -> dict:
    """Retourne le compte titres actif de l'utilisateur, en crée un si absent."""
    with get_dict_cursor(conn) as cur:
        cur.execute(
            """SELECT id, solde_especes, devise, iban, numero, type, statut, date_ouverture
               FROM portefeuille.comptes
               WHERE utilisateur_id = %s AND (statut = 'actif' OR statut IS NULL)
               ORDER BY date_ouverture DESC NULLS LAST LIMIT 1""",
            (utilisateur_id,),
        )
        row = cur.fetchone()
        if row:
            compte = dict(row)
            updates = {}
            if not compte.get("iban") or len(compte.get("iban", "")) != 28:
                updates["iban"] = _generate_iban(str(compte["id"]))
            if not compte.get("numero"):
                updates["numero"] = _generate_numero(str(compte["id"]))
            if not compte.get("statut"):
                updates["statut"] = "actif"
            if not compte.get("date_ouverture"):
                updates["date_ouverture"] = date.today()
            if updates:
                set_clause = ", ".join(f"{k} = %s" for k in updates)
                cur.execute(
                    f"UPDATE portefeuille.comptes SET {set_clause} WHERE id = %s",
                    list(updates.values()) + [str(compte["id"])],
                )
                conn.commit()
                compte.update(updates)
            return compte

        new_id = str(uuid.uuid4())
        iban = _generate_iban(new_id)
        numero = _generate_numero(new_id)
        cur.execute(
            """INSERT INTO portefeuille.comptes
               (id, utilisateur_id, solde_especes, iban, numero, type, statut, date_ouverture)
               VALUES (%s, %s, 0, %s, %s, %s, 'actif', CURRENT_DATE)""",
            (new_id, utilisateur_id, iban, numero, type_compte),
        )
        conn.commit()
        cur.execute(
            """SELECT id, solde_especes, devise, iban, numero, type, statut, date_ouverture
               FROM portefeuille.comptes WHERE id = %s""",
            (new_id,),
        )
        return dict(cur.fetchone())


def _lire_positions_mouvements(conn, compte_id: str) -> tuple:
    with get_dict_cursor(conn) as cur:
        cur.execute(
            """SELECT p.quantite, p.prix_revient_moyen,
                      i.code AS instrument_code, i.nom AS instrument_nom,
                      COALESCE(ca.dernier_prix, p.prix_revient_moyen) AS cours_actuel
               FROM portefeuille.positions p
               JOIN marche.instruments i ON i.id = p.instrument_id
               LEFT JOIN marche.cours_actuels ca ON ca.instrument_id = i.id
               WHERE p.compte_id = %s AND p.quantite > 0""",
            (compte_id,),
        )
        positions = [dict(r) for r in cur.fetchall()]

        cur.execute(
            """SELECT m.type_mouvement, m.montant, m.horodatage,
                      i.code AS instrument_code
               FROM historique.mouvements_compte m
               LEFT JOIN marche.instruments i ON i.id = m.instrument_id
               WHERE m.compte_id = %s
               ORDER BY m.horodatage DESC LIMIT 20""",
            (compte_id,),
        )
        mouvements = [dict(r) for r in cur.fetchall()]
    return positions, mouvements


def _format_compte(compte: dict, positions: list, mouvements: list) -> dict:
    valeur_marche = sum(
        float(p["quantite"]) * float(p.get("cours_actuel") or p["prix_revient_moyen"])
        for p in positions
    )
    return {
        "id": str(compte["id"]),
        "numero": compte.get("numero") or "",
        "type": compte.get("type") or "mixte",
        "statut": compte.get("statut") or "actif",
        "date_ouverture": compte["date_ouverture"].isoformat() if compte.get("date_ouverture") else None,
        "solde_especes": float(compte["solde_especes"]),
        "devise": compte["devise"],
        "iban": compte.get("iban") or "",
        "valeur_marche": round(valeur_marche, 2),
        "valorisation_totale": round(float(compte["solde_especes"]) + valeur_marche, 2),
        "positions": [
            {
                "instrument_code": p["instrument_code"],
                "instrument_nom": p["instrument_nom"],
                "quantite": float(p["quantite"]),
                "prix_revient_moyen": float(p["prix_revient_moyen"]),
                "cours_actuel": float(p["cours_actuel"]) if p.get("cours_actuel") else None,
            }
            for p in positions
        ],
        "mouvements": [
            {
                "type": m["type_mouvement"],
                "montant": float(m["montant"]),
                "instrument": m["instrument_code"],
                "date": m["horodatage"].isoformat() if m["horodatage"] else None,
            }
            for m in mouvements
        ],
    }


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/creer", status_code=201)
def creer_portefeuille(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    with get_connection() as conn:
        uid = _get_or_create_utilisateur(conn, utilisateur)
        compte = _get_or_create_compte(conn, uid)
    return {"message": "Portefeuille prêt.", "compte_id": compte["id"]}


@router.get("")
def lire_portefeuille(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    with get_connection() as conn:
        uid = _get_or_create_utilisateur(conn, utilisateur)
        compte = _get_or_create_compte(conn, uid)
        positions, mouvements = _lire_positions_mouvements(conn, str(compte["id"]))
    return _format_compte(compte, positions, mouvements)


# ── Comptes Titres ─────────────────────────────────────────────────────────────

class OuvertureIn(BaseModel):
    type: str = Field("mixte", pattern="^(actions|obligations|opcvm|mixte)$")


@router.post("/comptes-titres/ouvrir", status_code=201)
def ouvrir_compte_titres(
    data: OuvertureIn,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Ouvre un nouveau compte titres (clôture l'actif existant)."""
    with get_connection() as conn:
        uid = _get_or_create_utilisateur(conn, utilisateur)
        with get_dict_cursor(conn) as cur:
            # Clôturer le compte actif existant
            cur.execute(
                """UPDATE portefeuille.comptes
                   SET statut = 'cloture', date_maj = NOW()
                   WHERE utilisateur_id = %s AND statut = 'actif'""",
                (uid,),
            )
            conn.commit()
        # Créer le nouveau compte titres
        new_id = str(uuid.uuid4())
        iban = _generate_iban(new_id)
        numero = _generate_numero(new_id)
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """INSERT INTO portefeuille.comptes
                   (id, utilisateur_id, solde_especes, iban, numero, type, statut, date_ouverture)
                   VALUES (%s, %s, 0, %s, %s, %s, 'actif', CURRENT_DATE)""",
                (new_id, uid, iban, numero, data.type),
            )
            conn.commit()
    return {
        "message": f"Compte titres {data.type} ouvert avec succès.",
        "numero": numero,
        "iban": iban,
        "type": data.type,
        "statut": "actif",
    }


@router.get("/comptes-titres")
def lire_compte_titres(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Retourne le compte titres actif avec solde, positions valorisées et mouvements."""
    with get_connection() as conn:
        uid = _get_or_create_utilisateur(conn, utilisateur)
        compte = _get_or_create_compte(conn, uid)
        positions, mouvements = _lire_positions_mouvements(conn, str(compte["id"]))
    return _format_compte(compte, positions, mouvements)


@router.get("/comptes-titres/inter-service")
def compte_titres_inter_service(
    email: str,
    x_inter_service_token: Annotated[Optional[str], Header()] = None,
):
    """
    Endpoint inter-service (banque → bourse) : retourne le compte titres actif
    d'un utilisateur identifié par email, sans auth utilisateur.
    Sécurisé par X-Inter-Service-Token.
    """
    if not x_inter_service_token or x_inter_service_token != settings.INTER_SERVICE_TOKEN:
        raise HTTPException(401, "Token inter-service invalide ou manquant.")
    with get_connection() as conn:
        with get_dict_cursor(conn) as cur:
            # Recherche insensible à la casse (email stocké tel quel depuis JWT)
            cur.execute(
                "SELECT id FROM identite.utilisateurs WHERE lower(email) = %s",
                (email.lower(),),
            )
            user_row = cur.fetchone()
        if not user_row:
            raise HTTPException(404, "Utilisateur bourse introuvable pour cet email.")
        uid = str(user_row["id"])
        with get_dict_cursor(conn) as cur:
            cur.execute(
                """SELECT id, solde_especes, devise, iban, numero, type, statut, date_ouverture
                   FROM portefeuille.comptes
                   WHERE utilisateur_id = %s AND statut = 'actif'
                   ORDER BY date_ouverture DESC NULLS LAST LIMIT 1""",
                (uid,),
            )
            compte_row = cur.fetchone()
        if not compte_row:
            raise HTTPException(404, "Aucun compte titres actif pour cet utilisateur.")
        compte = dict(compte_row)
        # Auto-fix IBAN manquant ou non-standard (24 chars ancien format hex)
        if not compte.get("iban") or len(compte.get("iban", "")) != 28:
            new_iban = _generate_iban(str(compte["id"]))
            with get_dict_cursor(conn) as cur2:
                cur2.execute(
                    "UPDATE portefeuille.comptes SET iban = %s WHERE id = %s",
                    (new_iban, str(compte["id"])),
                )
            conn.commit()
            compte["iban"] = new_iban
        positions, _ = _lire_positions_mouvements(conn, str(compte["id"]))
    valeur_marche = sum(
        float(p["quantite"]) * float(p.get("cours_actuel") or p["prix_revient_moyen"])
        for p in positions
    )
    return {
        "numero": compte.get("numero") or "",
        "type": compte.get("type") or "mixte",
        "statut": compte.get("statut") or "actif",
        "date_ouverture": compte["date_ouverture"].isoformat() if compte.get("date_ouverture") else None,
        "solde_especes": float(compte["solde_especes"]),
        "devise": compte["devise"],
        "iban": compte.get("iban") or "",
        "valeur_marche": round(valeur_marche, 2),
        "valorisation_totale": round(float(compte["solde_especes"]) + valeur_marche, 2),
        "nb_lignes": len(positions),
    }


# ── Dépôt depuis banque ────────────────────────────────────────────────────────

class DepotIn(BaseModel):
    iban_bourse: str = Field(..., min_length=10, max_length=35)


@router.post("/depot")
def depot_depuis_banque(
    data: DepotIn,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Vérifie le dernier paiement banque CFC vers l'IBAN bourse et crédite le compte titres."""
    try:
        resp = _requests.get(
            f"{settings.BANQUE_API_URL}/bourse/verifier-paiement",
            params={"iban": data.iban_bourse},
            timeout=10,
        )
        resp.raise_for_status()
        verif = resp.json()
    except _requests.RequestException as exc:
        raise HTTPException(502, f"Banque CFC inaccessible : {exc}")

    if not verif.get("valide"):
        raise HTTPException(400, verif.get("raison", "Paiement non valide côté banque."))

    montant = float(verif["montant"])
    payment_id = verif.get("payment_id")
    ref_externe = f"PID:{payment_id}" if payment_id else f"IBAN:{data.iban_bourse[:28]}"

    with get_connection() as conn:
        uid = _get_or_create_utilisateur(conn, utilisateur)
        compte = _get_or_create_compte(conn, uid)
        compte_id = str(compte["id"])

        with get_dict_cursor(conn) as cur:
            try:
                cur.execute(
                    """SELECT 1 FROM historique.mouvements_compte
                       WHERE compte_id = %s AND reference_externe = %s""",
                    (compte_id, ref_externe),
                )
                if cur.fetchone():
                    raise HTTPException(409, "Ce dépôt a déjà été crédité sur votre compte.")
            except HTTPException:
                raise
            except Exception:
                pass

            cur.execute(
                """UPDATE portefeuille.comptes
                   SET solde_especes = solde_especes + %s, date_maj = NOW()
                   WHERE id = %s RETURNING solde_especes""",
                (montant, compte_id),
            )
            nouveau_solde = float(cur.fetchone()["solde_especes"])

            try:
                cur.execute(
                    """INSERT INTO historique.mouvements_compte
                       (compte_id, type_mouvement, montant, reference_externe)
                       VALUES (%s, 'depot', %s, %s)""",
                    (compte_id, montant, ref_externe),
                )
            except Exception:
                cur.execute(
                    """INSERT INTO historique.mouvements_compte
                       (compte_id, type_mouvement, montant)
                       VALUES (%s, 'depot', %s)""",
                    (compte_id, montant),
                )

        conn.commit()

    return {
        "succes": True,
        "montant_credite": montant,
        "devise": verif.get("devise", "MAD"),
        "nouveau_solde": nouveau_solde,
    }
