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

/* --------------------------------------------- rent and deposit (رهن و اجاره) --------------------------------------------- */
// The market's rule of thumb: every unit of deposit (ودیعه) stands for ratePct% of it in monthly rent («هر ۱۰۰ میلیون
// ودیعه = ۳ میلیون اجاره» at 3%). The rate differs by city and year; 3 is only the default.
export const RENT_DEFAULT_PCT = 3;

/**
 * deposit + rent (Rial) → the same contract as all-rent and as all-deposit, and, when a new deposit (or a new rent) is
 * given, the rent (or deposit) that keeps it equal. `over`: the new figure is more than the whole contract is worth.
 */
export function rentConvert({ deposit = 0, rent = 0, ratePct = RENT_DEFAULT_PCT, newDeposit = null, newRent = null } = {}) {
  const r = clampPct(ratePct, RENT_DEFAULT_PCT) / 100;
  const D = Math.max(0, +deposit || 0), R = Math.max(0, +rent || 0);
  if (!(r > 0) || !(D > 0 || R > 0)) return null;
  const fullRent = R + D * r, fullDeposit = D + R / r;
  let to = null;
  if (newDeposit !== null && newDeposit !== undefined && +newDeposit >= 0) {
    const R2 = fullRent - +newDeposit * r;
    to = R2 >= 0 ? { deposit: +newDeposit, rent: R2 } : { deposit: +newDeposit, rent: 0, over: true, overBy: +newDeposit - fullDeposit };
  } else if (newRent !== null && newRent !== undefined && +newRent >= 0) {
    const D2 = (fullRent - +newRent) / r;
    to = D2 >= 0 ? { deposit: D2, rent: +newRent } : { deposit: 0, rent: +newRent, over: true, overBy: +newRent - fullRent };
  }
  return { rate: r, fullRent, fullDeposit, to };
}

/** A tenant's view of more deposit: each unit saves 12 × rate of it in rent a year; in a bank deposit it would earn this. */
export function rentVsDeposit({ ratePct = RENT_DEFAULT_PCT, depositPct = 0 } = {}) {
  const rentYield = 12 * clampPct(ratePct, RENT_DEFAULT_PCT) / 100;
  const depositYield = Math.max(0, +depositPct || 0) / 100; // simple: monthly interest taken out, as the rent saving is
  return { rentYield, depositYield, more: rentYield > depositYield + 1e-9 ? 'deposit' : rentYield < depositYield - 1e-9 ? 'bank' : 'same' };
}

/* --------------------------------------------- the real cost of a loan --------------------------------------------- */
/** Bank installment: P·i ÷ (1 − (1+i)^−n), i = yearly ÷ 1200 — the same formula as installment loans in Dara. */
export const installment = (P, ratePct, n) => { const i = (+ratePct || 0) / 1200; return i ? (P * i) / (1 - Math.pow(1 + i, -n)) : P / n; };

/**
 * The monthly rate at which a borrower's cash flows ([month, amount]: money in first, payments after) are worth zero
 * today; null when there is none. Their value rises with the rate, so the rates are scanned upward from −5% a month and
 * only a crossing from below zero to above it counts (a blocked deposit returned at the end can add a second sign change).
 */
export function irrMonthly(flows) {
  const npv = (m) => flows.reduce((t, [k, v]) => t + v / Math.pow(1 + m, k), 0);
  const scale = Math.max(1, ...flows.map(([, v]) => Math.abs(v)));
  let a = -0.05, fa = npv(a);
  if (fa === 0) return a;
  // fine steps near usual rates, coarser ones up to 100% a month (a package can be that dear)
  for (let b = a + 0.0005; b <= 1 + 1e-12; b += Math.max(0.0005, Math.abs(b) * 0.02)) {
    const fb = npv(b);
    if (!isFinite(fb)) return null;
    if (fa < 0 && fb >= 0) {
      let lo = a, hi = b, flo = fa;
      for (let it = 0; it < 100; it++) { const mid = (lo + hi) / 2, f = npv(mid); if (Math.abs(f) < 1e-9 * scale) return mid; if (f * flo > 0) { lo = mid; flo = f; } else hi = mid; }
      return (lo + hi) / 2;
    }
    a = b; fa = fb;
  }
  return null;
}

/**
 * A loan with the bank's conditions, from the borrower's side:
 *  feePct     — taken out of the loan when it is paid (کارمزد، بیمه، سهم صندوق…), percent of the amount
 *  blocked    — money the bank keeps blocked for the whole loan (سپرده مسدودی), earning blockedPct a year, returned at the end
 *  idle, idleMonths, idlePct — money that must sit in an account before the loan (معدل), earning idlePct. Its cost is the
 *               interest it gives up against opportunityPct (what it would earn in a deposit), counted as a fee at payout.
 * realPct: the yearly rate the whole package costs (12 × the monthly rate of its cash flows), comparable to a bank's quote.
 * earns: the package costs nothing at any rate (e.g. a cheap loan with a well-paid blocked deposit). noMoney: nothing is left
 * to receive after the fee and the blocked deposit.
 */
