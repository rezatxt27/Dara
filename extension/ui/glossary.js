// The glossary on screen: underlined words in running text (each opens its meaning) and the searchable «واژه‌نامه».
import { html, useState, Icon, Tip, Drawer } from './components.js';
import * as G from '../lib/glossary.js';

/** A glossary word as a small popover trigger. */
/** Opens the glossary drawer (the app listens), at a word if given. */
export const openGlossary = (id = null) => dispatchEvent(new CustomEvent('dara-glossary', { detail: id }));
export const TermTip = ({ id, label }) => { const t = G.TERM[id]; return t ? html`<${Tip} title=${t.term} text=${`${t.short}\n${t.long}`} example=${t.example} label=${label ?? t.term} more=${() => openGlossary(id)} />` : label; };

/** Running text with its glossary words underlined (the first time each appears). */
export function Terms({ text, seen }) {
  const parts = G.split(text, seen);
  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : html`${parts.map((p) => (typeof p === 'string' ? p : html`<${TermTip} id=${p.id} label=${p.text} />`))}`;
}

/** «واژه‌نامه»: every word with its plain explanation, searchable. */
export function Glossary({ onClose, at = null }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(at);
  const list = G.search(q);
  return html`<${Drawer} title="واژه‌نامه" onClose=${onClose}>
    <div class="small muted" style="margin-bottom:10px;line-height:1.9">معنی اصطلاح‌هایی که در دارا می‌بینی، به زبان ساده. در متن‌ها هم زیر این واژه‌ها خط نقطه‌چین است؛ رویشان بزن تا معنی‌شان را ببینی.</div>
    <input class="input" placeholder="جست‌وجو: NAV، حباب، P/E…" value=${q} onInput=${(e) => setQ(e.target.value)} autoFocus />
    <div class="gl-list">${list.length ? list.map((t) => html`<div class=${'gl-it' + (open === t.id ? ' on' : '')}>
      <button class="gl-h" aria-expanded=${open === t.id ? 'true' : 'false'} onClick=${() => setOpen(open === t.id ? null : t.id)}>
        <span class="grow"><b>${t.term}</b><span class="xs muted gl-s">${t.short}</span></span><${Icon} n="chevronDown" cls=${'sm' + (open === t.id ? ' rot' : '')} /></button>
      ${open === t.id && html`<div class="gl-b small">${t.long}${t.example && html`<div class="xs muted" style="margin-top:6px"><b>مثال:</b> ${t.example}</div>`}</div>`}
    </div>`) : html`<div class="empty small">واژه‌ای با این نام پیدا نشد. از دستیار هم می‌توانی بپرسی.</div>`}</div>
  </${Drawer}>`;
}
