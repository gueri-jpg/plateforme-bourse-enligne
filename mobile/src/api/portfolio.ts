// ============================================================================
// api/portfolio.ts — Couche API pour le portefeuille et les ordres BVC
// Remplace services/trading.ts (local AsyncStorage) par des appels backend réels
// ============================================================================

import { apiClient } from './client';

// ── Types backend ─────────────────────────────────────────────────────────────

export interface ComptePosition {
  instrument_code:    string;
  instrument_nom:     string;
  quantite:           number;
  prix_revient_moyen: number;
  cours_actuel:       number;
}

export interface CompteMouvement {
  type:       string;   // 'execution_achat' | 'execution_vente' | 'depot' | 'retrait'
  montant:    number;
  instrument: string | null;
  date:       string;
}

export interface ComptePortefeuille {
  id:                  string;
  numero:              string;
  type:                string;   // 'actions' | 'obligations' | 'opcvm' | 'mixte'
  statut:              string;   // 'actif' | 'suspendu' | 'clôturé'
  date_ouverture:      string;
  solde_especes:       number;
  devise:              string;
  iban:                string;
  valeur_marche:       number;
  valorisation_totale: number;
  positions:           ComptePosition[];
  mouvements:          CompteMouvement[];
}

export type StatutOrdre = 'execute' | 'en_attente' | 'annule';

export interface OrdreBackend {
  id:                string;
  instrument:        string;
  nom:               string;
  sens:              'achat' | 'vente';
  type:              'marche' | 'limite';
  quantite:          number;
  prix_limite:       number | null;
  statut:            StatutOrdre;
  prix_execution:    number | null;
  quantite_executee: number;
  montant_total:     number;
  date:              string;
}

export interface PlaceOrdreParams {
  instrument_code: string;
  sens:            'achat' | 'vente';
  type_ordre:      'marche' | 'limite';
  quantite:        number;
  prix_limite?:    number | null;
  prix_marche?:    number | null;
}

export type PlaceOrdreResult =
  | { success: true;  data: OrdreBackend }
  | { success: false; scaRequired: true }
  | { success: false; scaRequired: false; message: string };

// ── Fonctions API ─────────────────────────────────────────────────────────────

/** Crée le compte titres si inexistant (idempotent). */
export async function ensureCompte(): Promise<void> {
  try {
    await apiClient.post('/api/portefeuille/creer');
  } catch {
    // 409 Already exists ou autre erreur → silencieux
  }
}

/** Récupère le portefeuille complet. Auto-crée le compte si 404. */
export async function fetchPortfolio(): Promise<ComptePortefeuille> {
  try {
    const res = await apiClient.get('/api/portefeuille');
    return res.data;
  } catch (err: any) {
    if (err.response?.status === 404) {
      await ensureCompte();
      const res = await apiClient.get('/api/portefeuille');
      return res.data;
    }
    throw err;
  }
}

/** Liste les 100 derniers ordres de l'utilisateur. */
export async function fetchOrdres(): Promise<OrdreBackend[]> {
  const res = await apiClient.get('/api/ordres');
  return res.data;
}

/** Déclenche l'envoi de l'OTP par email et retourne l'adresse masquée. */
export async function envoyerOTP(): Promise<{ masked_email: string; expires_in: number }> {
  const res = await apiClient.post('/api/sca/envoyer-otp');
  return res.data;
}

/** Vérifie le code OTP reçu par email. */
export async function verifySCA(code: string): Promise<boolean> {
  try {
    await apiClient.post('/api/sca/verifier', { code });
    return true;
  } catch {
    return false;
  }
}

/**
 * Passe un ordre BVC.
 * Retourne { scaRequired: true } si un code SCA est nécessaire (403).
 */
export async function placeOrdre(params: PlaceOrdreParams): Promise<PlaceOrdreResult> {
  try {
    const res = await apiClient.post('/api/ordres', params);
    return { success: true, data: res.data };
  } catch (err: any) {
    // FastAPI wraps detail in {"detail": ...}, so check data.detail.code
    const detail = err.response?.data?.detail;
    if (err.response?.status === 403 && detail?.code === 'sca_requis') {
      return { success: false, scaRequired: true };
    }
    const message =
      (typeof detail === 'string' ? detail : detail?.message) ??
      err.response?.data?.message ??
      "Erreur lors du passage de l'ordre";
    return { success: false, scaRequired: false, message };
  }
}

/** Annule un ordre en attente. */
export async function cancelOrdre(ordreId: string): Promise<void> {
  await apiClient.put(`/api/ordres/${ordreId}/annuler`);
}

export interface DepotResult {
  montant_credite: number;
  devise: string;
  nouveau_solde: number;
}

/** Crédite le compte bourse depuis un paiement banque CFC vérifié par IBAN. */
export async function depotDepuisBanque(iban_bourse: string): Promise<DepotResult> {
  const res = await apiClient.post('/api/portefeuille/depot', { iban_bourse });
  return res.data;
}

// ── Helpers d'affichage ───────────────────────────────────────────────────────

export const TYPE_COMPTE_LABELS: Record<string, string> = {
  actions:     'Actions',
  obligations: 'Obligations',
  opcvm:       'OPCVM',
  mixte:       'Mixte',
};

export const MOUVEMENT_LABELS: Record<string, string> = {
  execution_achat: 'Achat exécuté',
  execution_vente: 'Vente exécutée',
  depot:           'Dépôt',
  retrait:         'Retrait',
};

export const STATUT_ORDRE_LABELS: Record<StatutOrdre, string> = {
  execute:    'Exécuté',
  en_attente: 'En attente',
  annule:     'Annulé',
};
