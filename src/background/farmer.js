import { ALARMS, MINUTE } from '../shared/constants.js';
import { getSettings, getPool, savePool, getSession, saveSession, addLog } from '../shared/storage.js';
import { findDropChannels, checkLive } from './twitch-api.js';

/**
 * Движок автофарма.
 *
 * Модель: держим N вкладок (слоты), в каждой открыт канал с дропами.
 * По истечении rotateMinutes слот переключается на следующий канал из пула.
 * Service worker в MV3 может быть выгружен в любой момент, поэтому всё
 * состояние лежит в chrome.storage, а расписание держится на chrome.alarms
 * (одноразовые будильники с точным временем срабатывания).
 */

let busy = false;

const now = () => Date.now();

/** Как часто просыпаться, даже если ротация ещё не пора. */
const HEARTBEAT_MS = 2 * MINUTE;

function blacklisted(login, displayName, words) {
  const haystack = `${login} ${displayName || ''}`.toLowerCase();
  return words.some((w) => w && haystack.includes(w));
}

/** Кандидаты из пула: не в blacklist, не сейчас заняты, сортировка «давно не брали + много зрителей». */
function rankCandidates(pool, settings, takenLogins) {
  return Object.values(pool.channels)
    .filter((c) => c.login && !takenLogins.has(c.login))
    .filter((c) => c.viewers >= settings.minViewers)
    .sort((a, b) => {
      const aCool = a.lastUsedAt || 0;
      const bCool = b.lastUsedAt || 0;
      if (aCool !== bCool) return aCool - bCool; // сначала те, что давно не использовались
      return b.viewers - a.viewers; // затем самые популярные
    });
}

/** Обновление пула каналов из discovery по всем включённым играм. */
export async function refreshPool({ force = false } = {}) {
  const settings = await getSettings();
  const session = await getSession();
  const pool = await getPool();

  if (!settings.games.length) {
    pool.updatedAt = now();
    await savePool(pool);
    return pool;
  }
  if (!settings.autoDiscover && !force) return pool;
  if (!force && pool.updatedAt && now() - pool.updatedAt < settings.refreshMinutes * MINUTE) {
    return pool;
  }

  const games = [];
  for (const game of settings.games) {
    try {
      const found = await findDropChannels(game.id);
      if (found.game?.name) game.name = found.game.name;
      for (const channel of found.channels) {
        const prev = pool.channels[channel.login] || {};
        pool.channels[channel.login] = {
          ...prev,
          ...channel,
          gameId: channel.gameId || game.id,
          gameName: channel.gameName || game.name || '',
          lastSeenAt: now(),
          lastUsedAt: prev.lastUsedAt || 0,
          uses: prev.uses || 0,
        };
      }
      games.push({ id: game.id, name: game.name, found: found.channels.length });
    } catch (error) {
      games.push({ id: game.id, name: game.name, found: 0, error: error.message });
    }
  }

  // Забываем каналы, которых не было в свежем опросе дольше часа.
  const staleBefore = now() - 60 * MINUTE;
  for (const [login, channel] of Object.entries(pool.channels)) {
    if ((channel.lastSeenAt || 0) < staleBefore) delete pool.channels[login];
  }

  pool.updatedAt = now();
  await savePool(pool);
  session.poolUpdatedAt = pool.updatedAt;
  session.nextRefreshAt = pool.updatedAt + settings.refreshMinutes * MINUTE;
  await saveSession(session);

  const total = games.reduce((sum, g) => sum + (g.found || 0), 0);
  await addLog('info', `Пул обновлён: каналов ${total} по ${games.length} играм`, { games });
  return pool;
}

/** Найти следующий канал для слота: пул → проверка онлайна батчем → возврат кандидата. */
async function pickChannel(settings, takenLogins) {
  let pool = await getPool();
  let candidates = rankCandidates(pool, settings, takenLogins).filter((c) => !blacklisted(c.login, c.displayName, settings.blacklist));

  if (!candidates.length) {
    pool = await refreshPool({ force: true });
    candidates = rankCandidates(pool, settings, takenLogins).filter((c) => !blacklisted(c.login, c.displayName, settings.blacklist));
  }
  if (!candidates.length) {
    await addLog('warn', 'В пуле нет подходящих каналов (проверьте игры и стоп-слова)');
    return null;
  }

  // Проверяем онлайн у верхней десятки кандидатов одним батчем.
  const probe = candidates.slice(0, Math.max(10, settings.cooldownCount));
  let live = new Map();
  try {
    live = await checkLive(probe.map((c) => c.login));
  } catch (error) {
    await addLog('warn', `Проверка онлайна не удалась: ${error.message}`);
  }

  for (const candidate of probe) {
    const status = live.get(candidate.login);
    if (live.size && !status?.live) {
      candidate.offlineAt = now();
      continue;
    }
    return candidate;
  }
  await addLog('warn', 'В пуле нет онлайн-каналов с дропами');
  return null;
}

