import React, { useRef, useState, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Pressable, Linking,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';

import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { buildPkceAuthUrl, buildPkceRegisterUrl, exchangeCodeForTokens, REDIRECT_URI } from '../api/auth';
import { useAuth } from '../store/useAuth';
import { CONFIG } from '../../constants/config';
import type { RootStackParamList } from '../navigation/types';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:    '#070b1c',
  panel: '#111733',
  txt:   '#e7ecff',
  muted: '#8a93b8',
  line:  '#1f2a52',
  accent:'#60a5fa',
  gold:  '#f59e0b',
  red:   '#ef4444',
  green: '#22c55e',
};

// ── URL rewriting ─────────────────────────────────────────────────────────────
const KC_LOCAL = 'http://localhost:9090';
const KC_REAL  = CONFIG.KEYCLOAK_BASE_URL.replace(/\/$/, '');

const FIX_KC_FORMS_SCRIPT = `(function(){
  try {
    var t = new URL(${JSON.stringify(KC_REAL)});
    document.querySelectorAll('form[action]').forEach(function(f){
      try {
        var u = new URL(f.action);
        if (u.hostname !== t.hostname || u.port !== t.port || u.protocol !== t.protocol) {
          u.protocol = t.protocol; u.hostname = t.hostname; u.port = t.port;
          f.action = u.toString();
        }
      } catch(e){}
    });
  } catch(e){}
})(); true;`;

function friendlyError(raw: string): { title: string; tips: string[] } {
  const lower = raw.toLowerCase();
  if (lower.includes('-1004') || lower.includes('cannot connect') || lower.includes('connexion au serveur')) {
    return {
      title: 'Connexion impossible',
      tips: [
        'Vérifiez que vous êtes bien connecté à Internet.',
        'Vérifiez votre connexion réseau et réessayez.',
      ],
    };
  }
  if (lower.includes('-1001') || lower.includes('timed out') || lower.includes('expir')) {
    return {
      title: 'Délai de connexion dépassé',
      tips: [
        'Le serveur prend trop de temps à répondre.',
        'Vérifiez votre connexion réseau.',
      ],
    };
  }
  if (lower.includes('ssl') || lower.includes('certificate')) {
    return {
      title: 'Erreur de sécurité',
      tips: ['La connexion sécurisée n\'a pas pu être établie. Réessayez.'],
    };
  }
  return {
    title: 'Erreur de connexion',
    tips: ['Une erreur est survenue. Veuillez réessayer.'],
  };
}

// ── État SSO : quand le compte bourse n'existe pas ───────────────────────────
type SsoNoAccount = { email: string };

// ─────────────────────────────────────────────────────────────────────────────
type Nav   = NativeStackNavigationProp<RootStackParamList>;
type Route = RouteProp<RootStackParamList, 'Login'>;

