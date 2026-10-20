#!/usr/bin/env node
/**
 * GhostVPN - download the Xray core into ./vendor/xray.
 *
 *   node scripts/install-xray.js [version]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TARGET_DIR = path.join(ROOT, 'vendor', 'xray');
const REPO = 'XTLS/Xray-core';

function detectAsset() {
  const platform = process.platform;
  const arch = process.arch;
  if (platform === 'win32') {
    return arch === 'ia32' ? 'Xray-windows-32.zip' : 'Xray-windows-64.zip';
  }
  if (platform === 'darwin') {
    return arch === 'arm64' ? 'Xray-macos-arm64-v8a.zip' : 'Xray-macos-64.zip';
  }
  if (platform === 'linux') {
    return arch === 'arm64' ? 'Xray-linux-arm64-v8a.zip' : 'Xray-linux-64.zip';
  }
  throw new Error(`Unsupported platform: ${platform}/${arch}`);
}

async function latestVersion() {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { 'User-Agent': 'ghostvpn-installer' },
  });
  if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
  const json = await res.json();
  return json.tag_name;
}

function extract(archive) {
  fs.mkdirSync(TARGET_DIR, { recursive: true });
  try {
    execFileSync('unzip', ['-o', archive, '-d', TARGET_DIR], { stdio: 'inherit' });
  } catch {
    execFileSync('tar', ['-xf', archive, '-C', TARGET_DIR], { stdio: 'inherit' });
  }
}

async function main() {
  const version = process.argv[2] || (await latestVersion());
  const asset = detectAsset();
  const url = `https://github.com/${REPO}/releases/download/${version}/${asset}`;

  console.log(`\n  Загрузка Xray ${version} (${asset}) ...`);
  const res = await fetch(url, { headers: { 'User-Agent': 'ghostvpn-installer' } });
  if (!res.ok) throw new Error(`Download failed: ${res.status} ${url}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  const archive = path.join(os.tmpdir(), asset);
  fs.writeFileSync(archive, buffer);

  console.log('  Распаковка...');
  extract(archive);
  fs.rmSync(archive, { force: true });

  const binary = path.join(TARGET_DIR, process.platform === 'win32' ? 'xray.exe' : 'xray');
  if (!fs.existsSync(binary)) {
    throw new Error(`Не найден исполняемый файл ${binary}`);
  }
  if (process.platform !== 'win32') fs.chmodSync(binary, 0o755);

  console.log(`  Готово: ${binary}\n`);
}

main().catch((err) => {
  console.error('  Ошибка:', err.message);
  process.exit(1);
});
