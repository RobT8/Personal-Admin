/* Personal Admin — read dropped files into plain text, entirely in the browser.
   Supports: .eml (incl. attached PDFs), .msg (best effort), .pdf, .docx, .html, .txt, images (kept, not read). */
(function (g) {
  'use strict';

  const td = (label) => {
    try { return new TextDecoder(label || 'utf-8'); } catch { return new TextDecoder('utf-8'); }
  };

  function htmlToText(html) {
    const prepared = String(html)
      .replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|tr|li|h\d|table|section|td)>/gi, (m, t) => (t.toLowerCase() === 'td' ? ' \t ' : '\n'));
    const doc = new DOMParser().parseFromString(prepared, 'text/html');
    return (doc.body ? doc.body.textContent : '').replace(/[ \t]+/g, ' ').replace(/\n\s*\n\s*\n+/g, '\n\n').trim();
  }

  /* ---------- PDF ---------- */
  async function pdfToText(arrayBuffer) {
    const lib = g.pdfjsLib;
    if (!lib) throw new Error('PDF reader not available');
    const doc = await lib.getDocument({ data: new Uint8Array(arrayBuffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false }).promise;
    const pages = [];
    for (let i = 1; i <= Math.min(doc.numPages, 30); i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      let line = '', lastY = null;
      const lines = [];
      for (const it of content.items) {
        const y = it.transform ? Math.round(it.transform[5]) : null;
        if (lastY !== null && y !== null && Math.abs(y - lastY) > 2) { lines.push(line); line = ''; }
        line += (line && !line.endsWith(' ') && it.str && !it.str.startsWith(' ') ? ' ' : '') + it.str;
        if (it.hasEOL) { lines.push(line); line = ''; }
        lastY = y;
      }
      lines.push(line);
      pages.push(lines.map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n'));
    }
    return pages.join('\n\n');
  }

  /* ---------- DOCX (zip → word/document.xml) ---------- */
  async function unzipEntry(buf, wanted) {
    const dv = new DataView(buf);
    let eocd = -1;
    for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 66000); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    for (let n = 0; n < count; n++) {
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true), extraLen = dv.getUint16(p + 30, true), commentLen = dv.getUint16(p + 32, true);
      const local = dv.getUint32(p + 42, true);
      const name = td().decode(new Uint8Array(buf, p + 46, nameLen));
      if (name === wanted) {
        const lNameLen = dv.getUint16(local + 26, true), lExtraLen = dv.getUint16(local + 28, true);
        const data = new Uint8Array(buf, local + 30 + lNameLen + lExtraLen, csize);
        if (method === 0) return td().decode(data);
        const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return await new Response(stream).text();
      }
      p += 46 + nameLen + extraLen + commentLen;
    }
    throw new Error(`${wanted} not found`);
  }
  async function docxToText(buf) {
    const xml = await unzipEntry(buf, 'word/document.xml');
    return xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:br\/>/g, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  /* ---------- EML (RFC 822 / MIME) ---------- */
  function splitHeaders(raw) {
    const idx = raw.search(/\r?\n\r?\n/);
    const head = idx >= 0 ? raw.slice(0, idx) : raw;
    const body = idx >= 0 ? raw.slice(idx).replace(/^\r?\n\r?\n/, '') : '';
    const headers = {};
    head.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/).forEach((line) => {
      const m = /^([\w-]+):\s*(.*)$/.exec(line);
      if (m) headers[m[1].toLowerCase()] = m[2];
    });
    return { headers, body };
  }
  function param(header, name) {
    const m = new RegExp(`${name}\\*?=\\s*(?:"([^"]*)"|([^;\\s]*))`, 'i').exec(header || '');
    return m ? (m[1] ?? m[2]) : '';
  }
  // body is a "binary string" (one char per byte); returns bytes
  function decodeTransfer(body, enc) {
    enc = (enc || '').toLowerCase();
    if (enc === 'base64') {
      const clean = body.replace(/[^A-Za-z0-9+/=]/g, '');
      try {
        const bin = atob(clean);
        return Uint8Array.from(bin, (c) => c.charCodeAt(0));
      } catch { return new Uint8Array(); }
    }
    if (enc === 'quoted-printable') {
      const s = body.replace(/=\r?\n/g, '');
      const out = [];
      for (let i = 0; i < s.length; i++) {
        if (s[i] === '=' && /^[0-9A-F]{2}$/i.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
        else out.push(s.charCodeAt(i) & 0xff);
      }
      return new Uint8Array(out);
    }
    return Uint8Array.from(body, (c) => c.charCodeAt(0) & 0xff);
  }
  function decodeWords(s) {
    // =?utf-8?B?...?= / =?utf-8?Q?...?=
    return String(s || '').replace(/=\?([^?]+)\?([BQ])\?([^?]*)\?=/gi, (_, cs, mode, data) => {
      const bytes = mode.toUpperCase() === 'B' ? decodeTransfer(data, 'base64') : decodeTransfer(data.replace(/_/g, ' '), 'quoted-printable');
      return td(cs).decode(bytes);
    }).replace(/\?=\s+=\?/g, '');
  }

  async function walkMime(raw, acc) {
    const { headers, body } = splitHeaders(raw);
    const ctype = headers['content-type'] || 'text/plain';
    const type = ctype.split(';')[0].trim().toLowerCase();
    if (type.startsWith('multipart/')) {
      const boundary = param(ctype, 'boundary');
      if (!boundary) return;
      const parts = body.split(new RegExp(`\\r?\\n?--${boundary.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:--)?\\s*`));
      for (const part of parts) if (part.trim()) await walkMime(part, acc);
      return;
    }
    if (type === 'message/rfc822') return walkMime(body, acc);
    const bytes = decodeTransfer(body, headers['content-transfer-encoding']);
    const filename = decodeWords(param(headers['content-disposition'], 'filename') || param(ctype, 'name'));
    if (type === 'text/plain' && !filename) acc.plain.push(td(param(ctype, 'charset')).decode(bytes));
    else if (type === 'text/html' && !filename) acc.html.push(td(param(ctype, 'charset')).decode(bytes));
    else if (type === 'application/pdf' || /\.pdf$/i.test(filename)) {
      try { acc.attachments.push({ name: filename || 'attachment.pdf', text: await pdfToText(bytes.buffer) }); }
      catch { acc.attachments.push({ name: filename, text: '' }); }
    } else if (/\.docx$/i.test(filename)) {
      try { acc.attachments.push({ name: filename, text: await docxToText(bytes.buffer) }); } catch { /* skip */ }
    }
  }

  async function emlToText(buf) {
    const raw = td('latin1').decode(buf); // byte-preserving
    const { headers } = splitHeaders(raw);
    const acc = { plain: [], html: [], attachments: [] };
    await walkMime(raw, acc);
    const body = acc.plain.length ? acc.plain.join('\n\n') : acc.html.map(htmlToText).join('\n\n');
    const meta = {
      subject: decodeWords(headers.subject),
      from: decodeWords(headers.from),
      date: (() => { const d = new Date(headers.date); return isNaN(d) ? '' : g.PACore.toISO(d); })(),
    };
    let text = body;
    for (const a of acc.attachments) if (a.text) text += `\n\n--- Attachment: ${a.name} ---\n${a.text}`;
    return { text, meta, notes: acc.attachments.length ? `Also read ${acc.attachments.length} attachment(s): ${acc.attachments.map((a) => a.name).join(', ')}` : '' };
  }

  /* ---------- Outlook .msg (OLE) — best effort: pull readable strings ---------- */
  function msgToText(buf) {
    const bytes = new Uint8Array(buf);
    const runs = [];
    // UTF-16LE runs
    let cur = '';
    for (let i = 0; i + 1 < bytes.length; i += 2) {
      const c = bytes[i] | (bytes[i + 1] << 8);
      if ((c >= 32 && c < 0xd800) || c === 10 || c === 13 || c === 9) cur += String.fromCharCode(c);
      else { if (cur.trim().length >= 6) runs.push(cur); cur = ''; }
    }
    if (cur.trim().length >= 6) runs.push(cur);
    const text = runs.filter((r) => /[a-z]{3}/i.test(r) && !/[Ā-￿]{3}/.test(r)).join('\n');
    const subject = (/Subject:\s*([^\n]+)/i.exec(text) || [])[1] || '';
    const from = (/From:\s*([^\n]+)/i.exec(text) || [])[1] || '';
    return { text: text.includes('<html') ? htmlToText(text) : text, meta: { subject, from }, notes: 'Outlook .msg read in best-effort mode — check the details carefully.' };
  }

  /* ---------- Entry point ---------- */
  async function readFile(file) {
    const name = file.name || 'file';
    const type = file.type || '';
    const ext = (/\.([a-z0-9]+)$/i.exec(name) || [])[1]?.toLowerCase() || '';
    const buf = await file.arrayBuffer();
    try {
      if (ext === 'eml' || type === 'message/rfc822') return { kind: 'email', ...(await emlToText(buf)) };
      if (ext === 'msg') return { kind: 'email', ...msgToText(buf) };
      if (ext === 'pdf' || type === 'application/pdf') return { kind: 'pdf', text: await pdfToText(buf), meta: {} };
      if (ext === 'docx') return { kind: 'doc', text: await docxToText(buf), meta: {} };
      if (ext === 'html' || ext === 'htm' || type === 'text/html') return { kind: 'doc', text: htmlToText(td().decode(buf)), meta: {} };
      if (type.startsWith('image/')) return { kind: 'image', text: '', meta: {}, notes: "Images can't be read automatically — the picture is shown so you can type the details in." };
      if (type.startsWith('text/') || ['txt', 'csv', 'md', 'ics'].includes(ext)) {
        const text = td().decode(buf);
        // A text file that is really an email
        if (/^(?:Received|From|Return-Path|MIME-Version|Subject):/m.test(text.slice(0, 2000)) && /\n\r?\n/.test(text)) return { kind: 'email', ...(await emlToText(buf)) };
        return { kind: 'text', text, meta: {} };
      }
      // Unknown: try as text if it mostly decodes cleanly
      const t = td().decode(buf.slice(0, 200000));
      if ((t.match(/�/g) || []).length < t.length / 50) return { kind: 'text', text: t, meta: {} };
      return { kind: 'other', text: '', meta: {}, notes: 'This file type could not be read — it has been kept as an attachment.' };
    } catch (e) {
      return { kind: 'other', text: '', meta: {}, notes: `Could not read this file (${e.message}). It has been kept as an attachment.` };
    }
  }

  /* ---------- Excel .xlsx → rows (first sheet) ---------- */
  async function xlsxToRows(buf) {
    const xml = (t) => new DOMParser().parseFromString(t, 'application/xml');
    let shared = [];
    try {
      const sst = xml(await unzipEntry(buf, 'xl/sharedStrings.xml'));
      shared = [...sst.getElementsByTagName('si')].map((si) => [...si.getElementsByTagName('t')].map((t) => t.textContent).join(''));
    } catch { /* a sheet with no text cells has no shared strings */ }
    let sheetPath = 'xl/worksheets/sheet1.xml';
    try {
      // Use the first sheet in the workbook's order, wherever it's stored
      const wb = xml(await unzipEntry(buf, 'xl/workbook.xml'));
      const first = wb.getElementsByTagName('sheet')[0];
      const rid = first && (first.getAttribute('r:id') || first.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id'));
      const rels = xml(await unzipEntry(buf, 'xl/_rels/workbook.xml.rels'));
      const rel = [...rels.getElementsByTagName('Relationship')].find((r) => r.getAttribute('Id') === rid);
      if (rel) sheetPath = 'xl/' + rel.getAttribute('Target').replace(/^\/?xl\//, '').replace(/^\//, '');
    } catch { /* fall back to sheet1 */ }
    const sheet = xml(await unzipEntry(buf, sheetPath));
    const colIndex = (ref) => [...ref.replace(/\d+/g, '')].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;
    const rows = [];
    for (const row of sheet.getElementsByTagName('row')) {
      const out = [];
      for (const c of row.getElementsByTagName('c')) {
        const i = colIndex(c.getAttribute('r') || 'A');
        const t = c.getAttribute('t');
        const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
        let val;
        if (t === 's') val = shared[Number(v)] ?? '';
        else if (t === 'inlineStr') val = [...c.getElementsByTagName('t')].map((x) => x.textContent).join('');
        else if (t === 'str' || t === 'b' || t === 'e') val = v;
        else val = v === '' ? '' : Number(v);
        while (out.length < i) out.push('');
        out[i] = typeof val === 'string' ? val.trim() : val;
      }
      if (out.some((x) => x !== '' && x != null)) rows.push(out);
    }
    return rows;
  }

  const isSpreadsheet = (file) => /\.(csv|tsv|xlsx)$/i.test(file.name || '') || /text\/csv|tab-separated|spreadsheetml\.sheet/.test(file.type || '');

  async function readSpreadsheet(file) {
    if (/\.xlsx$/i.test(file.name || '') || /spreadsheetml\.sheet/.test(file.type || '')) return xlsxToRows(await file.arrayBuffer());
    return g.PASheet.parseDelimited(await file.text());
  }

  g.PAParsers = { readFile, htmlToText, emlToText, pdfToText, docxToText, isSpreadsheet, readSpreadsheet };
})(globalThis);
