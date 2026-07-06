import React, { useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { verifyResetCode, forgotPassword } from '../api/auth';

const C = {
  bg:     '#070b1c',
  panel:  '#111733',
  txt:    '#e7ecff',
  muted:  '#8a93b8',
  line:   '#1f2a52',
  accent: '#60a5fa',
  gold:   '#f59e0b',
  error:  '#f87171',
};

const CODE_LENGTH = 6;

type Props = NativeStackScreenProps<RootStackParamList, 'VerifyResetCode'>;

export function VerifyResetCodeScreen({ navigation, route }: Props) {
  const { email, maskedEmail } = route.params;

  const [digits,    setDigits]    = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [loading,   setLoading]   = useState(false);
  const [resending, setResending] = useState(false);
  const inputs = useRef<(TextInput | null)[]>(Array(CODE_LENGTH).fill(null));

  const code = digits.join('');

  function handleDigit(idx: number, val: string) {
    const d = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[idx] = d;
    setDigits(next);
    if (d && idx < CODE_LENGTH - 1) {
      inputs.current[idx + 1]?.focus();
    }
  }

  function handleKeyPress(idx: number, key: string) {
    if (key === 'Backspace' && !digits[idx] && idx > 0) {
      const next = [...digits];
      next[idx - 1] = '';
      setDigits(next);
      inputs.current[idx - 1]?.focus();
    }
  }

  async function handleVerify() {
    if (code.length !== CODE_LENGTH) {
      Alert.alert('Code incomplet', 'Veuillez saisir les 6 chiffres.');
      return;
    }
    setLoading(true);
    try {
      const res = await verifyResetCode(email, code);
      navigation.navigate('ResetPassword', { email, resetToken: res.reset_token });
    } catch (err: any) {
      Alert.alert('Code invalide', err.message ?? 'Vérifiez votre code et réessayez.');
      setDigits(Array(CODE_LENGTH).fill(''));
      inputs.current[0]?.focus();
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setResending(true);
    try {
      await forgotPassword(email);
      Alert.alert('Code renvoyé', `Un nouveau code a été envoyé à ${maskedEmail}.`);
      setDigits(Array(CODE_LENGTH).fill(''));
      inputs.current[0]?.focus();
    } catch (err: any) {
      Alert.alert('Erreur', err.message ?? 'Impossible de renvoyer le code.');
    } finally {
      setResending(false);
    }
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
          <Text style={s.icon}>📬</Text>
        </View>

        <Text style={s.title}>Vérifiez votre email</Text>
        <Text style={s.subtitle}>
          Un code à 6 chiffres a été envoyé à{'\n'}
          <Text style={s.emailHighlight}>{maskedEmail}</Text>
        </Text>

        {/* Grille OTP */}
        <View style={s.codeRow}>
          {digits.map((d, idx) => (
            <TextInput
              key={idx}
              ref={(r) => { inputs.current[idx] = r; }}
              style={[s.cell, d ? s.cellFilled : null]}
              value={d}
              onChangeText={(v) => handleDigit(idx, v)}
              onKeyPress={({ nativeEvent }) => handleKeyPress(idx, nativeEvent.key)}
              keyboardType="number-pad"
              maxLength={1}
              selectTextOnFocus
              autoFocus={idx === 0}
              returnKeyType={idx === CODE_LENGTH - 1 ? 'done' : 'next'}
            />
          ))}
        </View>

        <TouchableOpacity
          style={[s.btn, (loading || code.length < CODE_LENGTH) && s.btnDisabled]}
          onPress={handleVerify}
          disabled={loading || code.length < CODE_LENGTH}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#070b1c" />
            : <Text style={s.btnTxt}>Vérifier le code</Text>
          }
        </TouchableOpacity>

        <View style={s.resendRow}>
          <Text style={s.resendLabel}>Vous n'avez pas reçu le code ? </Text>
          <TouchableOpacity onPress={handleResend} disabled={resending}>
            {resending
              ? <ActivityIndicator color={C.accent} size="small" />
              : <Text style={s.resendLink}>Renvoyer</Text>
            }
          </TouchableOpacity>
        </View>

        <TouchableOpacity onPress={() => navigation.navigate('Login')} style={s.backBtn}>
          <Text style={s.backTxt}>← Retour à la connexion</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex:           { flex: 1, backgroundColor: C.bg },
  container:      { flexGrow: 1, padding: 24, justifyContent: 'center' },
  iconWrap:       { alignItems: 'center', marginBottom: 24 },
  icon:           { fontSize: 56 },
  title:          { fontSize: 24, fontWeight: '800', color: C.txt, textAlign: 'center', marginBottom: 12 },
  subtitle:       { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  emailHighlight: { color: C.gold, fontWeight: '700' },
  codeRow: {
    flexDirection:  'row',
    justifyContent: 'center',
    gap:            10,
    marginBottom:   32,
  },
  cell: {
    width:           48,
    height:          60,
    borderWidth:     2,
    borderColor:     C.line,
    borderRadius:    10,
    backgroundColor: C.panel,
    textAlign:       'center',
    fontSize:        24,
    fontWeight:      '700',
    color:           C.txt,
  },
  cellFilled: { borderColor: C.gold },
  btn: {
    backgroundColor: C.gold,
    borderRadius:    12,
    paddingVertical: 16,
    alignItems:      'center',
  },
  btnDisabled: { opacity: 0.5 },
  btnTxt:      { fontSize: 16, fontWeight: '800', color: '#070b1c' },
  resendRow:   { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginTop: 24 },
  resendLabel: { fontSize: 13, color: C.muted },
  resendLink:  { fontSize: 13, color: C.accent, fontWeight: '600' },
  backBtn:     { marginTop: 24, alignItems: 'center' },
  backTxt:     { fontSize: 14, color: C.accent },
});
