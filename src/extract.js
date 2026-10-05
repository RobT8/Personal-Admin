/* Personal Admin — turn the text of an email or document into suggested fields.
   Pure pattern-matching, no network: nothing about your documents leaves the device.
   Every guess carries a confidence so the review screen can show what to double-check. */
(function (g) {
  'use strict';

  const C = g.PACore;

  /* ---------- Known UK providers → likely category ---------- */
  const PROVIDERS = [
    // insurance
    ['Admiral', 'car_insurance'], ['Direct Line', 'car_insurance'], ['Churchill', 'car_insurance'], ['Hastings Direct', 'car_insurance'],
    ['Hastings', 'car_insurance'], ['esure', 'car_insurance'], ['Sheilas’ Wheels', 'car_insurance'], ["Sheilas' Wheels", 'car_insurance'],
    ['LV=', 'car_insurance'], ['Liverpool Victoria', 'car_insurance'], ['Aviva', 'other_insurance'], ['AXA', 'other_insurance'],
    ['Allianz', 'other_insurance'], ['Zurich', 'other_insurance'], ['Legal & General', 'life_insurance'], ['Royal London', 'life_insurance'],
    ['Vitality', 'life_insurance'], ['Bupa', 'life_insurance'], ['Saga', 'other_insurance'], ['Ageas', 'car_insurance'],
    ['1st Central', 'car_insurance'], ['Tesco Insurance', 'other_insurance'], ['More Than', 'home_insurance'], ['MORE TH>N', 'home_insurance'],
    ['Petplan', 'pet_insurance'], ['ManyPets', 'pet_insurance'], ['Animal Friends', 'pet_insurance'], ['Bought By Many', 'pet_insurance'],
    ['Staysure', 'travel_insurance'], ['Post Office Travel', 'travel_insurance'],
    ['Green Flag', 'breakdown'], ['RAC', 'breakdown'], ['The AA', 'breakdown'],
    // phone / tv / broadband
    ['EE', 'mobile'], ['O2', 'mobile'], ['Vodafone', 'mobile'], ['Three', 'mobile'], ['giffgaff', 'mobile'], ['Tesco Mobile', 'mobile'],
    ['Sky Mobile', 'mobile'], ['iD Mobile', 'mobile'], ['Lebara', 'mobile'], ['SMARTY', 'mobile'], ['VOXI', 'mobile'], ['Lyca', 'mobile'],
    ['Virgin Media', 'broadband'], ['BT', 'broadband'], ['TalkTalk', 'broadband'], ['Plusnet', 'broadband'], ['Hyperoptic', 'broadband'],
    ['Community Fibre', 'broadband'], ['Vodafone Broadband', 'broadband'], ['Sky', 'tv'], ['NOW', 'tv'], ['Netflix', 'tv'],
    ['Disney+', 'tv'], ['Amazon Prime', 'subscription'], ['Spotify', 'subscription'], ['Apple', 'subscription'], ['YouTube Premium', 'subscription'],
    // home
    ['TV Licensing', 'tv_licence'], ['British Gas', 'energy'], ['Octopus Energy', 'energy'], ['EDF', 'energy'], ['E.ON', 'energy'],
    ['OVO', 'energy'], ['Scottish Power', 'energy'], ['Utility Warehouse', 'energy'], ['Thames Water', 'water'], ['Severn Trent', 'water'],
    ['Anglian Water', 'water'], ['United Utilities', 'water'], ['Yorkshire Water', 'water'], ['Welsh Water', 'water'],
    // finance
    ['Barclaycard', 'credit_card'], ['American Express', 'credit_card'], ['Amex', 'credit_card'], ['MBNA', 'credit_card'],
    ['Capital One', 'credit_card'], ['Vanquis', 'credit_card'], ['Aqua', 'credit_card'], ['HSBC', 'credit_card'], ['Lloyds', 'credit_card'],
    ['Halifax', 'credit_card'], ['NatWest', 'credit_card'], ['Santander', 'credit_card'], ['Nationwide', 'mortgage'],
    ['Virgin Money', 'credit_card'], ['Tesco Bank', 'credit_card'], ['Sainsbury’s Bank', 'credit_card'], ['Monzo', 'credit_card'],
    ['Zopa', 'loan'], ['Black Horse', 'loan'], ['Close Brothers', 'loan'], ['Santander Consumer', 'loan'],
    // gyms
    ['PureGym', 'membership'], ['The Gym Group', 'membership'], ['David Lloyd', 'membership'], ['Nuffield Health', 'membership'],
    ['National Trust', 'membership'], ['English Heritage', 'membership'],
  ];

  /* ---------- Category keyword scores ---------- */
  const CATEGORY_HINTS = {
    car_insurance: [/car insurance/i, /motor (?:insurance|policy)/i, /no[\s-]claims/i, /\bvehicle\b/i, /comprehensive/i, /named drivers?/i, /third party/i],
    home_insurance: [/home insurance/i, /buildings (?:and|&) contents/i, /\bbuildings\b/i, /\bcontents (?:insurance|cover)/i],
    pet_insurance: [/pet insurance/i, /\b(?:dog|cat|vet|veterinary)\b/i, /lifetime cover/i],
    travel_insurance: [/travel insurance/i, /\btrip\b/i, /annual multi[\s-]trip/i, /\bEHIC|GHIC\b/],
    life_insurance: [/life (?:insurance|cover)/i, /critical illness/i, /health insurance/i, /income protection/i, /sum assured/i],
    breakdown: [/breakdown/i, /roadside/i, /recovery/i, /relay/i],
    mobile: [/\bmobile\b/i, /\bSIM\b/, /handset/i, /airtime/i, /\bdata allowance/i, /\b\d+\s?GB\b/i, /tariff/i, /upgrade/i, /\bunlimited (?:minutes|texts|data)/i],
    broadband: [/broadband/i, /\bfibre\b/i, /router/i, /\bMbps\b/i, /landline/i, /hub\b/i],
    tv: [/\bTV (?:package|bundle|subscription)/i, /channels/i, /streaming/i],
    tv_licence: [/TV Licen[cs]e/i, /TV Licensing/i],
    council_tax: [/council tax/i, /\bband [A-I]\b/, /billing authority/i, /\bcouncil\b/i],
    energy: [/\bkWh\b/i, /electricity/i, /\bgas\b/i, /energy/i, /standing charge/i, /\bMPAN\b/i],
    water: [/water (?:bill|rates|charges)/i, /sewerage/i],
    credit_card: [/credit card/i, /\bAPR\b/, /credit limit/i, /minimum payment/i, /balance transfer/i, /purchase rate/i, /card ending/i, /statement/i],
    loan: [/\bloan\b/i, /\bPCP\b/, /hire purchase/i, /finance agreement/i, /final payment/i, /balloon/i],
    mortgage: [/mortgage/i, /fixed rate (?:period|ends)/i, /\bLTV\b/i, /remortgage/i],
    savings: [/\bISA\b/, /savings/i, /\bAER\b/, /maturity/i],
    vehicle_tax: [/\bMOT\b/, /vehicle tax/i, /road tax/i, /\bV5C\b/i, /\bDVLA\b/i, /\bservice (?:is )?due/i],
    subscription: [/subscription/i, /\bplan\b/i, /\bmembership\b/i],
    membership: [/\bgym\b/i, /membership/i],
    warranty: [/warranty/i, /guarantee/i, /extended cover/i],
  };

  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
  const MONTH_RE = 'Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?';

  const DATE_PATTERNS = [
    // 12 March 2027, 12th Mar 27, 1st of June 2026
    { re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?[\\s\\-]+(${MONTH_RE})\\.?,?[\\s\\-]+(\\d{4}|\\d{2})\\b`, 'gi'), f: (m) => [m[1], m[2], m[3]] },
    // March 12, 2027
    { re: new RegExp(`\\b(${MONTH_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi'), f: (m) => [m[2], m[1], m[3]] },
    // 2027-03-12
    { re: /\b(\d{4})-(\d{2})-(\d{2})\b/g, f: (m) => [m[3], m[2], m[1]] },
    // 12/03/2027 — UK order
    { re: /\b(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4}|\d{2})\b/g, f: (m) => [m[1], m[2], m[3]] },
  ];

  // Ordered: later entries win when two labels are equally close to the date.
  const DATE_LABELS = [
    ['start', /(start(?:s|ed|ing)?(?: date| on)?|commenc\w*|effective(?: date| from)?|inception|begins?|joined|date of issue|issued(?: on)?|purchased?(?: on| date)?|\bfrom)\s*:?\s*$/i],
    ['renewal', /(renew\w*(?: date| on)?|expir\w*(?: date| on)?|end(?:s|ing)?(?: date| on)?|until|valid (?:to|until)|cover (?:ends|until)|contract (?:end|ends)\w*|minimum term ends|maturity(?: date)?|final payment(?: date)?|\bto|due (?:for renewal|on)|run out|ends? of (?:your )?(?:contract|plan|term))\s*:?\s*(?:on\s*)?$/i],
    ['promo', /(0\s?%[^\n]{0,60}(?:until|ends?)|promotional[^\n]{0,40}(?:until|ends?)|introductory[^\n]{0,40}(?:until|ends?)|fixed(?: rate)?[^\n]{0,30}(?:until|ends?(?: on)?)|offer (?:ends|period ends))\s*:?\s*(?:on\s*)?$/i],
    ['payment', /(payment due(?: date| on| by)?|due date|pay(?:ment)? by|minimum payment[^\n]{0,30}by|collected on|will be taken on|statement date)\s*:?\s*(?:on\s*)?$/i],
    ['birth', /(date of birth|d\.?o\.?b\.?|born(?: on)?)\s*:?\s*$/i],
  ];

  function normaliseYear(y) {
    const n = parseInt(y, 10);
    return y.length === 2 ? 2000 + n : n;
  }
  function monthNum(m) {
    if (/^\d+$/.test(m)) return parseInt(m, 10);
    return MONTHS[m.toLowerCase().slice(0, m.toLowerCase().startsWith('sept') ? 4 : 3)] || MONTHS[m.toLowerCase().slice(0, 3)];
  }
  function validISO(d, m, y) {
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1950 && y <= 2100)) return null;
    const dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1) return null;
    return C.toISO(dt);
  }

  function findDates(text) {
    const taken = [];
    const out = [];
    for (const p of DATE_PATTERNS) {
      p.re.lastIndex = 0;
      let m;
      while ((m = p.re.exec(text))) {
        const start = m.index, end = m.index + m[0].length;
        if (taken.some(([a, b]) => start < b && end > a)) continue;
        let [d, mo, y] = p.f(m);
        let day = parseInt(d, 10), month = monthNum(mo), year = normaliseYear(y);
        // 03/25/2027 can only be US order
        if (/^\d+$/.test(mo) && month > 12 && day <= 12) [day, month] = [month, day];
        const iso = validISO(day, month, year);
        if (!iso) continue;
        taken.push([start, end]);
        const before = text.slice(Math.max(0, start - 90), start);
        out.push({ iso, raw: m[0], index: start, label: labelFor(before), context: snippet(text, start, end) });
      }
    }
    return out.sort((a, b) => a.index - b.index);
  }

  function labelFor(before) {
    // Only the current line (or the tail of the previous one) is relevant.
    const tail = before.replace(/\s+/g, ' ').slice(-70);
    // A promo/fixed-rate phrase is more specific than the generic "until" it contains
    const promoRe = DATE_LABELS.find(([l]) => l === 'promo')[1];
    if (promoRe.test(tail)) return 'promo';
    let best = null, bestPos = -1;
    for (const [label, re] of DATE_LABELS) {
      if (re.test(tail)) {
        // Closer to the date = larger index of the keyword. Anchored at $, so all are adjacent;
        // prefer the most specific (shortest remaining distance) by checking order.
        const pos = tail.search(re);
        if (pos >= bestPos) { best = label; bestPos = pos; }
      }
    }
    if (best) return best;
    // Looser: keyword somewhere in the 70 chars before
    const loose = [
      ['promo', /\b0\s?%|promotional|introductory|fixed rate/i],
      ['birth', /date of birth|\bdob\b/i],
      ['payment', /payment due|due date|direct debit|minimum payment/i],
      ['renewal', /renew|expir|end date|ends|until|valid to|period of (?:insurance|cover)|contract end/i],
      ['start', /start|commenc|effective|inception/i],
    ];
    let pos = -1;
    for (const [label, re] of loose) {
      const m = [...tail.matchAll(new RegExp(re.source, 'gi'))].pop();
      if (m && m.index > pos) { pos = m.index; best = label; }
    }
    return best || 'other';
  }

  function snippet(text, start, end) {
    return text.slice(Math.max(0, start - 50), Math.min(text.length, end + 30)).replace(/\s+/g, ' ').trim();
  }

  /* ---------- Amounts ---------- */
  const AMOUNT_RE = /(?:£|GBP\s?)\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g;

  function findAmounts(text) {
    const out = [];
    AMOUNT_RE.lastIndex = 0;
    let m;
    while ((m = AMOUNT_RE.exec(text))) {
      const value = parseFloat(m[1].replace(/,/g, ''));
      const before = text.slice(Math.max(0, m.index - 70), m.index).replace(/\s+/g, ' ');
      const after = text.slice(m.index + m[0].length, m.index + m[0].length + 45).replace(/\s+/g, ' ');
      out.push({ value, raw: m[0], index: m.index, frequency: frequencyFor(before, after), kind: kindFor(before, after), context: snippet(text, m.index, m.index + m[0].length) });
    }
    return out;
  }

  function frequencyFor(before, after) {
    if (/^\s*(?:per|a|each|every|\/)\s*(?:calendar\s+)?(?:month|mth|mo)\b|^\s*(?:p\/?m|pcm|monthly)\b/i.test(after)) return 'monthly';
    if (/^\s*(?:per|a|each|every|\/)\s*(?:year|yr|annum)\b|^\s*(?:p\.?a\.?|annually|yearly)\b/i.test(after)) return 'annually';
    if (/^\s*(?:per|a|each|every|\/)\s*(?:week|wk)\b|^\s*weekly\b/i.test(after)) return 'weekly';
    if (/^\s*(?:per|a|each|every)\s*quarter\b|^\s*quarterly\b/i.test(after)) return 'quarterly';
    const b = before.slice(-60);
    if (/(10|ten) (?:monthly )?instal?ments?/i.test(b)) return 'ten_monthly';
    if (/(monthly|per month|each month|a month|instal?ments? of)[^£]{0,35}$/i.test(b)) return 'monthly';
    if (/(annual|yearly|per year|a year|total (?:annual )?(?:premium|cost|price|amount|payable)|premium|pay in full|one payment of)[^£]{0,35}$/i.test(b)) return 'annually';
    if (/(quarterly)[^£]{0,35}$/i.test(b)) return 'quarterly';
    if (/(weekly)[^£]{0,35}$/i.test(b)) return 'weekly';
    return '';
  }

  function kindFor(before, after) {
    const b = before.slice(-55);
    if (/(last year|previous(?:ly)?|current premium|this year you paid|you paid)[^£]{0,40}$/i.test(b)) return 'previous';
    if (/credit limit[^£]{0,30}$/i.test(b)) return 'creditLimit';
    if (/minimum (?:monthly )?payment[^£]{0,30}$/i.test(b)) return 'minPayment';
    if (/(statement |outstanding |current )?balance[^£]{0,30}$/i.test(b)) return 'balance';
    if (/excess[^£]{0,30}$/i.test(b)) return 'excess';
    if (/(sav(?:e|ing)|discount|cashback|reward|off|refund|credit of|fee for|cancellation|admin(?:istration)? fee|up to)[^£]{0,25}$/i.test(b)) return 'ignore';
    if (/(cover(?:ed)? (?:up to|of)|sum (?:insured|assured)|limit of)[^£]{0,25}$/i.test(b)) return 'cover';
    if (/(premium|cost|price|payment|instal?ment|charge|total|pay|bill|amount|fee|direct debit|plan)[^£]{0,40}$/i.test(b) || /^\s*(?:per|a|each|\/|p\/?m|pcm|monthly|annually|p\.?a\.?)/i.test(after)) return 'cost';
    return 'other';
  }

  function pickCost(amounts) {
    const scored = amounts
      .filter((a) => a.kind === 'cost' || a.kind === 'other')
      .map((a) => ({ a, s: (a.kind === 'cost' ? 3 : 0) + (a.frequency ? 2 : 0) + (a.value > 0 ? 1 : -5) }));
    if (!scored.length) return null;
    scored.sort((x, y) => y.s - x.s || x.a.index - y.a.index);
    const best = scored[0];
    return { ...best.a, confidence: best.s >= 5 ? 'high' : best.s >= 3 ? 'medium' : 'low' };
  }

  /* ---------- Small helpers ---------- */
  function first(text, re, group = 1) {
    const m = re.exec(text);
    return m ? { value: m[group].trim(), raw: m[0] } : null;
  }
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  function findProvider(text, fromLine) {
    const hits = [];
    for (const [name, cat] of PROVIDERS) {
      // short all-caps brands (EE, O2, BT, RAC, NOW) must match case exactly
      const exact = name.length <= 4 && name === name.toUpperCase();
      const re = new RegExp(`(?:^|[^A-Za-z0-9])${escapeRe(name)}(?![A-Za-z0-9])`, exact ? 'g' : 'gi');
      const count = (text.match(re) || []).length;
      const inFrom = fromLine && re.test(fromLine);
      if (count || inFrom) hits.push({ name, cat, score: count + (inFrom ? 10 : 0) + (exact ? 0 : 0.5) + name.length / 100 });
    }
    hits.sort((a, b) => b.score - a.score);
    if (hits.length) return hits[0];
    // Fall back to the sender's display name or domain
    if (fromLine) {
      const disp = /^\s*"?([^"<@]+?)"?\s*</.exec(fromLine);
      if (disp && !/no-?reply|customer|service|team|info|hello/i.test(disp[1])) return { name: disp[1].trim(), cat: null, score: 0.5 };
      const dom = /@(?:[a-z0-9-]+\.)*?([a-z0-9-]+)\.(?:co\.uk|com|org\.uk|org|net|uk|gov\.uk)\b/i.exec(fromLine);
      if (dom && !/gmail|outlook|hotmail|yahoo|icloud|live|mail/i.test(dom[1])) {
        return { name: dom[1].charAt(0).toUpperCase() + dom[1].slice(1), cat: null, score: 0.3 };
      }
    }
    return null;
  }

  function scoreCategories(text, subject, providerCat) {
    const scores = {};
    for (const [cat, res] of Object.entries(CATEGORY_HINTS)) {
      let s = 0;
      for (const re of res) {
        const flags = re.flags.includes('g') ? re.flags : re.flags + 'g';
        const n = (text.match(new RegExp(re.source, flags)) || []).length;
        s += Math.min(n, 4);
        if (subject && re.test(subject)) s += 3;
      }
      if (s) scores[cat] = s;
    }
    if (providerCat) scores[providerCat] = (scores[providerCat] || 0) + 3;
    // Strong, unambiguous phrases trump everything else
    if (/TV Licen[cs]/i.test(text)) scores.tv_licence = (scores.tv_licence || 0) + 20;
    if (/council tax/i.test(text)) scores.council_tax = (scores.council_tax || 0) + 15;
    if (/car insurance|motor insurance/i.test(text)) scores.car_insurance = (scores.car_insurance || 0) + 8;
    if (/home insurance|buildings and contents/i.test(text)) scores.home_insurance = (scores.home_insurance || 0) + 8;
    if (/pet insurance/i.test(text)) scores.pet_insurance = (scores.pet_insurance || 0) + 8;
    if (/credit card/i.test(text)) scores.credit_card = (scores.credit_card || 0) + 6;
    const ranked = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    return ranked;
  }

  /* ---------- Main ---------- */

  // meta: { subject, from, date (ISO), filename }; people: [{id, name, phone}]
  // An email's own body is what the user dropped it for; attached documents only fill gaps.
  function extract(rawText, meta = {}, people = []) {
    const text = String(rawText || '');
    const cut = text.indexOf('\n--- Attachment:');
    if (cut < 0 || !text.slice(0, cut).trim()) return extractOne(text, meta, people);
    const body = extractOne(text.slice(0, cut), meta, people);
    const att = extractOne(text.slice(cut), { ...meta, subject: '' }, people);
    const sameKind = att.fields.category === body.fields.category || body.confidence.category === 'low';
    const fill = (k, isExtra) => {
      const src = isExtra ? att.extra : att.fields, dst = isExtra ? body.extra : body.fields;
      if (dst[k] === undefined && (sameKind || ['contactPhone', 'reference', 'noticeDays', 'autoRenew'].includes(k))) {
        dst[k] = src[k];
        body.confidence[isExtra ? `extra.${k}` : k] = att.confidence[isExtra ? `extra.${k}` : k] === 'high' ? 'medium' : 'low';
      }
    };
    Object.keys(att.fields).filter((k) => !['name', 'category', 'provider'].includes(k)).forEach((k) => fill(k, false));
    if (sameKind) Object.keys(att.extra).forEach((k) => fill(k, true));
    body.found = [...new Set([...body.found, ...att.found])];
    body.dates = [...body.dates, ...att.dates.map((d) => ({ ...d, index: d.index + cut }))];
    body.amounts = [...body.amounts, ...att.amounts];
    return body;
  }

  function extractOne(rawText, meta = {}, people = []) {
    const text = String(rawText || '').replace(/ /g, ' ').replace(/\r/g, '');
    const subject = meta.subject || '';
    const all = subject ? `${subject}\n${text}` : text;
    const fields = {};
    const extra = {};
    const confidence = {};
    const found = []; // raw strings to highlight in the preview
    const set = (k, v, conf, raw, isExtra) => {
      if (v === '' || v == null) return;
      (isExtra ? extra : fields)[k] = v;
      confidence[isExtra ? `extra.${k}` : k] = conf;
      if (raw) found.push(raw);
    };

    // Provider + category
    const provider = findProvider(all, meta.from);
    if (provider) set('provider', provider.name, provider.score >= 2 ? 'high' : 'medium');
    const council = /\b((?:[A-Z][a-z]+[ \-]){1,3}(?:Borough |City |District |County |Metropolitan )?Council)\b/.exec(all);
    if (council && !fields.provider) set('provider', council[1].trim(), 'medium');
    const ranked = scoreCategories(all, subject, provider && provider.cat);
    const cat = ranked.length ? ranked[0][0] : 'other';
    const catConf = !ranked.length ? 'low' : ranked[0][1] >= 8 && (!ranked[1] || ranked[0][1] >= ranked[1][1] * 1.5) ? 'high' : 'medium';
    set('category', cat, catConf);

    // Dates
    const dates = findDates(all);
    const docDate = meta.date || '';
    const byLabel = (l) => dates.filter((d) => d.label === l);
    const renewals = byLabel('renewal');
    const now = C.today();
    let renewal = null;
    if (renewals.length) {
      const future = renewals.filter((d) => d.iso >= (docDate || now).slice(0, 10) || d.iso >= C.addDays(now, -400));
      const pool = future.length ? future : renewals;
      // The date mentioned most often wins; ties go to the latest.
      const counts = {};
      pool.forEach((d) => (counts[d.iso] = (counts[d.iso] || 0) + 1));
      renewal = pool.slice().sort((a, b) => counts[b.iso] - counts[a.iso] || b.iso.localeCompare(a.iso))[0];
      set('endDate', renewal.iso, 'high', renewal.raw);
    } else {
      const candidates = dates.filter((d) => d.label === 'other' && d.iso > now);
      if (candidates.length) {
        const latest = candidates.slice().sort((a, b) => b.iso.localeCompare(a.iso))[0];
        set('endDate', latest.iso, 'low', latest.raw);
      }
    }
    const start = byLabel('start')[0];
    if (start) set('startDate', start.iso, 'high', start.raw);
    else {
      // "1 March 2026 to 28 February 2027": a date just before a renewal-labelled date
      for (const r of renewals) {
        const prev = dates.filter((d) => d.index < r.index && r.index - d.index < 40).pop();
        if (prev && prev.iso < r.iso) { set('startDate', prev.iso, 'medium', prev.raw); break; }
      }
    }
    if (cat === 'council_tax' && !fields.endDate) {
      const yr = /\b(20\d{2})\s*[/\-]\s*(\d{2}|20\d{2})\b/.exec(all);
      if (yr) set('endDate', `${parseInt(yr[1], 10) + 1}-03-31`, 'medium', yr[0]);
    }
    const promo = byLabel('promo')[0];
    if (promo) set('promoEndDate', promo.iso, 'high', promo.raw, true);
    const pay = byLabel('payment')[0];
    if (pay) set('paymentDay', String(C.parseISO(pay.iso).getDate()), 'medium', pay.raw);
    const dd = first(all, /(?:on|by) (?:or around )?the (\d{1,2})(?:st|nd|rd|th)? (?:day )?of (?:each|every) month/i);
    if (dd) set('paymentDay', dd.value, 'high', dd.raw);

    // Money
    const amounts = findAmounts(all);
    const cost = pickCost(amounts);
    if (cost) {
      set('cost', cost.value, cost.confidence, cost.raw);
      if (cost.frequency) set('frequency', cost.frequency, cost.confidence);
      else set('frequency', /insurance|tv_licence|breakdown/.test(cat) ? 'annually' : 'monthly', 'low');
    }
    const prevAmt = amounts.find((a) => a.kind === 'previous');
    if (prevAmt) set('previousCost', prevAmt.value, 'medium', prevAmt.raw);
    const takeAmt = (kind, key) => {
      const a = amounts.find((x) => x.kind === kind);
      if (a) set(key, a.value, 'medium', a.raw, true);
    };
    takeAmt('creditLimit', 'creditLimit');
    takeAmt('balance', 'balance');
    takeAmt('minPayment', 'minPayment');
    takeAmt('excess', 'excess');

    // Interest rates
    const apr =
      first(all, /(\d{1,2}(?:\.\d{1,2})?)\s?%\s*(?:\(?\s*variable\s*\)?\s*)?(?:representative\s+)?(?:APR|AER|p\.a\.|purchase rate|interest rate)/i) ||
      first(all, /(?:APR|AER|purchase rate|interest rate|standard rate)[^%\d\n]{0,30}(\d{1,2}(?:\.\d{1,2})?)\s?%/i);
    if (apr && parseFloat(apr.value) > 0) set('apr', apr.value, 'high', apr.raw, true);
    const promoM = first(all, /\b(0(?:\.\d+)?)\s?%\s*(?:interest\s*)?(?:on\s+)?(?:balance transfers?|purchases|money transfers?)?[^.\n]{0,40}?\bfor\s+(\d{1,2})\s+months/i);
    if (promoM) {
      const months = parseInt(/(\d{1,2})\s+months/i.exec(promoM.raw)[1], 10);
      set('promoRate', promoM.value, 'high', promoM.raw, true);
      if (!extra.promoEndDate) {
        const base = fields.startDate || docDate || '';
        if (base) set('promoEndDate', C.addMonths(base.slice(0, 10), months), 'medium', null, true);
      }
    }

    // Reference numbers — prefer the most specific kind
    const REF_KINDS = ['policy', 'agreement', 'contract', 'licence', 'license', 'account', 'membership', 'customer', 'reference', 'ref', 'certificate', 'plan', 'order'];
    const refRe = /\b(policy|agreement|contract|licen[cs]e|account|membership|customer|reference|ref|certificate|plan|order)(?:\s+(?:number|no\.?|num|#|id|ref(?:erence)?))?(?:\s+is)?\s*[:#\-]?\s*([A-Z0-9][A-Z0-9\-/]{3,}(?:[ ][0-9]{3,}){0,3})\b/gi;
    let best = null, m;
    while ((m = refRe.exec(all))) {
      const v = m[2].trim();
      if (!/\d/.test(v) || /^\d{1,2}$/.test(v) || /^(19|20)\d{2}$/.test(v)) continue;
      const rank = REF_KINDS.indexOf(m[1].toLowerCase().replace('license', 'licence'));
      if (!best || rank < best.rank) best = { v, raw: m[0], rank };
    }
    if (best) set('reference', best.v, best.rank <= 5 ? 'high' : 'medium', best.raw);

    // Phones, regs, misc
    const mobileNum = first(all, /(?:^|[^\d])((?:\+44\s?7|07)\d{3}\s?\d{3}\s?\d{3})(?!\d)/);
    if (mobileNum && (cat === 'mobile' || cat === 'broadband')) set('phoneNumber', mobileNum.value.replace(/\s+/g, ' '), 'medium', mobileNum.value, true);
    const contact = first(all, /(?:call|phone|telephone|tel|contact us(?: on)?)\.?:?\s*(?:us\s+)?(?:on\s+)?(0(?:800|808|3\d\d|1\d{2,3}|2\d)\s?\d{3,4}\s?\d{3,4})/i) || first(all, /\b(0(?:800|808|3[0-9]{2})\s?\d{3}\s?\d{4})\b/);
    if (contact) set('contactPhone', contact.value, 'medium', contact.value);
    const reg = first(all, /\b([A-Z]{2}\d{2}\s?[A-Z]{3})\b/);
    if (reg && !/^(?:GB|UK)\d{2}/.test(reg.value) && ['car_insurance', 'breakdown', 'vehicle_tax', 'loan'].includes(cat)) set('vehicleReg', reg.value.replace(/^(.{4})(?=\S)/, '$1 '), 'high', reg.value, true);
    const card4 = first(all, /(?:card )?(?:ending(?: in)?|last (?:four|4) digits|\*{4}|x{4})\s*:?\s*(\d{4})\b/i);
    if (card4 && cat === 'credit_card') set('cardLast4', card4.value, 'high', card4.raw, true);
    const band = first(all, /\bband\s*:?\s*([A-I])\b/);
    if (band && cat === 'council_tax') set('band', band.value, 'high', band.raw, true);
    const ncd = first(all, /(\d{1,2})\s*years?['’]?\s*(?:of\s+)?(?:no[\s-]claims|NCD|NCB)/i) || first(all, /no[\s-]claims (?:discount|bonus)[^\d\n]{0,25}(\d{1,2})\s*years?/i);
    if (ncd && cat === 'car_insurance') set('noClaimsYears', ncd.value, 'high', ncd.raw, true);
    const cover = first(all, /\b(comprehensive|third[\s-]party,? fire (?:and|&) theft|third[\s-]party only)\b/i);
    if (cover && /insurance/.test(cat)) set('coverLevel', cover.value.charAt(0).toUpperCase() + cover.value.slice(1), 'medium', cover.raw, true);
    const handset = first(all, /\b((?:Apple )?iPhone\s?\d{1,2}(?:\s?(?:Pro Max|Pro|Plus|mini|e))?|Samsung Galaxy\s?[A-Z]?\d{1,2}\w*(?:\s?(?:Ultra|\+|FE))?|Google Pixel\s?\d{1,2}\w*(?:\s?Pro)?)\b/i);
    if (handset && cat === 'mobile') set('handset', handset.value, 'medium', handset.raw, true);
    const allowance = first(all, /\b(unlimited data|\d{1,4}\s?GB(?: of)?(?: data)?)\b/i);
    if (allowance && cat === 'mobile') set('allowance', allowance.value, 'medium', allowance.raw, true);
    const speed = first(all, /\b(\d{2,4}\s?Mbps)\b/i);
    if (speed && cat === 'broadband') set('speed', speed.value, 'medium', speed.raw, true);

    // Behaviour
    if (/(will not|won['’]?t) (?:be )?(?:automatically )?renew|not (?:be )?renewed automatically|auto[\s-]?renewal (?:is )?(?:off|switched off)/i.test(all)) set('autoRenew', 'no', 'medium');
    else if (/(will|we['’]ll) (?:automatically )?renew|auto(?:matic(?:ally)?)?[\s-]?renew/i.test(all)) set('autoRenew', 'yes', 'medium');
    const notice = first(all, /(\d{1,3})\s*days['’]?\s*(?:written\s+)?notice/i);
    if (notice) set('noticeDays', notice.value, 'medium', notice.raw);
    if (/direct debit/i.test(all)) set('paymentMethod', 'Direct debit', 'medium');
    else if (/continuous payment authority|recurring card payment/i.test(all)) set('paymentMethod', 'Card (recurring)', 'medium');

    // Website: prefer the sender's domain
    const site = first(meta.from || '', /@(?:[a-z0-9-]+\.)*?((?:[a-z0-9-]+)\.(?:co\.uk|com|org\.uk|org|net|uk|gov\.uk))\b/i) || first(all, /\b(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+(?:co\.uk|com|org\.uk|gov\.uk|net|uk))\b/i);
    if (site && !/gmail|outlook|hotmail|yahoo|icloud|w3\.org|googlemail/i.test(site.value)) set('website', site.value.toLowerCase(), 'low');

    // Who it belongs to
    const holderRe = /(?:policy ?holder|account ?holder|card ?holder|licence holder|name of insured|insured person|main driver|customer name|name)\s*:?\s*(?:(?:Mr|Mrs|Ms|Miss|Dr|Mx)\.?\s+)?([A-Z][a-z]+(?:[ ][A-Z][A-Za-z'\-]+){0,2})/;
    const dearRe = /\b(?:Dear|Hi|Hello)\s+(?:(?:Mr|Mrs|Ms|Miss|Dr|Mx)\.?\s+)?([A-Z][a-z]+(?:[ ][A-Z][A-Za-z'\-]+)?)/;
    const holder = first(all, holderRe) || first(all, dearRe);
    if (holder) set('holderName', holder.value, 'medium', holder.raw);
    const owner = matchPerson(people, holder && holder.value, extra.phoneNumber, all);
    if (owner) set('ownerId', owner.person.id, owner.conf);

    // Name suggestion
    const catLabel = C.category(cat).label;
    const ownerName = owner && owner.person.name.split(' ')[0];
    let name = [fields.provider, catLabel].filter(Boolean).join(' – ');
    if (cat === 'mobile' && ownerName) name = `${ownerName}'s mobile${fields.provider ? ` (${fields.provider})` : ''}`;
    if (extra.vehicleReg) name += ` (${extra.vehicleReg})`;
    if (cat === 'tv_licence') name = 'TV Licence';
    if (cat === 'council_tax') name = fields.provider && /council/i.test(fields.provider) ? `Council tax – ${fields.provider}` : 'Council tax';
    set('name', name || subject.slice(0, 60) || 'New item', 'medium');

    return { fields, extra, confidence, found: [...new Set(found)].filter((s) => s && s.length >= 3), dates, amounts, categoryRanking: ranked.slice(0, 4) };
  }

  function matchPerson(people, holder, phone, text) {
    if (!people || !people.length) return null;
    const digits = (s) => String(s || '').replace(/\D/g, '').replace(/^44/, '0');
    if (phone) {
      const p = people.find((x) => x.phone && digits(x.phone) === digits(phone));
      if (p) return { person: p, conf: 'high' };
    }
    if (holder) {
      const h = holder.toLowerCase();
      const full = people.find((x) => x.name && h.includes(x.name.toLowerCase()));
      if (full) return { person: full, conf: 'high' };
      const firstName = people.find((x) => x.name && h.split(' ')[0] === x.name.toLowerCase().split(' ')[0]);
      if (firstName) return { person: firstName, conf: 'medium' };
    }
    // A household member's first name mentioned anywhere (only if exactly one)
    const mentioned = people.filter((x) => x.name && new RegExp(`\\b${escapeRe(x.name.split(' ')[0])}\\b`).test(text));
    if (mentioned.length === 1) return { person: mentioned[0], conf: 'low' };
    return null;
  }

  g.PAExtract = { extract, findDates, findAmounts, PROVIDERS };
})(globalThis);
