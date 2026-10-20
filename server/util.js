/**
 * GhostVPN - shared helpers: hashing, tokens, formatting.
 */
import crypto from 'node:crypto';

const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Hash a password with scrypt. Format: scrypt$N$r$p$salt$hash */
export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = crypto.scryptSync(password, salt, SCRYPT_PARAMS.keylen, {
    N: SCRYPT_PARAMS.N,
    r: SCRYPT_PARAMS.r,
    p: SCRYPT_PARAMS.p,
    maxmem: 64 * 1024 * 1024,
  });
  return [
    'scrypt',
    SCRYPT_PARAMS.N,
    SCRYPT_PARAMS.r,
    SCRYPT_PARAMS.p,
    salt.toString('base64'),
    derived.toString('base64'),
  ].join('$');
}

/** Constant time password verification. */
export function verifyPassword(password, stored) {
  try {
    const [scheme, N, r, p, saltB64, hashB64] = String(stored).split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const derived = crypto.scryptSync(password, salt, expected.length, {
      N: Number(N),
      r: Number(r),
      p: Number(p),
      maxmem: 64 * 1024 * 1024,
    });
    return crypto.timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** URL-safe random token. */
export function randomToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('base64url');
}

/** Random UUID v4 (used as the VLESS user id). */
export function randomUuid() {
  return crypto.randomUUID();
}

/** Short random id, used for xray client e-mail tags. */
export function randomTag(prefix = 'u') {
  return `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
}

/** SHA-256 hash, used for subscription tokens lookups. */
export function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export const GB = 1024 ** 3;
export const MB = 1024 ** 2;

/** Human readable byte size. */
export function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  const n = value / 1024 ** i;
  return `${n.toFixed(i === 0 ? 0 : n >= 100 ? 0 : 2)} ${units[i]}`;
}

/** Bytes -> gigabytes (rounded, 2 decimals). */
export function toGb(bytes) {
  return Math.round((Number(bytes) || 0) / GB * 100) / 100;
}

/** Human readable duration from a timestamp in ms. */
export function formatDate(ts) {
  if (!ts) return 'бессрочно';
  const d = new Date(Number(ts));
  return d.toISOString().slice(0, 10);
}

export function formatDateTime(ts) {
  if (!ts) return '—';
  const d = new Date(Number(ts));
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

/** Number of days left until ts (negative = expired). */
export function daysLeft(ts) {
  if (!ts) return null;
  return Math.ceil((Number(ts) - Date.now()) / 86400000);
}

/** Compare password against a list of common weak passwords. */
export function isWeakPassword(password) {
  const weak = new Set([
    'password', '123456', '12345678', 'qwerty', '111111', '123123', 'admin',
    'letmein', 'welcome', 'monkey', 'dragon', 'iloveyou', 'passw0rd',
    '1234', '12345', '000000', 'qwertyuiop', 'test', 'test123', 'vpn',
  ]);
  const p = String(password || '').toLowerCase();
  if (p.length < 8) return true;
  if (weak.has(p)) return true;
  if (/^(.)\1+$/.test(p)) return true;
  if (/^(0123456789|1234567890|abcdefghij|qwertyuiop)/.test(p)) return true;
  return false;
}

/** Basic e-mail validation. */
export function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(value || '').trim());
}
