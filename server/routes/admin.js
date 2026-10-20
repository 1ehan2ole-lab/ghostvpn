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
  findPayment,
  findUserById,
  listEvents,
  listInvites,
  listPayments,
  listUsers,
  logEvent,
  setSetting,
  updatePayment,
  updateUser,
} from '../db.js';
import {
  ServiceError,
  adminUser,
  approvePayment,
  createUser,
  effectiveStatus,
 } from '../service.js';
import { GB, randomTag, randomUuid, toGb } from '../util.js';
import { buildSubToken, buildUserLinks } from '../subscription.js';
import { detectLanIp } from '../subscription.js';
import {
  ensureRealityKeys,
  isRunning,
  lastXrayError,
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
  'server_port', 'public_url', 'reality_sni', 'reality_dest', 'reality_fingerprint', 'loglevel',
  'allow_quic',
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

/* ------------------------------------------------------------------ */
/* Payments                                                            */
/* ------------------------------------------------------------------ */

router.get('/payments', (req, res) => {
  res.json({ ok: true, payments: listPayments() });
});

router.post('/payments/:id/paid', async (req, res) => {
  const payment = findPayment(req.params.id);
  if (!payment) return res.status(404).json({ error: 'not_found', message: 'Заявка не найдена' });
  if (payment.status === 'paid') {
    return res.status(400).json({ error: 'already_paid', message: 'Заявка уже оплачена' });
  }
  const user = await approvePayment(payment);
  logEvent('payment_paid', `Заявка #${payment.id} подтверждена`, { userId: user.id, ip: req.ip });
  res.json({ ok: true, user: adminUser(user) });
});

router.post('/payments/:id/reject', (req, res) => {
  const payment = findPayment(req.params.id);
  if (!payment) return res.status(404).json({ error: 'not_found', message: 'Заявка не найдена' });
  updatePayment(payment.id, { status: 'rejected', comment: String(req.body?.comment || '') });
  res.json({ ok: true });
});

/* ------------------------------------------------------------------ */
/* Node diagnostics                                                   */
/* ------------------------------------------------------------------ */

/**
 * GET /api/admin/node-check
 * Проверяет, доступны ли с ноды YouTube и остальные сервисы.
 * Панель работает на самой ноде, поэтому запрос идёт её egress-ом.
 */
router.get('/node-check', async (req, res) => {
  const targets = [
    { name: 'YouTube', url: 'https://www.youtube.com/', critical: true },
    { name: 'YouTube API', url: 'https://youtubei.googleapis.com/', critical: true },
    { name: 'Google Video CDN', url: 'https://redirector.googlevideo.com/', critical: true },
    { name: 'Google', url: 'https://www.google.com/generate_204' },
    { name: 'Cloudflare DNS', url: 'https://1.1.1.1/' },
    { name: 'IP-адрес ноды', url: 'https://api.ipify.org/?format=json' },
  ];

  const results = await Promise.all(targets.map(async (target) => {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const response = await fetch(target.url, {
        signal: controller.signal,
        redirect: 'manual',
        headers: { 'User-Agent': 'Mozilla/5.0 GhostVPN-Check' },
      });
      clearTimeout(timer);
      let detail = '';
      if (target.name === 'IP-адрес ноды') {
        detail = (await response.text()).trim();
      }
      return { ...target, ok: true, status: response.status, ms: Date.now() - started, detail };
    } catch (err) {
      clearTimeout(timer);
      return {
        ...target,
        ok: false,
        ms: Date.now() - started,
        error: err.name === 'AbortError' ? 'таймаут' : String(err.message || err),
      };
    }
  }));

  const youtubeBroken = results.filter((r) => r.critical && !r.ok);
  res.json({
    ok: true,
    results,
    youtubeOk: youtubeBroken.length === 0,
    hint: youtubeBroken.length
      ? 'YouTube недоступен с ноды: IP сервера заблокирован Google или провайдером. ' +
        'Решения: другой IP/VPS, другой REALITY dest, либо проверьте QUIC в настройках.'
      : 'YouTube с ноды доступен.',
  });
});

/* ------------------------------------------------------------------ */
/* Network addresses                                                   */
/* ------------------------------------------------------------------ */

/** GET /api/admin/network - адреса, которые можно использовать в ключах. */
router.get('/network', (req, res) => {
  const lanIp = detectLanIp();
  res.json({
    ok: true,
    lanIp,
    publicUrl: rt().publicUrl || '',
    serverHost: config.serverHost || '',
    serverPort: rt().serverPort,
    host: String(req.headers.host || ''),
    suggested: rt().publicUrl || lanIp || config.serverHost || String(req.headers.host || ''),
  });
});

/* ------------------------------------------------------------------ */
/* Batch key generation                                                */
/* ------------------------------------------------------------------ */

/**
 * POST /api/admin/batch-keys
 * Массовая генерация ключей: количество, срок, лимит трафика, тариф.
 * Созданные аккаунты могут сразу быть активными или ждать оплаты.
 */
