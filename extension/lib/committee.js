// «کمیتهٔ سرمایه‌گذاری»: where the next sum of money could go, in four fixed parts — what the owner needs (the cash the
// next 90 days ask for, and how far the mix is from its targets), the ways in today (funds, coins, radar candidates,
// each with a reason for and against), what it does to the mix, and what happens if it goes wrong.
//
// Pure: no network, no storage. Money in Rial. It never says «buy»: it sets out the choice and leaves it to the owner.
// Built on the same parts as the rest of Dara: upcoming events (engine.upcoming), new money toward targets
// (builder.allocClasses), the ways in for each block (builder.vehicles), the radar's candidates and their record, and
// the past of Iran's markets for the bad case (builder.range).
import * as E from './engine.js';
import * as PB from './builder.js';
import * as RD from './radar.js';
import * as PR from './profile.js';
import { pct } from './format.js';
import { todayIso } from './jalali.js';

export const HORIZON_DAYS = 90;
export const MAX_OPTIONS = 3;
// a plain bad case when the past of the markets isn't at hand (a fall over the next year in Rial)
export const SHOCK = { deposit: 0, gold: -0.15, usd: -0.15, bourse: -0.3, btc: -0.5 };
const BLOCKS = PB.CLASSES.map((c) => c.id);
const P = (x, d = 0) => pct(x, { digits: d });
const P0 = (x, d = 0) => pct(x, { sign: false, digits: d });

const isCash = (a) => !!a && !a.archived && a.category === 'bank' && !E.isLiability(a);

/**
 * The next `days` of money in and out of the accounts, from what Dara already schedules: instalments paid and received,
 * deposits that mature, interest paid into an account, recurring income and costs. The low point of the running cash
 * (accounts today + what comes in − what goes out) says how much must stay in cash. source: the id of the account the
 * money is in (it leaves that account), or 'new' (money not in Dara yet).
 */
export function cashNeeds(st, pf, { amount = 0, source = 'new', days = HORIZON_DAYS, today = todayIso() } = {}) {
  const byId = new Map(st.assets.map((a) => [a.id, a]));
  const cash = pf.rows.filter((r) => isCash(r.asset)).reduce((t, r) => t + Math.max(0, r.value), 0);
  const start = Math.max(0, cash - (source !== 'new' && isCash(byId.get(source)) ? amount : 0));
  const events = [];
  for (const e of E.upcoming(st.assets, st.flows || [], days, today)) {
    const a = e.assetId ? byId.get(e.assetId) : null;
    let sign = 0;
    if (e.kind === 'loan') sign = a && E.isLiability(a) ? -1 : 1;
    else if (e.kind === 'maturity') sign = a && !E.isLiability(a) ? 1 : 0;
    // interest counts only when it is paid into an account (interest added to a deposit stays in the deposit)
    else if (e.kind === 'interest') sign = a && !E.isLiability(a) && isCash(byId.get(e.toId)) ? 1 : 0;
    // a recurring flow: out of an account to anywhere else, or into an account from anywhere else (salary, rent)
    else if (e.kind === 'flow') { const from = isCash(byId.get(e.fromId)), to = isCash(byId.get(e.toId)); sign = from && !to ? -1 : to && !from ? 1 : 0; }
    if (sign && e.amount > 0) events.push({ date: e.date, title: e.title, amount: e.amount, sign, kind: e.kind });
  }
  let run = start, low = start, lowDate = null, out = 0, inn = 0;
  for (const e of events) { run += e.sign * e.amount; if (e.sign < 0) out += e.amount; else inn += e.amount; if (run < low) { low = run; lowDate = e.date; } }
  const shortfall = Math.max(0, -low);
  return { days, start, events, out, in: inn, low, lowDate, shortfall, reserve: Math.min(Math.max(0, amount), shortfall) };
}

