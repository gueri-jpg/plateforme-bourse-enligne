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
import { ScreenHeader } from '../components/ScreenHeader';
import { fetchPortfolio, placeOrdre, PlaceOrdreParams } from '../api/portfolio';
import { isMarketOpen } from '../../services/trading';
import { useNotifications } from '../store/useNotifications';
import type { MainTabParamList } from '../navigation/types';

const C = {
  bg: '#f8fafc', panel: '#ffffff', panel2: '#f1f5f9',
  txt: '#0f172a', muted: '#64748b', line: '#e2e8f0',
  up: '#16a34a', down: '#dc2626', accent: '#7B1D3A', gold: '#f59e0b',
};

function fmtN(x: number | null | undefined, dp = 2) {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

function StatCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <View style={st.cell}>
      <Text style={st.cellLabel}>{label}</Text>
      <Text style={[st.cellVal, color ? { color } : null]}>{value}</Text>
    </View>
  );
}

function LiveStatsPanel({ stock }: { stock: Stock }) {
  const pctColor = isNaN(stock.pct) ? C.muted : stock.pct > 0 ? C.up : stock.pct < 0 ? C.down : C.muted;
  const etatLabel = stock.etat === 'T' ? 'En négociation'
    : stock.etat === 'R' ? 'Réservé'
    : stock.etat === 'S' ? 'Suspendu'
    : stock.etat || '—';
  const etatColor = stock.etat === 'T' ? C.up : C.gold;

  return (
    <View style={st.panel}>
      {/* Ligne prix + variation */}
      <View style={st.header}>
        <Text style={st.price}>{fmtN(stock.price)} MAD</Text>
        <View style={[st.badge, { backgroundColor: stock.pct >= 0 ? 'rgba(22,163,74,0.12)' : 'rgba(220,38,38,0.12)' }]}>
          <Text style={[st.badgeTxt, { color: pctColor }]}>
            {isNaN(stock.pct) ? '—' : (stock.pct > 0 ? '▲ ' : '▼ ') + Math.abs(stock.pct).toFixed(2) + '%'}
          </Text>
        </View>
        <View style={st.etatRow}>
          <View style={[st.etatDot, { backgroundColor: etatColor }]} />
          <Text style={[st.etatTxt, { color: etatColor }]}>{etatLabel}</Text>
        </View>
      </View>

      {/* Grille 2 colonnes */}
      <View style={st.grid}>
        <StatCell label="Transactions" value={isNaN(stock.totalTrades) ? '—' : stock.totalTrades.toLocaleString('fr-FR')} color={C.accent} />
        <StatCell label="Vol. titres"   value={fmtN(stock.volQty, 0)} />
        <StatCell label="Vol. MAD"      value={fmtN(stock.volMAD, 0)} />
        <StatCell label="Réf. veille"   value={`${fmtN(stock.refPrice)} MAD`} />
        <StatCell label="+ Haut"        value={`${fmtN(stock.high)} MAD`}  color={C.up} />
        <StatCell label="+ Bas"         value={`${fmtN(stock.low)} MAD`}   color={C.down} />
        <StatCell label={`Bid ×${isNaN(stock.bidSize) ? '—' : stock.bidSize}`}  value={`${fmtN(stock.bid)} MAD`}  color={C.up} />
        <StatCell label={`Ask ×${isNaN(stock.askSize) ? '—' : stock.askSize}`}  value={`${fmtN(stock.ask)} MAD`}  color={C.down} />
      </View>

      <Text style={st.liveHint}>· Mis à jour en direct (BVC)</Text>
    </View>
  );
}

type OrdresRoute = RouteProp<MainTabParamList, 'Ordre'>;

export function OrdresScreen() {
  const route       = useRoute<OrdresRoute>();
  const { stocks }  = useMarketData();

  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [direction, setDirection]         = useState<'achat' | 'vente'>('achat');
  const [orderType, setOrderType]         = useState<'marche' | 'limite'>('marche');
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
    };
  }

  const handleConfirm = async () => {
    if (!selectedStock) return;
    setSubmitting(true);
    const res = await placeOrdre(buildOrdreParams());
    setSubmitting(false);

    if (res.success) {
      setShowConfirm(false);
      setQty('1');
      setLimitPrice('');
      fetchPortfolio().then(p => setBalance(p.solde_especes)).catch(() => {});
      useNotifications.getState().add({
        type:  direction,
        title: `Ordre ${direction === 'achat' ? 'achat' : 'vente'} soumis ✓`,
        body:  `${qtyNum}× ${selectedStock.name} — ${fmtN(total)} MAD`,
      });
      Alert.alert('Ordre soumis', `Ordre ${direction} de ${qtyNum}× ${selectedStock.name} enregistré.`);
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
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 32 }}>

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

        {/* Stats temps réel */}
        {selectedStock && <LiveStatsPanel stock={selectedStock} />}

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
                ['Valeur',  selectedStock?.name ?? ''],
                ['Sens',    direction.toUpperCase()],
                ['Type',    orderType === 'marche' ? 'Au marché' : 'Limité'],
                ['Qté',     `${qtyNum} titre(s)`],
                ['Prix',    `${fmtN(effectivePrice)} MAD`],
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

// ── Styles panneau stats temps réel ──────────────────────────────────────────
const st = StyleSheet.create({
  panel:    { marginHorizontal: 16, marginBottom: 14, backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, padding: 14 },
  header:   { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  price:    { fontSize: 22, fontWeight: '700', color: C.txt },
  badge:    { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 3 },
  badgeTxt: { fontSize: 13, fontWeight: '700' },
  etatRow:  { flexDirection: 'row', alignItems: 'center', gap: 5, marginLeft: 'auto' },
  etatDot:  { width: 7, height: 7, borderRadius: 4 },
  etatTxt:  { fontSize: 11, fontWeight: '600' },
  grid:     { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  cell:     { width: '48%', backgroundColor: C.panel2, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 10 },
  cellLabel:{ fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 3 },
  cellVal:  { fontSize: 13, fontWeight: '600', color: C.txt },
  liveHint: { fontSize: 10, color: C.muted, textAlign: 'right', marginTop: 8 },
});
