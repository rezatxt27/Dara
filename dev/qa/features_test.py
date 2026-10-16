# E2E for v1.3: «این عدد از کجا آمد؟», «بپرس», «واقعاً پولدارتر شدم؟», نقطه سربه‌سر, پول جدید,
# ثبت با یک جمله, سناریو با زبان طبیعی, نقد پرتفوی. Uses synthetic data and the mock AI server.
# Run: node dev/qa/demo_seed.mjs && (python3 dev/qa/mockai.py 8765 &) && python3 dev/qa/features_test.py [light|dark]
import asyncio, json, os, sys, shutil, pathlib, re
sys.path.insert(0, str(pathlib.Path(__file__).parent)); from pbseed import seed_pb
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = '/tmp/dara-feat'
shutil.rmtree(EXT, ignore_errors=True); shutil.copytree(ROOT / 'extension', EXT)
m = json.load(open(f'{EXT}/manifest.json')); m['host_permissions'] += ['http://127.0.0.1/*']; json.dump(m, open(f'{EXT}/manifest.json', 'w'), ensure_ascii=False)
shutil.rmtree('/tmp/pwfeat', ignore_errors=True)
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
THEME = sys.argv[1] if len(sys.argv) > 1 else 'light'
SH = ROOT / 'shots'; os.makedirs(SH, exist_ok=True)
results = []
def check(name, ok, info=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {info}' if info not in ('', None) else ''), flush=True)
async def step(name, coro):
    try: await coro
    except Exception as e: check(name + ' (exception)', False, str(e).split('\n')[0][:220])
FA = str.maketrans('۰۱۲۳۴۵۶۷۸۹٬٫−', '0123456789,.-')
def nums(t): return [float(x.replace(',', '')) for x in re.findall(r'-?[\d,]+(?:\.\d+)?', t.translate(FA)) if x.replace(',', '').replace('-', '')]

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context('/tmp/pwfeat', headless=False, args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page(); await boot.goto(f'chrome-extension://{ext}/ui/popup.html')
        for _ in range(60):
            mt = await boot.evaluate("async () => (await chrome.storage.local.get('meta')).meta || {}")
            if mt.get('lastRun') and not mt.get('running'): break
            await boot.wait_for_timeout(500)
        seed['settings']['theme'] = THEME
        seed['ai'] = {'connections': [{'id': 'c1', 'service': 'sotoon', 'api': 'openai', 'name': 'سرویس آزمایشی', 'baseUrl': 'http://127.0.0.1:8765/v1', 'apiKey': 'test-key', 'model': 'mock-model-1', 'fastModel': ''}],
                      'activeId': 'c1', 'privacy': 'full', 'fallback': True, 'weekly': False, 'trustedSites': []}
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", seed)
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        async def newpage(route, w=1440):
            pg = await ctx.new_page(); await pg.set_viewport_size({'width': w, 'height': 1000})
            pg.on('console', lambda m: errors.append(f'[{route}] {m.text}') if m.type == 'error' and '401' not in m.text else None)
            pg.on('pageerror', lambda e: errors.append(f'[{route} pageerror] {e}'))
            await pg.goto(f'chrome-extension://{ext}/ui/app.html#/{route}'); await pg.wait_for_timeout(1200)
            return pg
        get = lambda pg, k: pg.evaluate(f"async () => (await chrome.storage.local.get('{k}'))['{k}']")

        # 1) «این عدد از کجا آمد؟»
        async def t_explain():
            pg = await newpage('overview')
            await pg.click('.hero .lbl .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('explain net: formula + total', 'جمع دارایی‌ها' in txt and 'ارزش خالص' in txt and 'بدهی' in txt, txt[:120].replace('\n', ' | '))
            await pg.screenshot(path=f'{SH}/explain-net-{THEME}.png')
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
            check('explain closes with Escape', await pg.locator('.xpop').count() == 0)
            await pg.click('.hero .chg .box >> nth=1 >> .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('explain 7-day change separates market from money moved', 'اثر قیمت بازار' in txt and 'واریز و برداشت' in txt, txt[:160].replace('\n', ' | '))
            await pg.mouse.click(5, 5); await pg.wait_for_timeout(200)
            check('explain closes on outside click', await pg.locator('.xpop').count() == 0)
            await pg.close()
            pg = await newpage('assets')
            await pg.click('tr.r:has-text("کیلوگرم")'); await pg.wait_for_timeout(400)
            await pg.click('tr.xrow .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('explain asset: USD metal shows dollar rate and factor', 'نرخ دلار' in txt and 'ضریب تبدیل' in txt and 'قیمت هر واحد' in txt, txt[:200].replace('\n', ' | '))
            await pg.screenshot(path=f'{SH}/explain-asset-{THEME}.png')
            # numbers add up: quantity × unit price = value (tolerate compact rounding)
            vals = await pg.evaluate("() => [...document.querySelectorAll('.xpop .xl')].map(e => [e.querySelector('.t').innerText, e.querySelector('.v').innerText])")
            d = {k.split('،')[0].strip(): v for k, v in vals}
            q = nums(d.get('مقدار', ''))[0]; up = nums(d.get('قیمت هر واحد', ''))[0]; val = nums(d.get('ارزش', ''))[0]
            check('explain asset: quantity × unit price = value', abs(q * up - val) <= max(2, val * 1e-6), (q, up, val))
            await pg.keyboard.press('Escape')
            await pg.click('tr.r:has-text("سپرده") >> nth=0') if await pg.locator('tr.r:has-text("صندوق درآمد ثابت")').count() == 0 else await pg.click('tr.r:has-text("صندوق درآمد ثابت")')
            await pg.wait_for_timeout(400)
            await pg.click('tr.xrow .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('explain fixed income: rate, method and accrued interest', 'نرخ سود سالانه' in txt and 'روزشمار مرکب' in txt and 'سود انباشته' in txt, txt[:200].replace('\n', ' | '))
            await pg.close()
        await step('explain', t_explain())

        # 2) «بپرس» از هر جا
        async def t_ask():
            pg = await newpage('overview')
            await pg.click('.card:has-text("چرا تغییر کرد") .askbtn'); await pg.wait_for_timeout(300)
            check('ask opens the assistant', '#/assistant' in pg.url, pg.url)
            await pg.wait_for_selector('.msg.bot .md', timeout=20000)
            user = await pg.inner_text('.msg.user >> nth=-1')
            check('ask sends the contextual question automatically', 'امروز تغییر کرد' in user, user[:80])
            check('ask cleans the address bar', 'ask=' not in pg.url, pg.url)
            await pg.reload(); await pg.wait_for_timeout(1500)
            n_user = await pg.locator('.msg.user').count()
            check('reload does not resend the question', n_user == 1, n_user)
            await pg.close()
            pg = await newpage('assets')
            await pg.click('tr.r:has-text("نقره")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow .askbtn'); await pg.wait_for_selector('.msg.user', timeout=8000)
            user = await pg.inner_text('.msg.user >> nth=-1')
            check('ask from an asset row names the asset', 'نقره' in user, user[:80])
            await pg.close()
        await step('ask', t_ask())

        # 3) «واقعاً پولدارتر شدم؟»
        async def t_perf():
            pg = await newpage('analysis')
            card = pg.locator('#perf')
            txt = await card.inner_text()
            check('performance: verdict vs gold, dollar and deposit', ('جلوتری' in txt or 'عقب‌تری' in txt) and 'طلای ۱۸' in txt and 'دلار' in txt and 'سپرده' in txt, txt[:200].replace('\n', ' | '))
            check('performance: salary/bonus separated from return', 'پول تازه' in txt or 'برداشت' in txt, txt[:300].replace('\n', ' | '))
            check('performance: three benchmark rows', await card.locator('.brow').count() == 3)
            for label in ['ماه', 'سال', 'از ابتدا']:
                await card.locator(f'.seg button:has-text("{label}")').first.click(); await pg.wait_for_timeout(250)
                t2 = await card.inner_text()
                check(f'performance period «{label}» renders', 'جلوتری' in t2 or 'عقب‌تری' in t2)
            await card.locator('.seg button:has-text("۳ ماه")').click(); await pg.wait_for_timeout(200)
            inp = card.locator('input.num-in')
            await inp.fill('40'); await inp.press('Tab'); await pg.wait_for_timeout(500)
            s = await get(pg, 'settings')
            check('performance: deposit rate is editable and saved', s.get('depositPct') == 40, s.get('depositPct'))
            await card.screenshot(path=f'{SH}/performance-{THEME}.png')
            await pg.close()
        await step('performance', t_perf())

        # 4) نقطه سربه‌سر
        async def t_breakeven():
            pg = await newpage('calc?t=breakeven')
            card = pg.locator('#breakeven')
            await card.locator('.field:has-text("سود سپرده") input').fill('24')
            await card.locator('.field:has-text("کارمزد") input').fill('2')
            await card.locator('.seg button:has-text("۶ ماه")').click(); await pg.wait_for_timeout(300)
            txt = await card.inner_text()
            tn = txt.translate(FA)
            check('break-even: required rise = 1.02^6/0.98 − 1 = 14.9%', '14.9٪' in tn, re.findall(r'یعنی[^\n]+', tn)[:1])
            # target price = 25,358,000 toman × 1.149145 ≈ 29,140,027
            check('break-even: target price for 18k gold', '29,140,027' in tn, re.findall(r'باید برسد به\s*\n?([^\n]+)', tn)[:1])
            await card.locator('select').select_option(label='سکه امامی'); await pg.wait_for_timeout(300)
            t2 = await card.inner_text()
            check('break-even: switching asset updates the sentence', 'سکه امامی' in t2 and 'هر سکه' in t2)
            await card.screenshot(path=f'{SH}/breakeven-{THEME}.png')
            await pg.close()
        await step('breakeven', t_breakeven())


        # 7) سناریو با زبان طبیعی
        async def t_nlscenario():
            pg = await newpage('analysis')
            await pg.fill('.nl-scn input', 'اگر توافق شود'); await pg.click('.nl-scn button')
            await pg.wait_for_selector('.assume', timeout=15000); await pg.wait_for_timeout(300)
            txt = await pg.inner_text('.assume')
            check('NL scenario: assumptions listed with reasons', 'نرخ دلار' in txt and 'انتظار ورود ارز' in txt and 'فرض' in txt, txt[:200].replace('\n', ' | '))
            usd = await pg.locator('.slider:has-text("نرخ دلار") input').input_value()
            eq = await pg.locator('.slider:has-text("بورس تهران") input').input_value()
            check('NL scenario: sliders set from the assumptions', usd == '-20' and eq == '25', (usd, eq))
            check('NL scenario: hidden sliders revealed when used', await pg.locator('.slider:has-text("سهام غیربورسی")').count() == 1)
            res = await pg.inner_text('.card:has-text("شبیه‌ساز سناریو") .preview')
            check('NL scenario: result computed by the engine', '٪' in res)
            # user edits an assumption → list shows the new value
            await pg.locator('.slider:has-text("نرخ دلار") input').fill('-10'); await pg.wait_for_timeout(300)
            txt2 = await pg.inner_text('.assume')
            check('NL scenario: editing a slider updates the assumption', '−۱۰٪' in txt2 or '-۱۰٪' in txt2 or '-10' in txt2, txt2[:120].replace('\n', ' | '))
            await pg.locator('.card:has-text("شبیه‌ساز سناریو")').screenshot(path=f'{SH}/nl-scenario-{THEME}.png')
            await pg.close()
        await step('nl-scenario', t_nlscenario())

        # 8) نقد پرتفوی
        async def t_critique():
            pg = await newpage('analysis')
            await pg.click('.critique button:has-text("نقد پرتفوی")')
            await pg.wait_for_selector('.critique .list .it', timeout=15000)
            n = await pg.locator('.critique .list .it').count()
            check('critique: points shown', n == 2, n)
            c = await get(pg, 'critique')
            check('critique: saved for later', c and len(c['points']) == 2)
            log = open('/tmp/mockai.log').read() if os.path.exists('/tmp/mockai.log') else ''
            check('critique: only percentages sent (no amounts)', 'CRITIQUE_PERCENT_ONLY' in log and 'CRITIQUE_AMOUNTS_LEAKED' not in log)
            await pg.locator('.card:has-text("ریسک‌ها و نکات")').screenshot(path=f'{SH}/critique-{THEME}.png')
            await pg.close()
        await step('critique', t_critique())

        # 6) ثبت با یک جمله (popup)
        async def t_quick():
            pp = await ctx.new_page(); await pp.set_viewport_size({'width': 392, 'height': 900})
            pp.on('pageerror', lambda e: errors.append(f'[popup pageerror] {e}'))
            await pp.goto(f'chrome-extension://{ext}/ui/popup.html'); await pp.wait_for_timeout(1000)
            before = await get(pp, 'assets'); g0 = [a for a in before if a['id'] == 'goldOnline'][0]; b0 = [a for a in before if a['id'] == 'bankA'][0]
            await pp.fill('.pp-quick input', '۲ گرم طلا خریدم گرمی ۲۵ میلیون از حساب الف'); await pp.press('.pp-quick input', 'Enter')
            await pp.wait_for_selector('.pp-quick .prop', timeout=15000)
            txt = await pp.inner_text('.pp-quick .prop')
            check('quick entry: confirmation card before anything changes', 'خرید' in txt and 'تأیید و ثبت' in txt, txt.replace('\n', ' | '))
            mid = await get(pp, 'assets')
            check('quick entry: nothing applied before confirmation', [a for a in mid if a['id'] == 'goldOnline'][0]['quantity'] == g0['quantity'])
            await pp.screenshot(path=f'{SH}/quick-entry-{THEME}.png')
            await pp.click('.pp-quick .prop button:has-text("تأیید و ثبت")'); await pp.wait_for_timeout(700)
            after = await get(pp, 'assets'); g1 = [a for a in after if a['id'] == 'goldOnline'][0]; b1 = [a for a in after if a['id'] == 'bankA'][0]
            check('quick entry: gold +2 g', abs(g1['quantity'] - g0['quantity'] - 2) < 1e-9, (g0['quantity'], g1['quantity']))
            check('quick entry: bank −50,000,000 toman (rial ×10)', abs((b0['balance'] - b1['balance']) - 500_000_000) < 1, b0['balance'] - b1['balance'])
            evs = await get(pp, 'events')
            check('quick entry: logged as an undoable trade', evs[0]['kind'] == 'trade' and evs[0]['fromId'] == 'bankA')
            await pp.fill('.pp-quick input', 'یک سکه امامی خریدم ۲۶۰ میلیون از حساب الف'); await pp.press('.pp-quick input', 'Enter')
            await pp.wait_for_selector('.pp-quick .prop', timeout=15000)
            t2 = await pp.inner_text('.pp-quick .prop')
            check('quick entry: new asset purchase marked as new', 'دارایی جدید' in t2, t2.replace('\n', ' | '))
            await pp.click('.pp-quick .prop button:has-text("تأیید و ثبت")'); await pp.wait_for_timeout(900)
            after2 = await get(pp, 'assets')
            coin = [a for a in after2 if a.get('price', {}).get('ref', {}).get('key') == 'sekee' and a['id'] not in [x['id'] for x in before]]
            check('quick entry: new coin asset created with market price + cost basis', len(coin) == 1 and coin[0]['quantity'] == 1 and coin[0]['costBasis'] == 2_600_000_000, coin[0] if coin else None)
            await pp.close()
        await step('quick', t_quick())

        # deleting an asset is logged with its value and can be undone from the event list
        async def t_delete():
            pg = await newpage('assets')
            await pg.click('tr.r:has-text("قرض به دوست")'); await pg.wait_for_timeout(300)
            await pg.click('tr.xrow button:has-text("حذف")'); await pg.wait_for_timeout(600)
            evs = await get(pg, 'events')
            rm = [e for e in evs if e.get('title', '').startswith('حذف')]
            check('delete: removal logged with its value', len(rm) == 1 and rm[0]['changes'][0]['field'] == 'remove' and rm[0]['changes'][0]['value'] < 0, rm[0]['changes'] if rm else None)
            await pg.close()
            pg = await newpage('overview')
            await pg.click('.hero .chg .box >> nth=1 >> .xbtn'); await pg.wait_for_selector('.xpop')
            txt = await pg.inner_text('.xpop')
            check('delete: shows as bookkeeping, not a market loss', 'ثبت، ویرایش یا حذف دستی' in txt)
            await pg.keyboard.press('Escape'); await pg.close()
            pg = await newpage('automation')
            await pg.click('.it:has-text("حذف «قرض به دوست»") button[title="برگشت"]'); await pg.wait_for_timeout(600)
            assets = await get(pg, 'assets')
            check('delete: undo from the event list restores the asset', any(a['id'] == 'loanOut' for a in assets))
            await pg.close()
        await step('delete', t_delete())

        # tooltips for every analysis section (for beginners)
        async def t_tips():
            pg = await newpage('analysis')
            n = await pg.locator('.tipbtn').count()
            check('tooltips: one per analysis section (≥ 14)', n >= 14, n)
            await pg.locator('#perf .card-h .tipbtn').hover(); await pg.wait_for_selector('.tippop', timeout=3000)
            txt = await pg.inner_text('.tippop')
            check('tooltip opens on hover with plain-language text', 'حقوق' in txt and 'طلا' in txt, txt[:90])
            await pg.mouse.move(5, 5); await pg.wait_for_timeout(400)
            check('tooltip closes when the pointer leaves', await pg.locator('.tippop').count() == 0)
            await pg.locator('.card:has-text("چقدر زود نقد می‌شود؟") .card-h .tipbtn').click(); await pg.wait_for_selector('.tippop')
            await pg.mouse.move(5, 5); await pg.wait_for_timeout(400)
            check('tooltip pinned by click stays open', await pg.locator('.tippop').count() == 1)
            await pg.locator('.card:has-text("چقدر زود نقد می‌شود؟") .card-h').screenshot(path=f'{SH}/tooltip-{THEME}.png') if False else None
            await pg.screenshot(path=f'{SH}/tooltip-{THEME}.png')
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
            check('tooltip closes with Escape', await pg.locator('.tippop').count() == 0)
            await pg.close()
        await step('tips', t_tips())

        # AI connections are provider-neutral
        async def t_neutral():
            pg = await newpage('settings')
            txt = await pg.inner_text('#ai')
            await pg.click('#ai button:has-text("اتصال جدید")'); await pg.wait_for_timeout(300)
            opts = await pg.evaluate("() => [...document.querySelectorAll('#ai select option')].map(o => o.textContent).join(' | ')")
            body = await pg.inner_text('body')
            check('AI connections: no provider-specific Persian brand', 'ستون' not in txt and 'ستون' not in opts and 'Sotoon' not in opts, opts[:160])
            check('AI connections: generic OpenAI-compatible is the default', (await pg.locator('#ai select').first.input_value()) == 'custom')
            await pg.close()
        await step('neutral', t_neutral())

        # regressions on narrow screens
        async def t_narrow():
            pg = await newpage('analysis', w=760)
            await pg.screenshot(path=f'{SH}/analysis-narrow-{THEME}.png', full_page=True)
            overflow = await pg.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1")
            check('analysis: no horizontal scroll at 760px', not overflow)
            await pg.close()
            pg = await newpage('analysis')
            await pg.screenshot(path=f'{SH}/analysis-{THEME}.png', full_page=True)
            await pg.close()
        await step('narrow', t_narrow())

        # «ماشین‌حساب‌ها»: converter, gold invoice (buy / sell / check), and «ثبت به‌عنوان دارایی»
        async def t_calc():
            pg = await newpage('calc')
            check('calc: ten tools on the home', await pg.locator('.calc-tile').count() == 10)
            await pg.click('.calc-tile:has-text("با این پول")'); await pg.wait_for_timeout(500)
            await pg.locator('.calc-in .field input').fill('253,580,000'); await pg.wait_for_timeout(300)
            row = (await pg.locator('.calc-row:has-text("طلای ۱۸ عیار")').inner_text()).translate(FA)
            check('converter: 253.58M toman = 10 g of 18k at 25.358M', '≈ 10 گرم' in row, row.replace('\n', ' | '))
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=gold'); await pg.wait_for_timeout(700)
            await pg.locator('.calc-card .field:has-text("وزن") input').first.fill('10')
            await pg.locator('.calc-card input[placeholder="مثلاً ۱۵"]').fill('15'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            # 253,580,000 + 15% + 7% on both + 10% on making+margin = 317,875,209
            check('gold invoice: total with making 15%, margin 7%, tax 10% on making+margin', '317,875,209' in out, out[:200].replace('\n', ' | '))
            check('gold invoice: resale ~21% less', '21٪' in out or '21%' in out)
            await pg.click('.calc-card .seg button:has-text("سنجیدن")'); await pg.wait_for_timeout(200)
            await pg.locator('.calc-card .field:has-text("قیمت نهایی") input').fill('317,875,209'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('shop check: the invoice total reads back as 15% making', '15' in out and 'اجرت' in out, out[:120].replace('\n', ' | '))
            await pg.click('.calc-card .seg button:has-text("خرید")'); await pg.wait_for_timeout(200)
            await pg.click('button:has-text("ثبت به‌عنوان دارایی")'); await pg.wait_for_timeout(700)
            await pg.click('.drawer button:has-text("افزودن")'); await pg.wait_for_timeout(900)
            assets = await pg.evaluate("async () => (await chrome.storage.local.get('assets')).assets")
            a = next((x for x in assets if x.get('name') == 'طلای زینتی'), None)
            ok = bool(a) and a['quantity'] == 10 and a['category'] == 'gold' and a['price']['ref']['key'] == 'geram18' and abs(a['costBasis'] - 3_178_752_090) < 20 and abs(a['price']['adjustPct'] + 1.33) < 0.01
            check('register: a 10 g gold piece, cost = invoice total, valued at 740/750', ok, a and {k: a.get(k) for k in ('quantity', 'costBasis', 'category')} )
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=loan'); await pg.wait_for_timeout(600)
            await pg.locator('.calc-card .field:has-text("مبلغ وام") input').fill('300,000,000'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('loan: 300M at 23% over 36 months → installment 11,612,916', '11,612,916' in out and '23' in out, out[:160].replace('\n', ' | '))
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=rent'); await pg.wait_for_timeout(600)
            await pg.locator('.calc-card .field:has-text("ودیعه (رهن)") input').fill('500,000,000'); await pg.locator('.calc-card .field:has-text("اجاره ماهانه") input').fill('20,000,000'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('rent: 500M + 20M at 3% = 35M all-rent', '35,000,000' in out, out[:120].replace('\n', ' | '))
            overflow = await pg.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1")
            check('calc: no horizontal scroll', not overflow)
            # the four new tools (money fields are in toman)
            fill = lambda label, v: pg.locator(f'.calc-card .field:has-text("{label}") input').first.fill(v)
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=goal'); await pg.wait_for_timeout(600)
            await fill('هدف (به پول امروز)', '1,200,000,000'); await fill('در چند ماه', '12'); await fill('سود سالانهٔ پس‌انداز', '0'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('goal: 1.2B in 12 months at 0% → 100M a month', '100,000,000' in out, out[:160].replace('\n', ' | '))
            await pg.click('.calc-card .seg button:has-text("کی می‌رسم")'); await pg.wait_for_timeout(200)
            await fill('هر ماه کنار می‌گذاری', '100,000,000'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('goal: 100M a month reaches 1.2B in 1 year', '1 سال' in out, out[:160].replace('\n', ' | '))
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=average'); await pg.wait_for_timeout(600)
            await pg.click('.calc-card .seg button:has-text("بدون کارمزد")'); await pg.wait_for_timeout(200)
            blk = lambda b, label, v: pg.locator(f'.calc-blk:has-text("{b}") .field:has-text("{label}") input').first.fill(v)
            await blk('الان داری', 'تعداد', '100'); await blk('الان داری', 'میانگین خرید', '5,000'); await blk('خرید تازه', 'تعداد', '200'); await blk('خرید تازه', 'قیمت هر واحد', '4,000'); await fill('میانگینم برسد به', '4,500'); await pg.wait_for_timeout(300)
            await pg.locator('.calc-card').screenshot(path=f'{SH}/calc-average-filled-{THEME}.png')
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('average: 100 at 5,000 + 200 at 4,000 → 4,333; 100 more for 4,500', '4,333' in out and '100' in out, out[:220].replace('\n', ' | '))
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=trade'); await pg.wait_for_timeout(600)
            await fill('قیمت خرید', '4,000'); await fill('قیمت فروش', '4,600'); await fill('تعداد', '1000'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('trade: break-even 4,050 and net profit after 0.3712% + 0.88%', '4,050' in out and '544,672' in out, out[:220].replace('\n', ' | '))
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=instal'); await pg.wait_for_timeout(600)
            await fill('قیمت نقدی', '80,000,000'); await fill('هر قسط', '8,000,000'); await pg.wait_for_timeout(300)
            out = (await pg.locator('.calc-out').inner_text()).translate(FA)
            check('instalments: 12 × 8M for 80M cash ≈ 35% a year, 16M more', '35' in out and '16,000,000' in out and 'به‌صرفه‌تر' in out, out[:240].replace('\n', ' | '))
            await pg.set_viewport_size({'width': 420, 'height': 900}); await pg.wait_for_timeout(300)
            check('calc (new tools): no horizontal scroll on a narrow window', not await pg.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1"))
            await pg.screenshot(path=f'{SH}/calc-instal-narrow.png', full_page=True)
            await pg.set_viewport_size({'width': 1440, 'height': 1000})
            for t in ['goal', 'average', 'trade']:
                await pg.goto(pg.url.split('#')[0] + f'#/calc?t={t}'); await pg.wait_for_timeout(500)
                await pg.screenshot(path=f'{SH}/calc-{t}.png')
            # every tool: a «how to use» next to the title and a help next to every field label
            for t in ['convert', 'gold', 'rent', 'loan', 'deposit', 'breakeven', 'goal', 'average', 'trade', 'instal']:
                await pg.goto(pg.url.split('#')[0] + f'#/calc?t={t}'); await pg.wait_for_timeout(400)
                card = pg.locator('.page .card').first
                head = await card.locator('.card-h h3 .tipbtn').count()
                bare = await card.evaluate("c => [...c.querySelectorAll('.field > label')].filter(l => l.textContent.trim() && !l.querySelector('.tipbtn')).map(l => l.textContent.trim())")
                check(f'calc {t}: help on the title and on every field', head == 1 and not bare, f'title={head} bare={bare}')
            await pg.goto(pg.url.split('#')[0] + '#/calc?t=average'); await pg.wait_for_timeout(400)
            await pg.locator('.calc-card .card-h h3 .tipbtn').click(); await pg.wait_for_timeout(250)
            pop = await pg.locator('.tippop').inner_text() if await pg.locator('.tippop').count() else ''
            check('calc: the how-to tip opens with its steps', '۱)' in pop and '۳)' in pop, pop[:80])
            await pg.screenshot(path=f'{SH}/calc-tip-{THEME}.png')
            await pg.keyboard.press('Escape')
            await pg.locator('.calc-blk:has-text("الان داری") .field:has-text("میانگین خرید") .tipbtn').hover(); await pg.wait_for_timeout(250)
            pop = await pg.locator('.tippop').inner_text() if await pg.locator('.tippop').count() else ''
            check('calc: a field tip opens on hover with its example', 'مثال' in pop, pop[:80])
            await pg.screenshot(path=f'{SH}/calc-fieldtip-{THEME}.png')
            await pg.close()
        await step('calc', t_calc())

        # a price's detail page: chart, stats, your position with the average-cost line, shortcuts into the tools
        async def t_price():
            pg = await newpage('market')
            await pg.evaluate("""async () => {
              const { history, quotes, assets } = await chrome.storage.local.get(['history', 'quotes', 'assets']);
              const p = quotes['tgju:geram18'].price, now = Date.now(), pts = [];
              for (let k = 365; k >= 0; k--) { const d = new Date(now - k * 86400000); pts.push([d.toISOString().slice(0, 10), Math.round(p * (0.6 + 0.4 * (365 - k) / 365))]); }
              await chrome.storage.local.set({ history: { ...(history || {}), 'tgju:geram18:366': { at: now, points: pts } } });
              for (const g of assets.filter((a) => a.price?.ref?.key === 'geram18' && a.mode === 'units')) g.costBasis = Math.round(g.quantity * (g.price.factor || 1) * p * 0.8);
              const { settings } = await chrome.storage.local.get('settings'); settings.providers = { ...settings.providers, tgju: true };
              await chrome.storage.local.set({ assets, settings });
            }""")
            await pg.reload(); await pg.wait_for_timeout(1200)
            await pg.click('.list .it:has-text("طلای ۱۸ عیار")'); await pg.wait_for_selector('.drawer .pd'); await pg.wait_for_timeout(1200)
            txt = (await pg.inner_text('.drawer')).translate(FA)
            check('price page: high, low, periods and your position', 'بالاترین' in txt and 'پایین‌ترین' in txt and 'سال' in txt and 'سهم تو' in txt, txt[:120].replace('\n', ' | '))
            check('price page: your average cost drawn on the chart', await pg.locator('.drawer .refline').count() == 1)
            check('price page: profit since purchase (cost 80% of today → about +25%, less the asset\'s own price adjustment)', bool(re.search(r'\(\+2[3-5][.٫]\d٪\)', txt)), re.findall(r'سود یا زیان[^\n]*\n[^\n]*', txt)[:1])
            await pg.click('.drawer .pd-ctl .seg button:has-text("دلار")'); await pg.wait_for_timeout(500)
            check('dollar view hides the average-cost line', await pg.locator('.drawer .refline').count() == 0)
            await pg.click('.drawer .chip:has-text("با یک مبلغ")'); await pg.wait_for_timeout(700)
            check('shortcut: the converter opens on this asset', 'calc?t=convert&to=geram18' in pg.url and await pg.locator('.calc-card .seg button.on:has-text("از دارایی")').count() == 1)
            await pg.goto(pg.url.split('#')[0] + '#/market'); await pg.wait_for_timeout(800)
            await pg.click('.list .it:has-text("نیم سکه")'); await pg.wait_for_selector('.drawer .pd'); await pg.wait_for_timeout(600)
            await pg.click('.drawer .chip:has-text("مقایسه با نگه‌داشتن")'); await pg.wait_for_timeout(1200)
            sel = await pg.locator('#compare .cmp-pick select').nth(1).input_value()
            check('shortcut: comparison opens with this coin as option «ب»', sel == 'nim', sel)
            o = await newpage('overview'); await o.click('.prices .pcell >> nth=0'); await o.wait_for_timeout(800)
            check('the overview\'s key prices open the same page', await o.locator('.drawer .pd').count() == 1)
            await o.close(); await pg.close()
        await step('price', t_price())

        # investment profile: questions → saved; starting mix → targets; emergency card on the overview
        async def t_profile():
            pg = await newpage('settings?to=profile'); await pg.wait_for_timeout(400)
            pg.on('dialog', lambda d: asyncio.ensure_future(d.accept()))
            card = pg.locator('#profile')
            await card.locator('.chip:has-text("رشد بلندمدت")').click(); await card.locator('.chip:has-text("بیشتر از ۳ سال")').click(); await card.locator('.chip:has-text("صبر می‌کنم")').click()
            await card.locator('.field:has-text("خرج ماهانه") input').fill('200,000,000')
            await card.locator('.toggle[title="رمزارز نمی‌خواهم"]').click(); await pg.wait_for_timeout(200)
            risk = await card.locator('.card-h .sub').inner_text()
            await card.locator('button:has-text("ذخیرهٔ پروفایل")').click(); await pg.wait_for_timeout(500)
            st = await get(pg, 'settings'); p = st.get('profile') or {}
            check('profile: answers saved (money in Rial), risk «متوسط»', p.get('goal') == 'grow' and p.get('expense') == 2e9 and p.get('noCrypto') is True and 'متوسط' in risk, (p, risk))
            await card.screenshot(path=f'{SH}/profile-{THEME}.png')
            await card.locator('button:has-text("بگذارش ترکیب هدف")').click(); await pg.wait_for_timeout(500)
            t = (await get(pg, 'settings'))['targets']
            check('profile: the starting mix becomes the target mix (no crypto)', sum(t.values()) == 100 and 'crypto' not in t, t)
            await pg.close()
            o = await newpage('overview')
            emg = o.locator('.emg')
            txt = (await emg.inner_text()) if await emg.count() else ''
            check('overview: emergency-fund card from the profile', 'پول اضطراری' in txt and 'ماه' in txt, txt[:120].replace('\n', ' '))
            if await emg.count(): await emg.screenshot(path=f'{SH}/emergency-{THEME}.png')
            await o.close()
        await step('profile', t_profile())

        # «سبدساز»: four mixes on the past, alone or with holdings, a plan with ways in, a saved plan
        async def t_builder():
            pg = await newpage('analysis'); await seed_pb(pg); await pg.reload(); await pg.wait_for_timeout(1200)
            card = pg.locator('#builder')
            await card.locator('.field:has-text("مبلغ") input').fill('700,000,000'); await pg.wait_for_timeout(900)
            n_with = await card.locator('.pb-c').count()
            fits = await card.locator('.pb-c.fits').count()
            has_tg = bool((await get(pg, 'settings')).get('targets'))
            txt = await card.inner_text()
            check('builder: your mix, your target mix and three risk mixes; one fits the profile', n_with == (5 if has_tg else 4) and fits == 1 and 'ماه' in txt and 'بدترین افت' in txt and (not has_tg or 'ترکیب هدف تو' in txt), (n_with, fits, has_tg))
            await card.screenshot(path=f'{SH}/builder-{THEME}.png')
            await card.locator('.seg button:has-text("فقط همین پول")').click(); await pg.wait_for_timeout(700)
            await card.screenshot(path=f'{SH}/builder-alone-{THEME}.png')
            check('builder: «فقط همین پول» keeps the mixes (yours as proportions)', await card.locator('.pb-c').count() == n_with)
            await card.locator('.seg button:has-text("کنار دارایی‌هایم")').click(); await pg.wait_for_timeout(700)
            await card.locator('.pb-c.fits button:has-text("برنامهٔ این سبد")').click(); await pg.wait_for_timeout(500)
            rows = await card.locator('.pb-pr').count()
            await card.locator('.pb-plan').screenshot(path=f'{SH}/builder-plan-{THEME}.png')
            await card.locator('.pb-plan button:has-text("ذخیرهٔ برنامه")').click(); await pg.wait_for_timeout(700)
            plans = (await get(pg, 'settings')).get('plans') or []
            check('builder: a plan per block, saved and listed', rows >= 1 and len(plans) == 1 and await card.locator('.pb-sv').count() == 1, (rows, len(plans)))
            await pg.set_viewport_size({'width': 420, 'height': 900}); await pg.wait_for_timeout(300)
            check('builder: no horizontal scroll on a narrow window', not await pg.evaluate("() => document.documentElement.scrollWidth > innerWidth + 1"))
            await card.screenshot(path=f'{SH}/builder-narrow-{THEME}.png')
            await pg.close()
        await step('builder', t_builder())

        # «واژه‌نامه»: the help button opens it, search narrows it, and words in running text open their meaning
        async def t_glossary():
            pg = await newpage('analysis'); await seed_pb(pg); await pg.reload(); await pg.wait_for_timeout(1000)
            await pg.click('button[aria-label="واژه‌نامه"]'); await pg.wait_for_timeout(300)
            all_n = await pg.locator('.drawer .gl-it').count()
            await pg.fill('.drawer input.input', 'NAV'); await pg.wait_for_timeout(200)
            await pg.locator('.drawer .gl-h').first.click(); await pg.wait_for_timeout(200)
            body = await pg.locator('.drawer .gl-b').first.inner_text()
            await pg.screenshot(path=f'{SH}/glossary-{THEME}.png')
            check('glossary: opens from the top bar, searchable, explains NAV', all_n >= 25 and 'ابطال' in body, (all_n, body[:60]))
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(200)
            card = pg.locator('#builder')
            await card.locator('.field:has-text("مبلغ") input').fill('700,000,000'); await pg.wait_for_timeout(900)
            await card.locator('.pb-c .term').first.hover(); await pg.wait_for_timeout(300)
            pop = await pg.locator('.tippop').inner_text() if await pg.locator('.tippop').count() else ''
            check('glossary: a word on the builder opens its meaning, with a way to the full list', 'همهٔ واژه‌ها' in pop and len(pop) > 40, pop[:80])
            await pg.locator('.tippop button:has-text("همهٔ واژه‌ها")').click(); await pg.wait_for_timeout(300)
            check('glossary: «همهٔ واژه‌ها» opens the list at that word', await pg.locator('.drawer .gl-it.on').count() == 1)
            await pg.keyboard.press('Escape')
            check('builder: a plain summary sits above the mixes', await card.locator('.pb-tldr').count() == 1)
            await pg.close()
        await step('glossary', t_glossary())

        # more currencies: six on the market page, any other added from «ارز دیگر» (and removable); the editor can pick them
        async def t_fx():
            pg = await newpage('market')
            card = pg.locator('.card:has(h3:text-is("ارز"))')
            rows = await card.locator('.list .it').count()
            check('market: six main currencies, yuan among them', rows == 6 and await card.locator('.it:has-text("یوان چین")').count() == 1, rows)
            await card.locator('button:has-text("ارز دیگر")').click(); await pg.wait_for_timeout(300)
            await pg.fill('.modal input.input', 'روبل'); await pg.wait_for_timeout(200)
            opts = await pg.locator('.modal .picker .opt').count()
            await pg.click('.modal .picker .opt:has-text("روبل روسیه")'); await pg.wait_for_timeout(500)
            await pg.screenshot(path=f'{SH}/fx-add-{THEME}.png')
            await pg.click('.modal .btn.primary:has-text("تمام")'); await pg.wait_for_timeout(600)
            check('market: a searched currency is added to the card', opts == 1 and await card.locator('.it:has-text("روبل روسیه")').count() == 1, opts)
            await card.screenshot(path=f'{SH}/fx-card-{THEME}.png')
            await card.locator('.it:has-text("روبل روسیه") button[title="حذف از دیده‌بان"]').click(); await pg.wait_for_timeout(600)
            check('market: an added currency can be removed', await card.locator('.it:has-text("روبل روسیه")').count() == 0)
            await pg.close()
        await step('fx', t_fx())

        # 1.12 review: unit must be confirmed when only guessed; sample data can be cleared; arrow keys in Seg; jumps
        async def t_qc():
            pg = await newpage('settings')
            await pg.click('.imp-or button:has-text("چسباندن از اکسل")')
            await pg.fill('.imp-paste', 'نام\tارزش\nحساب الف\t5000000\nحساب ب\t7000000')
            await pg.click('.imp button:has-text("ادامه")'); await pg.wait_for_timeout(600)
            btn = pg.locator('.imp .btn.primary:has-text("دارایی")').first
            blocked = await btn.is_disabled() and await pg.locator('.imp .callout:has-text("تومان است یا ریال")').count() == 1
            await pg.click('.imp .callout button:has-text("تومان")'); await pg.wait_for_timeout(300)
            check('a guessed amount unit must be confirmed before import', blocked and not await btn.is_disabled())
            await pg.click('.imp button:has-text("انصراف")')
            check('irreversible actions sit in their own section at the end', await pg.locator('.danger-zone button:has-text("پاک‌کردن همه")').count() == 1)
            # sample data: banner on the overview clears only the sample rows
            await pg.evaluate("""async () => { const { assets } = await chrome.storage.local.get('assets');
              await chrome.storage.local.set({ assets: [...assets, { id: 'smp1', code: 'S-1', name: 'نمونه آزمایشی', category: 'bank', mode: 'balance', balance: 1000, balanceAt: Date.now(), sample: true }] }); }""")
            o = await newpage('overview')
            n0 = len(await get(o, 'assets'))
            o.once('dialog', lambda d: asyncio.ensure_future(d.accept()))
            await o.click('.callout button:has-text("پاک کن و شروع کن")'); await o.wait_for_timeout(800)
            a1 = await get(o, 'assets')
            check('sample data clears only the sample rows', len(a1) == n0 - 1 and not any(a.get('sample') for a in a1), (n0, len(a1)))
            # radio group: arrow keys move the choice (RTL: ← is next)
            await o.focus('.hero .seg button.on'); await o.keyboard.press('ArrowLeft'); await o.wait_for_timeout(400)
            st = await get(o, 'settings')
            check('arrow keys change a segmented choice', st.get('denom') == 'usd', st.get('denom'))
            await o.evaluate("async () => { const { settings } = await chrome.storage.local.get('settings'); await chrome.storage.local.set({ settings: { ...settings, denom: 'money' } }); }")
            a = await newpage('analysis')
            check('analysis has jumps to each part', await a.locator('.jumps .chip').count() == 6)
            await a.click('.jumps .chip:has-text("مقایسه")'); await a.wait_for_timeout(700)
            y = await a.evaluate("() => document.getElementById('compare').getBoundingClientRect().top")
            check('a jump scrolls its part into view', 0 <= y < 900, y)
            await a.close(); await o.close(); await pg.close()
        await step('qc', t_qc())

        check('no console/page errors', not errors, errors[:6])
        await ctx.close()

asyncio.run(main())
print('\nSUMMARY:', sum(results), '/', len(results), 'passed')
