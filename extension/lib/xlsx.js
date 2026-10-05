// A small, dependency-free .xlsx reader: the zip container (stored or deflated entries, unzipped with the browser's own
// DecompressionStream) and the few XML parts that hold cell text. Returns every sheet as rows of strings.
// Old binary .xls files are not supported (they are a different format).

const td = new TextDecoder('utf-8');
const u16 = (b, o) => b[o] | (b[o + 1] << 8);
const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

async function inflateRaw(bytes) {
  const ds = new DecompressionStream('deflate-raw');
  const out = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).arrayBuffer();
  return new Uint8Array(out);
}

/** name → Uint8Array of every file in a zip */
export async function unzip(buf) {
  const b = new Uint8Array(buf);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (u32(b, i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('این فایل اکسل (xlsx) نیست یا خراب است');
  const count = u16(b, eocd + 10); let p = u32(b, eocd + 16);
  const files = {};
  for (let n = 0; n < count; n++) {
    if (u32(b, p) !== 0x02014b50) throw new Error('ساختار فایل اکسل خراب است');
    const method = u16(b, p + 10), csize = u32(b, p + 20), nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32), lho = u32(b, p + 42);
    const name = td.decode(b.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (u32(b, lho) !== 0x04034b50) continue;
    const start = lho + 30 + u16(b, lho + 26) + u16(b, lho + 28);
    const data = b.subarray(start, start + csize);
    if (method === 0) files[name] = data;
    else if (method === 8) files[name] = await inflateRaw(data);
  }
  return files;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export const unescapeXml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e.toLowerCase()]);
const textOf = (xml) => [...String(xml).matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => unescapeXml(m[1])).join('');
const attr = (tag, name) => { const m = new RegExp(`\\s${name}="([^"]*)"`).exec(tag); return m ? unescapeXml(m[1]) : null; };
const colIndex = (ref) => { let n = 0; for (const ch of String(ref).replace(/\d+/g, '').toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
/** a stored number as plain digits («1.5E+7» → «15000000»), so it reads like what the cell showed */
const plainNum = (v) => { const x = Number(v); return isFinite(x) ? x.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 10 }) : v; };

export function sheetRows(xml, shared = []) {
  const rows = [];
  // «<x:row>»: some writers prefix every tag with a namespace
  xml = String(xml).replace(/<(\/?)[a-z][\w.-]*:(?=[a-z])/gi, '<$1');
  for (const rm of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const r = +attr(rm[1], 'r') || rows.length + 1;
    const row = [];
    for (const cm of (rm[2] || '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const head = cm[1], body = cm[2] || '';
      const ref = attr(head, 'r'); const t = attr(head, 't');
      const idx = ref ? colIndex(ref) : row.length;
      const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let val = '';
      if (t === 's') val = shared[+v] ?? '';
      else if (t === 'inlineStr') val = textOf(body);
      else if (t === 'str' || t === 'e') val = v !== undefined ? unescapeXml(v) : '';
      else if (t === 'b') val = v === '1' ? 'TRUE' : v === '0' ? 'FALSE' : '';
      else if (v !== undefined) val = plainNum(unescapeXml(v));
      while (row.length < idx) row.push('');
      row[idx] = val;
    }
    while (rows.length < r - 1) rows.push([]);
    rows[r - 1] = row;
  }
  return rows;
}

/** { sheets: [{ name, rows }] } from an .xlsx file's bytes */
export async function readXlsx(buf) {
  const head = new Uint8Array(buf.slice ? buf.slice(0, 8) : buf);
  if (head[0] === 0xd0 && head[1] === 0xcf) throw new Error('این فایل اکسل قدیمی (xls) یا رمزدار است؛ در اکسل رمز را بردار یا با «Save As» آن را xlsx یا CSV ذخیره کن');
  const files = await unzip(buf);
  const str = (n) => (files[n] ? td.decode(files[n]).replace(/<(\/?)[a-z][\w.-]*:(?=[a-z])/gi, '<$1') : '');
  const shared = [...str('xl/sharedStrings.xml').matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1].replace(/<rPh\b[\s\S]*?<\/rPh>/g, '')));
  const rels = Object.fromEntries([...str('xl/_rels/workbook.xml.rels').matchAll(/<Relationship\b([^>]*)\/?>/g)].map((m) => [attr(m[1], 'Id'), attr(m[1], 'Target')]));
  const sheets = [];
  for (const m of str('xl/workbook.xml').matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = attr(m[1], 'name') || `Sheet${sheets.length + 1}`;
    const state = attr(m[1], 'state');
    let target = rels[attr(m[1], 'r:id')] || '';
    target = target.replace(/^\/?xl\//, '').replace(/^\//, '');
    const xml = str('xl/' + target);
    if (!xml || state === 'hidden' || state === 'veryHidden') continue;
    sheets.push({ name, rows: sheetRows(xml, shared) });
  }
  if (!sheets.length) throw new Error('در این فایل اکسل برگه‌ای با داده پیدا نشد');
  return { sheets };
}