export function loanCost({ amount, ratePct, months, feePct = 0, blocked = 0, blockedPct = 0, idle = 0, idleMonths = 0, idlePct = 0, opportunityPct = 0 } = {}) {
  const L = +amount, n = Math.round(+months), rate = ratePct === null || ratePct === undefined || ratePct === '' ? NaN : +ratePct;
  if (!(L > 0) || !(n >= 1 && n <= 600) || !(rate >= 0)) return null;
  const A = installment(L, rate, n);
  const fee = (L * clampPct(feePct, 0)) / 100;
  const B = Math.max(0, +blocked || 0), I = Math.max(0, +idle || 0), M = I > 0 ? Math.max(0, Math.round(+idleMonths || 0)) : 0;
  const bInt = (B * clampPct(blockedPct, 0)) / 1200;
  const g = (p) => Math.pow(1 + clampPct(p, 0) / 1200, M);
  const idleCost = I > 0 && M > 0 ? Math.max(0, I * (g(opportunityPct) - g(idlePct))) : 0;
  const net = L - fee - B - idleCost;
  const base = { amount: L, months: n, installment: A, total: A * n, interest: A * n - L, fee, blocked: B, idle: I, idleMonths: M, idleCost,
    netReceived: L - fee - B, extras: fee > 0 || B > 0 || idleCost > 0 };
  if (!(net > 0)) return { ...base, noMoney: true, realPct: null, effAnnual: null };
  const flows = [[0, net]];
  for (let k = 1; k <= n; k++) flows.push([k, -A + bInt + (k === n ? B : 0)]);
  const m = irrMonthly(flows);
  const earns = m === null && flows.reduce((t, [, v]) => t + v, 0) > 0;
  return { ...base, realPct: m === null ? null : m * 1200, effAnnual: m === null ? null : Math.pow(1 + m, 12) - 1, earns };
}

/* --------------------------------------------------- deposits --------------------------------------------------- */
/** Interest on a deposit paid monthly: per month, over the term, and with each month's interest deposited again. */
export function depositYield({ principal, ratePct, months = 12 } = {}) {
  const P = +principal, r = +ratePct, n = Math.round(+months);
  if (!(P > 0) || !(r > 0) || !(n >= 1)) return null;
  const monthly = (P * r) / 1200;
  const compounded = P * (Math.pow(1 + r / 1200, n) - 1);
  return { monthly, simple: monthly * n, compounded, effAnnual: Math.pow(1 + r / 1200, 12) - 1, months: n };
}

/**
 * Breaking a term deposit early, the way most banks do it: the months already held are paid again at a lower rate
 * (breakPct — in the deposit's contract: usually the short-term rate or the rate of a shorter term).
 *  paidOut (default): the interest was paid out monthly, so what was received above the lower rate comes off the principal.
 *  otherwise (interest left on the deposit): the deposit returns its principal plus the months held at the lower rate.
 * Only whole months count. With newPct (0 = cash), compares keeping it to the end with breaking now and putting what comes
 * back in at newPct for the same remaining months (simple interest on both sides).
 */
export function depositBreak({ principal, ratePct, termMonths, heldMonths, breakPct, newPct = null, paidOut = true } = {}) {
  const P = +principal, r = +ratePct, T = Math.round(+termMonths), h = Math.max(0, Math.floor(+heldMonths || 0)), b = +breakPct;
  if (!(P > 0) || !(r > 0) || !(T >= 1) || !(b >= 0)) return null;
  if (h >= T) return { matured: true, principal: P, back: P, penalty: 0, remaining: 0, held: h };
  const rem = T - h, rb = Math.min(b, r);
  const out = { principal: P, held: h, remaining: rem, paidOut };
  if (paidOut) {
    out.received = (P * r * h) / 1200;
    out.penalty = Math.min(P, Math.max(0, out.received - (P * rb * h) / 1200));
    out.back = P - out.penalty;
    out.keepInterest = (P * r * rem) / 1200;            // still to be paid out if kept
    out.keepEnd = P + out.keepInterest;                 // what keeping brings from today on
  } else {
    out.lost = (P * (r - rb) * h) / 1200;               // the interest earned so far that breaking gives up
    out.back = P + (P * rb * h) / 1200;
    out.penalty = 0;
    out.keepInterest = (P * r * rem) / 1200;
    out.keepEnd = P + (P * r * T) / 1200;               // principal and all its interest at maturity
  }
  if (newPct !== null && newPct !== undefined && newPct !== '' && +newPct >= 0) {
    out.newInterest = (out.back * +newPct * rem) / 1200;
    out.diff = out.back + out.newInterest - out.keepEnd; // + : breaking and moving ends with more
    out.evenPct = out.back > 0 && rem ? (out.keepEnd / out.back - 1) * 1200 / rem : null; // the new rate that ends level
  }
  return out;
}