/** What the new money is steered by: the owner's targets, else the risk profile's mix, else the mix held today. */
export function basisOf(st, pf, risk = null) {
  const s = st.settings || {};
  // a risk level asked for by name: that level's mix, whatever the targets or the profile say
  if (PR.RISK[risk]) {
    const mine = PR.riskLevel(s.profile) === risk;
    return { id: risk, name: `ترکیب ریسک ${PR.RISK[risk]}${mine ? ' (مطابق پروفایلت)' : ''}`, w: PB.mixWeights(PR.mixFor(risk, !!s.profile?.noCrypto)), level: risk };
  }
  const t = Object.fromEntries(Object.entries(s.targets || {}).filter(([k, v]) => +v > 0 && PB.CAT_CLASS[k]).map(([k, v]) => [k, +v]));
  if (Object.keys(t).length) return { id: 'targets', name: 'ترکیب هدفی که تعیین کرده‌ای', w: PB.mixWeights(t) };
  const level = PR.riskLevel(s.profile);
  if (level) return { id: 'profile', name: `ترکیب پیشنهادی برای ریسک ${PR.RISK[level]} (از پروفایلت)`, w: PB.mixWeights(PR.mixFor(level, !!s.profile?.noCrypto)), level };
  const h = PB.holdings(pf);
  if (h.modelled > 0) return { id: 'current', name: 'همان ترکیب فعلی‌ات (هدف یا پروفایلی تعیین نکرده‌ای)', w: Object.fromEntries(BLOCKS.map((c) => [c, h.cur[c] / h.modelled])) };
  return { id: 'default', name: 'ترکیب ریسک متوسط (هنوز دارایی، هدف یا پروفایلی نیست)', w: PB.mixWeights(PR.mixFor('mid')) };
}

/** A way in, with one or two reasons for and against, from its own facts. */
function optionOf(v, block) {
  const pros = [], cons = [];
  if (v.kind === 'fund') {
    if (v.y1 !== null && v.y1 !== undefined) pros.push(`بازده ۱۲ ماه ${P(v.y1)}`);
    if (block === 'gold' && v.bubble !== null && v.bubble !== undefined) (v.bubble <= 0.01 ? pros : cons).push(`حباب ${P(v.bubble, 1)}`);
    else if (v.bubble !== null && v.bubble !== undefined && v.bubble >= 0.02) cons.push(`حباب ${P(v.bubble, 1)} بالای NAV`);
    if (!v.traded) cons.push('صدور و ابطالی؛ نقد شدنش چند روز کاری طول می‌کشد');
    cons.push('بازده گذشته تضمین آینده نیست');
  } else if (v.kind === 'coin') {
    pros.push('دارایی فیزیکی، بدون واسطه');
    cons.push(`حباب ${P(v.bubble, 1)}؛ ${v.note}`);
  } else if (v.kind === 'note') {
    cons.push(v.note);
  }
  return { kind: v.kind, name: v.name, sym: v.sym || '', pros: pros.slice(0, 2), cons: cons.slice(0, 2) };
}
/** A radar candidate as a way into the stock market: its reason, its red flags and its record. */
function candOption(c, rec) {
  const r = rec?.use;
  const record = r && r.excess !== null ? `کارنامهٔ کاندیداها: ${r.hit !== null ? `${P0(r.hit)} مواقع جلوتر از شاخص` : `میانگین ${P(r.excess, 1)} نسبت به شاخص`} (${r.n} مورد)` : 'کارنامهٔ کاندیداها هنوز کافی نیست';
  return { kind: 'candidate', name: c.name, sym: c.sym, ref: c.ref, pros: [c.why[0]].filter(Boolean), cons: [...(c.flags || []).map((f) => f.t), 'سهم تکی: نوسانش از صندوق بیشتر است'].slice(0, 2), record, stop: c.stop?.price || null };
}

/**
 * The committee. amount: the sum (Rial). source: 'new' or the id of the account it is in. focus: one radar card the
 * owner asked about ({ sig, kind, sym, name, ref, why, flags, stop }) — then all of it is looked at in that one place.
 * radar / cards / records: the radar scan and its built cards (optional). R: builder.returnsFrom() (optional).
 */
