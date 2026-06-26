import { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { router } from 'expo-router';
import { CONFIG, KEYCLOAK_DISCOVERY, SECURE_KEYS } from '../../constants/config';
import { saveTokens, decodeJwt } from '../../services/auth';
import * as SecureStore from 'expo-secure-store';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [loading, setLoading] = useState(false);

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'bourseenligne' });

  const [request, response, promptAsync] = AuthSession.useAuthRequest(
    {
      clientId:            CONFIG.KEYCLOAK_CLIENT_ID,
      redirectUri,
      scopes:              ['openid', 'profile', 'email'],
      responseType:        AuthSession.ResponseType.Code,
      usePKCE:             true,
    },
    KEYCLOAK_DISCOVERY
  );

  // Traiter la réponse Keycloak
  const handleLogin = async () => {
    setLoading(true);
    try {
      const result = await promptAsync();
      if (result.type !== 'success') {
        setLoading(false);
        return;
      }

      // Échange code → tokens
      const resp = await fetch(KEYCLOAK_DISCOVERY.tokenEndpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type:    'authorization_code',
          client_id:     CONFIG.KEYCLOAK_CLIENT_ID,
          code:          result.params.code,
          redirect_uri:  redirectUri,
          code_verifier: request!.codeVerifier!,
        }).toString(),
      });

      if (!resp.ok) throw new Error(`Keycloak erreur ${resp.status}`);
      const tokens = await resp.json();
      await saveTokens(tokens);

      // Stocker le sub pour isoler les données
      const claims = decodeJwt(tokens.access_token);
      if (claims?.sub) await SecureStore.setItemAsync(SECURE_KEYS.USER_SUB, String(claims.sub));

      router.replace('/(tabs)/marche');
    } catch (e) {
      Alert.alert('Erreur de connexion', String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logo}>
        <Text style={styles.logoText}>📈 BourseOnline</Text>
        <Text style={styles.subtitle}>Plateforme de trading BVC</Text>
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>Connexion</Text>
        <Text style={styles.cardDesc}>
          Authentification sécurisée via Keycloak{'\n'}
          (OAuth2 PKCE — realm bourse-en-ligne)
        </Text>

        <TouchableOpacity
          style={[styles.btnLogin, (!request || loading) && styles.btnDisabled]}
          onPress={handleLogin}
          disabled={!request || loading}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={styles.btnText}>🔑 Se connecter</Text>
          }
        </TouchableOpacity>

        <Text style={styles.hint}>
          investisseur1 / Investisseur123!{'\n'}
          support1 / Support123!
        </Text>
      </View>

      <Text style={styles.footer}>Données BVC · Usage pédagogique</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#070b1c', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo:       { alignItems: 'center', marginBottom: 40 },
  logoText:   { fontSize: 28, fontWeight: '700', color: '#e7ecff' },
  subtitle:   { fontSize: 14, color: '#8a93b8', marginTop: 6 },
  card:       { width: '100%', backgroundColor: '#111733', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#1f2a52' },
  cardTitle:  { fontSize: 18, fontWeight: '600', color: '#e7ecff', marginBottom: 8 },
  cardDesc:   { fontSize: 13, color: '#8a93b8', lineHeight: 20, marginBottom: 24 },
  btnLogin:   { backgroundColor: '#f59e0b', borderRadius: 12, padding: 15, alignItems: 'center' },
  btnDisabled:{ opacity: 0.5 },
  btnText:    { fontSize: 15, fontWeight: '700', color: '#000' },
  hint:       { marginTop: 16, fontSize: 11, color: '#4a5280', textAlign: 'center', lineHeight: 18 },
  footer:     { marginTop: 32, fontSize: 11, color: '#4a5280' },
});