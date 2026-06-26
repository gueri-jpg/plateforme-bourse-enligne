import { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getValidAccessToken, decodeJwt, logout } from '../../services/auth';
import { router } from 'expo-router';

export default function ProfilScreen() {
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);

  useEffect(() => {
    getValidAccessToken().then(t => {
      if (t) setClaims(decodeJwt(t));
    });
  }, []);

  const handleLogout = () => {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Déconnecter', style: 'destructive', onPress: async () => {
        await logout();
        router.replace('/(auth)/login');
      }},
    ]);
  };

  const roles: string[] = (claims?.realm_access as any)?.roles ?? [];

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Mon profil</Text>

        <Row label="Nom d'utilisateur" value={String(claims?.preferred_username ?? '—')} />
        <Row label="Nom complet"       value={String(claims?.name ?? '—')} />
        <Row label="Email"             value={String(claims?.email ?? '—')} />
        <Row label="Rôles"             value={roles.join(', ') || '(aucun)'} />
        <Row label="Realm Keycloak"    value="bourse-en-ligne" />
        <Row label="Sub"               value={String(claims?.sub ?? '—')} mono />
      </View>

      <TouchableOpacity style={styles.logoutBtn} onPress={handleLogout}>
        <Text style={styles.logoutText}>🚪 Se déconnecter</Text>
      </TouchableOpacity>
    </View>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={rowStyles.row}>
      <Text style={rowStyles.label}>{label}</Text>
      <Text style={[rowStyles.value, mono && rowStyles.mono]} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1, backgroundColor: '#070b1c', padding: 16 },
  card:       { backgroundColor: '#111733', borderRadius: 14, padding: 20, borderWidth: 1, borderColor: '#1f2a52', marginBottom: 16 },
  title:      { fontSize: 16, fontWeight: '600', color: '#e7ecff', marginBottom: 16 },
  logoutBtn:  { backgroundColor: '#111733', borderRadius: 12, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: '#ef4444' },
  logoutText: { color: '#ef4444', fontSize: 14, fontWeight: '600' },
});

const rowStyles = StyleSheet.create({
  row:   { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#1f2a52' },
  label: { fontSize: 11, color: '#8a93b8', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  value: { fontSize: 14, color: '#e7ecff' },
  mono:  { fontSize: 11, color: '#8a93b8' },
});