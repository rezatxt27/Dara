// Bubble (حباب): how much more than the gold inside it (a coin) or than its NAV (an exchange-traded fund) something sells for.
//   coin:  intrinsic = pure gold grams × (ounce in USD × free-market dollar ÷ 31.1035)   bubble = price ÷ intrinsic − 1
//   fund:  bubble = market price ÷ redemption NAV (NAV ابطال) − 1
// Pure functions over the stored quotes (Rial); no storage, no network.
import { quoteId } from './providers.js';

export const OUNCE_G = 31.1034768;
const DAY = 86400000;

/** Gold content of each coin: gross weight (g) × fineness. Bank Markazi specs (Bahar Azadi series, 900/1000). */
export const COINS = {
  sekee: { name: 'سکه امامی', short: 'امامی', gross: 8.133, fine: 0.9 },
  sekeb: { name: 'سکه بهار آزادی', short: 'بهار آزادی', gross: 8.133, fine: 0.9 },
  nim: { name: 'نیم سکه', short: 'نیم', gross: 4.0665, fine: 0.9 },
  rob: { name: 'ربع سکه', short: 'ربع', gross: 2.03325, fine: 0.9 },
  retail_gerami: { name: 'سکه گرمی', short: 'گرمی', gross: 1.01, fine: 0.9, retail: true }, // tgju lists it at shop (retail) prices
};
/** Raw 18-karat gold: not a coin, but the yardstick for «the cheapest way to buy gold». */
export const GOLD_REF = { geram18: { name: 'طلای ۱۸ عیار (آب‌شده)', short: '۱۸ عیار', gross: 1, fine: 0.75 } };
export const COIN_KEYS = Object.keys(COINS);
export const isCoinRef = (ref) => ref?.provider === 'tgju' && !!COINS[ref.key];
export const pureGrams = (key) => { const c = COINS[key] || GOLD_REF[key]; return c ? c.gross * c.fine : 0; };

const qAt = (q, now) => q.at || q.fetchedAt || now;
/** Usable for today's comparison: has a price, no fetch error, not older than 3 days. */
const fresh = (q, now) => !!q && q.price > 0 && !q.error && now - qAt(q, now) <= 3 * DAY;

/** Rial price of one gram of pure gold at the global rate (ounce × free-market dollar). null if either is missing. */
export function purePerGram(quotes = {}, now = Date.now()) {
  const ons = quotes['tgju:ons']; const usd = quotes['tgju:price_dollar_rl'];
  if (!(ons?.price > 0) || !(usd?.price > 0)) return null;
  return { price: ons.price * usd.price / OUNCE_G, ounce: ons.price, usd: usd.price,
    at: Math.min(qAt(ons, now), qAt(usd, now)), stale: !fresh(ons, now) || !fresh(usd, now) };
}

/** One coin (or the 18k reference). null when a price is missing. */
export function coinBubble(key, quotes = {}, now = Date.now()) {
  const c = COINS[key] || GOLD_REF[key]; const q = quotes['tgju:' + key]; const g = purePerGram(quotes, now);
  if (!c || !(q?.price > 0) || !g) return null;
  const pure = c.gross * c.fine; const intrinsic = pure * g.price;
  // the coin must be priced at about the same time as the ounce and the dollar (a day-old coin price against today's
  // dollar is not a bubble, it's the dollar's move)
  const apart = Math.abs(qAt(q, now) - qAt(quotes['tgju:ons'], now)) > 12 * 3600000 || Math.abs(qAt(q, now) - qAt(quotes['tgju:price_dollar_rl'], now)) > 12 * 3600000;
  return { kind: COINS[key] ? 'coin' : 'ref', key, name: c.name, short: c.short, price: q.price, intrinsic, pure, retail: !!c.retail,
    bubble: q.price / intrinsic - 1, perPure: q.price / pure, at: Math.min(qAt(q, now), g.at), stale: g.stale || !fresh(q, now) || apart };
}

