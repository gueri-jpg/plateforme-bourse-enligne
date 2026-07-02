// ============================================================================
// navigation/types.ts — Types TypeScript pour React Navigation
// Définit les paramètres acceptés par chaque route
// ============================================================================

// ── Stack racine ──────────────────────────────────────────────────────────────
export type RootStackParamList = {
  Login: undefined;
  Main:  undefined;
};

// ── Bottom Tabs principaux ────────────────────────────────────────────────────
// Chaque onglet et ses éventuels paramètres
export type MainTabParamList = {
  Marche:      undefined;                                           // Liste des valeurs BVC
  Favoris:     undefined;                                           // Watchlist
  Ordre:       { stock?: string; direction?: 'achat' | 'vente' };  // Passer un ordre (pré-rempli depuis Marché/Favoris)
  Carnet:      undefined;                                           // Carnet d'ordres
  Portefeuille:undefined;                                           // Portefeuille et valorisation
  Profil:      undefined;                                           // Profil et déconnexion
};
