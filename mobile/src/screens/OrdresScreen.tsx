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
import { fetchPortfolio, placeOrdre, verifySCA, envoyerOTP, PlaceOrdreParams } from '../api/portfolio';
import { isMarketOpen } from '../../services/trading';
import type { MainTabParamList } from '../navigation/types';

const C = {
  bg: '#070b1c', panel: '#111733', panel2: '#0e1430',
  txt: '#e7ecff', muted: '#8a93b8', line: '#1f2a52',
  up: '#22c55e', down: '#ef4444', accent: '#60a5fa', gold: '#f59e0b',
};

function fmtN(x: number | null | undefined, dp = 2) {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
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
  const [showConfirm, setShowConfirm]     = useState(false);
  const [showSCA, setShowSCA]             = useState(false);
  const [scaCode, setScaCode]             = useState('');
  const [maskedEmail, setMaskedEmail]     = useState('');
  const [scaSending, setScaSending]       = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [scaSubmitting, setScaSubmitting] = useState(false);

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
    ? stocks.filter(s => s.name.toLowerCase().includes(searchQuery.toLowerCase()))
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
      Alert.alert('Ordre soumis', `Ordre ${direction} de ${qtyNum}× ${selectedStock.name} enregistré.`);
      return;
    }

    if (res.scaRequired) {
      setShowConfirm(false);
      setScaCode('');
      setScaSending(true);
      try {
        const r = await envoyerOTP();
        setMaskedEmail(r.masked_email);
      } catch {
        Alert.alert('Erreur', "Impossible d'envoyer le code OTP. Réessayez.");
        setScaSending(false);
        return;
      }
      setScaSending(false);
      setShowSCA(true);
      return;
    }

    setShowConfirm(false);
    Alert.alert('Erreur', res.message);
  };

  const handleSCAVerify = async () => {
    if (scaCode.length !== 6) {
      Alert.alert('Code invalide', 'Saisissez un code à 6 chiffres.');
      return;
    }
    setScaSubmitting(true);
    const ok = await verifySCA(scaCode);
    if (!ok) {
      setScaSubmitting(false);
      Alert.alert('Code incorrect', 'Le code SCA saisi est incorrect. Réessayez.');
      return;
    }

    // SCA validé : soumettre l'ordre
    const res = await placeOrdre(buildOrdreParams());
    setScaSubmitting(false);
    setShowSCA(false);

    if (res.success) {
      setQty('1');
      setLimitPrice('');
      fetchPortfolio().then(p => setBalance(p.solde_especes)).catch(() => {});
      Alert.alert('Ordre soumis', `Ordre ${direction} de ${qtyNum}× ${selectedStock!.name} enregistré.`);
    } else if (res.scaRequired) {
      Alert.alert('Erreur', 'Authentification forte requise. Veuillez réessayer.');
    } else {
      Alert.alert('Erreur', res.message);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView style={s.container} contentContainerStyle={{ paddingTop: 16, paddingBottom: 32 }}>
        <Text style={s.sectionTitle}>Passer un ordre</Text>

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

        {/* Cours temps réel */}
        {selectedStock && (
          <View style={s.livePrice}>
            <Text style={s.livePriceVal}>{fmtN(selectedStock.price)} MAD</Text>
            <Text style={{
              color: isNaN(selectedStock.pct) ? C.muted
                : selectedStock.pct > 0 ? C.up : C.down,
              fontSize: 14, marginLeft: 10,
            }}>
              {isNaN(selectedStock.pct) ? '' :
                (selectedStock.pct > 0 ? '▲ ' : '▼ ') + Math.abs(selectedStock.pct).toFixed(2) + '%'}
            </Text>
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
                  borderColor: d === 'achat' ? C.up : C.down,
                  backgroundColor: d === 'achat' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                }]}
                onPress={() => setDirection(d)}
              >
                <Text style={{ color: direction === d ? (d === 'achat' ? C.up : C.down) : C.muted, fontWeight: '600' }}>
                  {d === 'achat' ? '📈 Achat' : '📉 Vente'}
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
            <Text style={[s.summaryLabel, { color: C.txt, fontWeight: '700' }]}>Montant total</Text>
            <Text style={[s.summaryVal, { color: C.txt, fontWeight: '700' }]}>
              {total ? fmtN(total) : '—'} MAD
            </Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>
              {direction === 'achat' ? 'Solde disponible' : 'Solde espèces'}
            </Text>
            <Text style={[s.summaryVal, { color: total > balance && direction === 'achat' ? C.down : C.muted }]}>
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

        <View style={s.scaNotice}>
          <Text style={s.scaNoticeTxt}>
            🔒 Un code de sécurité (SCA) sera demandé lors de la confirmation
          </Text>
        </View>

        <TouchableOpacity
          style={[
            s.confirmBtn,
            { backgroundColor: direction === 'achat' ? C.up : C.down },
            (!selectedStock || qtyNum < 1 || (orderType === 'limite' && !limitPrice)) && { opacity: 0.4 },
          ]}
          disabled={!selectedStock || qtyNum < 1 || (orderType === 'limite' && !limitPrice)}
          onPress={() => setShowConfirm(true)}
        >
          <Text style={s.confirmTxt}>
            {direction === 'achat' ? "📈 Confirmer l'achat" : '📉 Confirmer la vente'}
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
              <TouchableOpacity style={cm.cancel} onPress={() => setShowConfirm(false)}>
                <Text style={{ color: C.txt }}>Annuler</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cm.confirm, { backgroundColor: direction === 'achat' ? C.up : C.down }]}
                onPress={handleConfirm}
                disabled={submitting}
              >
                {submitting
                  ? <ActivityIndicator color="#fff" size="small" />
                  : <Text style={{ color: '#fff', fontWeight: '700' }}>Valider</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modale SCA ────────────────────────────────────────────────────── */}
      <Modal visible={showSCA} transparent animationType="slide" onRequestClose={() => setShowSCA(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <View style={sca.overlay}>
            <View style={sca.card}>
              <Text style={sca.title}>🔒 Authentification forte</Text>
              {scaSending ? (
                <ActivityIndicator color={C.accent} style={{ marginBottom: 20 }} />
              ) : (
                <Text style={sca.subtitle}>
                  Code envoyé par email{maskedEmail ? ` à ${maskedEmail}` : ''}.{'\n'}
                  Saisissez les 6 chiffres reçus pour valider l'ordre.
                </Text>
              )}
              <TextInput
                style={sca.input}
                keyboardType="number-pad"
                maxLength={6}
                value={scaCode}
                onChangeText={setScaCode}
                placeholder="• • • • • •"
                placeholderTextColor={C.muted}
                textAlign="center"
                autoFocus
              />
              <View style={sca.actions}>
                <TouchableOpacity style={sca.cancel} onPress={() => setShowSCA(false)}>
                  <Text style={{ color: C.muted }}>Annuler l'ordre</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[sca.confirm, scaCode.length !== 6 && { opacity: 0.4 }]}
                  onPress={handleSCAVerify}
                  disabled={scaCode.length !== 6 || scaSubmitting}
                >
                  {scaSubmitting
                    ? <ActivityIndicator color="#fff" size="small" />
                    : <Text style={{ color: '#fff', fontWeight: '700' }}>Valider</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Modale sélection instrument ───────────────────────────────────── */}
      <Modal visible={showPicker} transparent animationType="slide" onRequestClose={() => setShowPicker(false)}>
        <View style={pk.overlay}>
          <View style={pk.card}>
            <Text style={pk.title}>Sélectionner une valeur</Text>
            <TextInput
              style={pk.search}
              placeholder="Rechercher…"
              placeholderTextColor={C.muted}
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            <ScrollView style={{ maxHeight: 400 }}>
              {filteredStocks.map(st => (
                <TouchableOpacity
                  key={st.name}
                  style={pk.row}
                  onPress={() => { setSelectedStock(st); setShowPicker(false); setSearchQuery(''); }}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={pk.name}>{st.name}</Text>
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
        </View>
      </Modal>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  container:         { flex: 1, backgroundColor: C.bg },
  sectionTitle:      { fontSize: 18, fontWeight: '700', color: C.txt, margin: 16, marginBottom: 8 },
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
  summary:           { marginHorizontal: 16, backgroundColor: C.panel2, borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.line },
  summaryRow:        { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  summaryTotal:      { borderTopWidth: 1, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  summaryLabel:      { fontSize: 13, color: C.muted },
  summaryVal:        { fontSize: 13, color: C.muted },
  warningBox:        { marginHorizontal: 16, marginBottom: 10, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  warningTxt:        { color: C.gold, fontSize: 12 },
  scaNotice:         { marginHorizontal: 16, marginBottom: 14, backgroundColor: 'rgba(96,165,250,0.08)', borderRadius: 10, padding: 10, borderWidth: 1, borderColor: 'rgba(96,165,250,0.2)' },
  scaNoticeTxt:      { color: C.accent, fontSize: 12 },
  confirmBtn:        { marginHorizontal: 16, padding: 16, borderRadius: 12, alignItems: 'center' },
  confirmTxt:        { color: '#fff', fontSize: 16, fontWeight: '700' },
});

const cm = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(5,8,20,0.8)', justifyContent: 'center', alignItems: 'center', padding: 20 },
  card:      { backgroundColor: C.panel, borderRadius: 16, padding: 24, width: '100%', borderWidth: 1, borderColor: C.line },
  title:     { fontSize: 18, fontWeight: '700', color: C.txt, marginBottom: 16 },
  body:      { gap: 8, marginBottom: 20 },
  line:      { fontSize: 14, color: C.muted },
  key:       { color: C.muted },
  val:       { color: C.txt },
  totalLine: { borderTopWidth: 1, borderTopColor: C.line, paddingTop: 8, marginTop: 4 },
  actions:   { flexDirection: 'row', gap: 10 },
  cancel:    { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center' },
  confirm:   { flex: 2, padding: 12, borderRadius: 10, alignItems: 'center' },
});

const sca = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(5,8,20,0.85)', justifyContent: 'flex-end' },
  card:     { backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 28, paddingBottom: 40, borderWidth: 1, borderColor: C.line },
  title:    { fontSize: 18, fontWeight: '700', color: C.txt, marginBottom: 8, textAlign: 'center' },
  subtitle: { fontSize: 13, color: C.muted, textAlign: 'center', marginBottom: 20, lineHeight: 18 },
  input:    { backgroundColor: C.panel2, borderRadius: 12, padding: 18, fontSize: 28, fontWeight: '700', color: C.txt, borderWidth: 1, borderColor: C.accent, letterSpacing: 12, marginBottom: 20 },
  actions:  { flexDirection: 'row', gap: 10 },
  cancel:   { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center' },
  confirm:  { flex: 2, padding: 14, borderRadius: 10, backgroundColor: C.accent, alignItems: 'center' },
});

const pk = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(5,8,20,0.8)', justifyContent: 'flex-end' },
  card:    { backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, borderWidth: 1, borderColor: C.line },
  title:   { fontSize: 16, fontWeight: '700', color: C.txt, marginBottom: 12 },
  search:  { backgroundColor: C.panel2, borderRadius: 10, padding: 12, color: C.txt, fontSize: 13, marginBottom: 8, borderWidth: 1, borderColor: C.line },
  row:     { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  name:    { fontSize: 14, fontWeight: '600', color: C.txt },
  sector:  { fontSize: 11, color: C.muted, marginTop: 2 },
  price:   { fontSize: 14, color: C.txt },
  close:   { padding: 14, marginTop: 8 },
});
