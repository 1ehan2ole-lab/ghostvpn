/**
 * GhostVPN - Xray core manager.
 *
 * Responsibilities:
 *  - generate & persist REALITY key material
 *  - build the xray configuration from the user table
 *  - run / stop / restart the xray process
 *  - query per-user traffic statistics and online sessions
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, ensureDirs } from './config.js';
import { getSetting, setSetting, listUsers } from './db.js';
import { rt } from './runtime.js';

const execFileAsync = promisify(execFile);

const XRAY_API_PORT = Number(process.env.XRAY_API_PORT || 10085);
const API_SERVER = `127.0.0.1:${XRAY_API_PORT}`;

let child = null;
let lastError = '';

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

export function xrayBinaryExists() {
  return fs.existsSync(config.xrayBin);
}

function resolveBinary() {
  if (fs.existsSync(config.xrayBin)) return config.xrayBin;
  return 'xray'; // fall back to PATH
}

/** Run an xray CLI command and return stdout. */
async function xrayCli(args, { timeout = 15000 } = {}) {
  const { stdout } = await execFileAsync(resolveBinary(), args, {
    timeout,
    windowsHide: true,
    maxBuffer: 8 * 1024 * 1024,
  });
  return stdout;
}

/* ------------------------------------------------------------------ */
/* REALITY keys                                                        */
/* ------------------------------------------------------------------ */

/** REALITY short id: hex string, up to 8 bytes (16 hex chars). */
function randomShortId() {
  return crypto.randomBytes(8).toString('hex');
}

/**
 * Generate an X25519 keypair for REALITY without the external binary.
 * The format is byte-compatible with `xray x25519` (base64url of the raw keys).
 */
export function generateRealityKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('x25519');
  const privDer = privateKey.export({ type: 'pkcs8', format: 'der' });
  const pubDer = publicKey.export({ type: 'spki', format: 'der' });
  return {
    privateKey: privDer.subarray(privDer.length - 32).toString('base64url'),
    publicKey: pubDer.subarray(pubDer.length - 32).toString('base64url'),
  };
}

/**
 * Returns { privateKey, publicKey, shortId, shortIds }.
 * Keys are generated once and stored in the settings table.
 */
