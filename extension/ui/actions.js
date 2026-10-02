// Mutations used by UI pages. Every write is one atomic, locked read-modify-write on the freshest stored data
// (store.mutate), so a page and the background worker can't overwrite each other's changes.
import * as store from '../lib/store.js';
import * as E from '../lib/engine.js';
import { uid } from '../lib/format.js';
import { todayIso } from '../lib/jalali.js';
import { send, toast } from './components.js';

const EVENTS_MAX = E.EVENTS_MAX;
const logEv = (st, ...evs) => { const add = evs.filter(Boolean); if (add.length) st.events = [...add, ...st.events].slice(0, EVENTS_MAX); };
/** Signed value of a quantity change at today's price (recorded so later analysis doesn't revalue it). */
const qtyValue = (a, dq, quotes) => { const p = E.unitPriceOf(a, quotes).price; return p > 0 ? (E.isLiability(a) ? -1 : 1) * dq * p : undefined; };
/** Cost basis follows a quantity change: more units add what they're worth today, fewer remove their share. */
function costAfter(a, q0, q1, quotes) {
  const cb = +a.costBasis || 0; if (!(cb > 0)) return a.costBasis;
  if (q1 > q0) return cb + (q1 - q0) * (E.unitPriceOf(a, quotes).price || 0);
  return q0 > 0 ? cb * (q1 / q0) : cb;
}
const maxIso = (a, b) => (!a ? b || null : !b ? a : a > b ? a : b);
const num = (v) => +v || 0;
/** Let the worker apply anything that fell due (installment, payout, salary) before a manual change to the same assets. */
const catchUp = () => send('automate').catch(() => null);

/** Turn back on what a deletion paused (salary into a restored account, a loan's account…). Occurrences that fell
 *  while it was deleted are not replayed — only the ones from today on. */
function relink(st, ev) {
  const last = ev.date && ev.date < todayIso() ? E.addDaysIso(todayIso(), -1) : null;
  st.flows = st.flows.map((f) => ((ev.flowIds || []).includes(f.id) ? { ...f, active: true, paused: undefined, ...(last && (f.lastRun || '') < last ? { lastRun: last } : {}) } : f));
  for (const u of ev.unlinked || []) {
    const x = st.assets.find((y) => y.id === u.id); if (!x) continue;
    const back = (ev.restore || ev.prev).id;
    if (u.f === 'loan.account' && x.loan && !x.loan.account) x.loan = { ...x.loan, account: back };
    if (u.f === 'rate.payoutTo' && x.rate && (!x.rate.payoutTo || x.rate.payoutTo === 'self')) x.rate = { ...x.rate, payoutTo: back };
  }
}

const RATE_KEYS = ['principal', 'annualPct', 'start', 'mode', 'basis', 'maturity'];
const LOAN_KEYS = ['amount', 'annualPct', 'months', 'firstDue', 'start', 'installment', 'settledAt'];
const diffKeys = (p, q, keys) => keys.some((k) => String(p?.[k] ?? '') !== String(q?.[k] ?? ''));

