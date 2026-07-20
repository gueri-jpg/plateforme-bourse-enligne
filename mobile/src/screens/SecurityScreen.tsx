import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal,
  ScrollView, Alert, Switch,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useAuth }   from '../store/useAuth';
import { usePin }    from '../store/usePin';
import { decodeJwt } from '../api/auth';

const C = {
  bg: '#f8fafc', panel: '#ffffff',
  txt: '#0f172a', muted: '#64748b', line: '#e2e8f0',
  accent: '#7B1D3A', danger: '#dc2626',
};

// ── Indicateur 4 points ─────────────────────────────────────────────────────
function PinDots({ count }: { count: number }) {
  return (
    <View style={{ flexDirection: 'row', gap: 20, justifyContent: 'center', marginVertical: 28 }}>
      {[0, 1, 2, 3].map(i => (
        <View
          key={i}
          style={{
            width: 18, height: 18, borderRadius: 9,
            backgroundColor: i < count ? C.accent : C.line,
            borderWidth: 1.5, borderColor: i < count ? C.accent : '#cbd5e1',
          }}
        />
      ))}
    </View>
  );
}

// ── Clavier numérique ────────────────────────────────────────────────────────
const KEYS = ['1','2','3','4','5','6','7','8','9','','0','⌫'] as const;

