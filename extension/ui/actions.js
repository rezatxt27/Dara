// Mutations used by UI pages. All writes go through store.update (fresh read-modify-write).
import * as store from '../lib/store.js';
import * as E from '../lib/engine.js';
import { uid } from '../lib/format.js';
import { todayIso } from '../lib/jalali.js';
import { send, toast } from './components.js';

export const act = {
  async setSettings(patch) { return store.update('settings', (s) => ({ ...s, ...patch })); },
  /** Watchlist: price-only refs shown on the market page and refreshed with everything else. */
  async watchAdd(ref) { return store.update('settings', (s) => ({ ...s, watch: [...(s.watch || []).filter((w) => E.quoteId(w) !== E.quoteId(ref)), ref] })); },
  async watchRemove(ref) { return store.update('settings', (s) => ({ ...s, watch: (s.watch || []).filter((w) => E.quoteId(w) !== E.quoteId(ref)) })); },

  async saveAsset(a) {
    const now = Date.now();
    let ev = null;
    const list = await store.update('assets', (list) => {
      const i = list.findIndex((x) => x.id === a.id);
      const rec = { ...a, updatedAt: now };
      if (i >= 0) {
        const x = list[i]; const changes = [];
        if (x.mode === a.mode && a.mode === 'balance' && +x.balance !== +a.balance) changes.push({ assetId: a.id, field: 'balance', delta: +a.balance - (+x.balance || 0) });
        if (x.mode === a.mode && a.mode === 'units' && +x.quantity !== +a.quantity) changes.push({ assetId: a.id, field: 'quantity', delta: +a.quantity - (+x.quantity || 0) });
        if (x.mode === a.mode && a.mode === 'rate' && +x.rate?.principal !== +a.rate?.principal) changes.push({ assetId: a.id, field: 'rate.principal', delta: +a.rate.principal - (+x.rate?.principal || 0) });
        if (changes.length) ev = { id: uid('e'), kind: 'edit', date: todayIso(), at: now, title: `ویرایش «${a.name}»`, amount: 0, changes };
        list[i] = rec;
      } else list.push({ ...rec, id: a.id || uid('a'), createdAt: now });
      return list;
    });
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, 500));
    if (a.mode === 'units' && a.price?.source === 'market' && a.price.ref?.key) send('quote', { ref: a.price.ref });
    if (a.mode === 'rate' || a.interest?.on) send('automate');
    send('badge');
    return list;
  },

  async patchAsset(id, patch) {
    let ev = null;
    const list = await store.update('assets', (list) => list.map((x) => {
      if (x.id !== id) return x;
      // Manual corrections of balance / quantity are logged so "why did it change" can tell them apart from market moves
      const changes = [];
      if ('balance' in patch && +patch.balance !== +x.balance) changes.push({ assetId: id, field: 'balance', delta: +patch.balance - (+x.balance || 0) });
      if ('quantity' in patch && +patch.quantity !== +x.quantity) changes.push({ assetId: id, field: 'quantity', delta: +patch.quantity - (+x.quantity || 0) });
      if (changes.length) ev = { id: uid('e'), kind: 'edit', date: todayIso(), at: Date.now(), title: `ویرایش «${x.name}»`, amount: 0, changes };
      return { ...x, ...patch, updatedAt: Date.now() };
    }));
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, 500));
    return list;
  },

  /** Apply reviewed page-capture rows: [{assetId, field, value}] and new assets */
  async applyCapture(rows, newAssets = [], source = '') {
    let ev = null;
    await store.update('assets', (assets) => {
      const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
      const changes = [];
      for (const r of rows) {
        const a = byId[r.assetId]; if (!a || r.value === null || !isFinite(r.value)) continue;
        if (r.field === 'quantity') { changes.push({ assetId: a.id, field: 'quantity', delta: r.value - (+a.quantity || 0) }); a.quantity = r.value; }
        else if (r.field === 'balance') { changes.push({ assetId: a.id, field: 'balance', delta: r.value - (+a.balance || 0) }); a.balance = r.value; a.balanceAt = Date.now(); }
        else if (r.field === 'rate.principal') { changes.push({ assetId: a.id, field: 'rate.principal', delta: r.value - (+a.rate.principal || 0) }); a.rate.principal = r.value; }
        else if (r.field === 'unit_price') { a.price = { ...a.price, value: r.value, updatedAt: Date.now() }; }
        a.updatedAt = Date.now();
      }
      for (const n of newAssets) assets.push({ ...n, id: n.id || uid('a'), createdAt: Date.now(), updatedAt: Date.now() });
      ev = { id: uid('e'), kind: 'capture', date: todayIso(), at: Date.now(), title: `ثبت از صفحه${source ? ' «' + source + '»' : ''}`, amount: 0, changes };
      return assets;
    });
    if (ev && ev.changes.length) await store.update('events', (l) => [ev, ...l].slice(0, 500));
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
    const { assets } = await store.load('assets');
    const removed = assets.find((a) => a.id === id);
    await store.update('assets', (list) => list.filter((x) => x.id !== id));
    await store.update('flows', (fl) => fl.map((f) => (f.fromId === id || f.toId === id ? { ...f, active: false } : f)));
    toast(`«${removed?.name}» حذف شد`, { label: 'بازگردانی', fn: () => store.update('assets', (l) => [...l, removed]) });
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
    await store.update('assets', (assets) => E.undoEvent(assets, ev));
    await store.update('events', (evs) => evs.map((e) => (e.id === ev.id ? { ...e, undone: true } : e)));
    toast('رویداد برگشت داده شد');
  },

  /** Buy/sell units; optionally settle against a cash (balance) asset */
  async trade({ assetId, side, qty, price, cashId, date }) {
    let ev;
    await store.update('assets', (assets) => {
      const byId = Object.fromEntries(assets.map((a) => [a.id, a]));
      const a = byId[assetId]; if (!a) return assets;
      const amount = qty * price; const changes = [];
      const q0 = +a.quantity || 0; const cb0 = +a.costBasis || 0;
      if (side === 'buy') {
        a.quantity = q0 + qty; changes.push({ assetId, field: 'quantity', delta: qty });
        a.costBasis = cb0 + amount; changes.push({ assetId, field: 'costBasis', delta: amount });
      } else {
        const sellQ = Math.min(qty, q0);
        a.quantity = q0 - sellQ; changes.push({ assetId, field: 'quantity', delta: -sellQ });
        const dc = q0 ? -cb0 * (sellQ / q0) : 0;
        if (cb0) { a.costBasis = cb0 + dc; changes.push({ assetId, field: 'costBasis', delta: dc }); }
      }
      a.updatedAt = Date.now();
      if (cashId && byId[cashId]) changes.push(...E.applyDelta(byId[cashId], side === 'buy' ? -amount : amount));
      ev = { id: uid('e'), kind: 'trade', date: date || todayIso(), at: Date.now(), title: `${side === 'buy' ? 'خرید' : 'فروش'} «${a.name}»`, amount, fromId: side === 'buy' ? cashId : assetId, toId: side === 'buy' ? assetId : cashId, changes };
      return assets;
    });
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, 500));
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
    if (ev) await store.update('events', (l) => [ev, ...l].slice(0, 500));
  },

  async saveAlert(al) {
    await store.update('alerts', (l) => { const i = l.findIndex((x) => x.id === al.id); if (i >= 0) l[i] = al; else l.unshift({ ...al, id: uid('al'), createdAt: Date.now(), active: true }); return l; });
    send('refresh');
  },
  async deleteAlert(id) { await store.update('alerts', (l) => l.filter((x) => x.id !== id)); },
};
