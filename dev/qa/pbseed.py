# The «سبدساز» history, seeded into the worker's cache so the page and the assistant work offline in tests.
import json, pathlib
_fx = json.load(open(pathlib.Path(__file__).resolve().parents[1] / 'tests' / 'fixtures' / 'market-monthly.json'))
_btc = {m: v * _fx['usd'][m] for m, v in _fx['btcUsd'].items() if m in _fx['usd']}
_pts = lambda m: [[k + '-28', v] for k, v in sorted(m.items())]
PB_HISTORY = {'tgju:geram18:3700': _pts(_fx['geram18']), 'tgju:price_dollar_rl:3700': _pts(_fx['usd']), 'nobitex:btc:3700': _pts(_btc), 'tsetmc:index:3700': _pts(_fx['index'])}
JS = """async (h) => { const { history } = await chrome.storage.local.get('history'); const now = Date.now(); const add = {};
  for (const [k, pts] of Object.entries(h)) add[k] = { at: now, points: pts };
  await chrome.storage.local.set({ history: { ...(history || {}), ...add } }); }"""
async def seed_pb(pg): await pg.evaluate(JS, PB_HISTORY)
