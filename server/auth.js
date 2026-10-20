/**
 * GhostVPN - authentication & middleware.
 */
import { randomToken, sha256 } from './util.js';
import { config } from './config.js';
import {
  createSession,
  deleteSession,
  findSession,
  findUserById,
  findUserBySubToken,
  logEvent,
} from './db.js';

export const SESSION_COOKIE = 'gv_session';

/* ------------------------------------------------------------------ */
/* Sessions                                                            */
/* ------------------------------------------------------------------ */

export function issueSession(user, req, res) {
  const id = randomToken(32);
  const expiresAt = Date.now() + config.sessionTtlMs;
  createSession({
    id,
    userId: user.id,
    expiresAt,
    ip: clientIp(req),
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
  });

  const base = {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecure(req),
    maxAge: config.sessionTtlMs,
    path: '/',
  };

  res.cookie(SESSION_COOKIE, id, base);

  // Локальная установка: 127.0.0.1 и localhost - разные cookie-домены.
  // Дублируем cookie, чтобы сессия не терялась при переходе между ними.
  const hostname = String(req.headers.host || '').split(':')[0];
  if (hostname === '127.0.0.1' || hostname === '[::1]') {
    res.cookie(SESSION_COOKIE, id, { ...base, domain: 'localhost' });
  }
  if (hostname === 'localhost') {
    res.cookie(SESSION_COOKIE, id, { ...base, domain: 'localhost' });
  }

  return { id, expiresAt };
}

export function destroySession(req, res) {
  const id = req.cookies?.[SESSION_COOKIE];
  if (id) deleteSession(id);
  res.clearCookie(SESSION_COOKIE, { path: '/' });
}

export function clientIp(req) {
  if (config.trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return String(fwd).split(',')[0].trim();
  }
  return String(req.ip || req.socket?.remoteAddress || '').replace(/^::ffff:/, '');
}

export function isSecure(req) {
  if (config.trustProxy && String(req.headers['x-forwarded-proto'] || '').startsWith('https')) {
    return true;
  }
  return Boolean(req.secure);
}

/* ------------------------------------------------------------------ */
/* Middleware                                                          */
/* ------------------------------------------------------------------ */

/** Resolve the current user from the session cookie or a bearer token. */
export function attachUser(req, res, next) {
  req.user = null;
  const bearer = String(req.headers.authorization || '');
  if (bearer.startsWith('Bearer ')) {
    const token = bearer.slice(7).trim();
    const user = findUserBySubToken(sha256(token)) || findUserBySubToken(token);
    if (user) req.user = user;
  }
  if (!req.user) {
    const sid = req.cookies?.[SESSION_COOKIE];
    if (sid) {
      const session = findSession(sid);
      if (session && session.expires_at > Date.now()) {
        req.user = findUserById(session.user_id);
        req.session = session;
      }
    }
  }
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Требуется вход' });
  }
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ error: 'unauthorized', message: 'Требуется вход' });
  }
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'forbidden', message: 'Недостаточно прав' });
  }
  next();
}

/* ------------------------------------------------------------------ */
/* Rate limiting (in-memory, per key)                                 */
/* ------------------------------------------------------------------ */

const buckets = new Map();

export function rateLimit({ windowMs = 60_000, max = 30, key } = {}) {
  return (req, res, next) => {
    const id = key ? key(req) : clientIp(req);
    const now = Date.now();
    const entry = buckets.get(id) || { count: 0, reset: now + windowMs };
    if (now > entry.reset) {
      entry.count = 0;
      entry.reset = now + windowMs;
    }
    entry.count += 1;
    buckets.set(id, entry);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(Math.max(0, max - entry.count)));
    if (entry.count > max) {
      logEvent('rate_limit', `${req.method} ${req.originalUrl}`, { ip: clientIp(req) });
      return res.status(429).json({ error: 'rate_limited', message: 'Слишком много запросов, попробуйте позже' });
    }
    next();
  };
}

/** Simple origin check for state-changing requests. */
export function csrfGuard(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  if (!origin) return next();
  const host = String(req.headers.host || '');
  try {
    const originHost = new URL(origin).host;
    if (originHost !== host) {
      return res.status(403).json({ error: 'bad_origin', message: 'Запрос отклонён' });
    }
  } catch {
    return res.status(403).json({ error: 'bad_origin', message: 'Запрос отклонён' });
  }
  next();
}
