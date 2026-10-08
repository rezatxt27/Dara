// «ماشین‌حساب‌ها»: everyday sums that need no portfolio — what an amount buys today, and a goldsmith's invoice.
// Pure; money is Rial. Rates (seller margin, tax, melt factor) are common defaults the owner can change, not law.
import * as E from './engine.js';
import { CHOICES } from './compare.js';

const DAY = 86400000;

/** What the converter lists: everything «مقایسه دو گزینه» can buy, with the same assumed round-trip costs. */
export const ITEMS = CHOICES.filter((c) => c.kind === 'market').map((c) => ({
  id: c.id, name: c.name, unit: c.unit, ref: c.ref, cost: c.cost,
  group: c.category === 'fx' ? 'fx' : c.category === 'crypto' ? 'crypto' : c.category === 'metal' ? 'metal' : c.ref.key === 'geram18' ? 'gold' : 'coin',
  whole: c.unit === 'سکه', // coins are bought whole
}));
export const itemById = (id) => ITEMS.find((x) => x.id === id) || null;

function priceOf(item, quotes, now) {
  const q = quotes?.[E.quoteId(item.ref)];
  const price = q?.price > 0 ? q.price : null;
  return { price, stale: !price || !!q?.error || now - (q?.at || q?.fetchedAt || 0) > 3 * DAY };
}

/**
 * An amount (Rial) → how much of each item it buys. `qty` at the market price; `net` after paying about half the
 * round-trip cost on the way in (the other half is paid when selling). For coins, whole coins and what's left over.
 */
export function convertFrom(amount, quotes, { now = Date.now(), costs = {} } = {}) {
  const P = +amount;
  if (!(P > 0)) return [];
  return ITEMS.map((it) => {
    const { price, stale } = priceOf(it, quotes, now);
    if (!price) return { ...it, price: null, stale: true };
    const cost = Math.max(0, Math.min(50, costs[it.id] ?? it.cost)) / 100;
    const qty = P / price;
    const net = (P * (1 - cost / 2)) / price;
    const out = { ...it, price, stale, cost, qty, net };
    if (it.whole) { out.count = Math.floor(net + 1e-9); out.left = Math.max(0, P - (out.count * price) / (1 - cost / 2)); }
    return out;
  });
}

/** A quantity of one item → its value today (Rial), and roughly what selling it brings after half the round-trip cost. */
export function convertTo(id, qty, quotes, { now = Date.now(), costs = {} } = {}) {
  const it = itemById(id);
  const q = +qty;
  if (!it || !(q > 0)) return null;
  const { price, stale } = priceOf(it, quotes, now);
  if (!price) return { ...it, price: null, stale: true };
  const cost = Math.max(0, Math.min(50, costs[it.id] ?? it.cost)) / 100;
  return { ...it, price, stale, cost, value: q * price, net: q * price * (1 - cost / 2) };
}

/* ------------------------------------------- a goldsmith's invoice ------------------------------------------- */
// The usual way a gold piece is priced: gold value (weight × today's 18k gram price), the making charge (اجرت), the
// seller's margin on both, and value-added tax on the making charge and the margin only — never on the gold itself.
// Selling it back: the making charge is not returned, stones don't count, and the gold is taken at 740 instead of 750
// (melting loss); some shops use 747. All of these are defaults to edit.
export const GOLD_DEFAULTS = { sellerPct: 7, vatPct: 10, sellK: 740 };
/** the karat a piece is bought back at: between 600 and 750 (anything else is a typo) */
export const clampK = (k) => (+k >= 600 && +k <= 750 ? +k : GOLD_DEFAULTS.sellK);
/** a percent rate typed by the owner: 0 … 100 */
export const clampPct = (v, d) => (isFinite(+v) && v !== null && v !== '' ? Math.max(0, Math.min(100, +v)) : d);

/**
 * Buying a new piece. wage: { pct } (percent of the gold value) or { perGram } (Rial per gram).
 * Returns the invoice lines, the total, the price per gram paid, and what it would fetch if sold back right away.
 */
export function goldBuy({ weight, gram, wage = { pct: 0 }, sellerPct = GOLD_DEFAULTS.sellerPct, vatPct = GOLD_DEFAULTS.vatPct, sellK = GOLD_DEFAULTS.sellK } = {}) {
  const w = +weight, g = +gram;
  if (!(w > 0) || !(g > 0)) return null;
  const base = w * g;
  const making = wage?.perGram > 0 ? w * wage.perGram : base * Math.max(0, +wage?.pct || 0) / 100;
  const seller = (base + making) * Math.max(0, +sellerPct || 0) / 100;
  const vat = (making + seller) * Math.max(0, +vatPct || 0) / 100;
  const total = base + making + seller + vat;
  const resale = goldSell({ weight: w, gram: g, k: sellK }).expected;
  return { weight: w, gram: g, base, making, makingPct: making / base, seller, vat, total, perGram: total / w, resale, resaleLoss: 1 - resale / total };
}

/** Selling an old piece: net gold weight (stones and non-gold parts taken off) at k/750 of today's 18k gram price. */
export function goldSell({ weight, stones = 0, gram, k = GOLD_DEFAULTS.sellK, offer = null } = {}) {
  const w = +weight, g = +gram, st = Math.max(0, +stones || 0);
  if (!(w > 0) || !(g > 0)) return null;
  const kk = clampK(k);
  const net = w - st;
  if (!(net > 0)) return { weight: w, stones: st, net: 0, k: kk, gram: g, expected: 0, nothing: true };
  const expected = net * g * kk / 750;
  const out = { weight: w, stones: st, net, k: kk, gram: g, expected };
  if (+offer > 0) { out.offer = +offer; out.diff = +offer / expected - 1; } // − = the shop offers less than this
  return out;
}

/**
 * A shop's quoted total for a piece → the making charge it implies, with the same margin and tax rules:
 * total = base × ((1 + a)(1 + m)(1 + v) − v), so a = (total / base + v) / ((1 + m)(1 + v)) − 1.
 */
export function impliedWage({ weight, gram, total, sellerPct = GOLD_DEFAULTS.sellerPct, vatPct = GOLD_DEFAULTS.vatPct } = {}) {
  const w = +weight, g = +gram, t = +total;
  if (!(w > 0) || !(g > 0) || !(t > 0)) return null;
  const base = w * g, m = Math.max(0, +sellerPct || 0) / 100, v = Math.max(0, +vatPct || 0) / 100;
  const pct = (t / base + v) / ((1 + m) * (1 + v)) - 1;
  return { pct, perGram: t / w, base, belowGold: t < base };
}
