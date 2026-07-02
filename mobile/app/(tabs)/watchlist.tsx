import { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { getWatchlist, toggleWatchlist } from '../../services/trading';
import { useMarketData, Stock } from '../../hooks/useMarketData';

const C = {
  bg: '#070b1c', panel: '#111733', panel2: '#0e1430',
  txt: '#e7ecff', muted: '#8a93b8', line: '#1f2a52',
  up: '#22c55e', down: '#ef4444', accent: '#60a5fa', gold: '#f59e0b', flat: '#9ca3af',
};

function fmtN(x: number | null | undefined, dp = 2) {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function varColor(pct: number) {
  return isNaN(pct) ? C.flat : pct > 0 ? C.up : pct < 0 ? C.down : C.flat;
}
function varLabel(pct: number) {
  if (isNaN(pct)) return '—';
  const sign = pct > 0 ? '▲ ' : pct < 0 ? '▼ ' : '● ';
  return `${sign}${Math.abs(pct).toFixed(2)}%`;
}

export default function WatchlistScreen() {
  const [watchlist, setWatchlist] = useState<string[]>([]);
  const { stocks } = useMarketData();
  const router = useRouter();

  useFocusEffect(useCallback(() => {
    getWatchlist().then(setWatchlist);
  }, []));

  const watchedStocks: Stock[] = watchlist
    .map(name => stocks.find(s => s.name === name))
    .filter((s): s is Stock => !!s);

  const handleUnstar = async (name: string) => {
    await toggleWatchlist(name);
    setWatchlist(prev => prev.filter(n => n !== name));
  };

  const renderItem = ({ item }: { item: Stock }) => (
    <View style={s.card}>
      <View style={s.top}>
        <View style={{ flex: 1 }}>
          <Text style={s.name}>{item.name}</Text>
          <Text style={s.sector}>{item.sector}</Text>
        </View>
        <TouchableOpacity onPress={() => handleUnstar(item.name)} style={s.star}>
          <Text style={{ fontSize: 22, color: C.gold }}>★</Text>
        </TouchableOpacity>
      </View>

      <View style={s.priceRow}>
        <Text style={s.price}>{fmtN(item.price)} MAD</Text>
        <Text style={[s.var, { color: varColor(item.pct) }]}>{varLabel(item.pct)}</Text>
      </View>

      <View style={s.details}>
        {[
          ['Bid', fmtN(item.bid)],
          ['Ask', fmtN(item.ask)],
          ['Vol', fmtN(item.volMAD, 0)],
        ].map(([label, val]) => (
          <View key={label} style={s.detailItem}>
            <Text style={s.detailLabel}>{label}</Text>
            <Text style={s.detailVal}>{val}</Text>
          </View>
        ))}
      </View>

      <View style={s.actions}>
        <TouchableOpacity
          style={[s.btn, { borderColor: C.up, backgroundColor: 'rgba(34,197,94,0.08)' }]}
          onPress={() => router.push({ pathname: '/(tabs)/ordres' as any, params: { stock: item.name, direction: 'achat' } })}
        >
          <Text style={{ color: C.up, fontWeight: '700', fontSize: 14 }}>📈 Acheter</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[s.btn, { borderColor: C.down, backgroundColor: 'rgba(239,68,68,0.08)' }]}
          onPress={() => router.push({ pathname: '/(tabs)/ordres' as any, params: { stock: item.name, direction: 'vente' } })}
        >
          <Text style={{ color: C.down, fontWeight: '700', fontSize: 14 }}>📉 Vendre</Text>
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={s.container}>
      <FlatList
        data={watchedStocks}
        keyExtractor={item => item.name}
        renderItem={renderItem}
        contentContainerStyle={{ padding: 12, gap: 10, paddingBottom: 32 }}
        ListEmptyComponent={
          <View style={s.empty}>
            <Text style={{ fontSize: 40, marginBottom: 16 }}>⭐</Text>
            <Text style={s.emptyTitle}>Aucune valeur en favoris</Text>
            <Text style={s.emptyHint}>Appuyez sur ☆ dans l'onglet Marché pour ajouter des valeurs à suivre.</Text>
          </View>
        }
      />
    </View>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  card:        { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  top:         { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  name:        { fontSize: 16, fontWeight: '700', color: C.txt },
  sector:      { fontSize: 11, color: C.muted, marginTop: 2 },
  star:        { padding: 4 },
  priceRow:    { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 12 },
  price:       { fontSize: 22, fontWeight: '700', color: C.txt },
  var:         { fontSize: 14, fontWeight: '600' },
  details:     { flexDirection: 'row', gap: 8, marginBottom: 12 },
  detailItem:  { flex: 1, backgroundColor: C.panel2, borderRadius: 8, padding: 8, alignItems: 'center' },
  detailLabel: { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  detailVal:   { fontSize: 13, fontWeight: '600', color: C.txt, marginTop: 2 },
  actions:     { flexDirection: 'row', gap: 8 },
  btn:         { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: 'center' },
  empty:       { alignItems: 'center', paddingTop: 80, paddingHorizontal: 32 },
  emptyTitle:  { fontSize: 17, fontWeight: '600', color: C.txt, marginBottom: 10 },
  emptyHint:   { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22 },
});
