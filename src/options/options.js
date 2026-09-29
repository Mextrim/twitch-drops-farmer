import { formatDateTime, formatDuration } from '../shared/format.js';

const $ = (id) => document.getElementById(id);
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

let settings = null;
let pool = null;
let running = false;

let toastTimer = null;
function toast(message, isError = false) {
  const el = $('toast');
  el.textContent = message;
  el.className = isError ? 'toast toast--error' : 'toast';
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 2600);
}

function setHint(text, kind = '') {
  const el = $('gameHint');
  el.textContent = text;
  el.className = kind ? `hint hint--inline hint--${kind}` : 'hint hint--inline';
}

// ------------------------------------------------------------------ рендеринг

function renderGames() {
  const host = $('gameList');
  host.innerHTML = '';
  if (!settings.games.length) {
    host.innerHTML = '<span class="hint">Игр пока нет. Добавьте хотя бы одну.</span>';
    return;
  }
  for (const game of settings.games) {
    const found = pool ? Object.values(pool).filter((c) => c.gameId === game.id).length : null;
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${escapeHtml(game.name || game.id)}</span>
      ${found != null ? `<span class="chip__count">${found}</span>` : ''}
      <button class="chip__remove" type="button" title="Убрать">&times;</button>`;
    chip.querySelector('button').addEventListener('click', async () => {
      settings.games = settings.games.filter((g) => g.id !== game.id);
      await persist({ games: settings.games });
      renderGames();
      renderPool();
    });
    host.appendChild(chip);
  }
}

function renderPool() {
  const host = $('poolList');
  const channels = pool ? Object.values(pool).sort((a, b) => b.viewers - a.viewers) : [];
  if (!channels.length) {
    host.innerHTML = '<div class="hint" style="padding:14px">Пул пуст — нажмите «Обновить пул».</div>';
    return;
  }
  const rows = channels
    .map(
      (c) => `<tr>
        <td>${escapeHtml(c.displayName || c.login)}</td>
        <td>${escapeHtml(c.gameName || '—')}</td>
        <td class="num">${c.viewers ?? 0}</td>
        <td class="num">${c.uses ?? 0}</td>
        <td>${c.lastUsedAt ? escapeHtml(formatDateTime(c.lastUsedAt)) : '—'}</td>
      </tr>`,
    )
    .join('');
  host.innerHTML = `<table>
    <thead><tr><th>Канал</th><th>Игра</th><th>Зрителей</th><th>Использован</th><th>В прошлый раз</th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

async function renderLog() {
  const reply = await send('GET_LOG');
  const host = $('log');
  host.innerHTML = (reply.log || [])
    .slice(-200)
    .reverse()
    .map((line) => `<div class="lv-${line.level}">${escapeHtml(formatDateTime(line.ts))} ${escapeHtml(line.message)}</div>`)
    .join('');
}

function renderSettings() {
  $('slots').value = settings.slots;
  $('rotateMinutes').value = settings.rotateMinutes;
  $('refreshMinutes').value = settings.refreshMinutes;
  $('minViewers').value = settings.minViewers;
  $('blacklist').value = settings.blacklist.join(', ');

  for (const key of [
    'autoDiscover',
    'mute',
    'lowQuality',
    'restoreQualityOnStop',
    'skipIfNoDrops',
    'notifyOnDrop',
    'resumeOnStartup',
  ]) {
    $(key).checked = Boolean(settings[key]);
  }

  $('toggle').textContent = running ? 'Остановить' : 'Запустить';
  $('toggle').className = running ? 'btn btn--stop' : 'btn btn--primary';
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

async function persist(patch) {
  const reply = await send('SETTINGS_PATCH', { patch });
  if (reply?.ok) {
    settings = reply.settings;
    return true;
  }
  toast(reply?.error || 'Не удалось сохранить', true);
  return false;
}

// -------------------------------------------------------------------- загрузка

async function loadAll() {
  const reply = await send('GET_STATE');
  if (!reply?.ok) return;
  settings = reply.settings;
  running = reply.session.running;

  const poolReply = await chrome.storage.local.get('pool');
  pool = poolReply.pool?.channels || {};
  $('poolMeta').textContent = Object.keys(pool).length
    ? `${Object.keys(pool).length} каналов · обновлён ${formatDateTime(reply.poolUpdatedAt || Date.now())}`
    : 'пусто';

  renderSettings();
  renderGames();
  renderPool();
  renderLog();
}

// -------------------------------------------------------------------- события

$('addGame').addEventListener('click', async () => {
  const input = $('gameInput');
  const value = input.value.trim();
  if (!value) return;
  setHint('Ищем игру…');
  try {
    const reply = await send('RESOLVE_GAME', { name: value });
    if (!reply?.ok) throw new Error(reply?.error || 'ошибка запроса');
    if (!reply.game) {
      setHint(`Игра «${value}» не найдена. Проверьте точное название или ID.`, 'error');
      return;
    }
    if (settings.games.some((g) => g.id === reply.game.id)) {
      setHint(`«${reply.game.name}» уже добавлена.`, 'error');
      return;
    }

    const preview = await send('PREVIEW_GAME', { gameId: reply.game.id });
    const count = preview?.channels?.length ?? 0;
    settings.games = [...settings.games, { id: reply.game.id, name: reply.game.name }];
    await persist({ games: settings.games });
    input.value = '';
    setHint(
      count
        ? `«${reply.game.name}»: найдено ${count} каналов с дропами.`
        : `«${reply.game.name}» добавлена, сейчас нет каналов с дропами.`,
      count ? 'ok' : 'error',
    );
    renderGames();
  } catch (error) {
    setHint(error.message, 'error');
  }
});

$('gameInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') $('addGame').click();
});

$('loadTop').addEventListener('click', async () => {
  const select = $('topGames');
  if (select.selectedIndex <= 0) {
    toast('Сначала выберите игру', true);
    return;
  }
  const [id, name] = select.value.split('|');
  $('gameInput').value = name;
  await $('addGame').click();
});

for (const id of ['slots', 'rotateMinutes', 'refreshMinutes', 'minViewers']) {
  $(id).addEventListener('change', () => persist({ [id]: Number($(id).value) }));
}

$('blacklist').addEventListener('change', () =>
  persist({ blacklist: $('blacklist').value.split(',').map((s) => s.trim()).filter(Boolean) }),
);

for (const key of [
  'autoDiscover',
  'mute',
  'lowQuality',
  'restoreQualityOnStop',
  'skipIfNoDrops',
  'notifyOnDrop',
  'resumeOnStartup',
]) {
  $(key).addEventListener('change', () => persist({ [key]: $(key).checked }));
}

$('refreshPool').addEventListener('click', async () => {
  $('refreshPool').disabled = true;
  await send('REFRESH_POOL');
  await loadAll();
  $('refreshPool').disabled = false;
  toast('Пул обновлён');
});

$('exportPool').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(pool, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'twitch-drops-pool.json';
  link.click();
  URL.revokeObjectURL(url);
});

$('clearLog').addEventListener('click', async () => {
  await send('CLEAR_LOG');
  renderLog();
});

$('toggle').addEventListener('click', async () => {
  const reply = await send(running ? 'STOP' : 'START');
  if (!reply?.ok && reply?.reason !== 'no-games') toast(reply?.error || 'Не удалось', true);
  if (reply?.reason === 'no-games') toast('Сначала добавьте игры', true);
  setTimeout(loadAll, 400);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.pool) {
    pool = changes.pool.newValue?.channels || {};
    renderPool();
  }
  if (changes.session) {
    running = Boolean(changes.session.newValue?.running);
    renderSettings();
  }
});

(async () => {
  // Список популярных игр подгружаем один раз, чтобы выбор был без копирования ID.
  try {
    const reply = await send('TOP_GAMES', { first: 40 });
    $('topGames').innerHTML =
      '<option value="">— выбрать —</option>' +
      (reply.games || []).map((g) => `<option value="${escapeHtml(g.id)}|${escapeHtml(g.name)}">${escapeHtml(g.name)}</option>`).join('');
  } catch {
    /* список необязателен */
  }
  await loadAll();
  setInterval(() => {
    if (!document.hidden) loadAll();
  }, 15_000);
})();
