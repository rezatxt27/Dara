// «سبدساز» in words: a sentence → the builder's inputs (read here without AI, and by an AI connection when there is
// one), and the facts an AI connection gets to explain a result in plain Persian. The numbers always come from
// lib/builder.js; the AI only reads a sentence or explains numbers it is given. Pure.
import { parseNum, toEnDigits, WORD_NUM, WORD_SCALE } from './format.js';
import { CLASSES } from './builder.js';
import { RISK } from './profile.js';

export const HORIZONS = [6, 12, 24, 36];
/** The nearest horizon the builder offers (a tie goes to the shorter one: money needed sooner is the safer guess). */
export const nearestHorizon = (m) => HORIZONS.reduce((a, b) => (Math.abs(b - m) < Math.abs(a - m) ? b : a));

const norm = (t) => toEnDigits(String(t || '')).replace(/[‌‏‎]/g, ' ').replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/[،,؛;:!?؟()«»"]/g, ' ').replace(/\.(?!\d)/g, ' ');
const TIME = /^(?:ماه|ماهه|سال|ساله|روز|هفته)/;
// an amount in another currency can't be read as toman: «۲ میلیون دلار»
const FX_WORD = /^(?:دلار|دلاری|یورو|درهم|پوند|لیر|یوان|تتر|روبل|دینار|ین|فرانک|ریال ?عمان|بیت ?کوین)/;
const isNumTok = (w) => /^\d+(?:[.٫/]\d+)?$/.test(w) || w in WORD_NUM;
const numOf = (w) => (w in WORD_NUM ? WORD_NUM[w] : parseFloat(w.replace(/[٫/]/, '.')));

const CRYPTO = '(?:رمز ?ارز|رمزارزها|کریپتو|بیت ?کوین|ارز دیجیتال|ارزهای دیجیتال)';
const RE = {
  alone: /فقط (?:همین|این) (?:پول|مبلغ)|جدا از دارایی|بدون (?:در ?نظر ?گرفتن |حساب |احتساب )?(?:دارایی|بقیه)|مستقل از دارایی|بدون توجه به دارایی/,
  with: /(?:کنار|همراه|با|روی) (?:بقیه ی |بقیه )?دارایی/,
  low: /(?:ریسک|خطر)\s*(?:کم|پایین|خیلی کم)|کم ?ریسک|محتاط|بی ?ریسک|ریسک\s*(?:زیادی\s*|زیاد\s*|بالا\s*)?نمی|ریسک\s*(?:نه|نکنم)|نمی ?خوام ریسک|امن باشه|ضرر نکنم/,
  high: /(?:ریسک|خطر)\s*(?:زیاد|بالا|بیشتر)(?!\s*(?:نمی|نه|نخوا))|پر ?ریسک|جسور|ریسک ?پذیر(?!\s*نیستم)/,
  mid: /(?:ریسک|خطر)\s*(?:متوسط|معمولی|میانه)|متعادل|نه کم نه زیاد/,
  noCrypto: new RegExp(`${CRYPTO}\\s*(?:(?:رو|را|هم)\\s+)?(?:نه(?=\\s|$)|نمی|نخوا|ممنوع|نباشه|نذار|حذف)|(?:بدون|غیر از|به جز|جز)\\s*${CRYPTO}|(?:^|\\s)(?:نه|نمی ?خوام)\\s*${CRYPTO}`),
  yesCrypto: new RegExp(`${CRYPTO}\\s*(?:هم\\s*)?(?:باشه|بذار|بزار|می ?خوام|اوکیه|اشکال نداره)`),
};

/**
 * Read a sentence without AI: { amount (Rial), horizon, mode, risk, noCrypto, years } — each null when not said.
 * unit: how a bare amount is meant ('toman' unless the settings say Rial; «ریال» or «تومان» in the sentence wins).
 */
export function parseIntent(text, { unit = 'toman' } = {}) {
  const t = norm(text);
  const out = { amount: null, horizon: null, mode: null, risk: null, noCrypto: null, years: null, amountText: null, fxAmount: false, numbers: [] };
  const words = t.split(/\s+/).filter(Boolean);
  // amounts: runs of number words, digits, scales and «و»; the largest that has a scale (or is at least a million)
  let best = null;
  for (let i = 0; i < words.length; i++) {
    if (!(isNumTok(words[i]) || words[i] in WORD_SCALE)) continue;
    // a number right before «ماه/سال» starts a length of time, not more of the amount («نیم میلیارد یک سال»)
    const timeNext = (k) => isNumTok(words[k]) && TIME.test(words[k + 1] || '');
    let j = i; while (j < words.length && !(j > i && timeNext(j)) && (isNumTok(words[j]) || words[j] in WORD_SCALE || (words[j] === 'و' && j + 1 < words.length && !timeNext(j + 1) && (isNumTok(words[j + 1]) || words[j + 1] in WORD_SCALE)))) j++;
    const run = words.slice(i, j);
    const next = words[j] || '';
    const hasScale = run.some((w) => w in WORD_SCALE);
    // «دو سال» is a length of time; «۳ میلیون ماهی» is still money
    const isTime = !hasScale && TIME.test(next);
    if (!isTime) out.numbers.push(run.join(' ')); // every number that is not a time goes masked to an AI
    if (FX_WORD.test(next) || next === 'بیت') { if (hasScale || run.some((w) => /^\d/.test(w))) out.fxAmount = true; i = j - 1; continue; }
    const said = /^(?:ریال)/.test(next) ? 'rial' : /^(?:تومان|تومن|تومنه|تومانی)$/.test(next) ? 'toman' : null;
    if (!isTime && (hasScale || said)) {
      const v = parseNum(run.join(' '));
      if (v > 0) {
        const rial = (said || unit) === 'rial' ? v : v * 10;
        if (rial >= 1e6 && (!best || rial > best.rial)) best = { rial, text: run.join(' ') + (said ? ' ' + next : '') };
      }
    }
    i = j - 1;
  }
  if (best) { out.amount = Math.round(best.rial); out.amountText = best.text; }
  // horizon and the past: «۲ سال», «شش ماه», «یک سال و نیم», «۱۰ سال گذشته»
  for (let i = 0; i < words.length - 1; i++) {
    const w = words[i], u = words[i + 1];
    let n = null, k = 1;
    if (isNumTok(w)) n = numOf(w);
    else if (w === 'نیم' && /^سال/.test(u)) n = 0.5;
    if (n === null || !(n > 0)) continue;
    if (/^سال/.test(u)) k = 12; else if (!/^ماه/.test(u)) continue;
    if (words[i + 2] === 'و' && words[i + 3] === 'نیم') n += 0.5;
    const after = words.slice(i + 2, i + 5).join(' ');
    if (/^(?:و نیم )?(?:گذشته|اخیر|قبل|پیش)/.test(after)) { if (k === 12) out.years = n >= 8 ? 10 : 5; continue; }
    if (out.horizon === null) out.horizon = nearestHorizon(n * k);
  }
  if (out.horizon === null && /کوتاه ?مدت/.test(t)) out.horizon = 6;
  if (out.horizon === null && /بلند ?مدت/.test(t)) out.horizon = 36;
  if (out.horizon === null && /میان ?مدت/.test(t)) out.horizon = 24;
  if (RE.alone.test(t)) out.mode = 'alone'; else if (RE.with.test(t)) out.mode = 'with';
  if (RE.low.test(t)) out.risk = 'low'; else if (RE.mid.test(t)) out.risk = 'mid'; else if (RE.high.test(t)) out.risk = 'high';
  if (RE.yesCrypto.test(t)) out.noCrypto = false; else if (RE.noCrypto.test(t)) out.noCrypto = true;
  return out;
}

/** What was understood, as short Persian chips (amount is shown by the caller in the owner's unit). */
export function intentChips(it) {
  const out = [];
  if (it.horizon) out.push({ k: 'horizon', t: it.horizon >= 12 ? `${toFa(it.horizon / 12)} سال` : `${toFa(it.horizon)} ماه` });
  if (it.mode) out.push({ k: 'mode', t: it.mode === 'alone' ? 'فقط همین پول' : 'کنار دارایی‌هایم' });
  if (it.risk) out.push({ k: 'risk', t: `ریسک ${RISK[it.risk]}` });
  if (it.noCrypto === true) out.push({ k: 'noCrypto', t: 'بدون رمزارز' });
  if (it.noCrypto === false) out.push({ k: 'noCrypto', t: 'رمزارز هم باشد' });
  if (it.years) out.push({ k: 'years', t: `${toFa(it.years)} سال گذشته` });
  return out;
}
const toFa = (x) => String(x).replace(/\d/g, (c) => '۰۱۲۳۴۵۶۷۸۹'[c]).replace('.', '٫');

/** The sentence for an AI connection: the amount, when it was read here, is replaced by a placeholder. */
export function maskedSentence(text, it) {
  let t = norm(text).replace(/\s+/g, ' ').trim();
  // every number that is not a length of time, longest first (the amount, a monthly saving, a bare «200000000»)
  for (const n of [...(it?.numbers || [])].sort((a, b) => b.length - a.length)) t = t.split(n).join('[عدد]');
  return t.replace(/\d[\d\s]{2,}\d|\d{3,}/g, '[عدد]');
}

export function intentSystem() {
  return `تو جملهٔ کاربر دربارهٔ سرمایه‌گذاری یک مبلغ را به ورودی‌های یک «سبدساز» تبدیل می‌کنی. فقط یک شیء JSON برگردان، بدون توضیح:
{"amount_toman": عدد یا null, "months": عدد یا null, "mode": "with" | "alone" | null, "risk": "low" | "mid" | "high" | null, "no_crypto": true | false | null, "past_years": 5 | 10 | null, "question": رشته یا null}
- amount_toman: عددها پیش از ارسال با «[عدد]» پوشانده شده‌اند؛ مبلغ را null بگذار مگر با کلمه گفته شده باشد (مثلاً «نصف یک میلیارد»)؛ آن‌وقت به تومان.
- months: چند ماه پول را لازم ندارد («تا عید»، «سال دیگه»، «دو سال» → عدد ماه).
- mode: "alone" اگر گفته فقط همین پول یا جدا از بقیهٔ دارایی؛ "with" اگر گفته کنار دارایی‌هایش؛ وگرنه null.
- risk: میزان ریسکی که می‌پذیرد («نمی‌خوام ضرر کنم» = low، «متعادل» = mid، «جسور/پرریسک» = high).
- no_crypto: true اگر رمزارز/بیت‌کوین نمی‌خواهد، false اگر صریحاً می‌خواهد.
- past_years: اگر گفته با ۱۰ یا ۵ سال گذشته بسنج.
- چیزی که گفته نشده null است؛ حدس نزن. اگر جمله ربطی به سرمایه‌گذاری ندارد، همه null و در question یک سؤال کوتاه فارسی بپرس.`;
}
export const intentPrompt = (sentence) => `جملهٔ کاربر: «${String(sentence).slice(0, 400)}»`;

/** An AI answer, checked: the same shape as parseIntent (amount in Rial). */
export function cleanIntent(j) {
  const o = { amount: null, horizon: null, mode: null, risk: null, noCrypto: null, years: null, question: null };
  if (!j || typeof j !== 'object') return o;
  const a = +j.amount_toman; if (a > 0 && isFinite(a)) o.amount = Math.round(a * 10);
  const m = +j.months; if (m > 0 && m < 600) o.horizon = nearestHorizon(m);
  if (j.mode === 'with' || j.mode === 'alone') o.mode = j.mode;
  if (RISK[j.risk]) o.risk = j.risk;
  if (typeof j.no_crypto === 'boolean') o.noCrypto = j.no_crypto;
  if (+j.past_years === 10 || +j.past_years === 5) o.years = +j.past_years;
  if (typeof j.question === 'string' && j.question.trim()) o.question = j.question.trim().slice(0, 200);
  return o;
}

/** Both readings together: the amount read here wins (digits are exact); for the rest the AI reads more. */
export function mergeIntent(local, ai) {
  if (!ai) return local;
  const pick = (k) => (ai[k] !== null && ai[k] !== undefined ? ai[k] : local[k]);
  return { ...local, amount: local.amount ?? ai.amount, horizon: pick('horizon'), mode: pick('mode'), risk: pick('risk'), noCrypto: pick('noCrypto'), years: pick('years'), question: ai.question || null };
}

/* ---------------- «برام توضیح بده» ---------------- */
const p0 = (x) => (x === null || x === undefined || !isFinite(x) ? null : Math.round(x * 100));

/** The result in percentages only — no amounts — for an AI connection to explain. */
export function explainFacts(r, { pick = null } = {}) {
  if (!r?.cands?.length) return null;
  return {
    period: { from: r.from, to: r.to, months: r.months, past_years: r.years },
    horizon_months: r.horizon,
    mode: r.mode === 'with' ? 'کنار بقیهٔ دارایی‌ها (عددها برای کل دارایی قابل‌مدل)' : 'فقط همین پول',
    deposit: { rate_pct: r.depositPct, gain_over_horizon_pct: p0(r.depositGain) },
    risk: r.level ? { level: RISK[r.level], from: r.levelFrom === 'sentence' ? 'جملهٔ کاربر' : 'پروفایل کاربر' } : 'نامشخص',
    no_crypto: !!r.noCrypto,
    each_alone_yearly_pct: Object.fromEntries(r.each.map((e) => [e.name, p0(e.cagr)])),
    picked: pick || null,
    portfolios: r.cands.map((c) => ({
      name: c.name, fits_risk: !!c.fits,
      mix_pct: Object.fromEntries(CLASSES.filter((k) => (c.weights[k.id] || 0) >= 0.005).map((k) => [k.short, p0(c.weights[k.id])])),
      yearly_return_pct: p0(c.metrics?.cagr), yearly_in_dollars_pct: p0(c.metrics?.usdCagr),
      worst_fall_pct: p0(c.metrics?.maxDD), months_below_peak: c.metrics?.under ?? null, worst_12_months_pct: p0(c.metrics?.worst12),
      beat_deposit_share_pct: c.metrics?.beat === null || c.metrics?.beat === undefined ? null : p0(c.metrics.beat),
      after_horizon_pct: c.range ? { bad: p0(c.range.badPct), typical: p0(c.range.midPct), good: p0(c.range.goodPct), typical_in_dollars: p0(c.range.midUsdPct) } : null,
      if_dollar_up_50_pct: p0(c.stress?.usdUp), if_bourse_down_30_pct: p0(c.stress?.bourseDown),
    })),
  };
}

export function explainSystem() {
  return `تو نتیجهٔ یک «سبدساز» را برای کسی که اصطلاحات مالی را نمی‌داند، به فارسی ساده و خودمانی توضیح می‌دهی. داده‌ها نتیجهٔ امتحان چند سبد روی گذشتهٔ واقعی بازار ایران است (به درصد).
فقط یک شیء JSON برگردان: {"summary": "دو جملهٔ اصلی", "points": ["۳ تا ۵ نکتهٔ کوتاه"], "watch": "یک جمله: مهم‌ترین چیزی که باید حواسش باشد"}
قواعد:
- فقط از عددهای همین داده استفاده کن؛ عدد نساز و مبلغ ننویس (فقط درصد). درصدها را با رقم فارسی و علامت ٪ بنویس.
- بگو کدام سبد با ریسک او جور است (fits_risk) و چرا؛ فرق بازده و «بدترین افت» را با یک مثال ساده بگو (مثلاً «یعنی یک‌جا از هر ۱۰۰ تومان، X تومانش موقتاً کم شد»).
- بگو چقدر از رشد فقط به خاطر پایین آمدن ارزش ریال است (مقایسهٔ yearly_return با yearly_in_dollars) و هر سبد در چند درصد دوره‌ها از سپرده جلو زده.
- اگر picked داده شده، تمرکز روی همان سبد باشد و با بقیه مقایسه‌اش کن.
- اصطلاح فنی ننویس؛ اگر لازم شد، همان‌جا در یک عبارت معنی کن.
- حکم خرید و فروش نده؛ یادآوری کن گذشته تضمین آینده نیست (یک بار، کوتاه).`;
}
export const explainPrompt = (facts) => `نتیجهٔ سبدساز:\n${JSON.stringify(facts)}`;

/** An AI explanation, checked; null when there is nothing to show. */
export function cleanExplain(j) {
  if (!j || typeof j !== 'object') return null;
  const str = (x, n) => (typeof x === 'string' ? x.trim().slice(0, n) : '');
  const summary = str(j.summary, 600);
  const points = (Array.isArray(j.points) ? j.points : []).map((x) => str(x, 400)).filter(Boolean).slice(0, 6);
  const watch = str(j.watch, 400);
  return summary || points.length ? { summary, points, watch } : null;
}
