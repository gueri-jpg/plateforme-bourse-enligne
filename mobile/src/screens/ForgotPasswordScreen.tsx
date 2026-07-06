import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, ActivityIndicator,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView, Alert,
} from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation/types';
import { forgotPassword } from '../api/auth';

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

type Props = NativeStackScreenProps<RootStackParamList, 'ForgotPassword'>;

export function ForgotPasswordScreen({ navigation }: Props) {
  const [email,   setEmail]   = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    const trimmed = email.trim().toLowerCase();
    if (!trimmed || !trimmed.includes('@')) {
      Alert.alert('Email invalide', 'Veuillez saisir une adresse email valide.');
      return;
    }
    setLoading(true);
    try {
      const res = await forgotPassword(trimmed);
      navigation.navigate('VerifyResetCode', {
        email: trimmed,
        maskedEmail: res.masked_email,
      });
    } catch (err: any) {
      Alert.alert('Erreur', err.message ?? 'Une erreur est survenue. Réessayez.');
    } finally {
      setLoading(false);
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
          <Text style={s.icon}>🔐</Text>
        </View>

        <Text style={s.title}>Mot de passe oublié ?</Text>
        <Text style={s.subtitle}>
          Saisissez votre adresse email. Vous recevrez un code à 6 chiffres pour réinitialiser votre mot de passe.
        </Text>

        <View style={s.fieldWrap}>
          <Text style={s.label}>Adresse email</Text>
          <TextInput
            style={s.input}
            placeholder="exemple@email.com"
            placeholderTextColor={C.muted}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
            returnKeyType="send"
            onSubmitEditing={handleSubmit}
          />
        </View>

        <TouchableOpacity
          style={[s.btn, loading && s.btnDisabled]}
          onPress={handleSubmit}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading
            ? <ActivityIndicator color="#070b1c" />
            : <Text style={s.btnTxt}>Envoyer le code</Text>
          }
        </TouchableOpacity>

        <TouchableOpacity onPress={() => navigation.goBack()} style={s.backBtn}>
          <Text style={s.backTxt}>← Retour à la connexion</Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const s = StyleSheet.create({
  flex:        { flex: 1, backgroundColor: C.bg },
  container:   { flexGrow: 1, padding: 24, justifyContent: 'center' },
  iconWrap:    { alignItems: 'center', marginBottom: 24 },
  icon:        { fontSize: 56 },
  title:       { fontSize: 24, fontWeight: '800', color: C.txt, textAlign: 'center', marginBottom: 12 },
  subtitle:    { fontSize: 14, color: C.muted, textAlign: 'center', lineHeight: 22, marginBottom: 32 },
  fieldWrap:   { marginBottom: 20 },
  label:       { fontSize: 12, color: C.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.8 },
  input: {
    backgroundColor: C.panel,
    borderWidth:     1,
    borderColor:     C.line,
    borderRadius:    10,
    paddingHorizontal: 16,
    paddingVertical:   14,
    fontSize:        16,
    color:           C.txt,
  },
  btn: {
    backgroundColor: C.gold,
    borderRadius:    12,
    paddingVertical: 16,
    alignItems:      'center',
    marginTop:       8,
  },
  btnDisabled: { opacity: 0.6 },
  btnTxt:      { fontSize: 16, fontWeight: '800', color: '#070b1c' },
  backBtn:     { marginTop: 24, alignItems: 'center' },
  backTxt:     { fontSize: 14, color: C.accent },
});
