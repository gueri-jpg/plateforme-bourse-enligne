import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator } from 'react-native';
import { getValidAccessToken } from '../services/auth';
import { setUserId } from '../services/trading';
import { decodeJwt } from '../services/auth';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SECURE_KEYS } from '../constants/config';

export default function RootLayout() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getValidAccessToken();
      if (token) {
        // Restaurer l'isolation données par utilisateur
        const sub = await AsyncStorage.getItem(SECURE_KEYS.USER_SUB);
        if (sub) setUserId(sub);
        router.replace('/(tabs)/marche');
      } else {
        router.replace('/(auth)/login');
      }
      setChecked(true);
    })();
  }, []);

  if (!checked) {
    return (
      <View style={{ flex: 1, backgroundColor: '#070b1c', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#60a5fa" size="large" />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <>
      <StatusBar style="light" backgroundColor="#070b1c" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}
