/**
 * GhostVPN - tests for the client configuration generator.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clashSubscription,
  singboxSubscription,
  v2raySubscription,
  vlessLink,
  buildSubToken,
} from '../server/subscription.js';

const user = {
  id: 1,
  email: 'demo@ghostvpn.local',
  username: 'demo',
  vless_uuid: '11111111-2222-3333-4444-555555555555',
};

const reality = {
  publicKey: 'PUBLICKEY',
  shortIds: ['abcdef0123456789'],
};

test('vless link contains the REALITY parameters', () => {
  const link = vlessLink(user, {
    host: 'vpn.example.com',
    port: 443,
    sni: 'www.microsoft.com',
    publicKey: reality.publicKey,
    shortId: reality.shortIds[0],
    fingerprint: 'chrome',
  });
  assert.ok(link.startsWith(`vless://${user.vless_uuid}@vpn.example.com:443?`));
  assert.ok(link.includes('security=reality'));
  assert.ok(link.includes('pbk=PUBLICKEY'));
  assert.ok(link.includes('sni=www.microsoft.com'));
  assert.ok(link.includes('sid=abcdef0123456789'));
  assert.ok(link.includes('flow=xtls-rprx-vision'));
  assert.ok(link.includes('encryption=none'));
});

test('v2ray subscription is base64 of the joined links', () => {
  const links = ['vless://one', 'vless://two'];
  const decoded = Buffer.from(v2raySubscription(links), 'base64').toString('utf8');
  assert.equal(decoded, links.join('\n'));
});

test('clash subscription is valid yaml with the account', () => {
  const yaml = clashSubscription(user, ['vless://x'], {
    host: 'vpn.example.com',
    port: 443,
    sni: 'www.microsoft.com',
    publicKey: reality.publicKey,
    shortId: reality.shortIds[0],
    fingerprint: 'chrome',
  });
  assert.ok(yaml.includes('type: vless'));
  assert.ok(yaml.includes(`uuid: ${user.vless_uuid}`));
  assert.ok(yaml.includes('public-key: PUBLICKEY'));
  assert.ok(yaml.includes('server: vpn.example.com'));
});

test('sing-box config is valid json with a reality outbound', () => {
  const json = JSON.parse(
    singboxSubscription(user, {
      host: 'vpn.example.com',
      port: 443,
      sni: 'www.microsoft.com',
      publicKey: reality.publicKey,
      shortId: reality.shortIds[0],
      fingerprint: 'chrome',
    }),
  );
  const proxy = json.outbounds.find((o) => o.type === 'vless');
  assert.equal(proxy.uuid, user.vless_uuid);
  assert.equal(proxy.server, 'vpn.example.com');
  assert.equal(proxy.tls.reality.public_key, reality.publicKey);
  assert.equal(proxy.tls.reality.short_id, reality.shortIds[0]);
});

test('subscription tokens are unguessable and unique', () => {
  const a = buildSubToken();
  const b = buildSubToken();
  assert.notEqual(a, b);
  assert.equal(a.length, 32);
  assert.match(a, /^[0-9a-f]+$/);
});
