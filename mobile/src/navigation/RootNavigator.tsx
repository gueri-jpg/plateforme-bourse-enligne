// ============================================================================
// navigation/RootNavigator.tsx — Navigateur racine conditionnel
// ============================================================================

import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  ActivityIndicator, AppState, View, Text, StyleSheet, Linking, Alert, TouchableOpacity,
} from 'react-native';
import { NavigationContainer, DefaultTheme, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator }          from '@react-navigation/native-stack';
import type { RootStackParamList }             from './types';
import { StatusBar }                           from 'expo-status-bar';

import { useAuth }                from '../store/useAuth';
import { usePin }                 from '../store/usePin';
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

// ── PIN Lock Overlay ─────────────────────────────────────────────────────────
const PIN_KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'] as const;

function PinLockOverlay({ onUnlock }: { onUnlock: () => void }) {
  const { verify } = usePin();
  const [entered, setEntered] = React.useState('');
  const [error,   setError]   = React.useState('');

  const handleKey = async (k: string) => {
    if (k === '⌫') { setEntered(p => p.slice(0, -1)); setError(''); return; }
    const next = entered + k;
    if (next.length > 4) return;
    setEntered(next);
    if (next.length < 4) return;
    setTimeout(async () => {
      const ok = await verify(next);
      if (ok) { onUnlock(); }
      else    { setEntered(''); setError('Code PIN incorrect. Réessayez.'); }
    }, 150);
  };

  return (
    <View style={[StyleSheet.absoluteFillObject, lock.bg]}>
      <StatusBar style="light" />
      <Text style={lock.appName}>cfcBourse</Text>
      <Text style={lock.hint}>Saisissez votre code PIN</Text>
      <View style={{ flexDirection: 'row', gap: 20, marginVertical: 28 }}>
        {[0,1,2,3].map(i => (
          <View key={i} style={[lock.dot, i < entered.length && lock.dotFilled]} />
        ))}
      </View>
      {!!error && <Text style={lock.error}>{error}</Text>}
      <View style={lock.numpad}>
        {PIN_KEYS.map((k, i) => (
          <TouchableOpacity
            key={i}
            style={[lock.key, !k && lock.keyHidden]}
            onPress={() => k && handleKey(k)}
            disabled={!k}
            activeOpacity={0.65}
          >
            <Text style={lock.keyTxt}>{k}</Text>
          </TouchableOpacity>
        ))}
      </View>
    </View>
  );
}

function SplashScreen() {
  return (
    <View style={styles.splash}>
      <StatusBar style="dark" />
      <Text style={styles.splashTitle}>cfcBourse</Text>
      <ActivityIndicator color="#7B1D3A" size="large" style={{ marginTop: 32 }} />
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

  const pinLocked = usePin((s) => s.locked);
  const pinUnlock = usePin((s) => s.unlock);

  // Hydrater auth + PIN au premier montage
  useEffect(() => {
    hydrate();
    usePin.getState().hydrate().then(() => {
      // Verrouiller si PIN activé et déjà authentifié (reprise d'app)
      if (usePin.getState().enabled && useAuth.getState().status === 'authenticated') {
        usePin.getState().lock();
      }
    });
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
        // Verrouiller avec PIN si activé
        if (usePin.getState().enabled && useAuth.getState().status === 'authenticated') {
          usePin.getState().lock();
        }
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
            options={{ headerShown: false, statusBarStyle: 'dark' }}
          />
        )}
      </Stack.Navigator>
    </NavigationContainer>
    {/* Overlay SSO : masque Login pendant le Token Exchange */}
    {ssoExchanging && status !== 'authenticated' && (
      <View style={[styles.splash, StyleSheet.absoluteFillObject]}>
        <StatusBar style="dark" />
        <Text style={styles.splashTitle}>cfcBourse</Text>
        <ActivityIndicator color="#7B1D3A" size="large" style={{ marginTop: 32 }} />
      </View>
    )}
    {/* PIN Lock : overlay plein écran si PIN activé et app revenue en avant-plan */}
    {pinLocked && status === 'authenticated' && (
      <PinLockOverlay onUnlock={pinUnlock} />
    )}
    {/* Cover background : remplace le thumbnail Android quand l'app est en background sur LoginScreen */}
    {appStateCover && status !== 'authenticated' && (
      <View style={[styles.splash, StyleSheet.absoluteFillObject]}>
        <StatusBar style="dark" />
        <Text style={styles.splashTitle}>cfcBourse</Text>
      </View>
    )}
    </>
  );
}

const styles = StyleSheet.create({
  splash: {
    flex:            1,
    backgroundColor: '#ffffff',
    alignItems:      'center',
    justifyContent:  'center',
  },
  splashTitle: { fontSize: 32, fontWeight: '800', color: '#7B1D3A', letterSpacing: -0.5 },
  splashHint:  { fontSize: 13, color: '#94a3b8', marginTop: 12 },
});

const lock = StyleSheet.create({
  bg:        { backgroundColor: '#070b1c', alignItems: 'center', justifyContent: 'center' },
  logo:      { fontSize: 52, marginBottom: 8 },
  appName:   { fontSize: 24, fontWeight: '700', color: '#e7ecff', marginBottom: 32 },
  hint:      { fontSize: 14, color: '#8a93b8' },
  dot:       { width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: '#334155', backgroundColor: 'transparent' },
  dotFilled: { backgroundColor: '#7B1D3A', borderColor: '#7B1D3A' },
  error:     { fontSize: 13, color: '#f87171', marginBottom: 8 },
  numpad:    { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10, marginTop: 8, paddingHorizontal: 40 },
  key:       { width: '28%', aspectRatio: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#111733', borderRadius: 14, borderWidth: 1, borderColor: '#1f2a52' },
  keyHidden: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyTxt:    { fontSize: 24, fontWeight: '500', color: '#e7ecff' },
});
