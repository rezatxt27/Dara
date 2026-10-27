// Explanations and decision helpers built on the engine. Pure functions; all money is Rial.
//  - explainAsset / explainNet / explainChange: «این عدد از کجا آمد؟»
//  - performance: «واقعاً پولدارتر شدم؟» — market return net of money moved, against gold / dollar / deposit
//  - breakEven: how far an asset must rise to beat a deposit
//  - allocateNew: where new money goes to move toward the target mix (no selling)
//  - critiqueFacts: percent-only facts for the AI portfolio review
import * as E from './engine.js';
import { CAT, EXPOSURES, LIQUIDITY, TGJU_BY_KEY, NOBITEX_BY_KEY, PROVIDERS } from './catalog.js';
import { todayIso, daysBetween, isoFromDate, fmtJ, addDaysIso } from './jalali.js';
import { num, pct, qName } from './format.js';

/**
 * Money moved during an attribution's period, dated (per asset; internal transfers cancel out), and the modified-Dietz
 * base: the starting net worth plus each amount weighted by the part of the period it was there. A return over this
 * base is not inflated (or deflated) by money added or taken out during the period.
 */
export function flowEntries(at, today = todayIso()) {
  const clamp = (iso) => (iso < at.from ? at.from : iso > today ? today : iso);
  const entries = [];
  for (const r of at.rows) for (const m of r.moves || []) entries.push({ date: clamp(m.date || today), amount: m.amount });
  const moneyIn = at.total - at.market;
  const listed = entries.reduce((x, e) => x + e.amount, 0);
  if (Math.abs(moneyIn - listed) >= 1) entries.push({ date: today, amount: moneyIn - listed }); // keeps the books balanced
  return entries;
}
export function dietzBase(at, today = todayIso(), entries = flowEntries(at, today)) {
  const T = Math.max(1, daysBetween(at.from, today));
  const weight = (iso) => Math.min(1, Math.max(0, daysBetween(iso, today) / T));
  return at.base + entries.reduce((x, e) => x + e.amount * weight(e.date), 0);
}
/** The market's effect over an attribution as a share of the money that was there (Dietz); |start| when that is ≤ 0. */
export function movePct(at, today = todayIso()) {
  const d = dietzBase(at, today);
  if (d > 0) return at.market / d;
  const b = Math.abs(at.base) || 0;
  return b ? at.market / b : 0;
}

/**
 * How much the market moved your net worth over `days` (money you added, moved or recorded is left out), plus the raw
 * total. One definition used by the dashboard («امروز»، «۷ روز»، «۳۰ روز» and «چرا تغییر کرد؟»), the popup and the badge.
 * `from`: the saved day it is measured from; `stale`: that day is older than the period says (the browser was closed),
 * so the label should name the date. Falls back to today's live price moves when nothing is saved yet.
 */
export function marketMove(st, pf, days = 1, today = todayIso()) {
  const att = E.attribution(st.assets, st.quotes, st.settings, st.snapshots, st.events, days, today, pf);
  const live = { abs: pf.dayChange, pct: pf.dayChangePct, total: null, moved: 0, live: true, from: null, stale: false };
  if (!att) return days === 1 ? live : null;
  // a longer view whose start is far older than its label says nothing honest
  if (days > 1 && daysBetween(att.from, today) > days + 3) return null;
  // what the number is measured from: that day's last record (its time), rebuilt or not, and the assets whose price
  // there was already old — their move since then lands here in one go
  const late = att.rows.filter((r) => r.since && Math.abs(r.market) >= 1).map((r) => ({ id: r.id, name: r.asset?.name || '—', since: r.since, market: r.market }));
  return { abs: att.market, pct: movePct(att, today), total: att.total, moved: att.total - att.market, from: att.from,
    stale: att.from < E.addDaysIso(today, -days), est: !!att.est, baseAt: !att.est && att.snap?.at > 0 ? att.snap.at : null, late, at: att };
}

/** «از دیروز ساعت ۲۲:۴۰» — what a change is measured from, in words (null when it can't be said). */
export function baseLabel(mv, today = todayIso(), hm = (ms) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; }) {
  if (!mv || mv.live) return null;
  const when = mv.from === E.addDaysIso(today, -1) ? 'دیروز' : fmtJ(mv.from, 'dm');
  if (mv.est) return `از ${when} (تخمینی)`;
  return mv.baseAt ? `از ${when} ساعت ${hm(mv.baseAt)}` : `از ${when}`;
}

const MODE_NAME = { payout: 'روزشمار، سود ماهانه واریز می‌شود', compound: 'روزشمار مرکب (نرخ = بازده مؤثر سالانه)', simple: 'روزشمار ساده' };
const basisName = (b) => (b === 'actual' ? 'طول واقعی سال شمسی' : `${b || 365} روز`);

export function refText(ref) {
  if (!ref) return '';
  const p = ref.provider === 'nobitex' && ref.src === 'bitpin' ? 'بیت‌پین' : PROVIDERS[ref.provider]?.name || ref.provider;
  const name = ref.provider === 'tgju' ? TGJU_BY_KEY[ref.key]?.name || ref.key
    : ref.provider === 'nobitex' ? NOBITEX_BY_KEY[ref.key]?.name || ref.name || String(ref.sym || ref.key).toUpperCase()
    : ref.label || ref.symbol || ref.name || ref.key;
  return `${p}، ${name}`;
}

/* ------------------------------------------------------------------ explain ------------------------------------------------------------------ */
/**
 * Step-by-step breakdown of one asset's value.
 * lines: [{ t: label, v: number|string, k: 'money'|'usd'|'qty'|'pct'|'num'|'text'|'date', unit?, at?, strong?, total?, sign? }]
 */
