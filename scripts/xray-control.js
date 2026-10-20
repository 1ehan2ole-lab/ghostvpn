#!/usr/bin/env node
/**
 * GhostVPN - control the Xray core from the command line.
 *
 *   node scripts/xray-control.js start|stop|restart|status|config
 */
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { config, ensureDirs } from '../server/config.js';
import { initDb } from '../server/db.js';
import {
  ensureRealityKeys,
  isRunning,
  restartXray,
  startXray,
  stopXray,
  writeXrayConfig,
  xrayPid,
} from '../server/xray.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
ensureDirs();
initDb();

const action = process.argv[2] || 'status';

async function main() {
  switch (action) {
    case 'start': {
      const res = await startXray();
      console.log(res.started ? `Xray запущен (pid ${res.pid})` : `Xray уже запущен (pid ${res.pid})`);
      break;
    }
    case 'stop': {
      const res = await stopXray();
      console.log(res.stopped ? 'Xray остановлен' : 'Xray не был запущен');
      break;
    }
    case 'restart': {
      const res = await restartXray();
      console.log(`Xray перезапущен (pid ${res.pid})`);
      break;
    }
    case 'config': {
      const res = await writeXrayConfig();
      console.log('Конфиг записан:', res.path);
      break;
    }
    case 'status': {
      const reality = await ensureRealityKeys();
      console.log('Xray запущен:', isRunning(), xrayPid() ? `(pid ${xrayPid()})` : '');
      console.log('Конфиг:', config.xrayConfigPath, fs.existsSync(config.xrayConfigPath) ? '' : '(нет)');
      console.log('REALITY public key:', reality.publicKey);
      console.log('Short IDs:', reality.shortIds.join(', '));
      break;
    }
    default:
      console.log('Использование: xray-control.js start|stop|restart|status|config');
      process.exit(1);
  }
}

main().catch((err) => {
  console.error('Ошибка:', err.message);
  process.exit(1);
});