export function committee(st, { amount, source = 'new', risk = null, focus = null, radar = null, cards = null, records = null, R = null, depositPct = 25, today = todayIso(), now = Date.now() } = {}) {
  amount = +amount;
  if (!(amount > 0)) return null;
  const s = st.settings || {};
  const pf = E.portfolio(st.assets, st.quotes, s, now);
  const cash = cashNeeds(st, pf, { amount, source, today });
  const invest = amount - cash.reserve;
  const basis = basisOf(st, pf, focus ? null : risk);
  const h = PB.holdings(pf);
  // a focused look: the whole sum (after the reserve) goes where that one card is
  const focusBlock = focus ? (focus.kind === 'fund' ? fundBlock(focus, radar) : 'bourse') : null;
  const add = focus ? Object.fromEntries(BLOCKS.map((c) => [c, c === focusBlock ? invest : 0])) : PB.allocClasses(h.cur, basis.w, invest);
  // the money held today, and after: a sum from an account leaves the deposit block (where accounts are counted)
  const fromCash = source !== 'new';
  const G0 = h.modelled + h.other;
  const G1 = G0 + (fromCash ? 0 : amount);
  const after = Object.fromEntries(BLOCKS.map((c) => [c, h.cur[c] + add[c] + (c === 'deposit' ? cash.reserve - (fromCash ? amount : 0) : 0)]));
  const tgt = (c) => basis.w?.[c] || 0;
  // the ways in: for each block that gets money, up to three — a focused look shows only that card
  const optsFor = (c) => {
    if (focus) return [focus.kind === 'stock' ? candOption(focus, records?.[focus.sig] ? { use: records[focus.sig].use } : null) : { kind: 'fund', name: focus.name, sym: focus.sym || '', ref: focus.ref, pros: (focus.why || []).slice(0, 2), cons: (focus.check || []).slice(0, 2) }];
    // spread before single picks: in the stock market, funds first and one radar candidate after them
    let vs = PB.vehicles(c, { radar, quotes: st.quotes, depositPct }).filter((v) => !(c === 'bourse' && v.kind === 'note'));
    // gold: the cheapest ways in first — coins and gold funds together, by how far their price is above the gold in them
    if (c === 'gold') { const priced = vs.filter((v) => v.bubble !== null && v.bubble !== undefined).sort((a, b) => a.bubble - b.bubble); vs = [...priced, ...vs.filter((v) => !priced.includes(v))]; }
    const list = vs.map((v) => optionOf(v, c));
    const cand = c === 'bourse' && cards ? cards.find((x) => x.sig === 'cand') : null;
    return cand ? [...list.slice(0, MAX_OPTIONS - 1), candOption(cand, records?.cand)] : list.slice(0, MAX_OPTIONS);
  };
  const blocks = BLOCKS.filter((c) => add[c] >= 1).map((c) => ({ id: c, name: PB.CLASS[c].name, add: add[c], share: add[c] / invest,
    before: G0 > 0 ? h.cur[c] / G0 : 0, after: G1 > 0 ? after[c] / G1 : 0, target: focus ? null : tgt(c) || null, options: optsFor(c) }))
    .sort((a, b) => b.add - a.add);
  // what it does to the mix: protected from inflation (everything but Rial), the largest single holding, the target gap
  const unprot = (pf.byExposure.rial || 0) + (pf.byExposure.other || 0);
  const protBefore = G0 > 0 ? 1 - unprot / G0 : null;
  const unprotAfter = unprot + (fromCash ? 0 : cash.reserve) + add.deposit - (fromCash ? amount - cash.reserve : 0);
  const protAfter = G1 > 0 ? 1 - Math.max(0, unprotAfter) / G1 : null;
  const top = pf.rows.filter((r) => !r.cat.liability && r.value > 0).sort((a, b) => b.value - a.value)[0];
  const topAfterValue = top ? top.value - (fromCash && top.asset.id === source ? amount : 0) : 0;
  const dev = (sh) => Math.max(0, ...BLOCKS.filter((c) => tgt(c) > 0).map((c) => Math.abs(sh(c) - tgt(c))));
  const impact = {
    protBefore, protAfter,
    largest: top ? { name: top.asset.name, before: G0 > 0 ? top.value / G0 : null, after: G1 > 0 ? topAfterValue / G1 : null } : null,
    // the largest single new place: one way in should not end up the biggest thing owned
    newLargest: blocks.length ? { name: blocks[0].name, share: G1 > 0 ? blocks[0].add / G1 : null } : null,
    devBefore: basis.w && G0 > 0 ? dev((c) => h.cur[c] / G0) : null, devAfter: basis.w && G1 > 0 ? dev((c) => after[c] / G1) : null,
  };
  // if it goes wrong: a bad year for the invested part (one year in ten worse than this, from the past of the markets),
  // against the same money in a deposit
  const wNew = invest > 0 ? Object.fromEntries(BLOCKS.map((c) => [c, add[c] / invest])) : null;
  let wrong = null;
  if (wNew && invest >= 1) {
    const dep = Math.pow(1 + depositPct / 1200, 12) - 1;
    const W = R?.months?.length ? PB.lastMonths(R, 120) : null;
    const u = W ? PB.usable(wNew, W) : null;
    const rg = u ? PB.range(u.w, W, 12) : null;
    // two views, always both: the past (Iran's markets mostly rose in Rial, so even a bad year there can be a gain) and a
    // plain shock that assumes the fall happens
    const f = BLOCKS.reduce((t, c) => t + wNew[c] * SHOCK[c], 0);
    wrong = { from: rg ? 'history' : 'shock', deposit: invest * dep, depositPct: dep, stress: { loss: invest * f, pct: f },
      history: rg ? { years: Math.round(W.months.length / 12), bad: invest * (rg.bad - 1), badPct: rg.bad - 1, mid: invest * (rg.mid - 1), midPct: rg.mid - 1 } : null };
    // the riskiest place on its own: its worst 12 months in the same past (or the plain bad case)
    const fall = (c) => { if (W && !W.r[c].some((x) => x === null || x === undefined)) { const mt = PB.metrics(PB.path({ [c]: 1 }, W)); if (mt?.worst12 !== null && mt?.worst12 !== undefined) return mt.worst12; } return SHOCK[c]; };
    const risky = BLOCKS.filter((c) => add[c] >= 1 && c !== 'deposit');
    const worst = risky.map((c) => ({ c, f: fall(c) })).sort((a, b) => a.f - b.f)[0];
    // (with one place only, the line above already says it — unless the past is there to add its own worst year)
    if (worst && (risky.length > 1 || W)) wrong.worst = { id: worst.c, name: PB.CLASS[worst.c].name, fall: worst.f, loss: add[worst.c] * worst.f, from: W ? 'history' : 'shock' };
  }
  const notes = [];
  if (cash.reserve > 0) notes.push(`${P0(cash.reserve / amount)} این پول برای پرداخت‌های ${cash.days} روز آینده نقد می‌ماند؛ بدون آن، ${cash.lowDate ? 'حساب‌هایت در این تاریخ کم می‌آورند' : 'کم می‌آوری'}.`);
  if (cash.reserve >= amount) notes.push('همهٔ این مبلغ برای پرداخت‌های پیش رو لازم است؛ چیزی برای سرمایه‌گذاری نمی‌ماند.');
  if (focus && basis.w && G1 > 0) {
    const c = focusBlock; const gap = Math.max(0, tgt(c) * G1 - h.cur[c]);
    if (tgt(c) > 0 && invest > gap * 1.2) notes.push(`طبق ${basis.id === 'targets' ? 'هدفت' : 'ترکیب پیشنهادی'}، «${PB.CLASS[c].name}» حدود ${P0(Math.max(0, gap) / invest)} این مبلغ جا دارد؛ بیشتر از آن از هدف جلو می‌زند.`);
    if (!(tgt(c) > 0)) notes.push(`در ${basis.id === 'targets' ? 'هدفت' : 'ترکیب پیشنهادی'} برای «${PB.CLASS[c].name}» سهمی نیست.`);
  }
  if (h.other > 0 && G0 > 0 && h.other / G0 >= 0.05) notes.push(`${P0(h.other / G0)} دارایی‌هایت (مثل ملک، فلزات یا سهام غیربورسی) در این محاسبه سهم ثابتی دارد و جابه‌جا نمی‌شود.`);
  return { at: now, today, amount, source, focus: focus ? { sym: focus.sym, name: focus.name, kind: focus.kind } : null, cash, invest, basis: { id: basis.id, name: basis.name }, blocks, impact, wrong, notes, depositPct };
}

