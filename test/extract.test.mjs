import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/core.js';
import '../src/extract.js';

const { PAExtract: X, PACore: C } = globalThis;
const people = [{ id: 'rob', name: 'Rob Tait', phone: '07700 900123' }, { id: 'sarah', name: 'Sarah Tait', phone: '07700 900456' }];

test('car insurance renewal email', () => {
  const r = X.extract(`Your Admiral car insurance renewal
Dear Mr Rob Tait,
Policy number: P12345678
Vehicle: AB12CDE Ford Focus
Your policy renews on 14 March 2027.
Period of cover: 14 March 2026 to 13 March 2027
Last year you paid £412.50. Your renewal premium is £468.20 per year.
Comprehensive cover. 5 years no claims discount. Total excess £350.
Your policy will automatically renew.`, {}, people);
  assert.equal(r.fields.category, 'car_insurance');
  assert.equal(r.fields.provider, 'Admiral');
  assert.equal(r.fields.endDate, '2027-03-14');
  assert.equal(r.fields.startDate, '2026-03-14');
  assert.equal(r.fields.cost, 468.2);
  assert.equal(r.fields.frequency, 'annually');
  assert.equal(r.fields.previousCost, 412.5);
  assert.equal(r.fields.reference, 'P12345678');
  assert.equal(r.fields.ownerId, 'rob');
  assert.equal(r.fields.autoRenew, 'yes');
  assert.equal(r.extra.vehicleReg, 'AB12 CDE');
  assert.equal(r.extra.noClaimsYears, '5');
  assert.equal(r.extra.excess, 350);
});

test('mobile contract matched to the person by phone number', () => {
  const r = X.extract('Your contract for 07700 900456 ends on 02/11/2026. You pay £38.00 a month for 100GB data.', { from: 'EE <noreply@ee.co.uk>' }, people);
  assert.equal(r.fields.category, 'mobile');
  assert.equal(r.fields.provider, 'EE');
  assert.equal(r.fields.endDate, '2026-11-02');
  assert.equal(r.fields.cost, 38);
  assert.equal(r.fields.frequency, 'monthly');
  assert.equal(r.fields.ownerId, 'sarah');
  assert.equal(r.extra.phoneNumber, '07700 900456');
  assert.match(r.fields.name, /^Sarah's mobile/);
});

test('credit card rates, limit and promo', () => {
  const r = X.extract('Barclaycard. Card ending 4321. Credit limit £5,000. Balance £1,234.56. Minimum payment £25.00. Purchase rate 24.9% p.a. (variable). 0% on balance transfers until 1 June 2027.', {}, people);
  assert.equal(r.fields.category, 'credit_card');
  assert.equal(r.extra.apr, '24.9');
  assert.equal(r.extra.creditLimit, 5000);
  assert.equal(r.extra.balance, 1234.56);
  assert.equal(r.extra.minPayment, 25);
  assert.equal(r.extra.cardLast4, '4321');
  assert.equal(r.extra.promoEndDate, '2027-06-01');
});

test('TV licence and council tax', () => {
  const tv = X.extract('TV Licensing. Your licence number is 1234567890 and it expires on 31 January 2027. You pay £14.54 per month by Direct Debit.');
  assert.equal(tv.fields.category, 'tv_licence');
  assert.equal(tv.fields.endDate, '2027-01-31');
  assert.equal(tv.fields.reference, '1234567890');
  assert.equal(tv.fields.paymentMethod, 'Direct debit');
  const ct = X.extract('Barnet Council - Council Tax bill 2026/27. Account reference 98765432. Property band D. Total £2,104.00 payable in 10 monthly instalments of £210.40.');
  assert.equal(ct.fields.category, 'council_tax');
  assert.equal(ct.fields.provider, 'Barnet Council');
  assert.equal(ct.fields.endDate, '2027-03-31');
  assert.equal(ct.fields.frequency, 'ten_monthly');
  assert.equal(ct.extra.band, 'D');
});

test('email body wins over an attached document', () => {
  const r = X.extract('Hi Sarah, your mobile contract ends on 2 November 2026, £38 a month.\n--- Attachment: other.pdf ---\nHome insurance renewal date 1 December 2026. Premium £312.40 per year. Policy number AH-998877.', { from: 'EE <x@ee.co.uk>' }, people);
  assert.equal(r.fields.category, 'mobile');
  assert.equal(r.fields.endDate, '2026-11-02');
  assert.equal(r.fields.cost, 38);
});

test('date parsing formats', () => {
  const iso = (t) => X.findDates(t).map((d) => d.iso);
  assert.deepEqual(iso('1st of June 2026, March 3, 2027, 2027-04-05, 06/07/27'), ['2026-06-01', '2027-03-03', '2027-04-05', '2027-07-06']);
  assert.deepEqual(iso('31/02/2027'), []);
});

test('reminders, notice periods and renewal keys', () => {
  const item = C.newItem({ endDate: '2027-03-14', noticeDays: 30, reminderOffsets: [30, 7] });
  const rs = C.itemReminders(item, { defaultOffsets: [1] });
  assert.deepEqual(rs.map((r) => r.date).sort(), ['2027-02-12', '2027-02-12', '2027-03-07']);
  item.dismissed = [rs[0].key];
  assert.equal(C.itemReminders(item, {}).filter((r) => r.done).length, 1);
  item.endDate = '2028-03-14'; // renewed: new year's reminders start fresh
  assert.equal(C.itemReminders(item, {}).filter((r) => r.done).length, 0);
});

test('costs and calendar export', () => {
  assert.equal(C.monthlyCost({ cost: 120, frequency: 'annually' }), 10);
  assert.equal(C.annualCost({ cost: 210.4, frequency: 'ten_monthly' }), 2104);
  assert.equal(C.addMonths('2026-01-31', 1), '2026-02-28');
  const ics = C.buildICS([{ uid: 'a', date: '2027-03-14', summary: 'Car, renewal; soon', description: 'x' }]);
  assert.match(ics, /DTSTART;VALUE=DATE:20270314/);
  assert.ok(ics.includes(String.raw`SUMMARY:Car\, renewal\; soon`));
});

test('notifications: one per item, capped with a summary', () => {
  const past = C.addDays(C.today(), -1);
  const items = [1, 2, 3, 4, 5].map((n) => C.newItem({ id: `i${n}`, name: `Thing ${n}`, endDate: past, noticeDays: 30 }));
  const { notifications, keys } = C.dueNotifications(items, { defaultOffsets: [30, 7, 1] }, []);
  assert.equal(notifications.length, 4); // 3 items + summary
  assert.match(notifications[3].body, /2 more things/);
  assert.equal(keys.length, 20); // 5 items × (3 offsets + notice)
  assert.equal(C.dueNotifications(items, { defaultOffsets: [30, 7, 1] }, keys).notifications.length, 0);
});
