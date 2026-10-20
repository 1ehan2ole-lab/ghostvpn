/**
 * GhostVPN - end-to-end API tests.
 *
 * Uses an isolated data directory, so the production database is untouched.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const TEST_DATA_DIR = path.join(os.tmpdir(), `ghostvpn-test-${process.pid}`);
process.env.DATA_DIR = TEST_DATA_DIR;
process.env.PUBLIC_URL = 'http://localhost:8080';
process.env.ADMIN_EMAIL = 'root@ghostvpn.test';
process.env.ADMIN_PASSWORD = 'rootpassword123';
process.env.REGISTRATION_OPEN = '1';

const { createApp } = await import('../server/index.js');
const { bootstrapAdmin } = await import('../server/service.js');
const { findUserByEmail, closeDb } = await import('../server/db.js');

const app = createApp();
const server = app.listen(0);
await new Promise((resolve) => server.once('listening', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

test.after(() => {
  server.close();
  closeDb();
  fs.rmSync(TEST_DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Minimal cookie-aware fetch. */
async function call(pathname, { method = 'GET', body, cookie, headers = {} } = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(cookie ? { Cookie: cookie } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookie = res.headers.getSetCookie?.() || [];
  const data = await res.json().catch(() => null);
  return { status: res.status, data, setCookie, cookie: setCookie.map((c) => c.split(';')[0]).join('; ') };
}

test('bootstrap creates the admin account', () => {
  const admin = bootstrapAdmin();
  assert.ok(admin, 'admin must be created');
  assert.equal(admin.user.email, 'root@ghostvpn.test');
  assert.equal(findUserByEmail('root@ghostvpn.test').role, 'admin');
});

test('registration issues a session and a key', async () => {
  const res = await call('/api/auth/register', {
    method: 'POST',
    body: { email: 'user@ghostvpn.test', username: 'user', password: 'strongpassword1' },
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.user.email, 'user@ghostvpn.test');
  assert.ok(res.cookie.includes('gv_session='));

  const me = await call('/api/me', { cookie: res.cookie });
  assert.equal(me.status, 200);
  assert.equal(me.data.user.username, 'user');
  assert.ok(me.data.key.uuid.length === 36);
  assert.ok(me.data.key.primary.startsWith('vless://'));
  assert.ok(me.data.key.links.length >= 1);
  assert.ok(me.data.subscription.url.includes('/sub/'), 'ссылка подписки должна содержать /sub/');
  assert.ok(me.data.subscription.links.length === 4);
  assert.ok(me.data.key.primary.includes('://'), 'ключ должен быть абсолютной ссылкой');
});

test('duplicate registration is rejected', async () => {
  const res = await call('/api/auth/register', {
    method: 'POST',
    body: { email: 'user@ghostvpn.test', username: 'user2', password: 'strongpassword1' },
  });
  assert.equal(res.status, 409);
});

test('weak passwords are rejected', async () => {
  const res = await call('/api/auth/register', {
    method: 'POST',
    body: { email: 'weak@ghostvpn.test', username: 'weak', password: '123456' },
  });
  assert.equal(res.status, 400);
});

test('login works and rejects a wrong password', async () => {
  const ok = await call('/api/auth/login', {
    method: 'POST',
    body: { login: 'user@ghostvpn.test', password: 'strongpassword1' },
  });
  assert.equal(ok.status, 200);
  assert.ok(ok.cookie.includes('gv_session='));

  const bad = await call('/api/auth/login', {
    method: 'POST',
    body: { login: 'user@ghostvpn.test', password: 'wrongwrongwrong' },
  });
  assert.equal(bad.status, 401);
});

test('protected routes require authentication', async () => {
  const res = await call('/api/me');
  assert.equal(res.status, 401);
  const admin = await call('/api/admin/users');
  assert.equal(admin.status, 401);
});

test('non-admin users cannot reach the admin API', async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { login: 'user@ghostvpn.test', password: 'strongpassword1' },
  });
  const res = await call('/api/admin/users', { cookie: login.cookie });
  assert.equal(res.status, 403);
});

