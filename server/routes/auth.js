/**
 * GhostVPN - authentication routes.
 */
import express from 'express';
import { config } from '../config.js';
import { clientIp, destroySession, issueSession, rateLimit, requireAuth } from '../auth.js';
import {
  consumeInvite,
  findUserByEmail,
  findUserByUsername,
  logEvent,
  updateUser,
} from '../db.js';
import { ServiceError, createUser, publicUser, verifyPassword } from '../service.js';
import { isEmail, isWeakPassword } from '../util.js';

const router = express.Router();

const loginLimiter = rateLimit({ windowMs: 10 * 60_000, max: 20 });
const registerLimiter = rateLimit({ windowMs: 60 * 60_000, max: 10 });

/** POST /api/auth/register */
router.post('/register', registerLimiter, async (req, res) => {
  try {
    if (!config.registrationOpen) {
      throw new ServiceError('Регистрация временно закрыта', 403, 'registration_closed');
    }
    const { email, username, password, invite } = req.body || {};

    if (!isEmail(email)) throw new ServiceError('Некорректный e-mail', 400, 'bad_email');
    if (!username || String(username).length < 3) {
      throw new ServiceError('Имя пользователя: минимум 3 символа', 400, 'bad_username');
    }
    if (!/^[a-zA-Z0-9_.@-]+$/.test(String(username))) {
      throw new ServiceError('Имя пользователя: только латиница, цифры и . _ - @', 400, 'bad_username');
    }
    if (isWeakPassword(password)) {
      throw new ServiceError('Пароль слишком простой (минимум 8 символов)', 400, 'weak_password');
    }

    const code = String(invite || '').trim();
    if (config.inviteRequired || config.inviteCodes.length) {
      const known = config.inviteCodes.includes(code);
      const dbInvite = known ? { ok: true } : consumeInvite(code);
      if (!dbInvite.ok) {
        throw new ServiceError('Нужен действующий инвайт-код', 403, 'invite_required');
      }
    }

    const user = createUser({
      email,
      username,
      password,
      ip: clientIp(req),
    });

    issueSession(user, req, res);
    res.status(201).json({ ok: true, user: publicUser(user) });
  } catch (err) {
    const status = err instanceof ServiceError ? err.status : 500;
    if (status === 500) console.error('[register]', err);
    res.status(status).json({
      error: err.code || 'error',
      message: status === 500 ? 'Внутренняя ошибка сервера' : err.message,
    });
  }
});

/** POST /api/auth/login */
router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { login, password } = req.body || {};
    const identifier = String(login || '').trim().toLowerCase();
    if (!identifier || !password) {
      throw new ServiceError('Введите логин и пароль', 400, 'missing_credentials');
    }
    const user = findUserByEmail(identifier) || findUserByUsername(identifier);
    if (!user || !verifyPassword(password, user.password_hash)) {
      logEvent('login_failed', `Неудачный вход: ${identifier}`, { ip: clientIp(req) });
      throw new ServiceError('Неверный логин или пароль', 401, 'invalid_credentials');
    }
    if (user.status === 'banned') {
      throw new ServiceError('Аккаунт заблокирован', 403, 'banned');
    }
    updateUser(user.id, { last_login_at: Date.now(), last_seen_ip: clientIp(req) });
    issueSession(user, req, res);
    logEvent('login', `Вход: ${user.email}`, { userId: user.id, ip: clientIp(req) });
    res.json({ ok: true, user: publicUser(user) });
  } catch (err) {
    const status = err instanceof ServiceError ? err.status : 500;
    if (status === 500) console.error('[login]', err);
    res.status(status).json({
      error: err.code || 'error',
      message: status === 500 ? 'Внутренняя ошибка сервера' : err.message,
    });
  }
});

/** POST /api/auth/logout */
router.post('/logout', (req, res) => {
  destroySession(req, res);
  res.json({ ok: true });
});

/** GET /api/auth/me */
router.get('/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: publicUser(req.user) });
});

export default router;
