import React, { useState, useCallback, useEffect } from 'react';
import {
  View, Text, Modal, TouchableOpacity, StyleSheet,
  ActivityIndicator, Share, Linking, Alert,
} from 'react-native';
import { apiClient } from '../api/client';
import { depotDepuisBanque, DepotResult } from '../api/portfolio';
import { CONFIG } from '../../constants/config';
import { useAuth } from '../store/useAuth';
import { useNotifications } from '../store/useNotifications';

interface Props {
  visible:   boolean;
  iban:      string | null | undefined;
  onClose:   () => void;
  onSuccess: (result: DepotResult) => void;
}

export function AlimenterModal({ visible, iban, onClose, onSuccess }: Props) {
  const user = useAuth(s => s.user);
  const [depotRef,  setDepotRef] = useState('');
  const [loading,   setLoading]  = useState(false);
  const [step,      setStep]     = useState<'init' | 'confirm'>('init');

  // Générer une nouvelle référence à chaque ouverture
  useEffect(() => {
    if (!visible) return;
    const sub    = user?.sub ?? '000000';
    const subHex = sub.replace(/-/g, '').substring(0, 6).padEnd(6, '0');
    const tsSufx = String(Date.now()).slice(-6);
    setDepotRef(`BRS${subHex}${tsSufx}`);
    setStep('init');
  }, [visible]);

  const ouvrirBanque = useCallback(async () => {
    if (!iban || !depotRef) return;
    const retour = `bourseenligne://depot-confirm?ref=${encodeURIComponent(depotRef)}`;

    let ssoToken = '';
    try {
      const { data } = await apiClient.get<{ handoff_token: string }>('/api/sso/generate-handoff');
      ssoToken = data.handoff_token;
    } catch {}

    const deepLink =
      `cfcdigibank://alimenter-bourse` +
      `?ref=${encodeURIComponent(depotRef)}` +
      `&iban=${encodeURIComponent(iban)}` +
      `&retour=${encodeURIComponent(retour)}` +
      (ssoToken ? `&sso_token=${encodeURIComponent(ssoToken)}` : '');

    const canOpen = await Linking.canOpenURL(deepLink).catch(() => false);
    if (canOpen) {
      void Linking.openURL(deepLink);
      setStep('confirm');
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
                `&iban=${encodeURIComponent(iban)}` +
                `&retour=${encodeURIComponent(retour)}`,
              );
              setStep('confirm');
            },
          },
        ],
      );
    }
  }, [iban, depotRef]);

  const confirmerDepot = useCallback(async () => {
    if (!iban) return;
    setLoading(true);
    try {
      const res = await depotDepuisBanque(iban);
      useNotifications.getState().add({
        type:  'alimentation',
        title: 'Compte alimenté ✓',
        body:  `${res.montant_credite.toLocaleString('fr-FR', { minimumFractionDigits: 2 })} ${res.devise} crédités sur votre compte bourse.`,
      });
      onClose();
      onSuccess(res);
    } catch (e: any) {
      Alert.alert('Erreur', e.response?.data?.detail ?? e.message ?? 'Erreur lors du dépôt');
    } finally {
      setLoading(false);
    }
  }, [iban, onClose, onSuccess]);

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={s.overlay}>
        <View style={s.box}>
          <Text style={s.title}>💰 Alimenter le portefeuille</Text>

          <View style={s.section}>
            <Text style={s.label}>IBAN de votre compte bourse</Text>
            <Text selectable style={s.code}>{iban ?? '—'}</Text>
          </View>

          <View style={s.section}>
            <Text style={s.label}>Référence à indiquer dans le virement</Text>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Text selectable style={[s.code, { flex: 1 }]}>{depotRef}</Text>
              <TouchableOpacity
                style={s.shareBtn}
                onPress={() => void Share.share({
                  message: `Référence virement bourse : ${depotRef}\nIBAN : ${iban ?? ''}`,
                })}
              >
                <Text style={{ color: BORD, fontSize: 12 }}>Partager</Text>
              </TouchableOpacity>
            </View>
          </View>

          <Text style={s.hint}>
            Conservez cette référence — elle identifie votre dépôt auprès de la banque.
          </Text>

          {step === 'init' && (
            <TouchableOpacity style={s.btnPrimary} onPress={ouvrirBanque}>
              <Text style={s.btnPrimaryTxt}>Aller à la banque CFC</Text>
            </TouchableOpacity>
          )}

          {step === 'confirm' && (
            <>
              <Text style={[s.hint, { color: '#f59e0b', marginTop: 4 }]}>
                Après avoir validé le virement, confirmez ici pour créditer votre compte.
              </Text>
              <TouchableOpacity
                style={s.btnPrimary}
                onPress={() => void confirmerDepot()}
                disabled={loading}
              >
                {loading
                  ? <ActivityIndicator color="#fff" />
                  : <Text style={s.btnPrimaryTxt}>✓ Confirmer le dépôt</Text>}
              </TouchableOpacity>
              <TouchableOpacity style={{ marginTop: 8 }} onPress={ouvrirBanque}>
                <Text style={{ color: BORD, textAlign: 'center', fontSize: 13 }}>
                  Rouvrir la banque CFC
                </Text>
              </TouchableOpacity>
            </>
          )}

          <TouchableOpacity style={s.btnCancel} onPress={onClose}>
            <Text style={{ color: '#64748b', fontSize: 13 }}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Vérifier si le compte banque est actif avant d'ouvrir le modal ───────────
export async function checkBanqueActive(): Promise<boolean> {
  try {
    const r = await apiClient.get<{ actif: boolean; raison?: string }>('/api/sso/status-banque');
    if (!r.data.actif) {
      Alert.alert(
        'Compte banque suspendu',
        r.data.raison ?? 'Votre compte CFC Banque est suspendu. Contactez votre conseiller.',
      );
      return false;
    }
    return true;
  } catch {
    return true; // fail-open si backend injoignable
  }
}

const BORD = '#7B1D3A';

const s = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  box:          { backgroundColor: '#ffffff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, borderTopWidth: 1, borderColor: '#e2e8f0' },
  title:        { fontSize: 17, fontWeight: '700', color: '#0f172a', marginBottom: 20 },
  section:      { marginBottom: 16 },
  label:        { fontSize: 11, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 },
  code:         { fontSize: 12, color: '#0f172a', fontFamily: 'monospace', backgroundColor: '#f1f5f9', borderRadius: 6, padding: 10, borderWidth: 1, borderColor: '#e2e8f0' },
  hint:         { fontSize: 12, color: '#64748b', marginBottom: 16, lineHeight: 18 },
  shareBtn:     { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, borderWidth: 1, borderColor: BORD },
  btnPrimary:   { backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 13, alignItems: 'center', marginBottom: 8 },
  btnPrimaryTxt:{ color: '#fff', fontWeight: '700', fontSize: 14 },
  btnCancel:    { paddingVertical: 10, alignItems: 'center', marginTop: 4 },
});
