// Explanations and decision helpers built on the engine. Pure functions; all money is Rial.
//  - explainAsset / explainNet / explainChange: «این عدد از کجا آمد؟»
//  - performance: «واقعاً پولدارتر شدم؟» — market return net of money moved, against gold / dollar / deposit
//  - breakEven: how far an asset must rise to beat a deposit
//  - allocateNew: where new money goes to move toward the target mix (no selling)
//  - critiqueFacts: percent-only facts for the AI portfolio review
import * as E from './engine.js';
import { CAT, EXPOSURES, LIQUIDITY, TGJU_BY_KEY, NOBITEX_BY_KEY, PROVIDERS } from './catalog.js';
import { todayIso, daysBetween, isoFromDate, fmtJ } from './jalali.js';
import { num } from './format.js';

const MODE_NAME = { payout: 'روزشمار، سود ماهانه واریز می‌شود', compound: 'روزشمار مرکب', simple: 'روزشمار ساده' };
const basisName = (b) => (b === 'actual' ? 'طول واقعی سال شمسی' : `${b || 365} روز`);

export function refText(ref) {
  if (!ref) return '';
  const p = PROVIDERS[ref.provider]?.name || ref.provider;
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
      let since = r.lastPayout && r.lastPayout <= end ? r.lastPayout : r.start;
      const prev = r.start ? E.prevMonthlyOnOrBefore(r.start, end) : since;
      if (prev > since) since = prev;
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
    lines.push({ t: 'اقساط پرداخت‌شده', v: `${num(st.paid)} از ${num(st.n)}`, k: 'text' });
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
  const drivers = at.rows.filter((r) => Math.abs(r.market) >= 1).slice(0, 5).map((r) => ({ t: r.asset?.name || 'دارایی حذف‌شده', v: r.market, k: 'money', sign: true }));
  return { lines, drivers, formula: 'تغییر = اثر بازار + پولی که وارد یا خارج شد + ویرایش‌های دستی', notes: at.est ? ['مبنای مقایسه بازسازی‌شده (تخمینی) است.'] : [], at };
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
export function performance(st, days, { depositPct = 25, today = todayIso(), pf = null, now = Date.now() } = {}) {
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
  const clamp = (iso) => (iso < at.from ? at.from : iso > today ? today : iso);
  // dated money moved (per asset; internal transfers cancel out)
  const entries = [];
  for (const r of at.rows) for (const m of r.moves || []) entries.push({ date: clamp(m.date || today), amount: m.amount });
  const moneyIn = at.total - at.market;
  const listed = entries.reduce((x, e) => x + e.amount, 0);
  if (Math.abs(moneyIn - listed) >= 1) entries.push({ date: today, amount: moneyIn - listed }); // keeps the books balanced
  const weight = (iso) => Math.min(1, Math.max(0, daysBetween(iso, today) / T));
  const denom = at.base + entries.reduce((x, e) => x + e.amount * weight(e.date), 0);
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
  return { from: at.from, days: T, partial, est: at.est, base: at.base, end: pf.net, moneyIn, market: at.market, ret, annual, bench, depositPct };
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

/* ------------------------------------------------------------ new money ------------------------------------------------------------ */
/**
 * Split `amount` of new money across categories so the mix moves toward the targets, without selling anything.
 * targets: { categoryId: fraction }. Shortfalls are filled in proportion to their size; anything left follows the targets.
 */
export function allocateNew(pf, targets = {}, amount = 0, assets = []) {
  const ids = Object.keys(targets).filter((k) => +targets[k] > 0 && CAT[k] && !CAT[k].liability);
  if (!ids.length || !(amount > 0)) return null;
  const sumT = ids.reduce((x, k) => x + +targets[k], 0);
  // Targets are used as entered; only a total above 100% is scaled down. Categories without a target get nothing new.
  const scale = sumT > 1 ? 1 / sumT : 1;
  const T = (id) => +targets[id] * scale;
  const G1 = pf.gross + amount;
  const cur = (id) => pf.cats.find((c) => c.id === id)?.value || 0;
  const gaps = Object.fromEntries(ids.map((id) => [id, Math.max(0, T(id) * G1 - cur(id))]));
  const gapSum = Object.values(gaps).reduce((x, v) => x + v, 0);
  const add = {};
  if (gapSum >= amount) for (const id of ids) add[id] = amount * gaps[id] / gapSum;
  else for (const id of ids) add[id] = gaps[id] + (amount - gapSum) * (+targets[id] / sumT);
  const vehicle = (id) => {
    const rows = pf.rows.filter((r) => r.asset.category === id && !r.asset.archived).sort((a, b) => b.value - a.value);
    return rows[0]?.asset || null;
  };
  const rows = ids.map((id) => ({
    id, cat: CAT[id], current: cur(id), currentShare: pf.gross ? cur(id) / pf.gross : 0, target: T(id),
    add: add[id], after: cur(id) + add[id], afterShare: (cur(id) + add[id]) / G1, vehicle: add[id] >= 1 ? vehicle(id) : null,
  })).sort((a, b) => b.add - a.add);
  const maxDevBefore = Math.max(...rows.map((r) => Math.abs(r.currentShare - r.target)));
  const maxDevAfter = Math.max(...rows.map((r) => Math.abs(r.afterShare - r.target)));
  return { amount, rows, sumTargets: sumT, maxDevBefore, maxDevAfter };
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
