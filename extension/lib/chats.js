// The assistant's conversations: a list of threads (newest first), one of them open. Pure; stored under `chat`.
// Old installs kept one conversation as `chat.messages`; it becomes the first thread.

export const MAX_THREADS = 30;
export const MAX_MESSAGES = 60;

/** A thread's title: the start of its first question. */
export function titleOf(messages) {
  const q = (messages || []).find((m) => m.role === 'user')?.content || '';
  const t = q.replace(/\s+/g, ' ').trim();
  return t ? (t.length > 48 ? t.slice(0, 46).trimEnd() + '…' : t) : 'گفتگوی تازه';
}

/** chat as stored → { threads: [{id, title, at, messages}], current } (current: the open thread's id, or null). */
export function normalize(chat) {
  const c = chat || {};
  let threads = Array.isArray(c.threads) ? c.threads.filter((t) => t && t.id && Array.isArray(t.messages)) : [];
  if (!threads.length && Array.isArray(c.messages) && c.messages.length) {
    const at = c.messages[c.messages.length - 1]?.at || Date.now();
    // a fixed id: every page and tab that migrates the same old chat agrees on it (no duplicate on the first save)
    threads = [{ id: 'legacy', title: titleOf(c.messages), at, messages: c.messages }];
  }
  const current = threads.some((t) => t.id === c.current) ? c.current : threads[0]?.id || null;
  return { threads, current };
}

/** Save the open thread's messages: an empty thread is not kept; the edited one moves to the top. */
export function withMessages(chat, id, messages) {
  const { threads } = normalize(chat);
  const rest = threads.filter((t) => t.id !== id);
  if (!messages.length) return { threads: rest, current: null };
  const old = threads.find((t) => t.id === id);
  const t = { id, title: old?.title && old.title !== 'گفتگوی تازه' ? old.title : titleOf(messages), at: Date.now(), messages: messages.slice(-MAX_MESSAGES) };
  return { threads: [t, ...rest].slice(0, MAX_THREADS), current: id };
}

export function remove(chat, id) {
  const { threads, current } = normalize(chat);
  const left = threads.filter((t) => t.id !== id);
  return { threads: left, current: current === id ? null : current };
}

/** A chart spec small enough to keep: at most `max` points (first and last always kept). */
export function thinPoints(points, max = 120) {
  if (!Array.isArray(points) || points.length <= max) return points;
  const step = (points.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => points[Math.round(i * step)]);
}
