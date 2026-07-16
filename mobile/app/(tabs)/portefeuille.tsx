import { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Alert,
  ScrollView, Linking, StatusBar,
} from 'react-native';
// @ts-ignore
import { useFocusEffect, useRouter, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMenu } from './menu-context';
import { getPortfolio, getOrders, Portfolio, Order, resetPortfolio } from '../../services/trading';
import { useMarketData } from '../../hooks/useMarketData';
import { CONFIG } from '../../constants/config';
import { getValidAccessToken } from '../../services/auth';

// ── Tokens ────────────────────────────────────────────────────────────────────
const BG       = '#f8fafc';
const WHITE    = '#ffffff';
const DARK     = '#1e293b';
const MUTED    = '#64748b';
const LINE     = '#e2e8f0';
const BORDEAUX = '#7B1D3A';
const UP       = '#16a34a';
const DOWN     = '#dc2626';

// ── Utilitaires ───────────────────────────────────────────────────────────────
function fmtN(x: number | null | undefined, dp = 2): string {
  if (x == null || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
}
function fmtDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) + ' ' +
         d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}
function fmtIban(iban: string): string {
  return iban.replace(/(.{4})/g, '$1 ').trim();
}
function abbrev(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length === 1) return name.slice(0, 4).toUpperCase();
  return words.slice(0, 4).map(w => w[0]).join('').toUpperCase();
}

// ── Types compte ──────────────────────────────────────────────────────────────
interface CompteInfo { ref: string; iban: string; statut: string }