export function explainAsset(a, quotes = {}, settings = {}, now = Date.now()) {
  const v = E.valueOf(a, quotes, settings, now);
  const lines = []; const notes = []; let formula = '';
  const liab = E.isLiability(a);
  if (a.mode === 'units') {
    lines.push({ t: 'مقدار', v: +a.quantity || 0, k: 'qty', unit: a.unit || '' });
    const p = a.price || {};
    if (p.source === 'market' && p.ref) {
      const u = E.unitPriceOf(a, quotes);
      if (u.q && u.q.price > 0 && !u.fallback) {
        lines.push({ t: `قیمت بازار (${refText(p.ref)})`, v: u.q.price, k: u.usd ? 'usd' : 'money', at: u.q.at || u.q.fetchedAt, pub: true });
        if (u.usd) lines.push({ t: 'ضرب در نرخ دلار', v: E.usdRate(quotes), k: 'money', pub: true });
        if (u.q.approx) notes.push(u.q.note || 'قیمت تقریبی است (قیمت جهانی × نرخ دلار).');
      } else {
        lines.push({ t: 'آخرین قیمت معتبر (با ضریب و تعدیل)', v: u.price, k: 'money', at: p.last?.at, pub: true });
        notes.push(v.error || 'قیمت آنلاین در دسترس نبود.');
      }
      if (!u.fallback) {
        if ((+p.factor || 1) !== 1) lines.push({ t: 'ضریب تبدیل واحد', v: +p.factor, k: 'num' });
        if (+p.adjustPct) lines.push({ t: 'تعدیل قیمت (مثلاً اجرت یا کارمزد)', v: +p.adjustPct / 100, k: 'pct', sign: true });
      }
      lines.push({ t: 'قیمت هر واحد', v: u.price, k: 'money', strong: true, pub: true });
    } else {
      lines.push({ t: 'قیمت هر واحد (دستی)', v: +p.value || 0, k: 'money', at: p.updatedAt, strong: true });
    }
    formula = 'ارزش = مقدار × قیمت هر واحد';
  } else if (a.mode === 'rate') {
    const r = a.rate || {};
    const P = +r.principal || 0;
    const today = todayIso();
    const end = r.maturity && r.maturity < today ? r.maturity : today;
    lines.push({ t: 'اصل سرمایه', v: P, k: 'money' });
    lines.push({ t: 'نرخ سود سالانه', v: (+r.annualPct || 0) / 100, k: 'pct' });
    lines.push({ t: 'روش محاسبه', v: MODE_NAME[r.mode] || MODE_NAME.payout, k: 'text' });
    if (r.mode !== 'compound') lines.push({ t: 'مبنای روز سال', v: basisName(r.basis), k: 'text' });
    if (r.start) lines.push({ t: 'شروع', v: r.start, k: 'date' });
    if (r.maturity) lines.push({ t: 'سررسید', v: r.maturity, k: 'date' });
    if (r.mode === 'payout' || !r.mode) {
      const since = r.start ? E.payoutSince(r, end) : null;
      if (since) lines.push({ t: 'سود از آخرین واریز ماهانه', v: since, k: 'date', sub: `${Math.max(0, daysBetween(since, end))} روز` });
      formula = 'ارزش = اصل + سود روزهای بعد از آخرین واریز ماهانه (اصل × نرخ × روزها ÷ مبنا)';
    } else {
      if (r.start) lines.push({ t: 'روزهای سپری‌شده', v: Math.max(0, daysBetween(r.start, end)), k: 'num', unit: 'روز' });
      formula = r.mode === 'compound' ? 'ارزش = اصل × (۱ + نرخ) به توان (روزها ÷ ۳۶۵)' : 'ارزش = اصل × (۱ + نرخ × روزها ÷ مبنا)';
    }
    lines.push({ t: liab ? 'بهره انباشته (به بدهی اضافه می‌شود)' : 'سود انباشته', v: v.value - P, k: 'money', sign: !liab });
    lines.push({ t: liab ? 'بهره هر روز' : 'سود هر روز', v: E.rateDaily(r, v.value), k: 'money' });
  } else if (a.mode === 'loan') {
    const L = a.loan || {}; const st = E.loanState(L, todayIso(), now);
    lines.push({ t: liab ? 'مبلغ وام' : 'مبلغ قرض', v: st.P, k: 'money' });
    lines.push({ t: 'نرخ سود سالانه', v: (+L.annualPct || 0) / 100, k: 'pct' });
    lines.push({ t: 'مبلغ هر قسط', v: st.A, k: 'money' });
    lines.push({ t: 'اقساط پرداخت‌شده', v: `${num(st.paid + st.before)} از ${num(st.n + st.before)}`, k: 'text' });
    if (st.done) { lines.push({ t: 'وضعیت', v: 'تسویه شده', k: 'text' }); formula = 'تسویه شده؛ دیگر از ارزش خالص کم نمی‌شود'; }
    else {
      lines.push({ t: 'مانده اصل بعد از آخرین قسط', v: st.owed, k: 'money' });
      lines.push({ t: liab ? 'سود (بهره) این دوره تا این لحظه' : 'سود این دوره تا این لحظه', v: st.accrued, k: 'money', sub: st.prev ? `از ${fmtJ(st.prev, 'dm')}` : null });
      lines.push({ t: 'قسط بعدی', v: st.next.date, k: 'date', sub: `سهم سود از قسط: ${num(Math.round(st.next.interest / st.next.payment * 100))}٪` });
      formula = 'مبلغ = مانده اصل + سود روزهای گذشته از آخرین قسط (مانده × نرخ ماهانه × روزها ÷ روزهای ماه)';
      notes.push(`قسط = اصل × نرخ ماهانه ÷ (۱ − (۱ + نرخ ماهانه) به توان منفی تعداد اقساط)؛ نرخ ماهانه = نرخ سالانه ÷ ۱۲.`);
    }
  } else {
    lines.push({ t: liab ? 'مبلغ ثبت‌شده' : 'مانده ثبت‌شده', v: +a.balance || 0, k: 'money', at: a.balanceAt || a.updatedAt });
    if (a.interest?.on) {
      lines.push({ t: liab ? 'نرخ بهره روزشمار' : 'نرخ سود روزشمار', v: (+a.interest.annualPct || 0) / 100, k: 'pct' });
      lines.push({ t: liab ? 'بهره انباشته تا این لحظه' : 'سود انباشته تا این لحظه', v: v.accrued, k: 'money', sign: !liab });
      formula = 'ارزش = مانده + سود روزشمار انباشته (هر ماه به مانده اضافه می‌شود)';
    } else formula = 'ارزش = همان مانده‌ای که ثبت کرده‌ای';
  }
  lines.push({ t: liab ? 'مبلغ بدهی' : 'ارزش', v: v.value, k: 'money', total: true });
  if (liab) notes.push('بدهی است و از ارزش خالص کم می‌شود.');
  if (v.pnl !== null) {
    lines.push({ t: 'بهای تمام‌شده', v: +a.costBasis, k: 'money' });
    lines.push({ t: 'سود / زیان', v: v.pnl, k: 'money', sign: true, sub: v.ret !== null ? { pct: v.ret } : null });
  }
  if (v.status === 'stale') notes.push(`بیش از ${E.remindDaysFor(a, settings)} روز به‌روز نشده.`);
  return { lines, formula, notes, value: v.value, status: v.status };
}

/** How the net worth is made up. */
export function explainNet(pf) {
  const lines = [];
  for (const c of pf.cats.filter((c) => !c.liability)) lines.push({ t: c.name, v: c.value, k: 'money', color: c.color });
  lines.push({ t: 'جمع دارایی‌ها', v: pf.gross, k: 'money', strong: true });
  for (const c of pf.cats.filter((c) => c.liability)) lines.push({ t: c.name, v: -c.value, k: 'money', sign: true, color: c.color });
  lines.push({ t: 'ارزش خالص', v: pf.net, k: 'money', total: true });
  const count = (f) => pf.rows.filter(f).length;
  const live = count((r) => r.status === 'live' || r.status === 'auto');
  const manual = count((r) => r.status === 'manual');
  const attention = pf.attention.length;
  const notes = [`${live} دارایی خودکار به‌روز می‌شود (قیمت بازار یا سود روزشمار)، ${manual} دارایی با مقدار دستی${attention ? `، ${attention} مورد نیاز به بررسی دارد` : ''}.`];
  return { lines, formula: 'ارزش خالص = جمع دارایی‌ها − بدهی‌ها', notes };
}

