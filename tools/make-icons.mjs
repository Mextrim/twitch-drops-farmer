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

/** Фиолетовый квадрат со скруглением и белой «иконкой дропа» (ромб + ножка). */
function drawIcon(size) {
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
  const r = size / 2 - size * 0.06;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      // скруглённый квадрат через расстояние до угла
      const dx = Math.max(Math.abs(x + 0.5 - cx) - (size / 2 - radius), 0);
      const dy = Math.max(Math.abs(y + 0.5 - cy) - (size / 2 - radius), 0);
      const outside = Math.hypot(dx, dy) > radius;
      if (outside) {
        put(x, y, 14, 14, 16); // фон расширения
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

  // Ромб (капля) в верхней части + прямоугольная «ножка» снизу.
  const top = size * 0.28;
  const half = size * 0.17;
  const halfH = size * 0.2;
  for (let y = Math.floor(top - halfH); y <= Math.ceil(top + halfH); y++) {
    const span = (half * (1 - Math.abs((y - top) / halfH))) * 1.0;
    for (let x = Math.floor(cx - span); x <= Math.ceil(cx + span); x++) {
      put(x, y, 255, 255, 255);
    }
  }
  const neckW = size * 0.1;
  const neckTop = top + halfH * 0.55;
  const neckBottom = size * 0.7;
  for (let y = Math.floor(neckTop); y <= Math.ceil(neckBottom); y++) {
    for (let x = Math.floor(cx - neckW / 2); x <= Math.ceil(cx + neckW / 2); x++) {
      put(x, y, 255, 255, 255);
    }
  }
  return px;
}

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const file = join(OUT_DIR, `icon${size}.png`);
  writeFileSync(file, encodePng(size, drawIcon(size)));
  console.log(`wrote ${file}`);
}
