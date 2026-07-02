// ============================================================================
// navigation/RootNavigator.tsx — Navigateur racine conditionnel
//
// Logique :
//  - status = 'unknown'         → Splash (ActivityIndicator) pendant l'hydratation
//  - status = 'unauthenticated' → Stack avec LoginScreen uniquement
//  - status = 'authenticated'   → Stack avec MainTabs (6 onglets)
//
// Le NavigationContainer doit être ici (au niveau le plus haut) et non dans App.tsx
// pour que useNavigation() fonctionne dans tous les screens enfants.
// ============================================================================

import React, { useEffect } from 'react';
import {
  ActivityIndicator, View, Text, StyleSheet,
} from 'react-native';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator }          from '@react-navigation/native-stack';
import { StatusBar }                           from 'expo-status-bar';

import { useAuth }    from '../store/useAuth';
import { LoginScreen } from '../screens/LoginScreen';
import { MainTabs }   from './MainTabs';
import type { RootStackParamList } from './types';

const C = {
  bg:     '#070b1c',
  panel:  '#111733',
  txt:    '#e7ecff',
  muted:  '#8a93b8',
  line:   '#1f2a52',
  accent: '#60a5fa',
  gold:   '#f59e0b',
};

// Thème NavigationContainer adapté à la palette sombre BVC
const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background:   C.bg,
    card:         C.panel,
    text:         C.txt,
    border:       C.line,
    primary:      C.accent,
    notification: C.gold,
  },
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ── Splash screen minimaliste affiché pendant l'hydratation ──────────────────
function SplashScreen() {
  return (
    <View style={styles.splash}>
      <StatusBar style="light" />
      <Text style={styles.splashLogo}>📈</Text>
      <Text style={styles.splashTitle}>BourseOnline</Text>
      <ActivityIndicator color={C.accent} size="large" style={{ marginTop: 32 }} />
      <Text style={styles.splashHint}>Chargement…</Text>
    </View>
  );
}

// ── Navigateur racine ─────────────────────────────────────────────────────────
export function RootNavigator() {
  const status  = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);

  // Hydrater le store depuis SecureStore au premier montage
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Afficher le splash pendant l'hydratation
  if (status === 'unknown') return <SplashScreen />;

  return (
    <NavigationContainer theme={navTheme}>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle:      { backgroundColor: C.panel },
          headerTitleStyle: { color: C.txt, fontWeight: '700' },
          headerTintColor:  C.accent,
          contentStyle:     { backgroundColor: C.bg },
          animation:        'slide_from_right',
        }}
      >
        {status === 'unauthenticated' ? (
          // ── Flow non authentifié : LoginScreen uniquement ──────────────────
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{
              headerShown:    false,
              gestureEnabled: false,  // empêche de swiper pour revenir en arrière
            }}
          />
        ) : (
          // ── Flow authentifié : 6 onglets ──────────────────────────────────
          <Stack.Screen
            name="Main"
            component={MainTabs}
            options={{ headerShown: false }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex:            1,
    backgroundColor: C.bg,
    alignItems:      'center',
    justifyContent:  'center',
  },
  splashLogo:  { fontSize: 64 },
  splashTitle: { fontSize: 28, fontWeight: '700', color: C.txt, marginTop: 12 },
  splashHint:  { fontSize: 13, color: C.muted, marginTop: 12 },
});
