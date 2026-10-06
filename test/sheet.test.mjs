import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/core.js';
import '../src/extract.js';
import '../src/sheet.js';

const { PASheet: S } = globalThis;
const people = [{ id: 'alex', name: 'Alex Morgan' }, { id: 'sam', name: 'Sam Morgan' }];

// Exactly the headings used in the real sheet, as Google Sheets copies them (tab-separated)
const pasted = [
  'Item\tProvider\tFrequency\tRenewal Date\tEnd Date\tPayment  Day of each Month\tMonthly Amount\tAnnual Amount',
  'Car Insurance\tAdmiral\tAnnual\t14/03/2027\t\t\t\t£468.20',
  "Sam's Mobile\tEE\tMonthly\t\t02/11/2026\t15th\t£38.00\t£456.00",
  'TV Licence\tTV Licensing\tMonthly\t31/01/2027\t\t1\t£14.54\t',
  'Council Tax\tBarnet Council\t10 monthly\t\t31/03/2027\t1st\t£210.40\t£2,104.00',
  'Netflix\tNetflix\tMonthly\t\t\t22\t12.99\t',
  'Home insurance\tAviva\tMonthly\t1 Dec 2026\t30 Nov 2026\t5\t£24.50\t£294',
  '\t\t\t\t\t\t\t',
  'Total\t\t\t\t\t\t£289.94\t',
].join('\n');

test('parses pasted cells and maps the headings', () => {
  const rows = S.parseDelimited(pasted);
  assert.equal(rows.length, 8); // blank row dropped
  assert.deepEqual(S.guessMapping(rows[0]), ['name', 'provider', 'frequency', 'endDate', 'endDate2', 'paymentDay', 'monthlyAmount', 'annualAmount']);
});

test('builds items with the right types, dates and costs', () => {
  const rows = S.parseDelimited(pasted);
  const res = S.buildItems(rows, S.guessMapping(rows[0]), people, [{ id: 'x', name: 'Netflix', provider: 'Netflix' }]);
  const by = Object.fromEntries(res.map((r) => [r.item.name, r]));
  assert.equal(res.length, 6); // Total row skipped

  const car = by['Car Insurance'].item;
  assert.equal(car.category, 'car_insurance');
  assert.equal(car.frequency, 'annually');
  assert.equal(car.cost, 468.2);
  assert.equal(car.endDate, '2027-03-14');

  const mob = by["Sam's Mobile"].item;
  assert.equal(mob.category, 'mobile');
  assert.equal(mob.ownerId, 'sam');
  assert.equal(mob.endDate, '2026-11-02'); // only an end date: it becomes the key date
  assert.equal(mob.paymentDay, '15');
  assert.equal(mob.cost, 38);

  assert.equal(by['TV Licence'].item.category, 'tv_licence');
  const ct = by['Council Tax'].item;
  assert.equal(ct.category, 'council_tax');
  assert.equal(ct.frequency, 'ten_monthly');
  assert.equal(ct.cost, 210.4);

  const home = by['Home insurance'].item;
  assert.equal(home.endDate, '2026-12-01');
  assert.match(home.notes, /End date: 30 Nov 2026/);
  assert.equal(home.cost, 24.5);

  assert.equal(by.Netflix.duplicateOf, 'x');
});

test('CSV with quotes, and value helpers', () => {
  const rows = S.parseDelimited('Item,Cost\n"Gym, monthly","£1,024.50"\n');
  assert.deepEqual(rows[1], ['Gym, monthly', '£1,024.50']);
  assert.equal(S.parseMoney('£1,024.50'), 1024.5);
  assert.equal(S.parseFrequency('Yearly'), 'annually');
  assert.equal(S.parseDate(46000), '2025-12-09'); // spreadsheet serial number
  assert.equal(S.parseDate('March 2027'), '2027-03-01');
  assert.equal(S.parseDay('22nd'), '22');
});
