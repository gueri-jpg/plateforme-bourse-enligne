/**
 * login.tsx — Authentification OAuth2 PKCE via WebView in-app
 *
 * L'écran de login embarque Keycloak dans une WebView React Native.
 * Aucun navigateur externe / popup système n'est ouvert.
 *
 * Flow :
 *  1. Générer code_verifier (aléatoire) + code_challenge (SHA-256 pur JS)
 *  2. Ouvrir WebView → URL auth Keycloak avec params PKCE
 *  3. Intercepter le redirect bourseenligne://callback?code=...
 *  4. Échanger le code contre tokens via fetch() POST
 *  5. Stocker tokens + naviguer vers l'app
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { WebView, WebViewNavigation } from 'react-native-webview';
import { router, useLocalSearchParams } from 'expo-router';
import { CONFIG, KEYCLOAK_DISCOVERY, SECURE_KEYS } from '../../constants/config';
import { saveTokens, decodeJwt } from '../../services/auth';
import { setUserId } from '../../services/trading';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ── SHA-256 pur JS (pas de crypto.subtle requis) ─────────────────────────────

function base64UrlEncode(buf: Uint8Array): string {
  let binaire = '';
  for (const b of buf) binaire += String.fromCharCode(b);
  return btoa(binaire).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sha256(data: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
    0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
    0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
    0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
    0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
    0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
    0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
    0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
  ];
  let h = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  const ml = data.length * 8;
  const padded = new Uint8Array(Math.ceil((data.length + 9) / 64) * 64);
  padded.set(data); padded[data.length] = 0x80;
  const dv0 = new DataView(padded.buffer);
  dv0.setUint32(padded.length - 4, ml >>> 0, false);
  for (let i = 0; i < padded.length; i += 64) {
    const w = new Array(64);
    const dv = new DataView(padded.buffer, i, 64);
    for (let j = 0; j < 16; j++) w[j] = dv.getUint32(j * 4, false);
    for (let j = 16; j < 64; j++) {
      const s0 = (w[j-15]>>>7|w[j-15]<<25)^(w[j-15]>>>18|w[j-15]<<14)^(w[j-15]>>>3);
      const s1 = (w[j-2]>>>17|w[j-2]<<15)^(w[j-2]>>>19|w[j-2]<<13)^(w[j-2]>>>10);
      w[j] = (w[j-16]+s0+w[j-7]+s1)>>>0;
    }
    let [a,b,c,d,e,f,g,hh] = h;
    for (let j = 0; j < 64; j++) {
      const S1 = (e>>>6|e<<26)^(e>>>11|e<<21)^(e>>>25|e<<7);
      const ch = (e&f)^(~e&g);
      const t1 = (hh+S1+ch+K[j]+w[j])>>>0;
      const S0 = (a>>>2|a<<30)^(a>>>13|a<<19)^(a>>>22|a<<10);
      const maj = (a&b)^(a&c)^(b&c);
      const t2 = (S0+maj)>>>0;
      hh=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;
    }
    h = h.map((v,i) => (v+[a,b,c,d,e,f,g,hh][i])>>>0);
  }
  const result = new Uint8Array(32);
  h.forEach((v,i) => new DataView(result.buffer).setUint32(i*4,v,false));
  return result;
}

function generateCodeVerifier(): string {
  const arr = new Uint8Array(32);
  global.crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
}

function generateCodeChallenge(verifier: string): string {
  const encoder = new TextEncoder();
  return base64UrlEncode(sha256(encoder.encode(verifier)));
}

function generateState(): string {
  const arr = new Uint8Array(16);
  global.crypto.getRandomValues(arr);
  return base64UrlEncode(arr);
}

// ── Constantes ────────────────────────────────────────────────────────────────

const REDIRECT_URI = 'bourseenligne://callback';

// ── Composant ─────────────────────────────────────────────────────────────────

export default function LoginScreen() {
  const { sso_token } = useLocalSearchParams<{ sso_token?: string }>();

  const [showWebView, setShowWebView] = useState(false);
  const [loading,     setLoading]     = useState(false);
  const [webLoading,  setWebLoading]  = useState(true);

  const codeVerifier = useRef('');
  const state        = useRef('');
  const authUrl      = useRef('');

  const startLogin = useCallback((opts?: { loginHint?: string; idpHint?: string }) => {
    const verifier   = generateCodeVerifier();
    const challenge  = generateCodeChallenge(verifier);
    const stateVal   = generateState();

    codeVerifier.current = verifier;
    state.current        = stateVal;

    const params = new URLSearchParams({
      client_id:             CONFIG.KEYCLOAK_CLIENT_ID,
      response_type:         'code',
      redirect_uri:          REDIRECT_URI,
      scope:                 'openid profile email',
      code_challenge:        challenge,
      code_challenge_method: 'S256',
      state:                 stateVal,
    });
    if (opts?.loginHint) params.append('login_hint', opts.loginHint);
    if (opts?.idpHint)   params.append('kc_idp_hint', opts.idpHint);

    authUrl.current = `${KEYCLOAK_DISCOVERY.authorizationEndpoint}?${params.toString()}`;
    setWebLoading(true);
    setShowWebView(true);
  }, []);

  // Démarrage automatique SSO si l'app a reçu un deep link bourseenligne://sso?t=xxx
  useEffect(() => {
    if (!sso_token) return;
    const banqueApi = CONFIG.BANQUE_DASHBOARD_URL; // ex: https://banquedigitale.cfconsultancy.org
    fetch(`${banqueApi}/bourse/sso-exchange?token=${encodeURIComponent(sso_token)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(({ email }: { email: string }) => {
        startLogin({ loginHint: email, idpHint: 'cfc-banque' });
      })
      .catch(() => {
        // Token expiré ou invalide → connexion manuelle
        startLogin();
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sso_token]);

  const handleNavigationChange = useCallback(async (navState: WebViewNavigation) => {
    const url = navState.url;
    if (!url.startsWith(REDIRECT_URI)) return;

    setShowWebView(false);
    setLoading(true);

    try {
      const urlObj = new URL(url);
      const code   = urlObj.searchParams.get('code');
      const retState = urlObj.searchParams.get('state');

      if (!code) throw new Error('Pas de code dans le callback');
      if (retState !== state.current) throw new Error('State CSRF invalide');

      // Échange code → tokens
      const resp = await fetch(KEYCLOAK_DISCOVERY.tokenEndpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     CONFIG.KEYCLOAK_CLIENT_ID,
          code,
          redirect_uri:  REDIRECT_URI,
          code_verifier: codeVerifier.current,
        }).toString(),
      });

      if (!resp.ok) {
        const err = await resp.text();
        throw new Error(`Token error ${resp.status}: ${err}`);
      }

      const tokens = await resp.json();
      await saveTokens(tokens);

      const claims = decodeJwt(tokens.access_token);
      if (claims?.sub) {
        await AsyncStorage.setItem(SECURE_KEYS.USER_SUB, String(claims.sub));
        setUserId(String(claims.sub));
      }

      router.replace('/(tabs)/marche');
    } catch (e) {
      Alert.alert('Erreur de connexion', String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── WebView in-app ───────────────────────────────────────────────────────────

  if (showWebView) {
    return (
      <SafeAreaView style={{ flex: 1, backgroundColor: '#070b1c' }}>
        {/* Barre de fermeture */}
        <View style={wv.bar}>
          <Text style={wv.barTitle}>Connexion sécurisée</Text>
          <TouchableOpacity onPress={() => setShowWebView(false)} style={wv.closeBtn}>
            <Text style={wv.closeText}>✕ Annuler</Text>
          </TouchableOpacity>
        </View>

        {webLoading && (
          <View style={wv.loadOverlay}>
            <ActivityIndicator size="large" color="#60a5fa" />
            <Text style={wv.loadText}>Chargement de Keycloak…</Text>
          </View>
        )}

        <WebView
          source={{ uri: authUrl.current }}
          // Interception prioritaire : bloque la navigation vers le custom scheme
          // et traite le code directement (Android + iOS)
          onShouldStartLoadWithRequest={req => {
            if (req.url.startsWith(REDIRECT_URI)) {
              handleNavigationChange({ url: req.url } as WebViewNavigation);
              return false; // bloque la WebView, on gère nous-mêmes
            }
            return true;
          }}
          // Fallback iOS (ASWebAuthenticationSession peut déclencher ceci)
          onNavigationStateChange={nav => {
            if (nav.url.startsWith(REDIRECT_URI)) {
              handleNavigationChange(nav);
            }
          }}
          onLoadStart={() => setWebLoading(true)}
          onLoadEnd={() => setWebLoading(false)}
          onError={() => {
            setShowWebView(false);
            Alert.alert('Erreur', 'Impossible de charger Keycloak. Vérifiez votre connexion réseau et l\'IP dans config.ts.');
          }}
          style={{ flex: 1, opacity: webLoading ? 0 : 1 }}
          setSupportMultipleWindows={false}
          javaScriptEnabled
          domStorageEnabled
        />
      </SafeAreaView>
    );
  }

  // ── Écran d'accueil ──────────────────────────────────────────────────────────

  return (
    <View style={s.container}>
      <View style={s.logo}>
        <Text style={s.logoIcon}>📈</Text>
        <Text style={s.logoText}>BourseOnline</Text>
        <Text style={s.subtitle}>Plateforme de trading BVC</Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>🔐 Connexion</Text>
        <Text style={s.cardDesc}>
          Authentification OAuth2 PKCE via Keycloak.{'\n'}
          Realm : <Text style={{ color: '#60a5fa' }}>bourse-en-ligne</Text>
        </Text>

        <TouchableOpacity
          style={[s.btnLogin, loading && s.btnDisabled]}
          onPress={() => startLogin()}
          disabled={loading}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={s.btnText}>Se connecter</Text>
          }
        </TouchableOpacity>

        <Text style={s.secureNote}>🔒 Connexion chiffrée · OAuth2 PKCE</Text>
      </View>

      <Text style={s.footer}>Données BVC · Usage pédagogique uniquement</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#070b1c', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo:       { alignItems: 'center', marginBottom: 40 },
  logoIcon:   { fontSize: 52, marginBottom: 8 },
  logoText:   { fontSize: 28, fontWeight: '700', color: '#e7ecff' },
  subtitle:   { fontSize: 14, color: '#8a93b8', marginTop: 6 },
  card:       { width: '100%', backgroundColor: '#111733', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#1f2a52' },
  cardTitle:  { fontSize: 18, fontWeight: '600', color: '#e7ecff', marginBottom: 8 },
  cardDesc:   { fontSize: 13, color: '#8a93b8', lineHeight: 20, marginBottom: 24 },
  btnLogin:   { backgroundColor: '#f59e0b', borderRadius: 12, padding: 16, alignItems: 'center' },
  btnDisabled:{ opacity: 0.5 },
  btnText:    { fontSize: 16, fontWeight: '700', color: '#000' },
  secureNote: { marginTop: 20, fontSize: 12, color: '#4a5280', textAlign: 'center' },
  footer:     { marginTop: 32, fontSize: 11, color: '#4a5280' },
});

const wv = StyleSheet.create({
  bar:         { flexDirection: 'row', alignItems: 'center', backgroundColor: '#111733', borderBottomWidth: 1, borderBottomColor: '#1f2a52', paddingHorizontal: 16, paddingVertical: 12 },
  barTitle:    { flex: 1, color: '#e7ecff', fontWeight: '600', fontSize: 15 },
  closeBtn:    { padding: 8 },
  closeText:   { color: '#8a93b8', fontSize: 13 },
  loadOverlay: { position: 'absolute', top: 60, left: 0, right: 0, bottom: 0, zIndex: 10, backgroundColor: '#070b1c', justifyContent: 'center', alignItems: 'center' },
  loadText:    { color: '#8a93b8', marginTop: 16, fontSize: 13 },
});
