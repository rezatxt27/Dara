// Release notes for one version, from extension/lib/changelog.js (the same list Settings shows).
// Usage: node dev/release/notes.mjs 1.4.1 [path/to/changelog.js]
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const v = process.argv[2];
if (!v) { console.error('usage: notes.mjs <version> [changelog.js]'); process.exit(2); }
const file = resolve(process.argv[3] || 'extension/lib/changelog.js');
const { CHANGELOG } = await import(pathToFileURL(file).href);
const fa = (s) => String(s).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[d]).replace(/\./g, '٫');
const entry = CHANGELOG.find((e) => e.v === v);

const out = [`## تازه‌های نسخه ${fa(v)}`, ''];
if (entry) for (const it of entry.items) out.push(`- ${it}`);
else out.push('- بهبودهای جزئی و رفع اشکال');
out.push('', '### نصب و به‌روزرسانی',
  `- **به‌روزرسانی:** فایل \`dara-extension-v${v}.zip\` را دانلود و باز کن و محتوایش را روی همان پوشه قبلی دارا بریز (مسیر پوشه عوض نشود تا داده‌ها حفظ شوند). بعد صفحه دارا را تازه‌سازی کن؛ نسخه جدید خودش نصب می‌شود.`,
  '- **نصب اول:** فایل را در یک پوشه ثابت باز کن، در `chrome://extensions` حالت Developer mode را روشن کن و با Load unpacked همان پوشه را انتخاب کن.');
console.log(out.join('\n'));
