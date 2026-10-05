/* Personal Admin — core data model and pure helpers.
   No DOM and no storage here, so it runs in Node for tests as well as in the browser. */
(function (g) {
  'use strict';

  const GROUPS = [
    { id: 'insurance', label: 'Insurance', color: '#2F6FB3' },
    { id: 'phone', label: 'Phone, TV & internet', color: '#7A4FB8' },
    { id: 'home', label: 'Home & utilities', color: '#2E8A6B' },
    { id: 'finance', label: 'Credit & finance', color: '#C0573A' },
    { id: 'vehicle', label: 'Vehicles', color: '#B8860B' },
    { id: 'subs', label: 'Subscriptions & other', color: '#5F6B7A' },
  ];

  // `endLabel` is what the key date means for that kind of thing.
  const CATEGORIES = [
    { id: 'car_insurance', label: 'Car insurance', group: 'insurance', icon: '🚗', endLabel: 'Renewal date', extra: ['vehicleReg', 'makeModel', 'coverLevel', 'excess', 'noClaimsYears', 'namedDrivers'] },
    { id: 'home_insurance', label: 'Home insurance', group: 'insurance', icon: '🏠', endLabel: 'Renewal date', extra: ['coverLevel', 'excess', 'buildingsCover', 'contentsCover'] },
    { id: 'pet_insurance', label: 'Pet insurance', group: 'insurance', icon: '🐾', endLabel: 'Renewal date', extra: ['petName', 'coverLevel', 'excess'] },
    { id: 'travel_insurance', label: 'Travel insurance', group: 'insurance', icon: '✈️', endLabel: 'Renewal date', extra: ['coverLevel', 'excess', 'insuredPeople'] },
    { id: 'life_insurance', label: 'Life / health insurance', group: 'insurance', icon: '❤️', endLabel: 'Renewal / review date', extra: ['coverLevel', 'sumAssured', 'insuredPeople'] },
    { id: 'breakdown', label: 'Breakdown cover', group: 'insurance', icon: '🛠️', endLabel: 'Renewal date', extra: ['vehicleReg', 'coverLevel'] },
    { id: 'other_insurance', label: 'Other insurance', group: 'insurance', icon: '🛡️', endLabel: 'Renewal date', extra: ['coverLevel', 'excess'] },
    { id: 'mobile', label: 'Mobile phone', group: 'phone', icon: '📱', endLabel: 'Contract end date', extra: ['phoneNumber', 'handset', 'allowance'] },
    { id: 'broadband', label: 'Broadband / landline', group: 'phone', icon: '🌐', endLabel: 'Contract end date', extra: ['speed', 'phoneNumber'] },
    { id: 'tv', label: 'TV package / streaming', group: 'phone', icon: '📺', endLabel: 'Contract end date', extra: ['package'] },
    { id: 'tv_licence', label: 'TV Licence', group: 'home', icon: '📡', endLabel: 'Licence expiry', extra: ['propertyAddress'] },
    { id: 'council_tax', label: 'Council tax', group: 'home', icon: '🏛️', endLabel: 'Year end / review', extra: ['band', 'propertyAddress'] },
    { id: 'energy', label: 'Gas & electricity', group: 'home', icon: '⚡', endLabel: 'Tariff end date', extra: ['tariffName', 'meterNumber'] },
    { id: 'water', label: 'Water', group: 'home', icon: '💧', endLabel: 'Review date', extra: [] },
    { id: 'credit_card', label: 'Credit card', group: 'finance', icon: '💳', endLabel: 'Card expiry / review', extra: ['cardLast4', 'apr', 'promoRate', 'promoEndDate', 'creditLimit', 'balance', 'minPayment'] },
    { id: 'loan', label: 'Loan / car finance', group: 'finance', icon: '🏦', endLabel: 'Final payment date', extra: ['apr', 'balance', 'vehicleReg'] },
    { id: 'mortgage', label: 'Mortgage', group: 'finance', icon: '🔑', endLabel: 'Term end date', extra: ['apr', 'promoEndDate', 'balance', 'propertyAddress'] },
    { id: 'savings', label: 'Savings / ISA', group: 'finance', icon: '💰', endLabel: 'Maturity date', extra: ['apr', 'promoEndDate', 'balance'] },
    { id: 'vehicle_tax', label: 'Vehicle tax / MOT / service', group: 'vehicle', icon: '🔧', endLabel: 'Due date', extra: ['vehicleReg', 'makeModel'] },
    { id: 'subscription', label: 'Subscription', group: 'subs', icon: '🔁', endLabel: 'Renewal date', extra: [] },
    { id: 'membership', label: 'Membership / gym', group: 'subs', icon: '🏋️', endLabel: 'Renewal date', extra: [] },
    { id: 'warranty', label: 'Warranty', group: 'subs', icon: '🧾', endLabel: 'Warranty ends', extra: ['product', 'serialNumber'] },
    { id: 'other', label: 'Other', group: 'subs', icon: '📄', endLabel: 'Renewal / end date', extra: [] },
  ];

  // Category-specific fields. Types: text (default), number, money, date.
  const FIELDS = {
    vehicleReg: { label: 'Vehicle registration', placeholder: 'AB12 CDE' },
    makeModel: { label: 'Make & model' },
    coverLevel: { label: 'Cover level', placeholder: 'e.g. Comprehensive' },
    excess: { label: 'Excess', type: 'money' },
    noClaimsYears: { label: 'No-claims years', type: 'number' },
    namedDrivers: { label: 'Named drivers' },
    buildingsCover: { label: 'Buildings cover', type: 'money' },
    contentsCover: { label: 'Contents cover', type: 'money' },
    petName: { label: 'Pet name' },
    insuredPeople: { label: 'People covered' },
    sumAssured: { label: 'Sum assured', type: 'money' },
    phoneNumber: { label: 'Phone number', placeholder: '07…' },
    handset: { label: 'Handset' },
    allowance: { label: 'Allowance', placeholder: 'e.g. 100GB, unlimited mins' },
    speed: { label: 'Speed', placeholder: 'e.g. 500Mbps' },
    package: { label: 'Package' },
    propertyAddress: { label: 'Property' },
    band: { label: 'Band' },
    tariffName: { label: 'Tariff' },
    meterNumber: { label: 'Meter / MPAN' },
    cardLast4: { label: 'Card ending', placeholder: '1234' },
    apr: { label: 'Interest rate / APR (%)', type: 'number' },
    promoRate: { label: 'Promo rate (%)', type: 'number' },
    promoEndDate: { label: 'Promo / fixed rate ends', type: 'date' },
    creditLimit: { label: 'Credit limit', type: 'money' },
    balance: { label: 'Balance', type: 'money' },
    minPayment: { label: 'Minimum payment', type: 'money' },
    product: { label: 'Product' },
    serialNumber: { label: 'Serial number' },
  };

  const FREQUENCIES = [
    { id: 'monthly', label: 'Monthly', perYear: 12 },
    { id: 'annually', label: 'Annually', perYear: 1 },
    { id: 'quarterly', label: 'Quarterly', perYear: 4 },
    { id: 'weekly', label: 'Weekly', perYear: 52 },
    { id: 'ten_monthly', label: '10 monthly instalments', perYear: 10 },
    { id: 'one_off', label: 'One-off', perYear: 0 },
  ];

  const PAYMENT_METHODS = ['Direct debit', 'Card (recurring)', 'Standing order', 'Manual', 'Paid in full'];

  const catById = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
  const groupById = Object.fromEntries(GROUPS.map((x) => [x.id, x]));
  const category = (id) => catById[id] || catById.other;
  const group = (id) => groupById[id] || groupById.subs;

  /* ---------- Dates: always 'YYYY-MM-DD' strings in local time ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  function toISO(d) {
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function parseISO(s) {
    if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
    const [y, m, d] = s.split('-').map(Number);
    return new Date(y, m - 1, d);
  }
  function today() {
    return toISO(new Date());
  }
  function addDays(iso, n) {
    const d = parseISO(iso);
    d.setDate(d.getDate() + n);
    return toISO(d);
  }
  function addMonths(iso, n) {
    const d = parseISO(iso);
    const day = d.getDate();
    d.setDate(1);
    d.setMonth(d.getMonth() + n);
    const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
    d.setDate(Math.min(day, last));
    return toISO(d);
  }
  function daysBetween(fromIso, toIso) {
    return Math.round((parseISO(toIso) - parseISO(fromIso)) / 86400000);
  }
  const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function formatDate(iso) {
    const d = parseISO(iso);
    if (!d) return '';
    return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]} ${d.getFullYear()}`;
  }
  function relative(iso, from) {
    const n = daysBetween(from || today(), iso);
    if (n === 0) return 'today';
    if (n === 1) return 'tomorrow';
    if (n === -1) return 'yesterday';
    if (n > 0) return n < 60 ? `in ${n} days` : `in ${Math.round(n / 30.4)} months`;
    return -n < 60 ? `${-n} days ago` : `${Math.round(-n / 30.4)} months ago`;
  }

  /* ---------- Money ---------- */

  function annualCost(item) {
    const f = FREQUENCIES.find((x) => x.id === item.frequency);
    const cost = Number(item.cost) || 0;
    return f ? cost * f.perYear : 0;
  }
  function monthlyCost(item) {
    return annualCost(item) / 12;
  }
  function formatMoney(n, symbol) {
    if (n === '' || n == null || isNaN(Number(n))) return '';
    const v = Number(n);
    return (symbol ?? '£') + v.toLocaleString('en-GB', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });
  }

  /* ---------- Items ---------- */

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newItem(partial) {
    return {
      id: uid(),
      name: '',
      category: 'other',
      ownerId: '',
      provider: '',
      reference: '',
      startDate: '',
      endDate: '',
      autoRenew: '',
      noticeDays: '',
      cost: '',
      frequency: 'monthly',
      previousCost: '',
      paymentMethod: '',
      paymentDay: '',
      contactPhone: '',
      website: '',
      notes: '',
      extra: {},
      reminderOffsets: null, // null = use default from settings
      reminders: [], // custom: {id, date, note}
      dismissed: [], // reminder keys the user has ticked off
      history: [], // {date, text}
      fileIds: [],
      status: 'active',
      created: today(),
      updated: today(),
      ...partial,
    };
  }

  function parseOffsets(text) {
    return String(text || '')
      .split(/[\s,]+/)
      .map((s) => parseInt(s, 10))
      .filter((n) => Number.isFinite(n) && n >= 0 && n <= 730)
      .sort((a, b) => b - a);
  }

  /* Every reminder an item generates. Keys include the date they hang off, so
     after a renewal the new year's reminders start un-dismissed automatically. */
  function itemReminders(item, settings) {
    if (item.status !== 'active') return [];
    const out = [];
    const cat = category(item.category);
    const offsets = item.reminderOffsets || settings?.defaultOffsets || [30, 7];
    if (item.endDate) {
      for (const d of offsets) {
        out.push({
          key: `end-${d}-${item.endDate}`,
          date: addDays(item.endDate, -d),
          kind: 'renewal',
          title: d === 0 ? `${cat.endLabel} is today` : `${cat.endLabel} in ${d} day${d === 1 ? '' : 's'}`,
          due: item.endDate,
        });
      }
      const notice = parseInt(item.noticeDays, 10);
      if (notice > 0) {
        out.push({
          key: `notice-${item.endDate}`,
          date: addDays(item.endDate, -notice),
          kind: 'notice',
          title: `Last day to give ${notice} days' notice`,
          due: item.endDate,
        });
      }
    }
    const promo = item.extra && item.extra.promoEndDate;
    if (promo) {
      for (const d of [60, 14]) {
        out.push({ key: `promo-${d}-${promo}`, date: addDays(promo, -d), kind: 'promo', title: `Promo / fixed rate ends in ${d} days`, due: promo });
      }
    }
    for (const r of item.reminders || []) {
      if (r.date) out.push({ key: `custom-${r.id}`, date: r.date, kind: 'custom', title: r.note || 'Reminder', due: r.date });
    }
    const dismissed = new Set(item.dismissed || []);
    return out.map((r) => ({ ...r, itemId: item.id, done: dismissed.has(r.key) }));
  }

  function allReminders(items, settings) {
    return items.flatMap((i) => itemReminders(i, settings)).sort((a, b) => a.date.localeCompare(b.date));
  }

  /* Suggested next end date when the user marks something as renewed. */
  function nextTermEnd(item) {
    const base = item.endDate || today();
    if (item.category === 'mobile' || item.category === 'broadband') return addMonths(base, 12);
    if (item.frequency === 'monthly' && !item.endDate) return addMonths(base, 1);
    return addMonths(base, 12);
  }

  /* ---------- iCalendar export ---------- */

  function icsEscape(s) {
    return String(s).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  }
  function icsFold(line) {
    const out = [];
    while (line.length > 74) {
      out.push(line.slice(0, 74));
      line = ' ' + line.slice(74);
    }
    out.push(line);
    return out.join('\r\n');
  }
  // events: [{uid, date, summary, description}]
  function buildICS(events) {
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Personal Admin//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH'];
    for (const e of events) {
      const d = e.date.replace(/-/g, '');
      const next = addDays(e.date, 1).replace(/-/g, '');
      lines.push(
        'BEGIN:VEVENT',
        `UID:${e.uid}@personal-admin.local`,
        `DTSTAMP:${stamp}`,
        `DTSTART;VALUE=DATE:${d}`,
        `DTEND;VALUE=DATE:${next}`,
        icsFold(`SUMMARY:${icsEscape(e.summary)}`),
        icsFold(`DESCRIPTION:${icsEscape(e.description || '')}`),
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        icsFold(`DESCRIPTION:${icsEscape(e.summary)}`),
        'TRIGGER:PT9H',
        'END:VALARM',
        'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    return lines.join('\r\n') + '\r\n';
  }

  function reminderEvents(items, settings, people) {
    const nameOf = (id) => (people || []).find((p) => p.id === id)?.name;
    const byId = Object.fromEntries(items.map((i) => [i.id, i]));
    return allReminders(items, settings)
      .filter((r) => !r.done && r.date >= today())
      .map((r) => {
        const it = byId[r.itemId];
        const who = nameOf(it.ownerId);
        return {
          uid: `${r.itemId}-${r.key}`,
          date: r.date,
          summary: `${it.name}: ${r.title}`,
          description: [
            it.provider && `Provider: ${it.provider}`,
            who && `For: ${who}`,
            it.reference && `Ref: ${it.reference}`,
            it.contactPhone && `Phone: ${it.contactPhone}`,
            r.due && `Key date: ${formatDate(r.due)}`,
          ]
            .filter(Boolean)
            .join('\n'),
        };
      });
  }

  g.PACore = {
    GROUPS, CATEGORIES, FIELDS, FREQUENCIES, PAYMENT_METHODS,
    category, group, toISO, parseISO, today, addDays, addMonths, daysBetween, formatDate, relative,
    annualCost, monthlyCost, formatMoney, uid, newItem, parseOffsets, itemReminders, allReminders,
    nextTermEnd, buildICS, reminderEvents,
  };
})(globalThis);
