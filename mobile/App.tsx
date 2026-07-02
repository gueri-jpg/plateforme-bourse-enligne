// ============================================================================
// App.tsx — Point d'entrée de l'application BourseOnline
//
// Fournisseurs (du plus externe au plus interne) :
//  1. GestureHandlerRootView — requis par react-native-gesture-handler
//  2. SafeAreaProvider       — gestion des zones sécurisées (notch, Dynamic Island)
//  3. PaperProvider          — thème react-native-paper (sombre, palette BVC)
//  4. RootNavigator          — NavigationContainer + logique auth conditionnelle
//
// NOTE : main dans package.json pointe vers node_modules/expo/AppEntry.js
// qui charge ce fichier comme export default.
// ============================================================================

import 'react-native-gesture-handler'; // doit être le PREMIER import (requis par la doc)
import React from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider }       from 'react-native-safe-area-context';
import { Provider as PaperProvider } from 'react-native-paper';

import { RootNavigator }  from './src/navigation/RootNavigator';
import { buildPaperTheme } from './src/theme';

export default function App() {
  // Construire le thème Paper à partir de la palette BVC (sombre)
  const paperTheme = buildPaperTheme();

  return (
    // GestureHandlerRootView doit couvrir tout l'arbre de composants
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <PaperProvider theme={paperTheme}>
          {/* RootNavigator contient le NavigationContainer + logique d'auth */}
          <RootNavigator />
        </PaperProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
