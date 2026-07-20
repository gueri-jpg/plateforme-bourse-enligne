import { create } from 'zustand';
import { storage } from '../utils/storage';

const KEY_ENABLED = 'bourse.pin_enabled';
const KEY_CODE    = 'bourse.pin_code';

interface PinState {
  enabled:  boolean;
  locked:   boolean;
  hydrated: boolean;
  hydrate:   () => Promise<void>;
  setPin:    (pin: string) => Promise<void>;
  removePin: () => Promise<void>;
  verify:    (pin: string) => Promise<boolean>;
  lock:      () => void;
  unlock:    () => void;
}

export const usePin = create<PinState>((set) => ({
  enabled:  false,
  locked:   false,
  hydrated: false,

  hydrate: async () => {
    const val = await storage.get(KEY_ENABLED);
    set({ enabled: val === 'true', hydrated: true });
  },

  setPin: async (pin) => {
    await storage.set(KEY_CODE, pin);
    await storage.set(KEY_ENABLED, 'true');
    set({ enabled: true });
  },

  removePin: async () => {
    await storage.del(KEY_CODE);
    await storage.set(KEY_ENABLED, 'false');
    set({ enabled: false, locked: false });
  },

  verify: async (pin) => {
    const stored = await storage.get(KEY_CODE);
    return stored === pin;
  },

  lock:   () => set({ locked: true }),
  unlock: () => set({ locked: false }),
}));
