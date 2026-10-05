/* Personal Admin — encryption (Web Crypto, AES-256-GCM).
   A random data key encrypts the records; the user's passphrase (stretched with PBKDF2)
   only wraps that data key. Changing the passphrase therefore re-wraps one key instead
   of re-encrypting everything. Nothing here touches the DOM or storage. */
(function (g) {
  'use strict';

  const subtle = g.crypto.subtle;
  const ITERATIONS = 600000; // OWASP 2023 recommendation for PBKDF2-SHA256
  const enc = new TextEncoder();
  const dec = new TextDecoder();

  const rand = (n) => g.crypto.getRandomValues(new Uint8Array(n));

  function toB64(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function fromB64(str) {
    const bin = atob(str);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  async function passwordKey(passphrase, salt, iterations, usages) {
    const base = await subtle.importKey('raw', enc.encode(passphrase.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
    return subtle.deriveKey({ name: 'PBKDF2', salt, iterations, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, usages);
  }

  /* ---------- the app lock ---------- */

  // Returns { record, key }: `record` is safe to store (no secrets in clear), `key` stays in memory.
  async function createVault(passphrase) {
    const key = await subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt']);
    const record = await wrapRecord(key, passphrase);
    // Hand back a non-extractable copy for day-to-day use
    return { record, key: await openVault(passphrase, record) };
  }

  async function wrapRecord(extractableKey, passphrase) {
    const salt = rand(16), iv = rand(12);
    const kek = await passwordKey(passphrase, salt, ITERATIONS, ['wrapKey']);
    const wrapped = await subtle.wrapKey('raw', extractableKey, kek, { name: 'AES-GCM', iv });
    return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), wrapped: toB64(wrapped), created: new Date().toISOString() };
  }

  // Throws Error('wrong-passphrase') if the passphrase is wrong (the GCM tag won't verify).
  async function openVault(passphrase, record, extractable = false) {
    const kek = await passwordKey(passphrase, fromB64(record.salt), record.iterations, ['unwrapKey']);
    try {
      return await subtle.unwrapKey('raw', fromB64(record.wrapped), kek, { name: 'AES-GCM', iv: fromB64(record.iv) }, { name: 'AES-GCM', length: 256 }, extractable, ['encrypt', 'decrypt']);
    } catch {
      throw new Error('wrong-passphrase');
    }
  }

  async function changePassphrase(oldPass, newPass, record) {
    const key = await openVault(oldPass, record, true);
    return wrapRecord(key, newPass);
  }

  /* ---------- records ---------- */

  async function encryptBytes(key, bytes) {
    const iv = rand(12);
    const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
    return { iv, data };
  }
  async function decryptBytes(key, box) {
    return subtle.decrypt({ name: 'AES-GCM', iv: box.iv }, key, box.data);
  }

  // A cipher for PADB: records become { id, _enc } (and files also get _encBlob).
  // Ids stay readable; they're random and carry no personal information.
  function makeCipher(key) {
    return {
      async seal(store, value) {
        const { blob, ...rest } = value;
        const out = { id: value.id };
        if (blob) {
          rest.blobType = blob.type;
          out._encBlob = await encryptBytes(key, await blob.arrayBuffer());
        }
        out._enc = await encryptBytes(key, enc.encode(JSON.stringify(rest)));
        return out;
      },
      async open(store, row) {
        const value = JSON.parse(dec.decode(await decryptBytes(key, row._enc)));
        if (row._encBlob) {
          value.blob = new Blob([await decryptBytes(key, row._encBlob)], { type: value.blobType || '' });
          delete value.blobType;
        } else if ('blobType' in value) {
          value.blob = null;
          delete value.blobType;
        }
        return value;
      },
    };
  }

  /* ---------- password-protected backup files ---------- */

  async function encryptBackup(passphrase, text) {
    const salt = rand(16), iv = rand(12);
    const key = await passwordKey(passphrase, salt, ITERATIONS, ['encrypt']);
    const data = await subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(text));
    return { app: 'personal-admin', encrypted: true, v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: toB64(salt), iv: toB64(iv), data: toB64(data) };
  }
  async function decryptBackup(passphrase, file) {
    const key = await passwordKey(passphrase, fromB64(file.salt), file.iterations, ['decrypt']);
    try {
      return dec.decode(await subtle.decrypt({ name: 'AES-GCM', iv: fromB64(file.iv) }, key, fromB64(file.data)));
    } catch {
      throw new Error('wrong-passphrase');
    }
  }

  // Rough guide only; shown to the user while they choose a passphrase.
  function strength(p) {
    if (!p) return { score: 0, label: '' };
    let pool = 0;
    if (/[a-z]/.test(p)) pool += 26;
    if (/[A-Z]/.test(p)) pool += 26;
    if (/\d/.test(p)) pool += 10;
    if (/[^a-zA-Z0-9]/.test(p)) pool += 20;
    const words = p.trim().split(/\s+/).length;
    const bits = Math.max(p.length * Math.log2(pool || 1), words >= 3 ? words * 11 : 0);
    const common = /^(pass(word)?|qwerty|letmein|iloveyou|welcome|admin|abc123|monkey|dragon|football|123456|1234567|12345678|123456789|password1)\d*!?$/i;
    if (bits < 35 || common.test(p) || (/^[a-z]+\d{0,4}$/i.test(p) && p.length < 12) || /^\d+$/.test(p)) return { score: 1, label: 'Weak: easy to guess' };
    if (bits < 55) return { score: 2, label: 'OK' };
    if (bits < 75) return { score: 3, label: 'Strong' };
    return { score: 4, label: 'Very strong' };
  }

  g.PAVault = { createVault, openVault, changePassphrase, makeCipher, encryptBackup, decryptBackup, strength, toB64, fromB64, ITERATIONS };
})(globalThis);
