/**
 * Проверки, которые не требуют сети: синтаксис, манифест, import-пути.
 * Именно это гоняет CI.
 *
 * Запуск: npm run check
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const TOOLS = join(ROOT, 'tools');

let failed = 0;
const ok = (msg) => console.log(`  \u2713 ${msg}`);
const fail = (msg) => {
  failed++;
  console.log(`  \u2717 ${msg}`);
};

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

// ------------------------------------------------------------ 1. манифест

console.log('\nМанифест');
const manifest = JSON.parse(await readFile(join(ROOT, 'manifest.json'), 'utf8'));

manifest.manifest_version === 3 ? ok('Manifest V3') : fail(`manifest_version = ${manifest.manifest_version}, ожидался 3`);

const refs = [
  ...Object.values(manifest.icons || {}),
  ...Object.values(manifest.action?.default_icon || {}),
  manifest.background?.service_worker,
  manifest.action?.default_popup,
  manifest.options_ui?.page,
  'assets/logo.svg',
  ...(manifest.content_scripts || []).flatMap((cs) => cs.js || []),
].filter(Boolean);

for (const ref of refs) {
  try {
    await stat(join(ROOT, ref));
    ok(ref);
  } catch {
    fail(`${ref} — файл не найден`);
  }
}

const perms = manifest.permissions || [];
for (const required of ['storage', 'alarms', 'tabs', 'notifications']) {
  perms.includes(required) ? ok(`permission: ${required}`) : fail(`нет permission: ${required}`);
}

const hosts = manifest.host_permissions || [];
for (const required of ['https://www.twitch.tv/*', 'https://gql.twitch.tv/*']) {
  hosts.includes(required) ? ok(`host: ${required}`) : fail(` нет host: ${required}`);
}

// не должно быть лишних разрешений
const allowed = new Set(['alarms', 'notifications', 'storage', 'tabs']);
const extra = perms.filter((p) => !allowed.has(p));
extra.length ? fail(`лишние permissions: ${extra.join(', ')}`) : ok('нет лишних permissions');

// ------------------------------------------------------- 2. import-пути

console.log('\nМодули');
const files = [...(await walk(SRC)), ...(await walk(TOOLS))].filter((f) => f.endsWith('.js') || f.endsWith('.mjs'));

for (const file of files) {
  const code = await readFile(file, 'utf8');
  const specs = [...code.matchAll(/(?:from|import)\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1]);
  let bad = [];
  for (const spec of specs) {
    try {
      await stat(resolve(dirname(file), spec));
    } catch {
      bad.push(spec);
    }
  }
  const name = relative(ROOT, file);
  bad.length ? fail(`${name} → ${bad.join(', ')}`) : ok(name);
}

// ------------------------------------------------------------ 3. синтаксис

console.log('\nСинтаксис');
for (const file of files) {
  const name = relative(ROOT, file);
  try {
    await run(process.execPath, ['--check', file]);
    ok(name);
  } catch (error) {
    fail(`${name}\n      ${String(error.stderr || error.message).split('\n').slice(0, 4).join('\n      ')}`);
  }
}

// ------------------------------------------------- 4. соглашения проекта

console.log('\nСоглашения');
const contentScript = await readFile(join(SRC, 'content', 'farm-tab.js'), 'utf8');
const popupCss = await readFile(join(SRC, 'popup', 'popup.css'), 'utf8');
const optionsCss = await readFile(join(SRC, 'options', 'options.css'), 'utf8');
/^import\s/m.test(contentScript)
  ? fail('content script использует import — он не поддерживается')
  : ok('content script без import (MV3 content_scripts не поддерживают модули)');

const sw = await readFile(join(SRC, 'background', 'service-worker.js'), 'utf8');
manifest.background?.type === 'module'
  ? ok('service worker объявлен модулем')
  : fail('manifest.background.type !== "module", а service worker использует import');

const api = await readFile(join(ROOT, 'src', 'background', 'twitch-api.js'), 'utf8');
api.includes('["${DROP_TAG}"]') || api.includes('freeformTags: ["')
  ? ok('фильтр freeformTags передан литералом')
  : fail('фильтр freeformTags должен быть литералом — через variables Twitch его игнорирует');

// Логотип обязан быть один: интерфейс берёт assets/logo.svg,
// а PNG-иконки собираются из той же геометрии в make-icons.mjs.
console.log('\nБрендинг');
const iconSource = await readFile(join(TOOLS, 'make-icons.mjs'), 'utf8');
for (const page of ['popup', 'options']) {
  const file = join(SRC, page, `${page}.html`);
  const html = await readFile(file, 'utf8');
  const match = html.match(/<img[^>]+class="[^"]*logo[^"]*"[^>]+src="([^"]+)"/);
  if (!match) {
    fail(`${page}.html: не найден <img> с логотипом`);
    continue;
  }
  // Резолвим относительно самой страницы: логотип лежит в корне проекта,
  // а страницы — в src/<page>/, поэтому путь вверх на два уровня
  const target = resolve(dirname(file), match[1]);
  try {
    await stat(target);
    ok(`${page}.html → ${match[1]} (файл найден)`);
  } catch {
    fail(`${page}.html → ${match[1]} — файл не найден по этому пути`);
  }
}
iconSource.includes('logo.svg') ? ok('make-icons.mjs собирает assets/logo.svg') : fail('make-icons.mjs должен собирать assets/logo.svg');
!popupCss.includes('.logo::after') && !optionsCss.includes('__logo::after')
  ? ok('старая стрелка на CSS удалена')
  : fail('в CSS остался псевдоэлемент со старой стрелкой');

console.log(failed ? `\nПровалено проверок: ${failed}\n` : '\nВсе проверки пройдены\n');
process.exit(failed ? 1 : 0);
