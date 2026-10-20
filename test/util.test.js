/**
 * GhostVPN - unit tests for the helper layer.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatBytes,
  hashPassword,
  isEmail,
  isWeakPassword,
  randomToken,
  randomUuid,
  sha256,
  toGb,
  verifyPassword,
} from '../server/util.js';

test('password hashing is salted and verifiable', () => {
  const hash = hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$/);
  assert.equal(verifyPassword('correct horse battery', hash), true);
  assert.equal(verifyPassword('wrong password', hash), false);
});

test('two hashes of the same password differ (random salt)', () => {
  assert.notEqual(hashPassword('same'), hashPassword('same'));
});

test('formatBytes renders human readable sizes', () => {
  assert.equal(formatBytes(0), '0 B');
  assert.equal(formatBytes(1024), '1.00 KB');
  assert.equal(formatBytes(1024 ** 3), '1.00 GB');
});

test('toGb converts bytes to gigabytes', () => {
  assert.equal(toGb(1024 ** 3), 1);
  assert.equal(toGb(512 * 1024 ** 2), 0.5);
});

test('weak passwords are rejected', () => {
  assert.equal(isWeakPassword('12345678'), true);
  assert.equal(isWeakPassword('short'), true);
  assert.equal(isWeakPassword('aaaaaaaaaa'), true);
  assert.equal(isWeakPassword('Tr0ub4dor&3xyz'), false);
});

test('email validation', () => {
  assert.equal(isEmail('user@example.com'), true);
  assert.equal(isEmail('not-an-email'), false);
  assert.equal(isEmail('a@b'), false);
});

test('tokens are unique and url safe', () => {
  const a = randomToken(16);
  const b = randomToken(16);
  assert.notEqual(a, b);
  assert.match(a, /^[A-Za-z0-9_-]+$/);
  assert.match(randomUuid(), /^[0-9a-f-]{36}$/);
  assert.equal(sha256('x').length, 64);
});
