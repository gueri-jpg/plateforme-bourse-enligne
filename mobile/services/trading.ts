// ============================================================================
// trading.ts — Portefeuille, ordres et watchlist (AsyncStorage par utilisateur)
// Logique identique à trading.js du web, adaptée pour React Native
// ============================================================================

import AsyncStorage from '@react-native-async-storage/async-storage';

let _userId = 'default';

export function setUserId(sub: string) {
  _userId = sub || 'default';
}

const keys = () => ({
  PORTFOLIO: `bourse_portfolio_${_userId}`,
  ORDERS:    `bourse_orders_${_userId}`,
  WATCHLIST: `bourse_watchlist_${_userId}`,
});

const CAPITAL_INITIAL = 100_000;

// ── Types ─────────────────────────────────────────────────────────────────────

export type OrderStatus = 'en_attente' | 'exécuté' | 'rejeté' | 'annulé';

export interface Position {
  name: string;
  sector: string;
  qty: number;
  avgPrice: number;
}

export interface Portfolio {
  balance: number;
  positions: Position[];
}

export interface Order {
  id: number;
  date: string;
  executionDate: string | null;
  cancelDate: string | null;
  name: string;
  sector: string;
  direction: 'achat' | 'vente';
  type: 'marche' | 'limite';
  qty: number;
  price: number;
  total: number;
  status: OrderStatus;
}

export interface Stock {
  name: string;
  sector: string;
  price: number;
  pct: number;
  open: number;
  high: number;
  low: number;
  bid: number;
  ask: number;
  volMAD: number;
}

// ── Horaires BVC ─────────────────────────────────────────────────────────────

export function isMarketOpen(): boolean {
  try {
    const casaStr = new Date().toLocaleString('en-US', { timeZone: 'Africa/Casablanca' });
    const casa = new Date(casaStr);
    const day  = casa.getDay();
    const mins = casa.getHours() * 60 + casa.getMinutes();
    return day >= 1 && day <= 5 && mins >= 540 && mins < 930;
  } catch { return false; }
}

// ── Portefeuille ─────────────────────────────────────────────────────────────

export async function getPortfolio(): Promise<Portfolio> {
  try {
    const s = await AsyncStorage.getItem(keys().PORTFOLIO);
    return s ? JSON.parse(s) : { balance: CAPITAL_INITIAL, positions: [] };
  } catch { return { balance: CAPITAL_INITIAL, positions: [] }; }
}

async function savePortfolio(p: Portfolio) {
  await AsyncStorage.setItem(keys().PORTFOLIO, JSON.stringify(p));
}

export async function resetPortfolio() {
  await AsyncStorage.multiRemove([keys().PORTFOLIO, keys().ORDERS]);
}

function addPosition(portfolio: Portfolio, name: string, sector: string, qty: number, price: number) {
  const idx = portfolio.positions.findIndex(p => p.name === name);
  if (idx >= 0) {
    const pos = portfolio.positions[idx];
    const newQty = pos.qty + qty;
    pos.avgPrice = (pos.qty * pos.avgPrice + qty * price) / newQty;
    pos.qty = newQty;
  } else {
    portfolio.positions.push({ name, sector, qty, avgPrice: price });
  }
}

// ── Ordres ───────────────────────────────────────────────────────────────────

export async function getOrders(): Promise<Order[]> {
  try {
    const s = await AsyncStorage.getItem(keys().ORDERS);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

async function saveOrders(orders: Order[]) {
  await AsyncStorage.setItem(keys().ORDERS, JSON.stringify(orders.slice(0, 200)));
}

export async function placeOrder(params: {
  name: string; sector?: string; direction: 'achat' | 'vente';
  type: 'marche' | 'limite'; qty: number; price: number;
}): Promise<{ success: boolean; status: OrderStatus; message: string }> {
  const { name, sector = '', direction, type, qty, price } = params;
  if (!name || qty <= 0 || price <= 0)
    return { success: false, status: 'rejeté', message: 'Paramètres invalides.' };

  const portfolio = await getPortfolio();
  const total = Math.round(qty * price * 100) / 100;

  // Validation
  if (direction === 'achat' && portfolio.balance < total)
    return { success: false, status: 'rejeté', message: `Solde insuffisant — disponible : ${total} MAD.` };

  if (direction === 'vente') {
    const pos = portfolio.positions.find(p => p.name === name);
    if (!pos || pos.qty < qty)
      return { success: false, status: 'rejeté', message: `Quantité insuffisante (détenu : ${pos?.qty ?? 0}).` };
  }

  // Réservation immédiate
  if (direction === 'achat') {
    portfolio.balance -= total;
  } else {
    const posIdx = portfolio.positions.findIndex(p => p.name === name);
    portfolio.positions[posIdx].qty -= qty;
    if (portfolio.positions[posIdx].qty === 0) portfolio.positions.splice(posIdx, 1);
  }

  const open = isMarketOpen();
  const status: OrderStatus = (type === 'marche' && open) ? 'exécuté' : 'en_attente';

  if (status === 'exécuté') {
    if (direction === 'achat') addPosition(portfolio, name, sector, qty, price);
    else portfolio.balance += total;
  }

  const order: Order = {
    id: Date.now(), date: new Date().toISOString(),
    executionDate: status === 'exécuté' ? new Date().toISOString() : null,
    cancelDate: null, name, sector, direction, type, qty, price, total, status,
  };

  const orders = await getOrders();
  orders.unshift(order);
  await savePortfolio(portfolio);
  await saveOrders(orders);

  const msg = status === 'exécuté'
    ? `Ordre exécuté — ${qty} × ${name} à ${price} MAD`
    : `Ordre en attente — sera exécuté à l'ouverture`;
  return { success: true, status, message: msg };
}

export async function cancelOrder(orderId: number) {
  const orders    = await getOrders();
  const portfolio = await getPortfolio();
  const order     = orders.find(o => o.id === orderId);
  if (!order || order.status !== 'en_attente')
    return { success: false, message: 'Ordre non annulable.' };

  if (order.direction === 'achat') portfolio.balance += order.total;
  else addPosition(portfolio, order.name, order.sector, order.qty, order.price);

  order.status     = 'annulé';
  order.cancelDate = new Date().toISOString();
  await savePortfolio(portfolio);
  await saveOrders(orders);
  return { success: true, message: 'Ordre annulé — fonds restitués.' };
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

export async function getWatchlist(): Promise<string[]> {
  try {
    const s = await AsyncStorage.getItem(keys().WATCHLIST);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

export async function toggleWatchlist(name: string): Promise<boolean> {
  const list = await getWatchlist();
  const idx  = list.indexOf(name);
  if (idx === -1) list.push(name); else list.splice(idx, 1);
  await AsyncStorage.setItem(keys().WATCHLIST, JSON.stringify(list));
  return idx === -1;
}