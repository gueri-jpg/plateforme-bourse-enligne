import { create } from 'zustand';

export type NotifType = 'alimentation' | 'achat' | 'vente';

export interface Notif {
  id:    string;
  type:  NotifType;
  title: string;
  body:  string;
  date:  string;
  read:  boolean;
}

interface NotifState {
  notifications: Notif[];
  unread:        number;
  add:           (n: Omit<Notif, 'id' | 'date' | 'read'>) => void;
  markAllRead:   () => void;
}

export const useNotifications = create<NotifState>((set) => ({
  notifications: [],
  unread: 0,

  add: (n) => set((s) => {
    const notif: Notif = {
      ...n,
      id:   `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      date: new Date().toISOString(),
      read: false,
    };
    return {
      notifications: [notif, ...s.notifications].slice(0, 50),
      unread: s.unread + 1,
    };
  }),

  markAllRead: () => set((s) => ({
    notifications: s.notifications.map(n => ({ ...n, read: true })),
    unread: 0,
  })),
}));