/** Which block a fund belongs to, by its type (a gold fund is gold, fixed income a deposit, the rest the market). */
function fundBlock(card, radar) {
  const f = (radar?.funds || []).find((x) => `f:${x.key}` === card.id);
  if (!f) return /طلا|سکه/.test(card.name || '') ? 'gold' : 'bourse';
  if (f.fundType === 4 || f.fundType === 24) return 'deposit';
  if (f.fundType === 5) return /طلا|سکه/.test(f.name) ? 'gold' : 'bourse';
  if (f.fundType === 7) return (f.mix?.stock || 0) >= 50 ? 'bourse' : 'deposit';
  return 'bourse';
}

/** The same, as plain facts for the assistant (amounts left out in percent-only privacy). */
export function forModel(c, { disp = (v) => Math.round(v), percentOnly = false, variants = null } = {}) {
  if (!c) return null;
  const alt = variants && variants.length > 1 ? { risk_variants: variants.map(variantRow).map((r) => ({ name: r.name, owners_basis: r.mine || undefined, fits_profile: r.fitsProfile || undefined,
    split_pct: Object.fromEntries(Object.entries(r.split).map(([k, v]) => [PB.CLASS[k].short, Math.round(v * 100)])), shock_result_pct: pct1(r.stressPct), past_bad_year_pct: pct1(r.histBadPct), inflation_protected_after_pct: pct1(r.protAfter) })) } : {};
  const m = (v) => (percentOnly ? undefined : disp(v));
  return {
    amount: m(c.amount), basis: c.basis.name,
    cash_next_90_days: { stays_in_cash: m(c.cash.reserve), stays_in_cash_pct: Math.round((c.cash.reserve / c.amount) * 100), payments_out: m(c.cash.out), money_in: m(c.cash.in), lowest_point_date: c.cash.lowDate },
    invested: m(c.invest),
    blocks: c.blocks.map((b) => ({ name: b.name, amount: m(b.add), pct_of_invested: Math.round(b.share * 100), share_of_assets_before_pct: Math.round(b.before * 1000) / 10, after_pct: Math.round(b.after * 1000) / 10,
      target_pct: b.target !== null ? Math.round(b.target * 1000) / 10 : null, options: b.options.map((o) => ({ name: o.name, symbol: o.sym || undefined, for: o.pros, against: o.cons, record: o.record })) })),
    impact: { inflation_protected_before_pct: pct1(c.impact.protBefore), after_pct: pct1(c.impact.protAfter), largest_holding: c.impact.largest && { name: c.impact.largest.name, before_pct: pct1(c.impact.largest.before), after_pct: pct1(c.impact.largest.after) },
      target_gap_before_pct: pct1(c.impact.devBefore), target_gap_after_pct: pct1(c.impact.devAfter) },
    if_wrong: c.wrong && { shock_assumed: 'طلا و دلار −۱۵٪، بورس −۳۰٪، رمزارز −۵۰٪ در یک سال', shock_result: m(c.wrong.stress.loss), shock_result_pct: pct1(c.wrong.stress.pct),
      past_bad_year_pct: c.wrong.history ? pct1(c.wrong.history.badPct) : null, past_typical_year_pct: c.wrong.history ? pct1(c.wrong.history.midPct) : null, past_years: c.wrong.history?.years ?? null,
      riskiest_place: c.wrong.worst && { name: c.wrong.worst.name, worst_12_months_pct: pct1(c.wrong.worst.fall) }, deposit_same_money_pct: pct1(c.wrong.depositPct) },
    notes: c.notes, ...alt,
  };
}
const pct1 = (x) => (x === null || x === undefined || !isFinite(x) ? null : Math.round(x * 1000) / 10);