/** Создать или переиспользовать вкладку слота. */
async function ensureTab(slot, settings, url) {
  if (slot.tabId != null) {
    try {
      // Переиспользуем вкладку: так не плодим вкладки и не теряем прогресс плеера.
      await chrome.tabs.update(slot.tabId, { url, active: false });
      return slot.tabId;
    } catch {
      slot.tabId = null; // вкладку закрыли — создаём заново
    }
  }
  const tab = await chrome.tabs.create({ url, active: false });
  slot.tabId = tab.id;
  return tab.id;
}

async function switchSlot(slot, settings, session, reason) {
  const taken = new Set(session.slots.filter((s) => s !== slot && s.login).map((s) => s.login));
  const channel = await pickChannel(settings, taken);
  if (!channel) return false;

  const pool = await getPool();
  if (pool.channels[channel.login]) {
    pool.channels[channel.login].lastUsedAt = now();
    pool.channels[channel.login].uses = (pool.channels[channel.login].uses || 0) + 1;
    pool.channels[channel.login].lastSeenAt = now();
    await savePool(pool);
  }

  try {
    await ensureTab(slot, settings, `https://www.twitch.tv/${channel.login}`);
  } catch (error) {
    await addLog('error', `Не удалось открыть ${channel.login}: ${error.message}`);
    return false;
  }

  slot.login = channel.login;
  slot.displayName = channel.displayName;
  slot.gameName = channel.gameName;
  slot.viewers = channel.viewers;
  slot.since = now();
  slot.until = now() + settings.rotateMinutes * MINUTE;
  slot.reason = reason;
  session.stats.switches = (session.stats.switches || 0) + 1;

  await addLog('info', `${reason}: ${channel.displayName} (${channel.viewers} зрит., ${channel.gameName || '—'})`);
  return true;
}

/** Единая точка планирования: ставит будильник на момент следующего переключения. */
async function schedule(session) {
  await chrome.alarms.clear(ALARMS.rotate);
  if (!session.running || !session.slots.length) return;

  const nexts = session.slots.map((s) => s.until || now() + 5 * MINUTE).filter(Boolean);
  const rotateAt = nexts.length ? Math.min(...nexts) : now() + MINUTE;
  // Просыпаемся не реже, чем раз в HEARTBEAT_MS: за это время проверяем,
  // что каналы ещё в эфире, и чиним слоты, если вкладку закрыли.
  const when = Math.max(Math.min(rotateAt, now() + HEARTBEAT_MS), now() + 30_000);
  chrome.alarms.create(ALARMS.rotate, { when });
  session.nextRotateAt = when;
  await saveSession(session);
}

/** Основной цикл: вызывается по будильнику. */
export async function tick(reason = 'Ротация') {
  if (busy) return;
  busy = true;
  try {
    const settings = await getSettings();
    const session = await getSession();
    if (!session.running) {
      await chrome.alarms.clear(ALARMS.rotate);
      return;
    }

    // Приводим список слотов к настроенному количеству: настройки могли измениться
    // во время работы, а лишние слоты надо забыть.
    session.slots = Array.from({ length: settings.slots }, (_, i) => {
      const existing = session.slots.find((s) => s.index === i);
      return existing || { index: i, tabId: null, login: null, until: 0 };
    });

    // Если вкладку закрыли вручную — слот возвращается в строй с новым каналом.
    for (const slot of session.slots) {
      if (slot.tabId == null) continue;
      try {
        await chrome.tabs.get(slot.tabId);
      } catch {
        await addLog('warn', `Вкладка ${slot.login} закрыта — открываем заново`);
        slot.tabId = null;
        slot.login = null;
        slot.until = 0;
      }
    }

    // Проверяем онлайн у текущих каналов одним батчем. DOM на странице Twitch
    // для этого ненадёжен (плеер перекрыт диалогами), а API отвечает точно.
    const watched = session.slots.filter((s) => s.login);
    if (watched.length) {
      try {
        const live = await checkLive(watched.map((s) => s.login));
        for (const slot of watched) {
          const status = live.get(slot.login);
          if (!live.size || !status) continue;
          slot.live = status.live;
          if (status.live) {
            slot.offline = false;
          } else if (!slot.offline) {
            slot.offline = true;
            await addLog('warn', `${slot.displayName || slot.login} больше не в эфире`);
          }
        }
      } catch (error) {
        await addLog('warn', `Проверка онлайна не удалась: ${error.message}`);
      }
    }

    for (const slot of session.slots) {
      const expired = (slot.until || 0) <= now();
      const offline = slot.offline;
      if (expired || offline) {
        await switchSlot(slot, settings, session, offline ? 'Канал офлайн' : reason);
      }
    }

    // Периодически подтягиваем свежий пул: каналы постоянно заходят и уходят.
    if (settings.autoDiscover) {
      const pool = await getPool();
      if (!pool.updatedAt || now() - pool.updatedAt > settings.refreshMinutes * MINUTE) {
        await refreshPool();
      }
    }

    await saveSession(session);
    await schedule(session);
  } catch (error) {
    await addLog('error', `Ошибка цикла: ${error.message}`);
  } finally {
    busy = false;
  }
}

