// Stand-in for ui/components.js in node tests: messages to the worker are recorded; «automate» can be wired to the engine.
export const sent = [];
export const toasts = [];
let automate = null;
export function setAutomate(fn) { automate = fn; }
export async function send(type) { sent.push(type); if (type === 'automate' && automate) return automate(); return null; }
export function toast(m) { toasts.push(m); }
