// ============================================================================
// components/Screen.tsx — Wrapper SafeAreaView pour les screens
// Gère automatiquement les zones sécurisées (notch, barre de statut)
// ============================================================================

import React, { ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, spacing } from '../theme';

interface Props {
  children: ReactNode;
  // Si true, le contenu est dans un ScrollView (défaut)
  scroll?:  boolean;
  // Si true, ajoute un padding horizontal/vertical standard
  padded?:  boolean;
}

export function Screen({ children, scroll = true, padded = false }: Props) {
  const containerStyle = [styles.container];
  const innerStyle     = padded ? { padding: spacing.md } : undefined;

  if (scroll) {
    return (
      <SafeAreaView style={containerStyle} edges={['top']}>
        <ScrollView
          contentContainerStyle={[styles.scroll, innerStyle]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {children}
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={containerStyle} edges={['top']}>
      <View style={[{ flex: 1 }, innerStyle]}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  scroll: {
    flexGrow: 1,
  },
});