function NumPad({ onKey }: { onKey: (k: string) => void }) {
  return (
    <View style={np.grid}>
      {KEYS.map((k, i) => (
        <TouchableOpacity
          key={i}
          style={[np.key, !k && np.keyHidden]}
          onPress={() => k && onKey(k)}
          disabled={!k}
          activeOpacity={0.65}
        >
          <Text style={np.keyTxt}>{k}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

// ── Modal saisie PIN ─────────────────────────────────────────────────────────
type ModalMode = 'enable' | 'disable' | 'change';
type ModalStep = 'verify' | 'new' | 'confirm';

function PinModal({
  visible, mode, onClose, onSuccess,
}: {
  visible:   boolean;
  mode:      ModalMode;
  onClose:   () => void;
  onSuccess: () => void;
}) {
  const { verify, setPin, removePin } = usePin();
  const [step,    setStep]    = useState<ModalStep>('new');
  const [entered, setEntered] = useState('');
  const [error,   setError]   = useState('');
  const firstPin = useRef('');

  useEffect(() => {
    if (!visible) return;
    setStep(mode === 'enable' ? 'new' : 'verify');
    setEntered('');
    setError('');
    firstPin.current = '';
  }, [visible, mode]);

  const stepTitle: Record<ModalStep, string> = {
    verify:  'Code PIN actuel',
    new:     mode === 'change' ? 'Nouveau code PIN' : 'Créez votre code PIN',
    confirm: 'Confirmez le code PIN',
  };

  const handleKey = async (k: string) => {
    if (k === '⌫') { setEntered(p => p.slice(0, -1)); setError(''); return; }
    const next = entered + k;
    if (next.length > 4) return;
    setEntered(next);
    if (next.length < 4) return;

    // 4 chiffres saisis → traitement après animation (150ms)
    setTimeout(async () => {
      if (step === 'verify') {
        const ok = await verify(next);
        if (!ok) { setEntered(''); setError('Code incorrect. Réessayez.'); return; }
        if (mode === 'disable') { await removePin(); onSuccess(); onClose(); return; }
        setStep('new'); setEntered(''); setError('');
      } else if (step === 'new') {
        firstPin.current = next;
        setStep('confirm'); setEntered(''); setError('');
      } else if (step === 'confirm') {
        if (next !== firstPin.current) {
          setEntered(''); setError('Les codes ne correspondent pas.'); setStep('new'); return;
        }
        await setPin(next);
        onSuccess();
        onClose();
      }
    }, 150);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={pm.overlay}>
        <View style={pm.card}>
          <Text style={pm.title}>{stepTitle[step]}</Text>
          <PinDots count={entered.length} />
          {!!error && <Text style={pm.error}>{error}</Text>}
          <NumPad onKey={handleKey} />
          <TouchableOpacity style={pm.cancelBtn} onPress={onClose}>
            <Text style={pm.cancelTxt}>Annuler</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ── Écran Sécurité ───────────────────────────────────────────────────────────
export function SecurityScreen() {
  const navigation       = useNavigation();
  const { accessToken }  = useAuth();
  const { enabled }      = usePin();

  const [modalVisible, setModalVisible] = useState(false);
  const [modalMode,    setModalMode]    = useState<ModalMode>('enable');

  const claims    = accessToken ? decodeJwt(accessToken) : null;
  const lastLogin = claims?.iat
    ? new Date((claims.iat as number) * 1000).toLocaleString('fr-FR', {
        day: '2-digit', month: 'long', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '—';

  const openChangePassword = () => {
    // Navigue vers le flux de récupération de mot de passe déjà dans l'app
    (navigation as any).getParent()?.navigate('ForgotPassword');
  };

  const onModalSuccess = () => {
    const messages: Record<ModalMode, [string, string]> = {
      enable:  ['Code PIN activé ✓',     'Votre application est maintenant protégée par un code PIN.'],
      disable: ['Code PIN désactivé',     "L'application n'est plus protégée par un code PIN."],
      change:  ['Code PIN modifié ✓',    'Votre nouveau code PIN a bien été enregistré.'],
    };
    Alert.alert(...messages[modalMode]);
  };

  return (
    <ScrollView style={s.container} contentContainerStyle={{ paddingBottom: 48 }}>

      {/* ── Code PIN ── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Code PIN</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Activer le code PIN</Text>
              <Text style={s.rowSub}>Verrouille l'app à chaque retour en avant-plan</Text>
            </View>
            <Switch
              value={enabled}
              onValueChange={(v) => {
                setModalMode(v ? 'enable' : 'disable');
                setModalVisible(true);
              }}
              trackColor={{ false: '#e2e8f0', true: C.accent }}
              thumbColor="#ffffff"
            />
          </View>
          {enabled && (
            <>
              <View style={s.divider} />
              <TouchableOpacity
                style={s.row}
                onPress={() => { setModalMode('change'); setModalVisible(true); }}
                activeOpacity={0.7}
              >
                <Text style={[s.rowLabel, { color: C.accent }]}>Changer le code PIN</Text>
                <Text style={s.chevron}>›</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {/* ── Mot de passe ── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Mot de passe</Text>
        <View style={s.card}>
          <TouchableOpacity style={s.row} onPress={openChangePassword} activeOpacity={0.7}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Changer le mot de passe</Text>
              <Text style={s.rowSub}>Redirige vers la gestion de compte Keycloak</Text>
            </View>
            <Text style={s.chevron}>›</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Activité ── */}
      <View style={s.section}>
        <Text style={s.sectionTitle}>Activité</Text>
        <View style={s.card}>
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowLabel}>Dernière connexion</Text>
              <Text style={[s.rowSub, { marginTop: 4, fontSize: 13 }]}>{lastLogin}</Text>
            </View>
          </View>
        </View>
      </View>

      <PinModal
        visible={modalVisible}
        mode={modalMode}
        onClose={() => setModalVisible(false)}
        onSuccess={onModalSuccess}
      />
    </ScrollView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  container:    { flex: 1, backgroundColor: C.bg },
  section:      { marginHorizontal: 16, marginTop: 24 },
  sectionTitle: { fontSize: 11, fontWeight: '600', color: C.muted, letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 8, marginLeft: 4 },
  card:         { backgroundColor: C.panel, borderRadius: 14, borderWidth: 1, borderColor: C.line, overflow: 'hidden' },
  row:          { flexDirection: 'row', alignItems: 'center', padding: 16, minHeight: 60 },
  rowLabel:     { fontSize: 15, color: C.txt, fontWeight: '500', marginBottom: 2 },
  rowSub:       { fontSize: 12, color: C.muted },
  divider:      { height: 1, backgroundColor: C.line },
  chevron:      { fontSize: 22, color: '#cbd5e1', marginLeft: 8 },
});

const pm = StyleSheet.create({
  overlay:   { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'flex-end' },
  card:      { backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 28, paddingBottom: 48, paddingHorizontal: 24 },
  title:     { fontSize: 18, fontWeight: '700', color: C.txt, textAlign: 'center' },
  error:     { fontSize: 13, color: C.danger, textAlign: 'center', marginBottom: 4 },
  cancelBtn: { marginTop: 20, alignItems: 'center', paddingVertical: 8 },
  cancelTxt: { fontSize: 14, color: C.muted },
});

const np = StyleSheet.create({
  grid:      { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
  key:       { width: '28%', aspectRatio: 1.5, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f8fafc', borderRadius: 14, borderWidth: 1, borderColor: '#e2e8f0' },
  keyHidden: { backgroundColor: 'transparent', borderColor: 'transparent' },
  keyTxt:    { fontSize: 24, fontWeight: '500', color: '#0f172a' },
});