// ── Écran ─────────────────────────────────────────────────────────────────────
export default function PortefeuilleScreen() {
  const openMenu = useMenu();
  const [portfolio,    setPortfolio]    = useState<Portfolio>({ balance: 0, positions: [] });
  const [history,      setHistory]      = useState<Order[]>([]);
  const [compteInfo,   setCompteInfo]   = useState<CompteInfo | null>(null);
  const { stocks } = useMarketData();
  const router = useRouter();
  const params = useLocalSearchParams<{ depot_ref?: string; depot_status?: string }>();

  useFocusEffect(useCallback(() => {
    getPortfolio().then(setPortfolio);
    getOrders().then(orders =>
      setHistory(orders.filter(o => o.status === 'exécuté').slice(0, 5))
    );
    // Charger infos compte titres (IBAN, ref)
    getValidAccessToken().then(token => {
      if (!token) return;
      fetch(`${CONFIG.API_BASE_URL}/api/portefeuille/comptes-titres`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(r => r.ok ? r.json() : null)
        .then(data => { if (data) setCompteInfo({ ref: data.ref ?? '', iban: data.iban ?? '', statut: data.statut ?? 'ACTIF' }); })
        .catch(() => {});
    });
    if (params.depot_ref && params.depot_status === 'ok') {
      Alert.alert('Dépôt initié', `Virement reçu (réf: ${params.depot_ref}). Votre solde sera mis à jour sous peu.`);
    }
  }, [params.depot_ref, params.depot_status]));

  // ── P&L ──────────────────────────────────────────────────────────────────────
  const totalValue = portfolio.positions.reduce((acc, pos) => {
    const cur = stocks.find(s => s.name === pos.name)?.price ?? pos.avgPrice;
    return acc + pos.qty * cur;
  }, 0);
  const totalCost = portfolio.positions.reduce((acc, pos) => acc + pos.qty * pos.avgPrice, 0);
  const totalPl   = totalValue - totalCost;
  const plPct     = totalCost ? totalPl / totalCost * 100 : 0;

  // ── Alimentation ─────────────────────────────────────────────────────────────
  const alimenter = useCallback(async () => {
    try {
      const token = await getValidAccessToken();
      if (!token) { Alert.alert('Non connecté', "Connectez-vous d'abord."); return; }
      const resp = await fetch(`${CONFIG.API_BASE_URL}/api/portefeuille/comptes-titres`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Compte titres introuvable');
      const compte = await resp.json();
      const iban: string = compte.iban ?? '';
      if (!iban) throw new Error('IBAN bourse non disponible');
      const hexPart = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0').toUpperCase();
      const tsPart  = Date.now().toString(36).slice(-6).toUpperCase();
      const ref     = `BRS${hexPart}${tsPart}`;
      const retour  = `bourseenligne://depot-confirm?ref=${ref}`;
      const deepLink = `cfcdigibank://alimenter-bourse?ref=${ref}&iban=${encodeURIComponent(iban)}&retour=${encodeURIComponent(retour)}`;
      const canOpen  = await Linking.canOpenURL(deepLink);
      if (canOpen) {
        await Linking.openURL(deepLink);
      } else {
        const banqueUrl = `${CONFIG.BANQUE_DASHBOARD_URL}?action=alimenter-bourse&ref=${ref}&iban=${encodeURIComponent(iban)}&retour=${encodeURIComponent(retour)}`;
        Linking.openURL(banqueUrl).catch(() => {});
      }
    } catch (e: any) {
      Alert.alert('Erreur', e.message || 'Impossible de contacter la banque.');
    }
  }, []);

  const handleReset = () => {
    Alert.alert('Réinitialiser', 'Remettre 100 000 MAD et supprimer toutes les positions ?', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Confirmer', style: 'destructive', onPress: async () => {
        await resetPortfolio();
        setPortfolio({ balance: 100_000, positions: [] });
        setHistory([]);
      }},
    ]);
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={WHITE} />

      {/* ── En-tête blanc ── */}
      <View style={s.header}>
        <TouchableOpacity onPress={openMenu} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="menu-outline" size={26} color={DARK} />
        </TouchableOpacity>
        <Text style={s.headerTitle}>Mon portefeuille</Text>
        <TouchableOpacity style={s.alimenterBtn} onPress={alimenter}>
          <Text style={s.alimenterTxt}>+ Alimenter</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={{ paddingBottom: 32 }} showsVerticalScrollIndicator={false}>

        {/* ── Carte compte titres ── */}
        <View style={s.comptCard}>
          <View style={s.comptTop}>
            <Text style={s.comptRef}>
              COMPTE TITRES{compteInfo?.ref ? ` · ${compteInfo.ref}` : ''}
            </Text>
            <View style={s.actifBadge}>
              <Text style={s.actifTxt}>{compteInfo?.statut ?? 'ACTIF'}</Text>
            </View>
          </View>
          <Text style={s.comptLabel}>Valorisation totale</Text>
          <Text style={s.comptValue}>{fmtN(totalValue, 2)} <Text style={s.comptCurrency}>MAD</Text></Text>
          {compteInfo?.iban ? (
            <Text style={s.comptIban} numberOfLines={1}>{fmtIban(compteInfo.iban)}</Text>
          ) : null}
        </View>

        {/* ── 3 KPI cards ── */}
        <View style={s.kpiRow}>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>SOLDE DISPO.</Text>
            <Text style={s.kpiValue} numberOfLines={1}>{fmtN(portfolio.balance, 0)}</Text>
            <Text style={s.kpiUnit}>MAD</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>VALEUR PORTEF.</Text>
            <Text style={s.kpiValue} numberOfLines={1}>{fmtN(totalValue, 0)}</Text>
            <Text style={s.kpiUnit}>MAD</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>PLUS-VALUE</Text>
            <Text style={[s.kpiValue, { color: totalPl >= 0 ? UP : DOWN }]} numberOfLines={1}>
              {totalPl >= 0 ? '+' : ''}{fmtN(totalPl, 0)}
            </Text>
            <Text style={[s.kpiUnit, { color: totalPl >= 0 ? UP : DOWN }]}>
              {totalPl >= 0 ? '+' : ''}{fmtN(plPct)} %
            </Text>
          </View>
        </View>

        {/* ── Mes positions ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Mes positions</Text>
            {portfolio.positions.length > 0 && (
              <Text style={s.sectionCount}>{portfolio.positions.length} ligne{portfolio.positions.length > 1 ? 's' : ''}</Text>
            )}
          </View>

          {portfolio.positions.length === 0 ? (
            <View style={s.emptyBox}>
              <Text style={s.emptyTxt}>Aucune position ouverte.</Text>
              <TouchableOpacity onPress={() => router.push('/(tabs)/ordres' as any)} style={s.emptyBtn}>
                <Text style={{ color: BORDEAUX, fontWeight: '600' }}>Passer un premier ordre →</Text>
              </TouchableOpacity>
            </View>
          ) : portfolio.positions.map(pos => {
            const cur  = stocks.find(s => s.name === pos.name)?.price ?? pos.avgPrice;
            const val  = pos.qty * cur;
            const cost = pos.qty * pos.avgPrice;
            const pl   = val - cost;
            const pp   = cost ? pl / cost * 100 : 0;
            const delta = cur - pos.avgPrice;
            return (
              <View key={pos.name} style={s.posCard}>
                {/* En-tête position */}
                <View style={s.posTop}>
                  <View style={s.posLeft}>
                    <View style={s.posTickerWrap}>
                      <Text style={s.posTicker}>{abbrev(pos.name)}</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={s.posName} numberOfLines={1}>{pos.name}</Text>
                      <Text style={s.posQty}>- {pos.qty} titre{pos.qty > 1 ? 's' : ''}</Text>
                    </View>
                  </View>
                  <View style={s.posRight}>
                    <Text style={[s.posPl, { color: pl >= 0 ? UP : DOWN }]}>
                      {pl >= 0 ? '+' : ''}{fmtN(pl, 2)} MAD
                    </Text>
                    <Text style={[s.posPct, { color: pl >= 0 ? UP : DOWN }]}>
                      {pl >= 0 ? '+' : ''}{fmtN(pp)} %
                    </Text>
                  </View>
                </View>

                {/* Détail */}
                <View style={s.posDetail}>
                  {[
                    { label: 'Prix moy. pondéré', value: fmtN(pos.avgPrice) },
                    { label: 'Cours actuel',       value: fmtN(cur) },
                    { label: 'Δ MAD',              value: `${delta >= 0 ? '+' : ''}${fmtN(delta)}` },
                  ].map(col => (
                    <View key={col.label} style={s.posCol}>
                      <Text style={s.posColLabel}>{col.label}</Text>
                      <Text style={[s.posColValue, col.label === 'Δ MAD' && { color: delta >= 0 ? UP : DOWN }]}>
                        {col.value}
                      </Text>
                    </View>
                  ))}
                </View>

                {/* Actions */}
                <View style={s.posActions}>
                  <TouchableOpacity
                    style={[s.posBtn, { borderColor: UP + '66', backgroundColor: UP + '10' }]}
                    onPress={() => router.push({ pathname: '/(tabs)/ordres' as any, params: { stock: pos.name, direction: 'achat' } })}
                  >
                    <Text style={{ color: UP, fontSize: 12, fontWeight: '600' }}>Acheter +</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[s.posBtn, { borderColor: DOWN + '66', backgroundColor: DOWN + '10' }]}
                    onPress={() => router.push({ pathname: '/(tabs)/ordres' as any, params: { stock: pos.name, direction: 'vente' } })}
                  >
                    <Text style={{ color: DOWN, fontSize: 12, fontWeight: '600' }}>Vendre</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
        </View>

        {/* ── Derniers mouvements ── */}
        {history.length > 0 && (
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>Derniers mouvements</Text>
            </View>
            {history.map(o => (
              <View key={o.id} style={s.histRow}>
                <View style={s.histLeft}>
                  <Text style={s.histName}>{o.name}</Text>
                  <Text style={s.histDate}>{fmtDate(o.executionDate ?? o.date)}</Text>
                </View>
                <View style={s.histRight}>
                  <Text style={[s.histDir, { color: o.direction === 'achat' ? UP : DOWN }]}>
                    {o.direction === 'achat' ? '▲' : '▼'} {o.qty} titre(s)
                  </Text>
                  <Text style={s.histTotal}>{fmtN(o.total)} MAD</Text>
                </View>
              </View>
            ))}
            <TouchableOpacity style={s.seeAll} onPress={() => router.push('/(tabs)/carnet' as any)}>
              <Text style={{ color: BORDEAUX, fontSize: 13, fontWeight: '600' }}>Voir tout le carnet →</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Reset (discret) ── */}
        <TouchableOpacity style={s.resetBtn} onPress={handleReset}>
          <Text style={s.resetTxt}>Réinitialiser le portefeuille</Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },

  // En-tête
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: WHITE, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: LINE,
  },
  headerTitle:   { fontSize: 20, fontWeight: '800', color: DARK },
  alimenterBtn:  { backgroundColor: BORDEAUX, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 8 },
  alimenterTxt:  { color: WHITE, fontSize: 13, fontWeight: '700' },

  // Carte compte titres
  comptCard: {
    margin: 16, borderRadius: 16, padding: 20,
    backgroundColor: BORDEAUX,
    shadowColor: BORDEAUX, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35, shadowRadius: 12, elevation: 8,
  },
  comptTop:    { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  comptRef:    { color: 'rgba(255,255,255,.75)', fontSize: 11, fontWeight: '600', letterSpacing: 0.4, flex: 1 },
  actifBadge:  { backgroundColor: '#16a34a', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 3 },
  actifTxt:    { color: WHITE, fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  comptLabel:  { color: 'rgba(255,255,255,.7)', fontSize: 12, marginBottom: 6 },
  comptValue:  { color: WHITE, fontSize: 30, fontWeight: '800', marginBottom: 8 },
  comptCurrency:{ fontSize: 16, fontWeight: '500' },
  comptIban:   { color: 'rgba(255,255,255,.55)', fontSize: 11, letterSpacing: 1 },

  // KPI row
  kpiRow:  { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 8 },
  kpiCard: {
    flex: 1, backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: LINE, padding: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  kpiLabel: { fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  kpiValue: { fontSize: 15, fontWeight: '700', color: DARK },
  kpiUnit:  { fontSize: 10, color: MUTED, marginTop: 3 },

  // Section
  section:       { paddingHorizontal: 16, marginBottom: 16 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: DARK },
  sectionCount:  { fontSize: 12, color: MUTED, fontWeight: '500' },

  // Empty state
  emptyBox: { backgroundColor: WHITE, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: LINE },
  emptyTxt: { color: MUTED, fontSize: 14, marginBottom: 12 },
  emptyBtn: { padding: 8 },

  // Position cards
  posCard: {
    backgroundColor: WHITE, borderRadius: 14,
    borderWidth: 1, borderColor: LINE, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06, shadowRadius: 6, elevation: 3,
    overflow: 'hidden',
  },
  posTop:      { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', padding: 14 },
  posLeft:     { flexDirection: 'row', alignItems: 'center', flex: 1, gap: 10 },
  posTickerWrap:{ width: 40, height: 40, borderRadius: 8, backgroundColor: BORDEAUX + '15', alignItems: 'center', justifyContent: 'center' },
  posTicker:   { fontSize: 12, fontWeight: '800', color: BORDEAUX },
  posName:     { fontSize: 14, fontWeight: '700', color: DARK, flex: 1 },
  posQty:      { fontSize: 11, color: MUTED, marginTop: 2 },
  posRight:    { alignItems: 'flex-end' },
  posPl:       { fontSize: 14, fontWeight: '700' },
  posPct:      { fontSize: 12, fontWeight: '600', marginTop: 2 },

  posDetail: {
    flexDirection: 'row', paddingHorizontal: 14, paddingBottom: 12,
    borderTopWidth: 1, borderTopColor: LINE, paddingTop: 12, gap: 8,
  },
  posCol:      { flex: 1 },
  posColLabel: { fontSize: 10, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 },
  posColValue: { fontSize: 13, fontWeight: '600', color: DARK },

  posActions: { flexDirection: 'row', gap: 8, padding: 12, paddingTop: 0 },
  posBtn:     { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },

  // Historique
  histRow:  { flexDirection: 'row', alignItems: 'center', backgroundColor: WHITE, borderRadius: 10, padding: 12, marginBottom: 8, borderWidth: 1, borderColor: LINE },
  histLeft: { flex: 1 },
  histRight:{ alignItems: 'flex-end' },
  histName: { fontSize: 14, fontWeight: '600', color: DARK },
  histDate: { fontSize: 11, color: MUTED, marginTop: 2 },
  histDir:  { fontSize: 13, fontWeight: '600' },
  histTotal:{ fontSize: 12, color: MUTED, marginTop: 2 },
  seeAll:   { padding: 8, alignItems: 'center' },

  // Reset
  resetBtn: { margin: 16, marginTop: 4, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: LINE, alignItems: 'center' },
  resetTxt: { color: MUTED, fontSize: 13 },
});
