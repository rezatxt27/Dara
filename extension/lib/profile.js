// «پروفایل سرمایه‌گذاری»: a few answers about the owner that the rest of Dara takes into account — the assistant's
// answers, an emergency-fund check, a starting target mix, the pre-buy checklist and the radar's risk tag.
// Pure. Stored as settings.profile; money in Rial. Nothing here is advice to buy or sell.

export const QUESTIONS = {
  goal: { t: 'هدف اصلی این پول', o: [['protect', 'حفظ ارزش در برابر تورم'], ['grow', 'رشد بلندمدت'], ['income', 'درآمد ماهانه'], ['purchase', 'جمع کردن برای یک خرید']] },
  horizon: { t: 'کی به این پول نیاز داری؟', o: [['short', 'کمتر از یک سال'], ['mid', '۱ تا ۳ سال'], ['long', 'بیشتر از ۳ سال']] },
  drop: { t: 'اگر دارایی‌ات در یک ماه ۲۰٪ پایین بیاید', o: [['sell', 'می‌فروشم که بیشتر نریزد'], ['wait', 'صبر می‌کنم'], ['buy', 'بیشتر می‌خرم']] },
  income: { t: 'درآمدت', o: [['fixed', 'ثابت (مثل حقوق)'], ['variable', 'نامنظم (آزاد، کسب‌وکار)']] },
};
export const RISK = { low: 'کم', mid: 'متوسط', high: 'زیاد' };

/** Answered enough to use: the three questions that set the risk level. */
export const isSet = (p) => !!(p && p.goal && p.horizon && p.drop);

/** How much risk the answers allow: the lower of what the horizon and the reaction to a fall allow. */
export function riskLevel(p) {
  if (!isSet(p)) return null;
  const h = { short: 0, mid: 1, long: 2 }[p.horizon] ?? 1;
  const d = { sell: 0, wait: 1, buy: 2 }[p.drop] ?? 1;
  return ['low', 'mid', 'high'][Math.min(h, d)];
}

/** Months of spending to keep in cash: the owner's choice, or 6 (9 with an irregular income). */
export const emergencyMonths = (p) => (+p?.emergencyMonths > 0 ? +p.emergencyMonths : p?.income === 'variable' ? 9 : 6);

/**
 * The emergency fund: money that can be had within days without a market price swinging it — bank accounts and
 * deposits (a deposit can be broken). pf: E.portfolio(). spend: an amount about to leave that money (a purchase paid
 * from an account). null without a monthly expense.
 */
export function emergency(p, pf, spend = 0) {
  const expense = +p?.expense;
  if (!(expense > 0) || !pf) return null;
  // an overdrawn account counts against it (netted before the floor at zero)
  const have = Math.max(0, (pf.rows || []).filter((r) => !r.cat?.liability && (r.asset.category === 'bank' || r.asset.category === 'fixed')).reduce((t, r) => t + (r.signedValue ?? r.value ?? 0), 0) - Math.max(0, +spend || 0));
  const want = emergencyMonths(p);
  const months = have / expense;
  return { have, need: want * expense, months, want, short: Math.max(0, want * expense - have), ok: months >= want - 1e-9 };
}

/**
 * A common starting mix for the risk level, by Dara's categories (percent, sums to 100). A template the owner edits,
 * not a recommendation. Without crypto (a red line) its share goes to deposits.
 */
export const MIX = {
  low: { bank: 10, fixed: 45, gold: 25, fx: 15, stock: 5, crypto: 0 },
  mid: { bank: 5, fixed: 30, gold: 25, fx: 15, stock: 20, crypto: 5 },
  high: { bank: 5, fixed: 15, gold: 20, fx: 10, stock: 40, crypto: 10 },
};
/** The starting mix for a risk level, by category (percent; no crypto as a red line moves its share to deposits). */
export function mixFor(level, noCrypto = false) {
  const m = { ...MIX[level] };
  if (noCrypto && m.crypto) { m.fixed += m.crypto; m.crypto = 0; }
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v > 0));
}
export function suggestTargets(p) {
  const r = riskLevel(p);
  if (!r) return null;
  const m = { ...MIX[r] };
  if (p.noCrypto && m.crypto) { m.fixed += m.crypto; m.crypto = 0; }
  return Object.fromEntries(Object.entries(m).filter(([, v]) => v > 0));
}

