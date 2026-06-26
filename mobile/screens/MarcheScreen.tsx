import React, { useState, useMemo } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, RefreshControl } from 'react-native';
import { useMarketData, Stock } from '../hooks/useMarketData';
import { isMarketOpen } from '../services/trading';

function fmtN(x: number | null | undefined, dp = 2): string {
  if (x === null || x === undefined || isNaN(Number(x))) return '—';
  return Number(x).toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function VarText({ pct }: { pct: number }) {
  const isNan = isNaN(pct);
  const color = isNan ? '#9ca3af' : pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : '#9ca3af';
  const label = isNan ? '—' : `${pct > 0 ? '▲' : pct < 0 ? '▼' : '●'} ${Math.abs(pct).toFixed(2)}%`;
  return <Text style={[s.var, { color }]}>{label}</Text>;
}

export default function MarcheScreen() {
  const { stocks, overview, status, lastUpdate } = useMarketData();
  const [query, setQuery] = useState('');
  const open = isMarketOpen();

  const filtered = useMemo(() => {
    if (!query.trim()) return stocks;
    const q = query.toLowerCase();
    return stocks.filter(r => r.name.toLowerCase().includes(q) || r.sector.toLowerCase().includes(q));
  }, [stocks, query]);

  const dotColor = status === 'connected' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444';

  return (
    <View style={s.container}>
      {/* Status */}
      <View style={s.statusBar}>
        <View style={[s.dot, { backgroundColor: dotColor }]} />
        <Text style={s.statusText}>
          {status === 'connected' ? 'WebSocket connecté' : status === 'connecting' ? 'Connexion…' : 'Déconnecté'}
        </Text>
        <Text style={[s.marketLabel, { color: open ? '#22c55e' : '#ef4444' }]}>
          {open ? '● Marché ouvert' : '● Marché fermé'}
        </Text>
      </View>

      {/* MASI */}
      <View style={s.masiCard}>
        <Text style={s.masiLabel}>MASI · Bourse de Casablanca</Text>
        <Text style={s.masiVal}>{fmtN(overview.masi)}</Text>
        <VarText pct={overview.masiVarJ ?? NaN} />
        {lastUpdate && (
          <Text style={s.masiTs}>Maj : {lastUpdate.toLocaleTimeString('fr-FR')}</Text>
        )}
      </View>

      {/* KPIs */}
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>Volume MAD</Text>
          <Text style={s.kpiVal} numberOfLines={1}>{fmtN(overview.vol, 0)}</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>Capi. (Mds)</Text>
          <Text style={s.kpiVal} numberOfLines={1}>
            {overview.capi ? fmtN(overview.capi / 1e9, 1) : '—'}
          </Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>Valeurs</Text>
          <Text style={s.kpiVal}>{stocks.length}</Text>
        </View>
      </View>

      {/* Search */}
      <TextInput
        style={s.search}
        placeholder="Filtrer (ATW, IAM, BCP…)"
        placeholderTextColor="#8a93b8"
        value={query}
        onChangeText={setQuery}
      />

      {/* List */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.name}
        renderItem={({ item }: { item: Stock }) => (
          <View style={s.row}>
            <View style={s.rowLeft}>
              <Text style={s.name} numberOfLines={1}>{item.name}</Text>
              <Text style={s.sector} numberOfLines={1}>{item.sector}</Text>
            </View>
            <View style={s.rowRight}>
              <Text style={s.price}>{fmtN(item.price)} MAD</Text>
              <VarText pct={item.pct} />
            </View>
          </View>
        )}
        ItemSeparatorComponent={() => <View style={s.sep} />}
        ListEmptyComponent={
          <Text style={s.empty}>
            {status === 'connecting' ? 'Connexion au marché…' : 'Aucune valeur'}
          </Text>
        }
        refreshControl={<RefreshControl refreshing={status === 'connecting'} tintColor="#60a5fa" />}
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#070b1c' },
  statusBar:   { flexDirection: 'row', alignItems: 'center', backgroundColor: '#0b1020', padding: 10, gap: 8 },
  dot:         { width: 8, height: 8, borderRadius: 4 },
  statusText:  { flex: 1, fontSize: 12, color: '#8a93b8' },
  marketLabel: { fontSize: 11, fontWeight: '600' },
  masiCard:    { margin: 12, padding: 16, backgroundColor: '#111733', borderRadius: 14, borderWidth: 1, borderColor: '#1f2a52' },
  masiLabel:   { fontSize: 11, color: '#8a93b8', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  masiVal:     { fontSize: 30, fontWeight: '700', color: '#e7ecff', marginBottom: 2 },
  masiTs:      { fontSize: 11, color: '#8a93b8', marginTop: 4 },
  kpiRow:      { flexDirection: 'row', gap: 8, marginHorizontal: 12, marginBottom: 10 },
  kpi:         { flex: 1, backgroundColor: '#111733', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: '#1f2a52' },
  kpiLabel:    { fontSize: 10, color: '#8a93b8', textTransform: 'uppercase', marginBottom: 3 },
  kpiVal:      { fontSize: 13, fontWeight: '600', color: '#e7ecff' },
  search:      { marginHorizontal: 12, marginBottom: 8, backgroundColor: '#111733', borderRadius: 10, padding: 10, fontSize: 13, color: '#e7ecff', borderWidth: 1, borderColor: '#1f2a52' },
  row:         { flexDirection: 'row', padding: 12, paddingHorizontal: 16 },
  rowLeft:     { flex: 1 },
  rowRight:    { alignItems: 'flex-end' },
  name:        { fontSize: 14, fontWeight: '600', color: '#e7ecff' },
  sector:      { fontSize: 11, color: '#8a93b8', marginTop: 2 },
  price:       { fontSize: 14, color: '#e7ecff' },
  var:         { fontSize: 12, marginTop: 2 },
  sep:         { height: 1, backgroundColor: '#1f2a52', marginLeft: 16 },
  empty:       { padding: 40, textAlign: 'center', color: '#8a93b8' },
});