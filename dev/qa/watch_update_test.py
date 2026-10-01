# E2E: market watchlist (other TSE symbols / funds / coins) and self-update on refresh.
# Run: node dev/qa/demo_seed.mjs && PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS=1 python3 dev/qa/watch_update_test.py
import asyncio, json, shutil, pathlib, os
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = '/tmp/dara-upd'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(ROOT / 'extension', EXT)
shutil.rmtree('/tmp/pwupd', ignore_errors=True)
# Like a real 'Load unpacked' install: developer mode on (otherwise Chrome disables the extension on reload).
os.makedirs('/tmp/pwupd/Default', exist_ok=True); json.dump({'extensions': {'ui': {'developer_mode': True}}}, open('/tmp/pwupd/Default/Preferences', 'w'))
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
SH = ROOT / 'shots'; os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, info=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {info}' if info not in ('', None) else ''), flush=True)

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwupd', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []
        async def handler(route):
            u = route.request.url
            J = lambda o: route.fulfill(status=200, content_type='application/json', body=json.dumps(o))
            if 'GetInstrumentSearch' in u:
                return await J({'instrumentSearch': [{'insCode': '46348559193224090', 'lVal18AFC': 'فولاد', 'lVal30': 'فولاد مباركه اصفهان', 'lastDate': 20260930, 'flowTitle': 'بورس'}]})
            if 'GetClosingPriceInfo/46348559193224090' in u:
                return await J({'closingPriceInfo': {'pClosing': 5120, 'pDrCotVal': 5130, 'priceYesterday': 5000, 'dEven': 20260930, 'hEven': 122959}})
            if 'coingecko.com/api/v3/search' in u:
                return await J({'coins': [{'id': 'pepe', 'name': 'Pepe', 'symbol': 'PEPE', 'market_cap_rank': 30}]})
            if 'coingecko.com/api/v3/simple/price' in u:
                return await J({'pepe': {'usd': 0.00002, 'usd_24h_change': 4}})
            if 'ajax.json' in u:
                return await J({'current': {'price_dollar_rl': {'p': '1,000,000', 'dp': 0, 'dt': 'high', 'ts': '2026-10-01 10:00:00'}}})
            return await route.fulfill(status=503, body='x')
        for pat in ['https://cdn.tsetmc.com/**', 'https://api.coingecko.com/**', 'https://call1.tgju.org/**', 'https://api.tgju.org/**', 'https://api.nobitex.ir/**', 'https://fund.fipiran.ir/**']:
            await ctx.route(pat, handler)
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page(); await boot.goto(f'chrome-extension://{ext}/ui/popup.html')
        for _ in range(60):
            mt = await boot.evaluate("async () => (await chrome.storage.local.get('meta')).meta || {}")
            if mt.get('lastRun') and not mt.get('running'): break
            await boot.wait_for_timeout(500)
        seed['settings']['providers'] = {'tgju': True, 'tsetmc': True, 'fipiran': True, 'nobitex': True}
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", seed)
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        get = lambda pg, k: pg.evaluate(f"async () => (await chrome.storage.local.get('{k}'))['{k}']")

        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(f'chrome-extension://{ext}/ui/app.html#/market'); await pg.wait_for_timeout(1200)
        check('market: bourse card always visible with add button', await pg.locator('button:has-text("افزودن نماد یا صندوق")').count() == 1)
        check('market: held ETF tagged', await pg.locator('tr.r:has-text("زر") .tag-watch').count() == 1)
        # --- add a TSE symbol
        await pg.click('button:has-text("افزودن نماد یا صندوق")'); await pg.wait_for_timeout(300)
        await pg.fill('.modal input.input', 'فولاد'); await pg.keyboard.press('Enter')
        await pg.wait_for_selector('.modal .opt:has-text("فولاد مبارکه")', timeout=8000)
        await pg.click('.modal .opt:has-text("فولاد مبارکه")'); await pg.wait_for_timeout(1200)
        check('watch modal marks the added symbol', await pg.locator('.modal .opt.on:has-text("فولاد")').count() == 1)
        await pg.screenshot(path=f'{SH}/watch-modal-bourse.png')
        await pg.click('.modal button:has-text("تمام")'); await pg.wait_for_timeout(500)
        s = await get(pg, 'settings')
        check('watch saved in settings', any(w['provider'] == 'tsetmc' and w['label'] == 'فولاد' for w in s.get('watch', [])), s.get('watch'))
        row = await pg.inner_text('tr.r:has-text("فولاد")')
        check('watched symbol shows its price', '۵۱۲' in row or '512' in row, row.replace('\n', ' | '))
        # --- add a coin from online search
        await pg.click('button:has-text("رمزارز دیگر")'); await pg.wait_for_timeout(300)
        await pg.fill('.modal .isearch input', 'pepe')
        await pg.wait_for_selector('.modal .opt:has-text("Pepe")', timeout=8000)
        await pg.screenshot(path=f'{SH}/watch-modal-crypto.png')
        await pg.click('.modal .opt:has-text("Pepe")'); await pg.wait_for_timeout(1500)
        await pg.click('.modal button:has-text("تمام")'); await pg.wait_for_timeout(600)
        q = (await get(pg, 'quotes')).get('nobitex:pepe') or {}
        check('custom coin priced via CoinGecko × dollar', abs((q.get('price') or 0) - 20) < 1e-6 and q.get('source') == 'coingecko', q)
        check('custom coin row on the market page', await pg.locator('.card:has-text("رمزارز") .it:has-text("Pepe")').count() == 1)
        check('default coins listed (ETH)', await pg.locator('.card:has-text("رمزارز") .it:has-text("اتریوم")').count() == 1)
        await pg.screenshot(path=f'{SH}/market-watch.png', full_page=True)
        # --- background refresh keeps watch quotes fresh
        r = await pg.evaluate("() => new Promise(res => chrome.runtime.sendMessage({type:'refresh'}, res))")
        q2 = (await get(pg, 'quotes')).get('tsetmc:46348559193224090:close') or {}
        check('refresh cycle includes watched symbols', q2.get('price') == 5120 and not q2.get('error'), q2)
        # --- remove
        await pg.click('.card:has-text("رمزارز") .it:has-text("Pepe") button[title="حذف از دیده‌بان"]'); await pg.wait_for_timeout(500)
        s = await get(pg, 'settings')
        check('remove from watchlist', not any(w['key'] == 'pepe' for w in s['watch']), s['watch'])

        # --- self-update: new files land in the folder, a refresh applies them
        await pg.goto(f'chrome-extension://{ext}/ui/app.html#/analysis'); await pg.wait_for_timeout(800)
        ctx_urls = await pg.evaluate("async () => (await chrome.runtime.getContexts({contextTypes:['TAB']})).map(c => c.documentUrl)")
        print('   contexts:', ctx_urls)
        m = json.load(open(f'{EXT}/manifest.json')); m['version'] = '1.2.99'; json.dump(m, open(f'{EXT}/manifest.json', 'w'), ensure_ascii=False, indent=2)
        before = len(ctx.pages)
        try: await pg.reload()
        except Exception: pass
        newp = None
        for _ in range(40):
            await asyncio.sleep(0.5)
            for t in ctx.pages:
                if t.url.endswith('#/analysis') and not t.is_closed():
                    try:
                        v = await t.evaluate("() => chrome.runtime.getManifest().version")
                        if v == '1.2.99': newp = t
                    except Exception: pass
            if newp: break
        check('refresh applied the new version and reopened the same page', newp is not None, [t.url for t in ctx.pages])
        if newp:
            await newp.wait_for_timeout(1500)
            n_tabs = sum(1 for t in ctx.pages if '/ui/app.html' in t.url)
            check('no duplicate Dara tabs after update', n_tabs == 1, n_tabs)
            body = await newp.inner_text('body')
            check('update toast shown', 'به‌روز شد' in body)
            s = await get(newp, 'settings'); a = await get(newp, 'assets')
            check('data kept across the update', len(a) == len(seed['assets']) and any(w['provider'] == 'tsetmc' for w in s['watch']))
            await newp.screenshot(path=f'{SH}/after-update.png')
        # --- worker-side: with no Dara tab open, it updates by itself
        for t in list(ctx.pages):
            if '/ui/app.html' in t.url: await t.close()
        m['version'] = '1.2.100'; json.dump(m, open(f'{EXT}/manifest.json', 'w'), ensure_ascii=False, indent=2)
        pp = await ctx.new_page()
        try: await pp.goto(f'chrome-extension://{ext}/ui/popup.html')
        except Exception: pass
        await asyncio.sleep(3)
        ok = False
        for _ in range(20):
            for w in ctx.service_workers:
                if ext in w.url:
                    try:
                        if await w.evaluate("() => chrome.runtime.getManifest().version") == '1.2.100': ok = True
                    except Exception: pass
            if ok: break
            await asyncio.sleep(0.5)
        check('popup open applies a pending update', ok)
        check('no page errors', not errors, errors[:4])
        await ctx.close()

asyncio.run(main())
print('\nSUMMARY:', sum(results), '/', len(results), 'passed')
