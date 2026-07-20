import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, StatusBar as RNStatusBar } from 'react-native';
import { Menu } from 'lucide-react-native';
import { useMenu } from '../navigation/menu-context';

export function ScreenHeader({ title }: { title: string }) {
  const openMenu = useMenu();
  return (
    <View style={sh.container}>
      <TouchableOpacity
        onPress={() => openMenu('left')}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        activeOpacity={0.7}
      >
        <Menu size={24} color="#0f172a" strokeWidth={1.8} />
      </TouchableOpacity>
      <Text style={sh.title}>{title}</Text>
    </View>
  );
}

const sh = StyleSheet.create({
  container: {
    flexDirection:     'row',
    alignItems:        'center',
    justifyContent:    'space-between',
    paddingHorizontal: 20,
    paddingTop:        (RNStatusBar.currentHeight ?? 0) + 14,
    paddingBottom:     12,
    backgroundColor:   '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#e8edf5',
  },
  title: {
    fontSize:   18,
    fontWeight: '700',
    color:      '#0f172a',
  },
});
