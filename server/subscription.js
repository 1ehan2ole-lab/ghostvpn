/**
 * GhostVPN - subscription / client configuration generator.
 *
 * Produces the configuration files that mobile and desktop clients import:
 *  - vless:// links (v2rayN, Hiddify, Nekoray, v2rayNG, Streisand ...)
 *  - base64 subscription for v2ray-family clients
 *  - Clash / Clash.Meta YAML
 *  - sing-box JSON
 */
import { config } from './config.js';
import { rt } from './runtime.js';
import { sha256 } from './util.js';
import os from 'node:os';

/** Локальные адреса, для которых ищем IP этой машины в сети. */
function isLocalHost(hostname) {
  return ['localhost', '127.0.0.1', '[::1]', '0.0.0.0'].includes(String(hostname).toLowerCase());
}

/** IP-адрес машины в локальной сети (для ключей, которыми пользуются с телефона). */
let cachedLanIp = null;
let cachedLanAt = 0;

export function detectLanIp() {
  if (cachedLanIp && Date.now() - cachedLanAt < 60000) return cachedLanIp;
  const nets = os.networkInterfaces();
  const candidates = [];
  for (const list of Object.values(nets)) {
    for (const net of list || []) {
      if (net.family !== 'IPv4' && net.family !== 4) continue;
      if (net.internal) continue;
      candidates.push(net.address);
    }
  }
  if (!candidates.length) return null;

  // Приоритет: адреса локальной сети (RFC1918), потом остальные.
  // Так мы не подставим адрес VPN-адаптера (Radmin/OpenVPN и т.п.).
  const isPrivate = (ip) =>
    /^10\./.test(ip) ||
    /^192\.168\./.test(ip) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip);

  candidates.sort((a, b) => (isPrivate(b) ? 1 : 0) - (isPrivate(a) ? 1 : 0));

  cachedLanIp = candidates[0];
  cachedLanAt = Date.now();
  return cachedLanIp;
}

export function getPublicHost(req, { port } = {}) {
  const configured = rt().publicUrl;
  if (configured) {
    try {
      // hostname без порта: порт VPN задаётся отдельно (SERVER_PORT)
      return new URL(configured).hostname;
    } catch {
      /* ignore */
    }
  }
  if (config.serverHost) return config.serverHost;
  if (config.publicUrl) {
    try {
      // hostname only: the VPN port is separate from the panel port
      return new URL(config.publicUrl).hostname;
    } catch {
      /* ignore */
    }
  }
  if (req) {
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    if (host) {
      const value = String(host).split(',')[0].trim();
      const hostname = value.startsWith('[') ? value : value.split(':')[0];
      if (isLocalHost(hostname)) {
        // localhost в ключе бесполезен для телефона - подставляем IP в сети
        const lan = detectLanIp();
        if (lan) return lan;
      }
      return hostname;
    }
  }
  return detectLanIp() || '127.0.0.1';
}

/** Build a single vless:// REALITY link. */
export function vlessLink(user, opts) {
  const {
    host,
    port = config.serverPort,
    sni = config.reality.sni,
    publicKey,
    shortId = '',
    fingerprint = config.reality.fingerprint,
    name,
  } = opts;

  const params = new URLSearchParams({
    type: 'tcp',
    security: 'reality',
    pbk: publicKey,
    fp: fingerprint,
    sni,
    sid: shortId,
    spx: '/',
    flow: 'xtls-rprx-vision',
    encryption: 'none',
  });

  const label = encodeURIComponent(name || user.username || 'ghostvpn');
  return `vless://${user.vless_uuid}@${host}:${port}?${params.toString()}#${label}`;
}

/**
 * Build the full set of client links for a user.
 * Returns { links: string[], primary: string, host, port, ... }
 */
export function buildUserLinks(user, reality, { req, port } = {}) {
  const host = getPublicHost(req, { port });
  const usedPort = Number(port || config.serverPort);
  const shortId = reality.shortIds?.[0] || '';
  const links = reality.shortIds.map((sid) =>
    vlessLink(user, {
      host,
      port: usedPort,
      sni: config.reality.sni,
      publicKey: reality.publicKey,
      shortId: sid,
      fingerprint: config.reality.fingerprint,
      name: `${config.site.name} · ${user.username}`,
    }),
  );
  return {
    links,
    primary: links[0],
    host,
    port: usedPort,
    sni: config.reality.sni,
    publicKey: reality.publicKey,
    shortId,
    fingerprint: config.reality.fingerprint,
  };
}

/* ------------------------------------------------------------------ */
/* Subscription formats                                                */
/* ------------------------------------------------------------------ */

/** Plain-text (base64) subscription used by v2rayN / v2rayNG / Hiddify. */
export function v2raySubscription(links) {
  const body = links.join('\n');
  return Buffer.from(body, 'utf8').toString('base64');
}

/** Clash / Clash.Meta YAML. */
export function clashSubscription(user, links, opts) {
  const { host, port, sni, publicKey, shortId, fingerprint } = opts;
  const name = `${config.site.name} · ${user.username}`;
  const yaml = `# ${name}
proxies:
  - name: "${name}"
    type: vless
    server: ${host}
    port: ${port}
    uuid: ${user.vless_uuid}
    network: tcp
    udp: true
    tls: true
    flow: xtls-rprx-vision
    servername: ${sni}
    client-fingerprint: ${fingerprint}
    reality-opts:
      public-key: ${publicKey}
      short-id: ${shortId}
proxy-groups:
  - name: "PROXY"
    type: select
    proxies:
      - "${name}"
      - DIRECT
rules:
  - MATCH,PROXY
`;
  return yaml;
}

/** sing-box client configuration. */
export function singboxSubscription(user, opts) {
  const { host, port, sni, publicKey, shortId, fingerprint } = opts;
  const name = `${config.site.name} · ${user.username}`;
  return JSON.stringify(
    {
      log: { level: 'info', timestamp: true },
      outbounds: [
        {
          type: 'vless',
          tag: 'proxy',
          server: host,
          server_port: Number(port),
          uuid: user.vless_uuid,
          flow: 'xtls-rprx-vision',
          network: 'tcp',
          tls: {
            enabled: true,
            server_name: sni,
            utls: { enabled: true, fingerprint },
            reality: { enabled: true, public_key: publicKey, short_id: shortId },
          },
        },
        { type: 'direct', tag: 'direct' },
      ],
      route: {
        rules: [
          { action: 'sniff' },
          { protocol: 'dns', action: 'hijack-dns' },
          { ip_is_private: true, outbound: 'direct' },
        ],
        final: 'proxy',
        auto_detect_interface: true,
      },
      experimental: {
        cache_file: { enabled: true, store_fakeip: false },
      },
      tags: [name],
    },
    null,
    2,
  );
}

/** Subscription token: short, url-safe and unguessable. */
export function buildSubToken() {
  return sha256(`${Date.now()}:${Math.random()}:${process.hrtime.bigint()}`).slice(0, 32);
}