export async function start() {
  const settings = await getSettings();
  if (!settings.games.length) {
    await addLog('warn', 'Не выбрано ни одной игры — добавьте игры в настройках');
    return { ok: false, reason: 'no-games' };
  }

  const session = await getSession();
  session.running = true;
  session.startedAt = session.startedAt || now();
  session.lastError = null;
  session.slots = Array.from({ length: settings.slots }, (_, i) => ({
    index: i,
    tabId: null,
    login: null,
    displayName: null,
    gameName: null,
    viewers: 0,
    since: null,
    until: 0,
  }));
  await saveSession(session);
  await addLog('info', `Фарм запущен: слотов ${settings.slots}, ротация ${settings.rotateMinutes} мин`);
  await refreshPool({ force: true });
  await tick('Старт');
  return { ok: true };
}

export async function stop() {
  const settings = await getSettings();
  const session = await getSession();
  session.running = false;
  session.nextRotateAt = null;
  for (const slot of session.slots) {
    if (slot.tabId != null) {
      try {
        await chrome.tabs.remove(slot.tabId);
      } catch {
        /* вкладку уже закрыли */
      }
    }
  }
  session.slots = [];
  await saveSession(session);
  await chrome.alarms.clear(ALARMS.rotate);
  await addLog('info', 'Фарм остановлен');
  if (settings.restoreQualityOnStop) {
    // Качество восстанавливает контент-скрипт на twitch.tv.
    try {
      const tabs = await chrome.tabs.query({ url: 'https://www.twitch.tv/*' });
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: 'FARM_STOP' }).catch(() => {});
      }
    } catch {
      /* вкладок нет */
    }
  }
  return { ok: true };
}

export async function skipSlot(index) {
  const session = await getSession();
  const slot = session.slots.find((s) => s.index === index);
  if (!slot) return { ok: false };
  slot.until = 0;
  await saveSession(session);
  await tick('Пропуск канала');
  return { ok: true };
}

/** Реакция на события от контент-скрипта. */
export async function handleTabStatus({ tabId, login, live, dropsTag, progressText, claimed }) {
  const session = await getSession();
  const slot = session.slots.find((s) => s.tabId === tabId || (s.login && s.login === login));
  if (!slot) return;

  // Онлайн-статусом ведает API: на странице Twitch плеер может быть закрыт
  // диалогом, и вердикт «офлайн» от DOM был бы ложным.
  if (live != null) slot.live = live;
  slot.dropsTag = dropsTag;
  slot.progressText = progressText || slot.progressText || null;
  slot.lastSeenAt = now();

  if (claimed) {
    session.stats.dropNotices = (session.stats.dropNotices || 0) + 1;
    await addLog('success', `Дроп засчитан на ${slot.displayName || slot.login}`);
    if ((await getSettings()).notifyOnDrop) {
      try {
        await chrome.notifications.create({
          type: 'basic',
          iconUrl: chrome.runtime.getURL('icons/icon128.png'),
          title: 'Twitch Drops — дроп получен',
          message: `${slot.displayName || slot.login}: ${progressText || 'новый предмет'}`.slice(0, 180),
        });
      } catch {
        /* уведомления могут быть отключены */
      }
    }
  }

  // Страница канала загрузилась, а тега дропов нет — на этом слоте дропов не будет.
  if (dropsTag === false && (await getSettings()).skipIfNoDrops) {
    slot.offline = true;
    slot.reason = 'Без дропов';
  }

  await saveSession(session);
  if (slot.offline) await tick(slot.reason || 'Переключение');
}
