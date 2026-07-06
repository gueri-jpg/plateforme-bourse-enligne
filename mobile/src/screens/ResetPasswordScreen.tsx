import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { resetPassword } from '../api/auth';

const C = {
  bg:     '#070b1c',
  panel:  '#111733',
  txt:    '#e7ecff',
  muted:  '#8a93b8',
  line:   '#1f2a52',
  accent: '#60a5fa',
  gold:   '#f59e0b',
  error:  '#f87171',
  ok:     '#34d399',
};

type Props = NativeStackScreenProps<RootStackParamList, 'ResetPassword'>;

function getStrength(pwd: string): { score: number; label: string; color: string } {
  if (pwd.length === 0) return { score: 0, label: '',          color: C.line  };
  if (pwd.length < 6)   return { score: 1, label: 'Trop court', color: C.error };
  let score = 1;
  if (pwd.length >= 8)                          score++;
  if (/[A-Z]/.test(pwd))                        score++;
  if (/[0-9]/.test(pwd))                        score++;
  if (/[^a-zA-Z0-9]/.test(pwd))                score++;
  const labels  = ['', 'Faible', 'Faible', 'Moyen', 'Fort', 'Très fort'];
  const colors  = [C.line, C.error, C.error, '#f59e0b', '#60a5fa', C.ok];
  return { score, label: labels[score], color: colors[score] };
}

export function ResetPasswordScreen({ navigation, route }: Props) {
  const { resetToken } = route.params;

  const [password,   setPassword]   = useState('');
  const [confirm,    setConfirm]    = useState('');
  const [showPwd,    setShowPwd]    = useState(false);
  const [loading,    setLoading]    = useState(false);
  const [success,    setSuccess]    = useState(false);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => navigation.navigate('Login'), 2000);
    return () => clearTimeout(t);
  }, [success, navigation]);

  const strength    = getStrength(password);
  const mismatch    = confirm.length > 0 && confirm !== password;
  const canSubmit   = password.length >= 8 && confirm === password && strength.score >= 2;

  async function handleReset() {
    if (!canSubmit) return;
    setLoading(true);
    try {
      await resetPassword(resetToken, password, confirm);
      setSuccess(true);
    } catch (err: any) {
      Alert.alert('Erreur', err.message ?? 'Une erreur est survenue. Réessayez.');
    } finally {
      setLoading(false);
    }
  }

  // ── Écran de succès avec redirection automatique ─────────────────────────────
  if (success) {
    return (
      <View style={s.successWrap}>
        <Text style={s.successIcon}>✅</Text>
        <Text style={s.successTitle}>Mot de passe modifié !</Text>
        <Text style={s.successSub}>
          Votre mot de passe a été réinitialisé avec succès.{'\n'}
          Redirection vers la connexion…
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={s.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={s.container}
        keyboardShouldPersistTaps="handled"
      >
        <View style={s.iconWrap}>
          <Text style={s.icon}>🔒</Text>
        </View>

        <Text style={s.title}>Nouveau mot de passe</Text>
        <Text style={s.subtitle}>
          Choisissez un mot de passe sécurisé d'au moins 8 caractères.
        </Text>

        {/* Champ mot de passe */}
        <View style={s.fieldWrap}>
          <Text style={s.label}>Nouveau mot de passe</Text>
          <View style={s.inputRow}>
            <TextInput
              style={s.inputFlex}
              placeholder="Minimum 8 caractères"
              placeholderTextColor={C.muted}
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!showPwd}
              autoFocus
              returnKeyType="next"
            />
            <TouchableOpacity onPress={() => setShowPwd(!showPwd)} style={s.eyeBtn}>
              <Text style={s.eyeIcon}>{showPwd ? '🙈' : '👁️'}</Text>
            </TouchableOpacity>
          </View>

          {/* Barre de force */}
          {password.length > 0 && (
            <View style={s.strengthWrap}>
              <View style={s.strengthBar}>
                {[1, 2, 3, 4, 5].map((n) => (
                  <View
                    key={n}
                    style={[
                      s.strengthSegment,
                      { backgroundColor: n <= strength.score ? strength.color : C.line },
                    ]}
                  />
                ))}
              </View>
              <Text style={[s.strengthLabel, { color: strength.color }]}>
                {strength.label}
              </Text>
            </View>
          )}
        </View>

        {/* Champ confirmation */}
        <View style={s.fieldWrap}>
          <Text style={s.label}>Confirmer le mot de passe</Text>
          <TextInput
            style={[s.input, mismatch && s.inputError]}
            placeholder="Répétez le mot de passe"
            placeholderTextColor={C.muted}
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry={!showPwd}
            returnKeyType="done"
            onSubmitEditing={handleReset}
          />
          {mismatch && (
            <Text style={s.errorTxt}>Les mots de passe ne correspondent pas.</Text>
          )}
        </View>

        <TouchableOpacity
          style={[s.btn, (!canSubmit || loading) && s.btnDisabled]}
          onPress={handleReset}
          disabled={!canSubmit || loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#070b1c" />
            : <Text style={s.btnTxt}>Réinitialiser le mot de passe</Text>
          }
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex:       { flex: 1, backgroundColor: C.bg },
  container:  { flexGrow: 1, padding: 24, justifyContent: 'center' },
  iconWrap:   { alignItems: 'center', marginBottom: 24 },
  icon:       { fontSize: 56 },
  title:      { fontSize: 24, fontWeight: '800', color: C.txt, textAlign: 'center', marginBottom: 12 },
  subtitle:   { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  fieldWrap:  { marginBottom: 20 },
  label:      { fontSize: 12, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 },
  input: {
    backgroundColor:   C.panel,
    borderWidth:       1,
    borderColor:       C.line,
    borderRadius:      10,
    paddingHorizontal: 16,
    paddingVertical:   14,
    fontSize:          16,
    color:             C.txt,
  },
  inputError:  { borderColor: C.error },
  inputRow:    { flexDirection: 'row', alignItems: 'center', backgroundColor: C.panel, borderWidth: 1, borderColor: C.line, borderRadius: 10 },
  inputFlex:   { flex: 1, paddingHorizontal: 16, paddingVertical: 14, fontSize: 16, color: C.txt },
  eyeBtn:      { paddingHorizontal: 14 },
  eyeIcon:     { fontSize: 18 },
  strengthWrap: { flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 8 },
  strengthBar:  { flexDirection: 'row', flex: 1, gap: 4 },
  strengthSegment: { flex: 1, height: 4, borderRadius: 2 },
  strengthLabel:   { fontSize: 12, fontWeight: '600', minWidth: 64, textAlign: 'right' },
  errorTxt:    { fontSize: 12, color: C.error, marginTop: 6 },
  btn: {
    backgroundColor: C.gold,
    borderRadius:    12,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       8,
  },
  btnDisabled: { opacity: 0.5 },
  btnTxt:      { fontSize: 16, fontWeight: '800', color: '#070b1c' },
  // Écran succès
  successWrap:  { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center', padding: 32 },
  successIcon:  { fontSize: 72, marginBottom: 24 },
  successTitle: { fontSize: 26, fontWeight: '800', color: C.txt, textAlign: 'center', marginBottom: 16 },
  successSub:   { fontSize: 15, color: C.muted, textAlign: 'center', lineHeight: 24, marginBottom: 40 },
});
