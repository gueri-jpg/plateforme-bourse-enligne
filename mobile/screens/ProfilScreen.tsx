import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { getValidAccessToken, decodeJwt, logout } from '../services/auth';

export default function ProfilScreen({ navigation }: any) {
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    getValidAccessToken().then(t => { if (t) setClaims(decodeJwt(t)); });
  }, []);

  const handleLogout = () => {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: async () => {
        await logout();
        navigation.replace('Login');
      }},
    ]);
  };

  const roles: string[] = (claims?.realm_access as any)?.roles ?? [];

  return (
    <ScrollView style={s.container} contentContainerStyle={s.content}>
      <View style={s.card}>
        <Text style={s.title}>Mon profil</Text>
        <Row label="Nom d'utilisateur" value={String(claims?.preferred_username ?? '—')} />
        <Row label="Nom complet"       value={String(claims?.name ?? '—')} />
        <Row label="Email"             value={String(claims?.email ?? '—')} />
        <Row label="Rôles"             value={roles.join(', ') || '(aucun)'} />
        <Row label="Realm Keycloak"    value="bourse-en-ligne" />
      </View>

      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>🚪 Se déconnecter</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={r.row}>
      <Text style={r.label}>{label}</Text>
      <Text style={r.value} numberOfLines={2}>{value}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#070b1c' },
  content:   { padding: 16 },
  card:      { backgroundColor: '#111733', borderRadius: 14, padding: 20, borderWidth: 1, borderColor: '#1f2a52', marginBottom: 16 },
  title:     { fontSize: 16, fontWeight: '600', color: '#e7ecff', marginBottom: 14 },
  logoutBtn: { borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#ef4444' },
  logoutText:{ color: '#ef4444', fontSize: 14, fontWeight: '600' },
});

const r = StyleSheet.create({
  row:   { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f2a52' },
  label: { fontSize: 11, color: '#8a93b8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  value: { fontSize: 14, color: '#e7ecff' },
});