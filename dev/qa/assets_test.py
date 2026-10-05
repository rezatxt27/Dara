# E2E for the Assets page and the add/edit drawer: totals, grouping, filters, search, every action's bookkeeping.
# Synthetic data only (demo seed + a few made-up extras).
# Run: node dev/qa/demo_seed.mjs && python3 dev/qa/assets_test.py [light|dark]
import asyncio, json, os, sys, shutil, pathlib, re, time
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = '/tmp/dara-assets'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(ROOT / 'extension', EXT)
shutil.rmtree('/tmp/pwassets', ignore_errors=True)
THEME = sys.argv[1] if len(sys.argv) > 1 else 'light'
SH = ROOT / 'shots'; os.makedirs(SH, exist_ok=True)
FA = str.maketrans('۰۱۲۳۴۵۶۷۸۹٬٫−', '0123456789,.-')
results = []
def check(name, ok, info=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {info}' if info not in ('', None) else ''), flush=True)
async def step(name, coro):
    try: await coro
    except Exception as e: check(name + ' (exception)', False, ' | '.join(l for l in str(e).split('\n') if 'waiting for' in l or 'Timeout' in l)[:400])
def first_num(t):
    m = re.search(r'-?[\d,]+(?:\.\d+)?', t.translate(FA)); return float(m.group().replace(',', '')) if m else None

now = int(time.time() * 1000)
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
mk = lambda o: {'createdAt': now, 'updatedAt': now, 'liquidity': 'mid', **o}
seed['assets'] += [
    mk({'id': 'house', 'code': 'D-015', 'name': 'آپارتمان نمونه', 'custodian': '', 'category': 'property', 'mode': 'balance', 'balance': 30_000_000_000, 'balanceAt': now, 'liquidity': 'low'}),
    mk({'id': 'loan', 'code': 'D-016', 'name': 'وام بانک الف', 'custodian': 'بانک الف', 'category': 'debt', 'mode': 'balance', 'balance': 800_000_000, 'balanceAt': now, 'liquidity': 'high'}),
    mk({'id': 'arab', 'code': 'D-017', 'name': 'فولاد مباركه', 'custodian': 'کارگزاری نمونه ', 'category': 'stock', 'mode': 'units', 'quantity': 500, 'unit': 'سهم', 'price': {'source': 'manual', 'value': 51200, 'updatedAt': now - 20 * 86400000}}),
    mk({'id': 'dep', 'code': 'D-018', 'name': 'سپرده سررسیدشده', 'custodian': 'بانک ب', 'category': 'fixed', 'mode': 'rate', 'rate': {'principal': 100_000_000, 'annualPct': 20, 'start': '2025-01-01', 'maturity': '2026-01-01', 'mode': 'simple'}}),
]
seed['settings']['theme'] = THEME
seed['settings']['remindDays'] = {'balance': 30, 'price': 7}

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwassets', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page(); await boot.goto(f'chrome-extension://{ext}/ui/popup.html')
        for _ in range(60):
            mt = await boot.evaluate("async () => (await chrome.storage.local.get('meta')).meta || {}")
            if mt.get('lastRun') and not mt.get('running'): break
            await boot.wait_for_timeout(500)
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", seed)
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        get = lambda pg, k: pg.evaluate(f"async () => (await chrome.storage.local.get('{k}'))['{k}']")
        async def newpage(route='assets'):
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(f'[{route}] {m.text}') if m.type == 'error' else None)
            pg.on('pageerror', lambda e: errors.append(f'[{route} pageerror] {e}'))
            await pg.goto(f'chrome-extension://{ext}/ui/app.html#/{route}'); await pg.wait_for_timeout(1300)
            return pg
        async def pf(pg):
            return await pg.evaluate("""async () => { const E = await import('/lib/engine.js'); const st = await chrome.storage.local.get(['assets','quotes','settings']);
              const p = E.portfolio(st.assets, st.quotes, st.settings); return { net: p.net, gross: p.gross, debt: p.debt, att: p.attention.map((r) => r.asset.id),
              rows: Object.fromEntries(p.rows.map((r) => [r.asset.id, { v: r.value, s: r.signedValue, st: r.status }])) }; }""")
        pg = await newpage()

        async def t_totals():
            P = await pf(pg)
            foot = await pg.inner_text('tfoot')
            tot = first_num(next((c for c in foot.split('\t') if 'تومان' in c), foot))
            check('footer total = net worth (to the toman; interest accrues live)', tot is not None and abs(tot * 10 - P['net']) < 1000, (foot.replace('\n', ' | '), P['net'] / 10))
            hdr = await pg.inner_text('tr.grp:has-text("بدهی")')
            check('liability group shown as a debt (red, no stray minus)', await pg.locator('tr.grp:has-text("بدهی") .money.debt').count() == 1, hdr.replace('\n', ' | '))
            check('matured deposit flagged', P['rows']['dep']['st'] == 'matured' and 'dep' in P['att'] and await pg.locator('tr.r:has-text("سپرده سررسیدشده") .pill:has-text("سررسید شده")').count() == 1)
            check('appraised house not stale at default reminders', P['rows']['house']['st'] == 'manual')
            check('manual stock price 20 days old is stale', P['rows']['arab']['st'] == 'stale')
            await pg.screenshot(path=f'{SH}/assets-cat-{THEME}.png', full_page=True)
        await step('totals', t_totals())

        async def t_groups():
            await pg.click('.seg >> text=محل نگهداری'); await pg.wait_for_timeout(400)
            P = await pf(pg)
            hdr = await pg.inner_text('tr.grp:has-text("بانک الف")')
            want = (P['rows']['bankA']['s'] + P['rows']['loan']['s']) / 10 / 1e6
            got = first_num(hdr.split('\n')[-1])
            check('custodian group nets the loan against the deposit', got is not None and abs(got - want) < 1.0, f'{hdr!r} want≈{want:.1f}M')
            n = await pg.locator('tr.grp:has-text("کارگزاری نمونه")').count()
            check('custodian names with stray spaces form one group', n == 1, n)
            check('assets without a custodian grouped together', await pg.locator('tr.grp:has-text("محل نگهداری ثبت نشده")').count() == 1)
            await pg.screenshot(path=f'{SH}/assets-custodian-{THEME}.png', full_page=True)
            await pg.click('.seg >> text=دسته'); await pg.wait_for_timeout(300)
        await step('groups', t_groups())

        async def t_search():
            box = pg.locator('input[placeholder*="جست‌وجوی دارایی"]').first
            for q, want in [('مبارکه', 'فولاد'), ('btc', 'بیت‌کوین'), ('BTC', 'بیت‌کوین'), ('d-01۵', 'آپارتمان')]:
                await box.fill(q); await pg.wait_for_timeout(350)
                names = await pg.locator('tbody tr.r').all_inner_texts()
                check(f'search «{q}» finds it', len(names) >= 1 and all(want in x for x in names[:1]), [x.split('\n')[0] for x in names][:3])
            await box.fill(''); await pg.wait_for_timeout(300)
        await step('search', t_search())

        async def t_filters():
            await pg.click('.chip:has-text("ملک و خودرو")'); await pg.wait_for_timeout(300)
            check('category chip filters', await pg.locator('tbody tr.r').count() == 1)
            await pg.click('tr.r:has-text("آپارتمان")'); await pg.wait_for_timeout(400)
            check('house offers «ثبت ارزش جدید» not deposit/withdraw', await pg.locator('tr.xrow button:has-text("ثبت ارزش جدید")').count() == 1 and await pg.locator('tr.xrow button:has-text("واریز یا برداشت")').count() == 0)
            await pg.click('tr.xrow button:has-text("ثبت ارزش جدید")'); await pg.wait_for_timeout(300)
            await pg.fill('.modal input.input', '3,300,000,000'); await pg.click('.modal button:has-text("ثبت")'); await pg.wait_for_timeout(600)
            ev = (await get(pg, 'events'))[0]
            a = next(x for x in await get(pg, 'assets') if x['id'] == 'house')
            check('re-appraisal saved and logged as a market move', a['balance'] == 33_000_000_000 and ev['changes'][0].get('reval') is True and ev['changes'][0]['delta'] == 3_000_000_000, ev['changes'])
            await pg.click('tr.r:has-text("آپارتمان")'); await pg.wait_for_timeout(200)
            # delete the only property: the filter must not get stuck on an empty table
            await pg.click('tr.r:has-text("آپارتمان")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow button:has-text("حذف")'); await pg.wait_for_timeout(700)
            n = await pg.locator('tbody tr.r').count()
            check('filter resets when its last asset is deleted', n > 5, n)
            await pg.click('.toast:has-text("حذف شد") button:has-text("برگشت")'); await pg.wait_for_timeout(700)
            check('restore brings it back', any(x['id'] == 'house' for x in await get(pg, 'assets')))
        await step('filters', t_filters())

        async def t_delete_flows():
            await pg.click('tr.r:has-text("حساب بانکی الف")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow button:has-text("حذف")'); await pg.wait_for_timeout(700)
            fl = await get(pg, 'flows')
            check('deleting an account pauses its salary flow', not fl[0]['active'])
            await pg.click('.toast:has-text("حذف شد") button:has-text("برگشت")'); await pg.wait_for_timeout(700)
            fl = await get(pg, 'flows')
            check('restoring the account resumes its salary flow', fl[0]['active'] and any(x['id'] == 'bankA' for x in await get(pg, 'assets')))
        await step('delete/restore flows', t_delete_flows())

        async def t_trade():
            await pg.click('tr.r:has-text("طلای فیزیکی")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow button:has-text("خرید یا فروش")'); await pg.wait_for_timeout(300)
            await pg.fill('.modal .field:has-text("مقدار") input', '2')
            await pg.fill('.modal .field:has-text("قیمت هر واحد") input', '25,000,000')
            await pg.select_option('.modal select', 'bankB'); await pg.wait_for_timeout(200)
            check('trade warns when the paying account is short', 'کافی نیست' in await pg.inner_text('.modal'))
            await pg.click('.modal button:has-text("ثبت")'); await pg.wait_for_timeout(700)
            A = {x['id']: x for x in await get(pg, 'assets')}
            # the cost of the 10 g held before is unknown: no made-up purchase price (and no made-up profit)
            check('buy: quantity and cash move; cost stays unknown', A['gold']['quantity'] == 12 and not A['gold'].get('costBasis') and A['bankB']['balance'] == -410_000_000, (A['gold']['quantity'], A['gold'].get('costBasis'), A['bankB']['balance']))
            await pg.click('tr.xrow button:has-text("خرید یا فروش")'); await pg.wait_for_timeout(300)
            await pg.click('.modal .seg >> text=فروش')
            await pg.fill('.modal .field:has-text("مقدار") input', '6')
            await pg.fill('.modal .field:has-text("قیمت هر واحد") input', '26,000,000')
            await pg.select_option('.modal select', 'bankB'); await pg.click('.modal button:has-text("ثبت")'); await pg.wait_for_timeout(700)
            A = {x['id']: x for x in await get(pg, 'assets')}
            check('sell half: quantity down, cash in', A['gold']['quantity'] == 6 and A['bankB']['balance'] == 1_150_000_000, (A['gold']['quantity'], A['gold'].get('costBasis'), A['bankB']['balance']))
            await pg.click('tr.xrow button:has-text("خرید یا فروش")'); await pg.wait_for_timeout(300)
            await pg.click('.modal .seg >> text=فروش'); await pg.fill('.modal .field:has-text("مقدار") input', '7'); await pg.wait_for_timeout(200)
            await pg.click('.modal button:has-text("ثبت")'); await pg.wait_for_timeout(400)
            check('selling more than held is refused', (next(x for x in await get(pg, 'assets') if x['id'] == 'gold'))['quantity'] == 6 and await pg.locator('.modal').count() == 1)
            await pg.click('.modal button:has-text("انصراف")'); await pg.click('tr.r:has-text("طلای فیزیکی")'); await pg.wait_for_timeout(200)
            row = await pg.inner_text('tr.r:has-text("طلای فیزیکی")')
            check('no profit/loss shown while the cost is unknown', '٪' not in row and '%' not in row.translate(FA), row.replace('\n', ' | '))
        await step('trade', t_trade())

        async def t_rate_adjust():
            await pg.click('tr.r:has-text("صندوق درآمد ثابت")'); await pg.wait_for_timeout(300)
            v0 = (await pf(pg))['rows']['fund']['v']
            await pg.click('tr.xrow button:has-text("افزایش یا برداشت اصل")'); await pg.wait_for_timeout(300)
            await pg.fill('.modal input.input >> nth=0', '100,000,000'); await pg.click('.modal button:has-text("ثبت")'); await pg.wait_for_timeout(600)
            a = next(x for x in await get(pg, 'assets') if x['id'] == 'fund'); ev = (await get(pg, 'events'))[0]
            v1 = (await pf(pg))['rows']['fund']['v']
            check('rate asset: value grows by exactly the money added (logged as money in)', abs(v1 - v0 - 1_000_000_000) < 5000 and ev['kind'] == 'adjust' and ev['toId'] == 'fund', (v1 - v0, ev.get('kind')))
            p1 = a['rate']['principal']
            await pg.click('tr.xrow button:has-text("افزایش یا برداشت اصل")'); await pg.wait_for_timeout(300)
            await pg.click('.modal .seg >> text=برداشت'); await pg.fill('.modal input.input >> nth=0', '700,000,000'); await pg.click('.modal button:has-text("ثبت")'); await pg.wait_for_timeout(400)
            check('cannot withdraw more than its value', (next(x for x in await get(pg, 'assets') if x['id'] == 'fund'))['rate']['principal'] == p1)
            await pg.click('.modal button:has-text("انصراف")'); await pg.click('tr.r:has-text("صندوق درآمد ثابت")'); await pg.wait_for_timeout(200)
        await step('rate adjust', t_rate_adjust())

        async def t_inline():
            cell = pg.locator('tr.r:has-text("سهام شرکت خصوصی") .editable').first
            await cell.click(); await pg.wait_for_timeout(200)
            n0 = len(await get(pg, 'events'))
            await pg.keyboard.press('Control+A'); await pg.keyboard.type('3000'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(600)
            a = next(x for x in await get(pg, 'assets') if x['id'] == 'priv')
            ev = (await get(pg, 'events'))[0]
            check('inline manual price edit saves (a price move: logged for undo, not counted as money)', a['price']['value'] == 30000 and ev['changes'][0]['field'] == 'price.value', a['price'])
            cell = pg.locator('tr.r:has-text("حساب بانکی ب") .editable').first
            await cell.click(); await pg.wait_for_timeout(200)
            await pg.keyboard.press('Control+A'); await pg.keyboard.type('200000000'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(600)
            ev = (await get(pg, 'events'))[0]
            check('inline bank balance edit logged as money, not appraisal', ev['changes'][0]['assetId'] == 'bankB' and not ev['changes'][0].get('reval'), ev['changes'])
        await step('inline edits', t_inline())

        async def t_editor_units():
            await pg.click('button:has-text("دارایی جدید")'); await pg.wait_for_timeout(500)
            await pg.click('.drawer .catbtn:has-text("رمزارز")'); await pg.wait_for_timeout(300)
            u0 = await pg.input_value('.drawer .field:has-text("واحد") input')
            await pg.click('.drawer .opt:has-text("اتریوم")'); await pg.wait_for_timeout(300)
            u1 = await pg.input_value('.drawer .field:has-text("واحد") input')
            check('crypto unit follows the picked coin', u0 == 'USDT' and u1 == 'ETH', (u0, u1))
            await pg.fill('.drawer .field:has-text("واحد") input', 'واحد من')
            await pg.click('.drawer .opt:has-text("بیت‌کوین")'); await pg.wait_for_timeout(300)
            check('a unit typed by hand is kept', await pg.input_value('.drawer .field:has-text("واحد") input') == 'واحد من')
            await pg.click('.drawer .catbtn:has-text("طلا و سکه")'); await pg.wait_for_timeout(300)
            await pg.click('.drawer .opt:has-text("نیم سکه")'); await pg.wait_for_timeout(300)
            check('coin unit becomes «عدد»', await pg.input_value('.drawer .field:has-text("واحد") input') == 'عدد')
            await pg.fill('.drawer :is(.field:has-text("نام دارایی"), .field:has-text("نام بدهی")) input', 'سکه آزمایشی')
            await pg.fill('.drawer .field:has-text("مقدار") input', '3')
            await pg.click('.drawer .seg >> text=ورود دستی'); await pg.wait_for_timeout(300)
            pv = await pg.input_value('.drawer .field:has-text("قیمت هر واحد") input')
            check('switching to manual keeps the current price', first_num(pv) == 135_000_000, pv)
            await pg.click('.drawer button:has-text("افزودن")'); await pg.wait_for_timeout(700)
            A = await get(pg, 'assets'); new = [x for x in A if x['name'] == 'سکه آزمایشی']
            codes = [x.get('code') for x in A]
            check('new asset saved with a unique code', len(new) == 1 and len(codes) == len(set(codes)), new[0].get('code') if new else None)
        await step('editor: units', t_editor_units())

        async def t_editor_mode():
            await pg.click('tr.r:has-text("آپارتمان")'); await pg.wait_for_timeout(300)
            check('house: its own action is the main button', await pg.locator('tr.xrow .btn.primary:has-text("ثبت ارزش جدید")').count() == 1)
            await pg.click('tr.xrow button:has-text("ویرایش")'); await pg.wait_for_timeout(500)
            check('a house offers no irrelevant valuation methods', await pg.locator('.drawer .modes').count() == 0)
            await pg.fill('.drawer .field:has-text("ارزش امروز") input', '3,500,000,000'); await pg.wait_for_timeout(200)
            check('appraised asset asks why its value changed', await pg.locator('.drawer .field:has-text("چرا ارزش تغییر کرد")').count() == 1)
            await pg.click('.drawer .seg >> text=بخشی را خریدم یا فروختم')
            await pg.click('.drawer button:has-text("ذخیره تغییرات")'); await pg.wait_for_timeout(700)
            ev = (await get(pg, 'events'))[0]
            check('«bought part of it» is logged as money, not market', ev['changes'][0]['field'] == 'balance' and not ev['changes'][0].get('reval') and ev['changes'][0]['delta'] == 2_000_000_000, ev['changes'])
            await pg.click('tr.r:has-text("آپارتمان")'); await pg.wait_for_timeout(200)
            # private shares: switch from «count × price» to «total value» — carried over, logged as a correction, undoable
            # (the row's middle is the inline price editor: open the row from its name)
            await pg.click('tr.r:has-text("سهام شرکت خصوصی") td:first-child'); await pg.wait_for_timeout(300)
            await pg.click('tr.r:has-text("سهام شرکت خصوصی") + tr.xrow button:has-text("ویرایش")'); await pg.wait_for_timeout(500)
            v0 = (await pf(pg))['rows']['priv']['v']
            await pg.click('.drawer .mode:has-text("مانده / ارزش کل")'); await pg.wait_for_timeout(300)
            pv = await pg.input_value('.drawer .field:has-text("ارزش امروز") input')
            check('switching method carries the value over', abs(first_num(pv) * 10 - v0) < 10, (pv, v0))
            await pg.fill('.drawer .field:has-text("ارزش امروز") input', '3,200,000,000')
            await pg.click('.drawer button:has-text("ذخیره تغییرات")'); await pg.wait_for_timeout(700)
            ev = (await get(pg, 'events'))[0]
            ok = ev.get('prev', {}).get('mode') == 'units' and any(c['field'] == 'value' and abs(c['value'] - (32_000_000_000 - v0)) < 10 for c in ev['changes'])
            check('changing valuation method is logged as a correction', ok, ev.get('changes'))
            await pg.evaluate("async (id) => { const { act } = await import('/ui/actions.js'); const ev = (await chrome.storage.local.get('events')).events.find((e) => e.id === id); await act.undoEvent(ev); }", ev['id'])
            await pg.wait_for_timeout(500)
            a = next(x for x in await get(pg, 'assets') if x['id'] == 'priv')
            check('undo restores the previous method and value', a['mode'] == 'units' and a['quantity'] == 1_000_000, (a['mode'], a.get('quantity')))
        await step('editor: method', t_editor_mode())

        async def t_matured_and_words():
            n0 = (await pf(pg))['net']; b0 = next(x for x in await get(pg, 'assets') if x['id'] == 'bankB')['balance']
            await pg.click('tr.r:has-text("سپرده سررسیدشده")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow .btn.primary:has-text("انتقال یا تمدید")'); await pg.wait_for_timeout(300)
            await pg.select_option('.modal select', 'bankB'); await pg.click('.modal button:has-text("انتقال و بستن")'); await pg.wait_for_timeout(700)
            A = {x['id']: x for x in await get(pg, 'assets')}; n1 = (await pf(pg))['net']
            check('matured deposit closed into the account, net worth unchanged', A['dep'].get('archived') and A['bankB']['balance'] - b0 == 120_000_000 and abs(n1 - n0) < 1000, (A['bankB']['balance'] - b0, n1 - n0))
            await pg.click('.toast:has-text("منتقل شد") button:has-text("برگشت")'); await pg.wait_for_timeout(700)
            A = {x['id']: x for x in await get(pg, 'assets')}
            check('undo reopens it', not A['dep'].get('archived') and A['bankB']['balance'] == b0)
            # amounts in words, and Escape in the calendar keeps the form open
            await pg.click('button:has-text("دارایی جدید")'); await pg.wait_for_timeout(500)
            await pg.fill('.drawer .field:has-text("مانده حساب") input', 'دو میلیون و پانصد هزار'); await pg.wait_for_timeout(200)
            words = await pg.inner_text('.drawer .field:has-text("مانده حساب")')
            check('money field reads amounts in words', 'دو میلیون و پانصد هزار تومان' in words or '2,500,000' in words.translate(FA) or 'دو میلیون و پانصد' in words, words.replace('\n', ' | ')[:120])
            await pg.click('.drawer .catbtn:has-text("درآمد ثابت")'); await pg.wait_for_timeout(300)
            await pg.click('.drawer .field:has-text("تاریخ شروع") input'); await pg.wait_for_timeout(300)
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
            check('Escape in the calendar keeps the form open', await pg.locator('.drawer').count() == 1)
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(300)
        await step('matured & words', t_matured_and_words())

        await pg.reload(); await pg.wait_for_timeout(1200)
        await pg.screenshot(path=f'{SH}/assets-after-{THEME}.png', full_page=True)
        P = await pf(pg)
        foot = await pg.inner_text('tfoot'); tot = first_num(next((c for c in foot.split('\t') if 'تومان' in c), foot))
        check('after all actions the footer still equals net worth', tot is not None and abs(tot * 10 - P['net']) < 1000, (foot.replace('\n', ' | '), P['net'] / 10))
        check('no page errors', not errors, errors[:4])
        await ctx.close()

asyncio.run(main())
print('\nSUMMARY:', sum(results), '/', len(results), 'passed')
