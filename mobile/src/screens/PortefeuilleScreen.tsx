// ============================================================================
// screens/PortefeuilleScreen.tsx
// ============================================================================

import React, { useState, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, ScrollView,
  RefreshControl, ActivityIndicator, Modal, Linking, Share, Alert,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { ScreenHeader } from '../components/ScreenHeader';
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
import { apiClient } from '../api/client';
import { useAuth } from '../store/useAuth';
import { CONFIG } from '../../constants/config';
import type { MainTabParamList } from '../navigation/types';

const C = {
  bg:       '#f8fafc',
  panel:    '#ffffff',
  panel2:   '#f1f5f9',
  txt:      '#0f172a',
  muted:    '#64748b',
  line:     '#e2e8f0',
  up:       '#16a34a',
  down:     '#dc2626',
  accent:   '#7B1D3A',
  cardBg:   '#1A060E',
  cardTxt:  '#ffffff',
  cardMut:  'rgba(255,255,255,0.6)',
  gold:     '#f59e0b',
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

  const openAlimenter = useCallback(async () => {
    try {
      const r = await apiClient.get<{ actif: boolean; raison?: string }>('/api/sso/status-banque');
      if (!r.data.actif) {
        Alert.alert(
          'Compte banque suspendu',
          r.data.raison ?? 'Votre compte CFC Banque est suspendu. Contactez votre conseiller.',
        );
        return;
      }
    } catch { /* fail-open */ }

    const sub = user?.sub ?? '000000';
    const subHex = sub.replace(/-/g, '').substring(0, 6).padEnd(6, '0');
    const tsSufx = String(Date.now()).slice(-6);
    setDepotRef(`BRS${subHex}${tsSufx}`);
    setDepotStep('init');
    setShowAlimenter(true);
  }, [user]);


  const ouvrirBanque = useCallback(async () => {
    if (!compte?.iban || !depotRef) return;
    const retour = `bourseenligne://depot-confirm?ref=${encodeURIComponent(depotRef)}`;

    let ssoToken = '';
    try {
      const { data } = await apiClient.get<{ handoff_token: string }>('/api/sso/generate-handoff');
      ssoToken = data.handoff_token;
    } catch { /* fail-open */ }

    const deepLink =
      `cfcdigibank://alimenter-bourse` +
      `?ref=${encodeURIComponent(depotRef)}` +
      `&iban=${encodeURIComponent(compte.iban)}` +
      `&retour=${encodeURIComponent(retour)}` +
      (ssoToken ? `&sso_token=${encodeURIComponent(ssoToken)}` : '');

    const canOpen = await Linking.canOpenURL(deepLink).catch(() => false);
    if (canOpen) {
      void Linking.openURL(deepLink);
      setDepotStep('confirm');
    } else {
      Alert.alert(
        'Application CFC Banque introuvable',
        "L'application CFC Banque n'est pas installée.\n\nSouhaitez-vous continuer via le site web ?",
        [
          { text: 'Annuler', style: 'cancel' },
          {
            text: 'Continuer sur le web',
            onPress: () => {
              void Linking.openURL(
                `${CONFIG.BANQUE_DASHBOARD_URL}/dashboard.html` +
                `?action=alimenter-bourse` +
                `&ref=${encodeURIComponent(depotRef)}` +
                `&iban=${encodeURIComponent(compte.iban)}` +
                `&retour=${encodeURIComponent(retour)}`,
              );
              setDepotStep('confirm');
            },
          },
        ],
      );
    }
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
      Alert.alert('Erreur', e.response?.data?.detail ?? e.message ?? 'Erreur lors du dépôt');
    } finally {
      setDepotLoading(false);
    }
  }, [compte, load]);

  function livePrice(pos: ComptePosition): number {
    const ws =
      stocks.find(s => s.name === pos.instrument_code) ??
      stocks.find(s => s.name === pos.instrument_nom);
    return ws?.price ?? pos.cours_actuel ?? pos.prix_revient_moyen;
  }

  const totalValue = (compte?.positions ?? []).reduce(
    (acc, pos) => acc + pos.quantite * livePrice(pos), 0,
  );
  const totalCost = (compte?.positions ?? []).reduce(
    (acc, pos) => acc + pos.quantite * pos.prix_revient_moyen, 0,
  );
  const totalPl  = totalValue - totalCost;
  const plPct    = totalCost ? (totalPl / totalCost) * 100 : 0;
  const solde    = compte?.solde_especes ?? 0;
  const totalNet = solde + totalValue;

  // ─── Chargement / erreur ─────────────────────────────────────────────────

  if (loading && !compte) {
    return (
      <View style={[s.container, s.center]}>
        <ActivityIndicator size="large" color={C.accent} />
        <Text style={[s.mutedTxt, { marginTop: 12 }]}>Chargement…</Text>
      </View>
    );
  }

  if (error && !compte) {
    return (
      <View style={[s.container, s.center]}>
        <Text style={{ fontSize: 32, marginBottom: 12 }}>⚠️</Text>
        <Text style={s.mutedTxt}>{error}</Text>
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
          <Text style={s.modalTitle}>Alimenter le portefeuille</Text>

          <View style={s.modalSection}>
            <Text style={s.modalLabel}>IBAN de votre compte bourse</Text>
            <Text selectable style={s.modalCode}>{compte?.iban ?? '—'}</Text>
          </View>

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

          {depotStep === 'init' && (
            <TouchableOpacity style={s.modalBtnPrimary} onPress={ouvrirBanque}>
              <Text style={s.modalBtnPrimaryTxt}>Aller à la banque CFC</Text>
            </TouchableOpacity>
          )}

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

    <ScreenHeader title="Portefeuille" />

    <ScrollView
      style={s.container}
      contentContainerStyle={{ paddingBottom: 40 }}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={load} tintColor={C.accent} colors={[C.accent]} />
      }
    >
      {/* ── Bouton Alimenter ──────────────────────────────────────────────── */}
      <View style={s.pageHeader}>
        <TouchableOpacity style={s.headerBtn} onPress={openAlimenter}>
          <Text style={s.headerBtnTxt}>+ Alimenter</Text>
        </TouchableOpacity>
      </View>

      {/* ── Carte sombre principale ──────────────────────────────────────── */}
      <View style={s.darkCard}>
        {compte && (
          <View style={s.darkCardTopRow}>
            <Text style={s.compteLabel}>
              {TYPE_COMPTE_LABELS[compte.type] ?? 'COMPTE TITRES'} · {compte.numero}
            </Text>
            <View style={[
              s.statutBadge,
              { backgroundColor: compte.statut === 'actif' ? '#16a34a30' : '#78716c30' },
            ]}>
              <Text style={[
                s.statutTxt,
                { color: compte.statut === 'actif' ? '#4ade80' : '#a8a29e' },
              ]}>
                {compte.statut.toUpperCase()}
              </Text>
            </View>
          </View>
        )}

        <Text style={s.valorLabel}>Valorisation portefeuille</Text>
        <Text style={s.valorAmount}>{fmtN(totalNet, 2)} MAD</Text>
      </View>

      {/* ── 3 KPI tiles ──────────────────────────────────────────────────── */}
      <View style={s.kpiRow}>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>SOLDE DISPO.</Text>
          <Text style={s.kpiValue}>{fmtN(solde, 0)}</Text>
          <Text style={s.kpiUnit}>MAD</Text>
        </View>
        <View style={[s.kpi, s.kpiMid]}>
          <Text style={s.kpiLabel}>VALEUR PORTEF.</Text>
          <Text style={s.kpiValue}>{fmtN(totalValue, 0)}</Text>
          <Text style={s.kpiUnit}>MAD</Text>
        </View>
        <View style={s.kpi}>
          <Text style={s.kpiLabel}>PLUS-VALUE</Text>
          <Text style={[s.kpiValue, { color: totalPl >= 0 ? C.up : C.down }]}>
            {totalPl >= 0 ? '+' : ''}{fmtN(totalPl, 0)}
          </Text>
          <Text style={[s.kpiUnit, { color: totalPl >= 0 ? C.up : C.down, fontWeight: '600' }]}>
            {totalPl >= 0 ? '+' : ''}{fmtN(plPct)} %
          </Text>
        </View>
      </View>

      {/* ── Mes positions ─────────────────────────────────────────────────── */}
      <View style={s.section}>
        <View style={s.sectionHeaderRow}>
          <Text style={s.sectionTitle}>Mes positions</Text>
          <Text style={s.sectionCount}>
            {compte?.positions?.length ?? 0} ligne{(compte?.positions?.length ?? 0) !== 1 ? 's' : ''}
          </Text>
        </View>

        {(compte?.positions?.length ?? 0) === 0 ? (
          <View style={s.emptyBox}>
            <Text style={s.emptyTxt}>Aucune position ouverte.</Text>
            <TouchableOpacity onPress={() => navigation.navigate('Ordre', {})} style={s.emptyBtn}>
              <Text style={{ color: C.accent, fontWeight: '600' }}>Passer un premier ordre</Text>
            </TouchableOpacity>
          </View>
        ) : (
          compte!.positions.map(pos => {
            const live = livePrice(pos);
            const pl   = pos.quantite * live - pos.quantite * pos.prix_revient_moyen;
            const pp   = pos.prix_revient_moyen ? (pl / (pos.quantite * pos.prix_revient_moyen)) * 100 : 0;
            const delta = live - pos.prix_revient_moyen;
            return (
              <PositionCard
                key={pos.instrument_code}
                pos={pos}
                live={live}
                pl={pl}
                pp={pp}
                delta={delta}
              />
            );
          })
        )}
      </View>

      {/* ── Derniers mouvements ───────────────────────────────────────────── */}
      {mouvements.length > 0 && (
        <View style={s.section}>
          <View style={s.sectionHeaderRow}>
            <Text style={s.sectionTitle}>Derniers mouvements</Text>
          </View>
          {mouvements.map((mv, i) => (
            <MouvementRow key={i} mv={mv} />
          ))}
          <TouchableOpacity style={s.seeAll} onPress={() => navigation.navigate('Carnet')}>
            <Text style={{ color: C.accent, fontSize: 13 }}>Voir tous les ordres</Text>
          </TouchableOpacity>
        </View>
      )}
    </ScrollView>
    </>
  );
}

