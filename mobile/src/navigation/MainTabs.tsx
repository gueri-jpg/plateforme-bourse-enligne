// ============================================================================
// navigation/MainTabs.tsx — Onglets principaux avec lucide-react-native + hamburger
// ============================================================================

import React, { useState, useEffect } from 'react';
import { Text, View, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { APP_VERSION } from '../../constants/config';

import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets, SafeAreaView } from 'react-native-safe-area-context';
import {
  Home, TrendingUp, ArrowLeftRight, Wallet,
  Menu, X, ChevronRight, ClipboardList,
} from 'lucide-react-native';
import { useAuth } from '../store/useAuth';
import { startMarketWs } from '../../hooks/useMarketData';
import { MenuContext, DrawerSide } from './menu-context';
import type { MainTabParamList } from './types';

import { AccueilScreen }      from '../screens/AccueilScreen';
import { MarketScreen }       from '../screens/MarketScreen';
import { WatchlistScreen }    from '../screens/WatchlistScreen';
import { OrdresScreen }       from '../screens/OrdresScreen';
import { CarnetScreen }       from '../screens/CarnetScreen';
import { PortefeuilleScreen } from '../screens/PortefeuilleScreen';
import { ProfilScreen }       from '../screens/ProfilScreen';
import { SecurityScreen }     from '../screens/SecurityScreen';

// ── Tokens ─────────────────────────────────────────────────────────────────
const BORDEAUX = '#7B1D3A';
const INACTIVE = '#94a3b8';
const LINE     = '#e2e8f0';
const DARK     = '#0f172a';
const PANEL    = '#ffffff';
const TXT      = '#0f172a';

// ── Définition des onglets ──────────────────────────────────────────────────
type LucideIcon = React.ComponentType<{ size: number; color: string; strokeWidth?: number }>;

const TABS: Array<{ name: keyof MainTabParamList; label: string; Icon: LucideIcon }> = [
  { name: 'Accueil',      label: 'Accueil',       Icon: Home           },
  { name: 'Marche',       label: 'Marchés',        Icon: TrendingUp     },
  { name: 'Ordre',        label: 'Ordre',          Icon: ArrowLeftRight },
  { name: 'Carnet',       label: 'Carnet',         Icon: ClipboardList  },
  { name: 'Portefeuille', label: 'Portefeuille',   Icon: Wallet         },
];

// ── Barre d'onglets personnalisée ───────────────────────────────────────────
type TabState      = { routes: { name: string; key: string }[]; index: number };
type TabNavigation = { navigate: (name: string) => void };

function CustomTabBar({
  state, navigation, drawerOpen, drawerSide, onDrawerClose, logout,
}: {
  state:        TabState;
  navigation:   TabNavigation;
  drawerOpen:   boolean;
  drawerSide:   DrawerSide;
  onDrawerClose: () => void;
  logout:       () => void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <>
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

      {/* Drawer rendu ici pour avoir accès à la navigation des onglets */}
      <ProfileDrawer
        visible={drawerOpen}
        side={drawerSide}
        onClose={onDrawerClose}
        onNavigate={tab => { onDrawerClose(); navigation.navigate(tab); }}
        onLogout={() => { onDrawerClose(); logout(); }}
      />
    </>
  );
}

// ── Drawer profil ───────────────────────────────────────────────────────────
const DRAWER_W = 300;

type DrawerItem = { label: string; tab: keyof MainTabParamList | null; section: 'nav' | 'settings' };

const NAV_ITEMS: DrawerItem[] = [
  { label: 'Accueil',       tab: 'Accueil',      section: 'nav' },
  { label: 'Marchés',       tab: 'Marche',       section: 'nav' },
  { label: 'Passer un ordre', tab: 'Ordre',      section: 'nav' },
  { label: "Carnet d'ordres", tab: 'Carnet',     section: 'nav' },
  { label: 'Portefeuille',  tab: 'Portefeuille', section: 'nav' },
];

const SETTINGS_ITEMS: DrawerItem[] = [
  { label: 'Mon profil',    tab: 'Profil',   section: 'settings' },
  { label: 'Watchlist',     tab: 'Favoris',  section: 'settings' },
  { label: 'Paramètres',   tab: 'Securite', section: 'settings' },
];

