import asyncio, json, os, shutil
from playwright.async_api import async_playwright
EXT = '/tmp/dara-test'
import pathlib
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
def rows(close, n=400):
    import datetime
    out = []; d = datetime.date.today() - datetime.timedelta(days=1)
    for i in range(n):
        day = d - datetime.timedelta(days=i)
        c = close * (1 - i * 0.001)
        out.append([str(c), str(c), str(c), f'{c:,.2f}', '<span class="high">1</span>', '<span class="high">0.1%</span>', day.strftime('%Y/%m/%d'), ''])
    return out
BASE = {'price_dollar_rl': 2547000, 'geram18': 253580000, 'sekee': 2590050000, 'nim': 1350000000, 'price_eur': 2893000, 'silver_999': 5228200, 'base_global_copper': 14395.6}
async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwbf', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}'])
        hits = []
        async def handler(route):
            url = route.request.url; hits.append(url)
            key = url.split('summary-table-data/')[1].split('?')[0] if 'summary-table-data/' in url else None
            if key:
                return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'data': rows(BASE.get(key, 1000))}))
            if 'ClosingPriceDailyList' in url:
                import datetime
                d = datetime.date.today()
                data = [{'pClosing': 700000 - i * 200, 'dEven': int((d - datetime.timedelta(days=i + 1)).strftime('%Y%m%d')), 'hEven': 122959} for i in range(300)]
                return await route.fulfill(status=200, content_type='application/json', body=json.dumps({'closingPriceDaily': data}))
            return await route.fulfill(status=503, body='x')
        await ctx.route('https://api.tgju.org/**', handler)
        await ctx.route('https://cdn.tsetmc.com/**', handler)
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker')
        ext = sw.url.split('/')[2]
        pg = await ctx.new_page(); await pg.goto(f'chrome-extension://{ext}/ui/popup.html'); await pg.wait_for_timeout(1500)
        s2 = dict(seed); s2['snapshots'] = {}
        await pg.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", s2)
        r = await pg.evaluate("() => new Promise(res => chrome.runtime.sendMessage({type:'backfill', days: 365}, res))")
        print('backfill result:', {k: r.get(k) for k in ('ok', 'added', 'error', 'failed')}, 'requests intercepted:', len(hits))
        snaps = await pg.evaluate("async () => (await chrome.storage.local.get('snapshots')).snapshots")
        ks = sorted(snaps)
        if ks:
            print('days:', len(ks), ks[0], '→', ks[-1], 'first t:', snaps[ks[0]]['t'], 'last t:', snaps[ks[-1]]['t'], 'est:', snaps[ks[0]].get('est'))
        app = await ctx.new_page(); await app.set_viewport_size({'width': 1440, 'height': 900})
        await app.goto(f'chrome-extension://{ext}/ui/app.html#/overview'); await app.wait_for_timeout(1500)
        await app.click('.hero .seg button:has-text("۱ سال")'); await app.wait_for_timeout(400)
        await app.screenshot(path='/tmp/overview-backfilled.png', clip={'x': 0, 'y': 0, 'width': 1440, 'height': 640})
        await ctx.close()
asyncio.run(main())