/** Breakdown of a change over `days` (from the attribution), or of today's live move when there is no snapshot yet. */
export function explainChange(st, days, pf, today = todayIso()) {
  const at = E.attribution(st.assets, st.quotes, st.settings, st.snapshots, st.events, days, today, pf);
  if (!at && days > 1) {
    return { lines: [], formula: '', notes: [`برای مقایسه ${days} روزه هنوز تاریخچه کافی ذخیره نشده. نمودار از امروز خودکار پر می‌شود، یا از صفحه اصلی «ساخت نمودار از قیمت‌های گذشته» را بزن.`] };
  }
  if (!at) {
    // no snapshot yet: today's live move from quotes and daily interest
    const top = pf.rows.filter((r) => Math.abs(r.dayChange) >= 1).sort((a, b) => Math.abs(b.dayChange) - Math.abs(a.dayChange));
    const lines = top.slice(0, 6).map((r) => ({ t: r.asset.name, v: r.dayChange, k: 'money', sign: true }));
    const rest = top.slice(6).reduce((x, r) => x + r.dayChange, 0);
    if (Math.abs(rest) >= 1) lines.push({ t: `${top.length - 6} دارایی دیگر`, v: rest, k: 'money', sign: true });
    lines.push({ t: 'تغییر امروز', v: pf.dayChange, k: 'money', sign: true, total: true });
    return { lines, formula: 'تغییر روزانه قیمت هر دارایی بازار + سود روزانه سپرده‌ها', notes: ['هنوز عکس‌فوری دیروز ذخیره نشده؛ این عدد از تغییر روزانه قیمت‌ها حساب شده.'] };
  }
  const other = at.total - at.market - at.external - at.edits;
  const lines = [
    { t: 'ارزش خالص در مبدأ', v: at.base, k: 'money', sub: at.from, subK: 'date' },
    { t: 'اثر قیمت بازار و سود', v: at.market, k: 'money', sign: true, strong: true },
    { t: 'واریز و برداشت', v: at.external, k: 'money', sign: true },
    { t: 'ثبت، ویرایش یا حذف دستی', v: at.edits, k: 'money', sign: true },
    ...(Math.abs(other) >= 1 ? [{ t: 'جابه‌جایی با دارایی‌های تازه', v: other, k: 'money', sign: true }] : []),
    { t: 'ارزش خالص الان', v: at.now, k: 'money', total: true },
  ];
  const drivers = at.rows.filter((r) => Math.abs(r.market) >= 1).slice(0, 5).map((r) => ({ t: r.asset?.name || 'دارایی حذف‌شده', v: r.market, k: 'money', sign: true, ...(r.since ? { sub: `از ${fmtJ(r.since, 'dm')}` } : {}) }));
  const notes = [];
  if (at.est) notes.push('مبنای مقایسه بازسازی‌شده (تخمینی) است.');
  else if (at.snap?.at > 0) { const d = new Date(at.snap.at); notes.push(`مبنا: آخرین ثبتِ ${fmtJ(at.from, 'dm')}، ساعت ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}. هر بار که دارا قیمت‌ها را می‌گیرد، عدد آن روز به‌روز می‌شود.`); }
  const late = at.rows.filter((r) => r.since && Math.abs(r.market) >= 1);
  if (late.length) notes.push(`${late.slice(0, 3).map((r) => qName(r.asset?.name)).join('، ')}${late.length > 3 ? ' و …' : ''} در مبنا قیمت قدیمی داشت؛ تغییرش از ${fmtJ(late.map((r) => r.since).sort()[0], 'dm')} یک‌جا در این عدد آمده.`);
  if (days === 1) notes.push('ریز تغییر هر دارایی: صفحه دارایی‌ها، ستون «امروز».');
  return { lines, drivers, formula: 'تغییر = اثر بازار + پولی که وارد یا خارج شد + ویرایش‌های دستی', notes, at };
}