/** All coins plus the 18k yardstick, cheapest gram of pure gold first marked. */
export function coinBubbles(quotes = {}, now = Date.now()) {
  const rows = [...COIN_KEYS, ...Object.keys(GOLD_REF)].map((k) => coinBubble(k, quotes, now)).filter(Boolean);
  // compared only among fresh prices; with none fresh there is no «lowest»
  const best = rows.filter((r) => !r.stale).reduce((m, r) => (!m || r.perPure < m.perPure ? r : m), null);
  for (const r of rows) r.vsBest = best && !r.stale ? r.perPure / best.perPure - 1 : null;
  return { rows, best, gold: purePerGram(quotes, now) };
}

/** The NAV quote that goes with an exchange-traded fund's price ref. */
export const navRef = (ref) => ({ provider: 'tsetmc', key: ref.key, field: 'nav' });
export const navId = (ref) => quoteId(navRef(ref));
/** A Tehran-exchange price ref whose NAV can be looked up (the ref itself is a price, not a NAV). */
export const isTseRef = (ref) => ref?.provider === 'tsetmc' && !!ref.key && ref.field !== 'nav';

/** An exchange-traded fund: market price vs redemption NAV. null when either is missing (e.g. a plain share). */
export function fundBubble(ref, quotes = {}, now = Date.now()) {
  if (!isTseRef(ref)) return null;
  const q = quotes[quoteId(ref)]; const nav = quotes[navId(ref)];
  if (!(q?.price > 0) || !(nav?.price > 0)) return null;
  // the two must describe the same trading day; else the gap is just time, not a bubble
  const sameDay = Math.abs(qAt(q, now) - qAt(nav, now)) < 1.5 * DAY;
  return { kind: 'fund', price: q.price, nav: nav.price, intrinsic: nav.price, bubble: q.price / nav.price - 1,
    at: Math.min(qAt(q, now), qAt(nav, now)), stale: !fresh(q, now) || !fresh(nav, now) || !sameDay };
}

/** Bubble of whatever a price ref points at (coin or exchange-traded fund). */
export function refBubble(ref, quotes = {}, now = Date.now()) {
  if (isCoinRef(ref)) return coinBubble(ref.key, quotes, now);
  if (isTseRef(ref)) return fundBubble(ref, quotes, now);
  return null;
}

/** A held asset: the market's bubble, and how much of the asset's value it is (value × b ÷ (1+b)). */
export function assetBubble(asset, quotes = {}, value = null, now = Date.now()) {
  if (asset?.mode !== 'units' || asset.price?.source !== 'market') return null;
  const b = refBubble(asset.price.ref, quotes, now);
  if (!b) return null;
  const v = value ?? null;
  return { ...b, amount: v !== null && !b.stale && b.bubble > -1 ? v * b.bubble / (1 + b.bubble) : null };
}

/** What one unit of this asset holds in gold (coin) or NAV (fund), in Rial — the yardstick a price paid is compared with. */
export function intrinsicPerUnit(asset, quotes = {}, now = Date.now()) {
  const b = asset?.price?.ref ? refBubble(asset.price.ref, quotes, now) : null;
  if (!b) return null;
  return { value: b.intrinsic * (+asset.price.factor || 1), stale: b.stale };
}

/** Bubble of a price actually paid for one unit, against today's gold/NAV. null when it can't be measured. */
export function paidBubble(asset, paidUnitPrice, quotes = {}, now = Date.now()) {
  const i = intrinsicPerUnit(asset, quotes, now);
  if (!i || i.stale || !(paidUnitPrice > 0) || !(i.value > 0)) return null;
  return paidUnitPrice / i.value - 1;
}

/**
 * The bubble paid on recorded purchases of one asset (trades that carry `bub`, not undone), quantity-weighted, and what the
 * change in bubble since then did to those units: units × intrinsic now × (bubble now − bubble paid).
 */