export async function ensureRealityKeys() {
  let privateKey = getSetting('reality_private_key', config.reality.privateKey);
  let publicKey = getSetting('reality_public_key', config.reality.publicKey);
  let shortIds = (getSetting('reality_short_ids', config.reality.shortIds.join(',')) || '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[0-9a-fA-F]{2,16}$/.test(s));

  if (!privateKey || !publicKey) {
    let generated = null;
    try {
      generated = generateRealityKeyPair();
    } catch (err) {
      // Запасной путь: генерация через ядро Xray.
      const out = await xrayCli(['x25519']);
      const priv = out.match(/PrivateKey:\s*(\S+)/i);
      const pub = out.match(/(?:Password \(PublicKey\)|PublicKey):\s*(\S+)/i);
      if (!priv || !pub) throw new Error(`Cannot generate REALITY keys: ${out}`);
      generated = { privateKey: priv[1], publicKey: pub[1] };
    }
    privateKey = generated.privateKey;
    publicKey = generated.publicKey;
    setSetting('reality_private_key', privateKey);
    setSetting('reality_public_key', publicKey);
  }

  if (!shortIds.length) {
    shortIds = [randomShortId()];
    setSetting('reality_short_ids', shortIds.join(','));
  }

  return { privateKey, publicKey, shortIds };
}

/* ------------------------------------------------------------------ */
/* Configuration builder                                                */
/* ------------------------------------------------------------------ */

export function buildXrayConfig({ reality, users, settings = {} }) {
  const port = Number(settings.server_port || config.serverPort);
  const sni = settings.reality_sni || config.reality.sni;
  const dest = settings.reality_dest || config.reality.dest;
  const fingerprint = settings.reality_fingerprint || config.reality.fingerprint;

  const clients = users
    .filter((u) => u.status === 'active')
    .map((u) => ({
      id: u.vless_uuid,
      flow: 'xtls-rprx-vision',
      email: u.vless_tag,
      level: 0,
    }));

  return {
    log: {
      loglevel: settings.loglevel || 'warning',
      access: 'none',
      error: config.xrayLogPath,
      dnsLog: false,
    },
    api: {
      tag: 'api',
      services: ['HandlerService', 'LoggerService', 'StatsService'],
    },
    dns: {
      servers: ['1.1.1.1', '8.8.8.8', 'localhost'],
      queryStrategy: 'UseIPv4',
      disableCache: false,
    },
    inbounds: [
      {
        tag: 'vless-reality',
        listen: '0.0.0.0',
        port,
        protocol: 'vless',
        settings: {
          clients,
          decryption: 'none',
        },
        streamSettings: {
          network: 'tcp',
          security: 'reality',
          realitySettings: {
            show: false,
            dest,
            xver: 0,
            serverNames: [sni],
            privateKey: reality.privateKey,
            shortIds: reality.shortIds,
            spiderX: '/',
          },
        },
        sniffing: {
          enabled: true,
          destOverride: ['http', 'tls', 'quic'],
          routeOnly: true,
        },
      },
      {
        tag: 'api',
        listen: '127.0.0.1',
        port: XRAY_API_PORT,
        protocol: 'dokodemo-door',
        settings: { address: '127.0.0.1' },
      },
    ],
    outbounds: [
      {
        tag: 'direct',
        protocol: 'freedom',
        settings: {
          domainStrategy: 'UseIP',
          redirect: '',
        },
      },
      { tag: 'block', protocol: 'blackhole', settings: { response: { type: 'http' } } },
      { tag: 'api', protocol: 'blackhole' },
    ],
    routing: {
      domainStrategy: 'IPIfNonMatch',
      rules: [
        { type: 'field', inboundTag: ['api'], outboundTag: 'api' },
        { type: 'field', ip: ['geoip:private'], outboundTag: 'direct' },
        { type: 'field', protocol: ['bittorrent'], outboundTag: 'block' },
        { type: 'field', port: '443,8443', network: 'udp', outboundTag: 'block' },
        { type: 'field', network: 'tcp,udp', outboundTag: 'direct' },
      ],
    },
    policy: {
      levels: {
        '0': {
          statsUserUplink: true,
          statsUserDownlink: true,
          statsUserOnline: true,
          bufferSize: 4,
        },
      },
      system: { statsOutboundUplink: true, statsOutboundDownlink: true },
    },
    stats: {},
  };
}

/** Write the config file atomically. */
export async function writeXrayConfig({ force = false } = {}) {
  ensureDirs();
  const reality = await ensureRealityKeys();
  const runtime = rt();
  const settings = {
    server_port: runtime.serverPort,
    reality_sni: runtime.realitySni,
    reality_dest: runtime.realityDest,
    reality_fingerprint: runtime.realityFingerprint,
    loglevel: runtime.loglevel,
  };
  const users = listUsers();
  const cfg = buildXrayConfig({ reality, users, settings });

  const tmp = `${config.xrayConfigPath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2));
  fs.renameSync(tmp, config.xrayConfigPath);
  return { path: config.xrayConfigPath, config: cfg };
}

/* ------------------------------------------------------------------ */
/* Process control                                                     */
/* ------------------------------------------------------------------ */

export function isRunning() {
  return Boolean(child && child.exitCode === null);
}

export function xrayPid() {
  return isRunning() ? child.pid : null;
}

export function lastXrayError() {
  return lastError;
}

/** Start the xray process (no-op if already running). */
export async function startXray() {
  if (isRunning()) return { started: false, reason: 'already_running', pid: child.pid };
  if (!xrayBinaryExists() && resolveBinary() === 'xray') {
    throw new Error('xray binary not found. Run: npm run xray:install');
  }
  await writeXrayConfig();
  ensureDirs();
  const logStream = fs.createWriteStream(config.xrayLogPath, { flags: 'a' });
  child = spawn(resolveBinary(), ['run', '-c', config.xrayConfigPath], {
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout.pipe(logStream);
  child.stderr.pipe(logStream);
  child.on('error', (err) => {
    lastError = String(err.message || err);
  });
  child.on('exit', (code, signal) => {
    lastError = `xray exited (code=${code}, signal=${signal})`;
    child = null;
  });
  await new Promise((r) => setTimeout(r, 1200));
  if (!isRunning()) throw new Error(lastError || 'xray failed to start');
  return { started: true, pid: child.pid };
}

/** Stop the xray process. */
export async function stopXray() {
  if (!isRunning()) return { stopped: false, reason: 'not_running' };
  const proc = child;
  child = null;
  proc.kill('SIGTERM');
  await new Promise((r) => setTimeout(r, 400));
  try {
    if (proc.exitCode === null) proc.kill('SIGKILL');
  } catch {
    /* already gone */
  }
  return { stopped: true };
}

/** Restart the xray process with a freshly generated configuration. */
export async function restartXray() {
  await stopXray();
  return startXray();
}

/** Rebuild config and reload clients without a full restart (xray API). */
export async function reloadClients() {
  const { config: cfg } = await writeXrayConfig();
  if (!isRunning()) return { reloaded: false, reason: 'not_running' };
  const inbound = cfg.inbounds[0];
  try {
    // Remove every client currently registered on the inbound.
    const raw = await xrayCli(['api', 'inbounduser', `--server=${API_SERVER}`, '-tag', inbound.tag]);
    const parsed = JSON.parse(raw);
    const emails = (parsed.users || []).map((u) => u.email).filter(Boolean);
    if (emails.length) {
      await xrayCli(['api', 'rmu', `--server=${API_SERVER}`, `-tag=${inbound.tag}`, ...emails]);
    }
    // Add the fresh set. The CLI expects a config file with an "inbounds" array.
    const tmpFile = path.join(config.dataDir, 'xray', 'inbound-users.json');
    fs.writeFileSync(tmpFile, JSON.stringify({ inbounds: [inbound] }, null, 2));
    await xrayCli(['api', 'adu', `--server=${API_SERVER}`, tmpFile]);
    return { reloaded: true, clients: inbound.settings.clients.length, removed: emails.length };
  } catch (err) {
    // Fall back to a restart when the API call fails.
    await restartXray();
    return { reloaded: true, mode: 'restart', reason: String(err.message || err) };
  }
}

/* ------------------------------------------------------------------ */
/* Statistics                                                          */
/* ------------------------------------------------------------------ */

const lastCounters = new Map();

/**
 * Read per-user traffic counters from the xray API.
 * Returns a Map<tag, {up, down, total}>.
 */
export async function fetchUserStats() {
  const result = new Map();
  let stdout = '';
  try {
    stdout = await xrayCli(['api', 'statsquery', `--server=${API_SERVER}`, '-pattern', 'user>>>']);
  } catch {
    return result;
  }
  let parsed;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return result;
  }
  const stats = parsed?.stat || [];
  for (const entry of stats) {
    const parts = String(entry.name || '').split('>>>');
    if (parts.length < 4) continue;
    const [, tag, kind, direction] = parts;
    const value = Number(entry.value || 0);
    if (!result.has(tag)) result.set(tag, { up: 0, down: 0, total: 0 });
    const bucket = result.get(tag);
    if (kind === 'traffic') {
      if (direction === 'uplink') bucket.up += value;
      if (direction === 'downlink') bucket.down += value;
    }
  }
  for (const bucket of result.values()) bucket.total = bucket.up + bucket.down;
  return result;
}

/**
 * Convert absolute counters into deltas (handles xray restarts).
 * Returns Map<tag, deltaBytes>.
 */
export function diffStats(current) {
  const deltas = new Map();
  for (const [tag, bucket] of current.entries()) {
    const previous = lastCounters.get(tag) ?? 0;
    const delta = bucket.total >= previous ? bucket.total - previous : bucket.total;
    lastCounters.set(tag, bucket.total);
    if (delta > 0) deltas.set(tag, delta);
  }
  for (const tag of [...lastCounters.keys()]) {
    if (!current.has(tag)) lastCounters.delete(tag);
  }
  return deltas;
}

/** Reset the counter baseline (e.g. after a manual traffic reset). */
export function resetCounters() {
  lastCounters.clear();
}

/** Number of online sessions for a user tag. */
export async function onlineCount(tag) {
  try {
    const stdout = await xrayCli(['api', 'statsonline', `--server=${API_SERVER}`, '-email', tag]);
    const parsed = JSON.parse(stdout);
    return Number(parsed?.stat?.value ?? 0);
  } catch {
    return 0;
  }
}

/** Distinct client IPs currently connected for a user tag. */
export async function onlineIps(tag) {
  try {
    const stdout = await xrayCli(['api', 'statsonlineiplist', `--server=${API_SERVER}`, '-email', tag]);
    const parsed = JSON.parse(stdout);
    const ips = parsed?.ips;
    if (!ips) return [];
    if (Array.isArray(ips)) return ips.map((entry) => entry.ip || '').filter(Boolean);
    // protobuf map: { "<ip>": <timestamp> }
    return Object.keys(ips);
  } catch {
    return [];
  }
}

/** All users that currently have at least one online session (single API call). */
export async function onlineUsers() {
  try {
    const stdout = await xrayCli(['api', 'statsgetallonlineusers', `--server=${API_SERVER}`]);
    const parsed = JSON.parse(stdout);
    const users = parsed?.users || [];
    return new Set(Array.isArray(users) ? users : []);
  } catch {
    return new Set();
  }
}

/** Online session count for every active user (used by the landing page). */
export async function onlineSummary() {
  const active = listUsers().filter((u) => u.status === 'active');
  const online = await onlineUsers();
  const perUser = {};
  let total = 0;
  for (const user of active) {
    const n = online.has(user.vless_tag) ? 1 : 0;
    perUser[user.id] = n;
    total += n;
  }
  return { total, perUser };
}

export { XRAY_API_PORT, API_SERVER };