router.post('/batch-keys', async (req, res) => {
  try {
    const body = req.body || {};
    const count = Math.max(1, Math.min(500, Number(body.count || 1)));
    const days = Math.max(0, Math.min(3650, Number(body.days || 30)));
    const trafficGb = Math.max(0, Math.min(10000, Number(body.trafficGb || 0)));
    const plan = String(body.plan || '').slice(0, 40);
    const label = String(body.label || `Партия ${new Date().toISOString().slice(0, 10)}`).slice(0, 80);
    const activate = body.activate === true;
    const prefix = String(body.usernamePrefix || 'key').replace(/[^a-zA-Z0-9_.-]/g, '').slice(0, 16) || 'key';
    const emailDomain = String(body.emailDomain || '').trim();
    const price = Number(body.price || 0);
    const deviceLimit = Math.max(0, Number(body.deviceLimit ?? rt().deviceLimit));

    const created = [];
    const failed = [];

    for (let i = 0; i < count; i++) {
      const suffix = Math.random().toString(36).slice(2, 8);
      const username = `${prefix}_${suffix}`.toLowerCase();
      const email = emailDomain ? `${username}@${emailDomain}` : `${username}@ghostvpn.local`;
      const password = `gv${Math.random().toString(36).slice(2, 10)}${Math.random().toString(36).slice(2, 6)}`;

      try {
        const user = createUser({
          email,
          username,
          password,
          role: 'user',
          status: activate ? 'active' : 'pending',
          trafficLimitGb: trafficGb,
          expiresAt: activate && days > 0 ? Date.now() + days * 86400000 : 0,
          deviceLimit,
          note: label,
          ip: req.ip,
        });

        const reality = await ensureRealityKeys();
        const links = buildUserLinks(user, reality, { req });
        created.push({
          id: user.id,
          email: user.email,
          username: user.username,
          password,
          uuid: user.vless_uuid,
          status: user.status,
          key: links.primary,
          subscription: `${rt().publicUrl || `http://localhost:${config.port}`}/sub/${user.sub_token}`,
          expiresAt: user.expires_at,
          days,
          trafficLimitGb: trafficGb,
          price,
          plan,
        });
      } catch (err) {
        failed.push({ index: i, message: err.message });
      }
    }

    logEvent('batch_keys', `Сгенерировано ключей: ${created.length} (${label}, ${days} дн.)`, { ip: req.ip });

    res.status(201).json({ ok: true, created, failed, label, plan, days, trafficGb, price });
  } catch (err) {
    console.error('[batch-keys]', err);
    res.status(500).json({ error: 'error', message: 'Не удалось сгенерировать ключи' });
  }
});

/** GET /api/admin/batches - сгруппированные по метке партии. */
router.get('/batches', (req, res) => {
  const users = listUsers();
  const map = new Map();
  for (const user of users) {
    const label = user.note || 'Без метки';
    if (!map.has(label)) {
      map.set(label, { label, count: 0, active: 0, pending: 0, trafficLimit: 0, trafficUsed: 0, createdAt: 0 });
    }
    const item = map.get(label);
    item.count += 1;
    if (user.status === 'active') item.active += 1;
    if (user.status === 'pending') item.pending += 1;
    item.trafficLimit += user.traffic_limit;
    item.trafficUsed += user.traffic_used;
    if (!item.createdAt || user.created_at < item.createdAt) item.createdAt = user.created_at;
  }
  const batches = [...map.values()].sort((a, b) => b.createdAt - a.createdAt);
  res.json({ ok: true, batches });
});

/** GET /api/admin/export?label=...&format=csv|txt - выгрузка ключей. */
router.get('/export', async (req, res) => {
  const label = String(req.query.label || '');
  const format = String(req.query.format || 'csv').toLowerCase();
  const users = listUsers().filter((u) => (label ? u.note === label : true));
  const reality = await ensureRealityKeys();

  if (format === 'txt') {
    const lines = users.map((u) => buildUserLinks(u, reality, { req }).primary);
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="ghostvpn-keys.txt"`);
    res.send(lines.join('\n'));
    return;
  }

  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const header = ['email', 'username', 'password', 'status', 'key', 'subscription', 'expires_at', 'traffic_limit_gb', 'traffic_used_gb', 'label'];
  const rows = users.map((u) => {
    const links = buildUserLinks(u, reality, { req });
    return [
      u.email,
      u.username,
      '',
      u.status,
      links.primary,
      `${rt().publicUrl || `http://localhost:${config.port}`}/sub/${u.sub_token}`,
      u.expires_at ? new Date(u.expires_at).toISOString().slice(0, 10) : '',
      toGb(u.traffic_limit),
      toGb(u.traffic_used),
      u.note,
    ].map(escape).join(',');
  });
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="ghostvpn-keys.csv"`);
  res.send('\ufeff' + [header.map(escape).join(','), ...rows].join('\n'));
});

/** POST /api/admin/users/:id/activate - активировать оплаченный ключ. */
router.post('/users/:id/activate', async (req, res) => {
  const user = findUserById(req.params.id);
  if (!user) return res.status(404).json({ error: 'not_found', message: 'Пользователь не найден' });
  const days = Number(req.body?.days || 30);
  const base = user.expires_at > Date.now() ? user.expires_at : Date.now();
  updateUser(user.id, { status: 'active', expires_at: base + days * 86400000 });
  await reloadClients().catch(() => {});
  logEvent('user_activated', `Активирован ключ: ${user.email}`, { userId: user.id, ip: req.ip });
  res.json({ ok: true, user: adminUser(findUserById(user.id)) });
});

export default router;
