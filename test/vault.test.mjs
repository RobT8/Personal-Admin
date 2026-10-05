import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../src/vault.js';

const V = globalThis.PAVault;
const bytesOf = (box) => Buffer.from(new Uint8Array(box.data)).toString('latin1');

test('app lock: right passphrase opens, wrong one is refused', async () => {
  const { record, key } = await V.createVault('blue kettle sings at seven');
  assert.ok(key);
  assert.equal(record.iterations, 600000);
  assert.ok(!JSON.stringify(record).includes('kettle'));
  await V.openVault('blue kettle sings at seven', record);
  await assert.rejects(V.openVault('blue kettle sings at six', record), /wrong-passphrase/);
});

test('records and documents round-trip, and are unreadable when sealed', async () => {
  const { key } = await V.createVault('correct horse battery');
  const c = V.makeCipher(key);
  const item = { id: 'abc', name: 'Car insurance', reference: 'P12345678', extra: { vehicleReg: 'AB12 CDE' } };
  const sealed = await c.seal('items', item);
  assert.deepEqual(Object.keys(sealed).sort(), ['_enc', 'id']);
  assert.ok(!bytesOf(sealed._enc).includes('P12345678'));
  assert.deepEqual(await c.open('items', sealed), item);

  const file = { id: 'f1', name: 'schedule.pdf', text: 'Policy P12345678', blob: new Blob(['%PDF secret'], { type: 'application/pdf' }) };
  const sf = await c.seal('files', file);
  assert.ok(!bytesOf(sf._encBlob).includes('secret'));
  const back = await c.open('files', sf);
  assert.equal(back.name, 'schedule.pdf');
  assert.equal(back.blob.type, 'application/pdf');
  assert.equal(await back.blob.text(), '%PDF secret');

  // Another key can't open it
  const other = V.makeCipher((await V.createVault('a different passphrase')).key);
  await assert.rejects(other.open('items', sealed));
});

test('changing the passphrase keeps the same data key', async () => {
  const { record, key } = await V.createVault('old passphrase here');
  const sealed = await V.makeCipher(key).seal('items', { id: 'x', name: 'TV Licence' });
  const record2 = await V.changePassphrase('old passphrase here', 'new passphrase here', record);
  await assert.rejects(V.openVault('old passphrase here', record2), /wrong-passphrase/);
  const key2 = await V.openVault('new passphrase here', record2);
  assert.equal((await V.makeCipher(key2).open('items', sealed)).name, 'TV Licence');
  await assert.rejects(V.changePassphrase('not it', 'whatever123', record), /wrong-passphrase/);
});

test('password-protected backups', async () => {
  const json = JSON.stringify({ app: 'personal-admin', items: [{ name: 'Barclaycard', reference: '4321' }] });
  const file = await V.encryptBackup('backup password 1', json);
  assert.equal(file.encrypted, true);
  assert.ok(!JSON.stringify(file).includes('Barclaycard'));
  assert.equal(await V.decryptBackup('backup password 1', file), json);
  await assert.rejects(V.decryptBackup('backup password 2', file), /wrong-passphrase/);
});

test('passphrase strength guide', () => {
  assert.equal(V.strength('password').score, 1);
  assert.ok(V.strength('blue kettle sings at seven').score >= 3);
});
