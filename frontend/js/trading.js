// ============================================================================
// trading.js — Gestion du portefeuille, des ordres et de la watchlist
// Toutes les données sont persistées en localStorage (démo / pédagogique).
// Les clés sont préfixées par l'identifiant Keycloak (sub) de l'utilisateur
// connecté, afin que chaque compte ait ses propres données isolées.
// ============================================================================

let _userId = "default";

/** Doit être appelé au démarrage du dashboard avec le claim "sub" du token. */
export function setUserId(sub) {
  _userId = sub && sub.length > 0 ? sub : "default";
}

const KEYS = {
  get PORTFOLIO() { return `bourse_portfolio_${_userId}`; },
  get ORDERS()    { return `bourse_orders_${_userId}`; },
  get WATCHLIST() { return `bourse_watchlist_${_userId}`; },
};

const CAPITAL_INITIAL = 100_000; // MAD

// ── Portefeuille ─────────────────────────────────────────────────────────────

export function getPortfolio() {
  try {
    const s = localStorage.getItem(KEYS.PORTFOLIO);
    return s ? JSON.parse(s) : { balance: CAPITAL_INITIAL, positions: [] };
  } catch { return { balance: CAPITAL_INITIAL, positions: [] }; }
}

function savePortfolio(p) {
  localStorage.setItem(KEYS.PORTFOLIO, JSON.stringify(p));
}

export function resetPortfolio() {
  localStorage.removeItem(KEYS.PORTFOLIO);
  localStorage.removeItem(KEYS.ORDERS);
}

// ── Ordres ───────────────────────────────────────────────────────────────────

export function getOrders() {
  try {
    const s = localStorage.getItem(KEYS.ORDERS);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

function saveOrders(orders) {
  localStorage.setItem(KEYS.ORDERS, JSON.stringify(orders.slice(0, 200)));
}

/**
 * Passe un ordre.
 * @param {Object} params
 * @param {string} params.name       - Nom de l'instrument
 * @param {string} params.sector     - Secteur
 * @param {"achat"|"vente"} params.direction
 * @param {"marche"|"limite"} params.type
 * @param {number} params.qty        - Quantité
 * @param {number} params.price      - Prix d'exécution
 * @returns {{ success: boolean, message: string }}
 */
export function placeOrder({ name, sector = "", direction, type, qty, price }) {
  if (!name || qty <= 0 || price <= 0) {
    return { success: false, message: "Paramètres d'ordre invalides." };
  }
  const portfolio = getPortfolio();
  const total = qty * price;

  if (direction === "achat") {
    if (portfolio.balance < total) {
      return { success: false, message: `Solde insuffisant (disponible : ${fmt(portfolio.balance)} MAD).` };
    }
    portfolio.balance -= total;
    const idx = portfolio.positions.findIndex(p => p.name === name);
    if (idx >= 0) {
      const pos = portfolio.positions[idx];
      const newQty = pos.qty + qty;
      pos.avgPrice = (pos.qty * pos.avgPrice + qty * price) / newQty;
      pos.qty = newQty;
    } else {
      portfolio.positions.push({ name, sector, qty, avgPrice: price });
    }
  } else {
    const idx = portfolio.positions.findIndex(p => p.name === name);
    if (idx < 0 || portfolio.positions[idx].qty < qty) {
      const held = idx >= 0 ? portfolio.positions[idx].qty : 0;
      return { success: false, message: `Quantité insuffisante (détenu : ${held} titre(s)).` };
    }
    portfolio.balance += total;
    portfolio.positions[idx].qty -= qty;
    if (portfolio.positions[idx].qty === 0) portfolio.positions.splice(idx, 1);
  }

  const orders = getOrders();
  orders.unshift({
    id: Date.now(),
    date: new Date().toISOString(),
    name, sector, direction, type, qty, price, total,
    status: "exécuté",
  });

  savePortfolio(portfolio);
  saveOrders(orders);
  return {
    success: true,
    message: `Ordre ${direction === "achat" ? "d'achat" : "de vente"} de ${qty} × ${name} à ${fmt(price)} MAD exécuté.`,
  };
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

export function getWatchlist() {
  try {
    const s = localStorage.getItem(KEYS.WATCHLIST);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

export function isInWatchlist(name) {
  return getWatchlist().includes(name);
}

export function toggleWatchlist(name) {
  const list = getWatchlist();
  const idx = list.indexOf(name);
  if (idx === -1) list.push(name);
  else list.splice(idx, 1);
  localStorage.setItem(KEYS.WATCHLIST, JSON.stringify(list));
  return idx === -1; // true = ajouté
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function fmt(x, dp = 2) {
  if (x === null || x === undefined || isNaN(x)) return "—";
  return Number(x).toLocaleString("fr-FR", {
    minimumFractionDigits: dp, maximumFractionDigits: dp,
  });
}
