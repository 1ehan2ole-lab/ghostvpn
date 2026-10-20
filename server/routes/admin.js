/**
 * GhostVPN - administration API.
 */
import express from 'express';
import { config } from '../config.js';
import { requireAdmin } from '../auth.js';
import {
  createInvite,
  deleteInvite,
  deleteUser,
  findUserById,
  listEvents,
  listInvites,
  listUsers,
  logEvent,
  setSetting,
  updateUser,
} from '../db.js';
import { ServiceError, adminUser, createUser, effectiveStatus, refreshStatus } from '../service.js';
import { GB, randomTag, randomUuid, toGb } from '../util.js';
import { buildSubToken } from '../subscription.js';
import {
  ensureRealityKeys,
  isRunning,
  lastXrayError,
  onlineCount,
  onlineUsers,
  reloadClients,
  restartXray,
  xrayPid,
} from '../xray.js';
import { rt, invalidate } from '../runtime.js';

const router = express.Router();

router.use(requireAdmin);

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

router.get('/users', async (req, res) => {
  const users = listUsers();
  const online = await onlineUsers();
  const withOnline = [];
  for (const user of users) {
    const isOnline = user.status === 'active' && online.has(user.vless_tag);
    withOnline.push({
      ...adminUser(user),
      online: isOnline ? 1 : 0,
      effectiveStatus: effectiveStatus(user),
    });
  }
  res.json({
    ok: true,
    users: withOnline,
    totals: {
      count: users.length,
      active: users.filter((u) => u.status === 'active').length,
      online: withOnline.reduce((acc, u) => acc + u.online, 0),
      trafficUsed: users.reduce((acc, u) => acc + u.traffic_used, 0),
    },
  });
});

router.post('/users', async (req, res) => {
  try {
    const {
      email,
      username,
      password,
      role = 'user',
      status = 'active',
      trafficLimitGb,
      expiresAt = 0,
      deviceLimit,
      note = '',
    } = req.body || {};
    const user = createUser({
      email,
      username,
      password,
      role,
      status,
      trafficLimitGb: trafficLimitGb ?? rt().defaultTrafficGb,
      expiresAt,
      deviceLimit: deviceLimit ?? rt().deviceLimit,
      note,
      ip: req.ip,
    });
    await reloadClients().catch((e) => console.error('[xray reload]', e.message));
    res.status(201).json({ ok: true, user: adminUser(user) });
  } catch (err) {
    const status = err instanceof ServiceError ? err.status : 500;
    if (status === 500) console.error('[admin create user]', err);
    res.status(status).json({
      error: err.code || 'error',
      message: status === 500 ? 'Внутренняя ошибка' : err.message,
    });
  }
});

router.patch('/users/:id', async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  const patch = {};
  const body = req.body || {};

  if (body.status !== undefined) {
    if (body.status === 'active') {
      // re-activating clears the blocking reasons
      if (user.expires_at && user.expires_at <= Date.now()) {
        return res.status(400).json({ error: 'expired', message: 'Сначала продлите срок' });
      }
      if (user.traffic_limit > 0 && user.traffic_used >= user.traffic_limit) {
        return res.status(400).json({ error: 'limit', message: 'Сначала сбросьте трафик' });
      }
    }
    patch.status = String(body.status);
  }
  if (body.email !== undefined) patch.email = String(body.email).trim().toLowerCase();
  if (body.username !== undefined) patch.username = String(body.username).trim().toLowerCase();
  if (body.note !== undefined) patch.note = String(body.note);
  if (body.role !== undefined) patch.role = String(body.role) === 'admin' ? 'admin' : 'user';
  if (body.trafficLimitGb !== undefined) {
    patch.traffic_limit = Math.max(0, Math.round(Number(body.trafficLimitGb || 0) * GB));
  }
  if (body.deviceLimit !== undefined) {
    patch.device_limit = Math.max(0, Number(body.deviceLimit || 0));
  }
  if (body.expiresAt !== undefined) patch.expires_at = Number(body.expiresAt || 0);
  if (body.password) patch.password_hash = (await import('../util.js')).hashPassword(String(body.password));

  const updated = updateUser(user.id, patch);
  await reloadClients().catch(() => {});
  logEvent('user_updated', `Обновлён ${user.email}: ${Object.keys(patch).join(', ')}`, {
    userId: user.id,
    ip: req.ip,
  });
  res.json({ ok: true, user: adminUser(updated) });
});

router.delete('/users/:id', async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  if (user.id === req.user.id) {
    return res.status(400).json({ error: 'self', message: 'Нельзя удалить себя' });
  }
  if (user.role === 'admin' && listUsers().filter((u) => u.role === 'admin').length <= 1) {
    return res.status(400).json({ error: 'last_admin', message: 'Это последний администратор' });
  }
  deleteUser(user.id);
  await reloadClients().catch(() => {});
  logEvent('user_deleted', `Удалён ${user.email}`, { ip: req.ip });
  res.json({ ok: true });
});

router.post('/users/:id/reset-traffic', async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  updateUser(user.id, { traffic_used: 0, status: 'active' });
  logEvent('traffic_reset', `Сброшен трафик: ${user.email}`, { userId: user.id, ip: req.ip });
  res.json({ ok: true });
});

router.post('/users/:id/extend', async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  const days = Number(req.body?.days || 30);
  const base = user.expires_at > Date.now() ? user.expires_at : Date.now();
  const expires = base + days * 86400000;
  updateUser(user.id, { expires_at: expires, status: 'active' });
  logEvent('user_extended', `Продлён ${user.email} на ${days} дн.`, { userId: user.id, ip: req.ip });
  res.json({ ok: true, expiresAt: expires });
});

