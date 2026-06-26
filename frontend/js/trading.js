// ============================================================================
// trading.js — Portefeuille, ordres, watchlist (localStorage, démo pédagogique)
//
// Statuts d'ordre implémentés :
//   en_attente → ordre reçu hors horaires (marché) ou prix limite non atteint
//   exécuté    → exécution immédiate (marché ouvert) ou condition limite atteinte
//   rejeté     → validation échouée (solde/titres insuffisants)
//   annulé     → annulation manuelle par l'investisseur (remboursement)
//
// Horaires BVC : lundi–vendredi 09:00–15:30 heure de Casablanca (UTC+1).
// Les fonds/titres sont RÉSERVÉS dès la création de l'ordre pour éviter
// tout sur-engagement. La contrepartie est créditée à l'exécution.
// ============================================================================

let _userId = "default";

export function setUserId(sub) {
  _userId = sub && sub.length > 0 ? sub : "default";
}

const KEYS = {
  get PORTFOLIO() { return `bourse_portfolio_${_userId}`; },
  get ORDERS()    { return `bourse_orders_${_userId}`; },
  get WATCHLIST() { return `bourse_watchlist_${_userId}`; },
};

const CAPITAL_INITIAL = 100_000; // MAD

// ── Horaires de marché ────────────────────────────────────────────────────────

/**
 * Retourne true si la BVC est actuellement ouverte.
 * Horaires : lundi–vendredi 09:00–15:30, fuseau Africa/Casablanca (UTC+1).
 */
export function isMarketOpen() {
  try {
    const casaStr = new Date().toLocaleString("en-US", { timeZone: "Africa/Casablanca" });
    const casa = new Date(casaStr);
    const day  = casa.getDay(); // 0=Dim, 1=Lun … 5=Ven, 6=Sam
    const mins = casa.getHours() * 60 + casa.getMinutes();
    return day >= 1 && day <= 5 && mins >= 540 && mins < 930; // 09:00–15:30
  } catch {
    return false;
  }
}

export function marketStatusLabel() {
  return isMarketOpen()
    ? { open: true,  label: "Marché ouvert · BVC 09:00–15:30" }
    : { open: false, label: "Marché fermé · Ordres transmis à l'ouverture" };
}

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

