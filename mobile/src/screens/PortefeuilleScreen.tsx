// ============================================================================
// screens/PortefeuilleScreen.tsx — Portefeuille et valorisation temps réel
// Adapté de app/(tabs)/portefeuille.tsx pour React Navigation
// Remplacement : useFocusEffect + useRouter expo-router → @react-navigation/native
// ============================================================================

import React, { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { getPortfolio, getOrders, Portfolio, Order, resetPortfolio } from '../../services/trading';
import { useMarketData } from '../../hooks/useMarketData';
import type { MainTabParamList } from '../navigation/types';

const C = {
  bg: '#070b1c', panel: '#111733', panel2: '#0e1430',
  txt: '#e7ecff', muted: '#8a93b8', line: '#1f2a52',
  up: '#22c55e', down: '#ef4444', accent: '#60a5fa',
};

function fmtN(x: number, dp = 2) {
  if (isNaN(x)) return '—';
  return x.toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

export function PortefeuilleScreen() {
  const [portfolio, setPortfolio] = useState<Portfolio>({ balance: 0, positions: [] });
  const [history,   setHistory]   = useState<Order[]>([]);
  const { stocks } = useMarketData();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();

  // Recharger à chaque focus
  useFocusEffect(useCallback(() => {
    getPortfolio().then(setPortfolio);
    getOrders().then(orders =>
      setHistory(orders.filter(o => o.status === 'exécuté').slice(0, 5))
    );
  }, []));

  // Calcul de la valorisation totale aux cours actuels
  const totalValue = portfolio.positions.reduce((acc, pos) => {
    const cur = stocks.find(s => s.name === pos.name)?.price ?? pos.avgPrice;
    return acc + pos.qty * cur;
  }, 0);
  const totalCost = portfolio.positions.reduce((acc, pos) => acc + pos.qty * pos.avgPrice, 0);
  const totalPl   = totalValue - totalCost;
  const plPct     = totalCost ? totalPl / totalCost * 100 : 0;

  // Réinitialisation du portefeuille (remet 100k MAD, efface toutes les positions)
  const handleReset = () => {
    Alert.alert(
      'Réinitialiser',
      'Supprimer toutes les positions et remettre 100 000 MAD ?',
      [
        { text: 'Annuler', style: 'cancel' },
        {
          text: 'Confirmer',
          style: 'destructive',
          onPress: async () => {
            await resetPortfolio();
            setPortfolio({ balance: 100_000, positions: [] });
            setHistory([]);
          },
        },
      ]
    );
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}>
      {/* KPIs en haut */}
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>Solde</Text>
          <Text style={s.kpiValue} numberOfLines={1}>{fmtN(portfolio.balance, 0)}</Text>
          <Text style={s.kpiUnit}>MAD</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>Valorisation</Text>
          <Text style={s.kpiValue} numberOfLines={1}>{fmtN(totalValue, 0)}</Text>
          <Text style={s.kpiUnit}>MAD</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>P&L</Text>
          <Text style={[s.kpiValue, { color: totalPl >= 0 ? C.up : C.down }]} numberOfLines={1}>
            {totalPl >= 0 ? '+' : ''}{fmtN(totalPl, 0)}
          </Text>
          <Text style={[s.kpiUnit, { color: totalPl >= 0 ? C.up : C.down }]}>
            {fmtN(plPct)}%
          </Text>
        </View>
      </View>

      {/* Positions ouvertes */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Mes positions</Text>
        {portfolio.positions.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTxt}>Aucune position ouverte.</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Ordre', {})}
              style={s.emptyBtn}
            >
              <Text style={{ color: C.accent, fontWeight: '600' }}>Passer un premier ordre →</Text>
            </TouchableOpacity>
          </View>
        ) : (
          portfolio.positions.map(pos => {
            const cur  = stocks.find(s => s.name === pos.name)?.price ?? pos.avgPrice;
            const val  = pos.qty * cur;
            const cost = pos.qty * pos.avgPrice;
            const pl   = val - cost;
            const pp   = cost ? pl / cost * 100 : 0;
            return (
              <View key={pos.name} style={s.posCard}>
                <View style={s.posHeader}>
                  <Text style={s.posName}>{pos.name}</Text>
                  <Text style={[s.posPl, { color: pl >= 0 ? C.up : C.down }]}>
                    {pl >= 0 ? '+' : ''}{fmtN(pl, 0)} ({fmtN(pp)}%)
                  </Text>
                </View>
                <View style={s.posGrid}>
                  {[
                    ['Quantité',     `${pos.qty} titres`],
                    ['Prix moyen',   `${fmtN(pos.avgPrice)} MAD`],
                    ['Cours actuel', `${fmtN(cur)} MAD`],
                    ['Valorisation', `${fmtN(val, 0)} MAD`],
                  ].map(([lbl, v]) => (
                    <View key={lbl} style={s.posCell}>
                      <Text style={s.posCellLabel}>{lbl}</Text>
                      <Text style={s.posCellVal}>{v}</Text>
                    </View>
                  ))}
                </View>
                <View style={s.posActions}>
                  <TouchableOpacity
                    style={[s.posBtn, { borderColor: C.up }]}
                    onPress={() => navigation.navigate('Ordre', { stock: pos.name, direction: 'achat' })}
                  >
                    <Text style={{ color: C.up, fontSize: 12, fontWeight: '600' }}>📈 Acheter +</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.posBtn, { borderColor: C.down }]}
                    onPress={() => navigation.navigate('Ordre', { stock: pos.name, direction: 'vente' })}
                  >
                    <Text style={{ color: C.down, fontSize: 12, fontWeight: '600' }}>📉 Vendre</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })
        )}
      </View>

      {/* Derniers mouvements */}
      {history.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Derniers mouvements</Text>
          {history.map(o => (
            <View key={o.id} style={s.histRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.histName}>{o.name}</Text>
                <Text style={s.histDate}>{fmtDate(o.executionDate ?? o.date)}</Text>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={[s.histDir, { color: o.direction === 'achat' ? C.up : C.down }]}>
                  {o.direction === 'achat' ? '▲' : '▼'} {o.qty} titre(s)
                </Text>
                <Text style={s.histTotal}>{fmtN(o.total)} MAD</Text>
              </View>
            </View>
          ))}
          <TouchableOpacity
            style={s.seeAll}
            onPress={() => navigation.navigate('Carnet')}
          >
            <Text style={{ color: C.accent, fontSize: 13 }}>Voir tout le carnet →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Bouton reset */}
      <TouchableOpacity style={s.resetBtn} onPress={handleReset}>
        <Text style={s.resetTxt}>Réinitialiser le portefeuille</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bg },
  kpiRow:       { flexDirection: 'row', gap: 8, padding: 12 },
  kpi:          { flex: 1, backgroundColor: C.panel, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center' },
  kpiLabel:     { fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  kpiValue:     { fontSize: 15, fontWeight: '700', color: C.txt, marginTop: 4 },
  kpiUnit:      { fontSize: 10, color: C.muted, marginTop: 2 },
  section:      { marginHorizontal: 12, marginBottom: 16 },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 10 },
  emptyBox:     { backgroundColor: C.panel, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  emptyTxt:     { color: C.muted, marginBottom: 12, fontSize: 14 },
  emptyBtn:     { padding: 8 },
  posCard:      { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, marginBottom: 10, overflow: 'hidden' },
  posHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  posName:      { fontSize: 15, fontWeight: '700', color: C.txt },
  posPl:        { fontSize: 13, fontWeight: '600' },
  posGrid:      { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 8 },
  posCell:      { width: '47%', backgroundColor: C.panel2, borderRadius: 8, padding: 10 },
  posCellLabel: { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  posCellVal:   { fontSize: 13, color: C.txt, marginTop: 3, fontWeight: '500' },
  posActions:   { flexDirection: 'row', gap: 8, padding: 12, paddingTop: 4 },
  posBtn:       { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },
  histRow:      { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line },
  histName:     { fontSize: 14, fontWeight: '600', color: C.txt },
  histDate:     { fontSize: 11, color: C.muted, marginTop: 2 },
  histDir:      { fontSize: 13, fontWeight: '600' },
  histTotal:    { fontSize: 12, color: C.muted, marginTop: 2 },
  seeAll:       { padding: 8, alignItems: 'center' },
  resetBtn:     { margin: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.down, alignItems: 'center' },
  resetTxt:     { color: C.down, fontSize: 13, fontWeight: '500' },
});
