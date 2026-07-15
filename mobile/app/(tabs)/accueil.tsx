// @ts-ignore – expo-router résolu à l'exécution
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Alert, SafeAreaView, RefreshControl,
} from 'react-native';
// @ts-ignore
import { useRouter, useFocusEffect } from 'expo-router';
import { useMarketData } from '../../hooks/useMarketData';
import { getPortfolio, type Portfolio } from '../../services/trading';
import { getValidAccessToken, decodeJwt } from '../../services/auth';
import { CONFIG } from '../../constants/config';

// ── Tokens design ─────────────────────────────────────────────────────────────
const BORDEAUX = '#7B1D3A';
const WHITE    = '#ffffff';
const DARK     = '#1e293b';
const MUTED    = '#64748b';
const LINE     = '#e2e8f0';
const BG       = '#f8fafc';
const UP       = '#16a34a';
const DOWN     = '#dc2626';
const FLAT     = '#64748b';

// ── Formatage ─────────────────────────────────────────────────────────────────
function fmtN(x: number | null | undefined, dp = 2): string {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}
function fmtPct(x: number | null | undefined): string {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  const sign = (x as number) > 0 ? '+' : '';
  return `${sign}${(x as number).toFixed(2)} %`;
}
function varColor(x: number | null | undefined): string {
  if (x == null || isNaN(x as number)) return FLAT;
  return (x as number) > 0 ? UP : (x as number) < 0 ? DOWN : FLAT;
}
function initials(name: string): string {
  return name.split(' ').slice(0, 2).map(w => w[0]?.toUpperCase() ?? '').join('');
}

// ── Hook marchés internationaux (WS /ws/market-global) ───────────────────────
interface GlobalItem {
  symbol: string; label: string; type: string;
  price: number;  pct:   number; change: number;
}

const WS_GLOBAL = CONFIG.API_BASE_URL
  .replace(/^https:\/\//, 'wss://')
  .replace(/^http:\/\//, 'ws://') + '/ws/market-global';

function useGlobalMarkets() {
  const [items, setItems] = useState<GlobalItem[]>([]);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    function connect() {
      try {
        const ws = new WebSocket(WS_GLOBAL);
        wsRef.current = ws;
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'market_global' && Array.isArray(msg.data) && alive) {
              setItems(msg.data);
            }
          } catch {}
        };
        ws.onerror = () => {};
        ws.onclose = () => {
          if (alive) setTimeout(connect, 5000);
        };
      } catch {}
    }
    connect();
    return () => { alive = false; wsRef.current?.close(); };
  }, []);

  return items;
}

// ── Composant badge variation ─────────────────────────────────────────────────
function VarBadge({ pct }: { pct: number | null }) {
  const color = varColor(pct);
  const label = pct == null || isNaN(pct as number) ? '—' : `${(pct as number) > 0 ? '+' : ''}${(pct as number).toFixed(2)} %`;
  return (
    <View style={[badge.wrap, { backgroundColor: color + '18', borderColor: color + '44' }]}>
      <Text style={[badge.txt, { color }]}>{label}</Text>
    </View>
  );
}

