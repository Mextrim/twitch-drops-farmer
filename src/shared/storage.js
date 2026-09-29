import { KEYS, DEFAULT_SETTINGS, EMPTY_POOL, EMPTY_SESSION, LIMITS } from './constants.js';

/** Глубокое слияние с дефолтами, чтобы новые настройки появлялись у старых установок. */
function withDefaults(value, defaults) {
  const out = { ...defaults };
  if (!value || typeof value !== 'object') return out;
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) out[k] = v;
    else if (typeof v === 'object' && typeof defaults[k] === 'object' && !Array.isArray(defaults[k])) {
      out[k] = withDefaults(v, defaults[k]);
    } else out[k] = v;
  }
  return out;
}

/** Прижимаем числовые настройки к допустимым диапазонам. */
function clampSettings(s) {
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const n = Number(s[key]);
    s[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : DEFAULT_SETTINGS[key];
  }
  s.slots = Math.max(1, Math.min(4, Math.round(Number(s.slots) || 1)));
  s.games = (Array.isArray(s.games) ? s.games : [])
    .filter((g) => g && (g.id || g.name))
    .map((g) => ({ id: String(g.id || ''), name: String(g.name || g.id || '') }));
  s.blacklist = (Array.isArray(s.blacklist) ? s.blacklist : [])
    .map((w) => String(w).trim().toLowerCase())
    .filter(Boolean);
  return s;
}

export async function getSettings() {
  const { [KEYS.settings]: raw } = await chrome.storage.local.get(KEYS.settings);
  return clampSettings(withDefaults(raw, DEFAULT_SETTINGS));
}

export async function saveSettings(patch) {
  const next = clampSettings(withDefaults({ ...(await getSettings()), ...patch }, DEFAULT_SETTINGS));
  await chrome.storage.local.set({ [KEYS.settings]: next });
  return next;
}

export async function getPool() {
  const { [KEYS.pool]: raw } = await chrome.storage.local.get(KEYS.pool);
  const pool = withDefaults(raw, EMPTY_POOL);
  if (!pool.channels || typeof pool.channels !== 'object') pool.channels = {};
  return pool;
}

export async function savePool(pool) {
  await chrome.storage.local.set({ [KEYS.pool]: pool });
  return pool;
}

export async function getSession() {
  const { [KEYS.session]: raw } = await chrome.storage.local.get(KEYS.session);
  return withDefaults(raw, EMPTY_SESSION);
}

export async function saveSession(session) {
  await chrome.storage.local.set({ [KEYS.session]: session });
  return session;
}

const LOG_LIMIT = 200;

export async function addLog(level, message, extra) {
  const { [KEYS.log]: log } = await chrome.storage.local.get(KEYS.log);
  const list = Array.isArray(log) ? log : [];
  list.push({ ts: Date.now(), level, message, extra });
  while (list.length > LOG_LIMIT) list.shift();
  await chrome.storage.local.set({ [KEYS.log]: list });
  return list;
}

export async function getLog() {
  const { [KEYS.log]: log } = await chrome.storage.local.get(KEYS.log);
  return Array.isArray(log) ? log : [];
}

export async function clearLog() {
  await chrome.storage.local.set({ [KEYS.log]: [] });
}

export function onStorageChanged(handler) {
  const listener = (changes, area) => {
    if (area !== 'local') return;
    handler(changes);
  };
  chrome.storage.onChanged.addListener(listener);
  return () => chrome.storage.onChanged.removeListener(listener);
}
