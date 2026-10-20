#!/usr/bin/env node
/**
 * Генератор иконки приложения GhostVPN (ICO 64x64 + 32x32 + 16x16).
 * Рисует «призрака» в фирменных цветах.
 */
import fs from 'node:fs';
import path from 'node:path';

const BRAND = [0x7c, 0x5c, 0xff];
const ACCENT = [0x22, 0xd3, 0xee];

/** Пиксель: [r,g,b,a] */
function draw(size) {
  const px = new Uint8Array(size * size * 4);
  const set = (x, y, c, a = 255) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    px[i] = c[0];
    px[i + 1] = c[1];
    px[i + 2] = c[2];
    px[i + 3] = a;
  };

  const cx = size / 2;
  const headR = size * 0.34;
  const headY = size * 0.42;

  // тело (полукруг)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - cx;
      const dy = y - headY;
      const inHead = dx * dx + dy * dy <= headR * headR;
      const inBody = y >= headY && Math.abs(dx) <= headR * (1 - (y - headY) / (size * 0.75));
      const wave = Math.sin((x / size) * Math.PI * 3) * size * 0.06;
      const inBodyWithWave = y >= headY + wave && Math.abs(dx) <= headR * (1 - (y - headY) / (size * 0.75));
      if (inHead || inBodyWithWave) {
        const t = y / size;
        const c = [
          Math.round(BRAND[0] * (1 - t) + ACCENT[0] * t),
          Math.round(BRAND[1] * (1 - t) + ACCENT[1] * t),
          Math.round(BRAND[2] * (1 - t) + ACCENT[2] * t),
        ];
        set(x, y, c);
      }
    }
  }

  // глаза
  const eyeR = size * 0.075;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      for (const ox of [-size * 0.13, size * 0.13]) {
        const dx = x - (cx + ox);
        const dy = y - (headY - size * 0.04);
        if (dx * dx + dy * dy <= eyeR * eyeR) set(x, y, [0x08, 0x0a, 0x16]);
      }
    }
  }
  return px;
}

function bmp(size) {
  const px = draw(size);
  const header = Buffer.alloc(40);
  header.writeUInt32LE(40, 0);
  header.writeInt32LE(size, 4);
  header.writeInt32LE(size * 2, 8); // высота ×2 (XOR + AND маски)
  header.writeUInt16LE(1, 12);
  header.writeUInt16LE(32, 14);
  header.writeUInt32LE(px.length + (size * size / 8), 20);

  // BMP снизу вверх
  const rows = [];
  for (let y = size - 1; y >= 0; y--) {
    const row = Buffer.alloc(size * 4);
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      row[x * 4] = px[i + 2];
      row[x * 4 + 1] = px[i + 1];
      row[x * 4 + 2] = px[i];
      row[x * 4 + 3] = px[i + 3];
    }
    rows.push(row);
  }
  const xor = Buffer.concat(rows);
  const and = Buffer.alloc((size / 8) * size);
  return Buffer.concat([header, xor, and]);
}

function buildIco(sizes) {
  const images = sizes.map((s) => ({ size: s, data: bmp(s) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + images.length * 16;
  const entries = [];
  for (const img of images) {
    const e = Buffer.alloc(16);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 0);
    e.writeUInt8(img.size >= 256 ? 0 : img.size, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(img.data.length, 8);
    e.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(e);
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.data)]);
}

const target = path.join(process.argv[2] || '.', 'ghost.ico');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, buildIco([16, 32, 64, 128, 256]));
console.log('ico:', target, fs.statSync(target).size, 'bytes');
