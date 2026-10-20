#!/usr/bin/env node
/**
 * GhostVPN - first-run setup.
 *
 *   node scripts/setup.js                 # подготовка окружения
 *   node scripts/setup.js --user mail@example.com:secret:username
 *   node scripts/setup.js --show mail@example.com
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, ensureDirs } from '../server/config.js';
import { initDb, findUserByEmail, listUsers } from '../server/db.js';
import { bootstrapAdmin, createUser, effectiveStatus } from '../server/service.js';
import { ensureRealityKeys, writeXrayConfig } from '../server/xray.js';
import { buildUserLinks } from '../server/subscription.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function ensureEnv() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) return false;
  const example = path.join(ROOT, '.env.example');
  if (fs.existsSync(example)) {
    fs.copyFileSync(example, envPath);
    console.log('  Создан .env из .env.example');
    return true;
  }
  return false;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const out = { user: null, show: null, list: false };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--user' && args[i + 1]) out.user = args[++i];
    if (args[i] === '--show' && args[i + 1]) out.show = args[++i];
    if (args[i] === '--list') out.list = true;
  }
  return out;
}

async function main() {
  const args = parseArgs();
  console.log('\n  GhostVPN — подготовка\n  -------------------');
  ensureEnv();
  ensureDirs();
  initDb();
  console.log('  ✓ база данных: ' + config.dbPath);

  const reality = await ensureRealityKeys();
  console.log('  ✓ REALITY public key: ' + reality.publicKey);
  console.log('  ✓ short id: ' + reality.shortIds.join(', '));

  await writeXrayConfig();
  console.log('  ✓ конфиг Xray: ' + config.xrayConfigPath);

  const admin = bootstrapAdmin();
  if (admin) {
    console.log('  ✓ создан администратор: ' + admin.user.email);
    if (admin.password) console.log('    пароль: ' + admin.password);
  } else {
    console.log('  ✓ администратор уже существует');
  }

  if (args.user) {
    const [email, password, username] = args.user.split(':');
    let user = findUserByEmail(email);
    if (user) {
      console.log('  ! пользователь ' + email + ' уже существует');
    } else {
      user = createUser({ email, password, username: username || email.split('@')[0] });
      console.log('  ✓ создан пользователь: ' + user.email);
    }
    await printKey(user);
  }

  if (args.show) {
    const user = findUserByEmail(args.show);
    if (!user) {
      console.error('  ! пользователь не найден: ' + args.show);
      process.exit(1);
    }
    await printKey(user);
  }

  if (args.list) {
    const reality = await ensureRealityKeys();
    console.log('\n  ─────────────────────────────────────────────');
    console.log('  Все аккаунты');
    for (const user of listUsers()) {
      const links = buildUserLinks(user, reality, {});
      console.log(`\n  ${user.email}  [${user.role}/${user.status}]`);
      console.log('    UUID:      ' + user.vless_uuid);
      console.log('    Подписка:  ' + (config.publicUrl || 'http://localhost:' + config.port) + '/sub/' + user.sub_token);
      console.log('    Ключ:      ' + links.primary);
    }
    console.log('\n  ─────────────────────────────────────────────\n');
  }

  console.log('\n  Готово. Запуск: npm start\n');
}

async function printKey(user) {
  const reality = await ensureRealityKeys();
  const links = buildUserLinks(user, reality, {});
  console.log('\n  ─────────────────────────────────────────────');
  console.log('  E-mail:      ' + user.email);
  console.log('  Статус:      ' + effectiveStatus(user));
  console.log('  UUID:        ' + user.vless_uuid);
  console.log('  Подписка:    ' + (config.publicUrl || 'http://localhost:' + config.port) + '/sub/' + user.sub_token);
  console.log('  Ключ:        ' + links.primary);
  console.log('  ─────────────────────────────────────────────\n');
}

main().catch((err) => {
  console.error('  Ошибка:', err);
  process.exit(1);
});