test('admin can list, create, update and delete users', async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { login: 'root@ghostvpn.test', password: 'rootpassword123' },
  });
  const cookie = login.cookie;

  const list = await call('/api/admin/users', { cookie });
  assert.equal(list.status, 200);
  assert.ok(list.data.users.length >= 2);

  const created = await call('/api/admin/users', {
    method: 'POST',
    cookie,
    body: {
      email: 'created@ghostvpn.test',
      username: 'created',
      password: 'anotherpassword1',
      trafficLimitGb: 5,
      deviceLimit: 2,
    },
  });
  assert.equal(created.status, 201);
  const id = created.data.user.id;
  assert.equal(created.data.user.trafficLimitGb, 5);

  const patched = await call(`/api/admin/users/${id}`, {
    method: 'PATCH',
    cookie,
    body: { status: 'disabled', note: 'test' },
  });
  assert.equal(patched.status, 200);
  assert.equal(patched.data.user.status, 'disabled');

  const extended = await call(`/api/admin/users/${id}/extend`, {
    method: 'POST',
    cookie,
    body: { days: 30 },
  });
  assert.equal(extended.status, 200);
  assert.ok(extended.data.expiresAt > Date.now());

  const rotated = await call(`/api/admin/users/${id}/rotate-key`, { method: 'POST', cookie });
  assert.equal(rotated.status, 200);

  const removed = await call(`/api/admin/users/${id}`, { method: 'DELETE', cookie });
  assert.equal(removed.status, 200);
});

test('admin settings round-trip', async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { login: 'root@ghostvpn.test', password: 'rootpassword123' },
  });
  const cookie = login.cookie;
  const put = await call('/api/admin/settings', {
    method: 'PUT',
    cookie,
    body: { site_name: 'MyVPN', default_traffic_gb: 10 },
  });
  assert.equal(put.status, 200);
  assert.equal(put.data.settings.siteName, 'MyVPN');
  assert.equal(put.data.settings.defaultTrafficGb, 10);

  const get = await call('/api/admin/settings', { cookie });
  assert.equal(get.data.settings.siteName, 'MyVPN');
});

test('subscription endpoints return usable payloads', async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { login: 'user@ghostvpn.test', password: 'strongpassword1' },
  });
  const me = await call('/api/me', { cookie: login.cookie });
  const token = me.data.subscription.url.split('/').pop();

  const res = await fetch(`${base}/sub/${token}`);
  assert.equal(res.status, 200);
  const decoded = Buffer.from(await res.text(), 'base64').toString('utf8');
  assert.ok(decoded.startsWith('vless://'));

  const clash = await fetch(`${base}/sub/${token}?format=clash`);
  assert.ok((await clash.text()).includes('type: vless'));

  const singbox = await fetch(`${base}/sub/${token}?format=singbox`);
  const json = JSON.parse(await singbox.text());
  assert.ok(json.outbounds.some((o) => o.type === 'vless'));

  const missing = await fetch(`${base}/sub/doesnotexist`);
  assert.equal(missing.status, 404);
});

test('public info endpoint exposes site configuration', async () => {
  const res = await call('/api/public/info');
  assert.equal(res.status, 200);
  assert.ok(res.data.site.name);
  assert.ok(typeof res.data.stats.users === 'number');
});

test('logout invalidates the session', async () => {
  const login = await call('/api/auth/login', {
    method: 'POST',
    body: { login: 'user@ghostvpn.test', password: 'strongpassword1' },
  });
  const out = await call('/api/auth/logout', { method: 'POST', cookie: login.cookie });
  assert.equal(out.status, 200);
  const me = await call('/api/me', { cookie: login.cookie });
  assert.equal(me.status, 401);
});
