// Mutations used by UI pages. All writes go through store.update (fresh read-modify-write).
import * as store from '../lib/store.js';
import * as E from '../lib/engine.js';
import { uid } from '../lib/format.js';
import { todayIso } from '../lib/jalali.js';
import { send, toast } from './components.js';

/** Long enough for a few years of salaries, payouts and trades (each event is small). */
const EVENTS_MAX = 3000;
const quotesNow = async () => (await store.load('quotes')).quotes || {};
/** Signed value of a quantity change at today's price (recorded so later analysis doesn't revalue it). */
const qtyValue = (a, dq, quotes) => { const p = E.unitPriceOf(a, quotes).price; return p > 0 ? (E.isLiability(a) ? -1 : 1) * dq * p : undefined; };

/** Turn back on the recurring flows a deletion paused (salary into a restored account, …). Occurrences that fell
 *  while it was deleted are not replayed — only the ones from today on. */
const reactivate = async (ids, since) => {
  if (!ids?.length) return;
  const last = since && since < todayIso() ? E.addDaysIso(todayIso(), -1) : null;
  await store.update('flows', (fl) => fl.map((f) => (ids.includes(f.id) ? { ...f, active: true, ...(last && (f.lastRun || '') < last ? { lastRun: last } : {}) } : f)));
};