export function buyBubble(asset, events = [], quotes = {}, now = Date.now()) {
  let q = 0, w = 0, n = 0;
  for (const e of events) {
    if (e.undone || e.kind !== 'trade' || e.toId !== asset.id || !e.bub || !(e.bub.qty > 0) || !isFinite(e.bub.b)) continue;
    q += e.bub.qty; w += e.bub.qty * e.bub.b; n++;
  }
  if (!n) return null;
  const avg = w / q;
  const units = Math.min(q, +asset.quantity || 0);
  const i = intrinsicPerUnit(asset, quotes, now); const cur = asset.price?.ref ? refBubble(asset.price.ref, quotes, now) : null;
  const effect = i && cur && !i.stale && !cur.stale && units > 0 ? units * i.value * (cur.bubble - avg) : null;
  return { avg, count: n, qty: q, units, effect, now: cur ? cur.bubble : null };
}

/**
 * The coins' share of a «چرا تغییر کرد؟» period, split into what gold did (ounce × free dollar, from the period's start
 * snapshot to now) and what their bubble did. `at` is engine.attribution(); needs the start snapshot's global gold
 * price (`gx`) and today's fresh ounce, dollar and coin prices. The coins' value at the start (today's holding at the
 * start prices) is now − market, so: gold part = that × (gold now ÷ gold then − 1), bubble part = market − gold part.
 */
export function coinMoveSplit(at, quotes = {}, now = Date.now()) {
  const g0 = at?.snap?.gx; const g = purePerGram(quotes, now);
  if (at?.est || !(g0 > 0) || !g || g.stale) return null;
  const gr = (g.ounce * g.usd) / g0 - 1;
  let total = 0, gold = 0, n = 0;
  for (const r of at.rows || []) {
    const a = r.asset; const ref = a?.price?.ref;
    // bought, sold or edited during the period: its start holding isn't known well enough to split
    if (Math.abs(r.flow || 0) >= 1 || Math.abs(r.edit || 0) >= 1) continue;
    if (!a || r.removed || r.isNew || a.mode !== 'units' || a.price?.source !== 'market' || !isCoinRef(ref) || !r.price) continue;
    const cb = coinBubble(ref.key, quotes, now);
    if (!cb || cb.stale) continue;
    const start = r.now - r.market;
    if (!(start > 0)) continue;
    total += r.price; gold += start * gr; n++;
  }
  if (!n) return null;
  return { total, gold, bubble: total - gold, count: n };
}

/** Daily bubble series of a coin from aligned daily closes: coin [[iso, rial]], ounce in Rial [[iso, rial]]. */
export function coinBubbleSeries(key, coinPts = [], ounceRialPts = []) {
  const pure = pureGrams(key);
  if (!pure) return [];
  const om = new Map(ounceRialPts); const dates = [...new Set([...coinPts.map((p) => p[0]), ...ounceRialPts.map((p) => p[0])])].sort();
  const cm = new Map(coinPts); let lastO = null; const out = [];
  for (const d of dates) {
    if (om.has(d)) lastO = om.get(d);
    if (cm.has(d) && lastO > 0 && cm.get(d) > 0) out.push([d, cm.get(d) / (pure * lastO / OUNCE_G) - 1]);
  }
  return out;
}

/** Average and range of a bubble series, and where today sits against its own normal. */
export function bubbleStats(series = [], current = null) {
  const v = series.map((p) => p[1]).filter((x) => isFinite(x));
  if (v.length < 10) return null;
  const avg = v.reduce((s, x) => s + x, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - avg) ** 2, 0) / v.length);
  const cur = current ?? v[v.length - 1];
  // «unusual» = beyond its own usual swing (1.5 standard deviations), and at least 2 percentage points from the average
  const band = Math.max(0.02, 1.5 * sd);
  const level = cur - avg >= band ? 'high' : avg - cur >= band ? 'low' : 'normal';
  return { avg, sd, min: Math.min(...v), max: Math.max(...v), n: v.length, level, diff: cur - avg };
}

/** Bubble alert: {kind:'bubble', ref, op:'gt'|'lt', value (fraction)}. Returns the bubble now, or null if it can't be judged. */
export function alertBubble(al, quotes = {}, now = Date.now()) {
  const b = refBubble(al.ref, quotes, now);
  return b && !b.stale ? b.bubble : null;
}
