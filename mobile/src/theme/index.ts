// ============================================================================
// theme/index.ts — Palette couleurs et tokens de design pour BourseOnline
// Inspiré du thème sombre de la BVC (fond très foncé, accent bleu/or)
// ============================================================================

import { MD3DarkTheme } from 'react-native-paper';

// ── Couleurs principales de l'application ──────────────────────────────────
export const colors = {
  // Fonds
  bg:        '#070b1c',   // fond principal (quasi-noir bleuté)
  panel:     '#111733',   // cartes et panels
  panel2:    '#0e1430',   // sous-panels, inputs

  // Textes
  txt:       '#e7ecff',   // texte principal
  muted:     '#8a93b8',   // texte secondaire
  line:      '#1f2a52',   // bordures et séparateurs

  // États du marché
  up:        '#22c55e',   // hausse (vert)
  down:      '#ef4444',   // baisse (rouge)
  flat:      '#9ca3af',   // stable (gris)

  // Accents
  accent:    '#60a5fa',   // bleu accent (liens, sélection)
  gold:      '#f59e0b',   // or (actions primaires, alertes)
} as const;

export type AppColors = typeof colors;

// ── Paper Theme sombre adapté à la bourse ──────────────────────────────────
// Construit un thème react-native-paper compatible MD3 Dark
export function buildPaperTheme() {
  return {
    ...MD3DarkTheme,
    colors: {
      ...MD3DarkTheme.colors,
      primary:              colors.accent,
      primaryContainer:     colors.panel,
      onPrimary:            colors.txt,
      onPrimaryContainer:   colors.txt,
      secondary:            colors.gold,
      background:           colors.bg,
      surface:              colors.panel,
      surfaceVariant:       colors.panel2,
      onBackground:         colors.txt,
      onSurface:            colors.txt,
      onSurfaceVariant:     colors.muted,
      outline:              colors.line,
      error:                colors.down,
    },
  };
}

// ── Espacements (multiples de 4px) ─────────────────────────────────────────
export const spacing = {
  xs:  4,
  sm:  8,
  md:  16,
  lg:  24,
  xl:  32,
  xxl: 48,
} as const;

// ── Rayons de bordure ───────────────────────────────────────────────────────
export const radius = {
  sm:   6,
  md:   10,
  lg:   14,
  xl:   20,
  pill: 9999,
} as const;

// ── Tailles de police ───────────────────────────────────────────────────────
export const fontSize = {
  xs:   10,
  sm:   12,
  md:   14,
  lg:   16,
  xl:   20,
  xxl:  24,
  hero: 32,
} as const;
