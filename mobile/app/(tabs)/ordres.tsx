import { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, ScrollView, Modal, Alert, KeyboardAvoidingView, Platform,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, useFocusEffect } from 'expo-router';
import { useMarketData, Stock } from '../../hooks/useMarketData';
import { getPortfolio, placeOrder, isMarketOpen } from '../../services/trading';
import { getValidAccessToken } from '../../services/auth';
import { CONFIG } from '../../constants/config';

const C = {
  bg: '#070b1c', panel: '#111733', panel2: '#0e1430',
  txt: '#e7ecff', muted: '#8a93b8', line: '#1f2a52',
  up: '#22c55e', down: '#ef4444', accent: '#60a5fa', gold: '#f59e0b',
};

const otp = StyleSheet.create({
  overlay:         { flex: 1, backgroundColor: 'rgba(5,8,20,0.85)', justifyContent: 'flex-start', alignItems: 'center', paddingTop: 80, paddingHorizontal: 20 },
  card:            { backgroundColor: C.panel, borderRadius: 16, padding: 24, width: '100%', borderWidth: 1, borderColor: C.line },
  title:           { fontSize: 18, fontWeight: '700', color: C.txt, marginBottom: 6, textAlign: 'center' },
  subtitle:        { fontSize: 13, color: C.muted, textAlign: 'center', marginBottom: 16, lineHeight: 20 },
  email:           { color: C.accent, fontWeight: '600' },
  errorTxt:        { color: '#ef4444', fontSize: 12, textAlign: 'center', marginBottom: 10 },
  codeInput:       { backgroundColor: C.panel2, borderRadius: 10, borderWidth: 1, borderColor: C.line, fontSize: 28, letterSpacing: 12, color: C.txt, textAlign: 'center', paddingVertical: 16, marginBottom: 20 },
  btnPrimary:      { backgroundColor: C.up, borderRadius: 10, padding: 14, alignItems: 'center', marginBottom: 12 },
  btnPrimaryTxt:   { color: '#fff', fontWeight: '700', fontSize: 15 },
  row:             { flexDirection: 'row', gap: 10 },
  btnSecondary:    { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: C.accent, padding: 12, alignItems: 'center' },
  btnSecondaryTxt: { color: C.accent, fontSize: 13, fontWeight: '600' },
  btnCancel:       { flex: 1, borderRadius: 10, borderWidth: 1, borderColor: C.line, padding: 12, alignItems: 'center' },
});