export const RISK_LEVELS = ['low', 'mid', 'high'];
/**
 * The committee for the owner's own basis and for each risk level, side by side: { main, variants: [{ id, name, c,
 * mine }] } — main is the owner's basis (targets, profile or today's mix); a level that is the same as main isn't
 * repeated (main says it fits the profile). A look at one symbol has no variants (all of it goes to that one place).
 */
export function committeeSet(st, opts = {}) {
  const main = committee(st, opts);
  if (!main || opts.focus) return main ? { main, variants: [] } : null;
  const level = PR.riskLevel(st.settings?.profile);
  const variants = [{ id: main.basis.id, name: main.basis.id === 'targets' ? 'هدف تو' : main.basis.id === 'profile' ? `پروفایل تو (${PR.RISK[level]})` : main.basis.id === 'current' ? 'ترکیب فعلی' : 'پیش‌فرض', c: main, mine: true }];
  for (const lv of RISK_LEVELS) {
    if (main.basis.id === 'profile' && lv === level) continue;
    variants.push({ id: lv, name: `ریسک ${PR.RISK[lv]}`, c: committee(st, { ...opts, risk: lv }), mine: false, fitsProfile: lv === level });
  }
  return { main, variants };
}
/** One line per variant for a side-by-side view: where the money goes (share by block), the bad cases, the effect. */
export function variantRow(v) {
  const c = v.c;
  return { id: v.id, name: v.name, mine: v.mine, fitsProfile: !!v.fitsProfile, split: Object.fromEntries(c.blocks.map((b) => [b.id, b.share])),
    stressPct: c.wrong?.stress?.pct ?? 0, histBadPct: c.wrong?.history?.badPct ?? null, histMidPct: c.wrong?.history?.midPct ?? null,
    protAfter: c.impact.protAfter, largestAfter: c.impact.largest?.after ?? null };
}