export const act = {
  async setSettings(patch) { return store.update('settings', (s) => ({ ...s, ...patch })); },
  /** Watchlist: price-only refs shown on the market page and refreshed with everything else. */
  async watchAdd(ref) { return store.update('settings', (s) => ({ ...s, watch: [...(s.watch || []).filter((w) => E.quoteId(w) !== E.quoteId(ref)), ref] })); },
  async watchRemove(ref) { return store.update('settings', (s) => ({ ...s, watch: (s.watch || []).filter((w) => E.quoteId(w) !== E.quoteId(ref)) })); },

  /**
   * Save an asset from the editor.
   * opts.orig: the record as it was when the editor opened. Only what the user changed is applied to the freshest stored
   *   record — an installment, payout or salary that landed meanwhile is kept, never applied twice or lost.
   * opts.reval: a balance change is a re-appraisal (market move), not money in/out. Default: house, car, private shares.
   * opts.fund (new assets): { accountId, amount } — bought with money from that account (or, for a loan, its money went
   *   into that account). Recorded as one transfer, so it's neither new money nor a gain.
   */
  async saveAsset(a, opts = {}) {
    const now = Date.now(); const today = todayIso();
    let ev = null;
    await catchUp(); // anything due (interest, installments) lands before this change
    await store.mutate(['assets', 'events', 'meta', 'quotes'], (st) => {
      const { quotes } = st; const list = st.assets;
      const i = list.findIndex((x) => x.id === a.id);
      const rec = { ...a, updatedAt: now };
      if (i >= 0) {
        const x = list[i]; const o = opts.orig || x; let paidIn = 0;
        const sameMode = x.mode === rec.mode && o.mode === rec.mode;
        const reval = opts.reval ?? E.APPRAISED.has(rec.category);
        // what the user changed in the form (compared with what the form opened with)
        const termsChanged = sameMode && ((rec.mode === 'rate' && diffKeys(o.rate, rec.rate, RATE_KEYS))
          || (rec.mode === 'loan' && diffKeys(o.loan, rec.loan, LOAN_KEYS)));
        if (sameMode) {
          // numbers the user didn't touch follow the stored record; the ones they edited move by the same amount
          if (rec.mode === 'balance') rec.balance = num(x.balance) + (num(rec.balance) - num(o.balance));
          if (rec.mode === 'units') rec.quantity = num(x.quantity) + (num(rec.quantity) - num(o.quantity));
          // payouts and mid-period offsets belong to the automation: always the stored ones (a new start date resets them below)
          if (rec.mode === 'rate' && x.rate) rec.rate = { ...rec.rate, principal: num(x.rate.principal) + (num(rec.rate?.principal) - num(o.rate?.principal)),
            lastPayout: maxIso(x.rate.lastPayout, rec.rate?.lastPayout) || undefined, offset: x.rate.offset, offsetFrom: x.rate.offsetFrom };
          if (rec.mode === 'loan' && x.loan && !termsChanged) rec.loan = { ...x.loan, account: rec.loan && 'account' in rec.loan ? rec.loan.account || null : x.loan.account };
          if (rec.costBasis !== undefined || x.costBasis !== undefined) rec.costBasis = num(rec.costBasis) === num(o.costBasis) ? x.costBasis : num(x.costBasis) + (num(rec.costBasis) - num(o.costBasis));
        }
        // automation-owned fields always come from the stored record
        if (x.interest && rec.interest) {
          rec.interest = { ...rec.interest, accrued: x.interest.accrued, lastAccrual: x.interest.lastAccrual, lastPaid: x.interest.lastPaid };
          // switching day-count interest off pays what had accrued into the balance (nothing is lost)
          if (x.interest.on && !rec.interest.on) {
            const acc = Math.floor(E.balanceInterestLive(x, today, Date.now()).accrued);
            if (acc >= 1) { rec.balance = num(rec.balance) + acc; paidIn = acc; }
            rec.interest.accrued = 0;
          }
          if (!x.interest.on && rec.interest.on) rec.interest = { ...rec.interest, since: today, lastAccrual: null, accrued: 0 };
        }
        if (x.price && rec.price) rec.price = { ...rec.price, ...(E.quoteId(x.price.ref || {}) === E.quoteId(rec.price.ref || {}) ? { last: x.price.last ?? rec.price.last } : {}), pendingFix: x.price.pendingFix };
        // new terms: installments / payouts that fell before they were entered are history, not something to pay again
        if (rec.mode === 'loan' && rec.loan && (!sameMode || termsChanged)) {
          const nl = { ...rec.loan }; if (x.loan?.firstDue !== nl.firstDue) delete nl.anchor;
          rec.loan = { ...nl, lastRun: maxIso(x.mode === 'loan' ? x.loan?.lastRun : null, E.loanLastDue(nl)) };
        }
        if (rec.mode === 'rate' && rec.rate?.mode === 'payout' && (!sameMode || x.rate?.start !== rec.rate.start)) {
          const p = E.prevMonthlyOnOrBefore(rec.rate.start, today);
          rec.rate = { ...rec.rate, lastPayout: p > rec.rate.start ? p : undefined, offset: 0, offsetFrom: undefined };
        }
        const refChanged = sameMode && rec.mode === 'units' && (x.price?.source !== rec.price?.source
          || (rec.price?.source === 'market' && (E.quoteId(x.price?.ref || {}) !== E.quoteId(rec.price?.ref || {}) || (+x.price?.factor || 1) !== (+rec.price?.factor || 1) || (+x.price?.adjustPct || 0) !== (+rec.price?.adjustPct || 0))));
        const liabFlip = E.isLiability(x) !== E.isLiability(rec);
        if (!sameMode || refChanged || termsChanged || liabFlip) {
          // A different valuation method, price source or terms is a correction of the record — not a market move and
          // not money moved: the whole jump in value is one correction (undo restores the old record). Always logged.
          const before = E.valueOf(x, quotes, {}).signedValue; const after = E.valueOf(rec, quotes, {}).signedValue;
          // new price source not fetched yet: the size of the correction is filled in on the next price refresh
          const pending = rec.mode === 'units' && rec.price?.source === 'market' && E.unitPriceOf(rec, quotes).fallback;
          const id = uid('e');
          if (pending) rec.price = { ...rec.price, pendingFix: { eventId: id, before, qty: +rec.quantity || 0 } };
          ev = { id, kind: 'edit', date: today, at: now, title: `اصلاح «${rec.name}»`, amount: 0, prev: x,
            changes: [{ assetId: rec.id, field: 'value', delta: 0, value: pending ? 0 : after - before, ...(pending ? { pending: true } : {}) }] };
        } else {
          const changes = [];
          // interest that was already counted moving into the balance isn't a change the user made
          const db = num(rec.balance) - num(x.balance) - paidIn;
          if (rec.mode === 'balance' && Math.abs(db) >= 1) changes.push({ assetId: rec.id, field: 'balance', delta: db, ...(reval ? { reval: true } : {}) });
          if (rec.mode === 'units' && num(x.quantity) !== num(rec.quantity)) {
            const dq = num(rec.quantity) - num(x.quantity);
            changes.push({ assetId: rec.id, field: 'quantity', delta: dq, value: qtyValue(rec, dq, quotes) });
            // the cost follows the quantity unless the user set the cost themselves
            if (num(rec.costBasis) === num(x.costBasis)) rec.costBasis = costAfter(x, num(x.quantity), num(rec.quantity), quotes);
          }
          if (changes.length) ev = { id: uid('e'), kind: 'edit', date: today, at: now, title: `ویرایش «${rec.name}»`, amount: 0, changes };
        }
        list[i] = rec;
      } else {
        const id = rec.id || uid('a'); rec.id = id;
        if (!rec.code) {
          // display code: a running counter, so a code is never given twice even after deletions
          const n = Math.max(+st.meta.lastCode || 0, ...list.map((x) => +(/^A-(\d+)$/.exec(x.code || '') || [])[1] || 0)) + 1;
          rec.code = 'A-' + String(n).padStart(3, '0'); st.meta = { ...st.meta, lastCode: n };
        }
        if (rec.mode === 'loan' && rec.loan) rec.loan = { ...rec.loan, lastRun: E.loanLastDue(rec.loan) };
        if (rec.mode === 'rate' && rec.rate?.mode === 'payout' && rec.rate.start < today) {
          // a deposit you already had: its past monthly payouts were paid before you registered it
          const p = E.prevMonthlyOnOrBefore(rec.rate.start, today); if (p > rec.rate.start) rec.rate = { ...rec.rate, lastPayout: p };
        }
        const liab = E.isLiability(rec);
        const acc = opts.fund?.accountId ? list.find((x) => x.id === opts.fund.accountId && !x.archived) : null;
        const paid = acc ? Math.round(+opts.fund.amount || 0) : 0;
        if (acc && paid > 0 && !liab && rec.mode !== 'rate' && !(+rec.costBasis > 0)) rec.costBasis = paid; // what it actually cost
        list.push({ ...rec, createdAt: now });
        if (acc && paid > 0) {
          // one transfer: out of the account into the new asset (a loan's money: into the account)
          const accChanges = E.applyDelta(acc, liab ? paid : -paid, quotes);
          ev = { id: uid('e'), kind: 'edit', date: today, at: now, title: `افزودن «${rec.name}» ${liab ? 'با واریز به' : 'از'} «${acc.name}»`, amount: paid,
            fund: { accountId: acc.id, amount: paid }, changes: [{ assetId: id, field: 'add', delta: 0, value: liab ? -paid : paid }, ...accChanges] };
        } else {
          // Record what was added, so later analysis treats it as money brought in, not as a market gain.
          const v = E.valueOf(rec, quotes, {}).signedValue;
          if (v) ev = { id: uid('e'), kind: 'edit', date: today, at: now, title: `افزودن «${rec.name}»`, amount: 0, noUndo: true, changes: [{ assetId: id, field: 'add', delta: 0, value: v }] };
        }
      }
      logEv(st, ev);
    });
    if (a.mode === 'units' && a.price?.source === 'market' && a.price.ref?.key) send('quote', { ref: a.price.ref });
    if (a.mode === 'rate' || a.mode === 'loan' || a.interest?.on) await catchUp();
    send('badge');
    return ev;
  },

  async patchAsset(id, patch, opts = {}) {
    let ev = null;
    await store.mutate(['assets', 'events', 'quotes'], (st) => {
      const x = st.assets.find((y) => y.id === id); if (!x) return;
      // Manual corrections of balance / quantity are logged so "why did it change" can tell them apart from market moves
      const changes = [];
      const reval = opts.reval ?? E.APPRAISED.has(x.category);
      const next = { ...x, ...patch, updatedAt: Date.now() };
      if ('balance' in patch && num(patch.balance) !== num(x.balance)) changes.push({ assetId: id, field: 'balance', delta: num(patch.balance) - num(x.balance), ...(reval ? { reval: true } : {}) });
      if ('quantity' in patch && num(patch.quantity) !== num(x.quantity)) {
        const dq = num(patch.quantity) - num(x.quantity);
        changes.push({ assetId: id, field: 'quantity', delta: dq, value: qtyValue(x, dq, st.quotes) });
        if (!('costBasis' in patch)) next.costBasis = costAfter(x, num(x.quantity), num(patch.quantity), st.quotes);
      }
      if ('price' in patch && x.mode === 'units' && num(patch.price?.value) !== num(x.price?.value)) changes.push({ assetId: id, field: 'price.value', delta: num(patch.price.value) - num(x.price?.value) });
      if (changes.length) ev = { id: uid('e'), kind: 'edit', date: todayIso(), at: Date.now(), title: `ویرایش «${x.name}»`, amount: 0, changes };
      Object.assign(x, next);
      logEv(st, ev);
    });
    return ev;
  },

  /** Apply reviewed page-capture rows: [{assetId, field, value}] and new assets */
  async applyCapture(rows, newAssets = [], source = '') {
    let ev = null;
    await catchUp();
    await store.mutate(['assets', 'events', 'quotes'], (st) => {
      const { quotes } = st;
      const byId = Object.fromEntries(st.assets.map((a) => [a.id, a]));
      const changes = [];
      for (const r of rows) {
        const a = byId[r.assetId]; if (!a || r.value === null || !isFinite(r.value)) continue;
        if (r.field === 'quantity') {
          const q0 = num(a.quantity); const dq = r.value - q0;
          changes.push({ assetId: a.id, field: 'quantity', delta: dq, value: qtyValue(a, dq, quotes) });
          a.costBasis = costAfter(a, q0, r.value, quotes); a.quantity = r.value;
        } else if (r.field === 'balance') { changes.push({ assetId: a.id, field: 'balance', delta: r.value - num(a.balance) }); a.balance = r.value; a.balanceAt = Date.now(); }
        else if (r.field === 'rate.principal' && a.mode === 'rate') {
          // the page shows what the deposit is worth now (a payout deposit: its principal) — move it there, interest kept
          const liab = E.isLiability(a);
          const cur = a.rate.mode === 'payout' ? num(a.rate.principal) : E.valueOf(a, quotes, {}).value;
          const diff = r.value - cur;
          if (Math.abs(diff) >= 1) changes.push(...E.applyDelta(a, liab ? -diff : diff, quotes).map((c) => (c.field === 'rate.principal' ? { ...c, value: liab ? -diff : diff } : c)));
        } else if (r.field === 'loan.balance' && a.mode === 'loan') {
          // the bank's figure for what is left: re-base the schedule on it, logged as a correction
          const before = E.valueOf(a, quotes, {}).signedValue;
          const ch = E.loanRebase(a, r.value);
          changes.push(...ch.map((c) => ({ ...c, value: E.valueOf(a, quotes, {}).signedValue - before })));
        } else if (r.field === 'unit_price') { a.price = { ...a.price, value: r.value, updatedAt: Date.now() }; }
        a.updatedAt = Date.now();
      }
      for (const n of newAssets) {
        const rec = { ...n, id: n.id || uid('a'), createdAt: Date.now(), updatedAt: Date.now() };
        st.assets.push(rec);
        const v = E.valueOf(rec, quotes, {}).signedValue; // 0 when its price isn't known yet; the next snapshot then becomes its start
        changes.push({ assetId: rec.id, field: 'add', delta: 0, value: v || 0 });
      }
      ev = changes.length ? { id: uid('e'), kind: 'capture', date: todayIso(), at: Date.now(), title: `ثبت از صفحه${source ? ' «' + source + '»' : ''}`, amount: 0, changes } : null;
      logEv(st, ev);
    });
    send('badge');
    return ev;
  },

  /* ---------- AI connections ---------- */
  async saveConnection(c) {
    return store.update('ai', (ai) => {
      const list = ai.connections || [];
      const i = list.findIndex((x) => x.id === c.id);
      if (i >= 0) list[i] = { ...list[i], ...c }; else list.push({ ...c, id: c.id || uid('c'), createdAt: Date.now() });
      return { ...ai, connections: list, activeId: ai.activeId && list.some((x) => x.id === ai.activeId) ? ai.activeId : list[0].id };
    });
  },
  async patchConnection(id, patch) { return store.update('ai', (ai) => ({ ...ai, connections: (ai.connections || []).map((c) => (c.id === id ? { ...c, ...patch } : c)) })); },
  async deleteConnection(id) {
    return store.update('ai', (ai) => { const connections = (ai.connections || []).filter((c) => c.id !== id); return { ...ai, connections, activeId: ai.activeId === id ? connections[0]?.id || null : ai.activeId }; });
  },
  async setAI(patch) { return store.update('ai', (ai) => ({ ...ai, ...patch })); },
  async saveChat(messages) { return store.locked(() => store.save({ chat: { messages: messages.slice(-60) } })); },

  async deleteAsset(id) {
    let ev = null;
    await store.mutate(['assets', 'flows', 'events', 'quotes'], (st) => {
      const removed = st.assets.find((a) => a.id === id); if (!removed) return;
      st.assets = st.assets.filter((x) => x.id !== id);
      // what pointed at it is paused or unlinked (and comes back with it)
      const flowIds = []; const unlinked = [];
      st.flows = st.flows.map((f) => { if ((f.fromId === id || f.toId === id) && f.active) { flowIds.push(f.id); return { ...f, active: false }; } return f; });
      for (const x of st.assets) {
        if (x.mode === 'loan' && x.loan?.account === id) { x.loan = { ...x.loan, account: null }; unlinked.push({ id: x.id, f: 'loan.account' }); }
        if (x.mode === 'rate' && x.rate?.payoutTo === id) { x.rate = { ...x.rate, payoutTo: 'self' }; unlinked.push({ id: x.id, f: 'rate.payoutTo' }); }
      }
      // Log the value at removal: analysis then keeps the market effect up to now and treats the removal as bookkeeping.
      const v = E.valueOf(removed, st.quotes, {}).signedValue;
      ev = { id: uid('e'), kind: 'edit', date: todayIso(), at: Date.now(), title: `حذف «${removed.name}»`, amount: 0, restore: removed, flowIds, unlinked, changes: [{ assetId: id, field: 'remove', delta: 0, value: -v }] };
      logEv(st, ev);
    });
    if (!ev) return null;
    toast(`«${ev.restore.name}» حذف شد`, { label: 'برگشت', fn: () => act.undoEvent(ev) });
    return ev;
  },

  async saveFlow(f) {
    await store.update('flows', (list) => {
      const i = list.findIndex((x) => x.id === f.id);
      // keep what the automation owns (last run, count done) from the stored flow
      if (i >= 0) { const x = list[i]; list[i] = { ...f, lastRun: f.resetFrom !== undefined ? f.resetFrom : x.lastRun, done: x.done, paused: f.active ? undefined : x.paused }; delete list[i].resetFrom; }
      else list.push({ ...f, id: f.id || uid('f'), done: +f.done || 0, createdAt: Date.now() });
      return list;
    });
    const r = await catchUp();
    if (r?.events) toast(`${r.events} مورد معوق از این جریان اعمال شد`);
  },
  async deleteFlow(id) { await store.update('flows', (l) => l.filter((x) => x.id !== id)); },

  async undoEvent(ev) {
    if (ev.noUndo || ev.reversedBy || ev.undone) return;
    if (ev.fund) return act.reverseFundedAdd(ev);
    let refused = false;
    await store.mutate(['assets', 'flows', 'events'], (st) => {
      const cur = st.events.find((e) => e.id === ev.id);
      if (!cur || cur.undone) { refused = true; return; }
      // restoring an earlier record (or earlier loan terms) would wipe whatever happened to that asset afterwards
      const restoresId = ev.prev?.id || ev.changes?.find((c) => c.field === 'loan')?.assetId;
      if (restoresId) {
        const touches = (e) => e.toId === restoresId || e.fromId === restoresId || e.changes?.some((c) => c.assetId === restoresId);
        const idx = st.events.findIndex((e) => e.id === ev.id); // newest first: earlier in the list = later in time
        if (st.events.slice(0, idx).some((e) => !e.undone && touches(e))) { refused = 'later'; return; }
      }
      if (ev.restore) {
        if (!st.assets.some((x) => x.id === ev.restore.id)) st.assets.push(ev.restore);
        E.undoEvent(st.assets, { changes: (ev.changes || []).filter((c) => c.assetId !== ev.restore.id) });
        relink(st, ev);
        if (ev.reversalOf) st.events = st.events.map((e) => (e.id === ev.reversalOf ? { ...e, reversedBy: null } : e));
      } else if (ev.prev) { E.revertEvent(st.assets, ev); if (ev.flowIds || ev.unlinked) relink(st, ev); }
      else {
        E.undoEvent(st.assets, ev);
        // a page capture that created assets: they go too
        const added = (ev.changes || []).filter((c) => c.field === 'add').map((c) => c.assetId);
        if (added.length) st.assets = st.assets.filter((x) => !added.includes(x.id));
      }
      st.events = st.events.map((e) => (e.id === ev.id ? { ...e, undone: true } : e));
    });
    if (refused === 'later') return toast('اول تغییرهای بعدیِ همین دارایی را برگردان');
    if (!refused) toast('برگشت داده شد');
  },

  /**
   * Undo «added with money from an account»: a reversing entry (asset out at today's value, money back to the account),
   * so every period before and after stays consistent. Undoing the reversal brings both back.
   */
  async reverseFundedAdd(ev) {
    const id = ev.changes.find((c) => c.field === 'add')?.assetId;
    let msg = null;
    await store.mutate(['assets', 'events', 'quotes'], (st) => {
      const a = st.assets.find((x) => x.id === id);
      if (!a) { msg = 'این دارایی دیگر وجود ندارد'; return; }
      // after a sale, a payment or an installment the original amount no longer matches what is there
      const touches = (e) => e.toId === id || e.fromId === id || e.changes?.some((c) => c.assetId === id);
      // the log is newest first: anything before this entry happened after it
      const idx = st.events.findIndex((e) => e.id === ev.id);
      if (st.events.slice(0, idx < 0 ? 0 : idx).some((e) => !e.undone && touches(e))) { msg = 'بعد از افزودن، تغییرهای دیگری روی این دارایی ثبت شده؛ اول آن‌ها را برگردان یا دارایی را حذف کن'; return; }
      const acc = st.assets.find((x) => x.id === ev.fund.accountId);
      // the money has to go back somewhere: with its account deleted, bring the account back first
      if (!acc) { msg = 'حسابی که پول از آن آمده بود حذف شده؛ اول آن را از «گزارش رویدادها» برگردان'; return; }
      const changes = [{ assetId: id, field: 'remove', delta: 0, value: -E.valueOf(a, st.quotes, {}).signedValue }];
      if (acc) changes.push(...E.applyDelta(acc, E.isLiability(a) ? -ev.fund.amount : ev.fund.amount, st.quotes));
      const rev = { id: uid('e'), kind: 'edit', date: todayIso(), at: Date.now(), title: `برگشت افزودن «${a.name}»`, amount: ev.fund.amount, restore: a, reversalOf: ev.id, changes };
      st.assets = st.assets.filter((x) => x.id !== id);
      st.events = [rev, ...st.events.map((e) => (e.id === ev.id ? { ...e, reversedBy: rev.id } : e))].slice(0, EVENTS_MAX);
      msg = E.isLiability(a) ? 'افزودن برگشت داده شد و مبلغ از حساب کم شد' : 'افزودن برگشت داده شد و پول به حساب برگشت';
    });
    toast(msg);
  },

  /** Buy/sell units; optionally settle against a cash (balance) asset */
  async trade({ assetId, side, qty, price, cashId, date }) {
    let ev = null;
    await catchUp();
    await store.mutate(['assets', 'events', 'quotes'], (st) => {
      const byId = Object.fromEntries(st.assets.map((a) => [a.id, a]));
      const a = byId[assetId]; if (!a) return;
      const changes = [];
      const q0 = num(a.quantity); const cb0 = num(a.costBasis);
      // never sell more than is held; cash and the event follow the quantity actually sold
      const sellQ = Math.min(qty, q0);
      const amount = (side === 'buy' ? qty : sellQ) * price;
      if (side === 'buy') {
        a.quantity = q0 + qty; changes.push({ assetId, field: 'quantity', delta: qty });
        a.costBasis = cb0 + amount; changes.push({ assetId, field: 'costBasis', delta: amount });
      } else {
        a.quantity = q0 - sellQ; changes.push({ assetId, field: 'quantity', delta: -sellQ });
        const dc = q0 ? -cb0 * (sellQ / q0) : 0;
        if (cb0) { a.costBasis = cb0 + dc; changes.push({ assetId, field: 'costBasis', delta: dc }); }
      }
      a.updatedAt = Date.now();
      if (cashId && byId[cashId]) changes.push(...E.applyDelta(byId[cashId], side === 'buy' ? -amount : amount, st.quotes));
      ev = { id: uid('e'), kind: 'trade', date: date || todayIso(), at: Date.now(), title: `${side === 'buy' ? 'خرید' : 'فروش'} «${a.name}»`, amount, fromId: side === 'buy' ? cashId || null : assetId, toId: side === 'buy' ? assetId : cashId || null, changes };
      logEv(st, ev);
    });
    return ev;
  },

  /** Deposit/withdraw on one asset (logged) */
  async adjust({ assetId, delta, note }) {
    let ev = null;
    await catchUp();
    await store.mutate(['assets', 'events', 'quotes'], (st) => {
      const a = st.assets.find((x) => x.id === assetId); if (!a) return;
      const changes = E.applyDelta(a, delta, st.quotes);
      ev = { id: uid('e'), kind: 'adjust', date: todayIso(), at: Date.now(), title: note || (delta >= 0 ? `واریز به «${a.name}»` : `برداشت از «${a.name}»`), amount: Math.abs(delta), toId: delta >= 0 ? a.id : null, fromId: delta < 0 ? a.id : null, changes };
      logEv(st, ev);
    });
    return ev;
  },

  /** Move money between two of your assets (logged, undoable; not counted as income or spending). */
  async transfer({ fromId, toId, amount, note }) {
    let ev = null;
    await catchUp();
    await store.mutate(['assets', 'events', 'quotes'], (st) => {
      const f = st.assets.find((x) => x.id === fromId); const t = st.assets.find((x) => x.id === toId);
      if (!f || !t || !(amount > 0)) return;
      const changes = [...E.applyDelta(f, -amount, st.quotes), ...E.applyDelta(t, amount, st.quotes)];
      f.updatedAt = t.updatedAt = Date.now();
      ev = { id: uid('e'), kind: 'adjust', date: todayIso(), at: Date.now(), title: note || `انتقال از «${f.name}» به «${t.name}»`, amount, fromId, toId, changes };
      logEv(st, ev);
    });
    return ev;
  },

  /** Pay off (or collect) an installment loan in full: the amount is what is owed at this very moment. */
  async settleLoan({ loanId, accountId }) {
    let ev = null;
    await catchUp();
    await store.mutate(['assets', 'events', 'quotes'], (st) => {
      const a = st.assets.find((x) => x.id === loanId); if (!a || a.mode !== 'loan') return;
      const liab = E.isLiability(a);
      const amount = Math.round(E.loanState(a.loan, todayIso(), Date.now()).value); if (!(amount > 0)) return;
      const acc = accountId ? st.assets.find((x) => x.id === accountId) : null;
      const changes = [...(acc ? E.applyDelta(acc, liab ? -amount : amount, st.quotes) : []), ...E.applyDelta(a, liab ? amount : -amount, st.quotes)];
      ev = { id: uid('e'), kind: 'adjust', date: todayIso(), at: Date.now(), title: `تسویه «${a.name}»`, amount,
        fromId: liab ? acc?.id || null : a.id, toId: liab ? a.id : acc?.id || null, changes };
      logEv(st, ev);
    });
    return ev;
  },

  /** A matured deposit: move everything to an account and close it (undo brings it back as it was). */
  async closeDeposit({ assetId, accountId }) {
    let ev = null;
    await catchUp();
    await store.mutate(['assets', 'flows', 'events', 'quotes'], (st) => {
      const a = st.assets.find((x) => x.id === assetId); const acc = st.assets.find((x) => x.id === accountId);
      if (!a || !acc || a.mode !== 'rate') return;
      const prev = structuredClone(a); const liab = E.isLiability(a);
      const amount = Math.round(E.valueOf(a, st.quotes, {}).value);
      // a removal worth nothing (its money just moved): what it earned (or cost) up to now stays a market result
      const changes = [...E.applyDelta(acc, liab ? -amount : amount, st.quotes), { assetId: a.id, field: 'remove', delta: 0, value: 0 }];
      a.rate = { ...a.rate, principal: 0, offset: 0 }; a.archived = true; a.updatedAt = Date.now();
      // like a deletion: recurring flows into or out of it pause; a loan or payout using it as its account unlinks
      const flowIds = []; const unlinked = [];
      st.flows = st.flows.map((f) => { if ((f.fromId === a.id || f.toId === a.id) && f.active) { flowIds.push(f.id); return { ...f, active: false }; } return f; });
      for (const x of st.assets) {
        if (x.mode === 'loan' && x.loan?.account === a.id) { x.loan = { ...x.loan, account: null }; unlinked.push({ id: x.id, f: 'loan.account' }); }
        if (x.mode === 'rate' && x.rate?.payoutTo === a.id) { x.rate = { ...x.rate, payoutTo: 'self' }; unlinked.push({ id: x.id, f: 'rate.payoutTo' }); }
      }
      ev = { id: uid('e'), kind: 'adjust', date: todayIso(), at: Date.now(), title: liab ? `تسویه «${a.name}» از «${acc.name}»` : `انتقال «${a.name}» به «${acc.name}» و بستن آن`, amount,
        fromId: liab ? acc.id : a.id, toId: liab ? a.id : acc.id, changes, prev, flowIds, unlinked };
      logEv(st, ev);
    });
    return ev;
  },

  /** Renew a deposit: what it is worth today becomes the new principal, from today to the new maturity (no jump in value). */
  async renewDeposit({ assetId, maturity, annualPct }) {
    let ev = null;
    await catchUp();
    await store.mutate(['assets', 'events', 'quotes'], (st) => {
      const a = st.assets.find((x) => x.id === assetId); if (!a || a.mode !== 'rate') return;
      const prev = structuredClone(a); const today = todayIso();
      const v = E.rateValue(a.rate, today, Date.now());
      a.rate = { ...a.rate, principal: v, start: today, maturity: maturity || null, annualPct: annualPct ?? a.rate.annualPct, lastPayout: undefined, offset: 0, offsetFrom: undefined };
      a.updatedAt = Date.now();
      ev = { id: uid('e'), kind: 'edit', date: today, at: Date.now(), title: `تمدید «${a.name}»`, amount: 0, prev, changes: [{ assetId: a.id, field: 'value', delta: 0, value: 0 }] };
      logEv(st, ev);
    });
    return ev;
  },

  async saveAlert(al) {
    await store.update('alerts', (l) => { const i = l.findIndex((x) => x.id === al.id); if (i >= 0) l[i] = al; else l.unshift({ ...al, id: uid('al'), createdAt: Date.now(), active: true }); return l; });
    send('refresh');
  },
  async deleteAlert(id) { await store.update('alerts', (l) => l.filter((x) => x.id !== id)); },
};

/** Toast for a recorded change with a one-tap undo. */
export function doneToast(msg, ev) { toast(msg, ev && !ev.noUndo ? { label: 'برگشت', fn: () => act.undoEvent(ev) } : undefined); }
