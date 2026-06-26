import { useEffect, useState } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { getPortfolio, Portfolio, resetPortfolio } from '../../services/trading';
import { useMarketData } from '../../hooks/useMarketData';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';

function fmtN(x: number, dp = 2) {
  if (isNaN(x)) return '—';
  return x.toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export default function PortefeuilleScreen() {
  const [portfolio, setPortfolio] = useState<Portfolio>({ balance: 0, positions: [] });
  const { stocks } = useMarketData();

  useFocusEffect(useCallback(() => {
    getPortfolio().then(setPortfolio);
  }, []));

  const totalValue = portfolio.positions.reduce((acc, pos) => {
    const cur = stocks.find(s => s.name === pos.name)?.price ?? pos.avgPrice;
    return acc + pos.qty * cur;
  }, 0);
  const totalCost = portfolio.positions.reduce((acc, pos) => acc + pos.qty * pos.avgPrice, 0);
  const totalPl   = totalValue - totalCost;

  const handleReset = () => {
    Alert.alert('Réinitialiser', 'Supprimer toutes les positions et remettre 100 000 MAD ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Confirmer', style: 'destructive', onPress: async () => {
        await resetPortfolio();
        setPortfolio({ balance: 100_000, positions: [] });
      }},
    ]);
  };

  return (
    <View style={styles.container}>
      {/* KPI row */}
      <View style={styles.kpiRow}>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Solde disponible</Text>
          <Text style={styles.kpiValue}>{fmtN(portfolio.balance)}</Text>
          <Text style={styles.kpiUnit}>MAD</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Valorisation</Text>
          <Text style={styles.kpiValue}>{fmtN(totalValue)}</Text>
          <Text style={styles.kpiUnit}>MAD</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={styles.kpiLabel}>Plus-value</Text>
          <Text style={[styles.kpiValue, { color: totalPl >= 0 ? '#22c55e' : '#ef4444' }]}>
            {totalPl >= 0 ? '+' : ''}{fmtN(totalPl)}
          </Text>
          <Text style={styles.kpiUnit}>MAD</Text>
        </View>
      </View>

      <Text style={styles.sectionTitle}>Mes positions</Text>

      <FlatList
        data={portfolio.positions}
        keyExtractor={item => item.name}
        ListEmptyComponent={<Text style={styles.empty}>Aucune position. Passez votre premier ordre.</Text>}
        renderItem={({ item }) => {
          const cur   = stocks.find(s => s.name === item.name)?.price ?? item.avgPrice;
          const val   = item.qty * cur;
          const cost  = item.qty * item.avgPrice;
          const pl    = val - cost;
          const plPct = cost ? pl / cost * 100 : 0;
          return (
            <View style={styles.posRow}>
              <View style={styles.posLeft}>
                <Text style={styles.posName}>{item.name}</Text>
                <Text style={styles.posSub}>{item.qty} titres · Moy. {fmtN(item.avgPrice)} MAD</Text>
              </View>
              <View style={styles.posRight}>
                <Text style={styles.posVal}>{fmtN(val)}</Text>
                <Text style={[styles.posPl, { color: pl >= 0 ? '#22c55e' : '#ef4444' }]}>
                  {pl >= 0 ? '+' : ''}{fmtN(pl)} ({fmtN(plPct)}%)
                </Text>
              </View>
            </View>
          );
        }}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
      />

      <TouchableOpacity style={styles.resetBtn} onPress={handleReset}>
        <Text style={styles.resetText}>Réinitialiser le portefeuille</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container:    { flex: 1, backgroundColor: '#070b1c' },
  kpiRow:       { flexDirection: 'row', gap: 8, padding: 12 },
  kpi:          { flex: 1, backgroundColor: '#111733', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#1f2a52', alignItems: 'center' },
  kpiLabel:     { fontSize: 10, color: '#8a93b8', textTransform: 'uppercase', textAlign: 'center' },
  kpiValue:     { fontSize: 16, fontWeight: '700', color: '#e7ecff', marginTop: 4 },
  kpiUnit:      { fontSize: 10, color: '#8a93b8' },
  sectionTitle: { fontSize: 13, fontWeight: '600', color: '#8a93b8', textTransform: 'uppercase', letterSpacing: 0.5, paddingHorizontal: 16, paddingVertical: 8 },
  posRow:       { flexDirection: 'row', padding: 14, paddingHorizontal: 16 },
  posLeft:      { flex: 1 },
  posRight:     { alignItems: 'flex-end' },
  posName:      { fontSize: 14, fontWeight: '600', color: '#e7ecff' },
  posSub:       { fontSize: 11, color: '#8a93b8', marginTop: 2 },
  posVal:       { fontSize: 14, color: '#e7ecff' },
  posPl:        { fontSize: 12, marginTop: 2 },
  sep:          { height: 1, backgroundColor: '#1f2a52' },
  empty:        { padding: 40, textAlign: 'center', color: '#8a93b8' },
  resetBtn:     { margin: 16, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#ef4444', alignItems: 'center' },
  resetText:    { color: '#ef4444', fontSize: 13, fontWeight: '500' },
});