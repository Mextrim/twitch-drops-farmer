/**
 * Генератор логотипа и иконок расширения.
 *
 * Единственный источник правды: геометрия капли описана один раз здесь,
 * и из неё собираются и векторный assets/logo.svg, и растровые иконки.
 * Поэтому логотип в интерфейсе, в README и на панели браузера
 * физически не может разъехаться.
 *
 * Идея: капля (Drops), внутри которой вырезана play-стрелка (просмотр).
 *
 * Запуск: node tools/make-icons.mjs
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'icons');
const LOGO_PATH = join(ROOT, 'assets', 'logo.svg');
const SIZES = [16, 32, 48, 128];
const SUPERSAMPLE = 4;

/** Фирменная палитра Twitch */
const PURPLE_TOP = [0xa9, 0x70, 0xff];
const PURPLE_BOTTOM = [0x64, 0x21, 0xcc];
const BG_DARK = [0x0e, 0x0e, 0x13];

/**
 * Геометрия капли: начало координат — центр окружности.
 * Капля = окружность радиуса r + два касательных от кончика до окружности.
 */
function droplet(r, tipDist) {
  const d = tipDist;
  const sinA = Math.sqrt(Math.max(0, d * d - r * r)) / d;
  const cosA = r / d;
  return { r, d, tx: r * sinA, ty: -r * cosA, tipY: -d };
}

const DROP_R = 0.285;
const DROP_D = 0.6;
const GEO = droplet(DROP_R, DROP_D);

/** Смещение, чтобы капля встала по центру плитки */
const CY = 0.5 + (DROP_D - DROP_R) / 2;

/** Play-стрелка, вырезаемая в капле (единицы плитки) */
const TRI = { cx: -0.03, cy: 0.05, h: 0.24, w: 0.38 };

/** Внутри капли? x/y — относительно центра капли */
function inDroplet(x, y) {
  if (y >= GEO.tipY && x * x + y * y <= GEO.r * GEO.r) return true;
  if (y <= 0) {
    const t = (y - GEO.tipY) / -GEO.tipY; // 0 на кончике, 1 у основания
    return Math.abs(x) <= GEO.tx * t;
  }
  return false;
}

function inTriangle(x, y) {
  const half = TRI.h / 2;
  const top = TRI.cy - half;
  if (y < top || y > TRI.cy + half) return false;
  const edge = (TRI.w / 2) * ((y - top) / TRI.h);
  return x >= TRI.cx - TRI.w / 2 && x <= TRI.cx + edge;
}

const mix = (a, b, t) => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

// ------------------------------------------------------------------ PNG

const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function encodePng(size, rgb) {
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    const at = y * (size * 3 + 1);
    raw[at] = 0;
    rgb.copy(raw, at + 1, y * size * 3, (y + 1) * size * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Цвет точки плитки в координатах 0..1 */
function sample(u, v) {
  const radius = 0.22;
  const dx = Math.max(Math.abs(u - 0.5) - (0.5 - radius), 0);
  const dy = Math.max(Math.abs(v - 0.5) - (0.5 - radius), 0);
  if (Math.hypot(dx, dy) > radius) return BG_DARK;

  const tile = mix(PURPLE_TOP, PURPLE_BOTTOM, v);
  const x = u - 0.5;
  const y = v - CY;
  if (inDroplet(x, y)) return inTriangle(x, y) ? tile : [255, 255, 255];
  return tile;
}

function renderRgb(size) {
  const S = size * SUPERSAMPLE;
  const big = Buffer.alloc(S * S * 3);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const c = sample((x + 0.5) / S, (y + 0.5) / S);
      const i = (y * S + x) * 3;
      big[i] = c[0];
      big[i + 1] = c[1];
      big[i + 2] = c[2];
    }
  }
  const out = Buffer.alloc(size * size * 3);
  const n = SUPERSAMPLE * SUPERSAMPLE;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const i = ((y * SUPERSAMPLE + sy) * S + (x * SUPERSAMPLE + sx)) * 3;
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

// ------------------------------------------------------------------ SVG

/** Тот же логотип вектором: та же геометрия, тот же градиент. */
function renderSvg(S = 512) {
  const n = (v) => +v.toFixed(2);

  const cx = 0.5 * S;
  const cy = CY * S;
  const r = GEO.r * S;
  const tipY = cy + GEO.tipY * S;
  const tanX = GEO.tx * S;
  const tanY = cy + GEO.ty * S;

  const tW = TRI.w * S;
  const tH = TRI.h * S;
  const tLeft = cx + (TRI.cx - TRI.w / 2) * S;
  const tTop = cy + (TRI.cy - TRI.h / 2) * S;

  const drop = `M ${n(cx)} ${n(tipY)} L ${n(cx + tanX)} ${n(tanY)} A ${n(r)} ${n(r)} 0 1 1 ${n(cx - tanX)} ${n(tanY)} Z`;
  const play = `M ${n(tLeft)} ${n(tTop)} L ${n(tLeft + tW)} ${n(tTop + tH / 2)} L ${n(tLeft)} ${n(tTop + tH)} Z`;
  const tileColor = `rgb(${PURPLE_TOP.join(',')})`;
  const tileColor2 = `rgb(${PURPLE_BOTTOM.join(',')})`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${S}" height="${S}" viewBox="0 0 ${S} ${S}" role="img" aria-label="Twitch Drops Farmer">
  <defs>
    <!-- userSpaceOnUse обязателен: при objectBoundingBox градиент внутри
         выреза пересчитался бы по габаритам треугольника и дырка
         перестала бы совпадать с плиткой -->
    <linearGradient id="tile" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="${S}">
      <stop offset="0" stop-color="${tileColor}"/>
      <stop offset="1" stop-color="${tileColor2}"/>
    </linearGradient>
    <clipPath id="drop"><path d="${drop}"/></clipPath>
  </defs>

  <rect width="${S}" height="${S}" rx="${n(0.22 * S)}" fill="rgb(${BG_DARK.join(',')})"/>
  <rect width="${S}" height="${S}" rx="${n(0.22 * S)}" fill="url(#tile)"/>
  <path d="${drop}" fill="#ffffff"/>
  <path d="${play}" fill="url(#tile)" clip-path="url(#drop)"/>
</svg>
`;
}

// ------------------------------------------------------------------ main

mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  writeFileSync(join(OUT_DIR, `icon${size}.png`), encodePng(size, renderRgb(size)));
  console.log(`иконка   icons/icon${size}.png`);
}

mkdirSync(dirname(LOGO_PATH), { recursive: true });
writeFileSync(LOGO_PATH, renderSvg(512));
console.log('логотип  assets/logo.svg');