export const act = {
  async setSettings(patch) { return store.update('settings', (s) => ({ ...s, ...patch })); },
  /** Watchlist: price-only refs shown on the market page and refreshed with everything else. */
  async watchAdd(ref) { return store.update('settings', (s) => ({ ...s, watch: [...(s.watch || []).filter((w) => E.quoteId(w) !== E.quoteId(ref)), ref] })); },
  async watchRemove(ref) { return store.update('settings', (s) => ({ ...s, watch: (s.watch || []).filter((w) => E.quoteId(w) !== E.quoteId(ref)) })); },

  /** opts.reval: a balance change is a re-appraisal (market move), not money in/out. Default: house, car, private shares. */
  async saveAsset(a, opts = {}) {
    const now = Date.now();
    let ev = null;
    const quotes = await quotesNow();
    // display code: a running counter, so a code is never given twice even after deletions
    let code = null;
    if (!a.code) {
      const { assets: all = [] } = await store.load('assets');
      await store.update('meta', (m) => {
        const n = Math.max(+m.lastCode || 0, ...all.map((x) => +(/^A-(\d+)$/.exec(x.code || '') || [])[1] || 0)) + 1;
        code = 'A-' + String(n).padStart(3, '0');
        return { ...m, lastCode: n };
      });
    }
    const list = await store.update('assets', (list) => {
      const i = list.findIndex((x) => x.id === a.id);
      const rec = { ...a, updatedAt: now };
      if (i >= 0) {
        const x = list[i]; let changes = [];
        const reval = opts.reval ?? E.APPRAISED.has(a.category);
        const sameMode = x.mode === a.mode;
        const RATE_KEYS = ['principal', 'annualPct', 'start', 'mode', 'basis', 'maturity'];
        // A different valuation method, price source or deposit terms is a correction of the record — not a market
        // move and not money moved: the whole jump in value is logged as one correction (undo restores the old record).
        const refChanged = sameMode && a.mode === 'units' && (x.price?.source !== a.price?.source
          || (a.price?.source === 'market' && (E.quoteId(x.price?.ref || {}) !== E.quoteId(a.price?.ref || {}) || (+x.price?.factor || 1) !== (+a.price?.factor || 1) || (+x.price?.adjustPct || 0) !== (+a.price?.adjustPct || 0))));
        const termsChanged = sameMode && a.mode === 'rate' && RATE_KEYS.some((k) => String(x.rate?.[k] ?? '') !== String(a.rate?.[k] ?? ''));
        const liabFlip = E.isLiability(x) !== E.isLiability(a);
        if (!sameMode || refChanged || termsChanged || liabFlip) {
          const before = E.valueOf(x, quotes, {}).signedValue; const after = E.valueOf(rec, quotes, {}).signedValue;
          // new price source not fetched yet: the size of the correction is filled in on the next price refresh
          const pending = rec.mode === 'units' && rec.price?.source === 'market' && E.unitPriceOf(rec, quotes).fallback;
          if (pending || Math.round(after - before)) {
            const id = uid('e');
            changes = [{ assetId: a.id, field: 'value', delta: 0, value: pending ? 0 : after - before, ...(pending ? { pending: true } : {}) }];
            if (pending) rec.price = { ...rec.price, pendingFix: { eventId: id, before, qty: +rec.quantity || 0 } };
            ev = { id, kind: 'edit', date: todayIso(), at: now, title: `اصلاح «${a.name}»`, amount: 0, changes, prev: x };
          }
        } else {
          if (a.mode === 'balance' && +x.balance !== +a.balance) changes.push({ assetId: a.id, field: 'balance', delta: +a.balance - (+x.balance || 0), ...(reval ? { reval: true } : {}) });
          if (a.mode === 'units' && +x.quantity !== +a.quantity) { const dq = +a.quantity - (+x.quantity || 0); changes.push({ assetId: a.id, field: 'quantity', delta: dq, value: qtyValue(rec, dq, quotes) }); }
          if (changes.length) ev = { id: uid('e'), kind: 'edit', date: todayIso(), at: now, title: `ویرایش «${a.name}»`, amount: 0, changes };
        }
        list[i] = rec;
      } else {
        const id = a.id || uid('a');
        if (!rec.code) rec.code = code;
        list.push({ ...rec, id, createdAt: now });
        // Record what was added, so later analysis treats it as money brought in, not as a market gain.
        const v = E.valueOf({ ...rec, id }, quotes, {}).signedValue;
        if (v) ev = { id: uid('e'), kind: 'edit', date: todayIso(), at: now, title: `افزودن «${a.name}»`, amount: 0, noUndo: true, changes: [{ assetId: id, field: 'add', delta: 0, value: v }] };
      }
      return list;
    });
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, EVENTS_MAX));
    if (a.mode === 'units' && a.price?.source === 'market' && a.price.ref?.key) send('quote', { ref: a.price.ref });
    if (a.mode === 'rate' || a.interest?.on) send('automate');
    send('badge');
    return list;
  },

  async patchAsset(id, patch, opts = {}) {
    let ev = null;
    const quotes = 'quantity' in patch ? await quotesNow() : {};
    const list = await store.update('assets', (list) => list.map((x) => {
      if (x.id !== id) return x;
      // Manual corrections of balance / quantity are logged so "why did it change" can tell them apart from market moves
      const changes = [];
      const reval = opts.reval ?? E.APPRAISED.has(x.category);
      if ('balance' in patch && +patch.balance !== +x.balance) changes.push({ assetId: id, field: 'balance', delta: +patch.balance - (+x.balance || 0), ...(reval ? { reval: true } : {}) });
      if ('quantity' in patch && +patch.quantity !== +x.quantity) { const dq = +patch.quantity - (+x.quantity || 0); changes.push({ assetId: id, field: 'quantity', delta: dq, value: qtyValue(x, dq, quotes) }); }
      if (changes.length) ev = { id: uid('e'), kind: 'edit', date: todayIso(), at: Date.now(), title: `ویرایش «${x.name}»`, amount: 0, changes };
      return { ...x, ...patch, updatedAt: Date.now() };
    }));
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, EVENTS_MAX));
    return list;
  },

  /** Apply reviewed page-capture rows: [{assetId, field, value}] and new assets */
  async applyCapture(rows, newAssets = [], source = '') {
    let ev = null;
    const quotes = await quotesNow();
    await store.update('assets', (assets) => {
      const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
      const changes = [];
      for (const r of rows) {
        const a = byId[r.assetId]; if (!a || r.value === null || !isFinite(r.value)) continue;
        if (r.field === 'quantity') { const dq = r.value - (+a.quantity || 0); changes.push({ assetId: a.id, field: 'quantity', delta: dq, value: qtyValue(a, dq, quotes) }); a.quantity = r.value; }
        else if (r.field === 'balance') { changes.push({ assetId: a.id, field: 'balance', delta: r.value - (+a.balance || 0) }); a.balance = r.value; a.balanceAt = Date.now(); }
        else if (r.field === 'rate.principal') { changes.push({ assetId: a.id, field: 'rate.principal', delta: r.value - (+a.rate.principal || 0) }); a.rate.principal = r.value; }
        else if (r.field === 'unit_price') { a.price = { ...a.price, value: r.value, updatedAt: Date.now() }; }
        a.updatedAt = Date.now();
      }
      for (const n of newAssets) {
        const rec = { ...n, id: n.id || uid('a'), createdAt: Date.now(), updatedAt: Date.now() };
        assets.push(rec);
        const v = E.valueOf(rec, quotes, {}).signedValue; // 0 when its price isn't known yet; the next snapshot then becomes its start
        if (v) changes.push({ assetId: rec.id, field: 'add', delta: 0, value: v });
      }
      ev = { id: uid('e'), kind: 'capture', date: todayIso(), at: Date.now(), title: `ثبت از صفحه${source ? ' «' + source + '»' : ''}`, amount: 0, changes };
      return assets;
    });
    if (ev && ev.changes.length) await store.update('events', (l) => [ev, ...l].slice(0, EVENTS_MAX));
    send('badge');
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
  async saveChat(messages) { return store.save({ chat: { messages: messages.slice(-60) } }); },

  async deleteAsset(id) {
    const { assets, quotes } = await store.load('assets', 'quotes');
    const removed = assets.find((a) => a.id === id);
    if (!removed) return;
    await store.update('assets', (list) => list.filter((x) => x.id !== id));
    const flowIds = [];
    await store.update('flows', (fl) => fl.map((f) => { if ((f.fromId === id || f.toId === id) && f.active) { flowIds.push(f.id); return { ...f, active: false }; } return f; }));
    // Log the value at removal: analysis then keeps the market effect up to now and treats the removal as bookkeeping.
    const v = E.valueOf(removed, quotes, {}).signedValue;
    const ev = { id: uid('e'), kind: 'edit', date: todayIso(), at: Date.now(), title: `حذف «${removed.name}»`, amount: 0, restore: removed, flowIds, changes: [{ assetId: id, field: 'remove', delta: 0, value: -v }] };
    await store.update('events', (l) => [ev, ...l].slice(0, EVENTS_MAX));
    const restore = async () => {
      await store.update('assets', (l) => (l.some((x) => x.id === id) ? l : [...l, removed]));
      await reactivate(flowIds, ev.date);
      await store.update('events', (l) => l.map((e) => (e.id === ev.id ? { ...e, undone: true } : e)));
    };
    toast(`«${removed.name}» حذف شد`, { label: 'بازگردانی', fn: restore });
  },

  async saveFlow(f) {
    await store.update('flows', (list) => {
      const i = list.findIndex((x) => x.id === f.id);
      if (i >= 0) list[i] = f; else list.push({ ...f, id: f.id || uid('f'), done: 0, createdAt: Date.now() });
      return list;
    });
    const r = await send('automate');
    if (r?.events) toast(`${r.events} مورد معوق از این جریان اعمال شد`);
  },
  async deleteFlow(id) { await store.update('flows', (l) => l.filter((x) => x.id !== id)); },

  async undoEvent(ev) {
    if (ev.noUndo) return;
    if (ev.prev) {
      // restoring the old record would wipe whatever happened to this asset afterwards
      const { events } = await store.load('events');
      const touches = (e) => e.toId === ev.prev.id || e.fromId === ev.prev.id || e.changes?.some((c) => c.assetId === ev.prev.id);
      if (events.some((e) => e.id !== ev.id && !e.undone && (e.at || 0) > (ev.at || 0) && touches(e))) return toast('اول تغییرهای بعدیِ همین دارایی را برگردان');
    }
    if (ev.restore) { await store.update('assets', (l) => (l.some((x) => x.id === ev.restore.id) ? l : [...l, ev.restore])); await reactivate(ev.flowIds, ev.date); }
    else if (ev.prev) await store.update('assets', (assets) => E.revertEvent(assets, ev));
    else await store.update('assets', (assets) => E.undoEvent(assets, ev));
    await store.update('events', (evs) => evs.map((e) => (e.id === ev.id ? { ...e, undone: true } : e)));
    toast('رویداد برگشت داده شد');
  },

  /** Buy/sell units; optionally settle against a cash (balance) asset */
  async trade({ assetId, side, qty, price, cashId, date }) {
    let ev;
    await store.update('assets', (assets) => {
      const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
      const a = byId[assetId]; if (!a) return assets;
      const changes = [];
      const q0 = +a.quantity || 0; const cb0 = +a.costBasis || 0;
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
      if (cashId && byId[cashId]) changes.push(...E.applyDelta(byId[cashId], side === 'buy' ? -amount : amount));
      ev = { id: uid('e'), kind: 'trade', date: date || todayIso(), at: Date.now(), title: `${side === 'buy' ? 'خرید' : 'فروش'} «${a.name}»`, amount, fromId: side === 'buy' ? cashId : assetId, toId: side === 'buy' ? assetId : cashId, changes };
      return assets;
    });
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, EVENTS_MAX));
  },

  /** Deposit/withdraw on a balance asset (logged) */
  async adjust({ assetId, delta, note }) {
    let ev;
    await store.update('assets', (assets) => {
      const a = assets.find((x) => x.id === assetId); if (!a) return assets;
      const changes = E.applyDelta(a, delta);
      ev = { id: uid('e'), kind: 'adjust', date: todayIso(), at: Date.now(), title: note || (delta >= 0 ? `واریز به «${a.name}»` : `برداشت از «${a.name}»`), amount: Math.abs(delta), toId: delta >= 0 ? a.id : null, fromId: delta < 0 ? a.id : null, changes };
      return assets;
    });
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, EVENTS_MAX));
  },

  /** Move money between two balance accounts (logged, undoable; not counted as income or spending). */
  async transfer({ fromId, toId, amount, note }) {
    let ev;
    await store.update('assets', (assets) => {
      const f = assets.find((x) => x.id === fromId); const t = assets.find((x) => x.id === toId);
      if (!f || !t || !(amount > 0)) return assets;
      const changes = [...E.applyDelta(f, -amount), ...E.applyDelta(t, amount)];
      f.updatedAt = t.updatedAt = Date.now();
      ev = { id: uid('e'), kind: 'adjust', date: todayIso(), at: Date.now(), title: note || `انتقال از «${f.name}» به «${t.name}»`, amount, fromId, toId, changes };
      return assets;
    });
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, EVENTS_MAX));
  },

  async saveAlert(al) {
    await store.update('alerts', (l) => { const i = l.findIndex((x) => x.id === al.id); if (i >= 0) l[i] = al; else l.unshift({ ...al, id: uid('al'), createdAt: Date.now(), active: true }); return l; });
    send('refresh');
  },
  async deleteAlert(id) { await store.update('alerts', (l) => l.filter((x) => x.id !== id)); },
};
