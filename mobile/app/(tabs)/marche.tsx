import { useState, useMemo } from 'react';
import { View, Text, FlatList, TextInput, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { useMarketData, Stock } from '../../hooks/useMarketData';
import { isMarketOpen } from '../../services/trading';

function fmtN(x: number | null | undefined, dp = 2) {
  if (x === null || x === undefined || isNaN(x)) return '—';
  return x.toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function VarBadge({ pct }: { pct: number }) {
  const color = isNaN(pct) ? '#9ca3af' : pct > 0 ? '#22c55e' : pct < 0 ? '#ef4444' : '#9ca3af';
  const sign  = isNaN(pct) ? '' : pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '● ';
  return (
    <Text style={[styles.var, { color }]}>
      {isNaN(pct) ? '—' : `${sign}${Math.abs(pct).toFixed(2)}%`}
    </Text>
  );
}

export default function MarcheScreen() {
  const { stocks, overview, status, lastUpdate } = useMarketData();
  const [query, setQuery] = useState('');
  const open = isMarketOpen();

  const filtered = useMemo(() => {
    if (!query) return stocks;
    const q = query.toLowerCase();
    return stocks.filter(s => s.name.toLowerCase().includes(q) || s.sector.toLowerCase().includes(q));
  }, [stocks, query]);

  const statusColor = status === 'connected' ? '#22c55e' : status === 'connecting' ? '#f59e0b' : '#ef4444';
  const statusLabel = status === 'connected' ? 'WebSocket · en direct' : status === 'connecting' ? 'Connexion…' : 'Déconnecté';

  const renderStock = ({ item }: { item: Stock }) => (
    <View style={styles.row}>
      <View style={styles.rowLeft}>
        <Text style={styles.name} numberOfLines={1}>{item.name}</Text>
        <Text style={styles.sector} numberOfLines={1}>{item.sector}</Text>
      </View>
      <View style={styles.rowRight}>
        <Text style={styles.price}>{fmtN(item.price)} MAD</Text>
        <VarBadge pct={item.pct} />
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <View style={[styles.dot, { backgroundColor: statusColor }]} />
        <Text style={styles.statusText}>{statusLabel}</Text>
        <Text style={[styles.marketBadge, { color: open ? '#22c55e' : '#ef4444' }]}>
          {open ? '● Marché ouvert' : '● Marché fermé'}
        </Text>
      </View>

      {/* MASI card */}
      {overview.masi && (
        <View style={styles.masiCard}>
          <Text style={styles.masiLabel}>MASI</Text>
          <Text style={styles.masiValue}>{fmtN(overview.masi)}</Text>
          <VarBadge pct={overview.masiVarJ ?? NaN} />
          {lastUpdate && <Text style={styles.masiTs}>Maj : {lastUpdate.toLocaleTimeString('fr-FR')}</Text>}
        </View>
      )}

      {/* Cards row */}
      <View style={styles.cardsRow}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Volume MAD</Text>
          <Text style={styles.cardValue} numberOfLines={1}>{fmtN(overview.vol, 0)}</Text>
        </View>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Capitalisation</Text>
          <Text style={styles.cardValue} numberOfLines={1}>{fmtN((overview.capi ?? 0) / 1e9, 1)} Mds</Text>
        </View>
      </View>

      {/* Search */}
      <TextInput
        style={styles.search}
        placeholder="Filtrer (ATW, IAM, BCP…)"
        placeholderTextColor="#8a93b8"
        value={query}
        onChangeText={setQuery}
      />

      {/* Stock list */}
      <FlatList
        data={filtered}
        keyExtractor={item => item.name}
        renderItem={renderStock}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        ListEmptyComponent={
          <Text style={styles.empty}>
            {status === 'connecting' ? 'Connexion WebSocket en cours…' : 'Aucune valeur'}
          </Text>
        }
        refreshControl={<RefreshControl refreshing={status === 'connecting'} tintColor="#60a5fa" />}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#070b1c' },
  statusBar:    { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: '#0b1020', gap: 8 },
  dot:          { width: 8, height: 8, borderRadius: 4 },
  statusText:   { fontSize: 12, color: '#8a93b8', flex: 1 },
  marketBadge:  { fontSize: 11, fontWeight: '600' },
  masiCard:     { margin: 12, padding: 16, backgroundColor: '#111733', borderRadius: 12, borderWidth: 1, borderColor: '#1f2a52' },
  masiLabel:    { fontSize: 11, color: '#8a93b8', textTransform: 'uppercase', letterSpacing: 0.5 },
  masiValue:    { fontSize: 28, fontWeight: '700', color: '#e7ecff', marginVertical: 4 },
  masiTs:       { fontSize: 11, color: '#8a93b8', marginTop: 4 },
  cardsRow:     { flexDirection: 'row', gap: 8, marginHorizontal: 12, marginBottom: 8 },
  card:         { flex: 1, backgroundColor: '#111733', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: '#1f2a52' },
  cardLabel:    { fontSize: 10, color: '#8a93b8', textTransform: 'uppercase', marginBottom: 4 },
  cardValue:    { fontSize: 14, fontWeight: '600', color: '#e7ecff' },
  search:       { marginHorizontal: 12, marginBottom: 8, backgroundColor: '#111733', borderRadius: 10, padding: 10, fontSize: 13, color: '#e7ecff', borderWidth: 1, borderColor: '#1f2a52' },
  row:          { flexDirection: 'row', alignItems: 'center', padding: 12, paddingHorizontal: 16 },
  rowLeft:      { flex: 1 },
  rowRight:     { alignItems: 'flex-end' },
  name:         { fontSize: 14, fontWeight: '600', color: '#e7ecff' },
  sector:       { fontSize: 11, color: '#8a93b8', marginTop: 2 },
  price:        { fontSize: 14, color: '#e7ecff', fontVariant: ['tabular-nums'] },
  var:          { fontSize: 12, marginTop: 2 },
  sep:          { height: 1, backgroundColor: '#1f2a52', marginLeft: 16 },
  empty:        { padding: 40, textAlign: 'center', color: '#8a93b8' },
});