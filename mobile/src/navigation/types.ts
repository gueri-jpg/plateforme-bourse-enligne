// ============================================================================
// navigation/types.ts — Types TypeScript pour React Navigation
// Définit les paramètres acceptés par chaque route
// ============================================================================

// ── Stack racine ──────────────────────────────────────────────────────────────
export type RootStackParamList = {
  Login:           { sso_token?: string; idp_hint?: string; login_hint?: string };
  Onboarding:      undefined;
  Main:            undefined;
  ForgotPassword:  undefined;
  VerifyResetCode: { email: string; maskedEmail: string };
  ResetPassword:   { email: string; resetToken: string };
};

// ── Bottom Tabs principaux ────────────────────────────────────────────────────
// Chaque onglet et ses éventuels paramètres
export type MainTabParamList = {
  Accueil:     undefined;                                           // Dashboard
  Marche:      undefined;                                           // Liste des valeurs BVC
  Favoris:     undefined;                                           // Watchlist
  Ordre:       { stock?: string; direction?: 'achat' | 'vente' };  // Passer un ordre
  Carnet:      undefined;                                           // Carnet d'ordres (drawer)
  Portefeuille:undefined;                                           // Portefeuille et valorisation
  Profil:      undefined;                                           // Profil (drawer)
  Securite:    undefined;                                           // Sécurité (drawer)
};
