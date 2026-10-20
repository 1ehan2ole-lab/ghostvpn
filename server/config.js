/**
 * GhostVPN - configuration loader.
 *
 * Reads .env (if present), applies defaults and exposes a frozen config
 * object used by every other module.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/* ------------------------------------------------------------------ */
/* .env parsing (tiny, dependency free)                                */
/* ------------------------------------------------------------------ */

function parseEnvFile(file) {
  if (!fs.existsSync(file)) return {};
  const out = {};
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const fileEnv = parseEnvFile(path.join(ROOT, '.env'));
// Real environment variables always win over the .env file.
const env = { ...fileEnv, ...process.env };

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
const bool = (value, fallback) => {
  if (value === undefined || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};
const str = (value, fallback = '') => (value === undefined || value === null ? fallback : String(value));

/* ------------------------------------------------------------------ */
/* Derived paths                                                       */
/* ------------------------------------------------------------------ */

const DATA_DIR = path.resolve(ROOT, str(env.DATA_DIR, './data'));
const resolveBin = (p) => (path.isAbsolute(p) ? p : path.resolve(ROOT, p));

export const config = Object.freeze({
  root: ROOT,
  env: str(env.NODE_ENV, 'development'),
  port: num(env.PORT, 8080),
  host: str(env.HOST, '0.0.0.0'),
  publicUrl: str(env.PUBLIC_URL, '').replace(/\/+$/, ''),
  trustProxy: bool(env.TRUST_PROXY, false),
  // Разрешённые источники для CORS (пусто = только свой домен).
  // Нужно, если сайт опубликован отдельно от панели (например, GitHub Pages).
  corsOrigins: str(env.CORS_ORIGINS, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),

  dataDir: DATA_DIR,
  dbPath: path.join(DATA_DIR, 'ghostvpn.db'),
  xrayConfigPath: path.join(DATA_DIR, 'xray', 'config.json'),
  xrayLogPath: path.join(DATA_DIR, 'xray', 'xray.log'),
  logDir: path.join(DATA_DIR, 'logs'),

  xrayBin: resolveBin(str(env.XRAY_BIN, './vendor/xray/xray.exe')),
  serverHost: str(env.SERVER_HOST, ''),
  serverPort: num(env.SERVER_PORT, 443),

  reality: {
    sni: str(env.REALITY_SNI, 'www.apple.com'),
    dest: str(env.REALITY_DEST, 'www.apple.com:443'),
    publicKey: str(env.REALITY_PUBKEY, ''),
    privateKey: str(env.REALITY_PRIVATE_KEY, ''),
    shortId: str(env.REALITY_SHORT_ID, ''),
    shortIds: str(env.REALITY_SHORT_IDS, '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    fingerprint: str(env.REALITY_FINGERPRINT, 'chrome'),
  },

  site: {
    name: str(env.SITE_NAME, 'GhostVPN'),
    tagline: str(env.SITE_TAGLINE, 'Приватный и быстрый VPN'),
    supportUrl: str(env.SUPPORT_URL, ''),
    currency: str(env.CURRENCY, '$'),
    prices: {
      '1m': num(env.PRICE_1M, 4.99),
      '3m': num(env.PRICE_3M, 12.99),
      '6m': num(env.PRICE_6M, 22.99),
      '12m': num(env.PRICE_12M, 39.99),
    },
  },

  defaultTrafficGb: num(env.DEFAULT_TRAFFIC_GB, 0),
  trialDays: num(env.TRIAL_DAYS, 0),
  registrationOpen: bool(env.REGISTRATION_OPEN, true),
  inviteRequired: bool(env.INVITE_REQUIRED, false),
  inviteCodes: str(env.INVITE_CODES, '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  deviceLimit: num(env.DEVICE_LIMIT, 3),

  admin: {
    email: str(env.ADMIN_EMAIL, 'admin@ghostvpn.local'),
    password: str(env.ADMIN_PASSWORD, ''),
  },

  sessionTtlMs: num(env.SESSION_TTL_HOURS, 168) * 3600 * 1000,
});

/** Ensure the writable directories exist. */
export function ensureDirs() {
  for (const dir of [config.dataDir, path.dirname(config.xrayConfigPath), config.logDir]) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export default config;