function fmtN(x: number | null | undefined, dp = 2) {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export default function OrdresScreen() {
  const params = useLocalSearchParams<{ stock?: string; direction?: string }>();
  const { stocks } = useMarketData();

  const [selectedStock, setSelectedStock] = useState<Stock | null>(null);
  const [direction, setDirection]         = useState<'achat' | 'vente'>('achat');
  const [orderType, setOrderType]         = useState<'marche' | 'limite'>('marche');
  const [qty, setQty]                     = useState('1');
  const [limitPrice, setLimitPrice]       = useState('');
  const [balance, setBalance]             = useState(0);
  const [showPicker, setShowPicker]       = useState(false);
  const [showConfirm, setShowConfirm]     = useState(false);
  const [searchQuery, setSearchQuery]     = useState('');
  const [submitting, setSubmitting]       = useState(false);
  const [resultMsg, setResultMsg]         = useState('');
  // ── OTP SCA ──────────────────────────────────────────────────────────────
  const [showOtp, setShowOtp]             = useState(false);
  const [otpCode, setOtpCode]             = useState('');
  const [maskedEmail, setMaskedEmail]     = useState('');
  const [otpSending, setOtpSending]       = useState(false);
  const [otpVerifying, setOtpVerifying]   = useState(false);
  const [otpError, setOtpError]           = useState('');
  const [resendCooldown, setResendCooldown] = useState(0);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useFocusEffect(useCallback(() => {
    getPortfolio().then(p => setBalance(p.balance));
  }, []));

  // ── OTP : envoyer le code ─────────────────────────────────────────────────
  const sendOtp = async () => {
    setOtpSending(true);
    setOtpError('');
    try {
      const token = await getValidAccessToken();
      if (!token) throw new Error('Non authentifié.');
      const res = await fetch(`${CONFIG.API_BASE_URL}/api/sca/envoyer-otp`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Erreur envoi OTP.');
      setMaskedEmail(data.masked_email ?? '');
      // Cooldown 30s avant de pouvoir renvoyer
      setResendCooldown(30);
      cooldownRef.current = setInterval(() => {
        setResendCooldown(v => {
          if (v <= 1) { clearInterval(cooldownRef.current!); return 0; }
          return v - 1;
        });
      }, 1000);
    } catch (e: any) {
      setOtpError(e.message || 'Impossible d\'envoyer le code OTP.');
    } finally {
      setOtpSending(false);
    }
  };

  // ── OTP : vérifier puis passer l'ordre ───────────────────────────────────
  const verifyAndPlace = async () => {
    if (otpCode.length !== 6) { setOtpError('Saisissez 6 chiffres.'); return; }
    setOtpVerifying(true);
    setOtpError('');
    try {
      const token = await getValidAccessToken();
      if (!token) throw new Error('Non authentifié.');
      const res = await fetch(`${CONFIG.API_BASE_URL}/api/sca/verifier`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: otpCode }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Code incorrect.');

      // OTP validé → passer l'ordre
      setShowOtp(false);
      setOtpCode('');
      if (cooldownRef.current) clearInterval(cooldownRef.current);
      await doPlaceOrder();
    } catch (e: any) {
      setOtpCode('');
      setOtpError(e.message || 'Code OTP invalide.');
    } finally {
      setOtpVerifying(false);
    }
  };

  // ── Passer l'ordre (après validation OTP) ────────────────────────────────
  const doPlaceOrder = async () => {
    if (!selectedStock) return;
    setSubmitting(true);
    const res = await placeOrder({
      name: selectedStock.name, sector: selectedStock.sector,
      direction, type: orderType, qty: qtyNum,
      price: orderType === 'limite' ? parseFloat(limitPrice) : selectedStock.price,
    });
    setSubmitting(false);
    setResultMsg(res.message ?? '');
    if (res.success) {
      setQty('1');
      setLimitPrice('');
      getPortfolio().then(p => setBalance(p.balance));
    }
    Alert.alert(res.success ? '✓ Ordre soumis' : '✗ Erreur', res.message ?? '');
  };

  useEffect(() => {
    if (params.stock && stocks.length > 0) {
      const found = stocks.find(s => s.name === params.stock);
      if (found) setSelectedStock(found);
    }
    if (params.direction === 'vente') setDirection('vente');
    if (params.direction === 'achat') setDirection('achat');
  }, [params.stock, params.direction, stocks]);

  // Sync selected stock live price
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

  const handleConfirm = async () => {
    setShowConfirm(false);
    setOtpCode('');
    setOtpError('');
    setMaskedEmail('');
    setShowOtp(true);
    await sendOtp();
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 32 }}>
        <Text style={s.sectionTitle}>Passer un ordre</Text>

        {/* Instrument */}
        <View style={s.block}>
          <Text style={s.label}>Instrument</Text>
          <TouchableOpacity style={s.picker} onPress={() => setShowPicker(true)}>
            <Text style={selectedStock ? s.pickerTxt : s.pickerPlaceholder}>
              {selectedStock ? `${selectedStock.name}  —  ${fmtN(selectedStock.price)} MAD` : 'Sélectionner une valeur…'}
            </Text>
            <Text style={{ color: C.muted }}>▾</Text>
          </TouchableOpacity>
        </View>

        {/* Variation rapide */}
        {selectedStock && (
          <View style={s.livePrice}>
            <Text style={s.livePriceVal}>{fmtN(selectedStock.price)} MAD</Text>
            <Text style={{
              color: isNaN(selectedStock.pct) ? C.muted : selectedStock.pct > 0 ? C.up : C.down,
              fontSize: 14, marginLeft: 10,
            }}>
              {isNaN(selectedStock.pct) ? '' : (selectedStock.pct > 0 ? '▲ ' : '▼ ') + Math.abs(selectedStock.pct).toFixed(2) + '%'}
            </Text>
          </View>
        )}

        {/* Direction */}
        <View style={s.block}>
          <Text style={s.label}>Sens</Text>
          <View style={s.radioRow}>
            {(['achat', 'vente'] as const).map(d => (
              <TouchableOpacity key={d} style={[s.radio, direction === d && {
                borderColor: d === 'achat' ? C.up : C.down,
                backgroundColor: d === 'achat' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              }]} onPress={() => setDirection(d)}>
                <Text style={{ color: direction === d ? (d === 'achat' ? C.up : C.down) : C.muted, fontWeight: '600' }}>
                  {d === 'achat' ? '📈 Achat' : '📉 Vente'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Type */}
        <View style={s.block}>
          <Text style={s.label}>Type d'ordre</Text>
          <View style={s.radioRow}>
            {([['marche', 'Au marché'], ['limite', 'À cours limité']] as const).map(([t, lbl]) => (
              <TouchableOpacity key={t} style={[s.radio, orderType === t && { borderColor: C.accent, backgroundColor: 'rgba(96,165,250,0.1)' }]}
                onPress={() => setOrderType(t)}>
                <Text style={{ color: orderType === t ? C.accent : C.muted, fontWeight: '600' }}>{lbl}</Text>
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
            <Text style={[s.summaryVal, { color: C.txt, fontWeight: '700' }]}>{total ? fmtN(total) : '—'} MAD</Text>
          </View>
          <View style={s.summaryRow}>
            <Text style={s.summaryLabel}>{direction === 'achat' ? 'Solde disponible' : 'Position'}</Text>
            <Text style={[s.summaryVal, { color: total > balance && direction === 'achat' ? C.down : C.muted }]}>
              {fmtN(balance)} MAD
            </Text>
          </View>
        </View>

        {/* Marché fermé */}
        {!open && orderType === 'marche' && (
          <View style={s.warningBox}>
            <Text style={s.warningTxt}>⚠️  Marché fermé — l'ordre sera exécuté à la prochaine ouverture</Text>
          </View>
        )}

        {/* Bouton */}
        <TouchableOpacity
          style={[s.confirmBtn, { backgroundColor: direction === 'achat' ? C.up : C.down },
            (!selectedStock || qtyNum < 1 || (orderType === 'limite' && !limitPrice)) && { opacity: 0.4 }]}
          disabled={!selectedStock || qtyNum < 1 || (orderType === 'limite' && !limitPrice)}
          onPress={() => setShowConfirm(true)}
        >
          <Text style={s.confirmTxt}>
            {direction === 'achat' ? '📈 Confirmer l\'achat' : '📉 Confirmer la vente'}
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Modal confirmation */}
      <Modal visible={showConfirm} transparent animationType="fade" onRequestClose={() => setShowConfirm(false)}>
        <View style={cm.overlay}>
          <View style={cm.card}>
            <Text style={cm.title}>Confirmer l'ordre</Text>
            <View style={cm.body}>
              <Text style={cm.line}><Text style={cm.key}>Valeur </Text><Text style={cm.val}>{selectedStock?.name}</Text></Text>
              <Text style={cm.line}><Text style={cm.key}>Sens   </Text><Text style={{ color: direction === 'achat' ? C.up : C.down, fontWeight: '600' }}>{direction.toUpperCase()}</Text></Text>
              <Text style={cm.line}><Text style={cm.key}>Type   </Text><Text style={cm.val}>{orderType === 'marche' ? 'Au marché' : 'Limité'}</Text></Text>
              <Text style={cm.line}><Text style={cm.key}>Qté    </Text><Text style={cm.val}>{qtyNum} titre(s)</Text></Text>
              <Text style={cm.line}><Text style={cm.key}>Prix   </Text><Text style={cm.val}>{fmtN(effectivePrice)} MAD</Text></Text>
              <Text style={[cm.line, cm.totalLine]}><Text style={cm.key}>Total  </Text><Text style={{ color: C.txt, fontWeight: '700' }}>{fmtN(total)} MAD</Text></Text>
              {!open && <Text style={{ color: C.gold, fontSize: 12, marginTop: 8 }}>⚠️  Marché fermé · exécution à l'ouverture</Text>}
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
                <Text style={{ color: '#fff', fontWeight: '700' }}>{submitting ? '…' : '✓ Confirmer'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* ── Modal OTP SCA ── */}
      <Modal visible={showOtp} transparent animationType="fade" onRequestClose={() => { setShowOtp(false); if (cooldownRef.current) clearInterval(cooldownRef.current); }}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={otp.overlay}>
            <View style={otp.card}>
              <Text style={otp.title}>Confirmation de l'ordre</Text>
              <Text style={otp.subtitle}>
                Un code OTP a été envoyé à{'\n'}
                <Text style={otp.email}>{maskedEmail || '…'}</Text>
              </Text>

              {otpError ? <Text style={otp.errorTxt}>{otpError}</Text> : null}

              <TextInput
                style={otp.codeInput}
                placeholder="• • • • • •"
                placeholderTextColor={C.muted}
                keyboardType="number-pad"
                maxLength={6}
                value={otpCode}
                onChangeText={v => { setOtpCode(v.replace(/\D/g, '')); setOtpError(''); }}
                autoFocus
              />

              <TouchableOpacity
                style={[otp.btnPrimary, (otpVerifying || otpCode.length !== 6) && { opacity: 0.45 }]}
                onPress={verifyAndPlace}
                disabled={otpVerifying || otpCode.length !== 6}
              >
                {otpVerifying
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={otp.btnPrimaryTxt}>✓ Valider l'ordre</Text>}
              </TouchableOpacity>

              <View style={otp.row}>
                <TouchableOpacity
                  style={[otp.btnSecondary, (resendCooldown > 0 || otpSending) && { opacity: 0.4 }]}
                  onPress={sendOtp}
                  disabled={resendCooldown > 0 || otpSending}
                >
                  {otpSending
                    ? <ActivityIndicator color={C.accent} size="small" />
                    : <Text style={otp.btnSecondaryTxt}>{resendCooldown > 0 ? `Renvoyer (${resendCooldown}s)` : 'Renvoyer le code'}</Text>}
                </TouchableOpacity>
                <TouchableOpacity style={otp.btnCancel} onPress={() => { setShowOtp(false); if (cooldownRef.current) clearInterval(cooldownRef.current); }}>
                  <Text style={{ color: C.muted }}>Annuler</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Picker modal */}
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
                <TouchableOpacity key={st.name} style={pk.row} onPress={() => {
                  setSelectedStock(st);
                  setShowPicker(false);
                  setSearchQuery('');
                }}>
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
  container:        { flex: 1, backgroundColor: C.bg },
  sectionTitle:     { fontSize: 18, fontWeight: '700', color: C.txt, margin: 16, marginBottom: 8 },
  block:            { marginHorizontal: 16, marginBottom: 14 },
  label:            { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  picker:           { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: C.panel, borderRadius: 10, padding: 14, borderWidth: 1, borderColor: C.line },
  pickerTxt:        { color: C.txt, fontSize: 14, flex: 1 },
  pickerPlaceholder:{ color: C.muted, fontSize: 14, flex: 1 },
  livePrice:        { flexDirection: 'row', alignItems: 'baseline', marginHorizontal: 16, marginBottom: 14 },
  livePriceVal:     { fontSize: 24, fontWeight: '700', color: C.txt },
  radioRow:         { flexDirection: 'row', gap: 10 },
  radio:            { flex: 1, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', backgroundColor: C.panel },
  input:            { backgroundColor: C.panel, borderRadius: 10, padding: 14, fontSize: 16, color: C.txt, borderWidth: 1, borderColor: C.line },
  summary:          { marginHorizontal: 16, backgroundColor: C.panel2, borderRadius: 12, padding: 16, marginBottom: 14, borderWidth: 1, borderColor: C.line },
  summaryRow:       { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 5 },
  summaryTotal:     { borderTopWidth: 1, borderTopColor: C.line, marginTop: 8, paddingTop: 8 },
  summaryLabel:     { fontSize: 13, color: C.muted },
  summaryVal:       { fontSize: 13, color: C.muted },
  warningBox:       { marginHorizontal: 16, marginBottom: 14, backgroundColor: 'rgba(245,158,11,0.1)', borderRadius: 10, padding: 12, borderWidth: 1, borderColor: 'rgba(245,158,11,0.3)' },
  warningTxt:       { color: C.gold, fontSize: 12 },
  confirmBtn:       { marginHorizontal: 16, padding: 16, borderRadius: 12, alignItems: 'center' },
  confirmTxt:       { color: '#fff', fontSize: 16, fontWeight: '700' },
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
