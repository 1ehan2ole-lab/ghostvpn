/**
 * GhostVPN - SQLite storage layer (node:sqlite, no native build required).
 */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';

let db;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  email             TEXT    NOT NULL UNIQUE,
  username          TEXT    NOT NULL UNIQUE,
  password_hash     TEXT    NOT NULL,
  role              TEXT    NOT NULL DEFAULT 'user',
  vless_uuid        TEXT    NOT NULL UNIQUE,
  vless_tag         TEXT    NOT NULL UNIQUE,
  sub_token         TEXT    NOT NULL UNIQUE,
  status            TEXT    NOT NULL DEFAULT 'active',
  traffic_limit     INTEGER NOT NULL DEFAULT 0,
  traffic_used      INTEGER NOT NULL DEFAULT 0,
  expires_at        INTEGER NOT NULL DEFAULT 0,
  device_limit      INTEGER NOT NULL DEFAULT 3,
  note              TEXT    NOT NULL DEFAULT '',
  last_login_at     INTEGER NOT NULL DEFAULT 0,
  last_seen_ip      TEXT    NOT NULL DEFAULT '',
  created_at        INTEGER NOT NULL,
  updated_at        INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id         TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip         TEXT NOT NULL DEFAULT '',
  user_agent TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER,
  type       TEXT    NOT NULL,
  message    TEXT    NOT NULL DEFAULT '',
  ip         TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  max_uses   INTEGER NOT NULL DEFAULT 1,
  used       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS payments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL,
  plan       TEXT    NOT NULL,
  days       INTEGER NOT NULL DEFAULT 30,
  amount     REAL    NOT NULL DEFAULT 0,
  currency   TEXT    NOT NULL DEFAULT '$',
  status     TEXT    NOT NULL DEFAULT 'pending',
  comment    TEXT    NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  paid_at    INTEGER NOT NULL DEFAULT 0,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_payments_user   ON payments(user_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON payments(status);

CREATE INDEX IF NOT EXISTS idx_sessions_user   ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_events_user     ON events(user_id);
CREATE INDEX IF NOT EXISTS idx_events_created  ON events(created_at);
CREATE INDEX IF NOT EXISTS idx_users_status    ON users(status);
`;

/** Open (and migrate) the database. */
export function initDb() {
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new DatabaseSync(config.dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  // Частый чекпойнт: основной файл БД всегда содержит свежие данные,
  // даже если процесс был убит (SIGKILL) и WAL-файл осиротел.
  db.exec('PRAGMA wal_autocheckpoint = 64;');
  db.exec('PRAGMA synchronous = FULL;');
  db.exec(SCHEMA);
  return db;
}

/** Принудительно слить WAL в основной файл БД. */
export function checkpoint() {
  if (!db) return;
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    /* база занята другим соединением - не критично */
  }
}

/** Резервная копия БД (раз в сутки). */
export function backupDatabase() {
  try {
    if (!db) return null;
    const dir = path.join(config.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const target = path.join(dir, `ghostvpn-${stamp}.db`);
    if (fs.existsSync(target)) return target;
    checkpoint();
    fs.copyFileSync(config.dbPath, target);
    return target;
  } catch (err) {
    console.error('[db] не удалось сделать резервную копию:', err.message);
    return null;
  }
}

/** Проверка целостности БД. */
export function checkIntegrity() {
  if (!db) return { ok: false, message: 'база не открыта' };
  try {
    const row = db.prepare('PRAGMA integrity_check').get();
    return { ok: row.integrity_check === 'ok', message: row.integrity_check };
  } catch (err) {
    return { ok: false, message: err.message };
  }
}

export function getDb() {
  if (!db) initDb();
  return db;
}

/** Close the database (used by tests and graceful shutdown). */
export function closeDb() {
  if (db) {
    try { db.close(); } catch { /* ignore */ }
    db = null;
  }
}

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

export function getSetting(key, fallback = null) {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return row ? row.value : fallback;
}

export function setSetting(key, value) {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, String(value));
}

export function getSettings() {
  const rows = getDb().prepare('SELECT key, value FROM settings').all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export const findUserById = (id) =>
  getDb().prepare('SELECT * FROM users WHERE id = ?').get(Number(id));

export const findUserByEmail = (email) =>
  getDb().prepare('SELECT * FROM users WHERE email = ?').get(String(email).trim().toLowerCase());

export const findUserByUsername = (username) =>
  getDb().prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim().toLowerCase());

export const findUserBySubToken = (token) =>
  getDb().prepare('SELECT * FROM users WHERE sub_token = ?').get(String(token));

export const findUserByUuid = (uuid) =>
  getDb().prepare('SELECT * FROM users WHERE vless_uuid = ?').get(String(uuid));

export const listUsers = () =>
  getDb()
    .prepare(
      `SELECT u.*,
              (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active_sessions
       FROM users u ORDER BY u.created_at DESC`,
    )
    .all(Date.now());

export const countUsers = () => getDb().prepare('SELECT COUNT(*) AS c FROM users').get().c;

export const countActiveUsers = () =>
  getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE status = 'active'").get().c;

export const countAdmins = () =>
  getDb().prepare("SELECT COUNT(*) AS c FROM users WHERE role = 'admin'").get().c;

export function insertUser(user) {
  const now = Date.now();
  const stmt = getDb().prepare(`
    INSERT INTO users (email, username, password_hash, role, vless_uuid, vless_tag, sub_token,
                       status, traffic_limit, traffic_used, expires_at, device_limit, note,
                       last_login_at, last_seen_ip, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const info = stmt.run(
    user.email,
    user.username,
    user.password_hash,
    user.role || 'user',
    user.vless_uuid,
    user.vless_tag,
    user.sub_token,
    user.status || 'active',
    user.traffic_limit || 0,
    0,
    user.expires_at || 0,
    user.device_limit ?? config.deviceLimit,
    user.note || '',
    0,
    '',
    now,
    now,
  );
  return findUserById(info.lastInsertRowid);
}

const UPDATABLE = new Set([
  'email', 'username', 'password_hash', 'role', 'status', 'traffic_limit',
  'traffic_used', 'expires_at', 'device_limit', 'note', 'last_login_at',
  'last_seen_ip', 'sub_token', 'vless_uuid', 'vless_tag',
]);

export function updateUser(id, patch) {
  const keys = Object.keys(patch).filter((k) => UPDATABLE.has(k));
  if (!keys.length) return findUserById(id);
  const setSql = keys.map((k) => `${k} = ?`).join(', ');
  const values = keys.map((k) => patch[k]);
  getDb()
    .prepare(`UPDATE users SET ${setSql}, updated_at = ? WHERE id = ?`)
    .run(...values, Date.now(), Number(id));
  return findUserById(id);
}

export function deleteUser(id) {
  const uid = Number(id);
  getDb().prepare('DELETE FROM sessions WHERE user_id = ?').run(uid);
  getDb().prepare('DELETE FROM events WHERE user_id = ?').run(uid);
  getDb().prepare('DELETE FROM users WHERE id = ?').run(uid);
}

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export function createSession({ id, userId, expiresAt, ip, userAgent }) {
  getDb()
    .prepare(
      'INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(id, Number(userId), Date.now(), expiresAt, ip || '', userAgent || '');
}

export function findSession(id) {
  if (!id) return null;
  return getDb().prepare('SELECT * FROM sessions WHERE id = ?').get(String(id));
}

export function deleteSession(id) {
  getDb().prepare('DELETE FROM sessions WHERE id = ?').run(String(id));
}

export function deleteExpiredSessions() {
  getDb().prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
}

export function listSessionsForUser(userId) {
  return getDb()
    .prepare('SELECT * FROM sessions WHERE user_id = ? AND expires_at > ?')
    .all(Number(userId), Date.now());
}

/* ------------------------------------------------------------------ */
/* Events (audit log)                                                  */
/* ------------------------------------------------------------------ */

export function logEvent(type, message, { userId = null, ip = '' } = {}) {
  getDb()
    .prepare('INSERT INTO events (user_id, type, message, ip, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(userId, type, String(message ?? ''), ip || '', Date.now());
}

export function listEvents(limit = 100) {
  return getDb()
    .prepare(
      `SELECT e.*, u.email FROM events e LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.created_at DESC LIMIT ?`,
    )
    .all(Number(limit));
}

/* ------------------------------------------------------------------ */
/* Invites                                                             */
/* ------------------------------------------------------------------ */

export function listInvites() {
  return getDb().prepare('SELECT * FROM invites ORDER BY created_at DESC').all();
}

export function createInvite(code, maxUses = 1) {
  getDb()
    .prepare('INSERT INTO invites (code, max_uses, used, created_at) VALUES (?, ?, 0, ?) ON CONFLICT(code) DO UPDATE SET max_uses = excluded.max_uses')
    .run(code, Number(maxUses), Date.now());
  return { code, max_uses: Number(maxUses) };
}

export function deleteInvite(code) {
  getDb().prepare('DELETE FROM invites WHERE code = ?').run(String(code));
}

export function consumeInvite(code) {
  const invite = getDb().prepare('SELECT * FROM invites WHERE code = ?').get(String(code));
  if (!invite) return { ok: false, reason: 'not_found' };
  if (invite.used >= invite.max_uses) return { ok: false, reason: 'exhausted' };
  getDb().prepare('UPDATE invites SET used = used + 1 WHERE code = ?').run(String(code));
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

export function createPayment(payment) {
  const info = getDb()
    .prepare(
      `INSERT INTO payments (user_id, plan, days, amount, currency, status, comment, created_at, paid_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      Number(payment.userId),
      payment.plan,
      Number(payment.days || 30),
      Number(payment.amount || 0),
      payment.currency || '$',
      payment.status || 'pending',
      payment.comment || '',
      Date.now(),
      0,
    );
  return findPayment(info.lastInsertRowid);
}

export const findPayment = (id) =>
  getDb().prepare('SELECT * FROM payments WHERE id = ?').get(Number(id));

export const listPayments = () =>
  getDb()
    .prepare(
      `SELECT p.*, u.email, u.username FROM payments p
       LEFT JOIN users u ON u.id = p.user_id
       ORDER BY p.created_at DESC`,
    )
    .all();

export const listUserPayments = (userId) =>
  getDb()
    .prepare('SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC')
    .all(Number(userId));

export function updatePayment(id, patch) {
  const allowed = ['status', 'comment', 'paid_at', 'days', 'amount'];
  const keys = Object.keys(patch).filter((k) => allowed.includes(k));
  if (!keys.length) return findPayment(id);
  const sql = keys.map((k) => `${k} = ?`).join(', ');
  getDb()
    .prepare(`UPDATE payments SET ${sql} WHERE id = ?`)
    .run(...keys.map((k) => patch[k]), Number(id));
  return findPayment(id);
}
