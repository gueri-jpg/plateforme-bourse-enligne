// ============================================================================
// navigation/RootNavigator.tsx — Navigateur racine conditionnel
// ============================================================================

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  ActivityIndicator, AppState, View, Text, StyleSheet, Linking, Alert,
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
  // Vrai dès que NavigationContainer a été monté au moins une fois
  // → empêche l'early return de le démonter si SSO arrive depuis le background
  const navMountedRef = useRef(false);
  // Cover affiché quand l'app passe en background (unauthenticated)
  // → Android capture le cover comme thumbnail au lieu de LoginScreen
  const [appStateCover, setAppStateCover] = useState(false);
  const coverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Référence virement reçue sans être authentifié → traiter après login
  const pendingDepotRef = useRef<{ ref: string; status: string | null } | null>(null);
  // SSO banque → bourse : token one-time reçu dans le deep link
  const [pendingBanqueSsoToken, setPendingBanqueSsoToken] = useState<string | null>(null);
  // Empêche le flash de LoginScreen pendant l'échange SSO
  const [ssoExchanging, setSsoExchanging] = useState(false);

  // ── Traitement d'un deep link (appelé quand navRef est prêt) ──────────────
  const processUrl = useCallback((url: string) => {
    if (!navRef.isReady()) {
      pendingUrlRef.current = url;
      // Marquer SSO en cours dès le cold start pour éviter le flash Login
      if (url.startsWith('bourseenligne://sso') && extractSsoToken(url)) setSsoExchanging(true);
      return;
    }

    if (url.startsWith('bourseenligne://sso')) {
      const token = extractSsoToken(url);
      if (!token) return;
      const s = useAuth.getState().status;
      if (s === 'authenticated') {
        navRef.navigate('Main');
      } else {
        setPendingBanqueSsoToken(token);
        setSsoExchanging(true);
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

  // Cover background : empêche le thumbnail Android de montrer LoginScreen
  useEffect(() => {
    const sub = AppState.addEventListener('change', (next) => {
      const s = useAuth.getState().status;
      if (next === 'background' && s !== 'authenticated') {
        if (coverTimerRef.current) clearTimeout(coverTimerRef.current);
        setAppStateCover(true);
      } else if (next === 'active') {
        // Délai pour laisser le deep link SSO arriver avant de lever le cover
        coverTimerRef.current = setTimeout(() => setAppStateCover(false), 300);
      }
    });
    return () => { sub.remove(); if (coverTimerRef.current) clearTimeout(coverTimerRef.current); };
  }, []);

  // Écouter les deep links entrants
  useEffect(() => {
    Linking.getInitialURL().then((url) => {
      if (!url) return;
      // Sur cold start : extraire le token SSO directement, sans attendre navRef
      // (évite le flash LoginScreen : early return SplashScreen reste actif jusqu'à la fin de l'échange)
      if (url.startsWith('bourseenligne://sso')) {
        const token = extractSsoToken(url);
        if (token && useAuth.getState().status !== 'authenticated') {
          setPendingBanqueSsoToken(token);
          setSsoExchanging(true);
          return;
        }
      }
      processUrl(url);
    });
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
      setSsoExchanging(false);
      return;
    }
    fetch(`${CONFIG.BANQUE_DASHBOARD_URL}/bourse/sso-exchange?token=${encodeURIComponent(token)}`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(({ bourse_tokens }: {
        email: string; existe: boolean; est_lie: boolean;
        bourse_tokens?: { access_token: string; id_token?: string; refresh_token?: string; expires_in?: number };
      }) => {
        if (bourse_tokens?.access_token) {
          // setTokens → status=authenticated → early return lève → NavigationContainer monte sur Main
          useAuth.getState().setTokens({
            access_token:  bourse_tokens.access_token,
            id_token:      bourse_tokens.id_token,
            refresh_token: bourse_tokens.refresh_token,
            expires_in:    bourse_tokens.expires_in ?? 300,
            token_type:    'Bearer',
          });
        }
        // Lever le splash → NavigationContainer monte sur Login si pas de tokens
        setSsoExchanging(false);
      })
      .catch(() => {
        // Erreur réseau : lever le splash → NavigationContainer monte sur Login
        setSsoExchanging(false);
      });
  }, [status, pendingBanqueSsoToken]);

  // Afficher le splash pendant l'hydratation OU pendant l'échange SSO cold-start
  // navMountedRef garantit qu'on ne démonte pas NavigationContainer s'il était déjà monté (cas background)
  if (status === 'unknown' || (ssoExchanging && status !== 'authenticated' && !navMountedRef.current)) return <SplashScreen />;


  // ── Callback appelé quand NavigationContainer est prêt ───────────────────
  // Traite l'URL en attente (cold start depuis un deep link)
  function onNavReady() {
    navMountedRef.current = true;
    const pending = pendingUrlRef.current;
    if (pending) {
      pendingUrlRef.current = null;
      processUrl(pending);
    }
  }

  return (
    <>
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
    {/* Overlay SSO : masque Login pendant le Token Exchange */}
    {ssoExchanging && status !== 'authenticated' && (
      <View style={[styles.splash, StyleSheet.absoluteFillObject]}>
        <StatusBar style="light" />
        <Text style={styles.splashLogo}>📈</Text>
        <Text style={styles.splashTitle}>BourseOnline</Text>
        <ActivityIndicator color={C.accent} size="large" style={{ marginTop: 32 }} />
      </View>
    )}
    {/* Cover background : remplace le thumbnail Android quand l'app est en background sur LoginScreen */}
    {appStateCover && status !== 'authenticated' && (
      <View style={[styles.splash, StyleSheet.absoluteFillObject]}>
        <StatusBar style="light" />
        <Text style={styles.splashLogo}>📈</Text>
        <Text style={styles.splashTitle}>BourseOnline</Text>
      </View>
    )}
    </>
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
