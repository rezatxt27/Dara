// Node test hook: ui/actions.js imports UI helpers from ./components.js (Preact, DOM); tests get a tiny stand-in.
export async function resolve(spec, ctx, next) {
  if (spec === './components.js' && ctx.parentURL && ctx.parentURL.endsWith('/ui/actions.js')) return { url: new URL('./stub-components.mjs', import.meta.url).href, shortCircuit: true };
  return next(spec, ctx);
}
