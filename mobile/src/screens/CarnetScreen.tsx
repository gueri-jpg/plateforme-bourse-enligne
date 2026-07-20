// ============================================================================
// screens/CarnetScreen.tsx — Carnet d'ordres (backend réel)
// ============================================================================

import React, { useState, useCallback } from 'react';
import {
  View, Text, FlatList, StyleSheet, TouchableOpacity,
  Alert, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  fetchOrdres, cancelOrdre,
  OrdreBackend, StatutOrdre,
  STATUT_ORDRE_LABELS,
} from '../api/portfolio';

const C = {
  bg: '#f8fafc', panel: '#ffffff', panel2: '#f1f5f9',
  txt: '#0f172a', muted: '#64748b', line: '#e2e8f0',
  up: '#16a34a', down: '#dc2626', accent: '#7B1D3A', gold: '#f59e0b', flat: '#9ca3af',
};

function fmtN(x: number | null | undefined, dp = 2) {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return (
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  );
}

const STATUS_COLORS: Record<StatutOrdre, string> = {
  en_attente: C.gold,
  execute:    C.up,
  annule:     C.flat,
};

type FilterKey = StatutOrdre | 'all';

const FILTERS: Array<{ key: FilterKey; label: string }> = [
  { key: 'all',        label: 'Tous' },
  { key: 'en_attente', label: 'En attente' },
  { key: 'execute',    label: 'Exécutés' },
  { key: 'annule',     label: 'Annulés' },
];