router.post('/users/:id/rotate-key', async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  updateUser(user.id, {
    vless_uuid: randomUuid(),
    vless_tag: randomTag('gv'),
    sub_token: buildSubToken(),
  });
  await reloadClients().catch(() => {});
  logEvent('key_rotated', `Ключ перевыпущен: ${user.email}`, { userId: user.id, ip: req.ip });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Statistics & events                                                 */
/* ------------------------------------------------------------------ */

router.get('/stats', async (req, res) => {
  const users = listUsers();
  const reality = await ensureRealityKeys();
  res.json({
    ok: true,
    totals: {
      users: users.length,
      active: users.filter((u) => u.status === 'active').length,
      admins: users.filter((u) => u.role === 'admin').length,
      trafficUsed: users.reduce((a, u) => a + u.traffic_used, 0),
      trafficUsedGb: toGb(users.reduce((a, u) => a + u.traffic_used, 0)),
      expiringSoon: users.filter((u) => u.expires_at && u.expires_at > Date.now() && u.expires_at - Date.now() < 7 * 86400000).length,
    },
    xray: {
      running: isRunning(),
      pid: xrayPid(),
      error: lastXrayError(),
      realityPublicKey: reality.publicKey,
      shortIds: reality.shortIds,
    },
    server: {
      host: config.serverHost || 'auto',
      port: rt().serverPort,
      sni: rt().realitySni,
      dest: rt().realityDest,
    },
  });
});

router.get('/events', (req, res) => {
  res.json({ ok: true, events: listEvents(Number(req.query.limit || 100)) });
});

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */

const SETTING_KEYS = new Set([
  'server_port', 'reality_sni', 'reality_dest', 'reality_fingerprint', 'loglevel',
  'site_name', 'site_tagline', 'support_url', 'currency',
  'price_1m', 'price_3m', 'price_6m', 'price_12m',
  'registration_open', 'invite_required', 'device_limit', 'default_traffic_gb', 'trial_days',
]);

router.get('/settings', (req, res) => {
  res.json({ ok: true, settings: rt() });
});

router.put('/settings', async (req, res) => {
  const body = req.body || {};
  const applied = [];
  for (const [key, value] of Object.entries(body)) {
    if (!SETTING_KEYS.has(key)) continue;
    setSetting(key, value);
    applied.push(key);
  }
  invalidate();
  logEvent('settings_updated', `Изменены настройки: ${applied.join(', ')}`, { ip: req.ip });
  await reloadClients().catch(() => {});
  res.json({ ok: true, applied, settings: rt() });
});

/* ------------------------------------------------------------------ */
/* Xray control                                                        */
/* ------------------------------------------------------------------ */

router.get('/xray', (req, res) => {
  res.json({
    ok: true,
    running: isRunning(),
    pid: xrayPid(),
    error: lastXrayError(),
    configPath: config.xrayConfigPath,
  });
});

router.post('/xray/restart', async (req, res) => {
  try {
    const result = await restartXray();
    logEvent('xray_restart', 'Xray перезапущен', { ip: req.ip });
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'xray_error', message: String(err.message || err) });
  }
});

router.post('/xray/reload', async (req, res) => {
  try {
    const result = await reloadClients();
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(500).json({ error: 'xray_error', message: String(err.message || err) });
  }
});

/* ------------------------------------------------------------------ */
/* Invites                                                             */
/* ------------------------------------------------------------------ */

router.get('/invites', (req, res) => {
  res.json({ ok: true, invites: listInvites() });
});

router.post('/invites', (req, res) => {
  const code = String(req.body?.code || `GHOST-${Math.random().toString(36).slice(2, 8).toUpperCase()}`);
  const maxUses = Number(req.body?.maxUses || 1);
  createInvite(code, maxUses);
  res.status(201).json({ ok: true, code, maxUses });
});

router.delete('/invites/:code', (req, res) => {
  deleteInvite(req.params.code);
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Password reset for a user                                          */
/* ------------------------------------------------------------------ */

router.post('/users/:id/password', async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  const password = String(req.body?.password || '');
  if (password.length < 8) {
    return res.status(400).json({ error: 'weak_password', message: 'Минимум 8 символов' });
  }
  const { hashPassword } = await import('../util.js');
  updateUser(user.id, { password_hash: hashPassword(password) });
  logEvent('password_changed', `Пароль изменён: ${user.email}`, { userId: user.id, ip: req.ip });
  res.json({ ok: true });
});

router.post('/me/password', async (req, res) => {
  const { verifyPassword, hashPassword } = await import('../util.js');
  const current = String(req.body?.currentPassword || '');
  const next = String(req.body?.newPassword || '');
  if (!verifyPassword(current, req.user.password_hash)) {
    return res.status(400).json({ error: 'invalid', message: 'Текущий пароль неверен' });
  }
  if (next.length < 8) {
    return res.status(400).json({ error: 'weak_password', message: 'Минимум 8 символов' });
  }
  updateUser(req.user.id, { password_hash: hashPassword(next) });
  logEvent('password_changed', 'Пароль изменён', { userId: req.user.id, ip: req.ip });
  res.json({ ok: true });
});

router.post('/me/refresh-key', async (req, res) => {
  updateUser(req.user.id, {
    vless_uuid: randomUuid(),
    vless_tag: randomTag('gv'),
    sub_token: buildSubToken(),
  });
  await reloadClients().catch(() => {});
  logEvent('key_rotated', 'Ключ перевыпущен', { userId: req.user.id, ip: req.ip });
  res.json({ ok: true });
});

export default router;
