// ============================================================================
// components/Card.tsx — Conteneur carte pressable ou statique
// Utilisé pour les panneaux d'information, les lignes de liste, etc.
// ============================================================================

import React, { ReactNode } from 'react';
import { Pressable, StyleSheet, View, ViewStyle } from 'react-native';
import { colors, radius, spacing } from '../theme';

interface Props {
  children:  ReactNode;
  onPress?:  () => void;
  style?:    ViewStyle;
  // Affiche une bordure colorée quand selected=true (ex: sélection d'un stock)
  selected?: boolean;
}

export function Card({ children, onPress, style, selected }: Props) {
  const baseStyle = [
    styles.card,
    {
      borderColor: selected ? colors.accent : colors.line,
      borderWidth: selected ? 2 : 1,
    },
    style,
  ];

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          ...baseStyle,
          { opacity: pressed ? 0.85 : 1 },
        ]}
      >
        {children}
      </Pressable>
    );
  }

  return <View style={baseStyle}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    padding:         spacing.md,
    borderRadius:    radius.lg,
    marginBottom:    spacing.sm,
  },
});
