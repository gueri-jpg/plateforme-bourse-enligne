import { useEffect, useState } from 'react';
import { Linking, View, ActivityIndicator } from 'react-native';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
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

      // Vérifier si l'app a été lancée via un deep link avant d'initialiser la navigation
      const initialUrl = await Linking.getInitialURL();

      if (token) {
        const sub = await AsyncStorage.getItem(SECURE_KEYS.USER_SUB);
        if (sub) setUserId(sub);

        // Deep link depot-confirm reçu pendant que l'app était fermée
        if (initialUrl?.startsWith('bourseenligne://depot-confirm')) {
          const u = new URL(initialUrl);
          router.replace({
            pathname: '/(tabs)/portefeuille',
            params: { depot_ref: u.searchParams.get('ref') ?? '', depot_status: u.searchParams.get('status') ?? '' },
          } as any);
        } else {
          router.replace('/(tabs)/marche');
        }
      } else {
        // Deep link SSO reçu alors que l'utilisateur n'est pas connecté
        if (initialUrl?.startsWith('bourseenligne://sso')) {
          const u = new URL(initialUrl);
          const ssoToken = u.searchParams.get('t') ?? '';
          router.replace({ pathname: '/(auth)/login', params: { sso_token: ssoToken } } as any);
        } else {
          router.replace('/(auth)/login');
        }
      }
      setChecked(true);
    })();
  }, []);

  // Écouter les deep links arrivant pendant que l'app est ouverte
  useEffect(() => {
    const handleUrl = async ({ url }: { url: string }) => {
      if (url.startsWith('bourseenligne://sso')) {
        const u = new URL(url);
        const ssoToken = u.searchParams.get('t') ?? '';
        const token = await getValidAccessToken();
        if (token) {
          router.replace('/(tabs)/marche');
        } else {
          router.replace({ pathname: '/(auth)/login', params: { sso_token: ssoToken } } as any);
        }
      } else if (url.startsWith('bourseenligne://depot-confirm')) {
        const u = new URL(url);
        router.replace({
          pathname: '/(tabs)/portefeuille',
          params: { depot_ref: u.searchParams.get('ref') ?? '', depot_status: u.searchParams.get('status') ?? '' },
        } as any);
      }
    };

    const sub = Linking.addEventListener('url', handleUrl);
    return () => sub.remove();
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