/** The red lines that apply to buying `value` of something in `category` (share: its share of all assets after it). */
export function redLines(p, { category, share = null } = {}) {
  const out = [];
  if (!p) return out;
  if (p.noCrypto && category === 'crypto') out.push('در پروفایلت گفته‌ای رمزارز نمی‌خواهی');
  const max = +p.maxOne;
  if (max > 0 && share !== null && share > max / 100 + 1e-9) out.push(`بیشتر از سقف ${String(Math.round(max)).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[c])}٪ که در پروفایلت برای یک دارایی گذاشته‌ای`);
  return out;
}

/**
 * What the profile says about a purchase about to be saved: its red lines, and the emergency fund if the money comes
 * out of an account or deposit. value: Rial; spendFromCash: whether it is paid from a bank account or deposit.
 */
const fa = (x) => String(x).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[c]).replace(/\./g, '٫');
export function purchaseNotes(p, pf, { category, value, sameHeld = 0, funded = false, spendFromCash = false } = {}) {
  if (!p || !(value > 0) || !pf) return [];
  // paid from something already counted (any account or holding): the total stays the same; new money adds to it
  const gross = (pf.gross || 0) + (funded || spendFromCash ? 0 : value);
  const share = gross > 0 ? (sameHeld + value) / gross : null;
  const out = redLines(p, { category, share }).map((t) => ({ k: 'red', t, warn: true }));
  // money moved between accounts and deposits stays in the emergency fund
  if (spendFromCash && category !== 'bank' && category !== 'fixed') {
    const before = emergency(p, pf), after = emergency(p, pf, value);
    if (after && !after.ok) out.push({ k: 'emergency', warn: true, t: `بعد از این خرید، حساب‌ها و سپرده‌هایت ${fa((Math.floor(after.months * 10) / 10).toString())} ماه خرج است؛ کمتر از ${fa(after.want)} ماهی که برای پول اضطراری گذاشته‌ای${before && !before.ok ? ' (از قبل هم کمتر بود)' : ''}` });
  }
  return out;
}

/** A stock card the radar shows that moves a lot for a low-risk profile: daily swing ≥1.3× the market's middle, or a 35% fall within the year. */
export const tooRisky = (p, card) => riskLevel(p) === 'low' && card?.kind === 'stock' && ((card.volRel ?? 0) >= 1.3 || (card.m?.dd1y ?? 0) <= -0.35);

/** Lines for the assistant's instructions (labels only; the monthly expense only as a sentence about months). */
export function promptLines(p, pf, privacy = 'full') {
  if (!isSet(p)) return '';
  const label = (k) => QUESTIONS[k].o.find(([v]) => v === p[k])?.[1];
  const e = emergency(p, pf);
  const lines = [
    `هدف: ${label('goal')}${p.goal === 'purchase' && p.purchase ? ` (${String(p.purchase).slice(0, 60).replace(privacy === 'percent' ? /[\d۰-۹٬,.٫]+/g : /$^/, '…')})` : ''}`,
    `افق زمانی: ${label('horizon')}`, `واکنش به افت ۲۰٪: ${label('drop')}`, `سطح ریسک قابل‌قبول: ${RISK[riskLevel(p)]}`,
    p.income ? `درآمد: ${label('income')}` : null,
    e ? `پول اضطراری: حساب‌ها و سپرده‌ها حدود ${e.months.toFixed(1)} ماه خرج است؛ هدفش ${e.want} ماه${e.ok ? '' : ' (کمتر از هدف)'}` : null,
    p.noCrypto ? 'خط قرمز: رمزارز نه' : null, +p.maxOne > 0 ? `خط قرمز: بیشتر از ${Math.round(+p.maxOne)}٪ در یک دارایی نه` : null,
  ].filter(Boolean);
  return `پروفایل سرمایه‌گذاری کاربر (خودش جواب داده):\n${lines.map((l) => `- ${l}`).join('\n')}\nجواب‌هایت را با این پروفایل جور کن: ریسک هر گزینه را با سطح ریسک او بسنج، اگر پول اضطراری کم است اول همان را یادآوری کن، و خط قرمزها را رعایت کن. باز هم حکم خرید یا فروش نده.`;
}