function ProfileDrawer({
  visible, side = 'right', onClose, onNavigate, onLogout,
}: {
  visible:    boolean;
  side?:      DrawerSide;
  onClose:    () => void;
  onNavigate: (tab: keyof MainTabParamList) => void;
  onLogout:   () => void;
}) {
  const insets = useSafeAreaInsets();

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Scrim plein écran (couvre haut/bas/droite) */}
      <TouchableOpacity style={[StyleSheet.absoluteFill, dw.scrim]} activeOpacity={1} onPress={onClose} />

      {/* Panel positionné au-dessus du scrim */}
      <View style={[dw.root, side === 'left' ? { flexDirection: 'row-reverse' } : { flexDirection: 'row' }]} pointerEvents="box-none">
        <View style={{ flex: 1 }} pointerEvents="none" />
        <View style={[dw.panel,
          { marginTop: insets.top + 8, marginBottom: insets.bottom + 8 },
          side === 'left'
            ? { borderTopRightRadius: 24, borderBottomRightRadius: 24 }
            : { borderTopLeftRadius: 24, borderBottomLeftRadius: 24 }]}>
          {/* ── En-tête bordeaux ── */}
          <View style={dw.header}>
            <View>
              <Text style={dw.headerSub}>CFC BOURSE</Text>
              <Text style={dw.headerTitle}>Navigation</Text>
            </View>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <X size={22} color="rgba(255,255,255,0.7)" strokeWidth={1.8} />
            </TouchableOpacity>
          </View>

          <SafeAreaView style={{ flex: 1 }} edges={['bottom']}>
            {/* ── Section navigation ── */}
            <View style={dw.section}>
              <Text style={dw.sectionLabel}>NAVIGATION</Text>
              <View style={dw.group}>
                {NAV_ITEMS.map((item, idx) => (
                  <TouchableOpacity
                    key={item.label}
                    style={[dw.item, idx < NAV_ITEMS.length - 1 && dw.itemBorder]}
                    onPress={() => { onClose(); if (item.tab) onNavigate(item.tab); }}
                  >
                    <Text style={dw.itemLabel}>{item.label}</Text>
                    <ChevronRight size={15} color="#c8d4e0" strokeWidth={2} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* ── Section compte ── */}
            <View style={dw.section}>
              <Text style={dw.sectionLabel}>MON COMPTE</Text>
              <View style={dw.group}>
                {SETTINGS_ITEMS.map((item, idx) => (
                  <TouchableOpacity
                    key={item.label}
                    style={[dw.item, idx < SETTINGS_ITEMS.length - 1 && dw.itemBorder]}
                    onPress={() => { onClose(); if (item.tab) onNavigate(item.tab); }}
                  >
                    <Text style={[dw.itemLabel, dw.itemLabelMuted]}>{item.label}</Text>
                    <ChevronRight size={15} color="#c8d4e0" strokeWidth={2} />
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            {/* ── Déconnexion ── */}
            <View style={dw.section}>
              <TouchableOpacity
                style={dw.logoutBtn}
                onPress={() => { onClose(); onLogout(); }}
                activeOpacity={0.8}
              >
                <Text style={dw.logoutLabel}>Se déconnecter</Text>
              </TouchableOpacity>
            </View>

            <View style={dw.versionRow}>
              <Text style={dw.versionTxt}>v{APP_VERSION}</Text>
            </View>
          </SafeAreaView>
        </View>
      </View>
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
  const [drawerSide, setDrawerSide] = useState<DrawerSide>('right');
  const { logout } = useAuth();

  useEffect(() => { startMarketWs(); }, []);

  const openMenu = (side: DrawerSide = 'right') => { setDrawerSide(side); setDrawerOpen(true); };

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
      <StatusBar style="dark" />
      <Tab.Navigator
        tabBar={(props: any) => (
          <CustomTabBar
            {...props}
            drawerOpen={drawerOpen}
            drawerSide={drawerSide}
            onDrawerClose={() => setDrawerOpen(false)}
            logout={logout}
          />
        )}
        screenOptions={{ headerShown: false }}
      >
        <Tab.Screen name="Accueil"      component={AccueilScreen}      options={{ headerShown: false }} />
        <Tab.Screen name="Marche"       component={MarketScreen}       options={{ headerShown: false }} />
        <Tab.Screen name="Favoris"      component={WatchlistScreen}    options={{ ...sharedHeader, title: 'Favoris' }} />
        <Tab.Screen name="Ordre"        component={OrdresScreen}       options={{ headerShown: false }} />
        <Tab.Screen name="Carnet"       component={CarnetScreen}       options={{ headerShown: false }} />
        <Tab.Screen name="Portefeuille" component={PortefeuilleScreen} options={{ headerShown: false }} />
        <Tab.Screen name="Profil"       component={ProfilScreen}       options={{ ...sharedHeader, title: 'Mon profil' }} />
        <Tab.Screen name="Securite"     component={SecurityScreen}     options={{ ...sharedHeader, title: 'Sécurité' }} />
      </Tab.Navigator>
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
  root:           { flex: 1, flexDirection: 'row', alignItems: 'stretch' },
  scrim:          { backgroundColor: 'rgba(0,0,0,0.5)' },
  panel:          { width: DRAWER_W, alignSelf: 'stretch', backgroundColor: '#ffffff', overflow: 'hidden' },

  // En-tête bordeaux
  header:         { backgroundColor: BORDEAUX, paddingHorizontal: 24, paddingTop: 16, paddingBottom: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerSub:      { fontSize: 10, fontWeight: '600', color: 'rgba(255,255,255,0.55)', letterSpacing: 1.5, marginBottom: 6 },
  headerTitle:    { fontSize: 22, fontWeight: '700', color: '#ffffff' },

  // Sections groupées
  section:        { paddingHorizontal: 16, marginTop: 20 },
  sectionLabel:   { fontSize: 10, fontWeight: '700', color: '#94a3b8', letterSpacing: 1.4, marginBottom: 8, paddingLeft: 4 },
  group:          { backgroundColor: '#f4f7fb', borderRadius: 14, overflow: 'hidden' },
  item:           { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 14, paddingHorizontal: 16 },
  itemBorder:     { borderBottomWidth: 1, borderBottomColor: '#e8eef5' },
  itemLabel:      { fontSize: 15, color: DARK, fontWeight: '600' },
  itemLabelMuted: { fontWeight: '400', color: '#475569' },

  // Bouton déconnexion
  logoutBtn:      { backgroundColor: '#fff0f0', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  logoutLabel:    { fontSize: 15, fontWeight: '600', color: '#dc2626' },

  // Version
  versionRow:     { alignItems: 'center', paddingVertical: 24, marginTop: 'auto' },
  versionTxt:     { fontSize: 11, color: '#94a3b8', letterSpacing: 0.5 },
});
