// ============================================================================
// navigation/MainTabs.tsx — Navigateur à onglets principal (6 onglets)
// Utilisé lorsque l'utilisateur est authentifié (status = 'authenticated')
// ============================================================================

import React from 'react';
import { Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MainTabParamList } from './types';

// Import des screens
import { MarketScreen }       from '../screens/MarketScreen';
import { WatchlistScreen }    from '../screens/WatchlistScreen';
import { OrdresScreen }       from '../screens/OrdresScreen';
import { CarnetScreen }       from '../screens/CarnetScreen';
import { PortefeuilleScreen } from '../screens/PortefeuilleScreen';
import { ProfilScreen }       from '../screens/ProfilScreen';

// Palette couleurs bourse
const C = {
  bg:     '#070b1c',
  panel:  '#111733',
  line:   '#1f2a52',
  txt:    '#e7ecff',
  muted:  '#8a93b8',
  accent: '#60a5fa',
};

const Tab = createBottomTabNavigator<MainTabParamList>();

// Icône emoji simple — pas de dépendance sur lucide-react-native pour les onglets
// (les icônes lucide nécessitent react-native-svg et sont utiles dans les screens)
function TabIcon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return (
    <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.55 }}>{emoji}</Text>
  );
}

export function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={{
        // Masquer le header : chaque screen gère son propre titre via le headerShown de Stack
        headerShown:             false,
        tabBarStyle: {
          backgroundColor:   C.panel,
          borderTopColor:    C.line,
          borderTopWidth:    1,
          height:            60,
          paddingBottom:     8,
          paddingTop:        4,
        },
        tabBarActiveTintColor:   C.accent,
        tabBarInactiveTintColor: C.muted,
        tabBarLabelStyle: {
          fontSize:   10,
          fontWeight: '600',
          marginTop:  2,
        },
      }}
    >
      {/* Onglet 1 — Marché en direct */}
      <Tab.Screen
        name="Marche"
        component={MarketScreen}
        options={{
          tabBarLabel: 'Marché',
          tabBarIcon:  ({ focused }) => <TabIcon emoji="📊" focused={focused} />,
        }}
      />

      {/* Onglet 2 — Valeurs favorites */}
      <Tab.Screen
        name="Favoris"
        component={WatchlistScreen}
        options={{
          tabBarLabel: 'Favoris',
          tabBarIcon:  ({ focused }) => <TabIcon emoji="⭐" focused={focused} />,
        }}
      />

      {/* Onglet 3 — Passer un ordre (accepte les params stock/direction) */}
      <Tab.Screen
        name="Ordre"
        component={OrdresScreen}
        options={{
          tabBarLabel: 'Ordre',
          tabBarIcon:  ({ focused }) => <TabIcon emoji="🔄" focused={focused} />,
        }}
      />

      {/* Onglet 4 — Carnet d'ordres */}
      <Tab.Screen
        name="Carnet"
        component={CarnetScreen}
        options={{
          tabBarLabel: 'Carnet',
          tabBarIcon:  ({ focused }) => <TabIcon emoji="📓" focused={focused} />,
        }}
      />

      {/* Onglet 5 — Portefeuille */}
      <Tab.Screen
        name="Portefeuille"
        component={PortefeuilleScreen}
        options={{
          tabBarLabel: 'Wallet',
          tabBarIcon:  ({ focused }) => <TabIcon emoji="💼" focused={focused} />,
        }}
      />

      {/* Onglet 6 — Profil et déconnexion */}
      <Tab.Screen
        name="Profil"
        component={ProfilScreen}
        options={{
          tabBarLabel: 'Profil',
          tabBarIcon:  ({ focused }) => <TabIcon emoji="👤" focused={focused} />,
        }}
      />
    </Tab.Navigator>
  );
}
