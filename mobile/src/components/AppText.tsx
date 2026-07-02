// ============================================================================
// components/AppText.tsx — Composant texte avec variantes typographiques
// Variantes : hero, h1, h2, h3, body, caption, mono
// Couleurs : text, soft, muted, accent, gold, up, down
// ============================================================================

import React from 'react';
import { Text, TextProps, StyleSheet } from 'react-native';
import { colors, fontSize } from '../theme';

type Variant = 'hero' | 'h1' | 'h2' | 'h3' | 'body' | 'caption' | 'mono';
type Color   = 'text' | 'soft' | 'muted' | 'accent' | 'gold' | 'up' | 'down';

interface Props extends TextProps {
  variant?: Variant;
  color?:   Color;
}

export function AppText({ variant = 'body', color = 'text', style, ...rest }: Props) {
  const c =
    color === 'soft'   ? colors.muted  :
    color === 'muted'  ? colors.muted  :
    color === 'accent' ? colors.accent :
    color === 'gold'   ? colors.gold   :
    color === 'up'     ? colors.up     :
    color === 'down'   ? colors.down   :
    colors.txt;

  return <Text {...rest} style={[styles[variant], { color: c }, style]} />;
}

const styles = StyleSheet.create({
  hero: {
    fontSize:      fontSize.hero,
    fontWeight:    '800',
    letterSpacing: -0.5,
    lineHeight:    fontSize.hero * 1.2,
  },
  h1: {
    fontSize:   fontSize.xxl,
    fontWeight: '800',
  },
  h2: {
    fontSize:   fontSize.xl,
    fontWeight: '700',
  },
  h3: {
    fontSize:   fontSize.lg,
    fontWeight: '600',
  },
  body: {
    fontSize:   fontSize.md,
    fontWeight: '400',
    lineHeight: 22,
  },
  caption: {
    fontSize:      fontSize.xs,
    fontWeight:    '500',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  mono: {
    fontSize:   fontSize.sm,
    fontFamily: 'monospace',
  },
});