export function LoginScreen() {
  const setTokens  = useAuth((s) => s.setTokens);
  const navigation = useNavigation<Nav>();
  const route      = useRoute<Route>();

  const [authUrl,    setAuthUrl]    = useState('');
  const [webVisible, setWebVisible] = useState(false);
  const [errorMsg,   setErrorMsg]   = useState<string | null>(null);
  const [webError,   setWebError]   = useState<string | null>(null);
  const [reloadKey,  setReloadKey]  = useState(0);

  // État SSO "pas de compte bourse"
  const [ssoNoAccount, setSsoNoAccount]   = useState<SsoNoAccount | null>(null);
  // Spinner pendant l'échange du token SSO
  const [ssoExchanging, setSsoExchanging] = useState(false);

  const codeVerifierRef = useRef('');
  const stateRef        = useRef('');
  const handledRef      = useRef(false);
  const lastUrlRef      = useRef('');
  const isRegisterRef   = useRef(false);
  const webviewRef      = useRef<WebView>(null);

  const isLoading = authUrl !== '' && !webVisible && !webError;

  // ── Démarrer le flow PKCE ─────────────────────────────────────────────────
  const openWebView = useCallback((
    builder: () => { url: string; codeVerifier: string; state: string },
    isRegister: boolean,
  ) => {
    try {
      const { url, codeVerifier, state } = builder();
      codeVerifierRef.current = codeVerifier;
      stateRef.current        = state;
      handledRef.current      = false;
      isRegisterRef.current   = isRegister;
      setWebError(null);
      setErrorMsg(null);
      setWebVisible(false);
      setSsoNoAccount(null);
      setAuthUrl(url);
    } catch (e) {
      setErrorMsg('Impossible de démarrer la connexion. Réessayez.');
    }
  }, []);

  const startLogin    = useCallback(() => openWebView(buildPkceAuthUrl,    false), [openWebView]);
  const startRegister = useCallback(() => openWebView(buildPkceRegisterUrl, true),  [openWebView]);

  // ── SSO banque → bourse ────────────────────────────────────────────────────
  useEffect(() => {
    const ssoToken = route.params?.sso_token;
    if (!ssoToken) return;

    setSsoExchanging(true);
    setSsoNoAccount(null);
    setErrorMsg(null);

    fetch(`${CONFIG.BANQUE_DASHBOARD_URL}/bourse/sso-exchange?token=${encodeURIComponent(ssoToken)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(({ email, existe, est_lie, bourse_tokens }: {
        email: string; existe: boolean; est_lie: boolean;
        bourse_tokens?: { access_token: string; id_token?: string; refresh_token?: string; expires_in: number } | null;
      }) => {
        setSsoExchanging(false);

        if (!existe) {
          // Cas 3 : l'utilisateur n'a pas de compte bourse
          setSsoNoAccount({ email });
          return;
        }

        // Cas 1 : comptes déjà liés + tokens directs → bypass total du PKCE
        if (est_lie && bourse_tokens?.access_token) {
          useAuth.getState().setTokens({
            access_token:  bourse_tokens.access_token,
            id_token:      bourse_tokens.id_token,
            refresh_token: bourse_tokens.refresh_token,
            expires_in:    bourse_tokens.expires_in,
            token_type:    'Bearer',
          });
          return;
        }

        // Cas 2 : première liaison (est_lie=false) ou tokens non disponibles → PKCE
        openWebView(() => buildPkceAuthUrl({ loginHint: email, idpHint: 'cfc-banque' }), false);
      })
      .catch(() => {
        setSsoExchanging(false);
        // Token expiré ou réseau coupé → login normal
        startLogin();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // PKCE première liaison banque→bourse (idp_hint transmis par RootNavigator)
  useEffect(() => {
    const idpHint   = route.params?.idp_hint;
    const loginHint = route.params?.login_hint;
    if (!idpHint) return;
    openWebView(() => buildPkceAuthUrl({ loginHint, idpHint }), false);
  }, [route.params?.idp_hint, route.params?.login_hint, openWebView]);

  const closeWebView = useCallback(() => {
    setAuthUrl('');
    setWebVisible(false);
    setWebError(null);
    handledRef.current = false;
  }, []);

  // ── Traiter le callback OAuth2 ────────────────────────────────────────────
  const processCallback = useCallback((url: string) => {
    const qs = url.includes('?') ? url.slice(url.indexOf('?') + 1) : '';
    const params: Record<string, string> = {};
    qs.split('&').forEach((pair) => {
      const eq = pair.indexOf('=');
      if (eq > 0) {
        params[pair.slice(0, eq)] = decodeURIComponent(pair.slice(eq + 1).replace(/\+/g, ' '));
      }
    });

    if (params.error || !params.code) {
      closeWebView();
      setErrorMsg(`Erreur d'authentification. Réessayez.`);
      return;
    }

    if (params.state && params.state !== stateRef.current) {
      closeWebView();
      setErrorMsg('Erreur de sécurité. Réessayez.');
      return;
    }

    exchangeCodeForTokens(params.code, codeVerifierRef.current)
      .then(async (tokens) => {
        await setTokens(tokens, isRegisterRef.current);
      })
      .catch((e: unknown) => {
        closeWebView();
        setErrorMsg(`Échec connexion : ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [setTokens, closeWebView]);

  // ── Intercepteur de navigation WebView ───────────────────────────────────
  const handleShouldStart = useCallback((req: WebViewNavigation): boolean => {
    if (handledRef.current) return false;

    if (req.url.startsWith(KC_LOCAL)) {
      const rewritten = req.url.replace(KC_LOCAL, KC_REAL);
      const safe = rewritten.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      webviewRef.current?.injectJavaScript(`window.location.replace('${safe}'); true;`);
      return false;
    }

    if (req.url.startsWith(REDIRECT_URI)) {
      handledRef.current = true;
      processCallback(req.url);
      return false;
    }

    return true;
  }, [processCallback]);

  const overlayShown = webVisible || webError !== null;

  // ── Rendu ─────────────────────────────────────────────────────────────────
  return (
    <View style={s.container}>
      <StatusBar style="light" />

      {/* ── Page d'accueil ── */}
      <View style={s.hero}>
        <View style={s.logoCircle}>
          <Text style={s.logoIcon}>📈</Text>
        </View>
        <Text style={s.logoText}>Bourse<Text style={{ color: C.accent }}>Online</Text></Text>
        <Text style={s.tagline}>Investissez sur la Bourse de Casablanca</Text>
      </View>

      <View style={s.features}>
        {[
          { icon: '📊', label: 'Cours en temps réel' },
          { icon: '💼', label: 'Gestion de portefeuille' },
          { icon: '🔒', label: 'Sécurisé & confidentiel' },
        ].map((f) => (
          <View key={f.label} style={s.featureItem}>
            <Text style={s.featureIcon}>{f.icon}</Text>
            <Text style={s.featureLabel}>{f.label}</Text>
          </View>
        ))}
      </View>

      {errorMsg && (
        <View style={s.errorBanner}>
          <Text style={s.errorText}>{errorMsg}</Text>
        </View>
      )}

      {/* ── Spinner échange SSO ── */}
      {ssoExchanging && (
        <View style={s.ssoLoadingBox}>
          <ActivityIndicator color={C.accent} size="small" />
          <Text style={s.ssoLoadingTxt}>Connexion via Banque CFC…</Text>
        </View>
      )}

      {/* ── Cas 3 : pas de compte bourse ── */}
      {ssoNoAccount && !ssoExchanging && (
        <View style={s.noAccountBox}>
          <Text style={s.noAccountTitle}>Aucun compte BourseOnline</Text>
          <Text style={s.noAccountDesc}>
            Votre email{' '}
            <Text style={{ color: C.accent }}>{ssoNoAccount.email}</Text>
            {' '}n'est associé à aucun compte bourse.{'\n'}
            Créez votre compte pour commencer à investir.
          </Text>
          <TouchableOpacity style={s.btnPrimary} onPress={startRegister} activeOpacity={0.85}>
            <Text style={s.btnPrimaryText}>Ouvrir un compte bourse</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.btnSecondary, { marginTop: 10 }]}
            onPress={startLogin}
            activeOpacity={0.85}
          >
            <Text style={s.btnSecondaryText}>J'ai déjà un compte</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Boutons principaux (affichés uniquement hors SSO) ── */}
      {!ssoNoAccount && !ssoExchanging && (
        <View style={s.actions}>
          <TouchableOpacity
            style={[s.btnPrimary, isLoading && s.btnDisabled]}
            onPress={startLogin}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            {isLoading
              ? <ActivityIndicator color="#000" size="small" />
              : <Text style={s.btnPrimaryText}>Se connecter</Text>
            }
          </TouchableOpacity>

          <TouchableOpacity
            style={[s.btnSecondary, isLoading && s.btnDisabled]}
            onPress={startRegister}
            disabled={isLoading}
            activeOpacity={0.85}
          >
            <Text style={s.btnSecondaryText}>Ouvrir un compte</Text>
          </TouchableOpacity>

          {isLoading && (
            <TouchableOpacity onPress={closeWebView} style={s.cancelBtn}>
              <Text style={s.cancelTxt}>Annuler</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            onPress={() => navigation.navigate('ForgotPassword')}
            style={s.forgotBtn}
            disabled={isLoading}
          >
            <Text style={s.forgotTxt}>Mot de passe oublié ?</Text>
          </TouchableOpacity>
        </View>
      )}

      <Text style={s.footer}>© 2025 BourseOnline · Données BVC</Text>

      {/* ── WebView ── */}
      {authUrl !== '' && (
        <View
          style={[StyleSheet.absoluteFill, { opacity: overlayShown ? 1 : 0 }]}
          pointerEvents={overlayShown ? 'auto' : 'none'}
        >
          <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
            <View style={wv.bar}>
              <Text style={wv.barTitle}>Connexion sécurisée</Text>
              <TouchableOpacity
                onPress={closeWebView}
                style={wv.closeBtn}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={wv.closeText}>✕ Annuler</Text>
              </TouchableOpacity>
            </View>

            {webError ? (
              <View style={[wv.errorScreen, { backgroundColor: C.bg }]}>
                <View style={wv.errorIcon}>
                  <Text style={{ fontSize: 36 }}>⚠️</Text>
                </View>
                <Text style={[wv.errorTitle, { color: C.txt }]}>
                  {friendlyError(webError).title}
                </Text>
                <View style={{ marginTop: 20, width: '100%' }}>
                  {friendlyError(webError).tips.map((tip, i) => (
                    <View key={i} style={wv.tipRow}>
                      <Text style={{ color: C.gold, marginRight: 8 }}>•</Text>
                      <Text style={[wv.tipText, { color: C.muted }]}>{tip}</Text>
                    </View>
                  ))}
                </View>
                <Pressable
                  onPress={() => {
                    setWebError(null);
                    setWebVisible(false);
                    handledRef.current = false;
                    setReloadKey((k) => k + 1);
                  }}
                  style={({ pressed }) => [wv.retryBtn, { opacity: pressed ? 0.8 : 1 }]}
                >
                  <Text style={wv.retryBtnText}>↻ Réessayer</Text>
                </Pressable>
              </View>
            ) : (
              <View style={{ flex: 1 }}>
                <WebView
                  ref={webviewRef}
                  key={reloadKey}
                  source={{ uri: authUrl }}
                  userAgent="BourseOnlineMobile/1.0 (compatible; WebView)"
                  onShouldStartLoadWithRequest={handleShouldStart}
                  onNavigationStateChange={(nav) => {
                    lastUrlRef.current = nav.url;
                    if (!handledRef.current && nav.url.startsWith(REDIRECT_URI)) {
                      handledRef.current = true;
                      processCallback(nav.url);
                    }
                  }}
                  onLoadEnd={() => {
                    setWebVisible(true);
                    webviewRef.current?.injectJavaScript(FIX_KC_FORMS_SCRIPT);
                  }}
                  onError={(e) => {
                    const failedUrl = e.nativeEvent.url || lastUrlRef.current || '';
                    if (
                      failedUrl.startsWith('http://localhost/mobile-callback') ||
                      failedUrl.startsWith(REDIRECT_URI)
                    ) {
                      return;
                    }
                    setWebError(e.nativeEvent.description || 'Erreur de chargement');
                  }}
                  sharedCookiesEnabled
                  thirdPartyCookiesEnabled
                  javaScriptEnabled
                  domStorageEnabled
                  setSupportMultipleWindows={false}
                  style={{ flex: 1, backgroundColor: '#fff' }}
                  containerStyle={{ backgroundColor: C.bg }}
                />
              </View>
            )}
          </SafeAreaView>
        </View>
      )}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container: {
    flex: 1, backgroundColor: C.bg,
    alignItems: 'center', justifyContent: 'center', padding: 28,
  },
  hero:        { alignItems: 'center', marginBottom: 32 },
  logoCircle:  {
    width: 80, height: 80, borderRadius: 20,
    backgroundColor: C.panel, borderWidth: 1, borderColor: C.line,
    alignItems: 'center', justifyContent: 'center', marginBottom: 16,
  },
  logoIcon:    { fontSize: 40 },
  logoText:    { fontSize: 32, fontWeight: '800', color: C.txt, letterSpacing: -0.5 },
  tagline:     { fontSize: 14, color: C.muted, marginTop: 8, textAlign: 'center' },

  features:    { flexDirection: 'row', gap: 10, marginBottom: 32 },
  featureItem: {
    flex: 1, alignItems: 'center',
    backgroundColor: C.panel, borderRadius: 12, padding: 12,
    borderWidth: 1, borderColor: C.line,
  },
  featureIcon:  { fontSize: 22, marginBottom: 6 },
  featureLabel: { fontSize: 11, color: C.muted, textAlign: 'center', lineHeight: 16 },

  errorBanner: {
    width: '100%', backgroundColor: 'rgba(239,68,68,0.12)',
    borderRadius: 10, borderWidth: 1, borderColor: C.red,
    padding: 12, marginBottom: 16,
  },
  errorText:   { color: C.red, fontSize: 13, textAlign: 'center' },

  // SSO loading
  ssoLoadingBox: {
    width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 10, backgroundColor: C.panel, borderRadius: 12, padding: 16,
    borderWidth: 1, borderColor: C.line, marginBottom: 16,
  },
  ssoLoadingTxt: { color: C.muted, fontSize: 14 },

  // Cas 3 : pas de compte bourse
  noAccountBox: {
    width: '100%', backgroundColor: C.panel, borderRadius: 16,
    borderWidth: 1, borderColor: C.line, padding: 20, marginBottom: 16,
    alignItems: 'center',
  },
  noAccountTitle: { fontSize: 17, fontWeight: '700', color: C.txt, marginBottom: 10, textAlign: 'center' },
  noAccountDesc:  { fontSize: 13, color: C.muted, textAlign: 'center', lineHeight: 20, marginBottom: 20 },

  actions:         { width: '100%', gap: 12 },
  btnPrimary:      { backgroundColor: C.accent, borderRadius: 14, padding: 17, alignItems: 'center', width: '100%' },
  btnPrimaryText:  { fontSize: 16, fontWeight: '700', color: '#000' },
  btnSecondary:    {
    backgroundColor: 'transparent', borderRadius: 14, padding: 17,
    alignItems: 'center', borderWidth: 1.5, borderColor: C.accent, width: '100%',
  },
  btnSecondaryText:{ fontSize: 16, fontWeight: '600', color: C.accent },
  btnDisabled:     { opacity: 0.5 },
  footer:          { marginTop: 28, fontSize: 11, color: '#4a5280' },
  cancelBtn:       { alignItems: 'center', paddingVertical: 8 },
  cancelTxt:       { fontSize: 13, color: C.muted, textDecorationLine: 'underline' },
  forgotBtn:       { alignItems: 'center', paddingVertical: 10 },
  forgotTxt:       { fontSize: 14, color: C.accent },
});

const wv = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line,
    paddingHorizontal: 16, paddingVertical: 12,
  },
  barTitle:  { flex: 1, color: C.txt, fontWeight: '600', fontSize: 14 },
  closeBtn:  { padding: 8 },
  closeText: { color: C.muted, fontSize: 13 },

  errorScreen: {
    flex: 1, alignItems: 'center',
    paddingHorizontal: 24, paddingTop: 48,
  },
  errorIcon: {
    width: 80, height: 80, borderRadius: 40,
    backgroundColor: 'rgba(220,38,38,0.15)',
    alignItems: 'center', justifyContent: 'center', marginBottom: 20,
  },
  errorTitle: { fontSize: 20, fontWeight: '800', textAlign: 'center' },
  tipRow:     { flexDirection: 'row', marginBottom: 10, paddingHorizontal: 8 },
  tipText:    { fontSize: 13, lineHeight: 20, flex: 1 },
  retryBtn: {
    marginTop: 28, width: '100%', paddingVertical: 14,
    borderRadius: 12, backgroundColor: C.gold, alignItems: 'center',
  },
  retryBtnText: { color: C.bg, fontWeight: '700', fontSize: 15 },
});
