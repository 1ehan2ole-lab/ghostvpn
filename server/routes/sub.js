/**
 * GhostVPN - subscription endpoints.
 *
 *   GET /sub/:token              -> base64 v2ray subscription
 *   GET /sub/:token?format=clash -> Clash / Clash.Meta YAML
 *   GET /sub/:token?format=singbox
 *   GET /sub/:token?format=json  -> raw JSON
 */
import express from 'express';
import { config } from '../config.js';
import { findUserBySubToken } from '../db.js';
import { effectiveStatus } from '../service.js';
import {
  buildUserLinks,
  clashSubscription,
  singboxSubscription,
  v2raySubscription,
} from '../subscription.js';
import { ensureRealityKeys } from '../xray.js';

const router = express.Router();

const NO_ACCESS = 'profile: Expired or disabled';

function resolveUser(req, res) {
  const token = String(req.params.token || '').trim();
  const user = findUserBySubToken(token);
  if (!user) {
    res.status(404).type('text/plain; charset=utf-8').send(NO_ACCESS);
    return null;
  }
  const status = effectiveStatus(user);
  if (status !== 'active') {
    res.status(403).type('text/plain; charset=utf-8').send(NO_ACCESS);
    return null;
  }
  return user;
}

router.get('/:token', async (req, res) => {
  try {
    const user = resolveUser(req, res);
    if (!user) return;
    const format = String(req.query.format || 'v2ray').toLowerCase();
    const reality = await ensureRealityKeys();
    const opts = buildUserLinks(user, reality, { req });

    if (format === 'clash' || format === 'clash.meta' || format === 'mihomo') {
      res.type('text/yaml; charset=utf-8').send(clashSubscription(user, opts.links, opts));
      return;
    }
    if (format === 'singbox' || format === 'sing-box') {
      res.type('application/json; charset=utf-8').send(singboxSubscription(user, opts));
      return;
    }
    if (format === 'json') {
      res.type('application/json; charset=utf-8').send(
        JSON.stringify({ links: opts.links, key: opts }, null, 2),
      );
      return;
    }
    res.setHeader('Profile-Title', `base64:${Buffer.from(config.site.name).toString('base64')}`);
    res.setHeader('Subscription-Userinfo', subscriptionUserInfo(user));
    res.type('text/plain; charset=utf-8').send(v2raySubscription(opts.links));
  } catch (err) {
    console.error('[sub]', err);
    res.status(500).type('text/plain; charset=utf-8').send('internal error');
  }
});

function subscriptionUserInfo(user) {
  const parts = [];
  if (user.traffic_limit) parts.push(`upload=0; download=${user.traffic_used}`);
  if (user.expires_at) parts.push(`expire=${Math.floor(user.expires_at / 1000)}`);
  parts.push(`total=${user.traffic_limit || 0}`);
  return parts.join('; ');
}

export default router;
