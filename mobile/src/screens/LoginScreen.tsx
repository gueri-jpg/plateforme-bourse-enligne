import React, { useRef, useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { StatusBar } from 'expo-status-bar';

import { buildPkceAuthUrl, buildPkceRegisterUrl, exchangeCodeForTokens, REDIRECT_URI } from '../api/auth';
import { useAuth } from '../store/useAuth';
import { CONFIG } from '../../constants/config';

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
};

// ── URL rewriting ─────────────────────────────────────────────────────────────
// Keycloak with KC_HOSTNAME=http://localhost:9090 may issue internal redirects
// through localhost:9090 before reaching our callback. The phone can't reach
// localhost, so we intercept those navigations and rewrite the host to the
// real LAN IP.
const KC_LOCAL = 'http://localhost:9090';
const KC_REAL  = CONFIG.KEYCLOAK_BASE_URL.replace(/\/$/, ''); // e.g. http://172.20.10.5:9090

// ── FIX_KC_FORMS_SCRIPT ───────────────────────────────────────────────────────
// Rewrites Keycloak form actions that point to KC_LOCAL → KC_REAL.
// Injected after every page load inside the WebView.
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

// ── Error categorisation (friendly messages for the user) ─────────────────────
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

// ─────────────────────────────────────────────────────────────────────────────
export function LoginScreen() {
  const setTokens = useAuth((s) => s.setTokens);

  const [showWebView, setShowWebView] = useState(false);
  const [webLoading,  setWebLoading]  = useState(true);
  const [exchanging,  setExchanging]  = useState(false);
  const [errorMsg,    setErrorMsg]    = useState<string | null>(null);
  const [webError,    setWebError]    = useState<string | null>(null);
  const [reloadKey,   setReloadKey]   = useState(0);
  const [loading,     setLoading]     = useState(false);

  const codeVerifierRef = useRef('');
  const stateRef        = useRef('');
  const authUrlRef      = useRef('');
  const handledRef      = useRef(false);
  const lastUrlRef      = useRef('');
  const webviewRef      = useRef<WebView>(null);

  // ── Démarrer le flow PKCE ─────────────────────────────────────────────────
  const openWebView = useCallback((builder: () => { url: string; codeVerifier: string; state: string }) => {
    setLoading(true);
    try {
      const { url, codeVerifier, state } = builder();
      codeVerifierRef.current = codeVerifier;
      stateRef.current        = state;
      authUrlRef.current      = url;
      handledRef.current      = false;
      setWebError(null);
      setErrorMsg(null);
      setWebLoading(true);
      setExchanging(false);
      setShowWebView(true);
    } catch (e) {
      setErrorMsg('Impossible de démarrer la connexion : ' + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const startLogin    = useCallback(() => openWebView(buildPkceAuthUrl),    [openWebView]);
  const startRegister = useCallback(() => openWebView(buildPkceRegisterUrl), [openWebView]);

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

    if (params.error) {
      setExchanging(false);
      setShowWebView(false);
      handledRef.current = false;
      setErrorMsg(`Erreur d'authentification. Réessayez.`);
      return;
    }

    const code = params.code;
    if (!code) {
      setExchanging(false);
      setShowWebView(false);
      handledRef.current = false;
      setErrorMsg('Erreur d\'authentification. Réessayez.');
      return;
    }

    if (params.state && params.state !== stateRef.current) {
      setExchanging(false);
      setShowWebView(false);
      handledRef.current = false;
      setErrorMsg('Erreur de sécurité (state CSRF). Réessayez.');
      return;
    }

    exchangeCodeForTokens(code, codeVerifierRef.current)
      .then(async (tokens) => {
        await setTokens(tokens);
        // RootNavigator bascule vers MainTabs — WebView unmounted automatiquement
      })
      .catch((e: unknown) => {
        setExchanging(false);
        setShowWebView(false);
        handledRef.current = false;
        setErrorMsg(`Échec connexion : ${e instanceof Error ? e.message : String(e)}`);
      });
  }, [setTokens]);

  // ── Intercepteur de navigation WebView ───────────────────────────────────
  // Deux rôles :
  //  1) Réécrire http://localhost:9090 → KC_REAL (redirects internes Keycloak)
  //  2) Intercepter http://localhost/mobile-callback → extraire code
  const handleShouldStart = useCallback((req: WebViewNavigation): boolean => {
    if (handledRef.current) return false;

    // 1) Redirect interne Keycloak via localhost:9090
    if (req.url.startsWith(KC_LOCAL)) {
      const rewritten = req.url.replace(KC_LOCAL, KC_REAL);
      const safe = rewritten.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
      webviewRef.current?.injectJavaScript(`window.location.replace('${safe}'); true;`);
      return false;
    }

    // 2) Notre callback PKCE
    if (req.url.startsWith(REDIRECT_URI)) {
      handledRef.current = true;
      setExchanging(true);
      processCallback(req.url);
      return false;
    }

    return true;
  }, [processCallback]);

  // ── Rendu : WebView Keycloak ──────────────────────────────────────────────
  if (showWebView) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: C.bg }} edges={['top']}>
        <StatusBar style="light" />

        <View style={wv.bar}>
          <Text style={wv.barTitle}>Connexion sécurisée</Text>
          <TouchableOpacity
            onPress={() => {
              setShowWebView(false);
              setExchanging(false);
              setWebError(null);
              handledRef.current = false;
            }}
            style={wv.closeBtn}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          >
            <Text style={wv.closeText}>✕ Annuler</Text>
          </TouchableOpacity>
        </View>

        {webError ? (
          // ── Erreur de chargement Keycloak ───────────────────────────────
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
                setWebLoading(true);
                handledRef.current = false;
                setReloadKey((k) => k + 1);
              }}
              style={({ pressed }) => [wv.retryBtn, { opacity: pressed ? 0.8 : 1 }]}
            >
              <Text style={wv.retryBtnText}>↻ Réessayer</Text>
            </Pressable>
          </View>
        ) : (
          // ── WebView + overlays ───────────────────────────────────────────
          <View style={{ flex: 1 }}>
            <WebView
              ref={webviewRef}
              key={reloadKey}
              source={{ uri: authUrlRef.current }}
              userAgent="BourseOnlineMobile/1.0 (compatible; WebView)"
              onShouldStartLoadWithRequest={handleShouldStart}
              onNavigationStateChange={(nav) => {
                lastUrlRef.current = nav.url;
                // Backup : si onShouldStartLoadWithRequest n'a pas intercepté
                // le callback (cas rare sur iOS avec HTTP 302 server-side),
                // on l'intercepte ici avant que onError ne s'affiche.
                if (!handledRef.current && nav.url.startsWith(REDIRECT_URI)) {
                  handledRef.current = true;
                  setExchanging(true);
                  processCallback(nav.url);
                }
              }}
              onLoadStart={() => setWebLoading(true)}
              onLoadEnd={() => {
                setWebLoading(false);
                // Réécrire les form actions pointant vers localhost:9090
                webviewRef.current?.injectJavaScript(FIX_KC_FORMS_SCRIPT);
              }}
              onError={(e) => {
                setWebLoading(false);
                // Ignorer les erreurs de connexion vers localhost (notre redirect URI)
                const failedUrl = e.nativeEvent.url || lastUrlRef.current || '';
                if (
                  failedUrl.startsWith('http://localhost/mobile-callback') ||
                  failedUrl.startsWith(REDIRECT_URI)
                ) {
                  return; // Ignoré — la navigation vers localhost échoue intentionnellement
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

            {webLoading && !exchanging && (
              <View style={wv.loaderOverlay}>
                <ActivityIndicator color={C.gold} size="large" />
                <Text style={wv.loaderText}>Chargement…</Text>
              </View>
            )}

            {exchanging && (
              <View style={wv.exchangeOverlay}>
                <ActivityIndicator color={C.gold} size="large" />
                <Text style={wv.exchangeTitle}>Connexion en cours…</Text>
                <Text style={wv.exchangeSub}>Vérification de vos identifiants</Text>
              </View>
            )}
          </View>
        )}
      </SafeAreaView>
    );
  }

  // ── Rendu : écran d'accueil ───────────────────────────────────────────────
  return (
    <View style={s.container}>
      <StatusBar style="light" />

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

      <View style={s.actions}>
        <TouchableOpacity
          style={[s.btnPrimary, loading && s.btnDisabled]}
          onPress={startLogin}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#000" size="small" />
            : <Text style={s.btnPrimaryText}>Se connecter</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity
          style={s.btnSecondary}
          onPress={startRegister}
          activeOpacity={0.85}
        >
          <Text style={s.btnSecondaryText}>Ouvrir un compte</Text>
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>© 2025 BourseOnline · Données BVC</Text>
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

  actions:         { width: '100%', gap: 12 },
  btnPrimary:      { backgroundColor: C.accent, borderRadius: 14, padding: 17, alignItems: 'center' },
  btnPrimaryText:  { fontSize: 16, fontWeight: '700', color: '#000' },
  btnSecondary:    {
    backgroundColor: 'transparent', borderRadius: 14, padding: 17,
    alignItems: 'center', borderWidth: 1.5, borderColor: C.accent,
  },
  btnSecondaryText:{ fontSize: 16, fontWeight: '600', color: C.accent },
  btnDisabled:     { opacity: 0.5 },
  footer:          { marginTop: 28, fontSize: 11, color: '#4a5280' },
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

  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7,11,28,0.9)',
    alignItems: 'center', justifyContent: 'center',
  },
  loaderText: { color: C.muted, marginTop: 14, fontSize: 13 },

  exchangeOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(7,11,28,0.95)',
    alignItems: 'center', justifyContent: 'center',
  },
  exchangeTitle: { fontSize: 18, fontWeight: '600', color: C.txt, marginTop: 20 },
  exchangeSub:   { fontSize: 13, color: C.muted, marginTop: 8 },

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
