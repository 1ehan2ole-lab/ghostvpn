/**
 * GhostVPN - business logic shared between the API routes and the CLI scripts.
 */
import { config } from './config.js';
import {
  countAdmins,
  countUsers,
  findUserByEmail,
  findUserById,
  findUserByUsername,
  insertUser,
  listUsers,
  logEvent,
  setSetting,
  updateUser,
} from './db.js';
import {
  GB,
  hashPassword,
  randomTag,
  randomToken,
  randomUuid,
  toGb,
  verifyPassword,
} from './util.js';
import { buildSubToken } from './subscription.js';
import { diffStats, fetchUserStats, reloadClients, resetCounters } from './xray.js';

/* ------------------------------------------------------------------ */
/* User creation                                                       */
/* ------------------------------------------------------------------ */

export class ServiceError extends Error {
  constructor(message, status = 400, code = 'error') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function createUser({
  email,
  username,
  password,
  role = 'user',
  status = 'active',
  trafficLimitGb = config.defaultTrafficGb,
  expiresAt = 0,
  deviceLimit = config.deviceLimit,
  note = '',
  ip = '',
}) {
  const mail = String(email || '').trim().toLowerCase();
  const name = String(username || '').trim().toLowerCase();

  if (!mail) throw new ServiceError('Укажите e-mail', 400, 'email_required');
  if (!name) throw new ServiceError('Укажите имя пользователя', 400, 'username_required');
  if (!password || password.length < 8) {
    throw new ServiceError('Пароль должен быть не короче 8 символов', 400, 'weak_password');
  }
  if (findUserByEmail(mail)) throw new ServiceError('Этот e-mail уже зарегистрирован', 409, 'email_taken');
  if (findUserByUsername(name)) throw new ServiceError('Имя пользователя занято', 409, 'username_taken');

  const now = Date.now();
  const expires = expiresAt || (config.trialDays > 0 ? now + config.trialDays * 86400000 : 0);

  const user = insertUser({
    email: mail,
    username: name,
    password_hash: hashPassword(password),
    role,
    status,
    vless_uuid: randomUuid(),
    vless_tag: randomTag('gv'),
    sub_token: buildSubToken(),
    traffic_limit: Math.round(Number(trafficLimitGb || 0) * GB),
    expires_at: expires,
    device_limit: deviceLimit,
    note,
  });

  logEvent('user_created', `Пользователь ${mail} создан`, { userId: user.id, ip });
  return user;
}

/* ------------------------------------------------------------------ */
/* Status evaluation                                                   */
/* ------------------------------------------------------------------ */

/**
 * Returns the effective status of a user: 'active' | 'expired' | 'limited' | 'disabled'.
 */
export function effectiveStatus(user) {
  if (!user) return 'disabled';
  if (user.status === 'disabled' || user.status === 'banned') return 'disabled';
  if (user.status === 'pending') return 'pending';
  if (user.expires_at && user.expires_at <= Date.now()) return 'expired';
  if (user.traffic_limit > 0 && user.traffic_used >= user.traffic_limit) return 'limited';
  return 'active';
}

/** Recompute and persist the status field. */
export function refreshStatus(user) {
  const status = effectiveStatus(user);
  // В «активное» состояние аккаунт возвращает только администратор.
  if (status !== 'active' && user.status === 'active') {
    updateUser(user.id, { status });
  }
  return status;
}

/* ------------------------------------------------------------------ */
/* Traffic accounting                                                  */
/* ------------------------------------------------------------------ */

let syncing = false;

/**
 * Pull the counters from the xray API and persist the deltas.
 * Users that exceeded their quota are disabled and cut off from the config.
 */
export async function syncTraffic() {
  if (syncing) return { skipped: true };
  syncing = true;
  try {
    const stats = await fetchUserStats();
    const deltas = diffStats(stats);
    if (!deltas.size) return { updated: 0 };

    let updated = 0;
    const offenders = [];
    for (const user of listUsers()) {
      const delta = deltas.get(user.vless_tag);
      if (!delta) continue;
      const used = user.traffic_used + delta;
      updateUser(user.id, { traffic_used: used });
      updated += 1;
      if (user.traffic_limit > 0 && used >= user.traffic_limit && effectiveStatus(user) === 'active') {
        offenders.push(user.email);
        updateUser(user.id, { status: 'limited' });
        logEvent('traffic_limit', `Лимит трафика исчерпан: ${user.email}`, { userId: user.id });
      }
    }
    if (offenders.length) await reloadClients().catch(() => {});
    return { updated, offenders };
  } finally {
    syncing = false;
  }
}

/* ------------------------------------------------------------------ */
/* Bootstrap                                                           */
/* ------------------------------------------------------------------ */

export function bootstrapAdmin() {
  if (countAdmins() > 0) return null;
  const email = (config.admin.email || 'admin@ghostvpn.local').toLowerCase();
  const password = config.admin.password || randomToken(12);
  const user = createUser({
    email,
    username: 'admin',
    password,
    role: 'admin',
    status: 'active',
    trafficLimitGb: 0,
    expiresAt: 0,
    deviceLimit: 0,
    note: 'bootstrap administrator',
  });
  if (!config.admin.password) {
    setSetting('bootstrap_admin_password', password);
  }
  logEvent('admin_created', `Создан администратор ${email}`, { userId: user.id });
  return { user, password: config.admin.password ? null : password };
}

/* ------------------------------------------------------------------ */
/* Payload shaping                                                     */
/* ------------------------------------------------------------------ */

export function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    status: user.status,
    createdAt: user.created_at,
    lastLoginAt: user.last_login_at,
    expiresAt: user.expires_at,
    trafficUsed: user.traffic_used,
    trafficUsedGb: toGb(user.traffic_used),
    trafficLimit: user.traffic_limit,
    trafficLimitGb: toGb(user.traffic_limit),
    deviceLimit: user.device_limit,
    note: user.note,
  };
}

/** Sanitised user payload for the admin table. */
export function adminUser(user) {
  return {
    ...publicUser(user),
    vlessUuid: user.vless_uuid,
    vlessTag: user.vless_tag,
    hasPassword: Boolean(user.password_hash),
    lastSeenIp: user.last_seen_ip,
  };
}

export { verifyPassword, hashPassword };
