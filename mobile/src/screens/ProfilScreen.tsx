// ============================================================================
// screens/ProfilScreen.tsx — Profil utilisateur et déconnexion
// Adapté de app/(tabs)/profil.tsx pour React Navigation
// Remplacement : router.replace expo-router → logout via Zustand (RootNavigator
// bascule automatiquement vers LoginScreen quand status = 'unauthenticated')
// ============================================================================

import React, { useEffect, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useAuth } from '../store/useAuth';
import { decodeJwt } from '../api/auth';

const C = {
  bg: '#070b1c', panel: '#111733', panel2: '#0e1430',
  txt: '#e7ecff', muted: '#8a93b8', line: '#1f2a52',
  accent: '#60a5fa', gold: '#f59e0b', down: '#ef4444', up: '#22c55e',
};

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={row.container}>
      <Text style={row.label}>{label}</Text>
      <Text style={[row.value, mono && row.mono]} numberOfLines={2} selectable>
        {value}
      </Text>
    </View>
  );
}

export function ProfilScreen() {
  const { user, accessToken, logout, status } = useAuth();
  const [claims, setClaims] = useState<Record<string, unknown> | null>(null);

  // Décoder le JWT pour afficher les claims complets
  useEffect(() => {
    if (accessToken) {
      setClaims(decodeJwt(accessToken));
    }
  }, [accessToken]);

  const handleLogout = () => {
    Alert.alert('Déconnexion', 'Voulez-vous vous déconnecter ?', [
      { text: 'Annuler', style: 'cancel' },
      {
        text: 'Déconnecter',
        style: 'destructive',
        onPress: async () => {
          await logout();
          // RootNavigator détecte status='unauthenticated' et affiche LoginScreen
        },
      },
    ]);
  };

  const username = String(claims?.preferred_username ?? user?.name ?? '—');
  const fullName = String(claims?.name ?? user?.name ?? '—');
  const email    = String(claims?.email ?? user?.email ?? '—');

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* En-tête profil */}
      <View style={s.header}>
        <View style={s.avatar}>
          <Text style={s.avatarText}>
            {username !== '—' ? username.charAt(0).toUpperCase() : '?'}
          </Text>
        </View>
        <Text style={s.fullName}>{fullName}</Text>
        <Text style={s.emailText}>{email}</Text>
      </View>

      {/* Carte informations */}
      <View style={s.card}>
        <Text style={s.cardTitle}>Informations du compte</Text>
        <Row label="Nom d'utilisateur" value={username} />
        <Row label="Nom complet"       value={fullName} />
        <Row label="Email"             value={email} />
      </View>


      {/* Statut de connexion */}
      <View style={s.statusCard}>
        <View style={s.statusRow}>
          <View style={[s.statusDot, { backgroundColor: status === 'authenticated' ? C.up : C.down }]} />
          <Text style={s.statusLabel}>
            {status === 'authenticated' ? 'Connecté' : 'Déconnecté'}
          </Text>
        </View>
      </View>

      {/* Bouton déconnexion */}
      <TouchableOpacity style={s.logoutBtn} onPress={handleLogout}>
        <Text style={s.logoutText}>Se déconnecter</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: C.bg },
  header:          { alignItems: 'center', paddingVertical: 32, paddingHorizontal: 16 },
  avatar:          { width: 72, height: 72, borderRadius: 36, backgroundColor: C.accent, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  avatarText:      { fontSize: 30, fontWeight: '700', color: '#fff' },
  fullName:        { fontSize: 20, fontWeight: '700', color: C.txt, marginBottom: 4 },
  emailText:       { fontSize: 13, color: C.muted },
  card:            { marginHorizontal: 16, marginBottom: 12, backgroundColor: C.panel, borderRadius: 14, padding: 16, borderWidth: 1, borderColor: C.line },
  cardTitle:       { fontSize: 12, fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 12 },
  statusCard:      { marginHorizontal: 16, marginBottom: 12, backgroundColor: C.panel2, borderRadius: 12, padding: 14, borderWidth: 1, borderColor: C.line },
  statusRow:       { flexDirection: 'row', alignItems: 'center' },
  statusDot:       { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  statusLabel:     { fontSize: 13, color: C.txt, fontWeight: '500' },
  logoutBtn:       { margin: 16, padding: 16, borderRadius: 12, borderWidth: 1.5, borderColor: C.down, alignItems: 'center', backgroundColor: 'rgba(239,68,68,0.08)' },
  logoutText:      { color: C.down, fontSize: 15, fontWeight: '700' },
});

const row = StyleSheet.create({
  container: { paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  label:     { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  value:     { fontSize: 14, color: C.txt },
  mono:      { fontSize: 11, color: C.muted, fontFamily: 'monospace' },
});
