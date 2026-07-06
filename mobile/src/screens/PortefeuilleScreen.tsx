// ============================================================================
// screens/PortefeuilleScreen.tsx — Portefeuille et compte titres (backend réel)
// ============================================================================

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, Modal, Linking, Share, Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useMarketData } from '../../hooks/useMarketData';
import {
  fetchPortfolio,
  depotDepuisBanque,
  ComptePortefeuille,
  CompteMouvement,
  ComptePosition,
  TYPE_COMPTE_LABELS,
  MOUVEMENT_LABELS,
} from '../api/portfolio';
import { useAuth } from '../store/useAuth';
import { CONFIG } from '../../constants/config';
import type { MainTabParamList } from '../navigation/types';

const C = {
  bg:     '#070b1c',
  panel:  '#111733',
  panel2: '#0e1430',
  txt:    '#e7ecff',
  muted:  '#8a93b8',
  line:   '#1f2a52',
  up:     '#22c55e',
  down:   '#ef4444',
  accent: '#60a5fa',
  gold:   '#f59e0b',
};

function fmtN(x: number | null | undefined, dp = 2) {
  if (x === null || x === undefined || isNaN(x as number)) return '—';
  return (x as number).toLocaleString('fr-FR', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function fmtDate(iso: string) {
  const d = new Date(iso);
  return (
    d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
    ' ' +
    d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
  );
}

function mouvSign(type: string) {
  if (type === 'execution_achat' || type === 'retrait') return -1;
  return 1;
}

function mouvColor(type: string) {
  if (type === 'execution_achat') return C.down;
  if (type === 'execution_vente') return C.up;
  if (type === 'depot')           return C.accent;
  return C.gold;
}

// ─── Composant principal ─────────────────────────────────────────────────────

export function PortefeuilleScreen() {
  const [compte, setCompte]   = useState<ComptePortefeuille | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);
  const { stocks } = useMarketData();
  const navigation  = useNavigation<BottomTabNavigationProp<MainTabParamList>>();
  const user        = useAuth(s => s.user);

  // ─── État modal Alimenter ──────────────────────────────────────────────────
  const [showAlimenter, setShowAlimenter] = useState(false);
  const [depotRef, setDepotRef]           = useState('');
  const [depotLoading, setDepotLoading]   = useState(false);
  const [depotStep, setDepotStep]         = useState<'init' | 'confirm'>('init');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchPortfolio();
      setCompte(data);
    } catch (e: any) {
      setError(e.message ?? 'Impossible de charger le portefeuille');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  const openAlimenter = useCallback(() => {
    const sub = user?.sub ?? '000000';
    const subHex = sub.replace(/-/g, '').substring(0, 6).padEnd(6, '0');
    const tsSufx = String(Date.now()).slice(-6);
    setDepotRef(`BRS${subHex}${tsSufx}`);
    setDepotStep('init');
    setShowAlimenter(true);
  }, [user]);

  const ouvrirBanque = useCallback(() => {
    if (!compte?.iban || !depotRef) return;
    const retourUrl = encodeURIComponent(`${CONFIG.API_BASE_URL}/?depot_ref=${depotRef}`);
    const url =
      `${CONFIG.BANQUE_DASHBOARD_URL}/dashboard.html` +
      `?action=alimenter-bourse` +
      `&ref=${encodeURIComponent(depotRef)}` +
      `&iban=${encodeURIComponent(compte.iban)}` +
      `&retour=${retourUrl}`;
    void Linking.openURL(url);
    setDepotStep('confirm');
  }, [compte, depotRef]);

  const confirmerDepot = useCallback(async () => {
    if (!compte?.iban) return;
    setDepotLoading(true);
    try {
      const res = await depotDepuisBanque(compte.iban);
      setShowAlimenter(false);
      await load();
      Alert.alert(
        'Dépôt crédité ✓',
        `${res.montant_credite.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${res.devise} crédités.\nNouveau solde : ${res.nouveau_solde.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${res.devise}`,
      );
    } catch (e: any) {
      const msg = e.response?.data?.detail ?? e.message ?? 'Erreur lors du dépôt';
      Alert.alert('Erreur', msg);
    } finally {
      setDepotLoading(false);
    }
  }, [compte, load]);

  // Prix live depuis WebSocket, fallback sur cours_actuel du backend
  function livePrice(pos: ComptePosition): number {
    const ws =
      stocks.find(s => s.name === pos.instrument_code) ??
      stocks.find(s => s.name === pos.instrument_nom);
    return ws?.price ?? pos.cours_actuel ?? pos.prix_revient_moyen;
  }

  // Calcul P&L total avec prix temps-réel
  const totalValue = (compte?.positions ?? []).reduce(
    (acc, pos) => acc + pos.quantite * livePrice(pos),
    0,
  );
  const totalCost = (compte?.positions ?? []).reduce(
    (acc, pos) => acc + pos.quantite * pos.prix_revient_moyen,
    0,
  );
  const totalPl  = totalValue - totalCost;
  const plPct    = totalCost ? (totalPl / totalCost) * 100 : 0;
  const solde    = compte?.solde_especes ?? 0;
  const totalNet = solde + totalValue;

  // ─── États de chargement / erreur ────────────────────────────────────────

  if (loading && !compte) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={[s.muted, { marginTop: 12 }]}>Chargement du portefeuille…</Text>
      </View>
    );
  }

  if (error && !compte) {
    return (
      <View style={[s.container, s.center]}>
        <Text style={{ fontSize: 32, marginBottom: 12 }}>⚠️</Text>
        <Text style={s.muted}>{error}</Text>
        <TouchableOpacity style={s.retryBtn} onPress={load}>
          <Text style={{ color: C.accent }}>Réessayer</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const mouvements = (compte?.mouvements ?? []).slice(0, 10);

  return (
    <>
    {/* ── Modal Alimenter ─────────────────────────────────────────────────── */}
    <Modal
      visible={showAlimenter}
      animationType="slide"
      transparent
      onRequestClose={() => setShowAlimenter(false)}
    >
      <View style={s.modalOverlay}>
        <View style={s.modalBox}>
          <Text style={s.modalTitle}>💰 Alimenter le portefeuille</Text>

          {/* IBAN bourse */}
          <View style={s.modalSection}>
            <Text style={s.modalLabel}>IBAN de votre compte bourse</Text>
            <Text selectable style={s.modalCode}>{compte?.iban ?? '—'}</Text>
          </View>

          {/* Référence virement */}
          <View style={s.modalSection}>
            <Text style={s.modalLabel}>Référence à indiquer dans le virement</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text selectable style={[s.modalCode, { flex: 1 }]}>{depotRef}</Text>
              <TouchableOpacity
                style={s.shareBtn}
                onPress={() => void Share.share({ message: `Référence virement bourse : ${depotRef}\nIBAN : ${compte?.iban ?? ''}` })}
              >
                <Text style={{ color: C.accent, fontSize: 12 }}>Partager</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={s.modalHint}>
            Conservez cette référence — elle identifie votre dépôt auprès de la banque.
          </Text>

          {/* Étape 1 : Ouvrir la banque */}
          {depotStep === 'init' && (
            <TouchableOpacity style={s.modalBtnPrimary} onPress={ouvrirBanque}>
              <Text style={s.modalBtnPrimaryTxt}>Aller à la banque CFC →</Text>
            </TouchableOpacity>
          )}

          {/* Étape 2 : Confirmer le dépôt */}
          {depotStep === 'confirm' && (
            <>
              <Text style={[s.modalHint, { color: C.gold, marginTop: 4 }]}>
                Après avoir validé le virement, confirmez ici pour créditer votre compte.
              </Text>
              <TouchableOpacity
                style={s.modalBtnPrimary}
                onPress={() => void confirmerDepot()}
                disabled={depotLoading}
              >
                {depotLoading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.modalBtnPrimaryTxt}>✓ Confirmer le dépôt</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: 8 }} onPress={ouvrirBanque}>
                <Text style={{ color: C.accent, textAlign: 'center', fontSize: 13 }}>
                  Rouvrir la banque CFC
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={s.modalBtnCancel} onPress={() => setShowAlimenter(false)}>
            <Text style={{ color: C.muted, fontSize: 13 }}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>

    <ScrollView
      style={s.container}
      contentContainerStyle={{ paddingTop: 12, paddingBottom: 40 }}
      refreshControl={
        <RefreshControl
          refreshing={loading}
          onRefresh={load}
          tintColor={C.accent}
          colors={[C.accent]}
        />
      }
    >
      {/* ── En-tête du compte titres ──────────────────────────────────────── */}
      {compte && (
        <View style={s.compteHeader}>
          <View style={s.compteHeaderTop}>
            <View>
              <Text style={s.compteNum}>{compte.numero}</Text>
              <Text style={s.compteType}>
                {TYPE_COMPTE_LABELS[compte.type] ?? compte.type}
              </Text>
            </View>
            <View style={[
              s.statutBadge,
              { backgroundColor: compte.statut === 'actif' ? '#16a34a20' : '#78716c20',
                borderColor:      compte.statut === 'actif' ? '#16a34a50' : '#78716c50' },
            ]}>
              <Text style={[
                s.statutTxt,
                { color: compte.statut === 'actif' ? C.up : C.muted },
              ]}>
                ● {compte.statut}
              </Text>
            </View>
          </View>
          <Text style={s.ibanTxt} numberOfLines={1} ellipsizeMode="middle">
            IBAN : {compte.iban}
          </Text>
          <TouchableOpacity style={s.alimenterBtn} onPress={openAlimenter}>
            <Text style={s.alimenterBtnTxt}>💰 Alimenter depuis la banque CFC</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── KPI tiles ─────────────────────────────────────────────────────── */}
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>Espèces</Text>
          <Text style={s.kpiValue} numberOfLines={1}>{fmtN(solde, 0)}</Text>
          <Text style={s.kpiUnit}>MAD</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>Titres</Text>
          <Text style={s.kpiValue} numberOfLines={1}>{fmtN(totalValue, 0)}</Text>
          <Text style={s.kpiUnit}>MAD</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>Total</Text>
          <Text style={s.kpiValue} numberOfLines={1}>{fmtN(totalNet, 0)}</Text>
          <Text style={s.kpiUnit}>MAD</Text>
        </View>
      </View>

      {/* ── P&L global ────────────────────────────────────────────────────── */}
      {(compte?.positions?.length ?? 0) > 0 && (
        <View style={s.plBar}>
          <Text style={s.plBarLabel}>Plus/Moins-value latente</Text>
          <Text style={[s.plBarValue, { color: totalPl >= 0 ? C.up : C.down }]}>
            {totalPl >= 0 ? '+' : ''}{fmtN(totalPl, 0)} MAD
            {'  '}
            <Text style={[s.plBarPct, { color: totalPl >= 0 ? C.up : C.down }]}>
              ({fmtN(plPct)}%)
            </Text>
          </Text>
        </View>
      )}

      {/* ── Positions ouvertes ────────────────────────────────────────────── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Mes positions</Text>

        {(compte?.positions?.length ?? 0) === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTxt}>Aucune position ouverte.</Text>
            <TouchableOpacity
              onPress={() => navigation.navigate('Ordre', {})}
              style={s.emptyBtn}
            >
              <Text style={{ color: C.accent, fontWeight: '600' }}>
                Passer un premier ordre →
              </Text>
            </TouchableOpacity>
          </View>
        ) : (
          compte!.positions.map(pos => {
            const live = livePrice(pos);
            const val  = pos.quantite * live;
            const cost = pos.quantite * pos.prix_revient_moyen;
            const pl   = val - cost;
            const pp   = cost ? (pl / cost) * 100 : 0;
            return (
              <PositionCard
                key={pos.instrument_code}
                pos={pos}
                live={live}
                val={val}
                pl={pl}
                pp={pp}
                onBuy={() =>
                  navigation.navigate('Ordre', {
                    stock: pos.instrument_code,
                    direction: 'achat',
                  })
                }
                onSell={() =>
                  navigation.navigate('Ordre', {
                    stock: pos.instrument_code,
                    direction: 'vente',
                  })
                }
              />
            );
          })
        )}
      </View>

      {/* ── Derniers mouvements ───────────────────────────────────────────── */}
      {mouvements.length > 0 && (
        <View style={s.section}>
          <Text style={s.sectionTitle}>Derniers mouvements</Text>
          {mouvements.map((mv, i) => (
            <MouvementRow key={i} mv={mv} />
          ))}
          <TouchableOpacity style={s.seeAll} onPress={() => navigation.navigate('Carnet')}>
            <Text style={{ color: C.accent, fontSize: 13 }}>Voir tous les ordres →</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
    </>
  );
}

// ─── Sous-composants ─────────────────────────────────────────────────────────

function PositionCard({
  pos, live, val, pl, pp, onBuy, onSell,
}: {
  pos: ComptePosition;
  live: number;
  val: number;
  pl: number;
  pp: number;
  onBuy: () => void;
  onSell: () => void;
}) {
  return (
    <View style={s.posCard}>
      <View style={s.posHeader}>
        <View style={{ flex: 1 }}>
          <Text style={s.posName}>{pos.instrument_nom || pos.instrument_code}</Text>
          <Text style={s.posCode}>{pos.instrument_code}</Text>
        </View>
        <Text style={[s.posPl, { color: pl >= 0 ? C.up : C.down }]}>
          {pl >= 0 ? '+' : ''}{fmtN(pl, 0)}{'\n'}
          <Text style={{ fontSize: 11 }}>({fmtN(pp)}%)</Text>
        </Text>
      </View>
      <View style={s.posGrid}>
        {[
          ['Quantité',     `${pos.quantite} titres`],
          ['Prix moyen',   `${fmtN(pos.prix_revient_moyen)} MAD`],
          ['Cours actuel', `${fmtN(live)} MAD`],
          ['Valorisation', `${fmtN(val, 0)} MAD`],
        ].map(([lbl, v]) => (
          <View key={lbl} style={s.posCell}>
            <Text style={s.posCellLabel}>{lbl}</Text>
            <Text style={s.posCellVal}>{v}</Text>
          </View>
        ))}
      </View>
      <View style={s.posActions}>
        <TouchableOpacity style={[s.posBtn, { borderColor: C.up }]} onPress={onBuy}>
          <Text style={{ color: C.up, fontSize: 12, fontWeight: '600' }}>📈 Acheter</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[s.posBtn, { borderColor: C.down }]} onPress={onSell}>
          <Text style={{ color: C.down, fontSize: 12, fontWeight: '600' }}>📉 Vendre</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function MouvementRow({ mv }: { mv: CompteMouvement }) {
  const label  = MOUVEMENT_LABELS[mv.type] ?? mv.type;
  const sign   = mouvSign(mv.type);
  const color  = mouvColor(mv.type);
  return (
    <View style={s.mvRow}>
      <View style={{ flex: 1 }}>
        <Text style={s.mvLabel}>{label}{mv.instrument ? ` · ${mv.instrument}` : ''}</Text>
        <Text style={s.mvDate}>{fmtDate(mv.date)}</Text>
      </View>
      <Text style={[s.mvMontant, { color }]}>
        {sign > 0 ? '+' : '-'}{fmtN(Math.abs(mv.montant), 0)} MAD
      </Text>
    </View>
  );
}

// ─── Styles ──────────────────────────────────────────────────────────────────

const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bg },
  center:       { justifyContent: 'center', alignItems: 'center' },
  muted:        { color: C.muted, fontSize: 14 },
  retryBtn:     { marginTop: 16, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: C.accent },

  compteHeader:    { margin: 12, marginBottom: 4, backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, padding: 14 },
  compteHeaderTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  compteNum:       { fontSize: 15, fontWeight: '700', color: C.txt, letterSpacing: 0.5 },
  compteType:      { fontSize: 11, color: C.muted, marginTop: 2 },
  statutBadge:     { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  statutTxt:       { fontSize: 11, fontWeight: '600' },
  ibanTxt:         { fontSize: 10, color: C.muted, fontFamily: 'monospace' },

  kpiRow:     { flexDirection: 'row', gap: 8, padding: 12, paddingTop: 10 },
  kpi:        { flex: 1, backgroundColor: C.panel, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: C.line, alignItems: 'center' },
  kpiLabel:   { fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, textAlign: 'center' },
  kpiValue:   { fontSize: 15, fontWeight: '700', color: C.txt, marginTop: 4 },
  kpiUnit:    { fontSize: 10, color: C.muted, marginTop: 2 },

  plBar:       { marginHorizontal: 12, marginBottom: 8, backgroundColor: C.panel2, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: C.line, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  plBarLabel:  { fontSize: 11, color: C.muted },
  plBarValue:  { fontSize: 14, fontWeight: '700' },
  plBarPct:    { fontSize: 12, fontWeight: '600' },

  section:      { marginHorizontal: 12, marginBottom: 16 },
  sectionTitle: { fontSize: 11, fontWeight: '700', color: C.muted, textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 10 },

  emptyBox:  { backgroundColor: C.panel, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  emptyTxt:  { color: C.muted, marginBottom: 12, fontSize: 14 },
  emptyBtn:  { padding: 8 },

  posCard:      { backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.line, marginBottom: 10, overflow: 'hidden' },
  posHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14, borderBottomWidth: 1, borderBottomColor: C.line },
  posName:      { fontSize: 14, fontWeight: '700', color: C.txt },
  posCode:      { fontSize: 10, color: C.muted, marginTop: 2 },
  posPl:        { fontSize: 13, fontWeight: '700', textAlign: 'right' },
  posGrid:      { flexDirection: 'row', flexWrap: 'wrap', padding: 10, gap: 8 },
  posCell:      { width: '47%', backgroundColor: C.panel2, borderRadius: 8, padding: 10 },
  posCellLabel: { fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  posCellVal:   { fontSize: 13, color: C.txt, marginTop: 3, fontWeight: '500' },
  posActions:   { flexDirection: 'row', gap: 8, padding: 12, paddingTop: 4 },
  posBtn:       { flex: 1, borderWidth: 1, borderRadius: 8, paddingVertical: 8, alignItems: 'center' },

  mvRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line },
  mvLabel:   { fontSize: 13, fontWeight: '600', color: C.txt },
  mvDate:    { fontSize: 11, color: C.muted, marginTop: 2 },
  mvMontant: { fontSize: 14, fontWeight: '700' },

  seeAll: { padding: 8, alignItems: 'center' },

  alimenterBtn:    { marginTop: 10, backgroundColor: 'rgba(96,165,250,0.12)', borderRadius: 8, borderWidth: 1, borderColor: C.accent, paddingVertical: 8, alignItems: 'center' },
  alimenterBtnTxt: { color: C.accent, fontSize: 13, fontWeight: '600' },

  // ── Modal Alimenter ──────────────────────────────────────────────────────
  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modalBox:           { backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderColor: C.line },
  modalTitle:         { fontSize: 17, fontWeight: '700', color: C.txt, marginBottom: 20 },
  modalSection:       { marginBottom: 16 },
  modalLabel:         { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  modalCode:          { fontSize: 12, color: C.txt, fontFamily: 'monospace', backgroundColor: C.panel2, borderRadius: 6, padding: 10, borderWidth: 1, borderColor: C.line },
  modalHint:          { fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 18 },
  shareBtn:           { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: C.accent },
  modalBtnPrimary:    { backgroundColor: C.up, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 8 },
  modalBtnPrimaryTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  modalBtnCancel:     { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
});
