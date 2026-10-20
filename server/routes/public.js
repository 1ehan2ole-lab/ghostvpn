/**
 * GhostVPN - public endpoints (landing page data, health check).
 */
import express from 'express';
import { config } from '../config.js';
import { countActiveUsers, countUsers } from '../db.js';
import { onlineSummary } from '../xray.js';
import { getPublicHost } from '../subscription.js';

const router = express.Router();

const startedAt = Date.now();

/** GET /api/public/info */
router.get('/info', async (req, res) => {
  let online = 0;
  try {
    online = (await onlineSummary()).total;
  } catch {
    online = 0;
  }
  res.json({
    ok: true,
    site: {
      name: config.site.name,
      tagline: config.site.tagline,
      supportUrl: config.site.supportUrl,
      currency: config.site.currency,
      prices: config.site.prices,
    },
    registrationOpen: config.registrationOpen,
    inviteRequired: config.inviteRequired,
    stats: {
      users: countUsers(),
      activeUsers: countActiveUsers(),
      online,
      uptime: Math.floor((Date.now() - startedAt) / 1000),
    },
    server: {
      host: getPublicHost(req),
      port: config.serverPort,
      sni: config.reality.sni,
    },
  });
});

/** GET /api/health */
router.get('/health', (req, res) => {
  res.json({
    ok: true,
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    time: new Date().toISOString(),
  });
});

export default router;
