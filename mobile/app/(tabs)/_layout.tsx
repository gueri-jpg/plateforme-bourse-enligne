import { Tabs } from 'expo-router';
import { Text } from 'react-native';

const TAB_BAR = { backgroundColor: '#111733', borderTopColor: '#1f2a52', borderTopWidth: 1 };
const HEADER  = { backgroundColor: '#070b1c', borderBottomColor: '#1f2a52', borderBottomWidth: 1 };

function Icon({ emoji, focused }: { emoji: string; focused: boolean }) {
  return <Text style={{ fontSize: 20, opacity: focused ? 1 : 0.5 }}>{emoji}</Text>;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarStyle:            TAB_BAR,
        tabBarActiveTintColor:  '#60a5fa',
        tabBarInactiveTintColor:'#8a93b8',
        headerStyle:            HEADER,
        headerTintColor:        '#e7ecff',
        tabBarLabelStyle:       { fontSize: 10 },
      }}
    >
      <Tabs.Screen name="marche"       options={{ title: 'Marché',      tabBarIcon: ({ focused }) => <Icon emoji="📊" focused={focused} /> }} />
      <Tabs.Screen name="watchlist"    options={{ title: 'Favoris',     tabBarIcon: ({ focused }) => <Icon emoji="⭐" focused={focused} /> }} />
      <Tabs.Screen name="ordres"       options={{ title: 'Ordre',       tabBarIcon: ({ focused }) => <Icon emoji="🔄" focused={focused} /> }} />
      <Tabs.Screen name="carnet"       options={{ title: 'Carnet',      tabBarIcon: ({ focused }) => <Icon emoji="📓" focused={focused} /> }} />
      <Tabs.Screen name="portefeuille" options={{ title: 'Wallet',      tabBarIcon: ({ focused }) => <Icon emoji="💼" focused={focused} /> }} />
      <Tabs.Screen name="profil"       options={{ title: 'Profil',      tabBarIcon: ({ focused }) => <Icon emoji="👤" focused={focused} /> }} />
    </Tabs>
  );
}
