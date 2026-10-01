import asyncio, json, os, sys, shutil
from playwright.async_api import async_playwright
import pathlib; ROOT = str(pathlib.Path(__file__).resolve().parents[2])
SRC = f'{ROOT}/extension'; EXT = '/tmp/dara-test'  # temporary copy with a test-only host permission
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(SRC, EXT)
m = json.load(open(f'{EXT}/manifest.json')); m['host_permissions'] += ['http://127.0.0.1/*']; json.dump(m, open(f'{EXT}/manifest.json', 'w'), ensure_ascii=False)
seed = json.load(open(f'{ROOT}/dev/qa/.seed.json'))  # run: node dev/qa/demo_seed.mjs
THEME = sys.argv[1] if len(sys.argv) > 1 else 'light'
SH = f'{ROOT}/shots'; os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, info=''):
    results.append((name, ok, info)); print(('PASS ' if ok else 'FAIL ') + name + (' — ' + str(info) if info not in ('', None) else ''), flush=True)

async def step(name, coro):
    try: await coro
    except Exception as e: check(name + ' (exception)', False, str(e).split('\n')[0][:200])

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwe2e', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page()
        await boot.goto(f'chrome-extension://{ext}/ui/popup.html')
        for _ in range(60):
            mt = await boot.evaluate("async () => (await chrome.storage.local.get('meta')).meta || {}")
            if mt.get('lastRun') and not mt.get('running'): break
            await boot.wait_for_timeout(500)
        seed['settings']['theme'] = THEME
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", seed)
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        async def newpage(route):
            pg = await ctx.new_page()
            pg.on('console', lambda m: errors.append(f'[{route}] {m.text}') if m.type == 'error' and '401' not in m.text else None)
            pg.on('pageerror', lambda e: errors.append(f'[{route} pageerror] {e}'))
            await pg.goto(f'chrome-extension://{ext}/ui/app.html#/{route}')
            await pg.wait_for_timeout(1200)
            return pg
        async def get(pg, key): return await pg.evaluate(f"async () => (await chrome.storage.local.get('{key}'))['{key}']")

        async def t_overview():
            pg = await newpage('overview')
            await pg.screenshot(path=f'{SH}/overview-{THEME}.png', full_page=True)
            txt = await pg.inner_text('body')
            check('overview: why-changed card', 'چرا تغییر کرد' in txt)
            check('overview: allocation bars', await pg.locator('.alloc2 .ar').count() >= 5)
            await pg.click('.card:has-text("چرا تغییر کرد") .seg button:has-text("۷ روز")'); await pg.wait_for_timeout(300)
            lead = await pg.inner_text('.why .lead')
            check('why-changed 7d gives an explanation', 'بیشترین اثر' in lead or 'جابه‌جا' in lead, lead[:140].replace('\n', ' '))
            await pg.close()
        await step('overview', t_overview())

        async def t_assets():
            pg = await newpage('assets')
            await pg.click('tr.r:has-text("نقره")'); await pg.wait_for_timeout(500)
            check('assets: row expands', await pg.locator('tr.xrow .xpanel').count() == 1)
            await pg.screenshot(path=f'{SH}/assets-expanded-{THEME}.png')
            rowtxt = await pg.inner_text('tr.r:has-text("کیلوگرم")')
            check('assets: copper valued via USD', 'tgju' in rowtxt, rowtxt.replace('\n', ' | ')[:160])
            btxt = await pg.inner_text('tr.r:has-text("BTC")')
            check('assets: crypto priced via fallback', 'خطای دریافت' not in btxt, btxt.replace('\n', ' | ')[:180])
            await pg.click('tr.r:has-text("حساب بانکی ب") .editable'); await pg.wait_for_timeout(200)
            await pg.keyboard.press('Control+A'); await pg.keyboard.type('12000000')
            v = await pg.input_value('tr.r input.input')
            check('inline edit shows separators while typing', '٬' in v or ',' in v, v)
            await pg.keyboard.press('Enter'); await pg.wait_for_timeout(400)
            evs = await get(pg, 'events')
            check('manual balance edit logged as edit event', any(e['kind'] == 'edit' for e in evs))
            await pg.close()
        await step('assets', t_assets())

        async def t_editor():
            pg = await newpage('assets')
            await pg.click('text=دارایی جدید'); await pg.wait_for_timeout(400)
            await pg.fill('.drawer .field:has-text("مانده حساب") input', '2100000000')
            hint = await pg.inner_text('.drawer .field:has-text("مانده حساب") .hint')
            check('money amount shown in words', 'دو میلیارد و صد میلیون تومان' in hint, hint)
            shown = await pg.input_value('.drawer .field:has-text("مانده حساب") input')
            check('money field groups digits', '٬' in shown or ',' in shown, shown)
            await pg.click('.drawer .catbtn:has-text("فلزات")'); await pg.wait_for_timeout(300)
            await pg.click('.drawer .chip:has-text("مس")'); await pg.wait_for_timeout(300)
            unit = await pg.input_value('.drawer .field:has-text("واحد") input')
            check('metal preset sets unit', unit == 'کیلوگرم', unit)
            await pg.click('.drawer .field:has-text("تاریخ خرید") .cal-btn'); await pg.wait_for_timeout(300)
            check('Jalali calendar opens with a month grid', await pg.locator('.cal .cal-d').count() >= 29)
            await pg.screenshot(path=f'{SH}/editor-calendar-{THEME}.png')
            await pg.click('.cal .cal-d >> nth=4'); await pg.wait_for_timeout(200)
            dv = await pg.input_value('.drawer .field:has-text("تاریخ خرید") input')
            check('calendar pick fills the date', '/' in dv, dv)
            await pg.close()
            pg = await newpage('assets')
            await pg.click('tr.r:has-text("حساب بانکی الف")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow button:has-text("ویرایش")'); await pg.wait_for_timeout(400)
            dtxt = await pg.inner_text('.drawer')
            check('bank روزشمار interest section', 'سود روزشمار روی همین مانده' in dtxt and 'سود هر روز' in dtxt)
            await pg.screenshot(path=f'{SH}/editor-bank-interest-{THEME}.png')
            await pg.close()
        await step('editor', t_editor())

        async def t_scenario():
            pg = await newpage('analysis')
            await pg.click('.chip:has-text("جهش ارزی")'); await pg.wait_for_timeout(300)
            ptxt = await pg.inner_text('.card:has-text("شبیه‌ساز سناریو")')
            check('scenario: USD shock result + purchasing-power warning', 'بر حسب دلار' in ptxt and 'قدرت خرید دلاری' in ptxt, ptxt[:220].replace('\n', ' '))
            await pg.screenshot(path=f'{SH}/analysis-{THEME}.png', full_page=True)
            await pg.close()
        await step('scenario', t_scenario())

        async def t_settings():
            pg = await newpage('settings')
            await pg.click('#ai button:has-text("اتصال جدید")'); await pg.wait_for_timeout(300)
            await pg.select_option('#ai select.input >> nth=0', 'custom')
            f = lambda label: f'#ai .field:has-text("{label}") input'
            await pg.fill(f('نام دلخواه'), 'سرویس آزمایشی')
            await pg.fill(f('آدرس سرویس'), 'http://127.0.0.1:8765/v1')
            await pg.fill(f('مدل اصلی'), 'mock-model-1')
            await pg.fill(f('کلید API'), 'wrong-key')
            await pg.click('#ai button:has-text("تست اتصال")'); await pg.wait_for_selector('#ai .test-bad', timeout=15000)
            err_txt = await pg.inner_text('#ai')
            check('AI test: wrong key → clear error', 'کلید API نامعتبر' in err_txt)
            await pg.fill(f('کلید API'), 'test-key')
            await pg.click('#ai button:has-text("تست اتصال")')
            await pg.wait_for_selector('#ai .test-ok', timeout=15000)
            ok_txt = await pg.inner_text('#ai')
            check('AI test: connected + tool support detected', 'متصل است' in ok_txt and 'پشتیبانی می‌شود' in ok_txt)
            await pg.locator('#ai').screenshot(path=f'{SH}/settings-ai-form-{THEME}.png')
            await pg.click('#ai button:has-text("ذخیره اتصال")'); await pg.wait_for_timeout(700)
            ai = await get(pg, 'ai')
            check('AI connection saved & active', len(ai['connections']) == 1 and ai['activeId'] == ai['connections'][0]['id'])
            await pg.locator('#ai').screenshot(path=f'{SH}/settings-ai-list-{THEME}.png')
            await pg.close()
        await step('settings', t_settings())

        async def t_assistant():
            pg = await newpage('assistant')
            await pg.fill('.chat-in textarea', 'اگر دلار ۳۰٪ گران شود و انس طلا ۱۰٪ بریزد چه می‌شود؟')
            await pg.keyboard.press('Enter')
            await pg.wait_for_selector('.msg.bot .md', timeout=20000); await pg.wait_for_timeout(500)
            bot = await pg.inner_text('.msg.bot >> nth=-1')
            check('assistant: tool-based scenario answer', 'سناریو' in bot and 'شبیه‌سازی سناریو' in bot, bot[:160].replace('\n', ' '))
            await pg.fill('.chat-in textarea', 'مانده حساب بانکی ب را ۱۵ میلیون تومان ثبت کن')
            await pg.keyboard.press('Enter')
            await pg.wait_for_selector('.prop button:has-text("تأیید و اعمال")', timeout=20000)
            await pg.screenshot(path=f'{SH}/assistant-{THEME}.png')
            await pg.click('.prop button:has-text("تأیید و اعمال")'); await pg.wait_for_timeout(700)
            assets = await get(pg, 'assets')
            saman = [a for a in assets if a['id'] == 'bankB'][0]
            check('assistant: proposal applied only after confirmation', saman['balance'] == 150000000, saman['balance'])
            await pg.click('#reports button:has-text("ساخت الان")')
            await pg.wait_for_selector('#reports .report', timeout=25000); await pg.wait_for_timeout(300)
            reps = await get(pg, 'reports')
            check('weekly report generated by AI', len(reps) >= 1 and reps[0]['by'] == 'ai', reps[0].get('by') if reps else None)
            await pg.close()
        await step('assistant', t_assistant())

        async def t_capture():
            site = await ctx.new_page(); await site.goto('http://127.0.0.1:8765/talayin.html'); await site.wait_for_timeout(300)
            helper = await ctx.new_page(); await helper.goto(f'chrome-extension://{ext}/ui/popup.html')
            tab_id = await helper.evaluate("async () => (await chrome.tabs.query({url: 'http://127.0.0.1:8765/*'}))[0].id")
            async with ctx.expect_page() as cp:
                await helper.evaluate("(id) => new Promise(res => chrome.runtime.sendMessage({type:'capture', tabId:id}, res))", tab_id)
            cap = await cp.value
            cap.on('pageerror', lambda e: errors.append(f'[capture pageerror] {e}'))
            await cap.wait_for_timeout(1200)
            await cap.click('button:has-text("خواندن موجودی‌ها")')
            await cap.wait_for_selector('.cap-row input[type=checkbox]', timeout=20000); await cap.wait_for_timeout(400)
            rows = await cap.locator('.cap-row').count()
            check('capture: holdings extracted', rows >= 3, rows)
            await cap.select_option('.cap-row >> nth=2 >> select', '__new'); await cap.wait_for_timeout(200)
            await cap.screenshot(path=f'{SH}/capture-{THEME}.png', full_page=True)
            await cap.click('button:has-text("ثبت ")'); await cap.wait_for_timeout(900)
            assets = await get(helper, 'assets')
            g = [a for a in assets if a['category'] == 'gold_online'][0]
            check('capture: gold quantity updated to 42.15', abs(g['quantity'] - 42.15) < 1e-9, g['quantity'])
            check('capture: new wallet asset (toman→rial)', any(a.get('name') == 'کیف پول تومانی' and a.get('balance') == 125000000 for a in assets))
            log = open('/tmp/mockai.log').read()
            check('capture: card number masked before sending', 'CARD_MASKED' in log and 'CARD_LEAKED' not in log)
            evs = await get(helper, 'events')
            check('capture logged as undoable event', any(e['kind'] == 'capture' and e['changes'] for e in evs))
        await step('capture', t_capture())

        async def t_capture_broker():
            site = await ctx.new_page(); await site.goto('http://127.0.0.1:8765/broker.html'); await site.wait_for_timeout(300)
            helper = await ctx.new_page(); await helper.goto(f'chrome-extension://{ext}/ui/popup.html')
            tab_id = await helper.evaluate("async () => (await chrome.tabs.query({url: 'http://127.0.0.1:8765/broker*'}))[0].id")
            async with ctx.expect_page() as cp:
                await helper.evaluate("(id) => new Promise(res => chrome.runtime.sendMessage({type:'capture', tabId:id}, res))", tab_id)
            cap = await cp.value
            cap.on('pageerror', lambda e: errors.append(f'[capture pageerror] {e}'))
            await cap.wait_for_timeout(1200)
            await cap.click('button:has-text("خواندن موجودی‌ها")')
            await cap.wait_for_selector('.cap-row input[type=checkbox]', timeout=20000); await cap.wait_for_timeout(400)
            checked = await cap.locator('.cap-row:not(:first-child) input[type=checkbox]:checked').count()
            check('broker capture: all 4 rows pre-selected (1 update + 3 new)', checked == 4, checked)
            txt = await cap.inner_text('body')
            check('broker capture: new symbol priced from exchange', 'قیمت خودکار از بورس' in txt)
            await cap.screenshot(path=f'{SH}/capture-broker-{THEME}.png', full_page=True)
            await cap.click('button:has-text("ثبت ")'); await cap.wait_for_timeout(900)
            assets = await get(helper, 'assets')
            etf = [a for a in assets if a['id'] == 'etf'][0]
            check('broker capture: existing fund matched by symbol', etf['quantity'] == 1200, etf['quantity'])
            sh = [a for a in assets if a.get('name') == 'شستا']
            check('broker capture: new stock with TSETMC ref + cost basis', len(sh) == 1 and sh[0]['price']['ref']['symbol'] == 'شستا' and sh[0]['costBasis'] == 6000000, sh[0] if sh else None)
            check('broker capture: buying power as cash balance', any(a.get('name') == 'قدرت خرید' and a.get('balance') == 3000000 and a.get('custodian') == 'کارگزاری نمونه' for a in assets))
        await step('capture-broker', t_capture_broker())

        async def t_popup():
            pp = await ctx.new_page(); await pp.set_viewport_size({'width': 392, 'height': 780})
            pp.on('pageerror', lambda e: errors.append(f'[popup pageerror] {e}'))
            await pp.goto(f'chrome-extension://{ext}/ui/popup.html'); await pp.wait_for_timeout(1000)
            await pp.screenshot(path=f'{SH}/popup-{THEME}.png')
            check('popup: capture button present', await pp.locator('text=ثبت موجودی از این صفحه').count() == 1)
        await step('popup', t_popup())

        async def t_pages():
            for r in ['market', 'automation']:
                pg = await newpage(r)
                await pg.screenshot(path=f'{SH}/{r}-{THEME}.png', full_page=True)
                await pg.close()
        await step('pages', t_pages())

        check('no console/page errors', not errors, errors[:6])
        await ctx.close()

asyncio.run(main())
print('\nSUMMARY:', sum(1 for r in results if r[1]), '/', len(results), 'passed')
