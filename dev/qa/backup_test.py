# E2E for automatic backups (1.11): a backup file written by the service worker, «nothing changed» skips, keeping
# the last few, a password-locked file that opens only with its password, and restoring it through «ورود اطلاعات».
# Synthetic data only. Run: python3 dev/qa/backup_test.py
import asyncio, json, os, shutil, pathlib
from playwright.async_api import async_playwright
ROOT = pathlib.Path(__file__).resolve().parents[2]
EXT = '/tmp/dara-bk'; PROF = '/tmp/pwbk'; DL = '/tmp/dara-bk-dl'
for d in (EXT, PROF, DL): shutil.rmtree(d, ignore_errors=True)
shutil.copytree(ROOT / 'extension', EXT); os.makedirs(DL)
seed = json.load(open(pathlib.Path(__file__).with_name('.seed.json')))
results = []
def check(name, ok, info=''):
    results.append(ok); print(('PASS ' if ok else 'FAIL ') + name + (f' — {info}' if info not in ('', None) else ''), flush=True)
async def step(name, coro):
    try: await coro
    except Exception as e: check(name + ' (exception)', False, str(e).split('\n')[0][:220])

async def main():
    async with async_playwright() as p:
        ctx = await p.chromium.launch_persistent_context(PROF, headless=False, accept_downloads=True, downloads_path=DL,
            args=['--headless=new', f'--disable-extensions-except={EXT}', f'--load-extension={EXT}', '--lang=fa'], viewport={'width': 1440, 'height': 1000})
        errors = []
        sw = ctx.service_workers[0] if ctx.service_workers else await ctx.wait_for_event('serviceworker', timeout=15000)
        ext = sw.url.split('/')[2]
        boot = await ctx.new_page(); await boot.goto(f'chrome-extension://{ext}/ui/popup.html'); await boot.wait_for_timeout(800)
        await boot.evaluate("async (s) => { await chrome.storage.local.clear(); await chrome.storage.local.set(s); }", seed)
        await boot.close()
        for t in list(ctx.pages):
            if 'welcome' in t.url: await t.close()
        pg = await ctx.new_page()
        pg.on('pageerror', lambda e: errors.append(str(e)))
        await pg.goto(f'chrome-extension://{ext}/ui/app.html#/settings'); await pg.wait_for_timeout(1200)
        get = lambda k: pg.evaluate(f"async () => (await chrome.storage.local.get('{k}'))['{k}']")
        send = lambda t: pg.evaluate("(t) => new Promise((res) => chrome.runtime.sendMessage({ type: t }, res))", t)
        dl = lambda i: pg.evaluate("async (id) => (await chrome.downloads.search({ id }))[0] || null", i)

        async def t_card():
            card = pg.locator('#backup')
            txt = await card.inner_text()
            check('settings: the backup card, weekly and «keep all» by default', 'پشتیبان خودکار' in txt and await card.locator('.seg button.on:has-text("هفتگی")').count() == 1 and await card.locator('.seg button.on:has-text("همه بمانند")').count() == 1)
        await step('card', t_card())

        async def t_first():
            await pg.click('#backup button:has-text("همین الان پشتیبان بگیر")'); await pg.wait_for_timeout(2500)
            meta = (await get('meta')).get('backup') or {}
            files = meta.get('files') or []
            check('a backup file is written and recorded', len(files) == 1 and meta.get('lastAt') and not meta.get('error'), meta)
            d = await dl(files[0]['id']) if files else None
            ok = bool(d) and d['state'] == 'complete' and os.path.exists(d['filename'])
            check('the download completed and the file is on disk', ok, d and {k: d.get(k) for k in ('state', 'filename')})
            if ok:
                obj = json.load(open(d['filename'], encoding='utf-8'))
                check('the file is a Dara backup with the assets and no API key', obj.get('app') == 'dara' and len(obj['data']['assets']) == len(seed['assets']) and 'apiKey' not in json.dumps(obj['data'].get('ai', {})).replace('"apiKey": ""', ''))
        await step('first', t_first())

        async def t_unchanged():
            await pg.evaluate("async () => { const { meta } = await chrome.storage.local.get('meta'); meta.backup.lastAt -= 8 * 86400000; meta.backup.checkedAt = meta.backup.lastAt; await chrome.storage.local.set({ meta }); }")
            r = await send('backupCheck')
            meta = (await get('meta'))['backup']
            check('due but nothing entered changed → no new file', r.get('unchanged') and len(meta['files']) == 1, r)
            await pg.evaluate("async () => { const { assets } = await chrome.storage.local.get('assets'); assets[0].note = 'تغییر آزمایشی'; await chrome.storage.local.set({ assets }); const { meta } = await chrome.storage.local.get('meta'); meta.backup.checkedAt = meta.backup.lastAt = Date.now() - 8 * 86400000; await chrome.storage.local.set({ meta }); }")
            r = await send('backupCheck'); await pg.wait_for_timeout(500)
            meta = (await get('meta'))['backup']
            check('due and something changed → a new file', bool(r.get('saved')) and len(meta['files']) == 2, r)
            r = await send('backupCheck')
            check('not due again right after', r.get('skipped') is True, r)
        await step('unchanged', t_unchanged())

        async def t_keep():
            await pg.evaluate("async () => { const { settings } = await chrome.storage.local.get('settings'); settings.backup = { freq: 'weekly', keep: 'last', last: 2 }; await chrome.storage.local.set({ settings }); }")
            before = (await get('meta'))['backup']['files']
            paths = {f['id']: (await dl(f['id']))['filename'] for f in before}
            await send('backupNow'); await pg.wait_for_timeout(600)
            meta = (await get('meta'))['backup']
            gone = [f for f in before if f['id'] not in [x['id'] for x in meta['files']]]
            check('«last 2» keeps two and removes the oldest', len(meta['files']) == 2 and len(gone) == 1, [f['name'] for f in meta['files']])
            check('the removed file is gone from disk too, the kept ones are not', bool(gone) and not os.path.exists(paths[gone[0]['id']]) and all(os.path.exists(paths[f['id']]) for f in before if f not in gone))
            await pg.evaluate("async () => { const { settings } = await chrome.storage.local.get('settings'); settings.backup = { freq: 'weekly', keep: 'all', last: 8 }; await chrome.storage.local.set({ settings }); }")
        await step('keep', t_keep())

        async def t_lock():
            await pg.reload(); await pg.wait_for_timeout(1000)
            await pg.click('#backup button:has-text("گذاشتن رمز")')
            await pg.locator('#backup input[type=password]').nth(0).fill('رمز-آزمایشی-۱۲۳')
            await pg.locator('#backup input[type=password]').nth(1).fill('رمز-آزمایشی-۱۲۳')
            await pg.click('#backup button:has-text("ذخیره رمز")'); await pg.wait_for_timeout(1500)
            vault = await get('vault')
            check('a password makes a key kept on this computer', bool(vault and vault.get('key') and vault.get('salt')))
            meta = (await get('meta'))['backup']
            check('setting a password makes a locked backup right away', meta['files'][-1]['locked'] is True, meta['files'][-1])
            plain = [f for f in meta['files'] if not f['locked']]
            plain_paths = [(await dl(f['id']))['filename'] for f in plain]
            check('the earlier unlocked backups are pointed out', await pg.locator('#backup .callout:has-text("بدون رمز ساخته شده")').count() == 1)
            await pg.click('#backup button:has-text("پاک کردن پشتیبان‌های بدون رمز")'); await pg.wait_for_timeout(1500)
            meta = (await get('meta'))['backup']
            check('…and removed on request, from disk and from the list', all(not os.path.exists(x) for x in plain_paths) and all(f['locked'] for f in meta['files']), len(plain_paths))
            f = meta['files'][-1]
            d = await dl(f['id'])
            raw = open(d['filename'], encoding='utf-8').read()
            env = json.loads(raw)
            check('the new file is locked: nothing readable, the key not inside', f['locked'] and env.get('kind') == 'locked-backup' and seed['assets'][0]['name'] not in raw and vault['key'] not in raw)
            exp = await pg.evaluate("async () => { const { exportBackup } = await import('/lib/store.js'); return JSON.stringify(await exportBackup()); }")
            check('a backup of the data never carries the password key', vault['key'] not in exp and '"vault"' not in exp)
            # restore it through «ورود اطلاعات»: asks for the password, rejects a wrong one, opens with the right one
            await pg.locator('.imp-drop input[type=file]').set_input_files(d['filename']); await pg.wait_for_timeout(800)
            check('restoring a locked file asks for its password', await pg.locator('.imp input[type=password]').count() == 1)
            await pg.fill('.imp input[type=password]', 'غلط'); await pg.click('.imp button:has-text("باز کردن")'); await pg.wait_for_timeout(1500)
            check('a wrong password is refused', 'رمز درست نیست' in await pg.inner_text('.imp'))
            await pg.fill('.imp input[type=password]', 'رمز-آزمایشی-۱۲۳'); await pg.click('.imp button:has-text("باز کردن")'); await pg.wait_for_timeout(2000)
            txt = await pg.inner_text('.imp')
            check('the right password opens it as a Dara backup', 'پشتیبان دارا' in txt and 'جایگزینی همه داده‌ها' in txt, txt[:120].replace('\n', ' | '))
        await step('lock', t_lock())

        async def t_att():
            await pg.evaluate("async () => { const { meta } = await chrome.storage.local.get('meta'); meta.backup.error = 'آزمایش'; meta.backup.errorAt = Date.now(); await chrome.storage.local.set({ meta }); }")
            o = await ctx.new_page(); await o.goto(f'chrome-extension://{ext}/ui/app.html#/overview'); await o.wait_for_timeout(1500)
            check('a failed backup shows in «نیاز به توجه»', 'پشتیبان خودکار ساخته نشد' in await o.inner_text('.kpis.ov'))
            await o.close()
            await pg.reload(); await pg.wait_for_timeout(800)
            await pg.locator('#backup').screenshot(path=str(ROOT / 'shots' / 'backup-card.png'))
        await step('attention', t_att())

        check('no page errors', not errors, errors[:4])
        await ctx.close()

asyncio.run(main())
print('\nSUMMARY:', sum(results), '/', len(results), 'passed')
