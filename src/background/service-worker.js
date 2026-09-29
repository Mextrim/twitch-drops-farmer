import { ALARMS } from '../shared/constants.js';
import { getSettings, getSession, getPool, getLog, saveSettings, addLog, clearLog } from '../shared/storage.js';
import { start, stop, tick, skipSlot, refreshPool, handleTabStatus } from './farmer.js';
import { resolveGame, topGames, findDropChannels } from './twitch-api.js';

/**
 * Точка входа MV3. Service worker живёт недолго, поэтому все долгие операции
 * идут через chrome.alarms + chrome.storage, а не через таймеры в памяти.
 */

chrome.runtime.onInstalled.addListener(async (details) => {
  await getSettings(); // materializes defaults
  await addLog('info', 'Расширение установлено');
  if (details.reason === 'install') {
    await chrome.tabs.create({ url: chrome.runtime.getURL('src/options/options.html') });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  const [settings, session] = await Promise.all([getSettings(), getSession()]);
  if (settings.resumeOnStartup && session.running) {
    await addLog('info', 'Возобновление фарма после запуска браузера');
    await start();
  }
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === ALARMS.rotate) await tick('Ротация');
  if (alarm.name === ALARMS.refresh) await refreshPool();
});

/** Сообщения от popup, options и контент-скрипта. */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case 'GET_STATE': {
        const [settings, session, pool] = await Promise.all([getSettings(), getSession(), getPool()]);
        sendResponse({ ok: true, settings, session, poolSize: Object.keys(pool.channels).length, poolUpdatedAt: pool.updatedAt });
        return;
      }
      case 'START':
        sendResponse(await start());
        return;
      case 'STOP':
        sendResponse(await stop());
        return;
      case 'SKIP':
        sendResponse(await skipSlot(message.index));
        return;
      case 'SETTINGS_PATCH':
        sendResponse({ ok: true, settings: await saveSettings(message.patch || {}) });
        return;
      case 'REFRESH_POOL':
        sendResponse({ ok: true, pool: await refreshPool({ force: true }) });
        return;
      case 'RESOLVE_GAME':
        sendResponse({ ok: true, game: await resolveGame(message.name) });
        return;
      case 'TOP_GAMES':
        sendResponse({ ok: true, games: await topGames(message.first || 30) });
        return;
      case 'PREVIEW_GAME': {
        const found = await findDropChannels(message.gameId);
        sendResponse({ ok: true, game: found.game, channels: found.channels });
        return;
      }
      case 'GET_LOG':
        sendResponse({ ok: true, log: await getLog() });
        return;
      case 'CLEAR_LOG':
        await clearLog();
        sendResponse({ ok: true });
        return;
      case 'TAB_STATUS':
        await handleTabStatus({ ...message.data, tabId: sender.tab?.id });
        sendResponse({ ok: true });
        return;
      case 'FARM_TAB_ALIVE': {
        const session = await getSession();
        const slot = session.slots.find((s) => s.tabId === sender.tab?.id);
        sendResponse({ active: Boolean(slot), config: await getSettings() });
        return;
      }
      case 'OPEN_OPTIONS':
        await chrome.runtime.openOptionsPage();
        sendResponse({ ok: true });
        return;
      case 'OPEN_INVENTORY':
        await chrome.tabs.create({ url: 'https://www.twitch.tv/drops/inventory' });
        sendResponse({ ok: true });
        return;
      default:
        sendResponse({ ok: false, error: 'unknown message' });
    }
  })().catch((error) => sendResponse({ ok: false, error: error.message }));
  return true; // асинхронный ответ
});