// Helper interne : ajoute ou met à jour une position (prix moyen pondéré)
function _addPosition(portfolio, { name, sector, qty, price }) {
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
 * Passe un ordre avec gestion complète des statuts et des horaires BVC.
 *
 * Logique :
 *  1. Validation métier (solde espèces ou solde titres)          → rejeté si KO
 *  2. Réservation immédiate des fonds/titres                     → anti sur-engagement
 *  3. Statut initial :
 *       - ordre marché + marché ouvert  → exécuté  (crédite la contrepartie)
 *       - ordre marché + marché fermé   → en_attente (exécuté à l'ouverture via checkPendingOrders)
 *       - ordre limité (toujours)        → en_attente (exécuté quand prix atteint)
 *
 * @returns {{ success: boolean, status: string, message: string }}
 */
export function placeOrder({ name, sector = "", direction, type, qty, price }) {
  if (!name || qty <= 0 || price <= 0)
    return { success: false, status: "rejeté", message: "Paramètres d'ordre invalides." };

  const portfolio = getPortfolio();
  const total = Math.round(qty * price * 100) / 100;

  // ── 1. Validation métier — rejet enregistré dans l'historique
  let rejectMessage = null;
  if (direction === "achat" && portfolio.balance < total) {
    rejectMessage = `Solde insuffisant — disponible : ${fmt(portfolio.balance)} MAD, requis : ${fmt(total)} MAD.`;
  } else if (direction === "vente") {
    const pos = portfolio.positions.find(p => p.name === name);
    const held = pos?.qty ?? 0;
    if (held < qty)
      rejectMessage = `Quantité insuffisante — détenu : ${held} titre(s), demandé : ${qty}.`;
  }

  if (rejectMessage) {
    // Persister l'ordre rejeté pour qu'il apparaisse dans "Mon carnet"
    const rejected = {
      id: Date.now(), date: new Date().toISOString(),
      executionDate: null, cancelDate: null,
      name, sector, direction, type, qty, price, total,
      status: "rejeté", marketWasOpen: isMarketOpen(),
      rejectReason: rejectMessage,
    };
    const orders = getOrders();
    orders.unshift(rejected);
    saveOrders(orders);
    return { success: false, status: "rejeté", message: rejectMessage };
  }

  // ── 2. Réservation immédiate (évite le sur-engagement)
  if (direction === "achat") {
    portfolio.balance -= total; // Espèces réservées
  } else {
    const posIdx = portfolio.positions.findIndex(p => p.name === name);
    portfolio.positions[posIdx].qty -= qty; // Titres réservés
    if (portfolio.positions[posIdx].qty === 0) portfolio.positions.splice(posIdx, 1);
  }

  // ── 3. Statut initial
  const open = isMarketOpen();
  const status = (type === "marche" && open) ? "exécuté" : "en_attente";

  // ── 4. Crédit de la contrepartie si exécution immédiate
  if (status === "exécuté") {
    if (direction === "achat") {
      _addPosition(portfolio, { name, sector, qty, price });
    } else {
      portfolio.balance += total;
    }
  }

  // ── 5. Enregistrement
  const order = {
    id:            Date.now(),
    date:          new Date().toISOString(),
    executionDate: status === "exécuté" ? new Date().toISOString() : null,
    cancelDate:    null,
    name, sector, direction, type, qty,
    price,          // prix initial (peut être mis à jour pour ordres marché en_attente)
    total,
    status,
    marketWasOpen: open,
    rejectReason:  null,
  };

  const orders = getOrders();
  orders.unshift(order);
  savePortfolio(portfolio);
  saveOrders(orders);

  const verb = direction === "achat" ? "d'achat" : "de vente";
  const messages = {
    "exécuté":    `Ordre ${verb} de ${qty} × ${name} exécuté à ${fmt(price)} MAD.`,
    "en_attente": type === "limite"
      ? `Ordre limité ${verb} de ${qty} × ${name} en attente (prix cible : ${fmt(price)} MAD).`
      : `Ordre ${verb} de ${qty} × ${name} transmis — sera exécuté à l'ouverture du marché (09:00 BVC).`,
  };
  return { success: true, status, message: messages[status] };
}

/**
 * Vérifie les ordres "en_attente" et exécute ceux dont la condition est remplie.
 * Doit être appelé à chaque nouveau snapshot BVC reçu via WebSocket.
 *
 * @param {Array} stocks - tableau des cotations actuelles (parseStocks())
 * @returns {Array} ordres nouvellement exécutés (pour afficher des notifications)
 */
export function checkPendingOrders(stocks) {
  if (!isMarketOpen()) return []; // Hors horaires : aucun déclenchement

  const orders    = getOrders();
  const portfolio = getPortfolio();
  const executed  = [];
  let changed     = false;

  for (const order of orders) {
    if (order.status !== "en_attente") continue;

    const stock = stocks.find(s => s.name === order.name);
    if (!stock || isNaN(stock.price)) continue;

    let shouldExecute = false;

    if (order.type === "marche") {
      // Ordre marché placé hors horaires : marché ouvert maintenant → exécuter
      shouldExecute = true;
      order.price = stock.price;
      order.total = Math.round(order.qty * stock.price * 100) / 100;
    } else {
      // Ordre limité : vérification de la condition de prix
      if (order.direction === "achat" && stock.price <= order.price) shouldExecute = true;
      if (order.direction === "vente" && stock.price >= order.price) shouldExecute = true;
    }

    if (!shouldExecute) continue;

    // Fonds/titres déjà réservés à la création → créditer la contrepartie
    if (order.direction === "achat") {
      _addPosition(portfolio, {
        name: order.name, sector: order.sector,
        qty: order.qty, price: order.price,
      });
    } else {
      portfolio.balance += order.total;
    }

    order.status        = "exécuté";
    order.executionDate = new Date().toISOString();
    executed.push({ ...order });
    changed = true;
  }

  if (changed) {
    savePortfolio(portfolio);
    saveOrders(orders);
  }

  return executed;
}

/**
 * Annule un ordre "en_attente" et restitue les fonds/titres réservés.
 * @param {number} orderId
 * @returns {{ success: boolean, message: string }}
 */
export function cancelOrder(orderId) {
  const orders    = getOrders();
  const portfolio = getPortfolio();
  const order     = orders.find(o => o.id === orderId);

  if (!order)
    return { success: false, message: "Ordre introuvable." };
  if (order.status !== "en_attente")
    return { success: false, message: `Impossible d'annuler un ordre "${order.status}".` };

  // Restitution des fonds/titres réservés
  if (order.direction === "achat") {
    portfolio.balance += order.total;
  } else {
    _addPosition(portfolio, {
      name: order.name, sector: order.sector,
      qty: order.qty, price: order.price,
    });
  }

  order.status     = "annulé";
  order.cancelDate = new Date().toISOString();

  savePortfolio(portfolio);
  saveOrders(orders);
  return { success: true, message: `Ordre ${order.name} annulé — fonds/titres restitués.` };
}

// ── Watchlist ─────────────────────────────────────────────────────────────────

export function getWatchlist() {
  try {
    const s = localStorage.getItem(KEYS.WATCHLIST);
    return s ? JSON.parse(s) : [];
  } catch { return []; }
}

export function isInWatchlist(name) { return getWatchlist().includes(name); }

export function toggleWatchlist(name) {
  const list = getWatchlist();
  const idx  = list.indexOf(name);
  if (idx === -1) list.push(name); else list.splice(idx, 1);
  localStorage.setItem(KEYS.WATCHLIST, JSON.stringify(list));
  return idx === -1;
}

// ── Utilitaires ───────────────────────────────────────────────────────────────

function fmt(x, dp = 2) {
  if (x === null || x === undefined || isNaN(x)) return "—";
  return Number(x).toLocaleString("fr-FR", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}
