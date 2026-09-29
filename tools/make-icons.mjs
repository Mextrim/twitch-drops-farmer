/**
 * Генератор иконок расширения без внешних зависимостей.
 * Пишет валидные PNG (RGB, без альфы) в папку icons/.
 * Запуск: node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'icons');
const SIZES = [16, 32, 48, 128];

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

/** rgb: Uint8Array длиной size*size*3 */
function encodePng(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const rowStart = y * (size * 3 + 1);
    raw[rowStart] = 0; // filter: none
    rgb.copy(raw, rowStart + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Рисует иконку в SS× большем разрешении и усредняет блоки обратно —
 * так края получаются сглаженными без внешних библиотек.
 */
const SUPERSAMPLE = 4;

function drawIconRaw(size) {
  const px = Buffer.alloc(size * size * 3);
  const radius = size * 0.22;
  const put = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 3;
    px[i] = r;
    px[i + 1] = g;
    px[i + 2] = b;
  };

  const cx = size / 2;
  const cy = size / 2;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // скруглённый квадрат через расстояние до ближайшего угла
      const dx = Math.max(Math.abs(x + 0.5 - cx) - (size / 2 - radius), 0);
      const dy = Math.max(Math.abs(y + 0.5 - cy) - (size / 2 - radius), 0);
      if (Math.hypot(dx, dy) > radius) {
        put(x, y, 11, 11, 15); // фон, на котором живёт плитка
        continue;
      }
      // вертикальный градиент #9147ff -> #5c16c5
      const t = y / (size - 1);
      put(
        x,
        y,
        Math.round(0x91 + (0x5c - 0x91) * t),
        Math.round(0x47 + (0x16 - 0x47) * t),
        Math.round(0xff + (0xc5 - 0xff) * t),
      );
    }
  }

  // «play»-стрелка: вертикальное ребро слева, остриё справа по центру.
  const triH = size * 0.36;
  const triW = triH * 1.15;
  const left = cx - triW / 4;
  const top = cy - triH / 2;
  for (let y = Math.floor(top); y <= Math.ceil(top + triH); y++) {
    const t = (y - top) / triH;
    const half = (triW / 2) * (1 - Math.abs(t * 2 - 1));
    for (let x = Math.floor(left); x <= Math.ceil(left + half); x++) {
      put(x, y, 255, 255, 255);
    }
  }
  return px;
}

function drawIcon(size) {
  const big = drawIconRaw(size * SUPERSAMPLE);
  const out = Buffer.alloc(size * size * 3);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const i = ((y * SUPERSAMPLE + sy) * size * SUPERSAMPLE + (x * SUPERSAMPLE + sx)) * 3;
          r += big[i];
          g += big[i + 1];
          b += big[i + 2];
        }
      }
      const o = (y * size + x) * 3;
      out[o] = Math.round(r / n);
      out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n);
    }
  }
  return out;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log(`wrote ${file}`);
}