/* ------------------------------------------------------------ performance ------------------------------------------------------------ */
function rateAt(snaps, keys, field, iso) {
  // latest snapshot on/before iso carrying the rate; else the earliest one after it
  let lo = 0, hi = keys.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (keys[m] <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
  for (let i = ans; i >= 0; i--) if (snaps[keys[i]]?.[field] > 0) return snaps[keys[i]][field];
  for (let i = Math.max(0, ans + 1); i < keys.length; i++) if (snaps[keys[i]]?.[field] > 0) return snaps[keys[i]][field];
  return null;
}

/**
 * «واقعاً پولدارتر شدم؟» over the last `days` days (0 = since the first snapshot).
 * Money you added or took out (salary, deposits, new assets, edits) is separated from what the market earned,
 * and the same money is replayed into three alternatives: all in 18k gold, all in dollars, all in a deposit.
 */
export function performance(st, days, { depositPct = 25, inflationPct = defaultInflationPct(st), today = todayIso(), pf = null, now = Date.now() } = {}) {
  pf = pf || E.portfolio(st.assets, st.quotes, st.settings);
  const keys = Object.keys(st.snapshots || {}).sort();
  if (!keys.length) return null;
  // A period longer than the recorded history falls back to the whole history (flagged as partial).
  const whole = Math.max(1, daysBetween(keys[0], today));
  const partial = !!days && days > whole;
  const span = !days || partial ? whole : days;
  const at = E.attribution(st.assets, st.quotes, st.settings, st.snapshots, st.events, span, today, pf);
  if (!at) return null;
  const T = Math.max(1, daysBetween(at.from, today));
  const entries = flowEntries(at, today);
  const moneyIn = at.total - at.market;
  const denom = dietzBase(at, today, entries);
  const ret = denom > 0 ? at.market / denom : null;
  const rates = E.denomRates(st.quotes);
  const growth = {
    gold: rates.gold ? (iso) => { if (iso >= today) return 1; const r0 = rateAt(st.snapshots, keys, 'gold', iso); return r0 ? rates.gold / r0 : null; } : null,
    usd: rates.usd ? (iso) => { if (iso >= today) return 1; const r0 = rateAt(st.snapshots, keys, 'usd', iso); return r0 ? rates.usd / r0 : null; } : null,
    // monthly interest re-deposited (what a deposit can earn if payouts are put back)
    deposit: (iso) => depositGrowth(depositPct, daysBetween(iso, today) * 12 / 365),
  };
  const NAMES = { gold: 'اگر همه را طلای ۱۸ عیار نگه داشته بودی', usd: 'اگر همه را دلار نگه داشته بودی', deposit: `اگر همه در سپرده ${depositPct}٪ بود` };

  const bench = [];
  for (const id of at.base > 0 ? ['gold', 'usd', 'deposit'] : []) {
    const g = growth[id]; if (!g) continue;
    const g0 = g(at.from); if (!g0) continue;
    let end = at.base * g0; let ok = true;
    for (const e of entries) { const ge = g(e.date); if (!ge) { ok = false; break; } end += e.amount * ge; }
    if (!ok) continue;
    bench.push({ id, name: NAMES[id], short: { gold: 'طلا', usd: 'دلار', deposit: 'سپرده' }[id], end, diff: pf.net - end, ret: g0 - 1 });
  }
  const annual = ret !== null && T >= 60 && ret > -1 ? Math.pow(1 + ret, 365 / T) - 1 : null;
  const onAssets = assetsReturn(at, pf, today);
  const real = realReturn(ret, T, inflationPct);
  return { from: at.from, days: T, partial, est: at.est, base: at.base, end: pf.net, moneyIn, market: at.market, ret, annual, bench, depositPct,
    // with debts, the return on your own money (ret) is the return on assets made larger (or smaller) by what was borrowed
    retAssets: onAssets?.ret ?? null, marketAssets: onAssets?.market ?? null, debt: onAssets ? onAssets.debt : 0,
    inflationPct, real };
}

/* ------------------------------------------------------------ ranking ------------------------------------------------------------ */
/** A price on a day from a daily series [[iso, price]] (ascending): the last one on/before the day, else the first after;
 *  on or after today, `now` when given (the live price). */
export function priceOn(points, now = null, today = todayIso()) {
  const pts = (points || []).filter((p) => p && p[1] > 0);
  // a live price far from the series' last one is in another unit (or wrong): the series is trusted
  if (now > 0 && pts.length && Math.abs(now / pts[pts.length - 1][1] - 1) > 0.3) now = null;
  // a day before the series begins has no price (a week's slack: holidays, a first record a few days late) — a market
  // measured over a shorter stretch than the others would be ranked unfairly
  const first = pts.length ? addDaysIso(pts[0][0], -7) : null;
  return (iso) => {
    if (now > 0 && iso >= today) return now;
    if (!pts.length || iso < first) return null;
    let lo = 0, hi = pts.length - 1, ans = -1;
    while (lo <= hi) { const m = (lo + hi) >> 1; if (pts[m][0] <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
    return ans >= 0 ? pts[ans][1] : pts[0][1];
  };
}
/** Round-trip cost of buying and later selling, roughly (percent): what holding that market really costs. */
export const MARKET_COST = { gold: 1.5, coin: 2, usd: 1, silver: 3, btc: 0.5, index: 1.25, deposit: 0 };
const MARKETS = [
  ['silver', 'نقره'], ['gold', 'طلای ۱۸ عیار'], ['coin', 'سکه امامی'], ['usd', 'دلار آزاد'], ['btc', 'بیت‌کوین'], ['index', 'شاخص کل بورس'], ['deposit', 'سپرده'],
];
/** Which market stands for each kind of asset in a mix (property and «other» have none). */
const CAT_MARKET = { gold: 'gold', gold_online: 'gold', fx: 'usd', crypto: 'btc', stock: 'index', private: 'index', metal: 'silver', bank: 'deposit', fixed: 'deposit', receivable: 'deposit' };
const EXP_MARKET = { rial: 'deposit', gold: 'gold', fx: 'usd', equity: 'index', crypto: 'btc', commodity: 'silver' };
// Rial in an account without day-count interest: it earned nothing, unlike a deposit
const isCash = (a) => a.category === 'bank' && !(a.mode === 'balance' && a.interest?.on);

/**
 * «رتبهٔ تو بین بازارها»: the same money, on the same days, in each market — against what your mix really did.
 * Each row's return is measured like yours (the market's effect over the money that was there, Dietz), so the order by
 * return is the order by what you'd have now. Rows: markets (silver, 18k gold, coin, dollar, bitcoin, total index,
 * deposit at your rate), mixes (your own target mix; a simple third gold / dollar / deposit) and the inflation line.
 * series: { silver, btc, index } daily [[iso, price]] fetched by the page (a market without one is left out, and said so).
 * costs: take each market's usual round-trip cost off. Returns null without history.
 */
export function ranking(st, days, { depositPct = 25, inflationPct = defaultInflationPct(st), series = {}, costs = false, today = todayIso(), pf = null } = {}) {
  pf = pf || E.portfolio(st.assets, st.quotes, st.settings);
  const P = periodOf(st, days, pf, today);
  if (!P) return null;
  const { at, entries, T, keys } = P;
  const moneyIn = at.total - at.market;
  const denom = dietzBase(at, today, entries);
  if (!(denom > 0)) return null;
  const rates = E.denomRates(st.quotes);
  // the same for Dara's own records: a rate only from the first saved day that has it
  const firstWith = (field) => keys.find((k) => st.snapshots[k]?.[field] > 0) || null;
  const snapRate = (field, now) => { const f0 = firstWith(field); return (iso) => (iso >= today && now > 0 ? now : !f0 || iso < addDaysIso(f0, -7) ? null : rateAt(st.snapshots, keys, field, iso)); };
  const liveQ = (id) => { const q = st.quotes?.[id]; return q?.price > 0 && !q.error ? q.price : null; };
  const price = {
    gold: rates.gold ? snapRate('gold', rates.gold) : null,
    coin: rates.coin ? snapRate('coin', rates.coin) : null,
    usd: rates.usd ? snapRate('usd', rates.usd) : null,
    silver: series.silver?.length ? priceOn(series.silver, liveQ('tgju:silver_999'), today) : null,
    btc: series.btc?.length ? priceOn(series.btc, liveQ('nobitex:btc'), today) : null,
    index: series.index?.length ? priceOn(series.index, null, today) : null,
  };
  const growth = {};
  for (const [k, f] of Object.entries(price)) if (f) growth[k] = (a, b) => { const pa = f(a), pb = f(b); return pa > 0 && pb > 0 ? pb / pa : null; };
  growth.deposit = (a, b) => depositGrowth(depositPct, Math.max(0, daysBetween(a, b)) * 12 / 365);
  const inflG = (a, b) => Math.pow(1 + inflationPct / 100, Math.max(0, daysBetween(a, b)) / 365);
  // a mix bought on each day money came in and held (not rebalanced)
  const mixGrowth = (w) => (a, b) => { let s = 0; for (const [k, x] of Object.entries(w)) { const g = growth[k]?.(a, b); if (g === null || g === undefined) return null; s += x * g; } return s; };
  // the same money: the start on the first day, each later amount on its own day
  const replay = (g, to = today) => {
    let end = at.base * (g(at.from, to) ?? NaN);
    for (const e of entries) if (e.date <= to) end += e.amount * (g(e.date, to) ?? NaN);
    return end;
  };
  const rows = [];
  const add = (id, name, g, kind, extra = {}) => {
    const end0 = replay(g);
    if (!isFinite(end0)) return false;
    const cost = costs && extra.cost ? extra.cost / 100 : 0;
    const end = end0 - Math.max(0, end0) * cost;
    const own = g(at.from, today);
    rows.push({ id, name, kind, end, ret: (end - at.base - moneyIn) / denom, own: own !== null ? own - 1 : null, diff: pf.net - end, g, ...extra });
    return true;
  };
  // a market without a history, or whose history doesn't reach back to the start, is named instead of ranked
  const missing = [];
  for (const [id, name] of MARKETS) if (!growth[id] || !add(id, id === 'deposit' ? `سپرده ${num(depositPct, 1)}٪` : name, growth[id], 'market', { cost: MARKET_COST[id] })) { missing.push(name); delete growth[id]; }
  // the owner's own target mix (kinds with no market — property, «other» — left out and said)
  const tg = Object.entries(st.settings?.targets || {}).filter(([k, v]) => +v > 0 && CAT[k] && !CAT[k].liability);
  let targetNote = null;
  if (tg.length) {
    const tw = {}; let left = 0; const sum = tg.reduce((s, [, v]) => s + +v, 0);
    for (const [k, v] of tg) { const m = CAT_MARKET[k]; if (m && growth[m]) tw[m] = (tw[m] || 0) + +v / sum; else left += +v / sum; }
    const tot = Object.values(tw).reduce((s, x) => s + x, 0);
    if (tot > 0.5) {
      for (const k of Object.keys(tw)) tw[k] /= tot;
      if (left > 0.005) targetNote = `${pct(left, { sign: false })} از هدف (ملک، سایر یا بازاری که سابقه‌اش نیامد) در این حساب نیامد`;
      add('target', 'ترکیب هدف خودت', mixGrowth(tw), 'mix', { weights: tw, note: targetNote, cost: Object.entries(tw).reduce((s, [k, x]) => s + x * (MARKET_COST[k] || 0), 0) });
    }
  }
  if (growth.gold && growth.usd) add('balanced', 'سبد ساده', mixGrowth({ gold: 1 / 3, usd: 1 / 3, deposit: 1 / 3 }), 'mix', { note: 'یک‌سوم طلا، یک‌سوم دلار، یک‌سوم سپرده', cost: (MARKET_COST.gold + MARKET_COST.usd) / 3 });
  add('inflation', `تورم (${num(inflationPct, 1)}٪ سالانه)`, inflG, 'line');
  const you = { id: 'you', name: 'سبد تو', kind: 'you', end: pf.net, ret: at.market / denom, diff: 0 };
  rows.push(you);
  rows.sort((a, b) => b.ret - a.ret);
  const ranked = rows.filter((r) => r.kind !== 'line');
  const rank = ranked.findIndex((r) => r.kind === 'you') + 1;
  const infl = rows.find((r) => r.id === 'inflation');
  const target = rows.find((r) => r.id === 'target');
  const balanced = rows.find((r) => r.id === 'balanced');
  // why a market above you did better: the kind you held most of that grew least against it (at the start). The
  // nearest market above that this can explain (the one right above may be the very market you held — a deposit
  // above Rial cash says nothing new)
  let why = null;
  const byId = Object.fromEntries((st.assets || []).map((a) => [a.id, a]));
  const ex = {}; let g0 = 0;
  for (const [id, v] of Object.entries(at.snap?.v || {})) { const a = byId[id]; if (!a || !(v > 0) || E.isLiability(a)) continue; const e = isCash(a) ? 'cash' : E.exposureOf(a); ex[e] = (ex[e] || 0) + v; g0 += v; }
  for (const above of ranked.slice(0, rank - 1).reverse().filter((r) => r.kind === 'market' && r.own !== null)) {
    let best = null;
    for (const [e, v] of Object.entries(ex)) {
      const m = EXP_MARKET[e]; const r = e === 'cash' ? { id: 'cash', name: 'حساب بانکی', own: 0 } : m ? rows.find((x) => x.id === m) : null;
      if (!r || r.id === above.id || r.own === null) continue;
      const cost = (v / g0) * (above.own - r.own);
      if (cost > 0 && (!best || cost > best.cost)) best = { exposure: e, share: v / g0, market: r, cost };
    }
    if (best && best.share >= 0.1) {
      const sh = pct(best.share, { sign: false, digits: 0 });
      const text = best.exposure === 'cash' ? `در شروع دوره ${sh} سبدت نقد در حساب بانکی بود که سودی نگرفت؛ در این مدت ${above.name} ${pct(above.own, { digits: 0 })} تغییر کرد.`
        : `در شروع دوره ${sh} سبدت ${EXPOSURES[best.exposure]?.name || best.exposure} بود؛ در این مدت ${best.market.name} ${pct(best.market.own, { digits: 0 })} تغییر کرد و ${above.name} ${pct(above.own, { digits: 0 })}.`;
      why = { above, ...best, text }; break;
    }
  }
  return { from: at.from, days: T, partial: P.partial, est: at.est, rows, rank, of: ranked.length, you, missing, why,
    aboveInflation: infl ? you.ret >= infl.ret : null, vsTarget: target ? you.ret - target.ret : null, vsBalanced: balanced ? you.ret - balanced.ret : null,
    ahead: ranked.filter((r) => r.kind !== 'you' && r.ret < you.ret).length, behind: rank - 1, costs, depositPct, inflationPct, at, entries };
}

/** A row's path through the period, next to yours: your net worth on each saved day, and that same money in the market. */
export function rankingPath(R, rowId, st, today = todayIso()) {
  const row = R?.rows.find((r) => r.id === rowId); if (!row?.g) return null;
  const days = Object.keys(st.snapshots || {}).sort().filter((k) => k >= R.from && k < today);
  const pts = [...days, today].map((d) => {
    let alt = R.at.base * (row.g(R.from, d) ?? NaN);
    for (const e of R.entries) if (e.date <= d) alt += e.amount * (row.g(e.date, d) ?? NaN);
    const mine = d === today ? R.you.end : st.snapshots[d]?.t;
    return { date: d, mine, alt };
  }).filter((p) => isFinite(p.mine) && isFinite(p.alt));
  return pts.length >= 2 ? pts : null;
}

/** The period a comparison is measured over: its attribution, the money moved (dated), its length. */
function periodOf(st, days, pf, today) {
  const keys = Object.keys(st.snapshots || {}).sort();
  if (!keys.length) return null;
  const whole = Math.max(1, daysBetween(keys[0], today));
  const partial = !!days && days > whole;
  const span = !days || partial ? whole : days;
  const at = E.attribution(st.assets, st.quotes, st.settings, st.snapshots, st.events, span, today, pf);
  if (!at) return null;
  return { at, keys, partial, T: Math.max(1, daysBetween(at.from, today)), entries: flowEntries(at, today) };
}

/**
 * The return of what you own, debts left out (a loan's cost is not in it): the market effect on assets over the money
 * that was in them (Dietz). Only when there were debts in the period — without any it is the same as the return on net
 * worth. Returns { ret, market, base, debt } or null.
 */
export function assetsReturn(at, pf, today = todayIso()) {
  const liab = (r) => (r.asset ? E.isLiability(r.asset) : (r.then || 0) < 0 || (r.now || 0) < 0);
  const debtThen = +at.snap?.l || Object.values(at.snap?.v || {}).filter((v) => v < 0).reduce((s, v) => s - v, 0);
  if (!(debtThen > 0) && !(pf.debt > 0)) return null;
  const rows = at.rows.filter((r) => !liab(r));
  const g0 = +at.snap?.g || Object.values(at.snap?.v || {}).filter((v) => v > 0).reduce((s, v) => s + v, 0);
  const market = rows.reduce((s, r) => s + r.market, 0);
  const now = rows.reduce((s, r) => s + (r.now || 0), 0);
  const part = { from: at.from, base: g0, rows, total: now - g0, market };
  const d = dietzBase(part, today);
  return { ret: d > 0 ? market / d : null, market, base: g0, debt: pf.debt };
}

/** The default yearly inflation to measure against: the owner's setting, else the Statistical Centre of Iran's
 *  12-month average for Shahrivar 1405 (73.6%). */
export const INFLATION_DEFAULT = 73.6;
export const defaultInflationPct = (st) => (+st.settings?.inflationPct > 0 ? +st.settings.inflationPct : INFLATION_DEFAULT);
/** A nominal return over `days`, after inflation of `inflationPct` a year: (1 + ret) ÷ (1 + inflation) over the same days − 1. */
export function realReturn(ret, days, inflationPct) {
  if (ret === null || !isFinite(ret) || !(inflationPct >= 0) || !(days > 0)) return null;
  const infl = Math.pow(1 + inflationPct / 100, days / 365) - 1;
  return { ret: (1 + ret) / (1 + infl) - 1, inflation: infl };
}

/* ------------------------------------------------------------- break-even ------------------------------------------------------------- */
/** Growth of a deposit paying `ratePct` a year over `months`, with each monthly payout put back in. */
export function depositGrowth(ratePct, months) {
  return Math.pow(1 + (+ratePct || 0) / 100 / 12, Math.max(0, months));
}
/**
 * How much an asset must rise in `months` to beat a deposit paying `ratePct` a year (monthly interest re-deposited).
 * feePct: total cost of buying and selling (spread, commission, making charge).
 */
export function breakEven({ price0, ratePct, months, feePct = 0 }) {
  const m = Math.max(1, +months || 1);
  const dg = depositGrowth(ratePct, m);
  const keep = 1 - Math.min(0.9, Math.max(0, (+feePct || 0) / 100));
  const needed = dg / keep - 1;
  return { months: m, depositGrowth: dg, depositGain: dg - 1, needed, annualNeeded: Math.pow(1 + needed, 12 / m) - 1, targetPrice: price0 > 0 ? price0 * (1 + needed) : null };
}

/* --------------------------------------------------------- price sources --------------------------------------------------------- */
/**
 * How each price source is doing, from the stored quotes: when it last answered, how many prices it gives now, and which
 * didn't come (with the source's message). Only the prices tried in the latest round count — an old one from an asset
 * since deleted isn't news. status: 'ok' | 'some' (a few failed) | 'down' (nothing came in the latest round) |
 * 'old' (no answer for longer than `staleMs`) | 'idle' (nothing to fetch from it).
 */
export function providerHealth(quotes = {}, now = Date.now(), staleMs = 3 * 3600e3) {
  const out = {};
  for (const [id, q] of Object.entries(quotes || {})) {
    // Bitpin's prices are kept under the crypto source's name: told apart by where they came from
    const p0 = id.split(':')[0]; if (!PROVIDERS[p0] || !q) continue;
    const p = p0 === 'nobitex' && q.source === 'bitpin' ? 'bitpin' : p0;
    const o = out[p] ||= { items: [] };
    o.items.push({ id, q, tried: Math.max(+q.fetchedAt || 0, +q.errorAt || 0) });
  }
  for (const k of [...Object.keys(PROVIDERS), 'bitpin']) {
    const o = out[k] ||= { items: [] };
    const latest = Math.max(0, ...o.items.map((x) => x.tried));
    const cur = o.items.filter((x) => x.tried >= latest - 6 * 3600e3); // the latest round (a round can take a while)
    const failed = cur.filter((x) => x.q.error && (x.q.errorAt || 0) >= (x.q.fetchedAt || 0));
    const lastOk = Math.max(0, ...o.items.filter((x) => x.q.price > 0).map((x) => +x.q.fetchedAt || 0));
    const status = !cur.length ? 'idle' : failed.length === cur.length ? 'down' : now - lastOk > staleMs ? 'old' : failed.length ? 'some' : 'ok';
    out[k] = { status, n: cur.length, ok: cur.length - failed.length, failed: failed.length, lastOk: lastOk || null, lastTry: latest || null,
      error: failed[0]?.q.error || null, failedIds: failed.map((x) => x.id) };
  }
  return out;
}

/* ------------------------------------------------------------ new money ------------------------------------------------------------ */
/**
 * Split `amount` of new money across categories so the mix moves toward the targets, without selling anything.
 * targets: { categoryId: fraction }. Shortfalls are filled in proportion to their size; anything left follows the targets.
 */
export function allocateNew(pf, targets = {}, amount = 0, assets = []) {
  // the same plan as «تخصیص هدف»: only the targeted kinds (online gold counted with gold when only one has a target),
  // targets read in proportion to each other; what is held without a target is left out of the shares
  const plan = E.rebalancePlan(pf, targets);
  const on = plan.rows.filter((r) => r.hasTarget);
  if (!on.length || !(amount > 0)) return null;
  const G1 = plan.base + amount;
  const gaps = Object.fromEntries(on.map((r) => [r.id, Math.max(0, r.target * G1 - r.current)]));
  const gapSum = Object.values(gaps).reduce((x, v) => x + v, 0);
  const add = {};
  if (gapSum >= amount) for (const r of on) add[r.id] = amount * gaps[r.id] / gapSum;
  else for (const r of on) add[r.id] = gaps[r.id] + (amount - gapSum) * r.target;
  const vehicle = (ids) => {
    const rows = pf.rows.filter((x) => ids.includes(x.asset.category) && !x.asset.archived).sort((a, b) => b.value - a.value);
    return rows[0]?.asset || null;
  };
  const rows = on.map((r) => ({
    id: r.id, cat: r.cat, ids: r.ids, current: r.current, currentShare: r.currentShare, target: r.target,
    add: add[r.id], after: r.current + add[r.id], afterShare: (r.current + add[r.id]) / G1, vehicle: add[r.id] >= 1 ? vehicle(r.ids) : null,
  })).sort((a, b) => b.add - a.add);
  const maxDevBefore = Math.max(...rows.map((r) => Math.abs(r.currentShare - r.target)));
  const maxDevAfter = Math.max(...rows.map((r) => Math.abs(r.afterShare - r.target)));
  return { amount, rows, sumTargets: plan.sumTargets, maxDevBefore, maxDevAfter, outside: plan.outside };
}

/* ------------------------------------------------------------- critique ------------------------------------------------------------- */
/** Percent-only facts for the AI review: no absolute amounts leave the device. */
export function critiqueFacts(st, pf, perf = null) {
  if (!(pf.gross > 0)) return null; // nothing to review; also avoids dividing amounts by 1
  const g = pf.gross;
  const p = (x) => (isFinite(x) ? Math.round(x * 1000) / 10 : null);
  const assets = pf.rows.filter((r) => !r.cat.liability).sort((a, b) => b.value - a.value);
  const fixed = pf.rows.filter((r) => r.asset.mode === 'rate' && !r.cat.liability);
  const fixedW = fixed.reduce((x, r) => x + r.value, 0);
  const targets = st.settings.targets || {};
  const tSum = Object.values(targets).reduce((x, v) => x + (+v || 0), 0);
  return {
    categories_pct: Object.fromEntries(pf.cats.filter((c) => !c.liability).map((c) => [c.name, p(c.share)])),
    exposures_pct: Object.fromEntries(Object.entries(pf.byExposure).map(([k, v]) => [EXPOSURES[k]?.name || k, p(v / g)])),
    liquidity_pct: Object.fromEntries(Object.entries(pf.byLiquidity).map(([k, v]) => [LIQUIDITY[k] || k, p(v / g)])),
    largest_holdings_pct: assets.slice(0, 5).map((r) => ({ name: r.asset.name, pct: p(r.value / g) })),
    largest_custodian_pct: Object.entries(pf.byCustodian).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => ({ name: n, pct: p(v / g) })),
    debt_to_assets_pct: p(pf.debt / g),
    fixed_income_avg_rate_pct: fixedW ? Math.round(fixed.reduce((x, r) => x + r.value * (+r.asset.rate?.annualPct || 0), 0) / fixedW * 10) / 10 : null,
    needs_update_count: pf.attention.length,
    targets_pct: tSum ? Object.fromEntries(Object.entries(targets).filter(([, v]) => +v > 0).map(([k, v]) => [CAT[k]?.name || k, Math.round(+v / tSum * 1000) / 10])) : null,
    performance: perf ? { period_days: perf.days, market_return_pct: perf.ret !== null ? p(perf.ret) : null,
      vs: Object.fromEntries(perf.bench.map((b) => [b.id, { benchmark_return_pct: p(b.ret), ahead_pct_of_net: perf.end > 0 ? p(b.diff / perf.end) : null }])) } : null,
  };
}

/** Deposit rate to compare against: the user's setting, else their largest fixed-income rate, else 25%. */
export function defaultDepositPct(st) {
  if (+st.settings?.depositPct > 0) return +st.settings.depositPct;
  const fixed = (st.assets || []).filter((a) => !a.archived && a.mode === 'rate' && !E.isLiability(a) && +a.rate?.annualPct > 0)
    .sort((a, b) => (+b.rate.principal || 0) - (+a.rate.principal || 0));
  return fixed.length ? +fixed[0].rate.annualPct : 25;
}

/* ============================ the dashboard's four cards ============================ */
// Each card answers one question with a number, what it means, and the next step. Pure; money is Rial.

/** Share of assets (debts left out) not tied to the Rial, on a past snapshot. Assets deleted since then can't be
 *  classified: when they were more than 5% of that day's assets the answer would be a guess, so there is none. */
export function protectedShareAt(snap, assets = []) {
  if (!snap?.v) return null;
  const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
  let gross = 0, prot = 0, unknown = 0;
  for (const [id, val] of Object.entries(snap.v)) {
    if (!(+val > 0)) continue;
    const a = byId[id];
    if (!a) { unknown += +val; continue; }
    if (E.isLiability(a)) continue;
    gross += +val;
    if (PROTECTED(E.exposureOf(a))) prot += +val;
  }
  if (!gross || unknown > 0.05 * (gross + unknown)) return null;
  return prot / gross;
}

/** Is an exposure protected from inflation? Not the Rial, and not «other» — what it is isn't known, so it isn't counted
 *  as protected (cash at home, a loan to a friend). One rule for the dashboard card and the analysis page. */
export const PROTECTED = (exposure) => exposure !== 'rial' && exposure !== 'other';

/** The protected share the owner's own target mix implies (category targets, percent). Only a mix that adds up to
 *  100% (±1) says anything; otherwise there is no target. */
export function protectedTarget(targets = {}) {
  const ent = Object.entries(targets || {}).filter(([k, v]) => CAT[k] && !CAT[k].liability && +v > 0);
  const sum = ent.reduce((s, [, v]) => s + +v, 0);
  if (!ent.length || Math.abs(sum - 100) > 1) return null;
  return ent.reduce((s, [k, v]) => s + (PROTECTED(CAT[k].exposure) ? +v : 0), 0) / 100;
}

/** «محافظت در برابر تورم»: share not tied to the Rial, its move over ~30 days, the owner's target, and what isn't protected. */
export function inflationCard(st, pf, today = todayIso()) {
  // assets only, and only what is worth something: an overdrawn account is a shortfall (flagged in «نیاز به توجه»),
  // not a negative slice — so share, parts and the unprotected list always add up, as on a past snapshot
  const pos = pf.rows.filter((r) => !r.cat.liability && r.value > 0);
  const g = pos.reduce((t, r) => t + r.value, 0);
  if (!(g > 0)) return null;
  const ex = {};
  for (const r of pos) ex[r.exposure] = (ex[r.exposure] || 0) + r.value;
  const unp = (ex.rial || 0) + (ex.other || 0);
  const share = (g - unp) / g;
  const parts = Object.entries(ex).filter(([k, v]) => PROTECTED(k) && v > 0)
    .map(([k, v]) => ({ key: k, name: EXPOSURES[k]?.name || k, color: EXPOSURES[k]?.color || '#B9BED0', value: v, share: v / g }))
    .sort((a, b) => b.value - a.value);
  // what isn't protected, by category (a deposit, an account, money owed to you…)
  const rialBy = {};
  for (const r of pos) if (!PROTECTED(r.exposure)) rialBy[r.cat.id] = (rialBy[r.cat.id] || 0) + r.value;
  const unprotected = Object.entries(rialBy).map(([id, v]) => ({ id, name: CAT[id]?.short || id, value: v, share: v / g })).sort((a, b) => b.value - a.value);
  // the move: against a snapshot about a month old (not one from long ago standing in for «last month»)
  let delta = null;
  const past = E.snapshotBefore(st.snapshots || {}, 30, today);
  if (past && daysBetween(past.date, today) <= 45) {
    const then = protectedShareAt(past.snap, st.assets);
    if (then !== null) delta = share - then;
  }
  const target = protectedTarget(st.settings?.targets);
  let status = null;
  if (target !== null) status = share >= target - 0.0005 ? 'ok' : target - share <= 0.05 + 1e-9 ? 'near' : 'below';
  // A debt in Rial is the other side of the same bet: inflation shrinks it as it shrinks a deposit. What is left exposed
  // is the Rial you own minus the Rial you owe (a debt in gold or dollars is not Rial, and grows with them).
  const rialOwned = ex.rial || 0;
  const rialDebt = pf.rows.filter((r) => r.cat.liability && r.value > 0 && r.exposure === 'rial').reduce((t, r) => t + r.value, 0);
  const otherDebt = pf.rows.filter((r) => r.cat.liability && r.value > 0 && r.exposure !== 'rial').reduce((t, r) => t + r.value, 0);
  const netRial = rialOwned - rialDebt;
  return { share, delta, target, status, parts, unprotected, unprotectedShare: unp / g, rialOwned, rialDebt, otherDebt, netRial,
    netRialShare: pf.net > 0 ? netRial / pf.net : null };
}

/** «نقدشوندگی»: how much turns into cash in days / weeks / months, with the largest assets of each tier. */
export function liquidityCard(pf) {
  const rows = pf.rows.filter((r) => !r.cat.liability && r.value > 0).sort((a, b) => b.value - a.value);
  const g = rows.reduce((t, r) => t + r.value, 0);
  if (!(g > 0)) return null;
  const tiers = { high: { name: 'چند روز', value: 0, names: [] }, mid: { name: 'چند هفته', value: 0, names: [] }, low: { name: 'طولانی‌تر', value: 0, names: [] } };
  for (const r of rows) {
    const t = tiers[r.asset.liquidity || r.cat.liquidity] || tiers.mid;
    t.value += r.value;
    if (t.names.length < 3) t.names.push(r.asset.name);
  }
  for (const t of Object.values(tiers)) t.share = t.value / g;
  // a term deposit counted as «days» can be cashed only by breaking it (and losing part of its interest)
  const today = todayIso();
  const term = rows.filter((r) => (r.asset.liquidity || r.cat.liquidity) === 'high' && r.asset.mode === 'rate' && r.asset.rate?.maturity > today)
    .reduce((t, r) => t + r.value, 0);
  return { tiers, high: tiers.high.value, share: tiers.high.share, term };
}

/** Money that comes in by itself (interest earned + recurring income) and the next time some actually arrives. */
export function incomeCard(st, today = todayIso()) {
  const auto = E.monthlyAuto(st.assets, st.flows || [], today);
  const byId = Object.fromEntries(st.assets.map((a) => [a.id, a]));
  const incoming = (e) => {
    const a = e.assetId ? byId[e.assetId] : null;
    if (e.kind === 'interest') return !!a && !E.isLiability(a);
    if (e.kind === 'loan') return !!a && !E.isLiability(a);          // an installment someone pays you
    if (e.kind === 'flow') return !!e.toId && !e.fromId;             // salary, rent received…
    return false;                                                    // maturities move your own money, they don't add any
  };
  const next = E.upcoming(st.assets, st.flows || [], 45, today).find((e) => e.date > today && incoming(e) && e.amount > 0) || null;
  return { total: auto.interest + auto.inflow, interest: auto.interest, inflow: auto.inflow, next };
}

const DAY_MS = 86400000;
const whenFa = (n) => (n <= 0 ? 'امروز' : n === 1 ? 'فردا' : `${num(n)} روز دیگر`);
/**
 * «نیاز به توجه»: what to do, most urgent first. Assets whose number can't be trusted (matured, no price, not updated,
 * old online price), installments due within 7 days (and whether the paying account has enough), maturities within 14.
 * Each item: { tone: 'neg'|'warn'|'info', text, assetId?, href? }.
 */
export function attentionItems(st, pf, today = todayIso(), now = Date.now()) {
  const items = [];
  const by = (s) => pf.attention.filter((r) => r.status === s);
  for (const r of by('matured')) items.push({ tone: 'warn', text: `«${r.asset.name}» سررسید شده`, assetId: r.asset.id, rank: 1 });
  for (const r of pf.rows) if (!r.cat.liability && r.value < -0.5) items.push({ tone: 'neg', text: `موجودی «${r.asset.name}» منفی است`, assetId: r.asset.id, rank: 0 });
  const bk = st.meta?.backup;
  if (bk?.error && (st.settings?.backup?.freq ?? 'weekly') !== 'off') items.push({ tone: 'warn', text: 'پشتیبان خودکار ساخته نشد؛ در تنظیمات ببین', href: '#/settings', rank: 2 });
  for (const r of by('error')) items.push({ tone: 'warn', text: r.asset.mode === 'units' ? `قیمت «${r.asset.name}» دریافت نشد` : `«${r.asset.name}»: ${r.error || 'نیاز به بررسی'}`, assetId: r.asset.id, rank: 2 });
  // a quantity with no price at all (a capture that found no source): worth 0 until a price is set
  const noPrice = st.assets.filter((a) => !a.archived && a.mode === 'units' && a.price?.source !== 'market' && !(+a.price?.value > 0) && +a.quantity > 0);
  if (noPrice.length === 1) items.push({ tone: 'warn', text: `«${noPrice[0].name}» قیمت ندارد؛ ارزشش صفر حساب می‌شود`, assetId: noPrice[0].id, rank: 2 });
  else if (noPrice.length > 1) items.push({ tone: 'warn', text: `${num(noPrice.length)} دارایی قیمت ندارند؛ ارزششان صفر حساب می‌شود`, href: '#/assets', rank: 2, n: noPrice.length });
  const stale = by('stale').filter((r) => !noPrice.some((a) => a.id === r.asset.id)); // said once, above
  if (stale.length === 1) {
    const r = stale[0]; const d = r.at ? Math.floor((now - r.at) / DAY_MS) : null;
    items.push({ tone: 'warn', text: d ? `«${r.asset.name}» ${num(d)} روز است به‌روز نشده` : `«${r.asset.name}» به‌روز نشده`, assetId: r.asset.id, rank: 3 });
  } else if (stale.length > 1) items.push({ tone: 'warn', text: `${num(stale.length)} دارایی دستی مدتی است به‌روز نشده`, href: '#/assets?f=attention', rank: 3, n: stale.length });
  const delayed = by('delayed');
  if (delayed.length === 1) items.push({ tone: 'info', text: `قیمت آنلاین «${delayed[0].asset.name}» قدیمی است`, assetId: delayed[0].asset.id, rank: 6 });
  else if (delayed.length > 1) items.push({ tone: 'info', text: `قیمت آنلاین ${num(delayed.length)} دارایی قدیمی است`, href: '#/assets?f=attention', rank: 6, n: delayed.length });

  const byId = Object.fromEntries(st.assets.map((a) => [a.id, a]));
  const valueOf = Object.fromEntries(pf.rows.map((r) => [r.asset.id, r.value]));
  const up = E.upcoming(st.assets, st.flows || [], 14, today);
  // each account's balance through the coming week, day by day (on a day with money both in and out, out first:
  // a warning that turns out unneeded beats a missed one)
  const bal = {};
  const live = (id) => !!id && !!byId[id] && !byId[id].archived && !E.isLiability(byId[id]);
  const week = up.filter((e) => daysBetween(today, e.date) <= 7 && e.kind !== 'maturity'
    // a bank's own payday interest: its value already includes what has accrued, so it isn't new money
    && !(e.kind === 'interest' && e.toId === e.assetId && byId[e.assetId]?.mode === 'balance'));
  const shortOn = new Set();
  const start = (id) => bal[id] ?? valueOf[id] ?? 0;
  for (const day of [...new Set(week.map((e) => e.date))]) {
    const evs = week.filter((e) => e.date === day);
    for (const e of evs) if (live(e.fromId)) { bal[e.fromId] = start(e.fromId) - e.amount; if (bal[e.fromId] < -0.5) shortOn.add(e); }
    for (const e of evs) if (live(e.toId)) bal[e.toId] = start(e.toId) + e.amount;
  }
  for (const e of up) {
    const a = byId[e.assetId]; if (!a) continue;
    const days = daysBetween(today, e.date);
    if (e.kind === 'loan' && E.isLiability(a) && days <= 7) {
      const short = shortOn.has(e);
      items.push({ tone: short ? 'neg' : 'info', text: `قسط «${a.name}» ${whenFa(days)}${short ? '؛ موجودی حساب کافی نیست' : ''}`, assetId: a.id, rank: short ? 0 : 4, date: e.date });
    } else if (e.kind === 'maturity') {
      items.push({ tone: 'info', text: `${E.isLiability(a) ? 'بدهی ' : ''}«${a.name}» ${whenFa(days)} سررسید می‌شود`, assetId: a.id, rank: 5, date: e.date });
    }
  }
  return items.sort((x, y) => x.rank - y.rank || String(x.date || '').localeCompare(String(y.date || '')));
}
