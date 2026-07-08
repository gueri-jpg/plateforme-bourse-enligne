import { useState, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert, ScrollView, Linking } from 'react-native';
import { getPortfolio, getOrders, Portfolio, Order, resetPortfolio } from '../../services/trading';
import { useMarketData } from '../../hooks/useMarketData';
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { CONFIG } from '../../constants/config';
import { getValidAccessToken } from '../../services/auth';

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

export default function PortefeuilleScreen() {
  const [portfolio, setPortfolio] = useState<Portfolio>({ balance: 0, positions: [] });
  const [history,   setHistory]   = useState<Order[]>([]);
  const { stocks } = useMarketData();
  const router = useRouter();
  const params = useLocalSearchParams<{ depot_ref?: string; depot_status?: string }>();

  useFocusEffect(useCallback(() => {
    getPortfolio().then(setPortfolio);
    getOrders().then(orders =>
      setHistory(orders.filter(o => o.status === 'exécuté').slice(0, 5))
    );
    // Confirmation de dépôt reçue via deep link bourseenligne://depot-confirm
    if (params.depot_ref && params.depot_status === 'ok') {
      Alert.alert('Dépôt initié', `Virement banque reçu (réf: ${params.depot_ref}). Votre solde sera mis à jour sous peu.`);
    }
  }, [params.depot_ref, params.depot_status]));

  const alimenterDepuisBanque = useCallback(async () => {
    try {
      const token = await getValidAccessToken();
      if (!token) {
        Alert.alert('Non connecté', 'Connectez-vous pour alimenter votre compte.');
        return;
      }
      // Récupérer l'IBAN du compte titres
      const resp = await fetch(`${CONFIG.API_BASE_URL}/api/portefeuille/comptes-titres`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Compte titres introuvable');
      const compte = await resp.json();
      const iban: string = compte.iban ?? '';
      if (!iban) throw new Error('IBAN bourse non disponible');

      // Générer une référence unique
      const hexPart = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
      const tsPart  = Date.now().toString(36).slice(-6).toUpperCase();
      const ref     = `BRS${hexPart}${tsPart}`;
      const retour  = `bourseenligne://depot-confirm?ref=${ref}`;

      const deepLink = `cfcdigibank://alimenter-bourse?ref=${ref}&iban=${encodeURIComponent(iban)}&retour=${encodeURIComponent(retour)}`;
      const canOpen  = await Linking.canOpenURL(deepLink);
      if (canOpen) {
        await Linking.openURL(deepLink);
      } else {
        // Fallback : ouvrir le dashboard web banque
        const banqueUrl = `${CONFIG.BANQUE_DASHBOARD_URL}?action=alimenter-bourse&ref=${ref}&iban=${encodeURIComponent(iban)}&retour=${encodeURIComponent(retour)}`;
        Linking.openURL(banqueUrl).catch(() => {});
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de contacter la banque.');
    }
  }, []);

  const totalValue = portfolio.positions.reduce((acc, pos) => {
    const cur = stocks.find(s => s.name === pos.name)?.price ?? pos.avgPrice;
    return acc + pos.qty * cur;
  }, 0);
  const totalCost = portfolio.positions.reduce((acc, pos) => acc + pos.qty * pos.avgPrice, 0);
  const totalPl   = totalValue - totalCost;
  const plPct     = totalCost ? totalPl / totalCost * 100 : 0;

  const handleReset = () => {
    Alert.alert('Réinitialiser', 'Supprimer toutes les positions et remettre 100 000 MAD ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Confirmer', style: 'destructive', onPress: async () => {
        await resetPortfolio();
        setPortfolio({ balance: 100_000, positions: [] });
        setHistory([]);
      }},
    ]);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 32 }}>
      {/* KPI */}
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

      {/* Positions */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Mes positions</Text>
        {portfolio.positions.length === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTxt}>Aucune position ouverte.</Text>
            <TouchableOpacity onPress={() => router.push('/(tabs)/ordres' as any)} style={s.emptyBtn}>
              <Text style={{ color: C.accent, fontWeight: '600' }}>Passer un premier ordre</Text>
            </TouchableOpacity>
          </View>
        ) : portfolio.positions.map(pos => {
          const cur   = stocks.find(s => s.name === pos.name)?.price ?? pos.avgPrice;
          const val   = pos.qty * cur;
          const cost  = pos.qty * pos.avgPrice;
          const pl    = val - cost;
          const pp    = cost ? pl / cost * 100 : 0;
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
                  ['Quantité',    `${pos.qty} titres`],
                  ['Prix moyen',  `${fmtN(pos.avgPrice)} MAD`],
                  ['Cours actuel',`${fmtN(cur)} MAD`],
                  ['Valorisation',`${fmtN(val, 0)} MAD`],
                ].map(([lbl, val]) => (
                  <View key={lbl} style={s.posCell}>
                    <Text style={s.posCellLabel}>{lbl}</Text>
                    <Text style={s.posCellVal}>{val}</Text>
                  </View>
                ))}
              </View>
              <View style={s.posActions}>
                <TouchableOpacity style={[s.posBtn, { borderColor: C.up }]}
                  onPress={() => router.push({ pathname: '/(tabs)/ordres' as any, params: { stock: pos.name, direction: 'achat' } })}>
                  <Text style={{ color: C.up, fontSize: 12, fontWeight: '600' }}>📈 Acheter +</Text>
                </TouchableOpacity>
                <TouchableOpacity style={[s.posBtn, { borderColor: C.down }]}
                  onPress={() => router.push({ pathname: '/(tabs)/ordres' as any, params: { stock: pos.name, direction: 'vente' } })}>
                  <Text style={{ color: C.down, fontSize: 12, fontWeight: '600' }}>📉 Vendre</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      {/* Historique */}
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
          <TouchableOpacity style={s.seeAll} onPress={() => router.push('/(tabs)/carnet' as any)}>
            <Text style={{ color: C.accent, fontSize: 13 }}>Voir tout le carnet</Text>
          </TouchableOpacity>
        </View>
      )}

      <TouchableOpacity style={s.alimenterBtn} onPress={alimenterDepuisBanque}>
        <Text style={s.alimenterTxt}>🏦 Alimenter depuis CFC Banque</Text>
      </TouchableOpacity>

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
  alimenterBtn: { margin: 12, marginBottom: 0, padding: 14, borderRadius: 10, backgroundColor: '#1e3a5f', alignItems: 'center' },
  alimenterTxt: { color: '#60a5fa', fontSize: 14, fontWeight: '600' },
  resetBtn:     { margin: 12, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.down, alignItems: 'center' },
  resetTxt:     { color: C.down, fontSize: 13, fontWeight: '500' },
});
