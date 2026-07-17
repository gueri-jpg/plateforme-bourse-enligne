// ============================================================================
// navigation/MainTabs.tsx — Onglets principaux avec lucide-react-native + hamburger
// ============================================================================

import React, { useState } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal } from 'react-native';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import {
  TrendingUp, Star, ArrowLeftRight, BookOpen, Wallet,
  Menu, X, User, Bell, Settings, LogOut, ChevronRight,
} from 'lucide-react-native';
import { useAuth } from '../store/useAuth';
import { MenuContext } from './menu-context';
import type { MainTabParamList } from './types';

import { MarketScreen }       from '../screens/MarketScreen';
import { WatchlistScreen }    from '../screens/WatchlistScreen';
import { OrdresScreen }       from '../screens/OrdresScreen';
import { CarnetScreen }       from '../screens/CarnetScreen';
import { PortefeuilleScreen } from '../screens/PortefeuilleScreen';
import { ProfilScreen }       from '../screens/ProfilScreen';

// ── Tokens ─────────────────────────────────────────────────────────────────
const BORDEAUX = '#7B1D3A';
const INACTIVE = '#94a3b8';
const LINE     = '#e2e8f0';
const DARK     = '#1e293b';
const PANEL    = '#111733';
const TXT      = '#e7ecff';

// ── Définition des onglets ──────────────────────────────────────────────────
type LucideIcon = React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;

const TABS: Array<{ name: keyof MainTabParamList; label: string; Icon: LucideIcon }> = [
  { name: 'Marche',       label: 'Marché',  Icon: TrendingUp      },
  { name: 'Favoris',      label: 'Favoris', Icon: Star            },
  { name: 'Ordre',        label: 'Ordre',   Icon: ArrowLeftRight  },
  { name: 'Carnet',       label: 'Carnet',  Icon: BookOpen        },
  { name: 'Portefeuille', label: 'Wallet',  Icon: Wallet          },
];

// ── Barre d'onglets personnalisée ───────────────────────────────────────────
type TabState      = { routes: { name: string; key: string }[]; index: number };
type TabNavigation = { navigate: (name: string) => void };

