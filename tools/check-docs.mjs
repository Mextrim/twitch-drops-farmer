/**
 * Проверка целостности README: парность <div>, наличие всех заголовков
 * из оглавления и существование локальных файлов, на которые он ссылается.
 *
 * Запуск: node tools/check-docs.mjs
 */
import { readFile } from 'node:fs/promises';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (m) => console.log(`  \u2713 ${m}`);
const fail = (m) => {
  failed++;
  console.log(`  \u2717 ${m}`);
};

for (const name of ['README.md', 'INSTALL.md']) {
  const path = join(ROOT, name);
  let text;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    fail(`${name} не найден`);
    continue;
  }
  console.log(`\n${name}`);

  // 1. парность <div>
  const opens = (text.match(/<div\b/g) || []).length;
  const closes = (text.match(/<\/div>/g) || []).length;
  opens === closes ? ok(`<div> сбалансированы: ${opens}/${closes}`) : fail(`<div>: ${opens} открывающих, ${closes} закрывающих`);

  // 2. парность <details>
  const dOpen = (text.match(/<details\b/g) || []).length;
  const dClose = (text.match(/<\/details>/g) || []).length;
  dOpen === dClose ? ok(`<details> сбалансированы: ${dOpen}/${dClose}`) : fail(`<details>: ${dOpen}/${dClose}`);

  // 3. якоря оглавления ведут в существующие заголовки
  const headings = new Set();
  for (const m of text.matchAll(/^#{2,3}\s+(.+)$/gm)) {
    const slug = m[1]
      .toLowerCase()
      .replace(/[`*_]/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .trim()
      .replace(/\s+/g, '-');
    headings.add(slug);
  }
  for (const m of text.matchAll(/\]\(#([^)]+)\)/g)) {
    headings.has(m[1]) ? ok(`якорь #${m[1]}`) : fail(`якорь #${m[1]} — такого заголовка нет`);
  }

  // 4. локальные ссылки и картинки существуют
  // Внимание: конструкция ![alt](img)](link) содержит две скобки подряд,
  // поэтому берём всё после "](", срезаем возможную внешнюю скобку
  // и отбрасываем всё, что похоже на URL.
  const targets = new Set();
  const addTarget = (raw) => {
    let t = raw.trim();
    if (t.startsWith('(')) t = t.slice(1);
    if (!t || t.startsWith('#') || t.includes('://') || t.startsWith('data:')) return;
    targets.add(t);
  };
  for (const m of text.matchAll(/\]\(\s*([^)\n]+?)\s*\)/g)) addTarget(m[1]);
  for (const m of text.matchAll(/<img[^>]+src="([^"]+)"/g)) addTarget(m[1]);

  for (const t of targets) {
    // Локальным считаем файл с расширением либо имя в корне репозитория
    // (LICENSE, package.json). Всё остальное — ссылка на страницу GitHub
    // вроде releases/latest, её на диске нет by design.
    const looksLocal = /\.[a-z0-9]+$/i.test(t) || !t.includes('/');
    if (!looksLocal) continue;
    try {
      await readFile(join(ROOT, t));
      ok(`файл ${t}`);
    } catch {
      fail(`файл ${t} — не найден`);
    }
  }
}

console.log(failed ? `\nПровалено: ${failed}\n` : '\nДокументация в порядке\n');
process.exit(failed ? 1 : 0);
