import { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, Modal, ScrollView, Alert, StatusBar,
} from 'react-native';
// @ts-ignore
import { useRouter } from 'expo-router';
import { useMarketData, Stock } from '../../hooks/useMarketData';
import {
  isMarketOpen, toggleWatchlist, getWatchlist,
  checkPendingOrders,
} from '../../services/trading';

// ── Tokens ────────────────────────────────────────────────────────────────────
const BG       = '#f8fafc';
const WHITE    = '#ffffff';
const DARK     = '#1e293b';
const MUTED    = '#64748b';
const LINE     = '#e2e8f0';
const BORDEAUX = '#7B1D3A';
const MASI_BG  = '#1a050c';
const UP       = '#16a34a';
const DOWN     = '#dc2626';
const FLAT     = '#64748b';
const GOLD     = '#d97706';

// ── Utilitaires ───────────────────────────────────────────────────────────────
function fmtN(x: number | null | undefined, dp = 2): string {
  if (x == null || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
}
function varColor(pct: number): string {
  return isNaN(pct) ? FLAT : pct > 0 ? UP : pct < 0 ? DOWN : FLAT;
}
function varSign(pct: number): string {
  if (isNaN(pct)) return '—';
  const sign = pct > 0 ? '↗ +' : pct < 0 ? '↘ ' : '● ';
  return `${sign}${Math.abs(pct).toFixed(2)} %`;
}
function varBadge(pct: number): string {
  if (isNaN(pct)) return '—';
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(2)} %`;
}

type SortKey = 'sector' | 'var_desc' | 'var_asc' | 'vol_desc' | 'name';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'sector',   label: 'Secteur'  },
  { key: 'var_desc', label: 'Var. ↓'  },
  { key: 'var_asc',  label: 'Var. ↑'  },
  { key: 'vol_desc', label: 'Volume ↓' },
  { key: 'name',     label: 'Nom'      },
];

// ── Modal détail action ───────────────────────────────────────────────────────
function StockDetailModal({ stock, onClose, onOrder, isStarred, onToggleStar }: {
  stock: Stock;
  onClose: () => void;
  onOrder: (s: Stock, dir: 'achat' | 'vente') => void;
  isStarred: boolean;
  onToggleStar: () => void;
}) {
  const pColor = varColor(stock.pct);
  return (
    <Modal visible animationType="slide" transparent onRequestClose={onClose}>
      <View style={md.overlay}>
        <View style={md.sheet}>
          {/* Handle */}
          <View style={md.handle} />

          <View style={md.header}>
            <View style={{ flex: 1 }}>
              <Text style={md.name}>{stock.name}</Text>
              <Text style={md.sector}>{stock.sector}</Text>
            </View>
            <TouchableOpacity onPress={onToggleStar} style={md.iconBtn}>
              <Text style={{ fontSize: 22, color: isStarred ? GOLD : LINE }}>{isStarred ? '★' : '☆'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={md.iconBtn}>
              <Text style={{ color: MUTED, fontSize: 20 }}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={md.priceRow}>
            <Text style={md.price}>{fmtN(stock.price, 2)} MAD</Text>
            <Text style={[md.pct, { color: pColor }]}>{varSign(stock.pct)}</Text>
          </View>

          <View style={md.grid}>
            {[
              ['Ouverture', fmtN(stock.open)],
              ['+ Haut',    fmtN(stock.high)],
              ['+ Bas',     fmtN(stock.low)],
              ['Bid',       fmtN(stock.bid)],
              ['Ask',       fmtN(stock.ask)],
              ['Vol. MAD',  fmtN(stock.volMAD, 0)],
            ].map(([label, val]) => (
              <View key={label} style={md.gridItem}>
                <Text style={md.gridLabel}>{label}</Text>
                <Text style={md.gridVal}>{val}</Text>
              </View>
            ))}
          </View>

          <View style={md.actions}>
            <TouchableOpacity
              style={[md.btn, { borderColor: UP + '66', backgroundColor: UP + '12' }]}
              onPress={() => onOrder(stock, 'achat')}
            >
              <Text style={{ color: UP, fontWeight: '700', fontSize: 15 }}>Acheter</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[md.btn, { borderColor: DOWN + '66', backgroundColor: DOWN + '12' }]}
              onPress={() => onOrder(stock, 'vente')}
            >
              <Text style={{ color: DOWN, fontWeight: '700', fontSize: 15 }}>Vendre</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Écran Marchés ─────────────────────────────────────────────────────────────
export default function MarcheScreen() {
  const { stocks, overview, status, lastUpdate } = useMarketData();
  const router   = useRouter();
  const open     = isMarketOpen();

  const [query,     setQuery]     = useState('');
  const [sort,      setSort]      = useState<SortKey>('sector');
  const [showSort,  setShowSort]  = useState(false);
  const [selected,  setSelected]  = useState<Stock | null>(null);
  const [watchlist, setWatchlist] = useState<string[]>([]);

  useEffect(() => { getWatchlist().then(setWatchlist); }, []);

  useEffect(() => {
    if (stocks.length > 0) {
      checkPendingOrders(stocks).then(executed => {
        if (executed.length > 0) {
          Alert.alert('Ordres exécutés ✓',
            executed.map(o =>
              `${o.direction === 'achat' ? 'Achat' : 'Vente'} ${o.qty}×${o.name} @ ${fmtN(o.price)} MAD`
            ).join('\n')
          );
        }
      });
    }
  }, [stocks]);

  const filtered = useMemo(() => {
    let arr = stocks.slice();
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(s => s.name.toLowerCase().includes(q) || s.sector.toLowerCase().includes(q));
    }
    switch (sort) {
      case 'var_desc': return arr.sort((a, b) => (isNaN(b.pct) ? -99 : b.pct) - (isNaN(a.pct) ? -99 : a.pct));
      case 'var_asc':  return arr.sort((a, b) => (isNaN(a.pct) ? 99 : a.pct) - (isNaN(b.pct) ? 99 : b.pct));
      case 'vol_desc': return arr.sort((a, b) => (isNaN(b.volMAD) ? -1 : b.volMAD) - (isNaN(a.volMAD) ? -1 : a.volMAD));
      case 'name':     return arr.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      default:         return arr.sort((a, b) => a.sector.localeCompare(b.sector, 'fr') || a.name.localeCompare(b.name, 'fr'));
    }
  }, [stocks, query, sort]);

  const topUp   = useMemo(() => [...stocks].filter(s => !isNaN(s.pct)).sort((a, b) => b.pct - a.pct).slice(0, 3), [stocks]);
  const topDown = useMemo(() => [...stocks].filter(s => !isNaN(s.pct)).sort((a, b) => a.pct - b.pct).slice(0, 3), [stocks]);

  const up = stocks.filter(s => s.pct > 0).length;
  const dn = stocks.filter(s => s.pct < 0).length;
  const fl = stocks.filter(s => !isNaN(s.pct) && s.pct === 0).length;

  const handleToggleStar = useCallback(async (name: string) => {
    const added = await toggleWatchlist(name);
    setWatchlist(prev => added ? [...prev, name] : prev.filter(n => n !== name));
  }, []);

  const handleOrder = useCallback((s: Stock, dir: 'achat' | 'vente') => {
    setSelected(null);
    router.push({ pathname: '/(tabs)/ordres' as any, params: { stock: s.name, direction: dir } });
  }, [router]);

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={WHITE} />

      {/* ── En-tête blanc ── */}
      <View style={s.header}>
        <Text style={s.headerTitle}>Marchés</Text>
        <View style={s.headerChips}>
          <View style={s.chip}>
            <View style={[s.chipDot, { backgroundColor: status === 'connected' ? UP : status === 'connecting' ? GOLD : DOWN }]} />
            <Text style={[s.chipTxt, { color: status === 'connected' ? UP : status === 'connecting' ? GOLD : DOWN }]}>
              {status === 'connected' ? 'En direct' : status === 'connecting' ? 'Connexion…' : 'Déconnecté'}
            </Text>
          </View>
          <View style={s.chip}>
            <View style={[s.chipDot, { backgroundColor: open ? UP : GOLD }]} />
            <Text style={[s.chipTxt, { color: open ? UP : GOLD }]}>
              {open ? 'Marché ouvert' : 'Marché fermé'}
            </Text>
          </View>
        </View>
      </View>

      <ScrollView style={s.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 24 }}>

        {/* ── Carte MASI ── */}
        <View style={s.masiCard}>
          <Text style={s.masiLabel}>MASI · INDICE PRINCIPAL</Text>
          <Text style={s.masiValue}>{fmtN(overview.masi, 2)}</Text>
          <View style={s.masiBottom}>
            <Text style={[s.masiVar, { color: (overview.masiVarJ ?? 0) >= 0 ? '#86efac' : '#fca5a5' }]}>
              {varSign(overview.masiVarJ ?? NaN)}
            </Text>
            {lastUpdate && (
              <Text style={s.masiTs}>Maj {lastUpdate.toLocaleTimeString('fr-FR')}</Text>
            )}
          </View>
        </View>

        {/* ── 3 KPI ── */}
        <View style={s.kpiRow}>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>VOLUME MAD</Text>
            <Text style={s.kpiValue} numberOfLines={1}>{fmtN(overview.vol, 0)}</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>CAPITALISATION</Text>
            <Text style={s.kpiValue} numberOfLines={1}>{fmtN((overview.capi ?? 0) / 1e9, 1)} Mds</Text>
          </View>
          <View style={s.kpiCard}>
            <Text style={s.kpiLabel}>LARGEUR</Text>
            <Text style={s.kpiValue}>
              <Text style={{ color: UP }}>{up}</Text>
              <Text style={{ color: MUTED }}>/</Text>
              <Text style={{ color: DOWN }}>{dn}</Text>
              <Text style={{ color: MUTED }}>/</Text>
              <Text style={{ color: FLAT }}>{fl}</Text>
            </Text>
          </View>
        </View>

        {/* ── Hausses / Baisses ── */}
        {stocks.length > 0 && (
          <View style={s.moversCard}>
            <View style={s.moversCol}>
              <Text style={s.moversTitle}>↗ HAUSSES</Text>
              {topUp.map(st => (
                <TouchableOpacity key={st.name} style={s.moverRow} onPress={() => setSelected(st)}>
                  <Text style={s.moverName} numberOfLines={1}>{st.name}</Text>
                  <Text style={{ color: UP, fontSize: 12, fontWeight: '600' }}>+{st.pct.toFixed(2)} %</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={s.moversDivider} />
            <View style={s.moversCol}>
              <Text style={[s.moversTitle, { color: DOWN }]}>↘ BAISSES</Text>
              {topDown.map(st => (
                <TouchableOpacity key={st.name} style={s.moverRow} onPress={() => setSelected(st)}>
                  <Text style={s.moverName} numberOfLines={1}>{st.name}</Text>
                  <Text style={{ color: DOWN, fontSize: 12, fontWeight: '600' }}>{st.pct.toFixed(2)} %</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}

        {/* ── Recherche + tri ── */}
        <View style={s.searchRow}>
          <View style={s.searchWrap}>
            <Text style={s.searchIcon}>🔍</Text>
            <TextInput
              style={s.searchInput}
              placeholder="Filtrer (ATW, IAM…)"
              placeholderTextColor={MUTED}
              value={query}
              onChangeText={setQuery}
            />
          </View>
          <TouchableOpacity style={s.sortBtn} onPress={() => setShowSort(!showSort)}>
            <Text style={s.sortTxt}>{SORTS.find(x => x.key === sort)?.label ?? 'Tri'} ▾</Text>
          </TouchableOpacity>
        </View>

        {showSort && (
          <View style={s.sortMenu}>
            {SORTS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={[s.sortOption, opt.key === sort && s.sortOptionActive]}
                onPress={() => { setSort(opt.key); setShowSort(false); }}
              >
                <Text style={{ color: opt.key === sort ? BORDEAUX : DARK, fontSize: 13, fontWeight: opt.key === sort ? '700' : '400' }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* ── Liste des valeurs ── */}
        <View style={s.listCard}>
          {filtered.length === 0 ? (
            <Text style={s.empty}>
              {status === 'connecting' ? 'Connexion WebSocket…' : 'Aucune valeur trouvée'}
            </Text>
          ) : filtered.map((item, idx) => (
            <View key={item.name}>
              <TouchableOpacity style={s.row} onPress={() => setSelected(item)}>
                <TouchableOpacity
                  style={s.starBtn}
                  onPress={() => handleToggleStar(item.name)}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={{ fontSize: 18, color: watchlist.includes(item.name) ? GOLD : LINE }}>
                    {watchlist.includes(item.name) ? '★' : '☆'}
                  </Text>
                </TouchableOpacity>
                <View style={s.rowLeft}>
                  <Text style={s.stockName} numberOfLines={1}>{item.name}</Text>
                  <Text style={s.stockSector} numberOfLines={1}>{item.sector}</Text>
                </View>
                <View style={s.rowRight}>
                  <Text style={s.stockPrice}>{fmtN(item.price, 2)} MAD</Text>
                  <View style={[s.varBadge, { backgroundColor: varColor(item.pct) + '18', borderColor: varColor(item.pct) + '44' }]}>
                    <Text style={[s.varTxt, { color: varColor(item.pct) }]}>{varBadge(item.pct)}</Text>
                  </View>
                </View>
              </TouchableOpacity>
              {idx < filtered.length - 1 && <View style={s.sep} />}
            </View>
          ))}
        </View>
      </ScrollView>

      {selected && (
        <StockDetailModal
          stock={selected}
          onClose={() => setSelected(null)}
          onOrder={handleOrder}
          isStarred={watchlist.includes(selected.name)}
          onToggleStar={() => handleToggleStar(selected.name)}
        />
      )}
    </View>
  );
}

// ── Styles écran ──────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:   { flex: 1, backgroundColor: BG },
  scroll: { flex: 1 },

  // En-tête
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: WHITE, paddingHorizontal: 20, paddingTop: 14, paddingBottom: 14,
    borderBottomWidth: 1, borderBottomColor: LINE,
  },
  headerTitle: { fontSize: 20, fontWeight: '800', color: DARK },
  headerChips: { flexDirection: 'row', gap: 10 },
  chip:        { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipDot:     { width: 7, height: 7, borderRadius: 4 },
  chipTxt:     { fontSize: 11, fontWeight: '600' },

  // Carte MASI
  masiCard: {
    margin: 16, borderRadius: 16, padding: 20,
    backgroundColor: MASI_BG,
    shadowColor: '#000', shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3, shadowRadius: 12, elevation: 8,
  },
  masiLabel:  { color: 'rgba(255,255,255,.55)', fontSize: 11, fontWeight: '600', letterSpacing: 0.5, marginBottom: 10 },
  masiValue:  { color: WHITE, fontSize: 32, fontWeight: '800', marginBottom: 8 },
  masiBottom: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  masiVar:    { fontSize: 15, fontWeight: '700' },
  masiTs:     { color: 'rgba(255,255,255,.4)', fontSize: 11 },

  // 3 KPI
  kpiRow:  { flexDirection: 'row', paddingHorizontal: 16, gap: 10, marginBottom: 12 },
  kpiCard: {
    flex: 1, backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: LINE, padding: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 2,
  },
  kpiLabel: { fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 5 },
  kpiValue: { fontSize: 13, fontWeight: '700', color: DARK },

  // Movers
  moversCard: {
    flexDirection: 'row', marginHorizontal: 16, marginBottom: 12,
    backgroundColor: WHITE, borderRadius: 12,
    borderWidth: 1, borderColor: LINE,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 3, elevation: 2,
    overflow: 'hidden',
  },
  moversCol:     { flex: 1, padding: 14 },
  moversDivider: { width: 1, backgroundColor: LINE, marginVertical: 10 },
  moversTitle:   { fontSize: 11, fontWeight: '800', color: UP, marginBottom: 10, letterSpacing: 0.5 },
  moverRow:      { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  moverName:     { fontSize: 12, color: DARK, flex: 1, marginRight: 6, fontWeight: '500' },

  // Recherche
  searchRow:  { flexDirection: 'row', marginHorizontal: 16, marginBottom: 8, gap: 10, alignItems: 'center' },
  searchWrap: {
    flex: 1, flexDirection: 'row', alignItems: 'center',
    backgroundColor: WHITE, borderRadius: 10,
    borderWidth: 1, borderColor: LINE, paddingHorizontal: 10,
  },
  searchIcon:  { fontSize: 14, marginRight: 6, opacity: 0.5 },
  searchInput: { flex: 1, paddingVertical: 10, fontSize: 13, color: DARK },
  sortBtn: {
    backgroundColor: WHITE, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: LINE,
  },
  sortTxt: { color: DARK, fontSize: 12, fontWeight: '600' },
  sortMenu: {
    marginHorizontal: 16, backgroundColor: WHITE, borderRadius: 10,
    borderWidth: 1, borderColor: LINE, marginBottom: 8, overflow: 'hidden',
  },
  sortOption:       { paddingVertical: 12, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: LINE },
  sortOptionActive: { backgroundColor: BORDEAUX + '08' },

  // Liste
  listCard: {
    marginHorizontal: 16, backgroundColor: WHITE, borderRadius: 14,
    borderWidth: 1, borderColor: LINE,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 4, elevation: 2,
    overflow: 'hidden',
  },
  row:       { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14 },
  starBtn:   { marginRight: 10 },
  rowLeft:   { flex: 1 },
  rowRight:  { alignItems: 'flex-end' },
  stockName:   { fontSize: 14, fontWeight: '700', color: DARK },
  stockSector: { fontSize: 11, color: MUTED, marginTop: 2 },
  stockPrice:  { fontSize: 14, fontWeight: '600', color: DARK, marginBottom: 4 },
  varBadge:    { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, borderWidth: 1 },
  varTxt:      { fontSize: 11, fontWeight: '600' },
  sep:         { height: 1, backgroundColor: LINE, marginLeft: 46 },
  empty:       { padding: 40, textAlign: 'center', color: MUTED, fontSize: 14 },
});

// ── Styles modal ──────────────────────────────────────────────────────────────
const md = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: WHITE, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    padding: 20, paddingTop: 12,
  },
  handle:   { width: 36, height: 4, backgroundColor: LINE, borderRadius: 2, alignSelf: 'center', marginBottom: 16 },
  header:   { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 16 },
  name:     { fontSize: 18, fontWeight: '700', color: DARK },
  sector:   { fontSize: 12, color: MUTED, marginTop: 3 },
  iconBtn:  { padding: 6, marginLeft: 8 },
  priceRow: { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 16 },
  price:    { fontSize: 26, fontWeight: '800', color: DARK },
  pct:      { fontSize: 16, fontWeight: '600' },
  grid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  gridItem: { width: '30%', backgroundColor: BG, borderRadius: 8, padding: 10, borderWidth: 1, borderColor: LINE },
  gridLabel:{ fontSize: 9, color: MUTED, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  gridVal:  { fontSize: 13, fontWeight: '700', color: DARK },
  actions:  { flexDirection: 'row', gap: 10, paddingBottom: 8 },
  btn:      { flex: 1, borderWidth: 1, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
});
