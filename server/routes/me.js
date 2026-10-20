/**
 * GhostVPN - user cabinet API.
 */
import express from 'express';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { requireAuth } from '../auth.js';
import { effectiveStatus, publicUser } from '../service.js';
import { buildUserLinks } from '../subscription.js';
import { ensureRealityKeys, onlineCount, onlineIps } from '../xray.js';
import { daysLeft, formatDate, toGb } from '../util.js';

const router = express.Router();

router.use(requireAuth);

/** GET /api/me - full profile of the current user. */
router.get('/', async (req, res) => {
  try {
    const user = req.user;
    const status = effectiveStatus(user);
    const reality = await ensureRealityKeys();
    const links = buildUserLinks(user, reality, { req });
    const online = await onlineCount(user.vless_tag);
    const ips = await onlineIps(user.vless_tag);

    res.json({
      ok: true,
      user: {
        ...publicUser(user),
        status,
        daysLeft: daysLeft(user.expires_at),
        expiresLabel: formatDate(user.expires_at),
        trafficUsedLabel: `${toGb(user.traffic_used)} GB`,
        trafficLimitLabel: user.traffic_limit
          ? `${toGb(user.traffic_limit)} GB`
          : 'без лимита',
        trafficPercent:
          user.traffic_limit > 0
            ? Math.min(100, Math.round((user.traffic_used / user.traffic_limit) * 100))
            : 0,
      },
      key: {
        uuid: user.vless_uuid,
        links: links.links,
        primary: links.primary,
        host: links.host,
        port: links.port,
        sni: links.sni,
        publicKey: links.publicKey,
        shortId: links.shortId,
        fingerprint: links.fingerprint,
      },
      subscription: {
        url: `/sub/${user.sub_token}`,
        links: [
          { name: 'v2rayN / v2rayNG / Hiddify', url: `/sub/${user.sub_token}` },
          { name: 'Clash / Clash Meta', url: `/sub/${user.sub_token}?format=clash` },
          { name: 'sing-box', url: `/sub/${user.sub_token}?format=singbox` },
          { name: 'JSON (raw)', url: `/sub/${user.sub_token}?format=json` },
        ],
      },
      online: { sessions: online, ips },
    });
  } catch (err) {
    console.error('[me]', err);
    res.status(500).json({ error: 'error', message: 'Не удалось собрать профиль' });
  }
});

/** GET /api/me/qr.png - QR code of the primary link. */
router.get('/qr.png', async (req, res) => {
  try {
    const reality = await ensureRealityKeys();
    const links = buildUserLinks(req.user, reality, { req });
    const png = await QRCode.toBuffer(links.primary, {
      type: 'png',
      width: 512,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#0b1020', light: '#ffffff' },
    });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch (err) {
    console.error('[qr]', err);
    res.status(500).json({ error: 'error', message: 'Не удалось построить QR-код' });
  }
});

/** GET /api/me/key - plain text key for copy/paste. */
router.get('/key', async (req, res) => {
  try {
    const reality = await ensureRealityKeys();
    const links = buildUserLinks(req.user, reality, { req });
    res.type('text/plain; charset=utf-8').send(links.links.join('\n'));
  } catch (err) {
    console.error('[key]', err);
    res.status(500).json({ error: 'error', message: 'Не удалось получить ключ' });
  }
});

export default router;
