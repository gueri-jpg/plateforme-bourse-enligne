import { useState } from 'react';
// @ts-ignore
import { Tabs, useRouter } from 'expo-router';
import {
  Text, View, TouchableOpacity, StyleSheet,
  Modal, Platform, SafeAreaView,
} from 'react-native';

// ── Tokens design ──────────────────────────────────────────────────────────
const BORDEAUX = '#7B1D3A';
const CHARCOAL = '#2d3748';
const INACTIVE = '#94a3b8';
const LINE     = '#e2e8f0';

// ── Onglets visibles ──────────────────────────────────────────────────────
const TABS = [
  { name: 'accueil',      label: 'Accueil',      icon: '🏠' },
  { name: 'marche',       label: 'Marchés',      icon: '📊' },
  { name: 'ordres',       label: 'Ordre',        icon: '⇄'  },
  { name: 'portefeuille', label: 'Portefeuille', icon: '💼' },
  { name: 'watchlist',    label: 'Watchlist',    icon: '⭐' },
];

// ── Types inline (évite dépendance @react-navigation/bottom-tabs) ─────────
type TabState = {
  routes: { name: string; key: string }[];
  index:  number;
};
type TabNavigation = {
  navigate: (name: string) => void;
};

// ── Barre d'onglets personnalisée ─────────────────────────────────────────
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
            <Text style={[tb.icon, { opacity: focused ? 1 : 0.5 }]}>{tab.icon}</Text>
            <Text style={[tb.label, { color }]}>{tab.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

// ── Drawer profil (menu hamburger) ────────────────────────────────────────
type DrawerProps = {
  visible:    boolean;
  onClose:    () => void;
  onNavigate: (route: string) => void;
};

function ProfileDrawer({ visible, onClose, onNavigate }: DrawerProps) {
  const items = [
    { label: '👤  Mon profil',    route: 'profil'  },
    { label: '📓  Mon carnet',    route: 'carnet'  },
    { label: '🔔  Notifications', route: ''        },
    { label: '⚙️   Paramètres',   route: ''        },
  ];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={dw.overlay} activeOpacity={1} onPress={onClose}>
        <SafeAreaView style={dw.panel}>
          <View style={dw.header}>
            <Text style={dw.headerTitle}>Menu</Text>
            <TouchableOpacity onPress={onClose} style={dw.closeBtn}>
              <Text style={dw.closeX}>✕</Text>
            </TouchableOpacity>
          </View>

          {items.map(item => (
            <TouchableOpacity
              key={item.label}
              style={dw.item}
              onPress={() => {
                onClose();
                if (item.route) onNavigate(item.route);
              }}
            >
              <Text style={dw.itemLabel}>{item.label}</Text>
              <Text style={dw.itemArrow}>›</Text>
            </TouchableOpacity>
          ))}

          <View style={{ height: 12 }} />
        </SafeAreaView>
      </TouchableOpacity>
    </Modal>
  );
}

// ── Layout principal ──────────────────────────────────────────────────────
export default function TabsLayout() {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const router = useRouter();

  function handleDrawerNavigate(route: string) {
    setDrawerOpen(false);
    if (route) router.push(route as any);
  }

  const HamburgerBtn = () => (
    <TouchableOpacity
      onPress={() => setDrawerOpen(true)}
      style={{ paddingHorizontal: 16, paddingVertical: 8 }}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
    >
      <Text style={{ color: '#ffffff', fontSize: 22, lineHeight: 26 }}>≡</Text>
    </TouchableOpacity>
  );

  return (
    <>
      <Tabs
        tabBar={(props: any) => <CustomTabBar {...props} />}
        screenOptions={{
          headerStyle:      { backgroundColor: CHARCOAL },
          headerTintColor:  '#ffffff',
          headerTitleStyle: { fontWeight: '600', fontSize: 16 },
          headerRight:      () => <HamburgerBtn />,
        }}
      >
        <Tabs.Screen name="accueil"      options={{ headerShown: false }} />
        <Tabs.Screen name="marche"       options={{ headerShown: false }} />
        <Tabs.Screen name="ordres"       options={{ title: 'Passer un ordre' }} />
        <Tabs.Screen name="portefeuille" options={{ headerShown: false }} />
        <Tabs.Screen name="watchlist"    options={{ title: 'Watchlist' }} />
        {/* Cachés de la tab bar — accessibles via hamburger */}
        <Tabs.Screen name="profil"  options={{ href: null, title: 'Mon profil' }} />
        <Tabs.Screen name="carnet"  options={{ href: null, title: 'Mon carnet' }} />
      </Tabs>

      <ProfileDrawer
        visible={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onNavigate={handleDrawerNavigate}
      />
    </>
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
    flex:           1,
    alignItems:     'center',
    justifyContent: 'center',
    paddingTop:     6,
  },
  indicator: {
    position:        'absolute',
    top:             0,
    width:           28,
    height:          2.5,
    backgroundColor: BORDEAUX,
    borderRadius:    2,
  },
  icon:  { fontSize: 20, marginBottom: 3 },
  label: { fontSize: 10, fontWeight: '500' },
});

// ── Styles drawer ─────────────────────────────────────────────────────────
const dw = StyleSheet.create({
  overlay: {
    flex:            1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent:  'flex-end',
  },
  panel: {
    backgroundColor:      '#ffffff',
    borderTopLeftRadius:  20,
    borderTopRightRadius: 20,
  },
  header: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    padding:           20,
    borderBottomWidth: 1,
    borderBottomColor: LINE,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#1e293b' },
  closeBtn:    { padding: 6 },
  closeX:      { fontSize: 18, color: '#64748b' },
  item: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingVertical:   16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#f1f5f9',
  },
  itemLabel: { fontSize: 15, color: '#1e293b', fontWeight: '500' },
  itemArrow: { fontSize: 22, color: '#94a3b8' },
});
