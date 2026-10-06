/* Personal Admin — import rows from a spreadsheet (CSV/TSV, pasted cells, or .xlsx rows).
   Pure functions: text/rows in, suggested items out. No DOM, no storage. */
(function (g) {
  'use strict';

  const C = g.PACore, X = g.PAExtract;

  /* ---------- parsing ---------- */

  // CSV or TSV (what Google Sheets gives you on "Copy"), with quoted fields.
  function parseDelimited(text) {
    text = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const firstLine = text.split('\n', 1)[0];
    const delim = (firstLine.match(/\t/g) || []).length >= (firstLine.match(/,/g) || []).length && firstLine.includes('\t') ? '\t'
      : (firstLine.match(/;/g) || []).length > (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"' && cell === '') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c !== ''));
  }

  /* ---------- columns ---------- */

  const TARGETS = [
    ['ignore', '— Ignore this column —'],
    ['name', 'Item name'],
    ['provider', 'Provider / company'],
    ['category', 'Type'],
    ['owner', 'Belongs to (person)'],
    ['frequency', 'How often'],
    ['endDate', 'Renewal date'],
    ['endDate2', 'End date'],
    ['startDate', 'Start date'],
    ['paymentDay', 'Payment day of month'],
    ['monthlyAmount', 'Monthly amount'],
    ['annualAmount', 'Annual amount'],
    ['cost', 'Cost (per payment)'],
    ['reference', 'Reference / policy no.'],
    ['phoneNumber', 'Phone number'],
    ['vehicleReg', 'Vehicle reg'],
    ['notes', 'Notes'],
  ];

  // Order matters: the first rule that matches a heading wins.
  const HEADER_RULES = [
    ['paymentDay', /(payment|pay|dd|debit|collect\w*)\s*(day|date)|day\s*(of|each)|day paid|date taken/i],
    ['monthlyAmount', /month\w*\s*(amount|cost|payment|price|£|fee)|per month|pcm|\(monthly\)/i],
    ['annualAmount', /(annual|year\w*)\s*(amount|cost|payment|price|premium|£|fee)|per (year|annum)|\(annual\)/i],
    ['endDate', /renew/i],
    ['endDate2', /end|expir|until|finish|maturity/i],
    ['startDate', /start|began|inception|from/i],
    ['frequency', /freq|how often|period|billing|paid\b/i],
    ['provider', /provider|company|supplier|bank|insurer|lender|network|who with|vendor/i],
    ['reference', /ref|policy\s*(no|number|#)|account\s*(no|number|#)|number\b|licen[cs]e no/i],
    ['phoneNumber', /phone|mobile no/i],
    ['vehicleReg', /reg\b|registration|vehicle/i],
    ['owner', /owner|person|who\b|for whom|belongs/i],
    ['category', /type|category|kind/i],
    ['cost', /amount|cost|price|premium|£|payment|fee/i],
    ['notes', /note|comment|detail|info/i],
    ['name', /item|name|description|what|service|policy|contract|bill/i],
  ];

  function guessMapping(headers) {
    const used = new Set();
    const map = headers.map((h) => {
      for (const [target, re] of HEADER_RULES) {
        if (re.test(h) && !used.has(target)) { used.add(target); return target; }
      }
      return 'ignore';
    });
    // An "End date" with no "Renewal date" column is the key date
    if (!map.includes('endDate') && map.includes('endDate2')) map[map.indexOf('endDate2')] = 'endDate';
    // No obvious name column: use the first unmapped one
    if (!map.includes('name')) {
      const i = map.indexOf('ignore');
      if (i >= 0) map[i] = 'name';
    }
    return map;
  }

  /* ---------- values ---------- */

  function parseMoney(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return v;
    const m = /-?\d[\d,]*(?:\.\d+)?|-?\.\d+/.exec(String(v).replace(/\s/g, ''));
    if (!m) return null;
    const n = parseFloat(m[0].replace(/,/g, ''));
    return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
  }

  function parseFrequency(v) {
    const s = String(v || '').toLowerCase();
    if (!s) return '';
    if (/10|ten/.test(s)) return 'ten_monthly';
    if (/quarter|3\s*month/.test(s)) return 'quarterly';
    if (/week/.test(s)) return 'weekly';
    if (/one[\s-]?off|once|single/.test(s)) return 'one_off';
    if (/month|pcm|\bpm\b|\bm\b/.test(s)) return 'monthly';
    if (/annual|year|\bpa\b|\bp\.a\.|12\s*month|\by\b/.test(s)) return 'annually';
    return '';
  }

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
  function parseDate(v) {
    if (v == null || v === '') return '';
    // Spreadsheet serial number (days since 1899-12-30), as found in .xlsx files
    if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v))) {
      const n = Number(v);
      if (n > 20000 && n < 80000) return C.addDays('1899-12-30', Math.floor(n));
    }
    const s = String(v);
    const found = X.findDates(s);
    if (found.length) return found[0].iso;
    // "March 2027" / "Mar-27": take the 1st of that month
    const my = /\b([A-Za-z]{3,9})[\s\-/]+(\d{4}|\d{2})\b/.exec(s);
    if (my && MONTHS[my[1].slice(0, 3).toLowerCase()]) {
      const y = my[2].length === 2 ? 2000 + Number(my[2]) : Number(my[2]);
      return `${y}-${String(MONTHS[my[1].slice(0, 3).toLowerCase()]).padStart(2, '0')}-01`;
    }
    return '';
  }

  function parseDay(v) {
    const m = /\b([1-9]|[12]\d|3[01])(?:st|nd|rd|th)?\b/i.exec(String(v || ''));
    if (!m) return '';
    // A full date in the "day" column: use its day
    const d = parseDate(v);
    return d ? String(C.parseISO(d).getDate()) : m[1];
  }

  function matchCategory(v) {
    const s = String(v || '').toLowerCase().trim();
    if (!s) return '';
    const exact = C.CATEGORIES.find((c) => c.label.toLowerCase() === s || c.id === s);
    if (exact) return exact.id;
    const res = X.extract(s);
    return res.categoryRanking.length ? res.fields.category : '';
  }

  function matchOwner(v, people) {
    const s = String(v || '').toLowerCase().trim();
    if (!s || !people.length) return '';
    const p = people.find((x) => x.name.toLowerCase() === s) || people.find((x) => x.name.toLowerCase().split(' ')[0] === s.split(/[\s']/)[0]);
    return p ? p.id : '';
  }

  /* ---------- rows → items ---------- */

  // rows: array of arrays (first row = headers); map: target per column
  function buildItems(rows, map, people = [], existing = []) {
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      const v = {};
      map.forEach((t, i) => { if (t !== 'ignore' && row[i] != null && String(row[i]).trim() !== '') v[t] = row[i]; });
      const name = String(v.name || '').trim();
      if (!name || /^(sub)?total\b/i.test(name)) continue;

      const guess = X.extract(`${name}\n${v.provider || ''}`, {}, people);
      const category = matchCategory(v.category) || (guess.categoryRanking.length ? guess.fields.category : 'other');
      const monthly = parseMoney(v.monthlyAmount), annual = parseMoney(v.annualAmount), plain = parseMoney(v.cost);
      let frequency = parseFrequency(v.frequency);
      const paymentDay = v.paymentDay ? parseDay(v.paymentDay) : '';
      if (!frequency) frequency = monthly != null || paymentDay ? 'monthly' : annual != null ? 'annually' : plain != null ? 'monthly' : 'monthly';
      const perYear = (C.FREQUENCIES.find((f) => f.id === frequency) || {}).perYear || 0;
      let cost = plain;
      if (frequency === 'monthly') cost = monthly ?? (annual != null ? Math.round((annual / 12) * 100) / 100 : plain);
      else if (frequency === 'annually') cost = annual ?? (monthly != null ? Math.round(monthly * 12 * 100) / 100 : plain);
      else if (cost == null && perYear) cost = annual != null ? Math.round((annual / perYear) * 100) / 100 : monthly != null ? Math.round(((monthly * 12) / perYear) * 100) / 100 : null;

      const renewal = parseDate(v.endDate), end = parseDate(v.endDate2);
      const notes = [];
      if (renewal && end && renewal !== end) notes.push(`End date: ${C.formatDate(end)}`);
      if (v.notes) notes.push(String(v.notes));
      // When the sheet gives both amounts, keep the other one as a note so nothing is lost
      if (monthly != null && annual != null) notes.push(`From spreadsheet: ${C.formatMoney(monthly)} monthly / ${C.formatMoney(annual)} annually`);

      const extra = {};
      if (v.phoneNumber) extra.phoneNumber = String(v.phoneNumber);
      if (v.vehicleReg) extra.vehicleReg = String(v.vehicleReg).toUpperCase();
      Object.assign(extra, Object.fromEntries(Object.entries(guess.extra).filter(([k]) => ['vehicleReg', 'phoneNumber'].includes(k) && !extra[k])));

      const ownerId = matchOwner(v.owner, people) || (guess.confidence.ownerId ? guess.fields.ownerId : '') || '';
      const provider = String(v.provider || '').trim();
      const dup = existing.find((i) => i.name.toLowerCase() === name.toLowerCase() && (i.provider || '').toLowerCase() === provider.toLowerCase());

      out.push({
        row: r + 1,
        duplicateOf: dup ? dup.id : '',
        item: {
          name, category, ownerId, provider,
          reference: String(v.reference || '').trim(),
          frequency,
          cost: cost == null ? '' : cost,
          paymentDay,
          endDate: renewal || end,
          startDate: parseDate(v.startDate),
          notes: notes.join('\n'),
          extra,
        },
      });
    }
    return out;
  }

  g.PASheet = { parseDelimited, guessMapping, buildItems, parseMoney, parseFrequency, parseDate, parseDay, TARGETS };
})(globalThis);
