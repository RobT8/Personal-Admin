/* Personal Admin — UI. Plain JS, no framework: renders HTML strings into #view and
   handles clicks through data-act attributes. */
(function () {
  'use strict';

  const C = window.PACore, X = window.PAExtract, P = window.PAParsers, DB = window.PADB;

  if (window.pdfjsLib && window.pdfjsWorker) {
    // The worker code is already loaded on the page, so pdf.js runs in-thread — no worker file to fetch.
    window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'about:blank';
  }

  const DEFAULT_SETTINGS = { defaultOffsets: [30, 7, 1], currency: '£', notify: false, notified: [], lastBackup: '', theme: 'system' };
  const PERSON_COLOURS = ['#2F6FB3', '#C0573A', '#2E8A6B', '#7A4FB8', '#B8860B', '#C2407A', '#3B8C9E', '#5F6B7A'];

  const isTouch = window.matchMedia('(pointer: coarse)').matches;

  const state = {
    items: [],
    people: [],
    files: new Map(),
    settings: { ...DEFAULT_SETTINGS },
    imports: [],
    filters: { group: 'all', person: 'all', status: 'active', q: '', sort: 'date' },
    calMonth: C.today().slice(0, 7),
  };

  /* ---------- helpers ---------- */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = (n) => C.formatMoney(n, state.settings.currency);
  const person = (id) => state.people.find((p) => p.id === id);
  const itemById = (id) => state.items.find((i) => i.id === id);
  const active = () => state.items.filter((i) => i.status === 'active');
  const reminders = () => C.allReminders(state.items, state.settings);

  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
  }

  function dueBadge(iso) {
    if (!iso) return '<span class="pill grey">No date</span>';
    const n = C.daysBetween(C.today(), iso);
    const cls = n < 0 ? 'red' : n <= 14 ? 'red' : n <= 45 ? 'amber' : 'green';
    const txt = n < 0 ? `${-n}d overdue` : n === 0 ? 'Today' : n <= 60 ? `${n} days` : C.relative(iso).replace('in ', '');
    return `<span class="pill ${cls}" title="${esc(C.formatDate(iso))}">${esc(txt)}</span>`;
  }

  function ownerChip(item) {
    const p = person(item.ownerId);
    if (!p) return '<span class="chip"><span class="dot" style="background:#999"></span>Household</span>';
    return `<span class="chip"><span class="dot" style="background:${esc(p.color)}"></span>${esc(p.name)}</span>`;
  }

  function download(name, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function highlight(text, found) {
    const safe = esc(text);
    const parts = (found || []).map(esc).filter((s) => s.length >= 3).sort((a, b) => b.length - a.length).map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    if (!parts.length) return safe;
    return safe.replace(new RegExp(parts.join('|'), 'g'), (m) => `<mark>${m}</mark>`);
  }

  /* ---------- persistence ---------- */
  async function saveItem(item) {
    item.updated = C.today();
    await DB.put('items', item);
    const i = state.items.findIndex((x) => x.id === item.id);
    if (i >= 0) state.items[i] = item; else state.items.push(item);
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  }
  async function saveSettings() {
    for (const [k, v] of Object.entries(state.settings)) await DB.setSetting(k, v);
  }
  async function savePerson(p) {
    await DB.put('people', p);
    const i = state.people.findIndex((x) => x.id === p.id);
    if (i >= 0) state.people[i] = p; else state.people.push(p);
  }
  async function saveFile(rec) {
    await DB.put('files', rec);
    state.files.set(rec.id, rec);
  }

  async function load() {
    const [items, people, files] = await Promise.all([DB.getAll('items'), DB.getAll('people'), DB.getAll('files')]);
    state.items = items;
    state.people = people.sort((a, b) => a.name.localeCompare(b.name));
    state.files = new Map(files.map((f) => [f.id, f]));
    for (const k of Object.keys(DEFAULT_SETTINGS)) state.settings[k] = await DB.getSetting(k, DEFAULT_SETTINGS[k]);
    applyTheme();
  }

  function applyTheme() {
    const t = state.settings.theme;
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }

  /* ---------- modal ---------- */
  function openModal(html, narrow) {
    $('#modal-root').innerHTML = `<div class="modal-back" data-act="modal-back"><div class="modal ${narrow ? 'narrow' : ''}" role="dialog" aria-modal="true">${html}</div></div>`;
    const first = $('#modal-root input, #modal-root select, #modal-root textarea');
    if (first) first.focus();
    return $('#modal-root .modal');
  }
  function closeModal() { $('#modal-root').innerHTML = ''; }

  /* ---------- router ---------- */
  function route() {
    const parts = location.hash.replace(/^#\/?/, '').split('/');
    return { name: parts[0] || 'dashboard', id: parts[1] ? decodeURIComponent(parts[1]) : '' };
  }

  function render() {
    const r = route();
    $$('.nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (r.name === 'item' ? 'items' : r.name)));
    const badge = $('#inbox-count');
    badge.hidden = !state.imports.length;
    badge.textContent = state.imports.length;
    const view = $('#view');
    const views = { dashboard: viewDashboard, items: viewItems, item: () => viewItem(r.id), calendar: viewCalendar, inbox: viewInbox, people: viewPeople, settings: viewSettings };
    view.innerHTML = (views[r.name] || viewDashboard)();
    afterRender(r);
    const due = reminders().filter((x) => !x.done && x.date <= C.today()).length;
    document.title = due ? `(${due}) Personal Admin` : 'Personal Admin';
  }

  function afterRender(r) {
    if (r.name === 'inbox') {
      const ta = $('#paste-text');
      if (ta && state.pasteDraft) ta.value = state.pasteDraft;
    }
  }

  /* ================= DASHBOARD ================= */
  function viewDashboard() {
    const today = C.today();
    const act = active();
    const rems = reminders();
    const attention = rems.filter((r) => !r.done && r.date <= today && itemById(r.itemId));
    const expired = act.filter((i) => i.endDate && i.endDate < today && !attention.some((r) => r.itemId === i.id));
    const monthly = act.reduce((s, i) => s + C.monthlyCost(i), 0);
    const soon = act.filter((i) => i.endDate && i.endDate >= today && i.endDate <= C.addDays(today, 60)).sort((a, b) => a.endDate.localeCompare(b.endDate));
    const hour = new Date().getHours();
    const greet = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

    let banners = pwaBanners();
    if (!state.items.length) {
      banners += `<div class="card" style="margin-bottom:18px">
        <h2>👋 Welcome to your Personal Admin Assistant</h2>
        <p class="muted">Keep every policy, contract and regular payment in one place, with reminders before anything renews. Everything is stored <b>only in this browser on this device</b>.</p>
        <ol class="muted small" style="line-height:1.8">
          <li><a href="#/people">Add the people in your household</a> so you can tag whose phone, car or card each thing is.</li>
          ${isTouch
            ? '<li><b>Share a renewal PDF or email text to “Personal Admin”</b> from any app (or tap <i>Add from file</i>), and the details are read for you.</li>'
            : '<li><b>Drag a renewal email, PDF or contract</b> anywhere onto this window, and the details are read for you.</li>'}
          <li>Or <a href="#" data-act="new-item">add something by hand</a>.</li>
        </ol>
        <div class="row"><button class="btn primary" data-act="new-item">＋ Add manually</button><a class="btn" href="#/inbox">📥 Add from a file</a><button class="btn" data-act="load-example">Try with example data</button></div>
      </div>`;
    } else {
      const days = state.settings.lastBackup ? C.daysBetween(state.settings.lastBackup, today) : Infinity;
      if (days > 30) banners += `<div class="banner warn"><span>💾</span><span style="flex:1">${state.settings.lastBackup ? `Your last backup was ${days} days ago.` : "You haven't made a backup yet."} Your data lives only in this browser. A backup file protects you if it is ever cleared.</span><button class="btn sm" data-act="export-json">Back up now</button></div>`;
      if (state.items.some((i) => i.example)) banners += `<div class="banner info"><span>🧪</span><span style="flex:1">You're looking at example data.</span><button class="btn sm" data-act="clear-example">Remove example data</button></div>`;
    }

    // One line per item: the most recent due reminder; "Done" ticks off all of them
    const byItem = new Map();
    for (const r of attention) byItem.set(r.itemId, [...(byItem.get(r.itemId) || []), r]);
    const attnRows = [
      ...[...byItem.values()].map((rs) => {
        const r = rs[rs.length - 1];
        const it = itemById(r.itemId);
        const keys = esc(rs.map((x) => x.key).join('|'));
        return `<div class="attn"><span class="ic">${C.category(it.category).icon}</span><div class="t"><b>${esc(it.name)}</b><span class="muted small">${esc(r.due < today ? `${r.kind === 'promo' ? 'Promo rate ended' : C.category(it.category).endLabel + ' was'} ${C.relative(r.due)}` : r.title)} · ${esc(C.formatDate(r.due))}${rs.length > 1 ? ` · ${rs.length} reminders` : ''}</span></div>
          <a class="btn sm" href="#/item/${esc(it.id)}">Open</a><button class="btn sm" data-act="rem-done" data-item="${esc(it.id)}" data-key="${keys}" title="Mark as dealt with">✓ Done</button><button class="btn sm ghost" data-act="rem-snooze" data-item="${esc(it.id)}" data-key="${keys}" title="Remind me again in 7 days">💤 7d</button></div>`;
      }),
      ...expired.map((it) => `<div class="attn"><span class="ic">${C.category(it.category).icon}</span><div class="t"><b>${esc(it.name)}</b><span class="muted small">${esc(C.category(it.category).endLabel)} passed ${esc(C.relative(it.endDate))}. Renewed, or finished?</span></div>
        <button class="btn sm" data-act="renew" data-id="${esc(it.id)}">Mark renewed</button><button class="btn sm ghost" data-act="archive" data-id="${esc(it.id)}">Archive</button></div>`),
    ].join('');

    return `
      <div class="page-head"><div><h1>${greet}</h1><div class="muted">${esc(C.formatDate(today))} · ${act.length} active item${act.length === 1 ? '' : 's'}</div></div>
        <div class="row"><a class="btn" href="#/inbox">📥 Add from file</a><button class="btn primary" data-act="new-item">＋ Add</button></div></div>
      ${banners}
      ${state.items.length ? `
      <div class="stats">
        <div class="stat"><div class="v">${money(Math.round(monthly))}</div><div class="l">Regular outgoings / month</div></div>
        <div class="stat"><div class="v">${money(Math.round(monthly * 12))}</div><div class="l">Per year</div></div>
        <div class="stat"><div class="v" style="color:${byItem.size + expired.length ? 'var(--red)' : 'var(--green)'}">${byItem.size + expired.length}</div><div class="l">Need attention now</div></div>
        <div class="stat"><div class="v">${soon.length}</div><div class="l">Renewing in 60 days</div></div>
      </div>
      <div class="grid grid-2">
        <div class="card"><h2>🔔 Needs attention</h2>${attnRows || '<div class="empty"><div class="big">✅</div>Nothing needs you today.</div>'}</div>
        <div class="card"><h2>⏳ Coming up (next 60 days)</h2>${soon.length ? soon.map((it) => `<a class="attn" href="#/item/${esc(it.id)}" style="color:inherit;text-decoration:none"><span class="ic">${C.category(it.category).icon}</span><div class="t"><b>${esc(it.name)}</b><span class="muted small">${esc(C.formatDate(it.endDate))}${it.ownerId ? ` · ${esc(person(it.ownerId)?.name || '')}` : ''}</span></div>${dueBadge(it.endDate)}</a>`).join('') : '<div class="empty">Nothing renews in the next two months.</div>'}</div>
      </div>
      <div class="card" style="margin-top:16px"><h2>📆 The year ahead</h2><p class="muted small" style="margin-top:-6px">Each block is a renewal or end date. The colour shows the type of thing.</p>${timeline()}<div class="legend" style="margin-top:10px">${C.GROUPS.map((g) => `<span><i style="background:${g.color};border-color:${g.color}"></i>${esc(g.label)}</span>`).join('')}</div></div>
      <div class="grid grid-2" style="margin-top:16px">
        <div class="card"><h2>💷 Where the money goes (per month)</h2>${spendBars()}</div>
        <div class="card"><h2>👪 By person</h2>${byPerson()}</div>
      </div>` : ''}`;
  }

  function timeline() {
    const start = C.today().slice(0, 7) + '-01';
    const cols = [];
    for (let m = 0; m < 12; m++) {
      const ms = C.addMonths(start, m), me = C.addDays(C.addMonths(start, m + 1), -1);
      const d = C.parseISO(ms);
      const its = active().filter((i) => i.endDate && i.endDate >= ms && i.endDate <= me).sort((a, b) => a.endDate.localeCompare(b.endDate));
      cols.push(`<div class="tl-col ${m === 0 ? 'now' : ''}"><div class="tl-m">${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()]}${d.getMonth() === 0 || m === 0 ? ` <span style="font-weight:400">'${String(d.getFullYear()).slice(2)}</span>` : ''}</div>
        ${its.map((i) => `<a class="tl-item" href="#/item/${esc(i.id)}" style="background:${C.group(C.category(i.category).group).color}" title="${esc(i.name)}: ${esc(C.formatDate(i.endDate))}">${C.category(i.category).icon} ${esc(i.name)}</a>`).join('')}</div>`);
    }
    return `<div class="timeline">${cols.join('')}</div>`;
  }

  function spendBars() {
    const totals = C.GROUPS.map((g) => ({ g, v: active().filter((i) => C.category(i.category).group === g.id).reduce((s, i) => s + C.monthlyCost(i), 0) })).filter((x) => x.v > 0).sort((a, b) => b.v - a.v);
    if (!totals.length) return '<div class="empty">Add costs to your items to see this.</div>';
    const max = totals[0].v;
    return totals.map(({ g, v }) => `<div class="bar-row"><span>${esc(g.label)}</span><div class="bar-track"><div class="bar-fill" style="width:${(v / max) * 100}%;background:${g.color}"></div></div><span class="amt">${money(v.toFixed(2))}</span></div>`).join('');
  }

  function byPerson() {
    const rows = [...state.people, { id: '', name: 'Household / shared', color: '#999' }].map((p) => {
      const its = active().filter((i) => (i.ownerId || '') === p.id);
      return { p, n: its.length, v: its.reduce((s, i) => s + C.monthlyCost(i), 0) };
    }).filter((x) => x.n);
    if (!rows.length) return '<div class="empty">No items yet.</div>';
    return rows.map(({ p, n, v }) => `<div class="person"><div class="avatar" style="background:${esc(p.color)}">${esc(p.name.slice(0, 1))}</div><div style="flex:1"><b>${esc(p.name)}</b><div class="muted small">${n} item${n === 1 ? '' : 's'}</div></div><b>${money(v.toFixed(2))}<span class="muted small">/mo</span></b></div>`).join('');
  }

  /* ================= ALL ITEMS ================= */
  function viewItems() {
    const f = state.filters;
    let list = state.items.filter((i) => (f.status === 'all' ? true : i.status === f.status));
    if (f.group !== 'all') list = list.filter((i) => C.category(i.category).group === f.group);
    if (f.person !== 'all') list = list.filter((i) => (i.ownerId || '') === (f.person === 'household' ? '' : f.person));
    if (f.q) {
      const q = f.q.toLowerCase();
      list = list.filter((i) => [i.name, i.provider, i.reference, i.notes, C.category(i.category).label, person(i.ownerId)?.name, ...Object.values(i.extra || {})].join(' ').toLowerCase().includes(q));
    }
    const sorters = {
      date: (a, b) => (a.endDate || '9999').localeCompare(b.endDate || '9999'),
      cost: (a, b) => C.monthlyCost(b) - C.monthlyCost(a),
      name: (a, b) => a.name.localeCompare(b.name),
      group: (a, b) => C.GROUPS.findIndex((g) => g.id === C.category(a.category).group) - C.GROUPS.findIndex((g) => g.id === C.category(b.category).group) || (a.endDate || '9999').localeCompare(b.endDate || '9999'),
    };
    list.sort(sorters[f.sort] || sorters.date);

    const row = (i) => `<a class="item-row" href="#/item/${esc(i.id)}">
      <span class="ic">${C.category(i.category).icon}</span>
      <span class="nm"><b>${esc(i.name)}</b><span class="muted small">${esc([C.category(i.category).label, i.provider, i.reference].filter(Boolean).join(' · '))}</span></span>
      <span class="owner">${ownerChip(i)}</span>
      <span class="money">${i.cost ? `${money(i.cost)}<div class="muted small">${esc(C.FREQUENCIES.find((x) => x.id === i.frequency)?.label || '')}</div>` : '<span class="muted">—</span>'}</span>
      <span class="when">${i.status === 'active' ? dueBadge(i.endDate) : `<span class="pill grey">${esc(i.status)}</span>`}${i.endDate ? `<div class="muted small">${esc(C.formatDate(i.endDate))}</div>` : ''}</span></a>`;

    let body;
    if (!list.length) body = `<div class="card empty"><div class="big">🗂️</div>${state.items.length ? 'Nothing matches these filters.' : 'Nothing here yet. Add something or drop a document in.'}</div>`;
    else if (f.sort === 'group') {
      body = C.GROUPS.map((g) => {
        const its = list.filter((i) => C.category(i.category).group === g.id);
        return its.length ? `<div class="group-title"><span class="swatch" style="background:${g.color}"></span>${esc(g.label)} <span class="muted">(${its.length})</span></div><div class="items">${its.map(row).join('')}</div>` : '';
      }).join('');
    } else body = `<div class="items">${list.map(row).join('')}</div>`;

    const total = list.filter((i) => i.status === 'active').reduce((s, i) => s + C.monthlyCost(i), 0);
    return `
      <div class="page-head"><div><h1>Everything</h1><div class="muted">${list.length} shown · ${money(total.toFixed(2))} a month</div></div>
        <div class="row"><button class="btn" data-act="export-csv">⬇︎ CSV</button><button class="btn primary" data-act="new-item">＋ Add</button></div></div>
      <div class="filter-chips">${[{ id: 'all', label: 'All' }, ...C.GROUPS].map((g) => `<button class="${f.group === g.id ? 'on' : ''}" data-act="filter" data-k="group" data-v="${g.id}">${esc(g.label)}</button>`).join('')}</div>
      <div class="toolbar">
        <input type="search" id="q" placeholder="Search names, providers, references, numbers…" value="${esc(f.q)}" aria-label="Search">
        <select data-filter="person" aria-label="Person"><option value="all">Everyone</option><option value="household" ${f.person === 'household' ? 'selected' : ''}>Household / shared</option>${state.people.map((p) => `<option value="${esc(p.id)}" ${f.person === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>
        <select data-filter="status" aria-label="Status">${['active', 'archived', 'all'].map((s) => `<option value="${s}" ${f.status === s ? 'selected' : ''}>${s === 'all' ? 'Active + archived' : s[0].toUpperCase() + s.slice(1)}</option>`).join('')}</select>
        <select data-filter="sort" aria-label="Sort">${[['date', 'Soonest date first'], ['group', 'Grouped by type'], ['cost', 'Most expensive first'], ['name', 'A–Z']].map(([v, l]) => `<option value="${v}" ${f.sort === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      </div>
      ${body}`;
  }

  /* ================= ITEM DETAIL ================= */
  function viewItem(id) {
    const it = itemById(id);
    if (!it) return '<div class="card empty">That item no longer exists. <a href="#/items">Back to everything</a></div>';
    const cat = C.category(it.category);
    const today = C.today();
    const rems = C.itemReminders(it, state.settings).sort((a, b) => a.date.localeCompare(b.date));
    const freq = C.FREQUENCIES.find((x) => x.id === it.frequency);
    const prev = Number(it.previousCost), cur = Number(it.cost);
    const change = prev && cur ? ((cur - prev) / prev) * 100 : null;
    const notice = parseInt(it.noticeDays, 10) > 0 && it.endDate ? C.addDays(it.endDate, -parseInt(it.noticeDays, 10)) : '';

    const kd = (label, iso, extra = '') => `<div class="keydate"><div class="l">${esc(label)}</div><div class="d">${iso ? esc(C.formatDate(iso)) : '<span class="muted">Not set</span>'}</div>${iso ? `<div class="small">${iso >= today ? dueBadge(iso) : `<span class="muted">${esc(C.relative(iso))}</span>`}</div>` : ''}${extra}</div>`;

    const details = [
      ['Provider', esc(it.provider)],
      ['Reference / account no.', it.reference ? `<code>${esc(it.reference)}</code> <button class="btn sm ghost" data-act="copy" data-text="${esc(it.reference)}" title="Copy">📋</button>` : ''],
      ['Name on account', esc(it.holderName)],
      ['Belongs to', ownerChip(it)],
      ['Auto-renews', it.autoRenew === 'yes' ? 'Yes' : it.autoRenew === 'no' ? 'No' : ''],
      ['Notice period', it.noticeDays ? `${esc(it.noticeDays)} days` : ''],
      ['Payment method', esc(it.paymentMethod)],
      ['Payment day', it.paymentDay ? `${esc(it.paymentDay)}${['th', 'st', 'nd', 'rd'][(it.paymentDay % 100 > 10 && it.paymentDay % 100 < 14) ? 0 : Math.min(it.paymentDay % 10, 4) % 4] || 'th'} of the month` : ''],
      ['Phone', it.contactPhone ? `<a href="tel:${esc(it.contactPhone.replace(/\s/g, ''))}">${esc(it.contactPhone)}</a>` : ''],
      ['Website', it.website ? `<a href="https://${esc(it.website.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener noreferrer">${esc(it.website)}</a>` : ''],
      ...cat.extra.filter((k) => k !== 'promoEndDate').map((k) => {
        const def = C.FIELDS[k] || { label: k };
        const v = it.extra?.[k];
        return [def.label, v === undefined || v === '' ? '' : def.type === 'money' ? money(v) : def.type === 'date' ? esc(C.formatDate(v)) : k === 'apr' || k === 'promoRate' ? `${esc(v)}%` : esc(v)];
      }),
    ].filter(([, v]) => v);

    const files = (it.fileIds || []).map((fid) => state.files.get(fid)).filter(Boolean);

    return `
      <div class="row small" style="margin-bottom:10px"><a href="#/items">← Everything</a></div>
      <div class="detail-head">
        <div class="ic">${cat.icon}</div>
        <div style="flex:1;min-width:220px"><h1>${esc(it.name)}</h1>
          <div class="row"><span class="chip"><span class="dot" style="background:${C.group(cat.group).color}"></span>${esc(cat.label)}</span>${ownerChip(it)}${it.status !== 'active' ? `<span class="pill grey">${esc(it.status)}</span>` : ''}${it.example ? '<span class="pill grey">example</span>' : ''}</div></div>
        <div class="row">
          <button class="btn primary" data-act="edit" data-id="${esc(it.id)}">✏️ Edit</button>
          ${it.status === 'active' ? `<button class="btn" data-act="renew" data-id="${esc(it.id)}">🔄 Mark renewed</button>` : ''}
          <button class="btn" data-act="add-reminder" data-id="${esc(it.id)}">⏰ Reminder</button>
          <button class="btn" data-act="item-ics" data-id="${esc(it.id)}" title="Download reminders for your phone or computer calendar">📅 To calendar</button>
          <button class="btn ghost" data-act="${it.status === 'active' ? 'archive' : 'unarchive'}" data-id="${esc(it.id)}">${it.status === 'active' ? '🗄️ Archive' : '↩︎ Restore'}</button>
          <button class="btn ghost danger" data-act="delete" data-id="${esc(it.id)}">🗑️</button>
        </div>
      </div>
      <div class="grid grid-2">
        <div class="stack">
          <div class="card"><h2>Key dates</h2><div class="keydates">
            ${kd(cat.endLabel, it.endDate)}
            ${notice ? kd('Give notice by', notice) : ''}
            ${it.extra?.promoEndDate ? kd('Promo / fixed rate ends', it.extra.promoEndDate) : ''}
            ${kd('Started', it.startDate)}
          </div></div>
          <div class="card"><h2>Cost</h2>${it.cost ? `
            <div class="keydates">
              <div class="keydate"><div class="l">${esc(freq?.label || 'Cost')}</div><div class="d" style="font-size:1.3rem">${money(it.cost)}</div></div>
              ${it.frequency !== 'monthly' && it.frequency !== 'one_off' ? `<div class="keydate"><div class="l">Per month</div><div class="d">${money(C.monthlyCost(it).toFixed(2))}</div></div>` : ''}
              ${it.frequency !== 'annually' && it.frequency !== 'one_off' ? `<div class="keydate"><div class="l">Per year</div><div class="d">${money(C.annualCost(it).toFixed(2))}</div></div>` : ''}
              ${prev ? `<div class="keydate"><div class="l">Previously</div><div class="d">${money(prev)}</div><div class="small ${change > 0 ? 'change-up' : 'change-down'}">${change > 0 ? '▲' : '▼'} ${Math.abs(change).toFixed(1)}%${change > 5 ? ' — worth shopping around?' : ''}</div></div>` : ''}
            </div>` : '<div class="muted">No cost recorded. <a href="#" data-act="edit" data-id="' + esc(it.id) + '">Add one</a>.</div>'}</div>
          <div class="card"><h2>Details</h2>${details.length ? `<dl class="kv">${details.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}</dl>` : '<div class="muted">No details yet.</div>'}
            ${it.notes ? `<h3 style="margin-top:16px">Notes</h3><div style="white-space:pre-wrap">${esc(it.notes)}</div>` : ''}</div>
        </div>
        <div class="stack">
          <div class="card"><div class="row" style="margin-bottom:8px"><h2 style="margin:0">Reminders</h2><span class="spacer"></span><button class="btn sm" data-act="add-reminder" data-id="${esc(it.id)}">＋ Add</button></div>
            ${rems.length ? rems.map((r) => `<div class="rem ${r.done ? 'done' : ''}"><input type="checkbox" ${r.done ? 'checked' : ''} data-act="rem-toggle" data-item="${esc(it.id)}" data-key="${esc(r.key)}" aria-label="Done" style="width:auto"><span class="nowrap" style="min-width:96px">${esc(C.formatDate(r.date))}</span><span style="flex:1">${esc(r.title)}</span>${r.date <= today && !r.done ? '<span class="pill red">due</span>' : ''}${r.kind === 'custom' ? `<button class="btn sm ghost" data-act="rem-delete" data-item="${esc(it.id)}" data-key="${esc(r.key)}" title="Delete reminder">✕</button>` : ''}</div>`).join('') : `<div class="muted small">No reminders. Set a ${esc(cat.endLabel.toLowerCase())} and reminders will be created automatically (${esc((it.reminderOffsets || state.settings.defaultOffsets).join(', '))} days before).</div>`}
          </div>
          <div class="card"><h2>Documents</h2>
            <div class="files">${files.length ? files.map((f) => `<div class="file"><span>${/pdf/.test(f.type) ? '📕' : /image/.test(f.type) ? '🖼️' : /eml|msg|rfc822/.test(f.name + f.type) ? '✉️' : '📄'}</span><span class="n" title="${esc(f.name)}">${esc(f.name)}<div class="muted small">${esc(C.formatDate(f.added))} · ${Math.max(1, Math.round(f.size / 1024))} KB</div></span>
              <button class="btn sm" data-act="file-open" data-id="${esc(f.id)}">Open</button>${f.text ? `<button class="btn sm ghost" data-act="file-text" data-id="${esc(f.id)}">Text</button>` : ''}<button class="btn sm ghost" data-act="file-remove" data-id="${esc(f.id)}" data-item="${esc(it.id)}" title="Remove">✕</button></div>`).join('') : ''}</div>
            <div class="dropzone" data-dropitem="${esc(it.id)}" style="padding:18px;margin-top:10px"><div>📎 Drop a document here to attach it and update these details</div><div class="small muted" style="margin-top:6px"><label class="btn sm">Choose file<input type="file" multiple hidden data-act="pick-files" data-item="${esc(it.id)}"></label></div></div>
          </div>
          <div class="card"><h2>History</h2>${(it.history || []).length ? `<ul class="history">${it.history.slice().reverse().map((h) => `<li><span class="muted">${esc(C.formatDate(h.date))}</span> — ${esc(h.text)}</li>`).join('')}</ul>` : '<div class="muted small">Renewals and changes made from documents will be logged here.</div>'}</div>
        </div>
      </div>`;
  }

  /* ================= ITEM FORM ================= */
  function field(name, label, value, o = {}) {
    const conf = o.conf ? ` hi-${o.conf}` : '';
    const was = o.was !== undefined && o.was !== '' && String(o.was) !== String(value ?? '') ? ` <span class="was">(was: ${esc(o.was)})</span>` : '';
    let input;
    if (o.options) input = `<select name="${name}">${o.options.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value ?? '') ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;
    else if (o.type === 'textarea') input = `<textarea name="${name}" placeholder="${esc(o.placeholder || '')}">${esc(value)}</textarea>`;
    else {
      const t = o.type === 'money' || o.type === 'number' ? 'number' : o.type || 'text';
      input = `<input name="${name}" type="${t}" ${t === 'number' ? 'step="any" inputmode="decimal"' : ''} value="${esc(value)}" placeholder="${esc(o.placeholder || '')}" ${o.list ? `list="${o.list}"` : ''} ${o.required ? 'required' : ''}>`;
    }
    return `<label class="f${conf}${o.wide ? ' wide' : ''}">${esc(label)}${was}${input}</label>`;
  }

  function categoryOptions(sel) {
    return C.GROUPS.map((g) => `<optgroup label="${esc(g.label)}">${C.CATEGORIES.filter((c) => c.group === g.id).map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${c.icon} ${esc(c.label)}</option>`).join('')}</optgroup>`).join('');
  }

  function extrasHTML(catId, extra, conf = {}, prevExtra) {
    const cat = C.category(catId);
    if (!cat.extra.length) return '<div class="muted small">No extra fields for this type. Use notes for anything else.</div>';
    return `<div class="form-grid">${cat.extra.map((k) => {
      const def = C.FIELDS[k] || { label: k };
      return field(`extra.${k}`, def.label, extra?.[k] ?? '', { type: def.type, placeholder: def.placeholder, conf: conf[`extra.${k}`], was: prevExtra ? prevExtra[k] ?? '' : undefined });
    }).join('')}</div>`;
  }

  // v: item-like values; conf: confidence map from extraction; prev: existing item (for "was")
  function itemFormHTML(v, conf = {}, prev = null) {
    const w = (k) => (prev ? prev[k] ?? '' : undefined);
    const cat = C.category(v.category);
    const people = [['', 'Household / shared'], ...state.people.map((p) => [p.id, p.name])];
    return `<div class="item-form">
      <fieldset><legend>The basics</legend><div class="form-grid">
        ${field('name', 'Name', v.name, { wide: true, required: true, conf: conf.name, was: w('name'), placeholder: "e.g. Sam's iPhone contract" })}
        <label class="f${conf.category ? ` hi-${conf.category}` : ''}">Type<select name="category">${categoryOptions(v.category)}</select></label>
        ${field('ownerId', 'Belongs to', v.ownerId, { options: people, conf: conf.ownerId, was: prev ? person(prev.ownerId)?.name ?? '' : undefined })}
        ${field('provider', 'Provider / company', v.provider, { conf: conf.provider, was: w('provider'), list: 'providers' })}
        ${field('reference', 'Policy / account / reference no.', v.reference, { conf: conf.reference, was: w('reference') })}
        ${field('holderName', 'Name on account', v.holderName, { conf: conf.holderName, was: w('holderName') })}
        ${field('status', 'Status', v.status || 'active', { options: [['active', 'Active'], ['archived', 'Archived / ended']] })}
      </div></fieldset>
      <fieldset><legend>Dates & reminders</legend><div class="form-grid">
        <span data-endlabel-wrap>${field('endDate', cat.endLabel, v.endDate, { type: 'date', conf: conf.endDate, was: w('endDate') })}</span>
        ${field('startDate', 'Start date', v.startDate, { type: 'date', conf: conf.startDate, was: w('startDate') })}
        ${field('autoRenew', 'Auto-renews?', v.autoRenew, { options: [['', "Don't know"], ['yes', 'Yes'], ['no', 'No']], conf: conf.autoRenew })}
        ${field('noticeDays', 'Notice period (days)', v.noticeDays, { type: 'number', conf: conf.noticeDays, placeholder: 'e.g. 30' })}
        ${field('reminderOffsets', 'Remind me (days before)', v.reminderOffsets ? v.reminderOffsets.join(', ') : '', { placeholder: `Default: ${state.settings.defaultOffsets.join(', ')}` })}
      </div></fieldset>
      <fieldset><legend>Money</legend><div class="form-grid">
        ${field('cost', `Cost (${state.settings.currency})`, v.cost, { type: 'money', conf: conf.cost, was: w('cost') })}
        ${field('frequency', 'How often', v.frequency, { options: C.FREQUENCIES.map((f) => [f.id, f.label]), conf: conf.frequency })}
        ${field('previousCost', `Previous cost (${state.settings.currency})`, v.previousCost, { type: 'money', conf: conf.previousCost })}
        ${field('paymentMethod', 'Payment method', v.paymentMethod, { list: 'paymethods', conf: conf.paymentMethod })}
        ${field('paymentDay', 'Payment day of month', v.paymentDay, { type: 'number', conf: conf.paymentDay, placeholder: '1–31' })}
      </div></fieldset>
      <fieldset><legend>${esc(cat.label)} details</legend><div data-extras>${extrasHTML(v.category, v.extra, conf, prev?.extra)}</div></fieldset>
      <fieldset><legend>Contact & notes</legend><div class="form-grid">
        ${field('contactPhone', 'Contact phone', v.contactPhone, { conf: conf.contactPhone })}
        ${field('website', 'Website', v.website, { conf: conf.website })}
        ${field('notes', 'Notes', v.notes, { type: 'textarea', wide: true, placeholder: 'Anything useful: what is covered, login hints (not passwords), who to call…' })}
      </div></fieldset>
      <datalist id="providers">${[...new Set(X.PROVIDERS.map((p) => p[0]))].map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
      <datalist id="paymethods">${C.PAYMENT_METHODS.map((p) => `<option value="${esc(p)}">`).join('')}</datalist>
    </div>`;
  }

  function readItemForm(root) {
    const out = { extra: {} };
    $$('[name]', root).forEach((el) => {
      if (el.type === 'file') return;
      const v = el.value.trim();
      if (el.name.startsWith('extra.')) { if (v !== '') out.extra[el.name.slice(6)] = v; }
      else out[el.name] = v;
    });
    out.reminderOffsets = out.reminderOffsets ? C.parseOffsets(out.reminderOffsets) : null;
    if (out.reminderOffsets && !out.reminderOffsets.length) out.reminderOffsets = null;
    return out;
  }

  function onCategoryChange(select) {
    const form = select.closest('.item-form');
    const current = readItemForm(form).extra;
    const cat = C.category(select.value);
    $('[data-extras]', form).innerHTML = extrasHTML(select.value, current);
    $('[data-extras]', form).closest('fieldset').querySelector('legend').textContent = `${cat.label} details`;
    const lbl = $('[data-endlabel-wrap] label', form);
    if (lbl) lbl.firstChild.textContent = cat.endLabel;
  }

  function openItemEditor(item) {
    const isNew = !itemById(item.id);
    openModal(`<form id="item-edit"><div class="modal-head"><h2 style="margin:0">${isNew ? 'Add something' : `Edit ${esc(item.name)}`}</h2><button type="button" class="btn ghost" data-act="close">✕</button></div>
      ${itemFormHTML(item)}
      <div class="modal-foot"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary" type="submit">${isNew ? 'Add' : 'Save'}</button></div></form>`);
    $('#item-edit').addEventListener('submit', async (e) => {
      e.preventDefault();
      const vals = readItemForm(e.target);
      const merged = { ...item, ...vals, extra: vals.extra };
      if (!merged.name) merged.name = C.category(merged.category).label;
      await saveItem(merged);
      closeModal();
      toast(isNew ? 'Added' : 'Saved');
      if (isNew) location.hash = `#/item/${merged.id}`; else render();
    });
  }

  /* ================= CALENDAR ================= */
  function viewCalendar() {
    const [y, m] = state.calMonth.split('-').map(Number);
    const first = new Date(y, m - 1, 1);
    const startOffset = (first.getDay() + 6) % 7; // Monday-first
    const gridStart = C.addDays(C.toISO(first), -startOffset);
    const today = C.today();
    const rems = reminders().filter((r) => !r.done);
    const days = [];
    for (let i = 0; i < 42; i++) {
      const d = C.addDays(gridStart, i);
      const ends = active().filter((it) => it.endDate === d);
      // a 0-days-before reminder lands on the end date itself, which is already shown
      const rs = rems.filter((r) => r.date === d && (r.kind === 'custom' || r.date !== r.due));
      days.push(`<div class="day ${d.slice(0, 7) !== state.calMonth ? 'out' : ''} ${d === today ? 'today' : ''}"><div class="dn">${C.parseISO(d).getDate()}</div>
        ${ends.map((it) => `<a class="ev" href="#/item/${esc(it.id)}" style="background:${C.group(C.category(it.category).group).color}" title="${esc(it.name)}: ${esc(C.category(it.category).endLabel)}">${C.category(it.category).icon} ${esc(it.name)}</a>`).join('')}
        ${rs.map((r) => `<a class="ev rem" href="#/item/${esc(r.itemId)}" title="${esc(r.title)}">⏰ ${esc(itemById(r.itemId)?.name || '')}</a>`).join('')}</div>`);
    }
    const label = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    return `<div class="page-head"><div><h1>Calendar</h1><div class="muted">Coloured = renewal/end date · dashed ⏰ = reminder</div></div>
      <div class="row"><button class="btn" data-act="export-ics">📅 Export all reminders (.ics)</button></div></div>
      <div class="cal-head"><button class="btn sm" data-act="cal" data-d="-1" aria-label="Previous month">‹</button><h2 style="margin:0;min-width:170px;text-align:center">${esc(label)}</h2><button class="btn sm" data-act="cal" data-d="1" aria-label="Next month">›</button><button class="btn sm ghost" data-act="cal" data-d="0">Today</button></div>
      <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div class="dow">${d}</div>`).join('')}${days.join('')}</div>
      <p class="muted small" style="margin-top:14px">💡 Exporting to .ics puts every reminder into Google/Apple/Outlook calendar, so you get alerts on your phone even when this app is closed. Re-export after you make changes.</p>`;
  }

  /* ================= INBOX / IMPORT ================= */
  function viewInbox() {
    return `<div class="page-head"><div><h1>Add from a file</h1><div class="muted">Drop emails, PDFs or documents. The details are read on this device and nothing is uploaded.</div></div></div>
      <div class="dropzone" data-dropitem="">
        <div class="big">📥</div>
        <h2 style="margin:6px 0">${isTouch ? 'Pick a file, or share one to this app' : 'Drag & drop here, or anywhere on the page'}</h2>
        <div class="muted small">Emails (.eml, .msg) · PDF · Word (.docx) · text/HTML · images · or drag highlighted text straight from your email</div>
        <div class="row" style="justify-content:center;margin-top:14px"><label class="btn primary">Choose files<input type="file" multiple hidden data-act="pick-files" data-item=""></label>${isTouch ? '<label class="btn">📷 Photo of a letter<input type="file" accept="image/*" capture="environment" hidden data-act="pick-files" data-item=""></label>' : ''}</div>
        ${isTouch ? '<p class="muted small" style="margin-top:12px">📤 <b>From Gmail or any app:</b> open the PDF attachment → Share → <b>Personal Admin</b>. For the email itself, select its text → Share → Personal Admin (or copy and paste below).<br>📷 Photos are saved with the item but not read, so type the key details in. Tip: Google Lens can copy the text from a letter, and you can paste it below.</p>' : ''}
      </div>
      <details class="card" style="margin-top:14px" ${state.pasteDraft ? 'open' : ''}><summary style="cursor:pointer;font-weight:600">✂️ Or paste the text of an email</summary>
        <textarea id="paste-text" style="margin-top:10px;min-height:140px" placeholder="Open the email, select all (Ctrl/Cmd + A), copy, and paste here…"></textarea>
        <div class="row" style="margin-top:8px"><button class="btn primary" data-act="paste-extract">Read details</button></div></details>
      <details class="muted small" style="margin:14px 0"><summary style="cursor:pointer">How do I get an email out of Gmail / Outlook?</summary>
        <ul style="line-height:1.7"><li><b>Gmail (web):</b> open the email → ⋮ menu → <i>Download message</i> gives you an .eml file to drop here.</li>
        <li><b>Outlook (desktop):</b> drag the email onto your desktop (makes a .msg) and then drop it here. Or use <i>File → Save As</i>.</li>
        <li><b>Outlook.com / Apple Mail:</b> <i>Save as / Download</i> gives you .eml. In Apple Mail you can drag the message straight to Finder.</li>
        <li><b>PDF attachments:</b> download and drop them in. PDFs attached inside a .eml are read automatically.</li>
        <li><b>Anything else:</b> select the text in the email and drag it onto this page, or paste it above.</li></ul></details>
      <div id="imports">${state.imports.map(importCardHTML).join('')}</div>`;
  }

  function findMatch(res) {
    const f = res.fields, e = res.extra;
    const norm = (s) => String(s || '').replace(/[\s-]/g, '').toUpperCase();
    if (f.reference) {
      const m = state.items.find((i) => norm(i.reference) && norm(i.reference) === norm(f.reference));
      if (m) return m;
    }
    for (const k of ['phoneNumber', 'vehicleReg', 'cardLast4']) {
      if (e[k]) {
        const m = state.items.find((i) => i.category === f.category && norm(i.extra?.[k]) === norm(e[k]));
        if (m) return m;
      }
    }
    if (f.provider) {
      const ms = state.items.filter((i) => i.status === 'active' && i.category === f.category && i.provider && i.provider.toLowerCase() === f.provider.toLowerCase());
      if (ms.length === 1) return ms[0];
    }
    return null;
  }

  function importValues(imp) {
    const base = imp.targetId ? itemById(imp.targetId) : null;
    const res = imp.result;
    const v = { ...(base || C.newItem()), extra: { ...(base?.extra || {}) } };
    for (const [k, val] of Object.entries(res.fields)) {
      if (val === '' || val == null) continue;
      if (base && k === 'name') continue; // keep the user's own name for an existing item
      if (base && k === 'category' && res.confidence.category !== 'high') continue;
      v[k] = val;
    }
    for (const [k, val] of Object.entries(res.extra)) if (val !== '' && val != null) v.extra[k] = val;
    // If we're renewing an existing item and the cost changed, keep the old one as "previous"
    if (base && res.fields.cost && base.cost && String(base.cost) !== String(res.fields.cost) && !res.fields.previousCost) v.previousCost = base.cost;
    return { v, base };
  }

  function importCardHTML(imp) {
    const { v, base } = importValues(imp);
    const conf = imp.result.confidence;
    const matchOptions = [['', '➕ Create a new item'], ...state.items.filter((i) => i.status === 'active').sort((a, b) => a.name.localeCompare(b.name)).map((i) => [i.id, `↻ Update: ${i.name}`])];
    const preview = imp.kind === 'image' && imp.imageUrl
      ? `<img src="${esc(imp.imageUrl)}" alt="${esc(imp.fileName)}">`
      : imp.text ? highlight(imp.text.slice(0, 40000), imp.result.found) : '<span class="muted">No text could be read from this file.</span>';
    const metaBits = [imp.meta?.subject && `<b>Subject:</b> ${esc(imp.meta.subject)}`, imp.meta?.from && `<b>From:</b> ${esc(imp.meta.from)}`, imp.meta?.date && `<b>Date:</b> ${esc(C.formatDate(imp.meta.date))}`].filter(Boolean);
    const found = Object.keys(conf).length;
    return `<div class="card import-card" data-import="${esc(imp.id)}">
      <div class="import-head"><span style="font-size:1.4rem">${imp.kind === 'email' ? '✉️' : imp.kind === 'pdf' ? '📕' : imp.kind === 'image' ? '🖼️' : '📄'}</span><div style="flex:1;min-width:0"><b>${esc(imp.fileName)}</b><div class="muted small">${found ? `Found ${found} detail${found === 1 ? '' : 's'}.` : 'Nothing recognised automatically, so fill in what you need.'} ${base ? `Looks like <b>${esc(base.name)}</b>, which you already have.` : ''}</div></div>
        <button class="btn ghost" data-act="import-discard" data-id="${esc(imp.id)}">Discard</button></div>
      <div class="review">
        <div><h3>The document</h3>${metaBits.length ? `<div class="small" style="margin-bottom:8px;line-height:1.6">${metaBits.join('<br>')}</div>` : ''}${imp.notes ? `<div class="banner info small" style="padding:8px 12px">${esc(imp.notes)}</div>` : ''}<div class="preview">${preview}</div>
          ${imp.result.dates.length ? `<details style="margin-top:10px" class="small"><summary style="cursor:pointer">All dates found (${imp.result.dates.length})</summary><ul>${imp.result.dates.slice(0, 25).map((d) => `<li><b>${esc(C.formatDate(d.iso))}</b> <span class="pill grey">${esc(d.label)}</span> <span class="muted">…${esc(d.context)}…</span> <button class="btn sm ghost" data-act="use-date" data-id="${esc(imp.id)}" data-iso="${d.iso}">Use as end date</button></li>`).join('')}</ul></details>` : ''}
        </div>
        <form data-import-form="${esc(imp.id)}">
          <div class="row" style="margin-bottom:10px"><label class="f" style="flex:1">Save to${field('targetId', '', imp.targetId || '', { options: matchOptions }).replace(/^<label class="f">|<\/label>$/g, '')}</label></div>
          <div class="legend" style="margin-bottom:10px">Filled in from the document: <span><i style="background:var(--green-bg);border-color:var(--green)"></i>confident</span><span><i style="background:var(--amber-bg);border-color:var(--amber)"></i>check this</span><span><i style="background:var(--red-bg);border-color:var(--red)"></i>a guess</span></div>
          ${itemFormHTML(v, conf, base)}
          <div class="modal-foot"><button class="btn primary" type="submit">${base ? 'Update item & attach file' : 'Save new item'}</button></div>
        </form>
      </div></div>`;
  }

  async function addImport({ file, text, meta, fileName, targetId, sharedId }) {
    toast('Reading…');
    let parsed;
    if (file) parsed = await P.readFile(file);
    else parsed = { kind: 'text', text, meta: meta || {} };
    const res = X.extract(parsed.text, { ...(parsed.meta || {}), filename: fileName || file?.name }, state.people);
    const imp = {
      id: C.uid(),
      file,
      fileName: fileName || file?.name || 'Pasted text',
      kind: parsed.kind,
      text: parsed.text,
      meta: parsed.meta || {},
      notes: parsed.notes || '',
      result: res,
      imageUrl: parsed.kind === 'image' ? URL.createObjectURL(file) : '',
      targetId: '',
      sharedId: sharedId || '',
    };
    imp.targetId = targetId ?? (findMatch(res)?.id || '');
    state.imports.unshift(imp);
    return imp;
  }

  async function handleIncoming(dt, targetId) {
    const files = [...(dt.files || [])];
    const jobs = [];
    if (files.length) for (const f of files) jobs.push(addImport({ file: f, targetId: targetId || undefined }));
    else {
      const html = dt.getData && dt.getData('text/html');
      const text = (dt.getData && dt.getData('text/plain')) || (html ? P.htmlToText(html) : '');
      if (!text.trim()) return;
      jobs.push(addImport({ text, fileName: 'Dropped text', targetId: targetId || undefined }));
    }
    await Promise.all(jobs);
    if (route().name !== 'inbox') location.hash = '#/inbox'; else render();
    toast(jobs.length > 1 ? `Read ${jobs.length} items, so check and save each one` : 'Check the details and save');
  }

  // Once every import from a share is saved or discarded, forget the share.
  async function releaseShare(imp) {
    if (imp.sharedId && !state.imports.some((x) => x.sharedId === imp.sharedId)) await DB.del('shared', imp.sharedId).catch(() => {});
  }

  async function saveImport(form) {
    const imp = state.imports.find((x) => x.id === form.dataset.importForm);
    if (!imp) return;
    const vals = readItemForm(form);
    const targetId = vals.targetId; delete vals.targetId;
    const base = targetId ? itemById(targetId) : null;
    const item = base ? { ...base } : C.newItem();
    const before = base ? { endDate: base.endDate, cost: base.cost } : null;
    Object.assign(item, vals, { extra: vals.extra });
    if (!item.name) item.name = C.category(item.category).label;
    // Keep the original document (or the pasted text) with the item
    const blob = imp.file || new Blob([imp.text], { type: 'text/plain' });
    const rec = { id: C.uid(), name: imp.file ? imp.fileName : `${imp.meta.subject || 'Pasted text'}.txt`, type: blob.type || 'application/octet-stream', size: blob.size, added: C.today(), blob, text: imp.text, itemId: item.id };
    await saveFile(rec);
    item.fileIds = [...(item.fileIds || []), rec.id];
    item.history = [...(item.history || [])];
    if (base) {
      const changes = [];
      if (before.endDate !== item.endDate && item.endDate) changes.push(`date ${before.endDate ? C.formatDate(before.endDate) : 'none'} → ${C.formatDate(item.endDate)}`);
      if (String(before.cost) !== String(item.cost) && item.cost) changes.push(`cost ${before.cost ? money(before.cost) : 'none'} → ${money(item.cost)}`);
      item.history.push({ date: C.today(), text: `Updated from “${rec.name}”${changes.length ? `: ${changes.join(', ')}` : ''}` });
    } else item.history.push({ date: C.today(), text: `Created from “${rec.name}”` });
    await saveItem(item);
    state.imports = state.imports.filter((x) => x.id !== imp.id);
    await releaseShare(imp);
    if (imp.imageUrl) URL.revokeObjectURL(imp.imageUrl);
    toast(base ? 'Updated' : 'Saved');
    if (state.imports.length) render(); else location.hash = `#/item/${item.id}`;
  }

  /* ================= PEOPLE ================= */
  function viewPeople() {
    return `<div class="page-head"><div><h1>People</h1><div class="muted">Who things belong to: phones, cars, cards, policies.</div></div><button class="btn primary" data-act="person-edit">＋ Add person</button></div>
      <div class="card">${state.people.length ? state.people.map((p) => {
        const its = state.items.filter((i) => i.ownerId === p.id && i.status === 'active');
        return `<div class="person"><div class="avatar" style="background:${esc(p.color)}">${esc(p.name.slice(0, 1))}</div>
          <div style="flex:1;min-width:0"><b>${esc(p.name)}</b><div class="muted small">${[p.phone, `${its.length} item${its.length === 1 ? '' : 's'}`, its.length ? `${money(its.reduce((s, i) => s + C.monthlyCost(i), 0).toFixed(2))}/mo` : ''].filter(Boolean).map(esc).join(' · ')}</div>
          ${its.length ? `<div class="row small" style="margin-top:4px">${its.slice(0, 8).map((i) => `<a class="chip" href="#/item/${esc(i.id)}" style="text-decoration:none;color:inherit">${C.category(i.category).icon} ${esc(i.name)}</a>`).join('')}</div>` : ''}</div>
          <button class="btn sm" data-act="person-edit" data-id="${esc(p.id)}">Edit</button></div>`;
      }).join('') : '<div class="empty"><div class="big">👪</div>Add the people in your household. Then, when you drop in a phone bill, it can tell whose phone it is (it matches names and mobile numbers).</div>'}</div>`;
  }

  function openPersonEditor(p) {
    const isNew = !p;
    p = p || { id: C.uid(), name: '', phone: '', color: PERSON_COLOURS[state.people.length % PERSON_COLOURS.length], notes: '' };
    openModal(`<form id="person-form"><div class="modal-head"><h2 style="margin:0">${isNew ? 'Add person' : 'Edit person'}</h2><button type="button" class="btn ghost" data-act="close">✕</button></div>
      <div class="form-grid">${field('name', 'Name', p.name, { required: true, wide: true, placeholder: 'Full name helps matching documents' })}
      ${field('phone', 'Mobile number', p.phone, { placeholder: 'Used to match phone bills' })}
      <label class="f">Colour<input type="color" name="color" value="${esc(p.color)}" style="height:40px;padding:2px"></label></div>
      <div class="modal-foot">${isNew ? '' : '<button type="button" class="btn danger" data-act="person-delete" data-id="' + esc(p.id) + '" style="margin-right:auto">Delete</button>'}<button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary">Save</button></div></form>`, true);
    $('#person-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      await savePerson({ ...p, name: fd.get('name').trim(), phone: fd.get('phone').trim(), color: fd.get('color') });
      state.people.sort((a, b) => a.name.localeCompare(b.name));
      closeModal();
      render();
    });
  }

  /* ================= SETTINGS ================= */
  function viewSettings() {
    const s = state.settings;
    const notifState = !('Notification' in window) ? 'unsupported' : Notification.permission;
    return `<div class="page-head"><div><h1>Settings</h1></div></div>${pwaBanners()}
      <div class="grid grid-2">
        <div class="card"><h2>🔔 Reminders</h2>
          <form id="settings-form" class="stack">
            ${field('defaultOffsets', 'Default reminders (days before a renewal / end date)', s.defaultOffsets.join(', '), { placeholder: '30, 7, 1' })}
            ${field('currency', 'Currency symbol', s.currency)}
            ${field('theme', 'Appearance', s.theme, { options: [['system', 'Match my device'], ['light', 'Light'], ['dark', 'Dark']] })}
            <div><button class="btn primary">Save settings</button></div>
          </form>
          <hr style="border:0;border-top:1px solid var(--border);margin:18px 0">
          <h3>Pop-up notifications</h3>
          <p class="muted small">${served ? 'On Android with the app installed, Personal Admin checks for due reminders in the background about twice a day (Android decides exactly when), and every time you open it. For alerts at an exact time, also <b>export to your calendar</b>.' : "While this page is open (a pinned tab works well), you'll get a desktop notification when a reminder falls due. To get alerts on your phone even when this is closed, <b>export to your calendar</b>."}</p>
          <div class="row">${notifState === 'unsupported' ? '<span class="muted small">Not supported in this browser.</span>' : s.notify && notifState === 'granted' ? '<span class="pill green">On</span><button class="btn sm" data-act="notify-off">Turn off</button><button class="btn sm ghost" data-act="notify-test">Send a test</button>' : '<button class="btn" data-act="notify-on">Turn on notifications</button>'}
          <button class="btn" data-act="export-ics">📅 Export reminders to calendar (.ics)</button></div>
        </div>
        <div class="card"><h2>💾 Backup & restore</h2>
          <p class="muted small">Your data is stored only in this browser on this device. Clearing browsing data, or using a different browser, means starting empty. A backup file contains everything, documents included. Keep it somewhere safe (it holds personal details).</p>
          <div class="row"><button class="btn primary" data-act="export-json">${isTouch ? '📤 Save backup (Drive, email…)' : '⬇︎ Download backup'}</button><label class="btn">⬆︎ Restore from backup<input type="file" accept=".json,application/json" hidden data-act="import-json"></label><button class="btn" data-act="export-csv">⬇︎ Spreadsheet (CSV)</button></div>
          <p class="small muted">${s.lastBackup ? `Last backup: ${esc(C.formatDate(s.lastBackup))}` : 'No backup made yet.'}</p>
          <div id="storage-info" class="small muted"></div>
        </div>
        <div class="card"><h2>🔒 Privacy</h2>
          <ul class="small" style="line-height:1.7;padding-left:18px">
            <li>No accounts, no servers, no tracking. This page is <b>blocked from making any network connection</b> by its own security policy, so documents can't leave your device even by accident.${served ? ' The only thing ever downloaded is the app itself, when there is an update.' : ''}</li>
            <li>Documents are read on your computer: emails, PDFs and Word files are all parsed locally.</li>
            <li>Storage: your browser's private database for this file, on this device.</li>
            <li>Tip: don't store passwords or full card numbers here. Use a password manager for those.</li></ul>
        </div>
        <div class="card"><h2>⚠️ Danger zone</h2><p class="muted small">Permanently delete everything stored by this app in this browser.</p><button class="btn danger" data-act="wipe">Delete all my data</button></div>
      </div>`;
  }

  async function storageInfo() {
    const el = $('#storage-info');
    if (!el || !navigator.storage) return;
    try {
      const [est, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted ? navigator.storage.persisted() : false]);
      el.textContent = `Using ${(est.usage / 1048576).toFixed(1)} MB. ${persisted ? 'Storage is marked as persistent, so the browser won’t clear it automatically.' : 'Storage is not yet marked persistent. It will be requested when you save something.'}`;
    } catch { /* ignore */ }
  }

  /* ---------- backup ---------- */
  const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); });
  function dataURLToBlob(url) {
    const [head, data] = url.split(',');
    const type = (/data:([^;]+)/.exec(head) || [])[1] || 'application/octet-stream';
    const bin = atob(data);
    return new Blob([Uint8Array.from(bin, (c) => c.charCodeAt(0))], { type });
  }

  async function exportJSON() {
    const files = [];
    for (const f of state.files.values()) files.push({ ...f, blob: undefined, data: f.blob ? await blobToDataURL(f.blob) : '' });
    const { notified, ...settings } = state.settings;
    const data = { app: 'personal-admin', version: 1, exported: new Date().toISOString(), items: state.items, people: state.people, settings, files };
    const name = `personal-admin-backup-${C.today()}.json`;
    const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
    let shared = false;
    if (isTouch && navigator.canShare) {
      const file = new File([blob], name, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        try { await navigator.share({ files: [file], title: 'Personal Admin backup' }); shared = true; }
        catch (e) { if (e.name === 'AbortError') return; }
      }
    }
    if (!shared) download(name, blob);
    state.settings.lastBackup = C.today();
    await saveSettings();
    toast(shared ? 'Backup shared' : 'Backup downloaded');
    render();
  }

  async function importJSON(file) {
    let data;
    try { data = JSON.parse(await file.text()); } catch { return toast("That file isn't a valid backup"); }
    if (data.app !== 'personal-admin') return toast("That file isn't a Personal Admin backup");
    const replace = confirm(`Restore ${data.items.length} items, ${data.people.length} people and ${data.files.length} documents?\n\nOK = replace everything currently here\nCancel = merge into what's here`);
    if (replace) for (const s of DB.STORES) await DB.clear(s);
    for (const p of data.people) await DB.put('people', p);
    for (const i of data.items) await DB.put('items', i);
    for (const f of data.files) { const { data: d, ...rest } = f; await DB.put('files', { ...rest, blob: d ? dataURLToBlob(d) : null }); }
    if (data.settings) for (const [k, v] of Object.entries(data.settings)) if (k in DEFAULT_SETTINGS) await DB.setSetting(k, v);
    await load();
    toast('Restored');
    location.hash = '#/dashboard';
    render();
  }

  function exportCSV() {
    const cols = ['name', 'category', 'owner', 'provider', 'reference', 'startDate', 'endDate', 'cost', 'frequency', 'monthly', 'paymentMethod', 'autoRenew', 'contactPhone', 'status', 'details', 'notes'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = state.items.map((i) => [i.name, C.category(i.category).label, person(i.ownerId)?.name || 'Household', i.provider, i.reference, i.startDate, i.endDate, i.cost, i.frequency, C.monthlyCost(i).toFixed(2), i.paymentMethod, i.autoRenew, i.contactPhone, i.status, Object.entries(i.extra || {}).map(([k, v]) => `${C.FIELDS[k]?.label || k}: ${v}`).join('; '), i.notes].map(q).join(','));
    download(`personal-admin-${C.today()}.csv`, new Blob(['﻿' + [cols.join(','), ...rows].join('\r\n')], { type: 'text/csv' }));
  }

  function exportICS(items) {
    const ev = C.reminderEvents(items, state.settings, state.people);
    // Also add the key dates themselves
    for (const it of items.filter((i) => i.status === 'active' && i.endDate && i.endDate >= C.today())) {
      ev.push({ uid: `${it.id}-end-${it.endDate}`, date: it.endDate, summary: `${C.category(it.category).icon} ${it.name}: ${C.category(it.category).endLabel}`, description: [it.provider, it.reference && `Ref: ${it.reference}`, it.cost && `Cost: ${money(it.cost)}`].filter(Boolean).join('\n') });
    }
    if (!ev.length) return toast('No upcoming dates to export yet');
    download(items.length === 1 ? `${items[0].name.replace(/[^\w]+/g, '-')}.ics` : `personal-admin-reminders-${C.today()}.ics`, new Blob([C.buildICS(ev)], { type: 'text/calendar' }));
    toast(`Exported ${ev.length} calendar entries. Open the file to add them.`);
  }

  /* ---------- notifications ---------- */
  // Android only allows notifications through a service worker; desktop file:// has none.
  async function showNotification(title, opts) {
    const reg = pwa.reg || (navigator.serviceWorker && location.protocol.startsWith('http') ? await navigator.serviceWorker.getRegistration() : null);
    if (reg) return reg.showNotification(title, { icon: 'icon-192.png', badge: 'icon-192.png', ...opts });
    const n = new Notification(title, opts);
    n.onclick = () => { window.focus(); if (opts.data?.itemId) location.hash = `#/item/${opts.data.itemId}`; };
  }
  async function checkNotifications() {
    if (!state.settings.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
    const { notifications, keys } = C.dueNotifications(state.items, state.settings, state.settings.notified);
    for (const n of notifications) await showNotification(n.title, { body: n.body, tag: n.tag, data: { itemId: n.itemId } });
    if (keys.length) {
      state.settings.notified = [...state.settings.notified, ...keys].slice(-500);
      await DB.setSetting('notified', state.settings.notified);
    }
  }

  /* ---------- example data ---------- */
  async function loadExample() {
    const t = C.today();
    const alex = { id: C.uid(), name: 'Alex Morgan', phone: '07700 900111', color: PERSON_COLOURS[0], example: true };
    const sam = { id: C.uid(), name: 'Sam Morgan', phone: '07700 900222', color: PERSON_COLOURS[1], example: true };
    await savePerson(alex); await savePerson(sam);
    const ex = [
      { name: 'Car insurance (AB12 CDE)', category: 'car_insurance', ownerId: alex.id, provider: 'Admiral', reference: 'P12345678', startDate: C.addMonths(C.addDays(t, 20), -12), endDate: C.addDays(t, 20), cost: 468.2, previousCost: 412.5, frequency: 'annually', autoRenew: 'yes', paymentMethod: 'Direct debit', extra: { vehicleReg: 'AB12 CDE', makeModel: 'Ford Focus', coverLevel: 'Comprehensive', excess: 350, noClaimsYears: 5 } },
      { name: "Sam's mobile", category: 'mobile', ownerId: sam.id, provider: 'EE', reference: '1234567890', endDate: C.addDays(t, 75), cost: 38, frequency: 'monthly', noticeDays: 30, extra: { phoneNumber: '07700 900222', handset: 'iPhone 15 Pro', allowance: '100GB' } },
      { name: "Alex's mobile", category: 'mobile', ownerId: alex.id, provider: 'giffgaff', endDate: '', cost: 10, frequency: 'monthly', extra: { phoneNumber: '07700 900111', allowance: '35GB SIM-only' } },
      { name: 'TV Licence', category: 'tv_licence', provider: 'TV Licensing', reference: '1234567890', endDate: C.addMonths(t, 4), cost: 14.54, frequency: 'monthly', paymentMethod: 'Direct debit' },
      { name: 'Council tax', category: 'council_tax', provider: 'Example Borough Council', reference: '98765432', endDate: `${Number(t.slice(0, 4)) + (t.slice(5) > '03-31' ? 1 : 0)}-03-31`, cost: 210.4, frequency: 'ten_monthly', extra: { band: 'D' } },
      { name: 'Barclaycard', category: 'credit_card', ownerId: alex.id, provider: 'Barclaycard', paymentDay: 21, extra: { cardLast4: '4321', apr: 24.9, promoRate: 0, promoEndDate: C.addDays(t, 50), creditLimit: 5000, balance: 1234.56 } },
      { name: 'Home insurance', category: 'home_insurance', provider: 'Aviva', endDate: C.addMonths(t, 7), cost: 24.5, frequency: 'monthly', extra: { coverLevel: 'Buildings & contents', excess: 250 } },
      { name: 'Broadband', category: 'broadband', provider: 'Virgin Media', endDate: C.addDays(t, -3), cost: 45, frequency: 'monthly', noticeDays: 30, extra: { speed: '500Mbps' } },
      { name: 'MOT – Ford Focus', category: 'vehicle_tax', ownerId: alex.id, endDate: C.addMonths(t, 2), extra: { vehicleReg: 'AB12 CDE' } },
      { name: 'Netflix', category: 'tv', provider: 'Netflix', cost: 12.99, frequency: 'monthly' },
    ];
    for (const e of ex) await saveItem(C.newItem({ ...e, example: true }));
    toast('Example data loaded');
    render();
  }

  /* ================= EVENTS ================= */
  const actions = {
    close: closeModal,
    'modal-back': (el, ev) => { if (ev.target === el) closeModal(); },
    'new-item': () => openItemEditor(C.newItem()),
    edit: (el) => openItemEditor(itemById(el.dataset.id)),
    filter: (el) => { state.filters[el.dataset.k] = el.dataset.v; render(); },
    cal: (el) => {
      const d = Number(el.dataset.d);
      state.calMonth = d === 0 ? C.today().slice(0, 7) : C.addMonths(state.calMonth + '-01', d).slice(0, 7);
      render();
    },
    copy: (el) => { navigator.clipboard?.writeText(el.dataset.text).then(() => toast('Copied')); },
    'rem-done': async (el) => {
      const it = itemById(el.dataset.item);
      it.dismissed = [...new Set([...(it.dismissed || []), ...el.dataset.key.split('|')])];
      await saveItem(it); render();
    },
    'rem-toggle': async (el) => {
      const it = itemById(el.dataset.item);
      const set = new Set(it.dismissed || []);
      if (el.checked) set.add(el.dataset.key); else set.delete(el.dataset.key);
      it.dismissed = [...set];
      await saveItem(it); render();
    },
    'rem-snooze': async (el) => {
      const it = itemById(el.dataset.item);
      const keys = el.dataset.key.split('|');
      const r = C.itemReminders(it, state.settings).find((x) => x.key === keys[keys.length - 1]);
      it.dismissed = [...new Set([...(it.dismissed || []), ...keys])];
      it.reminders = [...(it.reminders || []), { id: C.uid(), date: C.addDays(C.today(), 7), note: `Snoozed: ${r ? r.title : 'reminder'}` }];
      await saveItem(it); toast('Snoozed for 7 days'); render();
    },
    'rem-delete': async (el) => {
      const it = itemById(el.dataset.item);
      it.reminders = (it.reminders || []).filter((r) => `custom-${r.id}` !== el.dataset.key);
      await saveItem(it); render();
    },
    'add-reminder': (el) => {
      const it = itemById(el.dataset.id);
      openModal(`<form id="rem-form"><div class="modal-head"><h2 style="margin:0">Add a reminder</h2><button type="button" class="btn ghost" data-act="close">✕</button></div>
        <div class="form-grid">${field('date', 'Date', C.addDays(C.today(), 7), { type: 'date', required: true })}${field('note', 'What for?', '', { placeholder: 'e.g. Get quotes from comparison sites', wide: true })}</div>
        <div class="row small" style="margin-top:10px">Quick: ${[[7, '1 week'], [30, '1 month'], [90, '3 months']].map(([d, l]) => `<button type="button" class="btn sm" data-act="rem-quick" data-d="${d}">${l}</button>`).join('')}${it.endDate ? `<button type="button" class="btn sm" data-act="rem-quick-end" data-end="${it.endDate}">4 weeks before ${esc(C.category(it.category).endLabel.toLowerCase())}</button>` : ''}</div>
        <div class="modal-foot"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary">Add</button></div></form>`, true);
      $('#rem-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        it.reminders = [...(it.reminders || []), { id: C.uid(), date: fd.get('date'), note: fd.get('note').trim() }];
        await saveItem(it); closeModal(); toast('Reminder added'); render();
      });
    },
    'rem-quick': (el) => { $('#rem-form [name=date]').value = C.addDays(C.today(), Number(el.dataset.d)); },
    'rem-quick-end': (el) => { $('#rem-form [name=date]').value = C.addDays(el.dataset.end, -28); },
    renew: (el) => {
      const it = itemById(el.dataset.id);
      openModal(`<form id="renew-form"><div class="modal-head"><h2 style="margin:0">🔄 Renewed: ${esc(it.name)}</h2><button type="button" class="btn ghost" data-act="close">✕</button></div>
        <p class="muted small">Moves the dates on, keeps this year's price as "previous" so you can compare next time, and logs it in the history. If you have the new renewal document, you can drop it on the item instead.</p>
        <div class="form-grid">${field('endDate', `New ${C.category(it.category).endLabel.toLowerCase()}`, C.nextTermEnd(it), { type: 'date', required: true })}${field('cost', `New cost (${state.settings.currency})`, it.cost, { type: 'money' })}${field('frequency', 'How often', it.frequency, { options: C.FREQUENCIES.map((f) => [f.id, f.label]) })}${field('note', 'Note', '', { wide: true, placeholder: 'e.g. Haggled down from £520' })}</div>
        <div class="modal-foot"><button type="button" class="btn" data-act="close">Cancel</button><button class="btn primary">Save renewal</button></div></form>`, true);
      $('#renew-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        const newEnd = fd.get('endDate'), newCost = fd.get('cost');
        const text = [`Renewed until ${C.formatDate(newEnd)}`, String(newCost) !== String(it.cost) && it.cost ? `cost ${money(it.cost)} → ${money(newCost)}` : newCost ? `cost ${money(newCost)}` : '', fd.get('note').trim()].filter(Boolean).join(' · ');
        if (it.cost) it.previousCost = it.cost;
        it.startDate = it.endDate || it.startDate;
        it.endDate = newEnd; it.cost = newCost; it.frequency = fd.get('frequency');
        it.history = [...(it.history || []), { date: C.today(), text }];
        await saveItem(it); closeModal(); toast('Renewal saved'); render();
      });
    },
    archive: async (el) => { const it = itemById(el.dataset.id); it.status = 'archived'; await saveItem(it); toast('Archived'); render(); },
    unarchive: async (el) => { const it = itemById(el.dataset.id); it.status = 'active'; await saveItem(it); render(); },
    delete: async (el) => {
      const it = itemById(el.dataset.id);
      if (!confirm(`Delete “${it.name}” and its ${(it.fileIds || []).length} document(s)? This can't be undone.\n\nTip: "Archive" keeps the record but hides it.`)) return;
      for (const f of it.fileIds || []) { await DB.del('files', f); state.files.delete(f); }
      await DB.del('items', it.id);
      state.items = state.items.filter((x) => x.id !== it.id);
      toast('Deleted'); location.hash = '#/items';
    },
    'item-ics': (el) => exportICS([itemById(el.dataset.id)]),
    'file-open': (el) => {
      const f = state.files.get(el.dataset.id);
      if (!f?.blob) return toast('File data missing');
      const url = URL.createObjectURL(f.blob);
      if (/pdf|image|text\/plain/.test(f.type)) { const w = window.open(url, '_blank'); if (!w) download(f.name, f.blob); }
      else download(f.name, f.blob);
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    },
    'file-text': (el) => {
      const f = state.files.get(el.dataset.id);
      openModal(`<div class="modal-head"><h2 style="margin:0">${esc(f.name)}</h2><button class="btn ghost" data-act="close">✕</button></div><div class="preview" style="max-height:70vh">${esc(f.text)}</div>`);
    },
    'file-remove': async (el) => {
      if (!confirm('Remove this document?')) return;
      const it = itemById(el.dataset.item);
      it.fileIds = (it.fileIds || []).filter((x) => x !== el.dataset.id);
      await DB.del('files', el.dataset.id); state.files.delete(el.dataset.id);
      await saveItem(it); render();
    },
    'paste-extract': async () => {
      const text = $('#paste-text').value;
      if (!text.trim()) return toast('Paste some text first');
      state.pasteDraft = '';
      await addImport({ text, fileName: 'Pasted text' });
      render();
    },
    'import-discard': async (el) => {
      const imp = state.imports.find((x) => x.id === el.dataset.id);
      state.imports = state.imports.filter((x) => x.id !== el.dataset.id);
      if (imp) await releaseShare(imp);
      render();
    },
    'use-date': (el) => {
      const form = $(`[data-import-form="${el.dataset.id}"]`);
      const inp = $('[name=endDate]', form);
      inp.value = el.dataset.iso;
      inp.closest('label').className = 'f hi-high';
      inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
    },
    'person-edit': (el) => openPersonEditor(el.dataset.id ? person(el.dataset.id) : null),
    'person-delete': async (el) => {
      const p = person(el.dataset.id);
      if (!confirm(`Delete ${p.name}? Their items will become "Household".`)) return;
      for (const it of state.items.filter((i) => i.ownerId === p.id)) { it.ownerId = ''; await saveItem(it); }
      await DB.del('people', p.id);
      state.people = state.people.filter((x) => x.id !== p.id);
      closeModal(); render();
    },
    'export-json': exportJSON,
    'export-csv': exportCSV,
    'export-ics': () => exportICS(state.items),
    'notify-on': async () => {
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') return toast('Notifications were blocked by the browser');
      state.settings.notify = true; await saveSettings(); toast('Notifications on'); render(); checkNotifications();
      registerBackgroundCheck();
    },
    'notify-off': async () => { state.settings.notify = false; await saveSettings(); render(); },
    'notify-test': () => showNotification('Personal Admin', { body: 'Notifications are working 👍' }),
    'install-app': async () => {
      if (!pwa.installPrompt) return;
      pwa.installPrompt.prompt();
      await pwa.installPrompt.userChoice.catch(() => {});
      pwa.installPrompt = null; render();
    },
    'apply-update': () => { pwa.updating = true; pwa.reg?.waiting?.postMessage('skip-waiting'); },
    'load-example': loadExample,
    'clear-example': async () => {
      for (const it of state.items.filter((i) => i.example)) await DB.del('items', it.id);
      for (const p of state.people.filter((x) => x.example)) await DB.del('people', p.id);
      await load(); toast('Example data removed'); render();
    },
    wipe: async () => {
      if (prompt('Type DELETE to permanently remove all your data from this browser.') !== 'DELETE') return;
      for (const s of [...DB.STORES, 'shared']) await DB.clear(s);
      state.imports = [];
      await load(); toast('All data deleted'); location.hash = '#/dashboard'; render();
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT' && el.type === 'file') return;
    if (el.tagName === 'INPUT' && el.type === 'checkbox') return; // handled on change
    const fn = actions[el.dataset.act];
    if (!fn) return;
    if (el.tagName === 'A' || el.tagName === 'BUTTON' && el.type !== 'submit') ev.preventDefault();
    if (el.dataset.act === 'modal-back' && ev.target !== el) return;
    fn(el, ev);
  });

  document.addEventListener('change', async (ev) => {
    const el = ev.target;
    if (el.matches('select[name=category]')) return onCategoryChange(el);
    if (el.matches('[data-act=rem-toggle]')) return actions['rem-toggle'](el);
    if (el.matches('[data-act=pick-files]') && el.files.length) {
      const target = el.dataset.item;
      await handleIncoming({ files: el.files, getData: () => '' }, target);
      return;
    }
    if (el.matches('[data-act=import-json]') && el.files[0]) return importJSON(el.files[0]);
    if (el.matches('[data-filter]')) { state.filters[el.dataset.filter] = el.value; render(); return; }
    if (el.matches('[data-import-form] select[name=targetId]')) {
      const form = el.closest('form');
      const imp = state.imports.find((x) => x.id === form.dataset.importForm);
      imp.targetId = el.value;
      const card = form.closest('[data-import]');
      card.outerHTML = importCardHTML(imp);
    }
  });

  document.addEventListener('input', (ev) => {
    if (ev.target.id === 'q') {
      state.filters.q = ev.target.value;
      const pos = ev.target.selectionStart;
      render();
      const q = $('#q'); q.focus(); q.setSelectionRange(pos, pos);
    }
    if (ev.target.id === 'paste-text') state.pasteDraft = ev.target.value;
  });

  document.addEventListener('submit', (ev) => {
    const f = ev.target;
    if (f.matches('[data-import-form]')) { ev.preventDefault(); saveImport(f); }
    if (f.id === 'settings-form') {
      ev.preventDefault();
      const fd = new FormData(f);
      const offs = C.parseOffsets(fd.get('defaultOffsets'));
      state.settings.defaultOffsets = offs.length ? offs : [30, 7, 1];
      state.settings.currency = fd.get('currency').trim() || '£';
      state.settings.theme = fd.get('theme');
      applyTheme();
      saveSettings().then(() => { toast('Settings saved'); render(); });
    }
  });

  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && $('#modal-root').innerHTML) closeModal(); });

  // Paste files or text anywhere (outside form fields) to import them
  document.addEventListener('paste', (ev) => {
    if (ev.target.closest('input, textarea, [contenteditable]')) return;
    const dt = ev.clipboardData;
    if (!dt) return;
    if (dt.files.length || (dt.getData('text/plain') || '').length > 40) {
      ev.preventDefault();
      const r = route();
      handleIncoming(dt, r.name === 'item' ? r.id : '');
    }
  });

  /* ---------- drag & drop anywhere ---------- */
  let dragDepth = 0;
  let internalDrag = false;
  document.addEventListener('dragstart', () => { internalDrag = true; });
  document.addEventListener('dragend', () => { internalDrag = false; });
  const overlay = () => $('#drop-overlay');
  const isExternal = (ev) => !internalDrag && [...(ev.dataTransfer?.types || [])].some((t) => t === 'Files' || t === 'text/plain' || t === 'text/html');
  window.addEventListener('dragenter', (ev) => {
    if (!isExternal(ev)) return;
    ev.preventDefault();
    dragDepth++;
    overlay().hidden = false;
    const r = route();
    overlay().firstElementChild.textContent = r.name === 'item' && itemById(r.id) ? `📎 Drop to attach to “${itemById(r.id).name}”` : '📄 Drop to read the details';
  });
  window.addEventListener('dragover', (ev) => { if (isExternal(ev)) ev.preventDefault(); });
  window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) overlay().hidden = true; });
  window.addEventListener('drop', (ev) => {
    if (!isExternal(ev)) return;
    ev.preventDefault();
    dragDepth = 0;
    overlay().hidden = true;
    const r = route();
    handleIncoming(ev.dataTransfer, r.name === 'item' ? r.id : '');
  });

  /* ---------- installed phone app (PWA) ---------- */
  const pwa = { reg: null, installPrompt: null, updateReady: false, updating: false };
  const served = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';

  function pwaBanners() {
    let out = '';
    if (pwa.updateReady) out += '<div class="banner info"><span>✨</span><span style="flex:1">A new version of Personal Admin is ready.</span><button class="btn sm primary" data-act="apply-update">Update now</button></div>';
    if (pwa.installPrompt) out += '<div class="banner info"><span>📲</span><span style="flex:1">Install Personal Admin on this device. It opens like a normal app, works offline and appears in your Share menu.</span><button class="btn sm primary" data-act="install-app">Install</button></div>';
    return out;
  }

  async function registerBackgroundCheck() {
    try {
      const reg = pwa.reg || (await navigator.serviceWorker?.ready);
      if (!reg || !('periodicSync' in reg)) return;
      const perm = await navigator.permissions.query({ name: 'periodic-background-sync' }).catch(() => null);
      if (perm && perm.state !== 'granted') return;
      await reg.periodicSync.register('reminders', { minInterval: 12 * 60 * 60 * 1000 });
    } catch { /* not supported: reminders still fire whenever the app is opened */ }
  }

  // Files and text shared from other apps arrive via the service worker and wait in the 'shared'
  // store until saved or discarded, so sharing another thing (which reloads the app) loses nothing.
  let consuming = false;
  const loadedShares = new Set();
  async function consumeShared() {
    if (consuming) return;
    consuming = true;
    try {
      const rows = (await DB.getAll('shared')).filter((r) => !loadedShares.has(r.id));
      if (!rows.length) return;
      for (const row of rows.sort((a, b) => a.at - b.at)) {
        loadedShares.add(row.id);
        for (const f of row.files || []) {
          const file = f.blob instanceof File ? f.blob : new File([f.blob], f.name, { type: f.type });
          await addImport({ file, sharedId: row.id });
        }
        if (row.text && !(row.files || []).length) await addImport({ text: row.text, fileName: 'Shared text', sharedId: row.id });
        if (!row.text && !(row.files || []).length) await DB.del('shared', row.id);
      }
      if (route().name !== 'inbox') location.hash = '#/inbox'; else render();
      toast('Got it. Check the details and save');
    } catch (e) {
      toast(`Couldn't read the shared item (${e.message})`);
    } finally { consuming = false; }
  }

  if (served && 'serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').then((reg) => {
      pwa.reg = reg;
      const watch = (w) => w && w.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) { pwa.updateReady = true; render(); }
      });
      if (reg.waiting && navigator.serviceWorker.controller) { pwa.updateReady = true; render(); }
      watch(reg.installing);
      reg.addEventListener('updatefound', () => watch(reg.installing));
      if (state.settings.notify) registerBackgroundCheck();
    }).catch(() => {});
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (pwa.updating) location.reload(); });
  }
  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); pwa.installPrompt = e; render(); });
  window.addEventListener('appinstalled', () => { pwa.installPrompt = null; toast('Installed. Find Personal Admin on your home screen'); render(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') { consumeShared(); checkNotifications(); } });

  /* ---------- start ---------- */
  window.addEventListener('hashchange', () => { render(); window.scrollTo(0, 0); if (route().name === 'settings') storageInfo(); });
  load()
    .then(() => { render(); if (route().name === 'settings') storageInfo(); consumeShared(); checkNotifications(); setInterval(checkNotifications, 30 * 60 * 1000); })
    .catch((e) => {
      $('#view').innerHTML = `<div class="card"><h2>Storage isn't available</h2><p>This browser blocked local storage for this page (${esc(e && e.message)}). Try opening the file in Chrome, Edge or Firefox, and make sure you're not in a private window.</p></div>`;
    });

  // test hook
  window.__PA = { state, render, handleIncoming, addImport, consumeShared, pwa };
})();
