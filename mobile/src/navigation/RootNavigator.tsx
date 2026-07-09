// ============================================================================
// navigation/RootNavigator.tsx — Navigateur racine conditionnel
// ============================================================================

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  ActivityIndicator, View, Text, StyleSheet, Linking, Alert,
} from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator }          from '@react-navigation/native-stack';
import type { RootStackParamList }             from './types';
import { StatusBar }                           from 'expo-status-bar';

import { useAuth }                from '../store/useAuth';
import { CONFIG }                from '../../constants/config';
import { LoginScreen }            from '../screens/LoginScreen';
import { OnboardingScreen }       from '../screens/OnboardingScreen';
import { ForgotPasswordScreen }   from '../screens/ForgotPasswordScreen';
import { VerifyResetCodeScreen }  from '../screens/VerifyResetCodeScreen';
import { ResetPasswordScreen }    from '../screens/ResetPasswordScreen';
import { MainTabs }               from './MainTabs';

// Ref globale pour naviguer depuis les Linking listeners (hors composant)
const navRef = createNavigationContainerRef<RootStackParamList>();

function extractSsoToken(url: string): string {
  try { return new URL(url).searchParams.get('t') ?? ''; } catch { return ''; }
}

const C = {
  bg:     '#070b1c',
  panel:  '#111733',
  txt:    '#e7ecff',
  muted:  '#8a93b8',
  line:   '#1f2a52',
  accent: '#60a5fa',
  gold:   '#f59e0b',
};

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

export function RootNavigator() {
  const status     = useAuth((s) => s.status);
  const isNewUser  = useAuth((s) => s.isNewUser);
  const hydrate    = useAuth((s) => s.hydrate);

  // URL reçue avant que le NavigationContainer soit monté (cold start depuis deep link)
  const pendingUrlRef = useRef<string | null>(null);
  // Référence virement reçue sans être authentifié → traiter après login
  const pendingDepotRef = useRef<{ ref: string; status: string | null } | null>(null);
  // SSO banque → bourse : token one-time reçu dans le deep link
  const [pendingBanqueSsoToken, setPendingBanqueSsoToken] = useState<string | null>(null);

  // ── Traitement d'un deep link (appelé quand navRef est prêt) ──────────────
  const processUrl = useCallback((url: string) => {
    if (!navRef.isReady()) {
      pendingUrlRef.current = url;
      return;
    }

    if (url.startsWith('bourseenligne://sso')) {
      const token = extractSsoToken(url);
      if (!token) return;
      const s = useAuth.getState().status;
      if (s === 'authenticated') {
        navRef.navigate('Main');
      } else {
        // Stocker pour échange après hydratation (même pattern que bourse→banque)
        setPendingBanqueSsoToken(token);
      }

    } else if (url.startsWith('bourseenligne://depot-confirm')) {
      let depotStatus: string | null = null;
      try { depotStatus = new URL(url).searchParams.get('status'); } catch {}
      let depotRef: string | null = null;
      try { depotRef = new URL(url).searchParams.get('ref'); } catch {}

      const s = useAuth.getState().status;
      if (s === 'authenticated') {
        navRef.navigate('Main');
        if (depotStatus === 'ok') {
          Alert.alert('Virement initié', 'Votre dépôt a bien été initié. Le solde sera mis à jour sous peu.');
        }
      } else {
        // Stocker pour traitement après authentification
        pendingDepotRef.current = { ref: depotRef ?? '', status: depotStatus };
      }
    }
  }, []);

  // Hydrater le store depuis SecureStore au premier montage
  useEffect(() => {
    hydrate();
  }, [hydrate]);

  // Écouter les deep links entrants
  useEffect(() => {
    Linking.getInitialURL().then((url) => { if (url) processUrl(url); });
    const sub = Linking.addEventListener('url', ({ url }) => processUrl(url));
    return () => sub.remove();
  }, [processUrl]);

  // Traiter le dépôt en attente dès que l'utilisateur est authentifié
  useEffect(() => {
    if (status === 'authenticated' && pendingDepotRef.current && navRef.isReady()) {
      const pending = pendingDepotRef.current;
      pendingDepotRef.current = null;
      navRef.navigate('Main');
      if (pending.status === 'ok') {
        Alert.alert('Virement initié', 'Votre dépôt a bien été initié. Le solde sera mis à jour sous peu.');
      }
    }
  }, [status]);

  // SSO banque → bourse : Token Exchange dès que status est connu et token reçu
  useEffect(() => {
    if (status === 'unknown' || !pendingBanqueSsoToken) return;
    const token = pendingBanqueSsoToken;
    setPendingBanqueSsoToken(null);
    if (status === 'authenticated') {
      if (navRef.isReady()) navRef.navigate('Main');
      return;
    }
    fetch(`${CONFIG.BANQUE_DASHBOARD_URL}/bourse/sso-exchange?token=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(({ email, existe, est_lie, bourse_tokens }: {
        email: string; existe: boolean; est_lie: boolean;
        bourse_tokens?: { access_token: string; id_token?: string; refresh_token?: string; expires_in?: number };
      }) => {
        if (!existe) {
          if (navRef.isReady()) navRef.navigate('Login', {});
          return;
        }
        if (est_lie && bourse_tokens?.access_token) {
          useAuth.getState().setTokens({
            access_token:  bourse_tokens.access_token,
            id_token:      bourse_tokens.id_token,
            refresh_token: bourse_tokens.refresh_token,
            expires_in:    bourse_tokens.expires_in ?? 300,
            token_type:    'Bearer',
          });
          return;
        }
        // Première liaison → PKCE avec pré-remplissage
        if (navRef.isReady()) navRef.navigate('Login', { idp_hint: 'cfc-banque', login_hint: email });
      })
      .catch(() => {
        if (navRef.isReady()) navRef.navigate('Login', {});
      });
  }, [status, pendingBanqueSsoToken]);

  // Afficher le splash pendant l'hydratation
  if (status === 'unknown') return <SplashScreen />;

  // ── Callback appelé quand NavigationContainer est prêt ───────────────────
  // Traite l'URL en attente (cold start depuis un deep link)
  function onNavReady() {
    const pending = pendingUrlRef.current;
    if (pending) {
      pendingUrlRef.current = null;
      processUrl(pending);
    }
  }

  return (
    <NavigationContainer ref={navRef} theme={navTheme} onReady={onNavReady}>
      <StatusBar style="light" />
      <Stack.Navigator
        screenOptions={{
          headerStyle:      { backgroundColor: C.panel },
          headerTitleStyle: { color: C.txt, fontWeight: '700' },
          headerTintColor:  C.accent,
          contentStyle:     { backgroundColor: C.bg },
          animation:        'none',
        }}
      >
        {status === 'unauthenticated' ? (
          <>
            <Stack.Screen
              name="Login"
              component={LoginScreen}
              options={{ headerShown: false, gestureEnabled: false }}
            />
            <Stack.Screen
              name="ForgotPassword"
              component={ForgotPasswordScreen}
              options={{ title: 'Mot de passe oublié', headerShown: true }}
            />
            <Stack.Screen
              name="VerifyResetCode"
              component={VerifyResetCodeScreen}
              options={{ title: 'Vérification', headerShown: true }}
            />
            <Stack.Screen
              name="ResetPassword"
              component={ResetPasswordScreen}
              options={{ title: 'Nouveau mot de passe', headerShown: true }}
            />
          </>
        ) : isNewUser ? (
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false, gestureEnabled: false }}
          />
        ) : (
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
