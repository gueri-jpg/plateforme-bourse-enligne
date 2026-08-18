// ============================================================================
// screens/OrdresScreen.tsx — Passage d'ordres BVC (backend réel + SCA)
// ============================================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, Modal, Alert,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { useMarketData, Stock } from '../../hooks/useMarketData';
import { useOrderBook } from '../../hooks/useOrderBook';
import { ScreenHeader } from '../components/ScreenHeader';
import { TickerLogo } from '../components/TickerLogo';
import { TVChartView } from '../components/TVChartView';
import { fetchPortfolio, placeOrdre, PlaceOrdreParams } from '../api/portfolio';
import { isMarketOpen } from '../../services/trading';
import { useNotifications } from '../store/useNotifications';
import type { MainTabParamList } from '../navigation/types';

const C = {
  bg: '#f8fafc', panel: '#ffffff', panel2: '#f1f5f9',
  txt: '#0f172a', muted: '#64748b', line: '#e2e8f0',
  up: '#16a34a', down: '#dc2626', accent: '#7B1D3A', gold: '#f59e0b',
};

type TIF = 'day' | 'gtc' | 'ioc' | 'fok';

const TIF_LABELS: Record<TIF, string> = {
  day: 'DAY',
  gtc: 'GTC',
  ioc: 'IOC',
  fok: 'FOK',
};

const TIF_HINTS: Record<TIF, string> = {
  day: 'Valable jusqu\'à la fermeture du marché',
  gtc: 'Jusqu\'à annulation manuelle',
  ioc: 'Exécution immédiate, solde annulé',
  fok: 'Tout ou rien — annulé si non rempli en totalité',
};

function fmtN(x: number | null | undefined, dp = 2) {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
function fmtK(x: number | null | undefined): string {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  const n = x as number;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)} Md`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)} M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)} k`;
  return fmtN(n, 0);
}


type OrdresRoute = RouteProp<MainTabParamList, 'Ordre'>;

