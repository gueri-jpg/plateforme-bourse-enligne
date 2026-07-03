"""Router portefeuille : compte espèces, positions et dépôts depuis la banque CFC."""
import uuid
from typing import Annotated

import requests as _requests
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.auth import UtilisateurAuthentifie, investisseur_requis
from app.config import settings
from app.db import get_connection, get_dict_cursor

router = APIRouter(prefix="/api/portefeuille", tags=["Portefeuille"])


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
            conn.commit()
    except Exception:
        pass


_ensure_columns()


def _generate_iban(compte_id: str) -> str:
    """Génère un IBAN marocain valide (MOD97) de 24 chars de BBAN unique par compte bourse."""
    # BBAN alphanumérique déterministe depuis le compte_id UUID (20 chars)
    bban = compte_id.replace("-", "")[:20].upper()
    # Calcul des check digits ISO 13616 : rearrange {BBAN}MA00, lettres→nombres, 98-(n%97)
    raw = bban + "MA00"
    numeric = "".join(str(ord(c) - 55) if c.isalpha() else c for c in raw)
    check = 98 - (int(numeric) % 97)
    return f"MA{check:02d}{bban}"


def _fix_wrong_ibans():
    """Corrige les IBANs existants calculés avec les check digits incorrects (00)."""
    try:
        with get_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT id FROM portefeuille.comptes WHERE iban IS NOT NULL")
                rows = cur.fetchall()
                for row in rows:
                    cid = str(row[0])
                    correct = _generate_iban(cid)
                    cur.execute(
                        "UPDATE portefeuille.comptes SET iban = %s WHERE id = %s",
                        (correct, cid),
                    )
            conn.commit()
    except Exception:
        pass


_fix_wrong_ibans()

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
                utilisateur.email,
                utilisateur.claims.get("family_name") or "",
                utilisateur.claims.get("given_name") or "",
            ),
        )
        conn.commit()
        return new_id


def _get_or_create_compte(conn, utilisateur_id: str) -> dict:
    with get_dict_cursor(conn) as cur:
        cur.execute(
            "SELECT id, solde_especes, devise, iban FROM portefeuille.comptes WHERE utilisateur_id = %s",
            (utilisateur_id,),
        )
        row = cur.fetchone()
        if row:
            compte = dict(row)
            if not compte.get("iban"):
                iban = _generate_iban(str(compte["id"]))
                cur.execute(
                    "UPDATE portefeuille.comptes SET iban = %s WHERE id = %s",
                    (iban, str(compte["id"])),
                )
                conn.commit()
                compte["iban"] = iban
            return compte
        new_id = str(uuid.uuid4())
        iban = _generate_iban(new_id)
        cur.execute(
            """INSERT INTO portefeuille.comptes (id, utilisateur_id, solde_especes, iban)
               VALUES (%s, %s, 0, %s)""",
            (new_id, utilisateur_id, iban),
        )
        conn.commit()
        # Re-lire pour obtenir la devise appliquée par le trigger
        cur.execute(
            "SELECT id, solde_especes, devise, iban FROM portefeuille.comptes WHERE id = %s",
            (new_id,),
        )
        return dict(cur.fetchone())


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/creer", status_code=201)
def creer_portefeuille(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Crée (ou confirme l'existence de) l'utilisateur DB et son compte espèces."""
    with get_connection() as conn:
        uid = _get_or_create_utilisateur(conn, utilisateur)
        compte = _get_or_create_compte(conn, uid)
    return {"message": "Portefeuille prêt.", "compte_id": compte["id"]}


@router.get("")
def lire_portefeuille(
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Retourne le solde espèces, les positions et les 20 derniers mouvements."""
    with get_connection() as conn:
        uid = _get_or_create_utilisateur(conn, utilisateur)
        compte = _get_or_create_compte(conn, uid)
        compte_id = str(compte["id"])

        with get_dict_cursor(conn) as cur:
            cur.execute(
                """SELECT p.quantite, p.prix_revient_moyen,
                          i.code AS instrument_code, i.nom AS instrument_nom
                   FROM portefeuille.positions p
                   JOIN marche.instruments i ON i.id = p.instrument_id
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

    return {
        "solde_especes": float(compte["solde_especes"]),
        "devise": compte["devise"],
        "iban": compte.get("iban") or "",
        "positions": [
            {
                "instrument_code": p["instrument_code"],
                "instrument_nom": p["instrument_nom"],
                "quantite": float(p["quantite"]),
                "prix_revient_moyen": float(p["prix_revient_moyen"]),
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


class DepotIn(BaseModel):
    iban_bourse: str = Field(..., min_length=10, max_length=35)


@router.post("/depot")
def depot_depuis_banque(
    data: DepotIn,
    utilisateur: Annotated[UtilisateurAuthentifie, Depends(investisseur_requis)],
):
    """Vérifie le dernier paiement banque CFC vers l'IBAN bourse et crédite le compte espèces."""
    # 1. Vérification inter-service auprès de la banque
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
            # Anti-doublon : chaque payment_id banque ne peut être crédité qu'une fois
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

            # Crédit du compte
            cur.execute(
                """UPDATE portefeuille.comptes
                   SET solde_especes = solde_especes + %s, date_maj = NOW()
                   WHERE id = %s
                   RETURNING solde_especes""",
                (montant, compte_id),
            )
            nouveau_solde = float(cur.fetchone()["solde_especes"])

            # Enregistrement du mouvement
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