// ── Écran Accueil ─────────────────────────────────────────────────────────────
export default function AccueilScreen() {
  const router     = useRouter();
  const { overview, stocks } = useMarketData();
  const globalItems = useGlobalMarkets();

  const [portfolio,    setPortfolio]    = useState<Portfolio>({ balance: 0, positions: [] });
  const [userName,     setUserName]     = useState('Investisseur');
  const [refreshing,   setRefreshing]   = useState(false);

  // Calcul valeur portefeuille
  const valorisation = portfolio.positions.reduce((sum, pos) => {
    const stock = stocks.find(s => s.name === pos.name);
    const price = stock?.price ?? pos.avgPrice;
    return sum + pos.qty * price;
  }, 0);
  const totalValue   = portfolio.balance + valorisation;
  const dailyGain    = portfolio.positions.reduce((sum, pos) => {
    const stock = stocks.find(s => s.name === pos.name);
    if (!stock) return sum;
    return sum + pos.qty * stock.price * (stock.pct / 100);
  }, 0);
  const dailyPct     = totalValue > 0 ? (dailyGain / (totalValue - dailyGain)) * 100 : 0;

  async function loadData() {
    const [pf, token] = await Promise.all([getPortfolio(), getValidAccessToken()]);
    setPortfolio(pf);
    if (token) {
      const claims = decodeJwt(token);
      const name = (claims?.given_name as string)
        || (claims?.name as string)?.split(' ')[0]
        || 'Investisseur';
      setUserName(name);
    }
  }

  useFocusEffect(useCallback(() => { loadData(); }, []));

  async function onRefresh() {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }

  // Alimentation depuis banque
  async function alimenter() {
    try {
      const token = await getValidAccessToken();
      if (!token) {
        Alert.alert('Non connecté', 'Connectez-vous pour alimenter votre compte.');
        return;
      }
      const resp = await fetch(`${CONFIG.API_BASE_URL}/api/portefeuille/comptes-titres`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!resp.ok) throw new Error('Compte titres introuvable');
      const compte = await resp.json();
      const iban: string = compte.iban ?? '';
      if (!iban) throw new Error('IBAN bourse non disponible');

      const ref = 'DEP-' + Math.floor(Math.random() * 0xffffff).toString(16).toUpperCase().padStart(6, '0');
      const url = `${CONFIG.BANQUE_DASHBOARD_URL}/virement?iban=${encodeURIComponent(iban)}&ref=${ref}&from=bourse`;
      Alert.alert(
        'Alimenter votre compte',
        `Vous allez être redirigé vers la banque pour effectuer un virement vers votre compte bourse.\n\nRéférence : ${ref}`,
        [
          { text: 'Annuler', style: 'cancel' },
          { text: 'Continuer', onPress: () => import('react-native').then(rn => rn.Linking.openURL(url)) },
        ],
      );
    } catch (err: any) {
      Alert.alert('Erreur', err.message || 'Impossible d'accéder au compte titres.');
    }
  }

  // Marchés internationaux — sélection de 3 instruments pour l'affichage
  const SHOW_SYMBOLS = ['XAU/USD', 'USO', 'BTC/USD'];
  const globalDisplay = SHOW_SYMBOLS.map(sym => globalItems.find(it => it.symbol === sym)).filter(Boolean) as GlobalItem[];
  const LABELS: Record<string, string> = { 'XAU/USD': 'OR/USD', 'USO': 'BRENT', 'BTC/USD': 'BTC/USD' };

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.root}>
      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={BORDEAUX} />}
      >
        {/* ── Greeting ── */}
        <View style={s.greeting}>
          <View style={s.avatar}>
            <Text style={s.avatarTxt}>{initials(userName)}</Text>
          </View>
          <View style={s.greetingText}>
            <Text style={s.greetingMuted}>Bonjour,</Text>
            <Text style={s.greetingName}>{userName}</Text>
          </View>
          <TouchableOpacity style={s.bell} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
            <Text style={s.bellIcon}>🔔</Text>
          </TouchableOpacity>
        </View>

        {/* ── Carte portefeuille ── */}
        <View style={s.pfCard}>
          <View style={s.pfCardTop}>
            <Text style={s.pfLabel}>VALEUR DU PORTEFEUILLE</Text>
            <Text style={s.pfSub}>Aujourd'hui</Text>
          </View>
          <Text style={s.pfTotal}>{fmtN(totalValue, 2)} <Text style={s.pfCurrency}>MAD</Text></Text>
          <View style={s.pfVar}>
            <Text style={[s.pfVarAmt, { color: dailyGain >= 0 ? '#86efac' : '#fca5a5' }]}>
              {dailyGain >= 0 ? '▲' : '▼'} {fmtN(Math.abs(dailyGain), 2)} MAD
            </Text>
            <Text style={[s.pfVarPct, { color: dailyGain >= 0 ? '#86efac' : '#fca5a5' }]}>
              {' '}{fmtPct(Math.abs(dailyPct))}
            </Text>
          </View>
          <View style={s.pfMeta}>
            <View style={s.pfMetaItem}>
              <Text style={s.pfMetaLabel}>SOLDE DISPO.</Text>
              <Text style={s.pfMetaValue}>{fmtN(portfolio.balance, 0)} MAD</Text>
            </View>
            <View style={s.pfMetaDivider} />
            <View style={s.pfMetaItem}>
              <Text style={s.pfMetaLabel}>VALORISATION TOTALE</Text>
              <Text style={s.pfMetaValue}>{fmtN(valorisation, 0)} MAD</Text>
            </View>
          </View>
        </View>

        {/* ── Boutons d'action ── */}
        <View style={s.actions}>
          <TouchableOpacity style={[s.actBtn, s.actBtnPrimary]} onPress={alimenter}>
            <Text style={s.actIconPrimary}>↓</Text>
            <Text style={s.actLabelPrimary}>Alimenter</Text>
          </TouchableOpacity>

          {[
            { label: 'Acheter', icon: '↑', route: '/ordres' },
            { label: 'Vendre',  icon: '↓', route: '/ordres' },
            { label: 'Marchés', icon: '📊', route: '/marche' },
          ].map(btn => (
            <TouchableOpacity
              key={btn.label}
              style={s.actBtn}
              onPress={() => router.push(btn.route as any)}
            >
              <Text style={s.actIcon}>{btn.icon}</Text>
              <Text style={s.actLabel}>{btn.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Indices boursiers ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Indices boursiers</Text>
            <TouchableOpacity onPress={() => router.push('/marche' as any)}>
              <Text style={s.seeAll}>Voir tout →</Text>
            </TouchableOpacity>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hScroll}>
            {[
              { label: 'MASI',    value: overview.masi,    pct: overview.masiVarJ },
              { label: 'MADEX',   value: null,              pct: null              },
              { label: 'MASI 20', value: null,              pct: null              },
            ].map(idx => (
              <View key={idx.label} style={s.idxCard}>
                <Text style={s.idxLabel}>{idx.label}</Text>
                <Text style={s.idxValue}>{fmtN(idx.value, 2)}</Text>
                <VarBadge pct={idx.pct as number | null} />
              </View>
            ))}
          </ScrollView>
        </View>

        {/* ── Marchés internationaux ── */}
        <View style={s.section}>
          <View style={s.sectionHeader}>
            <Text style={s.sectionTitle}>Marchés internationaux</Text>
            <View style={s.rtBadge}>
              <View style={s.rtDot} />
              <Text style={s.rtLabel}>Temps réel</Text>
            </View>
          </View>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.hScroll}>
            {globalDisplay.length === 0
              ? SHOW_SYMBOLS.map(sym => (
                  <View key={sym} style={s.glCard}>
                    <Text style={s.glSym}>{LABELS[sym] ?? sym}</Text>
                    <Text style={s.glPrice}>—</Text>
                    <VarBadge pct={null} />
                  </View>
                ))
              : globalDisplay.map(it => (
                  <View key={it.symbol} style={s.glCard}>
                    <Text style={s.glSym}>{LABELS[it.symbol] ?? it.label}</Text>
                    <Text style={s.glPrice}>{fmtN(it.price, 2)}</Text>
                    <VarBadge pct={it.pct} />
                  </View>
                ))
            }
          </ScrollView>
        </View>

        <View style={{ height: 12 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:    { flex: 1, backgroundColor: BG },
  scroll:  { flex: 1 },
  content: { paddingBottom: 24 },

  // Greeting
  greeting: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    backgroundColor: WHITE,
    borderBottomWidth: 1, borderBottomColor: LINE,
  },
  avatar: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: BORDEAUX,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 12,
  },
  avatarTxt:    { color: WHITE, fontSize: 15, fontWeight: '700' },
  greetingText: { flex: 1 },
  greetingMuted:{ color: MUTED, fontSize: 12 },
  greetingName: { color: DARK,  fontSize: 16, fontWeight: '700' },
  bell:         { padding: 6 },
  bellIcon:     { fontSize: 22 },

  // Carte portefeuille
  pfCard: {
    margin: 16, borderRadius: 16, padding: 20,
    backgroundColor: BORDEAUX,
    shadowColor: BORDEAUX, shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4, shadowRadius: 12, elevation: 8,
  },
  pfCardTop:    { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 8 },
  pfLabel:      { color: 'rgba(255,255,255,.75)', fontSize: 11, fontWeight: '600', letterSpacing: 0.5 },
  pfSub:        { color: 'rgba(255,255,255,.6)',  fontSize: 11 },
  pfTotal:      { color: WHITE, fontSize: 30, fontWeight: '800', marginBottom: 4 },
  pfCurrency:   { fontSize: 16, fontWeight: '500' },
  pfVar:        { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  pfVarAmt:     { fontSize: 14, fontWeight: '600' },
  pfVarPct:     { fontSize: 13, fontWeight: '500' },
  pfMeta: {
    flexDirection: 'row', alignItems: 'center',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,.2)',
    paddingTop: 14, gap: 0,
  },
  pfMetaItem:   { flex: 1 },
  pfMetaLabel:  { color: 'rgba(255,255,255,.65)', fontSize: 10, fontWeight: '600', letterSpacing: 0.3, marginBottom: 4 },
  pfMetaValue:  { color: WHITE, fontSize: 14, fontWeight: '700' },
  pfMetaDivider:{ width: 1, height: 36, backgroundColor: 'rgba(255,255,255,.2)', marginHorizontal: 12 },

  // Boutons d'action
  actions: {
    flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 4,
  },
  actBtn: {
    flex: 1, alignItems: 'center', paddingVertical: 14,
    backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: LINE,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06, shadowRadius: 4, elevation: 2,
  },
  actBtnPrimary: { backgroundColor: BORDEAUX, borderColor: BORDEAUX },
  actIcon:       { fontSize: 20, marginBottom: 4, color: DARK },
  actIconPrimary:{ fontSize: 20, marginBottom: 4, color: WHITE },
  actLabel:      { fontSize: 10, fontWeight: '600', color: DARK },
  actLabelPrimary:{ fontSize: 10, fontWeight: '600', color: WHITE },

  // Sections
  section: { marginTop: 20, paddingHorizontal: 16 },
  sectionHeader: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 12,
  },
  sectionTitle: { color: DARK, fontSize: 16, fontWeight: '700' },
  seeAll:       { color: BORDEAUX, fontSize: 13, fontWeight: '600' },
  hScroll:      { overflow: 'visible' },

  // Carte indice BVC
  idxCard: {
    backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: LINE,
    padding: 14, marginRight: 10, minWidth: 110,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  idxLabel: { color: MUTED,  fontSize: 11, fontWeight: '600', marginBottom: 6 },
  idxValue: { color: DARK,   fontSize: 16, fontWeight: '700', marginBottom: 6 },

  // Badge "Temps réel"
  rtBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  rtDot:   { width: 7, height: 7, borderRadius: 4, backgroundColor: UP },
  rtLabel: { color: UP, fontSize: 12, fontWeight: '600' },

  // Carte marché international
  glCard: {
    backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: LINE,
    padding: 14, marginRight: 10, minWidth: 110,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
  },
  glSym:   { color: MUTED, fontSize: 11, fontWeight: '600', marginBottom: 6 },
  glPrice: { color: DARK,  fontSize: 16, fontWeight: '700', marginBottom: 6 },
});

// Styles badge variation
const badge = StyleSheet.create({
  wrap: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1, alignSelf: 'flex-start' },
  txt:  { fontSize: 11, fontWeight: '600' },
});
