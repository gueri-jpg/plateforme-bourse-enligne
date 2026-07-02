// ============================================================================
// utils/storage.ts — SecureStore avec chunking pour tokens JWT > 2048 bytes
//
// Problème : iOS Keychain limite chaque entrée SecureStore à ~2048 bytes.
// Les tokens JWT Keycloak (access_token) dépassent souvent 1500-2500 bytes.
// Solution : découper en chunks de 1800 bytes stockés séparément.
//
// Fallback : en Expo Go, SecureStore est un stub qui retourne null.
// On détecte ce cas au premier appel et bascule sur AsyncStorage.
// ============================================================================

import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Taille maximum par entrée Keychain iOS (conservatif par rapport à la limite réelle ~2048)
const CHUNK_SIZE = 1800;
// Suffixe pour stocker le nombre de chunks d'une clé
const COUNT_SUFFIX = '__n';

// ── Détection de disponibilité SecureStore ──────────────────────────────────
// En Expo Go, le module natif est un stub → on bascule sur AsyncStorage.
// En dev client ou build standalone, SecureStore fonctionne normalement.
let _useSecureStore: boolean | null = null;

async function _checkSecureStore(): Promise<boolean> {
  if (_useSecureStore !== null) return _useSecureStore;
  try {
    await SecureStore.setItemAsync('__probe__', '1');
    const v = await SecureStore.getItemAsync('__probe__');
    await SecureStore.deleteItemAsync('__probe__').catch(() => {});
    _useSecureStore = v === '1';
  } catch {
    _useSecureStore = false;
  }
  if (!_useSecureStore) {
    console.warn(
      '[storage] SecureStore non fonctionnel (Expo Go / stub détecté). ' +
      'Fallback AsyncStorage pour cette session. ' +
      'Utilisez un dev client pour le Keychain chiffré.'
    );
  }
  return _useSecureStore;
}

// ── Helpers de chunking ─────────────────────────────────────────────────────

async function _writeChunked(key: string, value: string): Promise<void> {
  const chunks: string[] = [];
  for (let i = 0; i < value.length; i += CHUNK_SIZE) {
    chunks.push(value.slice(i, i + CHUNK_SIZE));
  }
  // Stocker le nombre de chunks d'abord
  await SecureStore.setItemAsync(`${key}${COUNT_SUFFIX}`, String(chunks.length));
  // Stocker chaque chunk avec son index
  for (let i = 0; i < chunks.length; i++) {
    await SecureStore.setItemAsync(`${key}__${i}`, chunks[i]);
  }
}

async function _readChunked(key: string, count: number): Promise<string | null> {
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const part = await SecureStore.getItemAsync(`${key}__${i}`);
    if (part === null) return null; // chunk manquant → données corrompues
    parts.push(part);
  }
  return parts.join('');
}

async function _deleteChunked(key: string, count: number): Promise<void> {
  await SecureStore.deleteItemAsync(`${key}${COUNT_SUFFIX}`).catch(() => {});
  for (let i = 0; i < count; i++) {
    await SecureStore.deleteItemAsync(`${key}__${i}`).catch(() => {});
  }
}

// ── API publique ─────────────────────────────────────────────────────────────

async function set(key: string, value: string): Promise<void> {
  // Sur le web, utiliser localStorage directement
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value);
    return;
  }
  try {
    if (await _checkSecureStore()) {
      // Nettoyer l'ancienne valeur chunquée si elle existe
      const oldCountStr = await SecureStore.getItemAsync(`${key}${COUNT_SUFFIX}`).catch(() => null);
      if (oldCountStr) {
        await _deleteChunked(key, parseInt(oldCountStr, 10));
      }
      if (value.length <= CHUNK_SIZE) {
        // Valeur courte : entrée simple
        await SecureStore.setItemAsync(key, value);
      } else {
        // Valeur longue (token JWT) : supprimer l'entrée simple si elle existe, puis chunker
        await SecureStore.deleteItemAsync(key).catch(() => {});
        await _writeChunked(key, value);
      }
    } else {
      // Fallback AsyncStorage (non chiffré, mais fonctionnel en Expo Go)
      await AsyncStorage.setItem(key, value);
    }
  } catch (e) {
    console.warn(`[storage] set(${key}) échoué :`, e);
  }
}

async function get(key: string): Promise<string | null> {
  if (Platform.OS === 'web') return localStorage.getItem(key);
  try {
    if (await _checkSecureStore()) {
      // Vérifier si la valeur est stockée en chunks
      const countStr = await SecureStore.getItemAsync(`${key}${COUNT_SUFFIX}`);
      if (countStr !== null) {
        return _readChunked(key, parseInt(countStr, 10));
      }
      // Sinon entrée simple
      return await SecureStore.getItemAsync(key);
    } else {
      return await AsyncStorage.getItem(key);
    }
  } catch {
    return null;
  }
}

async function del(key: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.removeItem(key);
    return;
  }
  try {
    if (await _checkSecureStore()) {
      const countStr = await SecureStore.getItemAsync(`${key}${COUNT_SUFFIX}`).catch(() => null);
      if (countStr !== null) {
        await _deleteChunked(key, parseInt(countStr, 10));
      }
      await SecureStore.deleteItemAsync(key).catch(() => {});
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch { /* ignorer les erreurs de suppression */ }
}

export const storage = { set, get, del };

// ── Clés de stockage ─────────────────────────────────────────────────────────
// Préfixe 'bourse.' pour ne pas entrer en conflit avec d'autres apps
export const KEYS = {
  accessToken:  'bourse.access_token',
  idToken:      'bourse.id_token',
  refreshToken: 'bourse.refresh_token',
  pkceVerifier: 'bourse.pkce_verifier',
  userId:       'bourse.user_sub',
} as const;
