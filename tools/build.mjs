/**
 * Сборка дистрибутива расширения.
 *
 * Копирует во временный каталог только то, что нужно для установки
 * (manifest.json, src/, icons/), проверяет манифест и упаковывает в zip.
 * Инструменты разработки (tools/) в пакет не попадают.
 *
 * Запуск: node tools/build.mjs
 */
import { readFile, writeFile, mkdir, rm, readdir, stat, cp } from 'node:fs/promises';
import { deflateRawSync } from 'node:zlib';
import { join, dirname, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PKG_NAME = 'twitch-drops-farmer';
const INCLUDE = ['manifest.json', 'src', 'icons', 'assets', 'README.md', 'INSTALL.md'];

// ------------------------------------------------------------- zip writer

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

/** Минимальный ZIP-писатель (deflate, без внешних зависимостей). */
function makeZip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const file of files) {
    const nameBuf = Buffer.from(file.name.replace(/\\/g, '/'), 'utf8');
    const raw = file.data;
    const deflated = deflateRawSync(raw, { level: 9 });
    const useDeflate = deflated.length < raw.length;
    const payload = useDeflate ? deflated : raw;
    const method = useDeflate ? 8 : 0;
    const crc = crc32(raw);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0x0800, 6); // flag: UTF-8 names
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0x21, 12); // date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, payload);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x0800, 8);
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(0, 12);
    dir.writeUInt16LE(0x21, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(payload.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);
    dir.writeUInt16LE(0, 32);
    dir.writeUInt16LE(0, 34);
    dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0, 38);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + payload.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...chunks, centralBuf, end]);
}

async function walk(dir, base = '') {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await walk(full, rel)));
    else out.push({ name: rel, data: await readFile(full) });
  }
  return out;
}

// ------------------------------------------------------------------ сборка

const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));
if (manifest.manifest_version !== 3) throw new Error('manifest_version должен быть 3');
for (const icon of Object.values(manifest.icons)) {
  await stat(join(ROOT, icon)); // бросит, если иконки нет
}

const stageDir = join(DIST, PKG_NAME);
await rm(DIST, { recursive: true, force: true });
await mkdir(stageDir, { recursive: true });

for (const item of INCLUDE) {
  await cp(join(ROOT, item), join(stageDir, item), { recursive: true });
}

const files = await walk(stageDir);
files.sort((a, b) => (a.name < b.name ? -1 : 1));

const zipPath = join(DIST, `${PKG_NAME}-${manifest.version}.zip`);
await writeFile(zipPath, makeZip(files));

const size = (await stat(zipPath)).size;
console.log(`Пакет:      ${relative(ROOT, stageDir) + sep}`);
console.log(`Архив:      ${relative(ROOT, zipPath)}  (${(size / 1024).toFixed(1)} KB)`);
console.log(`Файлов:     ${files.length}`);
console.log(`Версия:     ${manifest.version}`);
console.log('\nСодержимое:');
for (const f of files) console.log(`  ${f.name}`);
