import 'react-native-gesture-handler';
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Text, View, ActivityIndicator } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { getValidAccessToken } from './services/auth';

import LoginScreen  from './screens/LoginScreen';
import MarcheScreen from './screens/MarcheScreen';
import ProfilScreen from './screens/ProfilScreen';

const Tab   = createBottomTabNavigator();
const Stack = createNativeStackNavigator();

function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
}

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        tabBarStyle:             { backgroundColor: '#111733', borderTopColor: '#1f2a52' },
        tabBarActiveTintColor:   '#60a5fa',
        tabBarInactiveTintColor: '#8a93b8',
        headerStyle:             { backgroundColor: '#070b1c' },
        headerTintColor:         '#e7ecff',
        headerTitleStyle:        { fontWeight: '600' },
      }}
    >
      <Tab.Screen
        name="Marché"
        component={MarcheScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="📊" focused={focused} /> }}
      />
      <Tab.Screen
        name="Profil"
        component={ProfilScreen}
        options={{ tabBarIcon: ({ focused }) => <TabIcon emoji="👤" focused={focused} /> }}
      />
    </Tab.Navigator>
  );
}

export default function App() {
  const [loading,  setLoading]  = useState(true);
  const [loggedIn, setLoggedIn] = useState(false);

  useEffect(() => {
    getValidAccessToken().then(token => {
      setLoggedIn(!!token);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <View style={{ flex: 1, backgroundColor: '#070b1c', alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator color="#60a5fa" size="large" />
        <StatusBar style="light" />
      </View>
    );
  }

  return (
    <NavigationContainer>
      <StatusBar style="light" />
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {loggedIn
          ? <Stack.Screen name="Main"  component={MainTabs}    />
          : <Stack.Screen name="Login" component={LoginScreen} options={{ gestureEnabled: false }} />
        }
      </Stack.Navigator>
    </NavigationContainer>
  );
}