/**
 * GhostVPN - application entry point.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';
import { config, ensureDirs } from './config.js';
import { initDb, deleteExpiredSessions, checkpoint, backupDatabase, checkIntegrity } from './db.js';
import { attachUser, csrfGuard } from './auth.js';
import { bootstrapAdmin, syncTraffic } from './service.js';
import { ensureRealityKeys, isRunning, startXray, stopXray, xrayBinaryExists } from './xray.js';
import { rt } from './runtime.js';

import authRoutes from './routes/auth.js';
import meRoutes from './routes/me.js';
import subRoutes from './routes/sub.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';

const WEB_DIR = path.join(config.root, 'web');

export function createApp() {
  ensureDirs();
  initDb();
  deleteExpiredSessions();

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', true);

  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());
  app.use(attachUser);
  app.use(csrfGuard);

  // Security headers (lightweight, no external dependency).
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Robots-Tag', 'index, follow');
    next();
  });

  /* -------------------------------------------------------------- */
  /* API                                                             */
  /* -------------------------------------------------------------- */

  // Канонический хост нужен только когда задан публичный адрес (домен):
  // тогда любой другой хост отправляем на него. Локальные адреса (localhost,
  // 127.0.0.1) не трогаем - иначе в адресной строке прыгает на localhost.
  app.use((req, res, next) => {
    if (!config.publicUrl) return next();
    const host = String(req.headers.host || '');
    let canonical = null;
    try {
      const publicHost = new URL(config.publicUrl).host;
      if (publicHost && host !== publicHost) canonical = publicHost;
    } catch {
      /* некорректный PUBLIC_URL - игнорируем */
    }
    const isApiLike = req.path.startsWith('/api/') || req.path.startsWith('/sub/');
    if (canonical && req.method === 'GET' && !isApiLike) {
      return res.redirect(301, `${req.protocol}://${canonical}${req.originalUrl}`);
    }
    next();
  });

  // CORS для статического сайта, опубликованного отдельно от панели.
  // Credentials не разрешаются - cookie никогда не уходят на другой домен.
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (origin && config.corsOrigins.includes(origin)) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,PUT,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
      res.setHeader('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  app.use('/api/auth', authRoutes);
  app.use('/api/me', meRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/public', publicRoutes);
  app.use('/sub', subRoutes);

  app.get('/api/health', (req, res) => {
    res.json({ ok: true, uptime: Math.floor((Date.now() - startedAt) / 1000), time: new Date().toISOString() });
  });

  app.get('/api/config', (req, res) => {
    const s = rt();
    res.json({
      ok: true,
      site: {
        name: s.siteName,
        tagline: s.siteTagline,
        supportUrl: s.supportUrl,
        currency: s.currency,
        prices: s.prices,
      },
      registrationOpen: s.registrationOpen,
      inviteRequired: s.inviteRequired,
      user: req.user
        ? { id: req.user.id, email: req.user.email, username: req.user.username, role: req.user.role }
        : null,
    });
  });

  app.use('/api', (req, res) => {
    res.status(404).json({ error: 'not_found', message: 'Метод не найден' });
  });

  /* -------------------------------------------------------------- */
  /* Static site                                                     */
  /* -------------------------------------------------------------- */

  const PAGES = {
    '/': 'index.html',
    '/login': 'login.html',
    '/register': 'register.html',
    '/dashboard': 'dashboard.html',
    '/admin': 'admin.html',
    '/download': 'download.html',
    '/docs': 'docs.html',
  };

  app.get(Object.keys(PAGES), (req, res) => {
    res.sendFile(path.join(WEB_DIR, PAGES[req.path]));
  });

  app.use(
    express.static(WEB_DIR, {
      extensions: ['html'],
      maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
      },
    }),
  );

  /* -------------------------------------------------------------- */
  /* Errors                                                          */
  /* -------------------------------------------------------------- */

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error('[error]', err);
    if (res.headersSent) return;
    res.status(500).json({ error: 'internal', message: 'Внутренняя ошибка сервера' });
  });

  return app;
}

const startedAt = Date.now();
let server = null;

/** Boot the HTTP server and the xray core. */
export async function start() {
  const app = createApp();
  server = app.listen(config.port, config.host, () => {
    const url = config.publicUrl || `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`;
    console.log(`\n  ${config.site.name} -> ${url}`);
    console.log(`  панель: ${url}/admin`);
  });

  const admin = bootstrapAdmin();
  if (admin) {
    console.log('\n  ┌─────────────────────────────────────────────┐');
    console.log('  │ Создан администратор                        │');
    console.log(`  │ E-mail:  ${admin.user.email.padEnd(34)}│`);
    console.log(`  │ Пароль:  ${String(admin.password).padEnd(34)}│`);
    console.log('  └─────────────────────────────────────────────┘\n');
  }

  // Целостность БД и ежедневная резервная копия.
  const integrity = checkIntegrity();
  if (!integrity.ok) console.error('[db] ПРОБЛЕМА ЦЕЛОСТНОСТИ БД:', integrity.message);
  else console.log('  ✓ целостность БД: ok');
  const backup = backupDatabase();
  if (backup) console.log('  ✓ резервная копия: ' + backup);
  try {
    await ensureRealityKeys();
  } catch (err) {
    console.error('[xray] не удалось сгенерировать ключи REALITY:', err.message);
  }
  if (xrayBinaryExists()) {
    try {
      const { pid } = await startXray();
      console.log(`  xray запущен (pid ${pid}), порт ${rt().serverPort}`);
    } catch (err) {
      console.error('[xray] не удалось запустить:', err.message);
    }
  } else {
    console.log('  xray не найден - выполните "npm run xray:install"');
  }

  const syncTimer = setInterval(() => {
    syncTraffic().catch((err) => console.error('[traffic]', err.message));
  }, 30_000);
  syncTimer.unref?.();

  // Регулярный чекпойнт WAL: основной файл БД не должен отставать.
  const checkpointTimer = setInterval(() => checkpoint(), 60_000);
  checkpointTimer.unref?.();

  // Watchdog: bring the xray core back if it dies.
  const watchdog = setInterval(() => {
    if (!isRunning() && xrayBinaryExists()) {
      startXray()
        .then(() => console.log('  xray автоматически перезапущен'))
        .catch((err) => console.error('[xray] автозапуск не удался:', err.message));
    }
  }, 20_000);
  watchdog.unref?.();

  return { app, server, syncTimer, checkpointTimer, watchdog };
}

async function shutdown(signal) {
  console.log(`\n  ${signal} - останавливаюсь...`);
  try {
    if (isRunning()) await stopXray();
  } catch {
    /* ignore */
  }
  try {
    checkpoint();
  } catch {
    /* ignore */
  }
  server?.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref?.();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

/* Start automatically when executed directly. */
const executedDirectly = process.argv[1] &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (executedDirectly) {
  start().catch((err) => console.error('[boot]', err));
}

export default createApp;