export function CarnetScreen() {
  const [ordres, setOrdres]   = useState<OrdreBackend[]>([]);
  const [filter, setFilter]   = useState<FilterKey>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchOrdres();
      setOrdres(data.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
    } catch (e: any) {
      setError(e.message ?? 'Impossible de charger les ordres');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const displayed = filter === 'all'
    ? ordres
    : ordres.filter(o => o.statut === filter);

  const handleCancel = (ordre: OrdreBackend) => {
    Alert.alert(
      "Annuler l'ordre",
      `Annuler l'ordre ${ordre.sens} de ${ordre.quantite}× ${ordre.nom || ordre.instrument} ?`,
      [
        { text: 'Non', style: 'cancel' },
        {
          text: 'Oui, annuler',
          style: 'destructive',
          onPress: async () => {
            setCancelling(ordre.id);
            try {
              await cancelOrdre(ordre.id);
              await load();
            } catch (e: any) {
              Alert.alert('Erreur', e.response?.data?.detail ?? 'Impossible d\'annuler cet ordre');
            } finally {
              setCancelling(null);
            }
          },
        },
      ]
    );
  };

  const renderOrdre = ({ item }: { item: OrdreBackend }) => {
    const color = STATUS_COLORS[item.statut];
    const label = STATUT_ORDRE_LABELS[item.statut];
    const isCancelling = cancelling === item.id;
    const prixExec = item.prix_execution ?? item.prix_limite;

    return (
      <View style={s.card}>
        {/* En-tête */}
        <View style={s.cardHeader}>
          <View style={{ flex: 1 }}>
            <Text style={s.cardName}>{item.nom || item.instrument}</Text>
            <Text style={s.cardCode}>{item.instrument}</Text>
          </View>
          <View style={[s.badge, { backgroundColor: `${color}20`, borderColor: `${color}50` }]}>
            <Text style={[s.badgeTxt, { color }]}>{label}</Text>
          </View>
        </View>

        {/* Corps */}
        <View style={s.cardBody}>
          <View style={s.cardRow}>
            <Text style={s.cardLabel}>Sens</Text>
            <Text style={[s.cardVal, {
              color: item.sens === 'achat' ? C.up : C.down, fontWeight: '600',
            }]}>
              {item.sens === 'achat' ? '▲ Achat' : '▼ Vente'}
            </Text>
          </View>
          <View style={s.cardRow}>
            <Text style={s.cardLabel}>Type</Text>
            <Text style={s.cardVal}>{item.type === 'marche' ? 'Au marché' : 'Limité'}</Text>
          </View>
          <View style={s.cardRow}>
            <Text style={s.cardLabel}>Quantité</Text>
            <Text style={s.cardVal}>{item.quantite} titre(s)</Text>
          </View>
          {item.statut === 'execute' && item.quantite_executee > 0 && (
            <View style={s.cardRow}>
              <Text style={s.cardLabel}>Qté exécutée</Text>
              <Text style={[s.cardVal, { color: C.up }]}>{item.quantite_executee} titre(s)</Text>
            </View>
          )}
          {prixExec !== null && (
            <View style={s.cardRow}>
              <Text style={s.cardLabel}>Prix</Text>
              <Text style={s.cardVal}>{fmtN(prixExec)} MAD</Text>
            </View>
          )}
          <View style={[s.cardRow, s.totalRow]}>
            <Text style={[s.cardLabel, { color: C.txt, fontWeight: '700' }]}>Montant total</Text>
            <Text style={[s.cardVal, { color: C.txt, fontWeight: '700' }]}>
              {fmtN(item.montant_total)} MAD
            </Text>
          </View>
        </View>

        {/* Pied */}
        <View style={s.cardFooter}>
          <Text style={s.cardDate}>Soumis : {fmtDate(item.date)}</Text>
          {item.statut === 'en_attente' && (
            <TouchableOpacity
              style={[s.cancelBtn, isCancelling && { opacity: 0.5 }]}
              onPress={() => handleCancel(item)}
              disabled={isCancelling}
            >
              {isCancelling
                ? <ActivityIndicator size="small" color={C.down} />
                : <Text style={s.cancelTxt}>Annuler</Text>}
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={s.container}>
      <ScreenHeader title="Carnet d'ordres" />
      {/* Filtres */}
      <View style={s.filters}>
        {FILTERS.map(f => (
          <TouchableOpacity
            key={f.key}
            style={[s.filterBtn, filter === f.key && s.filterBtnActive]}
            onPress={() => setFilter(f.key)}
          >
            <Text style={[s.filterTxt, filter === f.key && s.filterTxtActive]}>
              {f.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading && ordres.length === 0 ? (
        <View style={s.loadingBox}>
          <ActivityIndicator size="large" color={C.accent} />
        </View>
      ) : error && ordres.length === 0 ? (
        <View style={s.loadingBox}>
          <Text style={{ fontSize: 28, marginBottom: 12 }}>⚠️</Text>
          <Text style={[s.emptyTxt, { textAlign: 'center', marginHorizontal: 32 }]}>{error}</Text>
          <TouchableOpacity style={{ marginTop: 16, padding: 12, borderWidth: 1, borderColor: C.accent, borderRadius: 8 }} onPress={load}>
            <Text style={{ color: C.accent }}>Réessayer</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={displayed}
          keyExtractor={item => item.id}
          renderItem={renderOrdre}
          contentContainerStyle={{ padding: 12, paddingTop: 16, gap: 10, paddingBottom: 32 }}
          ListEmptyComponent={
            <View style={s.empty}>
              <Text style={{ fontSize: 32, marginBottom: 12 }}>📓</Text>
              <Text style={s.emptyTxt}>
                {filter === 'all' ? 'Aucun ordre passé.' : 'Aucun ordre dans cette catégorie.'}
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: C.bg },
  filters:         { flexDirection: 'row', padding: 10, paddingTop: 10, gap: 6, flexWrap: 'wrap', backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  filterBtn:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2 },
  filterBtnActive: { borderColor: C.accent, backgroundColor: 'rgba(96,165,250,0.1)' },
  filterTxt:       { fontSize: 12, color: C.muted },
  filterTxtActive: { color: C.accent, fontWeight: '600' },
  loadingBox:      { flex: 1, justifyContent: 'center', alignItems: 'center' },
  card:            { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  cardName:        { fontSize: 15, fontWeight: '700', color: C.txt },
  cardCode:        { fontSize: 10, color: C.muted, marginTop: 2, letterSpacing: 0.5 },
  badge:           { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt:        { fontSize: 11, fontWeight: '600' },
  cardBody:        { padding: 14, gap: 6 },
  cardRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel:       { fontSize: 13, color: C.muted },
  cardVal:         { fontSize: 13, color: C.txt },
  totalRow:        { borderTopWidth: 1, borderTopColor: C.line, marginTop: 4, paddingTop: 8 },
  cardFooter:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', padding: 12, borderTopWidth: 1, borderTopColor: C.line, gap: 8 },
  cardDate:        { fontSize: 11, color: C.muted, flex: 1 },
  cancelBtn:       { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.down },
  cancelTxt:       { color: C.down, fontSize: 12, fontWeight: '600' },
  empty:           { alignItems: 'center', paddingTop: 60 },
  emptyTxt:        { color: C.muted, fontSize: 14 },
});
