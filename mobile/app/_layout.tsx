import { useEffect, useState } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { getValidAccessToken } from '../services/auth';

export default function RootLayout() {
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    (async () => {
      const token = await getValidAccessToken();
      if (!token) router.replace('/(auth)/login');
      setChecked(true);
    })();
  }, []);

  if (!checked) return null;

  return (
    <>
      <StatusBar style="light" backgroundColor="#070b1c" />
      <Stack screenOptions={{ headerShown: false }} />
    </>
  );
}