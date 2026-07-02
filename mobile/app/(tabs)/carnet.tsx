import { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, Alert } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { getOrders, cancelOrder, Order, OrderStatus } from '../../services/trading';

const C = {
  bg: '#070b1c', panel: '#111733', panel2: '#0e1430',
  txt: '#e7ecff', muted: '#8a93b8', line: '#1f2a52',
  up: '#22c55e', down: '#ef4444', accent: '#60a5fa', gold: '#f59e0b', flat: '#9ca3af',
};

function fmtN(x: number, dp = 2) {
  return isNaN(x) ? '—' : x.toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

const STATUS_LABELS: Record<OrderStatus, string> = {
  'en_attente': 'En attente',
  'exécuté':   'Exécuté',
  'annulé':    'Annulé',
  'rejeté':    'Rejeté',
};

const STATUS_COLORS: Record<OrderStatus, string> = {
  'en_attente': C.gold,
  'exécuté':   C.up,
  'annulé':    C.flat,
  'rejeté':    C.down,
};

const FILTERS: Array<{ key: OrderStatus | 'all'; label: string }> = [
  { key: 'all',        label: 'Tous' },
  { key: 'en_attente', label: 'En attente' },
  { key: 'exécuté',   label: 'Exécutés' },
  { key: 'annulé',    label: 'Annulés' },
  { key: 'rejeté',    label: 'Rejetés' },
];

export default function CarnetScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<OrderStatus | 'all'>('all');

  useFocusEffect(useCallback(() => {
    getOrders().then(setOrders);
  }, []));

  const displayed = filter === 'all' ? orders : orders.filter(o => o.status === filter);

  const handleCancel = (order: Order) => {
    Alert.alert(
      'Annuler l\'ordre',
      `Annuler l'ordre ${order.direction} de ${order.qty}× ${order.name} ?\nLes fonds seront restitués.`,
      [
        { text: 'Non', style: 'cancel' },
        { text: 'Oui, annuler', style: 'destructive', onPress: async () => {
          const res = await cancelOrder(order.id);
          Alert.alert(res.success ? '✓ Annulé' : '✗ Erreur', res.message);
          getOrders().then(setOrders);
        }},
      ]
    );
  };

  const renderOrder = ({ item }: { item: Order }) => (
    <View style={s.card}>
      <View style={s.cardHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.cardName}>{item.name}</Text>
          <Text style={s.cardSub}>{item.sector}</Text>
        </View>
        <View style={[s.badge, { backgroundColor: `${STATUS_COLORS[item.status]}20`, borderColor: `${STATUS_COLORS[item.status]}50` }]}>
          <Text style={[s.badgeTxt, { color: STATUS_COLORS[item.status] }]}>
            {STATUS_LABELS[item.status]}
          </Text>
        </View>
      </View>

      <View style={s.cardBody}>
        <View style={s.cardRow}>
          <Text style={s.cardLabel}>Sens</Text>
          <Text style={[s.cardVal, { color: item.direction === 'achat' ? C.up : C.down, fontWeight: '600' }]}>
            {item.direction === 'achat' ? '▲ Achat' : '▼ Vente'}
          </Text>
        </View>
        <View style={s.cardRow}>
          <Text style={s.cardLabel}>Type</Text>
          <Text style={s.cardVal}>{item.type === 'marche' ? 'Au marché' : 'Limité'}</Text>
        </View>
        <View style={s.cardRow}>
          <Text style={s.cardLabel}>Qté</Text>
          <Text style={s.cardVal}>{item.qty} titre(s)</Text>
        </View>
        <View style={s.cardRow}>
          <Text style={s.cardLabel}>Prix</Text>
          <Text style={s.cardVal}>{fmtN(item.price)} MAD</Text>
        </View>
        <View style={[s.cardRow, { borderTopWidth: 1, borderTopColor: C.line, marginTop: 4, paddingTop: 8 }]}>
          <Text style={[s.cardLabel, { fontWeight: '700', color: C.txt }]}>Total</Text>
          <Text style={[s.cardVal, { fontWeight: '700', color: C.txt }]}>{fmtN(item.total)} MAD</Text>
        </View>
      </View>

      <View style={s.cardFooter}>
        <Text style={s.cardDate}>📅 {fmtDate(item.date)}</Text>
        {item.executionDate && <Text style={s.cardDate}>✓ {fmtDate(item.executionDate)}</Text>}
        {item.cancelDate    && <Text style={s.cardDate}>✗ {fmtDate(item.cancelDate)}</Text>}
        {item.status === 'en_attente' && (
          <TouchableOpacity style={s.cancelBtn} onPress={() => handleCancel(item)}>
            <Text style={s.cancelTxt}>Annuler</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );

  return (
    <View style={s.container}>
      {/* Filtres */}
      <View style={s.filters}>
        {FILTERS.map(f => (
          <TouchableOpacity key={f.key} style={[s.filterBtn, filter === f.key && s.filterBtnActive]}
            onPress={() => setFilter(f.key)}>
            <Text style={[s.filterTxt, filter === f.key && s.filterTxtActive]}>{f.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <FlatList
        data={displayed}
        keyExtractor={item => String(item.id)}
        renderItem={renderOrder}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 32 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 32, marginBottom: 12 }}>📓</Text>
            <Text style={s.emptyTxt}>
              {filter === 'all' ? 'Aucun ordre passé.' : `Aucun ordre ${STATUS_LABELS[filter as OrderStatus]?.toLowerCase()}.`}
            </Text>
          </View>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:       { flex: 1, backgroundColor: C.bg },
  filters:         { flexDirection: 'row', padding: 10, gap: 6, flexWrap: 'wrap', backgroundColor: C.panel, borderBottomWidth: 1, borderBottomColor: C.line },
  filterBtn:       { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel2 },
  filterBtnActive: { borderColor: C.accent, backgroundColor: 'rgba(96,165,250,0.1)' },
  filterTxt:       { fontSize: 12, color: C.muted },
  filterTxtActive: { color: C.accent, fontWeight: '600' },
  card:            { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  cardHeader:      { flexDirection: 'row', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  cardName:        { fontSize: 16, fontWeight: '700', color: C.txt },
  cardSub:         { fontSize: 11, color: C.muted, marginTop: 2 },
  badge:           { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeTxt:        { fontSize: 11, fontWeight: '600' },
  cardBody:        { padding: 14, gap: 6 },
  cardRow:         { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel:       { fontSize: 13, color: C.muted },
  cardVal:         { fontSize: 13, color: C.txt },
  cardFooter:      { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', padding: 12, borderTopWidth: 1, borderTopColor: C.line, gap: 8 },
  cardDate:        { fontSize: 11, color: C.muted },
  cancelBtn:       { marginLeft: 'auto' as any, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8, borderWidth: 1, borderColor: C.down },
  cancelTxt:       { color: C.down, fontSize: 12, fontWeight: '600' },
  empty:           { alignItems: 'center', paddingTop: 60 },
  emptyTxt:        { color: C.muted, fontSize: 14 },
});
