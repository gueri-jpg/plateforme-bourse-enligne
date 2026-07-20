// ============================================================================
// screens/MarketScreen.tsx — Liste des valeurs BVC en temps réel
// Adapté de app/(tabs)/marche.tsx pour React Navigation
// Remplacement : useRouter → useNavigation + navigation.navigate
// ============================================================================

import React, { useState, useMemo, useCallback, useEffect } from 'react';
import {
  View, Text, TextInput, StyleSheet,
  TouchableOpacity, Modal, ScrollView, Alert,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useMarketData, Stock } from '../../hooks/useMarketData';
import { ScreenHeader } from '../components/ScreenHeader';
import {
  isMarketOpen, toggleWatchlist, getWatchlist,
  checkPendingOrders,
} from '../../services/trading';
import type { MainTabParamList } from '../navigation/types';

const C = {
  bg: '#f8fafc', panel: '#ffffff', panel2: '#f1f5f9',
  txt: '#0f172a', muted: '#64748b', line: '#e2e8f0',
  up: '#16a34a', down: '#dc2626', flat: '#9ca3af',
  accent: '#7B1D3A', gold: '#f59e0b',
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

type SortKey = 'sector' | 'var_desc' | 'var_asc' | 'vol_desc' | 'name';
const SORTS: { key: SortKey; label: string }[] = [
  { key: 'sector',   label: 'Secteur' },
  { key: 'var_desc', label: 'Var. ↓' },
  { key: 'var_asc',  label: 'Var. ↑' },
  { key: 'vol_desc', label: 'Volume ↓' },
  { key: 'name',     label: 'Nom' },
];

// ── Modal de détail d'une action ─────────────────────────────────────────────
function StockDetailModal({ stock, onClose, onOrder, isStarred, onToggleStar }: {
  stock:        Stock;
  onClose:      () => void;
  onOrder:      (s: Stock, dir: 'achat' | 'vente') => void;
  isStarred:    boolean;
  onToggleStar: () => void;
}) {
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onClose}>
      <View style={modal.overlay}>
        <View style={modal.card}>
          <View style={modal.header}>
            <View style={{ flex: 1 }}>
              <Text style={modal.name}>{stock.name}</Text>
              <Text style={modal.sector}>{stock.sector}</Text>
            </View>
            <TouchableOpacity onPress={onToggleStar} style={modal.star}>
              <Text style={{ fontSize: 24, color: isStarred ? C.gold : C.muted }}>
                {isStarred ? '★' : '☆'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={onClose} style={modal.close}>
              <Text style={{ color: C.muted, fontSize: 20 }}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={modal.priceRow}>
            <Text style={modal.price}>{fmtN(stock.price, 2)} MAD</Text>
            <Text style={[modal.var, { color: varColor(stock.pct) }]}>{varLabel(stock.pct)}</Text>
          </View>

          <View style={modal.grid}>
            {[
              ['Ouverture', fmtN(stock.open)],
              ['+ Haut',    fmtN(stock.high)],
              ['+ Bas',     fmtN(stock.low)],
              ['Bid',       fmtN(stock.bid)],
              ['Ask',       fmtN(stock.ask)],
              ['Vol. MAD',  fmtN(stock.volMAD, 0)],
            ].map(([label, val]) => (
              <View key={label} style={modal.gridItem}>
                <Text style={modal.gridLabel}>{label}</Text>
                <Text style={modal.gridVal}>{val}</Text>
              </View>
            ))}
          </View>

          <View style={modal.actions}>
            <TouchableOpacity
              style={[modal.btn, { borderColor: C.up, backgroundColor: 'rgba(34,197,94,0.1)' }]}
              onPress={() => onOrder(stock, 'achat')}
            >
              <Text style={{ color: C.up, fontWeight: '700', fontSize: 15 }}>Acheter</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[modal.btn, { borderColor: C.down, backgroundColor: 'rgba(239,68,68,0.1)' }]}
              onPress={() => onOrder(stock, 'vente')}
            >
              <Text style={{ color: C.down, fontWeight: '700', fontSize: 15 }}>Vendre</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

// ── Écran principal ──────────────────────────────────────────────────────────
export function MarketScreen() {
  const { stocks, overview, status } = useMarketData();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();

  const [query,         setQuery]         = useState('');
  const [sort,          setSort]          = useState<SortKey>('sector');
  const [showSort,      setShowSort]      = useState(false);
  const [selected,      setSelected]      = useState<Stock | null>(null);
  const [watchlist,     setWatchlist]     = useState<string[]>([]);
  const [expandHausses, setExpandHausses] = useState(false);
  const [expandBaisses, setExpandBaisses] = useState(false);
  const open = isMarketOpen();

  // Charger la watchlist au montage
  useEffect(() => {
    getWatchlist().then(setWatchlist);
  }, []);

  // Vérifier les ordres en attente à chaque mise à jour des cours
  useEffect(() => {
    if (stocks.length > 0) {
      checkPendingOrders(stocks).then(executed => {
        if (executed.length > 0) {
          Alert.alert(
            'Ordres exécutés',
            executed.map(o =>
              `${o.direction === 'achat' ? 'Achat' : 'Vente'} ${o.qty}×${o.name} @ ${fmtN(o.price)} MAD`
            ).join('\n')
          );
        }
      });
    }
  }, [stocks]);

  // Filtrage et tri de la liste
  const filtered = useMemo(() => {
    let arr = stocks.slice();
    if (query) {
      const q = query.toLowerCase();
      arr = arr.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.sector.toLowerCase().includes(q) ||
        s.ticker.toLowerCase().includes(q)
      );
    }
    switch (sort) {
      case 'var_desc': return arr.sort((a, b) => (isNaN(b.pct) ? -99 : b.pct) - (isNaN(a.pct) ? -99 : a.pct));
      case 'var_asc':  return arr.sort((a, b) => (isNaN(a.pct) ? 99 : a.pct)  - (isNaN(b.pct) ? 99 : b.pct));
      case 'vol_desc': return arr.sort((a, b) => (isNaN(b.volMAD) ? -1 : b.volMAD) - (isNaN(a.volMAD) ? -1 : a.volMAD));
      case 'name':     return arr.sort((a, b) => a.name.localeCompare(b.name, 'fr'));
      default:         return arr.sort((a, b) => a.sector.localeCompare(b.sector, 'fr') || a.name.localeCompare(b.name, 'fr'));
    }
  }, [stocks, query, sort]);

  const allUp   = useMemo(() => [...stocks].filter(s => !isNaN(s.pct) && s.pct > 0).sort((a, b) => b.pct - a.pct), [stocks]);
  const allDown = useMemo(() => [...stocks].filter(s => !isNaN(s.pct) && s.pct < 0).sort((a, b) => a.pct - b.pct), [stocks]);
  const topUp   = allUp.slice(0, 3);
  const topDown = allDown.slice(0, 3);

  const statusColor = status === 'connected' ? C.up : status === 'connecting' ? C.gold : C.down;

  const handleToggleStar = useCallback(async (name: string) => {
    const added = await toggleWatchlist(name);
    setWatchlist(prev => added ? [...prev, name] : prev.filter(n => n !== name));
  }, []);

  // Navigation vers l'onglet Ordre avec les paramètres pré-remplis
  const handleOrder = useCallback((s: Stock, dir: 'achat' | 'vente') => {
    setSelected(null);
    // Naviguer vers l'onglet Ordre en passant les paramètres via setParams
    navigation.navigate('Ordre', { stock: s.name, direction: dir });
  }, [navigation]);

  const renderStock = useCallback(({ item }: { item: Stock }) => (
    <TouchableOpacity style={s.row} onPress={() => setSelected(item)}>
      <TouchableOpacity style={s.starBtn} onPress={() => handleToggleStar(item.name)}>
        <Text style={{
          fontSize: 16,
          color: watchlist.includes(item.name) ? C.gold : C.muted,
          opacity: watchlist.includes(item.name) ? 1 : 0.4,
        }}>
          {watchlist.includes(item.name) ? '★' : '☆'}
        </Text>
      </TouchableOpacity>
      <View style={s.rowLeft}>
        <Text style={s.name} numberOfLines={1}>{item.name}</Text>
        <Text style={s.sector} numberOfLines={1}>{item.sector}</Text>
      </View>
      <View style={s.rowRight}>
        <Text style={s.price}>{fmtN(item.price)} MAD</Text>
        <Text style={[s.var, { color: varColor(item.pct) }]}>{varLabel(item.pct)}</Text>
      </View>
    </TouchableOpacity>
  ), [watchlist, handleToggleStar]);

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenHeader title="Marchés" />
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        {/* Barre de statut connexion */}
        <View style={s.statusBar}>
          <View style={[s.dot, { backgroundColor: statusColor }]} />
          <Text style={s.statusTxt}>
            {status === 'connected' ? 'En direct' : status === 'connecting' ? 'Connexion…' : 'Déconnecté'}
          </Text>
          <Text style={[s.mktBadge, { color: open ? C.up : C.gold }]}>
            {open ? '● Marché ouvert' : '● Marché fermé'}
          </Text>
        </View>

        {/* Masqué pendant la recherche pour remonter la barre en haut */}
        {!query && (<>
        {/* Indice MASI */}
        {overview.masi !== null && (
          <View style={s.masiCard}>
            <Text style={s.masiLabel}>MASI</Text>
            <Text style={s.masiValue}>{fmtN(overview.masi)}</Text>
            <Text style={[s.masiVar, { color: varColor(overview.masiVarJ ?? NaN) }]}>
              {varLabel(overview.masiVarJ ?? NaN)}
            </Text>

          </View>
        )}

        {/* KPIs marché */}
        <View style={s.cardsRow}>
          <View style={s.card}>
            <Text style={s.cardLabel}>Volume MAD</Text>
            <Text style={s.cardValue} numberOfLines={1}>{fmtN(overview.vol, 0)}</Text>
          </View>
          <View style={s.card}>
            <Text style={s.cardLabel}>Capitalisation</Text>
            <Text style={s.cardValue} numberOfLines={1}>
              {fmtN((overview.capi ?? 0) / 1e9, 1)} Mds
            </Text>
          </View>
        </View>

        {/* Tops et flops */}
        {stocks.length > 0 && (
          <View style={{ marginHorizontal: 12, marginBottom: 8 }}>
            {/* Cartes côte à côte */}
            <View style={s.moversRow}>
              <TouchableOpacity
                style={[s.moverCard, expandHausses && s.moverCardActive]}
                onPress={() => { setExpandHausses(v => !v); setExpandBaisses(false); }}
                activeOpacity={0.75}
              >
                <Text style={s.moversTitle}>▲ Hausses</Text>
                <View style={s.moverHeaderRight}>
                  <Text style={[s.moverCount, { color: C.up }]}>{allUp.length}</Text>
                  <Text style={[s.moverChevron, expandHausses && s.moverChevronOpen]}>▾</Text>
                </View>
                {topUp.map(st => (
                  <View key={st.name} style={s.moverPreviewRow}>
                    <Text style={s.moverName} numberOfLines={1}>{st.name}</Text>
                    <Text style={{ color: C.up, fontSize: 11, fontWeight: '600' }}>+{st.pct.toFixed(2)}%</Text>
                  </View>
                ))}
              </TouchableOpacity>

              <View style={{ width: 1, backgroundColor: C.line }} />

              <TouchableOpacity
                style={[s.moverCard, expandBaisses && s.moverCardActive]}
                onPress={() => { setExpandBaisses(v => !v); setExpandHausses(false); }}
                activeOpacity={0.75}
              >
                <Text style={[s.moversTitle, { color: C.down }]}>▼ Baisses</Text>
                <View style={s.moverHeaderRight}>
                  <Text style={[s.moverCount, { color: C.down }]}>{allDown.length}</Text>
                  <Text style={[s.moverChevron, expandBaisses && s.moverChevronOpen]}>▾</Text>
                </View>
                {topDown.map(st => (
                  <View key={st.name} style={s.moverPreviewRow}>
                    <Text style={s.moverName} numberOfLines={1}>{st.name}</Text>
                    <Text style={{ color: C.down, fontSize: 11, fontWeight: '600' }}>{st.pct.toFixed(2)}%</Text>
                  </View>
                ))}
              </TouchableOpacity>
            </View>

            {/* Liste déroulante sous les deux cartes */}
            {(expandHausses || expandBaisses) && (
              <View style={s.moverDropdown}>
                {(expandHausses ? allUp : allDown).map(st => (
                  <TouchableOpacity key={st.name} style={s.moverRow} onPress={() => setSelected(st)}>
                    <Text style={s.moverName} numberOfLines={1}>{st.name}</Text>
                    <Text style={{ color: expandHausses ? C.up : C.down, fontSize: 12, fontWeight: '600' }}>
                      {expandHausses ? '+' : ''}{st.pct.toFixed(2)}%
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
          </View>
        )}
        </>)}

        {/* Recherche + tri */}
        <View style={s.searchRow}>
          <TextInput
            style={s.search}
            placeholder="Filtrer (ATW, IAM…)"
            placeholderTextColor={C.muted}
            value={query}
            onChangeText={setQuery}
          />
          <TouchableOpacity style={s.sortBtn} onPress={() => setShowSort(!showSort)}>
            <Text style={{ color: C.accent, fontSize: 12 }}>
              {SORTS.find(x => x.key === sort)?.label ?? 'Tri'} ▾
            </Text>
          </TouchableOpacity>
        </View>

        {showSort && (
          <View style={s.sortMenu}>
            {SORTS.map(opt => (
              <TouchableOpacity
                key={opt.key}
                style={s.sortOption}
                onPress={() => { setSort(opt.key); setShowSort(false); }}
              >
                <Text style={{ color: sort === opt.key ? C.accent : C.txt, fontSize: 13 }}>
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Liste des valeurs */}
        {filtered.map((item, idx) => (
          <View key={item.name}>
            {renderStock({ item })}
            {idx < filtered.length - 1 && <View style={s.sep} />}
          </View>
        ))}

        {filtered.length === 0 && (
          <Text style={s.empty}>
            {status === 'connecting' ? 'Connexion WebSocket…' : 'Aucune valeur'}
          </Text>
        )}
      </ScrollView>

      {/* Modal détail action */}
      {selected && (
        <StockDetailModal
          stock={selected}
          onClose={() => setSelected(null)}
          onOrder={handleOrder}
          isStarred={watchlist.includes(selected.name)}
          onToggleStar={() => handleToggleStar(selected.name)}
        />
      )}
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: C.bg },
  statusBar:   { flexDirection: 'row', alignItems: 'center', padding: 10, backgroundColor: C.panel, gap: 8 },
  dot:         { width: 8, height: 8, borderRadius: 4 },
  statusTxt:   { fontSize: 12, color: C.muted, flex: 1 },
  mktBadge:    { fontSize: 11, fontWeight: '600' },
  masiCard:    { margin: 12, padding: 16, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line },
  masiLabel:   { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  masiValue:   { fontSize: 28, fontWeight: '700', color: C.txt, marginVertical: 4 },
  masiVar:     { fontSize: 14, fontWeight: '600' },
  masiTs:      { fontSize: 11, color: C.muted, marginTop: 4 },
  cardsRow:    { flexDirection: 'row', gap: 8, marginHorizontal: 12, marginBottom: 8 },
  card:        { flex: 1, backgroundColor: C.panel, borderRadius: 10, padding: 10, borderWidth: 1, borderColor: C.line },
  cardLabel:   { fontSize: 9, color: C.muted, textTransform: 'uppercase', marginBottom: 3 },
  cardValue:   { fontSize: 13, fontWeight: '600', color: C.txt },
  moversRow:         { flexDirection: 'row', backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  moverCard:         { flex: 1, padding: 10 },
  moverCardActive:   { backgroundColor: '#f8fafc' },
  moverHeaderRight:  { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  moverCount:        { fontSize: 12, fontWeight: '700' },
  moverChevron:      { fontSize: 14, color: C.muted },
  moverChevronOpen:  { transform: [{ rotate: '180deg' }] },
  moversTitle:       { fontSize: 11, fontWeight: '700', color: C.up, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 4 },
  moverPreviewRow:   { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 },
  moverDropdown:     { backgroundColor: C.panel, borderWidth: 1, borderTopWidth: 0, borderColor: C.line, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden' },
  moverRow:          { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line },
  moverName:         { fontSize: 12, color: C.txt, flex: 1, marginRight: 8 },
  searchRow:   { flexDirection: 'row', marginHorizontal: 12, marginBottom: 4, gap: 8, alignItems: 'center' },
  search:      { flex: 1, backgroundColor: C.panel, borderRadius: 10, padding: 10, fontSize: 13, color: C.txt, borderWidth: 1, borderColor: C.line },
  sortBtn:     { backgroundColor: C.panel, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, borderWidth: 1, borderColor: C.line },
  sortMenu:    { marginHorizontal: 12, backgroundColor: C.panel, borderRadius: 10, borderWidth: 1, borderColor: C.line, marginBottom: 4, overflow: 'hidden' },
  sortOption:  { paddingVertical: 10, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.line },
  row:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 16 },
  starBtn:     { marginRight: 10 },
  rowLeft:     { flex: 1 },
  rowRight:    { alignItems: 'flex-end' },
  name:        { fontSize: 14, fontWeight: '600', color: C.txt },
  sector:      { fontSize: 11, color: C.muted, marginTop: 2 },
  price:       { fontSize: 14, color: C.txt },
  var:         { fontSize: 12, marginTop: 2 },
  sep:         { height: 1, backgroundColor: C.line, marginLeft: 16 },
  empty:       { padding: 40, textAlign: 'center', color: C.muted },
});

const modal = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 20 },
  card:      { backgroundColor: C.panel, borderRadius: 20, padding: 20, borderWidth: 1, borderColor: C.line },
  header:    { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  name:      { fontSize: 18, fontWeight: '700', color: C.txt },
  sector:    { fontSize: 12, color: C.muted, marginTop: 2 },
  star:      { padding: 4, marginRight: 8 },
  close:     { padding: 4 },
  priceRow:  { flexDirection: 'row', alignItems: 'baseline', gap: 12, marginBottom: 16 },
  price:     { fontSize: 26, fontWeight: '700', color: C.txt },
  var:       { fontSize: 16, fontWeight: '600' },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  gridItem:  { width: '30%', backgroundColor: C.panel2, borderRadius: 8, padding: 10 },
  gridLabel: { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  gridVal:   { fontSize: 14, fontWeight: '600', color: C.txt, marginTop: 3 },
  actions:   { flexDirection: 'row', gap: 10 },
  btn:       { flex: 1, borderWidth: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
});
