import { useState } from 'react';
// @ts-ignore
import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import {
  Text, View, TouchableOpacity, StyleSheet,
  Modal, Platform, SafeAreaView,
} from 'react-native';
import { MenuContext } from './menu-context';

// ── Tokens ────────────────────────────────────────────────────────────────
const BORDEAUX = '#7B1D3A';
const INACTIVE = '#94a3b8';
const LINE     = '#e2e8f0';
const DARK     = '#1e293b';

// ── Définition des onglets ────────────────────────────────────────────────
const TABS = [
  { name: 'accueil',      label: 'Accueil',      icon: 'home-outline'            as any, iconActive: 'home'             as any },
  { name: 'marche',       label: 'Marchés',      icon: 'trending-up-outline'     as any, iconActive: 'trending-up'      as any },
  { name: 'ordres',       label: 'Ordre',        icon: 'swap-horizontal-outline' as any, iconActive: 'swap-horizontal'  as any },
  { name: 'portefeuille', label: 'Portefeuille', icon: 'wallet-outline'          as any, iconActive: 'wallet'           as any },
  { name: 'watchlist',    label: 'Watchlist',    icon: 'star-outline'            as any, iconActive: 'star'             as any },
];

// ── Types inline ──────────────────────────────────────────────────────────
type TabState      = { routes: { name: string; key: string }[]; index: number };
type TabNavigation = { navigate: (name: string) => void };

// ── Barre d'onglets ───────────────────────────────────────────────────────
function CustomTabBar({ state, navigation }: { state: TabState; navigation: TabNavigation }) {
  return (
    <View style={tb.container}>
      {TABS.map((tab) => {
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
            <Ionicons
              name={focused ? tab.iconActive : tab.icon}
              size={22}
              color={color}
            />
            <Text style={[tb.label, { color }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Drawer profil ─────────────────────────────────────────────────────────
const DRAWER_ITEMS = [
  { label: 'Mon profil',    route: 'profil',  ionIcon: 'person-outline'        as any },
  { label: 'Mon carnet',    route: 'carnet',  ionIcon: 'book-outline'          as any },
  { label: 'Notifications', route: '',        ionIcon: 'notifications-outline' as any },
  { label: 'Paramètres',    route: '',        ionIcon: 'settings-outline'      as any },
];

function ProfileDrawer({
  visible, onClose, onNavigate,
}: { visible: boolean; onClose: () => void; onNavigate: (r: string) => void }) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={dw.overlay} activeOpacity={1} onPress={onClose}>
        <SafeAreaView style={dw.panel}>
          <View style={dw.handle} />
          <View style={dw.header}>
            <Text style={dw.headerTitle}>Menu</Text>
            <TouchableOpacity onPress={onClose} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-outline" size={26} color={INACTIVE} />
            </TouchableOpacity>
          </View>
          {DRAWER_ITEMS.map(item => (
            <TouchableOpacity
              key={item.label}
              style={dw.item}
              onPress={() => { onClose(); if (item.route) onNavigate(item.route); }}
            >
              <View style={dw.itemLeft}>
                <View style={dw.itemIconWrap}>
                  <Ionicons name={item.ionIcon} size={20} color={BORDEAUX} />
                </View>
                <Text style={dw.itemLabel}>{item.label}</Text>
              </View>
              <Ionicons name="chevron-forward-outline" size={18} color={INACTIVE} />
            </TouchableOpacity>
          ))}
          <View style={{ height: 20 }} />
        </SafeAreaView>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Layout principal ──────────────────────────────────────────────────────
export default function TabsLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();

  const openMenu = () => setDrawerOpen(true);

  return (
    <MenuContext.Provider value={openMenu}>
      <Tabs
        tabBar={(props: any) => <CustomTabBar {...props} />}
        screenOptions={{ headerShown: false }}
      >
        <Tabs.Screen name="accueil"      />
        <Tabs.Screen name="marche"       />
        <Tabs.Screen name="portefeuille" />
        <Tabs.Screen name="ordres"    options={{
          headerShown: true,
          title: 'Passer un ordre',
          headerStyle:      { backgroundColor: '#ffffff' },
          headerTintColor:  DARK,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          headerRight: () => (
            <TouchableOpacity onPress={openMenu} style={{ paddingHorizontal: 16 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="menu-outline" size={26} color={DARK} />
            </TouchableOpacity>
          ),
        }} />
        <Tabs.Screen name="watchlist" options={{
          headerShown: true,
          title: 'Watchlist',
          headerStyle:      { backgroundColor: '#ffffff' },
          headerTintColor:  DARK,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          headerRight: () => (
            <TouchableOpacity onPress={openMenu} style={{ paddingHorizontal: 16 }} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="menu-outline" size={26} color={DARK} />
            </TouchableOpacity>
          ),
        }} />
        <Tabs.Screen name="profil"  options={{ href: null }} />
        <Tabs.Screen name="carnet"  options={{ href: null }} />
      </Tabs>

      <ProfileDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={(route) => { setDrawerOpen(false); router.push(route as any); }}
      />
    </MenuContext.Provider>
  );
}

// ── Styles tab bar ────────────────────────────────────────────────────────
const tb = StyleSheet.create({
  container: {
    flexDirection:   'row',
    backgroundColor: '#ffffff',
    borderTopWidth:  1,
    borderTopColor:  LINE,
    height:          Platform.OS === 'ios' ? 74 : 62,
    paddingBottom:   Platform.OS === 'ios' ? 14 : 4,
  },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingTop: 6, gap: 3,
  },
  indicator: {
    position: 'absolute', top: 0,
    width: 28, height: 2.5,
    backgroundColor: BORDEAUX, borderRadius: 2,
  },
  label: { fontSize: 10, fontWeight: '500' },
});

// ── Styles drawer ─────────────────────────────────────────────────────────
const dw = StyleSheet.create({
  overlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end',
  },
  panel: {
    backgroundColor: '#ffffff',
    borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingTop: 8,
  },
  handle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: '#e2e8f0', alignSelf: 'center', marginBottom: 16,
  },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 24, paddingBottom: 16,
    borderBottomWidth: 1, borderBottomColor: '#f1f5f9',
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: DARK },
  item: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 24,
    borderBottomWidth: 1, borderBottomColor: '#f8fafc',
  },
  itemLeft:     { flexDirection: 'row', alignItems: 'center', gap: 14 },
  itemIconWrap: {
    width: 38, height: 38, borderRadius: 10,
    backgroundColor: 'rgba(123,29,58,.08)',
    alignItems: 'center', justifyContent: 'center',
  },
  itemLabel: { fontSize: 15, color: DARK, fontWeight: '500' },
});
