import React, { useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import { CONFIG, KEYCLOAK_DISCOVERY, SECURE_KEYS } from '../constants/config';
import { saveTokens, decodeJwt } from '../services/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';

WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen({ navigation }: any) {
  const [loading, setLoading] = useState(false);

  const redirectUri = AuthSession.makeRedirectUri({ scheme: 'bourseenligne' });

  const [request, , promptAsync] = AuthSession.useAuthRequest(
    {
      clientId:     CONFIG.KEYCLOAK_CLIENT_ID,
      redirectUri,
      scopes:       ['openid', 'profile', 'email'],
      responseType: AuthSession.ResponseType.Code,
      usePKCE:      true,
    },
    KEYCLOAK_DISCOVERY
  );

  const handleLogin = async () => {
    setLoading(true);
    try {
      const result = await promptAsync();
      if (result.type !== 'success') { setLoading(false); return; }

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

      if (!resp.ok) throw new Error(`Erreur Keycloak ${resp.status}`);
      const tokens = await resp.json();
      await saveTokens(tokens);

      const claims = decodeJwt(tokens.access_token);
      if (claims?.sub) await AsyncStorage.setItem(SECURE_KEYS.USER_SUB, String(claims.sub));

      navigation.replace('Main');
    } catch (e: any) {
      Alert.alert('Erreur de connexion', e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={s.container}>
      <View style={s.logo}>
        <Text style={s.logoEmoji}>📈</Text>
        <Text style={s.logoText}>BourseOnline</Text>
        <Text style={s.subtitle}>Plateforme de trading BVC</Text>
      </View>

      <View style={s.card}>
        <Text style={s.cardTitle}>Connexion</Text>
        
        
        <TouchableOpacity
          style={[s.btn, (!request || loading) && s.btnDisabled]}
          onPress={handleLogin}
          disabled={!request || loading}
        >
          {loading
            ? <ActivityIndicator color="#000" />
            : <Text style={s.btnText}>🔑 Se connecter </Text>
          }
        </TouchableOpacity>
      </View>

      <Text style={s.footer}>© 2024 BourseOnline. Tous droits réservés.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070b1c', alignItems: 'center', justifyContent: 'center', padding: 24 },
  logo:      { alignItems: 'center', marginBottom: 36 },
  logoEmoji: { fontSize: 48, marginBottom: 8 },
  logoText:  { fontSize: 28, fontWeight: '700', color: '#e7ecff' },
  subtitle:  { fontSize: 14, color: '#8a93b8', marginTop: 4 },
  card:      { width: '100%', backgroundColor: '#111733', borderRadius: 16, padding: 24, borderWidth: 1, borderColor: '#1f2a52' },
  cardTitle: { fontSize: 18, fontWeight: '600', color: '#e7ecff', marginBottom: 8 },
  cardDesc:  { fontSize: 13, color: '#8a93b8', lineHeight: 20, marginBottom: 16 },
  hint:      { backgroundColor: '#0e1430', borderRadius: 10, padding: 12, marginBottom: 20 },
  hintText:  { fontSize: 12, color: '#60a5fa', fontFamily: 'monospace', marginBottom: 2 },
  btn:       { backgroundColor: '#f59e0b', borderRadius: 12, padding: 15, alignItems: 'center' },
  btnDisabled: { opacity: 0.5 },
  btnText:   { fontSize: 15, fontWeight: '700', color: '#000' },
  footer:    { marginTop: 32, fontSize: 11, color: '#4a5280' },
});