function CustomTabBar({ state, navigation }: { state: TabState; navigation: TabNavigation }) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[tb.container, { paddingBottom: 8 + insets.bottom, height: 58 + insets.bottom }]}>
      {TABS.map(tab => {
        const routeIdx = state.routes.findIndex(r => r.name === tab.name);
        if (routeIdx === -1) return null;
        const focused = state.index === routeIdx;
        const color   = focused ? BORDEAUX : INACTIVE;
        return (
          <TouchableOpacity
            key={tab.name}
            style={tb.tab}
            onPress={() => navigation.navigate(tab.name)}
            activeOpacity={0.75}
          >
            {focused && <View style={tb.indicator} />}
            <tab.Icon size={22} color={color} strokeWidth={focused ? 2.2 : 1.8} />
            <Text style={[tb.label, { color }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Drawer profil ───────────────────────────────────────────────────────────
const DRAWER_ITEMS: Array<{
  label:   string;
  Icon:    LucideIcon;
  tab:     keyof MainTabParamList | null;
  danger?: boolean;
}> = [
  { label: 'Mon profil',    Icon: User,     tab: 'Profil'  },
  { label: 'Mon carnet',    Icon: BookOpen, tab: 'Carnet'  },
  { label: 'Notifications', Icon: Bell,     tab: null      },
  { label: 'Paramètres',    Icon: Settings, tab: null      },
];

function ProfileDrawer({
  visible, onClose, onNavigate, onLogout,
}: {
  visible:    boolean;
  onClose:    () => void;
  onNavigate: (tab: keyof MainTabParamList) => void;
  onLogout:   () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={dw.overlay} activeOpacity={1} onPress={onClose}>
        <SafeAreaView style={dw.panel} edges={['bottom']}>
          <View style={dw.handle} />
          <View style={dw.header}>
            <Text style={dw.headerTitle}>Menu</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <X size={24} color={INACTIVE} />
            </TouchableOpacity>
          </View>

          {DRAWER_ITEMS.map(item => (
            <TouchableOpacity
              key={item.label}
              style={dw.item}
              onPress={() => { onClose(); if (item.tab) onNavigate(item.tab); }}
            >
              <View style={dw.itemLeft}>
                <View style={dw.itemIconWrap}>
                  <item.Icon size={18} color={BORDEAUX} />
                </View>
                <Text style={dw.itemLabel}>{item.label}</Text>
              </View>
              <ChevronRight size={16} color={INACTIVE} />
            </TouchableOpacity>
          ))}

          <TouchableOpacity
            style={[dw.item, { marginTop: 8 }]}
            onPress={() => { onClose(); onLogout(); }}
          >
            <View style={dw.itemLeft}>
              <View style={[dw.itemIconWrap, { backgroundColor: 'rgba(239,68,68,0.08)' }]}>
                <LogOut size={18} color="#ef4444" />
              </View>
              <Text style={[dw.itemLabel, { color: '#ef4444' }]}>Se déconnecter</Text>
            </View>
          </TouchableOpacity>

          <View style={{ height: 16 }} />
        </SafeAreaView>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Bouton hamburger ────────────────────────────────────────────────────────
function HamburgerBtn({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={{ paddingHorizontal: 16 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Menu size={24} color={TXT} />
    </TouchableOpacity>
  );
}

// ── Layout principal ────────────────────────────────────────────────────────
const Tab = createBottomTabNavigator<MainTabParamList>();

export function MainTabs() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const { logout } = useAuth();
  const navigation = useNavigation<BottomTabNavigationProp<MainTabParamList>>();

  const openMenu = () => setDrawerOpen(true);

  const sharedHeader = {
    headerShown:         true,
    headerStyle:         { backgroundColor: PANEL },
    headerTintColor:     TXT,
    headerTitleStyle:    { fontWeight: '700' as const, fontSize: 17 },
    headerShadowVisible: false,
    headerRight:         () => <HamburgerBtn onPress={openMenu} />,
  };

  return (
    <MenuContext.Provider value={openMenu}>
      <Tab.Navigator
        tabBar={(props: any) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Marche"       component={MarketScreen}       options={{ ...sharedHeader, title: 'Marchés' }} />
        <Tab.Screen name="Favoris"      component={WatchlistScreen}    options={{ ...sharedHeader, title: 'Favoris' }} />
        <Tab.Screen name="Ordre"        component={OrdresScreen}       options={{ ...sharedHeader, title: 'Passer un ordre' }} />
        <Tab.Screen name="Carnet"       component={CarnetScreen}       options={{ ...sharedHeader, title: "Carnet d'ordres" }} />
        <Tab.Screen name="Portefeuille" component={PortefeuilleScreen} options={{ ...sharedHeader, title: 'Portefeuille' }} />
        <Tab.Screen name="Profil"       component={ProfilScreen}       options={{ ...sharedHeader, title: 'Mon profil' }} />
      </Tab.Navigator>

      <ProfileDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={tab => { setDrawerOpen(false); (navigation as any).navigate(tab); }}
        onLogout={logout}
      />
    </MenuContext.Provider>
  );
}

// ── Styles tab bar ──────────────────────────────────────────────────────────
const tb = StyleSheet.create({
  container: {
    flexDirection: 'row', backgroundColor: '#ffffff',
    borderTopWidth: 1, borderTopColor: LINE, paddingTop: 6,
  },
  tab:       { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3 },
  indicator: {
    position: 'absolute', top: 0,
    width: 28, height: 2.5, backgroundColor: BORDEAUX, borderRadius: 2,
  },
  label:     { fontSize: 10, fontWeight: '500' },
});

// ── Styles drawer ───────────────────────────────────────────────────────────
const dw = StyleSheet.create({
  overlay:      { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  panel:        { backgroundColor: '#ffffff', borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8 },
  handle:       { width: 40, height: 4, borderRadius: 2, backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 16 },
  header:       { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 24, paddingBottom: 16, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' },
  headerTitle:  { fontSize: 18, fontWeight: '700', color: DARK },
  item:         { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 24, borderBottomWidth: 1, borderBottomColor: '#f8fafc' },
  itemLeft:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  itemIconWrap: { width: 38, height: 38, borderRadius: 10, backgroundColor: 'rgba(123,29,58,.08)', alignItems: 'center', justifyContent: 'center' },
  itemLabel:    { fontSize: 15, color: DARK, fontWeight: '500' },
});