// ─── Carte position ──────────────────────────────────────────────────────────

function PositionCard({
  pos, live, pl, pp, delta,
}: {
  pos: ComptePosition;
  live: number;
  pl: number;
  pp: number;
  delta: number;
}) {
  const plColor = pl >= 0 ? C.up : C.down;
  return (
    <View style={s.posCard}>
      {/* Ligne 1 : ticker + nom | P&L */}
      <View style={s.posTopRow}>
        <View style={{ flex: 1 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
            <Text style={s.posTicker}>{pos.instrument_code}</Text>
            <Text style={s.posNom} numberOfLines={1}>{pos.instrument_nom || pos.instrument_code}</Text>
          </View>
          <Text style={s.posQty}>- {pos.quantite} titre{pos.quantite !== 1 ? 's' : ''}</Text>
        </View>
        <View style={{ alignItems: 'flex-end' }}>
          <Text style={[s.posPl, { color: plColor }]}>
            {pl >= 0 ? '+' : ''}{fmtN(pl, 2)} MAD
          </Text>
          <Text style={[s.posPct, { color: plColor }]}>
            {pp >= 0 ? '+' : ''}{fmtN(pp)} %
          </Text>
        </View>
      </View>

      {/* Séparateur */}
      <View style={s.posDivider} />

      {/* Ligne 2 : 3 colonnes */}
      <View style={s.posGrid}>
        <View style={s.posGridCell}>
          <Text style={s.posGridLabel}>Prix moy. pondéré</Text>
          <Text style={s.posGridVal}>{fmtN(pos.prix_revient_moyen)}</Text>
        </View>
        <View style={[s.posGridCell, s.posGridCellMid]}>
          <Text style={s.posGridLabel}>Cours actuel</Text>
          <Text style={s.posGridVal}>{fmtN(live)}</Text>
        </View>
        <View style={[s.posGridCell, { alignItems: 'flex-end' }]}>
          <Text style={s.posGridLabel}>Δ MAD</Text>
          <Text style={[s.posGridVal, { color: delta >= 0 ? C.up : C.down }]}>
            {delta >= 0 ? '+' : ''}{fmtN(delta)}
          </Text>
        </View>
      </View>
    </View>
  );
}

// ─── Ligne mouvement ──────────────────────────────────────────────────────────

function MouvementRow({ mv }: { mv: CompteMouvement }) {
  const label = MOUVEMENT_LABELS[mv.type] ?? mv.type;
  const sign  = mouvSign(mv.type);
  const color = mouvColor(mv.type);
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
  container: { flex: 1, backgroundColor: C.bg },
  center:    { justifyContent: 'center', alignItems: 'center' },
  mutedTxt:  { color: C.muted, fontSize: 14 },
  retryBtn:  { marginTop: 16, padding: 12, borderRadius: 8, borderWidth: 1, borderColor: C.accent },

  // Header titre + bouton
  pageHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 },
  pageTitle:    { fontSize: 22, fontWeight: '800', color: C.txt },
  headerBtn:    { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  headerBtnTxt: { color: '#fff', fontWeight: '700', fontSize: 13 },

  // Carte sombre principale
  darkCard:       { margin: 12, backgroundColor: C.cardBg, borderRadius: 16, padding: 20, gap: 4 },
  darkCardTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  compteLabel:    { fontSize: 12, color: C.cardMut, fontWeight: '500', letterSpacing: 0.3 },
  statutBadge:    { borderRadius: 20, paddingHorizontal: 10, paddingVertical: 3 },
  statutTxt:      { fontSize: 11, fontWeight: '700', letterSpacing: 0.5 },
  valorLabel:     { fontSize: 12, color: C.cardMut, marginBottom: 4 },
  valorAmount:    { fontSize: 26, fontWeight: '800', color: C.cardTxt, letterSpacing: -0.5 },
  ibanTxt:        { fontSize: 11, color: C.cardMut, fontFamily: 'monospace', marginTop: 10, letterSpacing: 0.5 },

  // KPI row
  kpiRow:   { flexDirection: 'row', marginHorizontal: 12, marginBottom: 8, backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  kpi:      { flex: 1, padding: 14, alignItems: 'flex-start' },
  kpiMid:   { borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.line },
  kpiLabel: { fontSize: 9, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5 },
  kpiValue: { fontSize: 16, fontWeight: '700', color: C.txt, marginTop: 4 },
  kpiUnit:  { fontSize: 11, color: C.muted, marginTop: 2 },

  // Section
  section:          { marginHorizontal: 12, marginBottom: 16 },
  sectionHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10, marginTop: 4 },
  sectionTitle:     { fontSize: 16, fontWeight: '700', color: C.txt },
  sectionCount:     { fontSize: 13, color: C.muted },

  emptyBox: { backgroundColor: C.panel, borderRadius: 12, padding: 24, alignItems: 'center', borderWidth: 1, borderColor: C.line },
  emptyTxt: { color: C.muted, marginBottom: 12, fontSize: 14 },
  emptyBtn: { padding: 8 },

  // Position card
  posCard:       { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, marginBottom: 10, overflow: 'hidden' },
  posTopRow:     { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', padding: 14 },
  posTicker:     { fontSize: 16, fontWeight: '800', color: C.txt },
  posNom:        { fontSize: 13, color: C.muted, flex: 1 },
  posQty:        { fontSize: 12, color: C.muted, marginTop: 4 },
  posPl:         { fontSize: 14, fontWeight: '700' },
  posPct:        { fontSize: 12, fontWeight: '600', marginTop: 2 },
  posDivider:    { height: 1, backgroundColor: C.line },
  posGrid:       { flexDirection: 'row', padding: 12 },
  posGridCell:   { flex: 1 },
  posGridCellMid:{ borderLeftWidth: 1, borderRightWidth: 1, borderColor: C.line, paddingHorizontal: 12 },
  posGridLabel:  { fontSize: 10, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.3 },
  posGridVal:    { fontSize: 14, fontWeight: '600', color: C.txt, marginTop: 3 },

  // Mouvement
  mvRow:     { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, borderRadius: 10, padding: 12, marginBottom: 6, borderWidth: 1, borderColor: C.line },
  mvLabel:   { fontSize: 13, fontWeight: '600', color: C.txt },
  mvDate:    { fontSize: 11, color: C.muted, marginTop: 2 },
  mvMontant: { fontSize: 14, fontWeight: '700' },

  seeAll: { padding: 8, alignItems: 'center' },

  // Modal Alimenter
  modalOverlay:       { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  modalBox:           { backgroundColor: C.panel, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderColor: C.line },
  modalTitle:         { fontSize: 17, fontWeight: '700', color: C.txt, marginBottom: 20 },
  modalSection:       { marginBottom: 16 },
  modalLabel:         { fontSize: 11, color: C.muted, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  modalCode:          { fontSize: 12, color: C.txt, fontFamily: 'monospace', backgroundColor: C.panel2, borderRadius: 6, padding: 10, borderWidth: 1, borderColor: C.line },
  modalHint:          { fontSize: 12, color: C.muted, marginBottom: 16, lineHeight: 18 },
  shareBtn:           { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: C.accent },
  modalBtnPrimary:    { backgroundColor: C.accent, borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 8 },
  modalBtnPrimaryTxt: { color: '#fff', fontWeight: '700', fontSize: 14 },
  modalBtnCancel:     { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
});
