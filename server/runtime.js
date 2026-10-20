/**
 * GhostVPN - runtime settings.
 *
 * Environment variables (.env) provide the defaults; everything the admin
 * changes in the web interface is stored in the database and overrides them.
 */
import { config } from './config.js';
import { getSettings } from './db.js';

const num = (v, d) => (v === undefined || v === null || v === '' ? d : Number(v) || 0);
const bool = (v, d) => (v === undefined || v === null || v === '' ? d : ['1', 'true', 'yes', 'on'].includes(String(v).toLowerCase()));

let cache = { at: 0, value: null };

export function rt() {
  if (cache.value && Date.now() - cache.at < 3000) return cache.value;
  const s = getSettings();
  const value = {
    serverPort: num(s.server_port, config.serverPort),
    realitySni: s.reality_sni || config.reality.sni,
    realityDest: s.reality_dest || config.reality.dest,
    realityFingerprint: s.reality_fingerprint || config.reality.fingerprint,
    loglevel: s.loglevel || 'warning',
    siteName: s.site_name || config.site.name,
    siteTagline: s.site_tagline || config.site.tagline,
    supportUrl: s.support_url !== undefined ? s.support_url : config.site.supportUrl,
    currency: s.currency || config.site.currency,
    prices: {
      '1m': num(s.price_1m, config.site.prices['1m']),
      '3m': num(s.price_3m, config.site.prices['3m']),
      '6m': num(s.price_6m, config.site.prices['6m']),
      '12m': num(s.price_12m, config.site.prices['12m']),
    },
    registrationOpen: bool(s.registration_open, config.registrationOpen),
    inviteRequired: bool(s.invite_required, config.inviteRequired),
    deviceLimit: num(s.device_limit, config.deviceLimit),
    defaultTrafficGb: num(s.default_traffic_gb, config.defaultTrafficGb),
    trialDays: num(s.trial_days, config.trialDays),
  };
  cache = { at: Date.now(), value };
  return value;
}

export function invalidate() {
  cache = { at: 0, value: null };
}