export function OrdresScreen() {
  const route       = useRoute<OrdresRoute>();
  const { stocks }  = useMarketData();

  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [direction, setDirection]         = useState<'achat' | 'vente'>('achat');
  const [orderType, setOrderType]         = useState<'marche' | 'limite'>('marche');
  const [timeInForce, setTimeInForce]     = useState<TIF>('day');
  const [qty, setQty]                     = useState('1');
  const [limitPrice, setLimitPrice]       = useState('');
  const [balance, setBalance]             = useState(0);
  const [showPicker, setShowPicker]       = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [submitting, setSubmitting]   = useState(false);

  // Solde depuis le backend
  useFocusEffect(useCallback(() => {
    fetchPortfolio()
      .then(p => setBalance(p.solde_especes))
      .catch(() => {});
  }, []));

  // Pré-remplir depuis les params de navigation
  useEffect(() => {
    const params = route.params;
    if (params?.stock && stocks.length > 0) {
      const found = stocks.find(s => s.name === params.stock);
      if (found) setSelectedStock(found);
    }
    if (params?.direction) setDirection(params.direction);
  }, [route.params, stocks]);

  // Mettre à jour le cours en temps réel
  useEffect(() => {
    if (selectedStock) {
      const updated = stocks.find(s => s.name === selectedStock.name);
      if (updated) setSelectedStock(updated);
    }
  }, [stocks]);

  const { data: ob, loading: obLoading } = useOrderBook(selectedStock?.ticker || null);

  const effectivePrice = orderType === 'limite' ? parseFloat(limitPrice) : (selectedStock?.price ?? 0);
  const qtyNum         = parseInt(qty) || 0;
  const total          = Math.round(effectivePrice * qtyNum * 100) / 100;
  const open           = isMarketOpen();

  const filteredStocks = searchQuery
    ? stocks.filter(s => {
        const q = searchQuery.toLowerCase();
        return s.name.toLowerCase().includes(q) || s.ticker.toLowerCase().includes(q);
      })
    : stocks;

  // Construit les params backend à partir du formulaire
  function buildOrdreParams(): PlaceOrdreParams {
    return {
      instrument_code: selectedStock!.name,
      sens:            direction,
      type_ordre:      orderType,
      quantite:        qtyNum,
      prix_limite:     orderType === 'limite' ? parseFloat(limitPrice) : null,
      prix_marche:     orderType === 'marche' ? selectedStock!.price  : null,
      time_in_force:   timeInForce,
    };
  }

  const handleConfirm = async () => {
    if (!selectedStock) return;
    setSubmitting(true);
    const res = await placeOrdre(buildOrdreParams());
    setSubmitting(false);

    if (res.success) {
      setShowConfirm(false);
      const { data } = res;
      const estExecute = data.statut === 'execute';
      const estPartiel = data.statut === 'partiellement_execute';
      const fixRef = data.fix_cl_ord_id ? ` · FIX ${data.fix_cl_ord_id.slice(0, 8)}…` : '';

      setQty('1');
      setLimitPrice('');
      fetchPortfolio().then(p => setBalance(p.solde_especes)).catch(() => {});

      useNotifications.getState().add({
        type:  direction,
        title: estExecute ? 'Ordre exécuté ✓' : estPartiel ? 'Exécution partielle ◑' : 'Ordre transmis ⏳',
        body:  `${data.quantite_executee || qtyNum}× ${selectedStock.name} — ${fmtN(total)} MAD${fixRef}`,
      });

      const alertTitle = estExecute ? 'Ordre exécuté' : estPartiel ? 'Exécution partielle' : 'Ordre transmis';
      const alertMsg = estPartiel
        ? `${data.quantite_executee}/${qtyNum} titres exécutés à ${fmtN(data.prix_execution)} MAD${fixRef}`
        : estExecute
        ? `${qtyNum}× ${selectedStock.name} à ${fmtN(data.prix_execution ?? effectivePrice)} MAD${fixRef}`
        : `Ordre ${direction} de ${qtyNum}× ${selectedStock.name} enregistré.${fixRef}`;
      Alert.alert(alertTitle, alertMsg);
      return;
    }

    setShowConfirm(false);
    Alert.alert('Erreur', !res.scaRequired ? res.message : "Erreur lors du passage de l'ordre");
  };

  return (
    <KeyboardAvoidingView
      style={s.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScreenHeader title="Passer un ordre" />
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }} nestedScrollEnabled keyboardShouldPersistTaps="handled">

        {/* Instrument */}
        <View style={s.block}>
          <Text style={s.label}>Instrument</Text>
          <TouchableOpacity style={s.picker} onPress={() => setShowPicker(true)}>
            <Text style={selectedStock ? s.pickerTxt : s.pickerPlaceholder}>
              {selectedStock
                ? `${selectedStock.name}  —  ${fmtN(selectedStock.price)} MAD`
                : 'Sélectionner une valeur…'}
            </Text>
            <Text style={{ color: C.muted }}>▾</Text>
          </TouchableOpacity>
        </View>

        {/* Détail complet de l'instrument sélectionné */}
        {selectedStock && (
          <View>
            {/* En-tête : nom + secteur + état */}
            <View style={s.detailHeader}>
              <View style={{ flex: 1 }}>
                <Text style={s.detailName}>{selectedStock.name}</Text>
                <Text style={s.detailSector}>{selectedStock.sector}</Text>
              </View>
              {ob?.etatCotVal && (
                <View style={s.etatBadge}>
                  <Text style={s.etatTxt}>{ob.etatCotVal}</Text>
                </View>
              )}
            </View>

            {/* Prix + variations */}
            <View style={s.detailPriceRow}>
              <Text style={s.detailPrice}>{fmtN(selectedStock.price)} MAD</Text>
              <View style={{ flexDirection: 'row', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
                <Text style={{ fontSize: 14, fontWeight: '600', color: isNaN(selectedStock.pct) ? C.muted : selectedStock.pct > 0 ? C.up : C.down }}>
                  {isNaN(selectedStock.pct) ? '—' : (selectedStock.pct > 0 ? '▲ ' : '▼ ') + Math.abs(selectedStock.pct).toFixed(2) + '%'}
                </Text>
                {ob?.instrumentVarYear != null && (
                  <Text style={{ fontSize: 13, fontWeight: '600', color: parseFloat(ob.instrumentVarYear) >= 0 ? C.up : C.down }}>
                    {parseFloat(ob.instrumentVarYear) >= 0 ? '▲ ' : '▼ '}{Math.abs(parseFloat(ob.instrumentVarYear)).toFixed(2)}% YTD
                  </Text>
                )}
              </View>
            </View>

            {/* Graphe TradingView */}
            <View style={s.block} collapsable={false}>
              <Text style={s.label}>Graphe historique · BVC</Text>
              <TVChartView stockName={selectedStock.name} stockTicker={selectedStock.ticker} />
            </View>

            {/* Grille OHLC */}
            <View style={s.block}>
              <View style={s.ohlcGrid}>
                {((): [string, string][] => {
                  const isPre = ob?.etatCotVal === 'PRE';
                  return [
                    [isPre ? 'Théorique' : 'Ouverture', fmtN(isPre ? ob?.pto : (ob?.openingPrice ?? selectedStock.open))],
                    ['+ Haut',      fmtN(ob?.highPrice   ?? selectedStock.high)],
                    ['+ Bas',       fmtN(ob?.lowPrice    ?? selectedStock.low)],
                    ['Référence',   fmtN(ob?.staticReferencePrice ?? selectedStock.refPrice)],
                    ['Vol. titres', fmtK(ob?.cumulTitresEchanges ?? selectedStock.volQty)],
                    ['Montant',     fmtK(ob?.cumulVolumeEchange  ?? selectedStock.volMAD)],
                  ];
                })().map(([lbl, val]) => (
                  <View key={lbl} style={s.ohlcItem}>
                    <Text style={s.ohlcLabel}>{lbl}</Text>
                    <Text style={s.ohlcVal}>{val}</Text>
                  </View>
                ))}
              </View>
            </View>

            {/* Carnet BVC */}
            <View style={s.block}>
              <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 8 }}>
                <Text style={s.label}>Carnet BVC</Text>
                {ob?.totalTrades != null && (
                  <Text style={{ fontSize: 11, color: C.muted, marginLeft: 8 }}>{ob.totalTrades} trades</Text>
                )}
                {obLoading && !ob && <ActivityIndicator size="small" color={C.accent} style={{ marginLeft: 8 }} />}
              </View>
              {ob ? (
                <>
                  <View style={s.bookRow}>
                    <View style={[s.bookSide, { backgroundColor: 'rgba(22,163,74,0.06)', borderColor: 'rgba(22,163,74,0.25)' }]}>
                      <Text style={[s.bookLabel, { color: C.up }]}>▲ ACHAT</Text>
                      <Text style={[s.bookPrice, { color: C.up }]}>{ob.bestBidPrice != null ? fmtN(ob.bestBidPrice) : '—'} MAD</Text>
                      <Text style={s.bookQty}>{ob.bestBidSize != null ? `× ${fmtN(ob.bestBidSize, 0)} titres` : '—'}</Text>
                    </View>
                    <View style={s.bookSpread}>
                      <Text style={s.bookSpreadTxt}>
                        {ob.bestBidPrice != null && ob.bestAskPrice != null ? fmtN(ob.bestAskPrice - ob.bestBidPrice) : '—'}
                      </Text>
                      <Text style={[s.bookLabel, { color: C.muted, fontSize: 9 }]}>Écart</Text>
                    </View>
                    <View style={[s.bookSide, { backgroundColor: 'rgba(220,38,38,0.06)', borderColor: 'rgba(220,38,38,0.25)' }]}>
                      <Text style={[s.bookLabel, { color: C.down }]}>▼ VENTE</Text>
                      <Text style={[s.bookPrice, { color: C.down }]}>{ob.bestAskPrice != null ? fmtN(ob.bestAskPrice) : '—'} MAD</Text>
                      <Text style={s.bookQty}>{ob.bestAskSize != null ? `× ${fmtN(ob.bestAskSize, 0)} titres` : '—'}</Text>
                    </View>
                  </View>
                  {ob.lastTransactions.length > 0 && (
                    <>
                      <Text style={[s.label, { marginTop: 12, marginBottom: 6 }]}>Derniers trades</Text>
                      {ob.lastTransactions.slice(0, 5).map((tx, i) => (
                        <View key={i} style={s.txRow}>
                          <Text style={s.txTime}>{tx.time ? (tx.time.includes('T') ? tx.time.split('T')[1].slice(0, 5) : tx.time.slice(0, 5)) : '—'}</Text>
                          <Text style={s.txPrice}>{tx.price != null ? fmtN(tx.price) : '—'} MAD</Text>
                          <Text style={s.txQty}>× {tx.qty != null ? fmtN(tx.qty, 0) : '—'}</Text>
                        </View>
                      ))}
                    </>
                  )}
                </>
              ) : !obLoading ? (
                <Text style={{ color: C.muted, fontSize: 12 }}>Données indisponibles pour ce ticker</Text>
              ) : null}
            </View>
          </View>
        )}

        {/* Sens */}
        <View style={s.block}>
          <Text style={s.label}>Sens</Text>
          <View style={s.radioRow}>
            {(['achat', 'vente'] as const).map(d => (
              <TouchableOpacity
                key={d}
                style={[s.radio, direction === d && {
                  borderColor: d === 'achat' ? C.accent : C.down,
                  backgroundColor: d === 'achat' ? 'rgba(123,29,58,0.1)' : 'rgba(239,68,68,0.1)',
                }]}
                onPress={() => setDirection(d)}
              >
                <Text style={{ color: direction === d ? (d === 'achat' ? C.accent : C.down) : C.muted, fontWeight: '600' }}>
                  {d === 'achat' ? 'Achat' : 'Vente'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Type d'ordre */}
        <View style={s.block}>
          <Text style={s.label}>Type d'ordre</Text>
          <View style={s.radioRow}>
            {([['marche', 'Au marché'], ['limite', 'À cours limité']] as const).map(([t, lbl]) => (
              <TouchableOpacity
                key={t}
                style={[s.radio, orderType === t && { borderColor: C.accent, backgroundColor: 'rgba(96,165,250,0.1)' }]}
                onPress={() => setOrderType(t)}
              >
                <Text style={{ color: orderType === t ? C.accent : C.muted, fontWeight: '600' }}>
                  {lbl}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Validité (TimeInForce FIX) */}
        <View style={s.block}>
          <Text style={s.label}>Validité de l'ordre</Text>
          <View style={s.tifRow}>
            {(Object.keys(TIF_LABELS) as TIF[]).map(k => (
              <TouchableOpacity
                key={k}
                style={[s.tifBtn, timeInForce === k && s.tifBtnActive]}
                onPress={() => setTimeInForce(k)}
              >
                <Text style={[s.tifTxt, timeInForce === k && s.tifTxtActive]}>
                  {TIF_LABELS[k]}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={s.tifHint}>{TIF_HINTS[timeInForce]}</Text>
        </View>

        {/* Prix limite */}
        {orderType === 'limite' && (
          <View style={s.block}>
            <Text style={s.label}>Prix limite (MAD)</Text>
            <TextInput
              style={s.input}
              keyboardType="decimal-pad"
              value={limitPrice}
              onChangeText={setLimitPrice}
              placeholder="0.00"
              placeholderTextColor={C.muted}
            />
          </View>
        )}

        {/* Quantité */}
        <View style={s.block}>
          <Text style={s.label}>Quantité (titres)</Text>
          <TextInput
            style={s.input}
            keyboardType="number-pad"
            value={qty}
            onChangeText={setQty}
            placeholder="1"
            placeholderTextColor={C.muted}
          />
        </View>

        {/* Résumé */}
        <View style={s.summary}>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Prix unitaire</Text>
            <Text style={s.summaryVal}>{effectivePrice ? fmtN(effectivePrice) : '—'} MAD</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>Quantité</Text>
            <Text style={s.summaryVal}>{qtyNum}</Text>
          </View>
          <View style={[s.summaryRow, s.summaryTotal]}>
            <Text style={[s.summaryLabel, { color: '#fff', fontWeight: '700' }]}>Montant total</Text>
            <Text style={[s.summaryVal, { color: '#fff', fontWeight: '700' }]}>
              {total ? fmtN(total) : '—'} MAD
            </Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>
              {direction === 'achat' ? 'Solde disponible' : 'Solde espèces'}
            </Text>
            <Text style={[s.summaryVal, { color: total > balance && direction === 'achat' ? C.down : 'rgba(255,255,255,0.6)' }]}>
              {fmtN(balance)} MAD
            </Text>
          </View>
        </View>

        {!open && orderType === 'marche' && (
          <View style={s.warningBox}>
            <Text style={s.warningTxt}>
              Marché fermé — l'ordre sera exécuté à la prochaine ouverture
            </Text>
          </View>
        )}

        <TouchableOpacity
          style={[
            s.confirmBtn,
            { backgroundColor: direction === 'achat' ? C.accent : C.down },
            (!selectedStock || qtyNum < 1 || (orderType === 'limite' && !limitPrice)) && { opacity: 0.4 },
          ]}
          disabled={!selectedStock || qtyNum < 1 || (orderType === 'limite' && !limitPrice)}
          onPress={() => setShowConfirm(true)}
        >
          <Text style={s.confirmTxt}>
            {direction === 'achat' ? "Confirmer l'achat" : 'Confirmer la vente'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* ── Modale de confirmation ─────────────────────────────────────────── */}
      <Modal visible={showConfirm} transparent animationType="fade" onRequestClose={() => setShowConfirm(false)}>
        <View style={cm.overlay}>
          <View style={cm.card}>
            <Text style={cm.title}>Confirmer l'ordre</Text>
            <View style={cm.body}>
              {[
                ['Valeur',   selectedStock?.name ?? ''],
                ['Sens',     direction.toUpperCase()],
                ['Type',     orderType === 'marche' ? 'Au marché' : 'Limité'],
                ['Validité', TIF_LABELS[timeInForce]],
                ['Qté',      `${qtyNum} titre(s)`],
                ['Prix',     `${fmtN(effectivePrice)} MAD`],
              ].map(([k, v]) => (
                <Text key={k} style={cm.line}>
                  <Text style={cm.key}>{k.padEnd(8)}</Text>
                  <Text style={[cm.val, k === 'Sens' && { color: direction === 'achat' ? C.up : C.down, fontWeight: '600' }]}>
                    {v}
                  </Text>
                </Text>
              ))}
              <Text style={[cm.line, cm.totalLine]}>
                <Text style={cm.key}>{'Total'.padEnd(8)}</Text>
                <Text style={{ color: C.txt, fontWeight: '700' }}>{fmtN(total)} MAD</Text>
              </Text>
              {!open && (
                <Text style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>
                  Marché fermé · exécution à l'ouverture
                </Text>
              )}
            </View>
            <View style={cm.actions}>
              <TouchableOpacity style={cm.editBtn} onPress={() => setShowConfirm(false)}>
                <Text style={{ color: C.accent, fontWeight: '600' }}>Modifier</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cm.confirm, { backgroundColor: direction === 'achat' ? C.accent : C.down }]}
                onPress={handleConfirm}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Valider</Text>}
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={cm.cancelLink} onPress={() => { setShowConfirm(false); setSelectedStock(null); setQty('1'); setLimitPrice(''); }}>
              <Text style={{ color: C.muted, fontSize: 13 }}>Annuler l'ordre</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* ── Modale sélection instrument ───────────────────────────────────── */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <KeyboardAvoidingView
          style={pk.overlay}
          behavior="padding"
        >
          <View style={pk.card}>
            <Text style={pk.title}>Sélectionner une valeur</Text>
            <TextInput
              style={pk.search}
              placeholder="Rechercher (ATW, IAM…)"
              placeholderTextColor={C.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
              autoCapitalize="none"
              autoCorrect={false}
            />
            <ScrollView style={{ maxHeight: 280 }} keyboardShouldPersistTaps="handled">
              {filteredStocks.map(st => (
                <TouchableOpacity
                  key={st.name}
                  style={pk.row}
                  onPress={() => { setSelectedStock(st); setShowPicker(false); setSearchQuery(''); }}
                >
                  <View style={{ marginRight: 10 }}>
                    <TickerLogo ticker={st.ticker} size={32} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={pk.name}>{st.ticker ? `${st.ticker} — ${st.name}` : st.name}</Text>
                    <Text style={pk.sector}>{st.sector}</Text>
                  </View>
                  <Text style={pk.price}>{fmtN(st.price)} MAD</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={pk.close} onPress={() => { setShowPicker(false); setSearchQuery(''); }}>
              <Text style={{ color: C.muted, textAlign: 'center' }}>Fermer</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: C.bg },

  block:             { marginHorizontal: 16, marginBottom: 14 },
  label:             { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  picker:            { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.panel, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: C.line },
  pickerTxt:         { color: C.txt, fontSize: 14, flex: 1 },
  pickerPlaceholder: { color: C.muted, fontSize: 14, flex: 1 },
  livePrice:         { flexDirection: 'row', alignItems: 'baseline', marginHorizontal: 16, marginBottom: 14 },
  livePriceVal:      { fontSize: 24, fontWeight: '700', color: C.txt },
  radioRow:          { flexDirection: 'row', gap: 10 },
  radio:             { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', backgroundColor: C.panel },
  input:             { backgroundColor: C.panel, borderRadius: 10, padding: 14, fontSize: 16, color: C.txt, borderWidth: 1, borderColor: C.line },
  summary:           { marginHorizontal: 16, backgroundColor: '#1A060E', borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.1)' },
  summaryRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  summaryTotal:      { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.2)', marginTop: 8, paddingTop: 8 },
  summaryLabel:      { fontSize: 13, color: 'rgba(255,255,255,0.6)' },
  summaryVal:        { fontSize: 13, color: '#fff' },
  warningBox:        { marginHorizontal: 16, marginBottom: 10, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  warningTxt:        { color: C.gold, fontSize: 12 },
  scaNotice:         { marginHorizontal: 16, marginBottom: 14, backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)' },
  scaNoticeTxt:      { color: C.accent, fontSize: 12 },
  confirmBtn:        { marginHorizontal: 16, padding: 16, borderRadius: 12, alignItems: 'center' },
  confirmTxt:        { color: '#fff', fontSize: 16, fontWeight: '700' },
  tifRow:            { flexDirection: 'row', gap: 8 },
  tifBtn:            { flex: 1, paddingVertical: 9, borderRadius: 8, borderWidth: 1, borderColor: C.line, alignItems: 'center', backgroundColor: C.panel },
  tifBtnActive:      { borderColor: C.accent, backgroundColor: 'rgba(123,29,58,0.1)' },
  tifTxt:            { fontSize: 12, fontWeight: '700', color: C.muted },
  tifTxtActive:      { color: C.accent },
  tifHint:           { fontSize: 11, color: C.muted, marginTop: 6 },

  // ── Détail instrument ────────────────────────────────────────────────────
  detailHeader:  { flexDirection: 'row', alignItems: 'flex-start', marginHorizontal: 16, marginBottom: 10, gap: 10 },
  detailName:    { fontSize: 15, fontWeight: '700', color: C.txt },
  detailSector:  { fontSize: 12, color: C.muted, marginTop: 2 },
  etatBadge:     { backgroundColor: 'rgba(22,163,74,0.1)', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, borderColor: 'rgba(22,163,74,0.25)' },
  etatTxt:       { fontSize: 11, fontWeight: '700', color: C.up },
  detailPriceRow:{ marginHorizontal: 16, marginBottom: 14 },
  detailPrice:   { fontSize: 26, fontWeight: '800', color: C.txt },

  // ── Grille OHLC ──────────────────────────────────────────────────────────
  ohlcGrid:  { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ohlcItem:  { width: '30%', flexGrow: 1, backgroundColor: C.panel2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  ohlcLabel: { fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  ohlcVal:   { fontSize: 13, fontWeight: '600', color: C.txt },

  // ── Carnet BVC ───────────────────────────────────────────────────────────
  bookRow:      { flexDirection: 'row', gap: 8, alignItems: 'stretch' },
  bookSide:     { flex: 1, borderRadius: 10, borderWidth: 1, padding: 10, alignItems: 'center' },
  bookSpread:   { width: 48, alignItems: 'center', justifyContent: 'center' },
  bookSpreadTxt:{ fontSize: 12, fontWeight: '700', color: C.muted },
  bookLabel:    { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.5, fontWeight: '700', marginBottom: 4 },
  bookPrice:    { fontSize: 15, fontWeight: '700' },
  bookQty:      { fontSize: 11, color: C.muted, marginTop: 2 },
  txRow:        { flexDirection: 'row', alignItems: 'center', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: C.line, gap: 8 },
  txTime:       { fontSize: 12, color: C.muted, width: 40 },
  txPrice:      { flex: 1, fontSize: 13, fontWeight: '600', color: C.txt },
  txQty:        { fontSize: 12, color: C.muted },
});

const cm = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card:      { backgroundColor: C.panel, borderRadius: 16, padding: 24, width: '100%', borderWidth: 1, borderColor: C.line },
  title:     { fontSize: 18, fontWeight: '700', color: C.txt, marginBottom: 16 },
  body:      { gap: 8, marginBottom: 20 },
  line:      { fontSize: 14, color: C.muted },
  key:       { color: C.muted },
  val:       { color: C.txt },
  totalLine: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8, marginTop: 4 },
  actions:    { flexDirection: 'row', gap: 10 },
  editBtn:    { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.accent, alignItems: 'center' },
  confirm:    { flex: 2, padding: 12, borderRadius: 10, alignItems: 'center' },
  cancelLink: { alignItems: 'center', paddingTop: 12 },
});

const pk = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  card:    { backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderWidth: 1, borderColor: C.line },
  title:   { fontSize: 16, fontWeight: '700', color: C.txt, marginBottom: 12 },
  search:  { backgroundColor: C.panel2, borderRadius: 10, padding: 12, color: C.txt, fontSize: 13, marginBottom: 8, borderWidth: 1, borderColor: C.line },
  row:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  name:    { fontSize: 14, fontWeight: '600', color: C.txt },
  sector:  { fontSize: 11, color: C.muted, marginTop: 2 },
  price:   { fontSize: 14, color: C.txt },
  close:   { padding: 14, marginTop: 8 },
});
