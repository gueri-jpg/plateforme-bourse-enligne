import React, { useCallback, useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  View, Text, StyleSheet, ScrollView,
  TouchableOpacity, RefreshControl, Alert, Modal,
  StatusBar as RNStatusBar, Animated, Easing,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import {
  Bell, ArrowDownToLine, ArrowUpRight, ArrowDownRight,
  BarChart2, TrendingUp, Flame, Bitcoin,
} from 'lucide-react-native';
import { useAuth } from '../store/useAuth';
import { useMarketData } from '../../hooks/useMarketData';
import { fetchPortfolio } from '../api/portfolio';
import { CONFIG } from '../../constants/config';
import { AlimenterModal, checkBanqueActive } from '../components/AlimenterModal';
import { useNotifications } from '../store/useNotifications';
import { useMenu } from '../navigation/menu-context';
import type { MainTabParamList } from '../navigation/types';

// ── Hook marchés internationaux (/ws/market-global) ─────────────────────────
interface GlobalItem {
  symbol: string; label: string; type: string;
  price: number;  pct: number;  change: number;
}

type GlobalStatus = 'loading' | 'ok' | 'stale' | 'unavailable';

const CACHE_KEY = 'global_markets_cache';

async function loadCache(): Promise<{ items: GlobalItem[]; ts: string } | null> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function saveCache(items: GlobalItem[]) {
  try {
    await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ items, ts: new Date().toISOString() }));
  } catch {}
}

function useGlobalMarkets(): { items: GlobalItem[]; status: GlobalStatus; cacheTs: string | null } {
  const [items,   setItems]   = useState<GlobalItem[]>([]);
  const [status,  setStatus]  = useState<GlobalStatus>('loading');
  const [cacheTs, setCacheTs] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    // Charger le cache immédiatement
    loadCache().then(cached => {
      if (cached && alive && items.length === 0) {
        setItems(cached.items);
        setCacheTs(cached.ts);
        setStatus('stale');
      }
    });

    function connect() {
      try {
        const ws = new WebSocket(CONFIG.WS_GLOBAL_URL);
        wsRef.current = ws;
        ws.onmessage = (e) => {
          try {
            const msg = JSON.parse(e.data);
            if (msg.type === 'market_global' && Array.isArray(msg.data) && alive) {
              setItems(msg.data);
              setStatus('ok');
              setCacheTs(null);
              void saveCache(msg.data);
            }
          } catch {}
        };
        ws.onerror  = () => { if (alive) setStatus(s => s === 'loading' ? 'unavailable' : s === 'stale' ? 'stale' : 'unavailable'); };
        ws.onclose  = () => { if (alive) setTimeout(connect, 5000); };
      } catch { if (alive) setStatus(s => s === 'stale' ? 'stale' : 'unavailable'); }
    }
    connect();
    const timer = setTimeout(() => {
      if (alive) setStatus(s => s === 'loading' ? 'unavailable' : s);
    }, 10000);
    return () => { alive = false; clearTimeout(timer); wsRef.current?.close(); };
  }, []);

  return { items, status, cacheTs };
}

// ── Couleurs ────────────────────────────────────────────────────────────────
const BG       = '#f8fafc';
const CARD     = '#ffffff';
const BORD     = '#7B1D3A';
const PORTF_BG = '#1A060E';   // carte portefeuille sombre bordeaux
const DARK     = '#0f172a';
const MUTED    = '#64748b';
const LINE     = '#e8edf5';
const GREEN    = '#16a34a';
const GREEN_BG = '#dcfce7';
const RED      = '#dc2626';
const RED_BG   = '#fee2e2';
const BLUE     = '#2563eb';

type Nav = BottomTabNavigationProp<MainTabParamList>;

// ── Helpers ─────────────────────────────────────────────────────────────────
function initials(name: string): string {
  return name
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map(w => w[0].toUpperCase())
    .join('');
}

