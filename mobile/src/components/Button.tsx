// ============================================================================
// components/Button.tsx — Bouton réutilisable avec variantes
// Variantes : primary (or), outline (bordure or), ghost (transparent),
//             buy (vert achat), sell (rouge vente), danger (rouge)
// ============================================================================

import React from 'react';
import {
  Pressable, StyleSheet, Text,
  ActivityIndicator, View, ViewStyle,
} from 'react-native';
import { colors, fontSize, radius, spacing } from '../theme';

type Variant = 'primary' | 'outline' | 'ghost' | 'buy' | 'sell' | 'danger';

interface Props {
  title:     string;
  onPress?:  () => void;
  variant?:  Variant;
  loading?:  boolean;
  disabled?: boolean;
  icon?:     React.ReactNode;
  style?:    ViewStyle;
}

export function Button({
  title,
  onPress,
  variant  = 'primary',
  loading  = false,
  disabled = false,
  icon,
  style,
}: Props) {
  const isDisabled = disabled || loading;

  const bg =
    variant === 'primary' ? colors.gold  :
    variant === 'buy'     ? colors.up    :
    variant === 'sell'    ? colors.down  :
    variant === 'danger'  ? colors.down  :
    'transparent';

  const fg =
    variant === 'primary' ? '#000000'  :
    variant === 'buy'     ? '#ffffff'  :
    variant === 'sell'    ? '#ffffff'  :
    variant === 'danger'  ? '#ffffff'  :
    variant === 'outline' ? colors.gold :
    colors.accent;

  const borderColor =
    variant === 'outline' ? colors.gold :
    variant === 'ghost'   ? 'transparent' :
    'transparent';

  return (
    <Pressable
      onPress={isDisabled ? undefined : onPress}
      style={({ pressed }) => [
        styles.btn,
        {
          backgroundColor: bg,
          borderColor,
          borderWidth: variant === 'outline' ? 1.5 : 0,
          opacity: isDisabled ? 0.4 : pressed ? 0.85 : 1,
        },
        style,
      ]}
    >
      <View style={styles.inner}>
        {loading ? (
          <ActivityIndicator color={fg} size="small" />
        ) : (
          <>
            {icon && <View style={{ marginRight: spacing.sm }}>{icon}</View>}
            <Text style={[styles.label, { color: fg }]}>{title}</Text>
          </>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical:   14,
    paddingHorizontal: spacing.lg,
    borderRadius:      radius.md,
    alignItems:        'center',
    justifyContent:    'center',
  },
  inner: {
    flexDirection: 'row',
    alignItems:    'center',
  },
  label: {
    fontSize:   fontSize.md,
    fontWeight: '700',
  },
});