function fmtMAD(x: number | null | undefined): string {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(x: number | null | undefined): string {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  const abs = Math.abs(x as number);
  return `${(x as number) >= 0 ? '+' : '-'}${abs.toFixed(2)} %`;
}

// ── Sous-composants ──────────────────────────────────────────────────────────
function IndexCard({ label, value, pct }: { label: string; value: number | null; pct: number | null }) {
  const isUp   = pct !== null && !isNaN(pct) && pct >= 0;
  const hasVal = value !== null && !isNaN(value as number);
  return (
    <View style={s.indexCard}>
      <Text style={s.indexLabel}>{label}</Text>
      <Text style={s.indexValue}>{hasVal ? fmtMAD(value) : '—'}</Text>
      {pct !== null && !isNaN(pct) && (
        <View style={[s.pctBadge, { backgroundColor: isUp ? GREEN_BG : RED_BG }]}>
          <Text style={[s.pctText, { color: isUp ? GREEN : RED }]}>{fmtPct(pct)}</Text>
        </View>
      )}
    </View>
  );
}

function IntlCard({ icon, label, value, pct }: {
  icon: React.ReactNode; label: string; value: string; pct: number;
}) {
  const isUp = pct >= 0;
  return (
    <View style={s.indexCard}>
      <View style={s.intlHeader}>
        {icon}
        <Text style={s.intlLabel}>{label}</Text>
      </View>
      <Text style={s.indexValue}>{value}</Text>
      <View style={[s.pctBadge, { backgroundColor: isUp ? GREEN_BG : RED_BG }]}>
        <Text style={[s.pctText, { color: isUp ? GREEN : RED }]}>{fmtPct(pct)}</Text>
      </View>
    </View>
  );
}

function globalIcon(item: GlobalItem) {
  const sym = item.symbol.toUpperCase();
  if (sym.includes('BTC') || sym.includes('ETH') || item.type === 'crypto')
    return <Bitcoin size={13} color="#f97316" strokeWidth={2} />;
  if (sym.includes('XAU') || sym.includes('GOLD'))
    return <TrendingUp size={13} color="#f59e0b" strokeWidth={2} />;
  if (sym.includes('USO') || sym.includes('OIL') || sym.includes('WTI') || sym.includes('BRENT'))
    return <Flame size={13} color={MUTED} strokeWidth={2} />;
  return <BarChart2 size={13} color={BLUE} strokeWidth={2} />;
}

// ── Ticker BVC ──────────────────────────────────────────────────────────────
function TickerBand() {
  const { stocks } = useMarketData();
  const animX = useRef(new Animated.Value(0)).current;
  const halfW  = useRef(0);
  const anim   = useRef<Animated.CompositeAnimation | null>(null);

  function startLoop(w: number) {
    anim.current?.stop();
    animX.setValue(0);
    // ~55 px/s pour un défilement lisible ; minimum 10 secondes
    const duration = Math.max(10000, Math.round((w / 55) * 1000));
    anim.current = Animated.loop(
      Animated.timing(animX, {
        toValue:         -w,
        duration,
        useNativeDriver: true,
        easing:          Easing.linear,
      })
    );
    anim.current.start();
  }

  useEffect(() => {
    if (halfW.current > 0) startLoop(halfW.current);
    return () => { anim.current?.stop(); };
  }, [stocks.length]);

  const visible = stocks.filter(s => !isNaN(s.price));
  if (visible.length === 0) return null;

  const doubled = [...visible, ...visible];

  return (
    <View style={tk.outer}>
      <Animated.View
        style={[tk.track, { transform: [{ translateX: animX }] }]}
        onLayout={e => {
          const w = e.nativeEvent.layout.width / 2;
          if (w > 0 && Math.abs(w - halfW.current) > 1) {
            halfW.current = w;
            startLoop(w);
          }
        }}
      >
        {doubled.map((s, i) => {
          const up   = s.pct > 0;
          const down = s.pct < 0;
          const col  = up ? '#86efac' : down ? '#fca5a5' : 'rgba(255,255,255,.45)';
          const sign = up ? '▲ ' : down ? '▼ ' : '';
          return (
            <View key={i} style={tk.item}>
              <Text style={tk.name} numberOfLines={1}>{s.name}</Text>
              <View style={tk.row}>
                <Text style={tk.price}>{s.price.toFixed(2)}</Text>
                <Text style={[tk.var_, { color: col }]}>
                  {sign}{Math.abs(s.pct).toFixed(2)}%
                </Text>
              </View>
            </View>
          );
        })}
      </Animated.View>
    </View>
  );
}

const tk = StyleSheet.create({
  outer: { height: 48, backgroundColor: '#0f172a', overflow: 'hidden' },
  track: { flexDirection: 'row', alignItems: 'center', height: 48, alignSelf: 'flex-start' },
  item:  {
    flexDirection: 'column', justifyContent: 'center', alignItems: 'flex-start',
    paddingHorizontal: 16, height: 48,
    borderRightWidth: 1, borderRightColor: 'rgba(255,255,255,.12)',
    minWidth: 90,
  },
  name:  { color: '#ffffff', fontWeight: '700', fontSize: 10, letterSpacing: 0.3 },
  row:   { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 2 },
  price: { color: 'rgba(255,255,255,.8)', fontSize: 10, fontVariant: ['tabular-nums'] },
  var_:  { fontSize: 10, fontVariant: ['tabular-nums'] },
});

// ── Écran principal ──────────────────────────────────────────────────────────
export function AccueilScreen() {
  const navigation  = useNavigation<Nav>();
  const { user }    = useAuth();
  const { overview } = useMarketData();

  const { items: globalItems, status: globalStatus, cacheTs } = useGlobalMarkets();
  const [solde,   setSolde]   = useState<number | null>(null);
  const [valeur,  setValeur]  = useState<number | null>(null);
  const [iban,    setIban]    = useState<string | null>(null);
  const [refreshing, setRef]  = useState(false);
  const [showAlimenter, setShowAlimenter] = useState(false);
  const [showNotifs,    setShowNotifs]    = useState(false);

  const { notifications, unread, markAllRead } = useNotifications();

  // Charger le cache portefeuille au montage (affichage instantané)
  useEffect(() => {
    AsyncStorage.getItem('portfolio_cache').then(raw => {
      if (!raw) return;
      try {
        const c = JSON.parse(raw);
        setSolde(c.solde); setValeur(c.valeur); setIban(c.iban ?? null);
      } catch {}
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const p = await fetchPortfolio();
      setSolde(p.solde_especes);
      setValeur(p.valorisation_totale ?? p.valeur_marche);
      setIban(p.iban ?? null);
      AsyncStorage.setItem('portfolio_cache', JSON.stringify({
        solde: p.solde_especes,
        valeur: p.valorisation_totale ?? p.valeur_marche,
        iban: p.iban ?? null,
      })).catch(() => {});
    } catch {}
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onRefresh = async () => { setRef(true); await load(); setRef(false); };

  const openMenu  = useMenu();
  const firstName = user?.name?.split(' ')[0] ?? 'Bienvenue';
  const avatar    = user?.name ? initials(user.name) : '?';

  // Variation portefeuille : on utilise masiVarJ comme proxy (POC)
  const varPct = overview.masiVarJ;
  const varMAD = valeur !== null && varPct !== null
    ? valeur * (varPct / 100)
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: BG, paddingTop: RNStatusBar.currentHeight ?? 0 }}>
    <ScrollView
      style={s.scroll}
      contentContainerStyle={{ paddingBottom: 32 }}
      showsVerticalScrollIndicator={false}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={MUTED} />}
    >
      {/* ── Header ── */}
      <View style={s.header}>
        <View style={s.headerLeft}>
          <TouchableOpacity style={s.avatar} onPress={() => openMenu('left')} activeOpacity={0.75}>
            <Text style={s.avatarTxt}>{avatar}</Text>
          </TouchableOpacity>
          <View>
            <Text style={s.greetSmall}>Bonjour,</Text>
            <Text style={s.greetName}>{firstName}</Text>
          </View>
        </View>
        <TouchableOpacity style={s.bellWrap} onPress={() => { markAllRead(); setShowNotifs(true); }}>
          <Bell size={22} color={DARK} strokeWidth={1.8} />
          {unread > 0 && (
            <View style={s.bellBadge}>
              <Text style={s.bellBadgeTxt}>{unread > 9 ? '9+' : String(unread)}</Text>
            </View>
          )}
        </TouchableOpacity>
      </View>

      {/* ── Ticker cours BVC ── */}
      <TickerBand />

      {/* ── Carte portefeuille ── */}
      <View style={s.portfCard}>
        <View style={s.portfTop}>
          <Text style={s.portfTopLabel}>VALEUR DU PORTEFEUILLE</Text>
          <Text style={s.portfTopDate}>Aujourd'hui</Text>
        </View>

        <View style={s.portfMain}>
          <Text style={s.portfAmount}>
            {valeur !== null ? fmtMAD(valeur) : '—'}
            <Text style={s.portfCurrency}>{' '}MAD</Text>
          </Text>
          {varMAD !== null && varPct !== null && (
            <View style={s.portfVar}>
              <Text style={s.portfVarAmt}>
                {varMAD >= 0 ? '↗' : '↘'} {varMAD >= 0 ? '+' : ''}{fmtMAD(varMAD)} MAD
              </Text>
              <Text style={s.portfVarPct}>{fmtPct(varPct)}</Text>
            </View>
          )}
        </View>

        <View style={s.portfDivider} />

        <View style={s.portfRow}>
          <View>
            <Text style={s.portfSubLabel}>SOLDE DISPO.</Text>
            <Text style={s.portfSubVal}>{solde !== null ? `${fmtMAD(solde)} MAD` : '—'}</Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={s.portfSubLabel}>VALORISATION TOTALE</Text>
            <Text style={s.portfSubVal}>{valeur !== null ? `${fmtMAD(valeur)} MAD` : '—'}</Text>
          </View>
        </View>
      </View>

      {/* ── Actions rapides ── */}
      <View style={s.actionsRow}>
        {/* Alimenter — bordeaux plein */}
        <TouchableOpacity
          style={[s.actionBtn, s.actionBtnFilled]}
          onPress={async () => { const ok = await checkBanqueActive(); if (ok) setShowAlimenter(true); }}
        >
          <ArrowDownToLine size={20} color="#fff" strokeWidth={2} />
          <Text style={[s.actionLabel, { color: '#fff' }]}>Alimenter</Text>
        </TouchableOpacity>

        {/* Acheter — contour vert */}
        <TouchableOpacity
          style={[s.actionBtn, s.actionBtnGhost, { borderColor: GREEN }]}
          onPress={() => navigation.navigate('Ordre', { direction: 'achat' })}
        >
          <ArrowUpRight size={20} color={GREEN} strokeWidth={2} />
          <Text style={[s.actionLabel, { color: GREEN }]}>Acheter</Text>
        </TouchableOpacity>

        {/* Vendre — contour rouge */}
        <TouchableOpacity
          style={[s.actionBtn, s.actionBtnGhost, { borderColor: RED }]}
          onPress={() => navigation.navigate('Ordre', { direction: 'vente' })}
        >
          <ArrowDownRight size={20} color={RED} strokeWidth={2} />
          <Text style={[s.actionLabel, { color: RED }]}>Vendre</Text>
        </TouchableOpacity>

        {/* Marchés — contour bleu */}
        <TouchableOpacity
          style={[s.actionBtn, s.actionBtnGhost, { borderColor: BLUE }]}
          onPress={() => navigation.navigate('Marche')}
        >
          <BarChart2 size={20} color={BLUE} strokeWidth={2} />
          <Text style={[s.actionLabel, { color: BLUE }]}>Marchés</Text>
        </TouchableOpacity>
      </View>

      {/* ── Indices boursiers ── */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Indices boursiers</Text>
          <TouchableOpacity onPress={() => navigation.navigate('Marche')}>
            <Text style={s.sectionLink}>Voir tout ›</Text>
          </TouchableOpacity>
        </View>
        <View style={s.cardsRow}>
          <IndexCard
            label="MASI"
            value={overview.masi}
            pct={overview.masiVarJ}
          />
          <IndexCard label="MADEX"  value={1214.68} pct={0.76} />
          <IndexCard label="MASI 20" value={1156.32} pct={-0.12} />
        </View>
      </View>

      {/* ── Marchés internationaux ── */}
      <View style={s.section}>
        <View style={s.sectionHeader}>
          <Text style={s.sectionTitle}>Marchés internationaux</Text>
          {globalStatus === 'ok' ? (
            <View style={s.liveRow}>
              <View style={s.liveDot} />
              <Text style={s.liveTxt}>Temps réel</Text>
            </View>
          ) : globalStatus === 'stale' && cacheTs ? (
            <Text style={{ fontSize: 11, color: MUTED }}>
              {new Date(cacheTs).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}
            </Text>
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingBottom: 4 }}
        >
          {globalStatus === 'loading' ? (
            <Text style={{ color: MUTED, fontSize: 13, fontStyle: 'italic' }}>Chargement…</Text>
          ) : globalStatus === 'unavailable' && globalItems.length === 0 ? (
            <Text style={{ color: MUTED, fontSize: 13, fontStyle: 'italic' }}>Données indisponibles</Text>
          ) : globalItems.map((item: GlobalItem) => (
            <View key={item.symbol} style={{ width: 120 }}>
              <IntlCard
                icon={globalIcon(item)}
                label={item.label || item.symbol}
                value={fmtMAD(item.price)}
                pct={item.pct ?? 0}
              />
            </View>
          ))}
        </ScrollView>
      </View>
      <AlimenterModal
        visible={showAlimenter}
        iban={iban}
        onClose={() => setShowAlimenter(false)}
        onSuccess={(res) => {
          setSolde(res.nouveau_solde);
          Alert.alert(
            'Dépôt crédité ✓',
            `${res.montant_credite.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${res.devise} crédités.\nNouveau solde : ${res.nouveau_solde.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${res.devise}`,
          );
        }}
      />

      {/* ── Panneau notifications ── */}
      <Modal visible={showNotifs} transparent animationType="slide" onRequestClose={() => setShowNotifs(false)}>
        <View style={s.notifOverlay}>
          <View style={s.notifCard}>
            <View style={s.notifHeader}>
              <Text style={s.notifTitle}>Notifications</Text>
              <TouchableOpacity onPress={() => setShowNotifs(false)}>
                <Text style={{ color: MUTED, fontSize: 14 }}>Fermer</Text>
              </TouchableOpacity>
            </View>
            {notifications.length === 0 ? (
              <Text style={s.notifEmpty}>Aucune notification</Text>
            ) : (
              <ScrollView showsVerticalScrollIndicator={false}>
                {notifications.map(n => (
                  <View key={n.id} style={s.notifRow}>
                    <Text style={s.notifIcon}>
                      {n.type === 'alimentation' ? '💰' : n.type === 'achat' ? '📈' : '📉'}
                    </Text>
                    <View style={{ flex: 1 }}>
                      <Text style={s.notifRowTitle}>{n.title}</Text>
                      <Text style={s.notifRowBody}>{n.body}</Text>
                      <Text style={s.notifRowDate}>
                        {new Date(n.date).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </Text>
                    </View>
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </ScrollView>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  scroll:     { flex: 1, backgroundColor: BG },

  // header
  header:     { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 16, paddingBottom: 12 },
  headerLeft: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar:     { width: 42, height: 42, borderRadius: 21, backgroundColor: BORD, alignItems: 'center', justifyContent: 'center' },
  avatarTxt:  { color: '#fff', fontWeight: '700', fontSize: 15 },
  greetSmall: { fontSize: 12, color: MUTED },
  greetName:  { fontSize: 16, fontWeight: '700', color: DARK },
  bellWrap:      { position: 'relative', padding: 4 },
  bellBadge:     { position: 'absolute', top: 0, right: 0, minWidth: 16, height: 16, borderRadius: 8, backgroundColor: BORD, borderWidth: 1.5, borderColor: BG, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3 },
  bellBadgeTxt:  { color: '#fff', fontSize: 9, fontWeight: '700' },

  // carte portefeuille
  portfCard:    { marginHorizontal: 16, marginTop: 16, marginBottom: 16, backgroundColor: PORTF_BG, borderRadius: 20, padding: 20 },
  portfTop:     { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 12 },
  portfTopLabel:{ fontSize: 11, color: 'rgba(255,255,255,0.55)', fontWeight: '600', letterSpacing: 0.5 },
  portfTopDate: { fontSize: 11, color: 'rgba(255,255,255,0.5)' },
  portfMain:    { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 },
  portfAmount:  { fontSize: 32, fontWeight: '800', color: '#ffffff', letterSpacing: -0.5 },
  portfCurrency:{ fontSize: 16, fontWeight: '400', color: 'rgba(255,255,255,0.7)' },
  portfVar:     { alignItems: 'flex-end', justifyContent: 'center' },
  portfVarAmt:  { fontSize: 13, color: '#4ade80', fontWeight: '700' },
  portfVarPct:  { fontSize: 13, color: '#4ade80', fontWeight: '600' },
  portfDivider: { height: 1, backgroundColor: 'rgba(255,255,255,0.1)', marginVertical: 14 },
  portfRow:     { flexDirection: 'row', justifyContent: 'space-between' },
  portfSubLabel:{ fontSize: 10, color: 'rgba(255,255,255,0.5)', marginBottom: 3, letterSpacing: 0.3 },
  portfSubVal:  { fontSize: 14, color: '#ffffff', fontWeight: '600' },

  // actions
  actionsRow:       { flexDirection: 'row', marginHorizontal: 16, gap: 8, marginBottom: 24 },
  actionBtn:        { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 12 },
  actionBtnFilled:  { backgroundColor: BORD },
  actionBtnGhost:   { backgroundColor: CARD, borderWidth: 1.5 },
  actionLabel:      { fontSize: 11, fontWeight: '600' },

  // sections
  section:       { marginHorizontal: 16, marginBottom: 24 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle:  { fontSize: 16, fontWeight: '700', color: DARK },
  sectionLink:   { fontSize: 13, color: BORD, fontWeight: '600' },

  // cartes indices
  cardsRow:   { flexDirection: 'row', gap: 8 },
  indexCard:  { flex: 1, backgroundColor: CARD, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: LINE },
  indexLabel: { fontSize: 11, color: MUTED, fontWeight: '600', marginBottom: 4 },
  indexValue: { fontSize: 14, fontWeight: '700', color: DARK, marginBottom: 6 },
  pctBadge:   { alignSelf: 'flex-start', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 3 },
  pctText:    { fontSize: 11, fontWeight: '700' },

  // marchés internationaux
  liveRow:    { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot:    { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  liveTxt:    { fontSize: 12, color: GREEN, fontWeight: '500' },
  intlHeader: { flexDirection: 'row', alignItems: 'center', gap: 4, marginBottom: 4 },
  intlLabel:  { fontSize: 11, color: MUTED, fontWeight: '600' },

  // panneau notifications
  notifOverlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  notifCard:      { backgroundColor: CARD, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, maxHeight: '75%' },
  notifHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 },
  notifTitle:     { fontSize: 17, fontWeight: '700', color: DARK },
  notifEmpty:     { color: MUTED, textAlign: 'center', paddingVertical: 32, fontSize: 13, fontStyle: 'italic' },
  notifRow:       { flexDirection: 'row', alignItems: 'flex-start', gap: 12, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: LINE },
  notifIcon:      { fontSize: 22, marginTop: 2 },
  notifRowTitle:  { fontSize: 14, fontWeight: '700', color: DARK, marginBottom: 2 },
  notifRowBody:   { fontSize: 13, color: MUTED, marginBottom: 3 },
  notifRowDate:   { fontSize: 11, color: MUTED },
});
