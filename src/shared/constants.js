/**
 * Общие константы для service worker, popup и options.
 * Скрипт service worker подключается как ES-модуль (manifest: type: "module"),
 * поэтому здесь можно использовать import/export.
 */

/** GraphQL-эндпоинт Twitch (тот же, что использует веб-клиент на twitch.tv). */
export const GQL_URL = 'https://gql.twitch.tv/gql';

/**
 * Публичный Client-ID веб-клиента Twitch.
 * Это не секретный ключ: его использует каждая страница twitch.tv.
 * Он нужен только для чтения публичных данных (список стримов, онлайн-статус).
 */
export const WEB_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';

/**
 * Тег, который Twitch вешает каналу, когда на стриме включены дропы.
 * Серверная фильтрация по нему позволяет получать только нужные каналы.
 * Важно: значение подставляется литералом в текст запроса — GQL-эндпоинт
 * не применяет переданные через variables значения к этому аргументу.
 */
export const DROP_TAG = 'DropsEnabled';

/** Локализованные варианты того же тега — нужны для проверки DOM-подтверждения. */
export const DROP_TAG_VARIANTS = [
  'DropsEnabled',
  'DropsВключены',
  'Drops有効',
  'DropsActivados',
  'DropsActivés',
  'DropsAktiviert',
  'DropsAbilitati',
  '启用掉宝',
  '掉落寶物',
  '드롭활성화',
];

/** Ссылка на каталог тегов Twitch: /directory/all/tags/<tag>. */
export const DROP_TAG_PATH = '/directory/all/tags/';

/** Ключи chrome.storage. */
export const KEYS = {
  settings: 'settings',
  pool: 'pool',
  session: 'session',
  log: 'log',
};

/** Имена будильников. */
export const ALARMS = {
  rotate: 'tdf:rotate',
  refresh: 'tdf:refresh',
};

export const MINUTE = 60_000;

/** Настройки по умолчанию. */
export const DEFAULT_SETTINGS = {
  version: 1,

  /** Список игр, по которым ищем каналы с дропами. */
  games: [],

  /** Сколько одновременно каналов держать открытыми (1..4). */
  slots: 1,

  /** Сколько минут смотреть на один канал перед переключением. */
  rotateMinutes: 15,

  /** Автоматически пополнять пул каналов из discovery. */
  autoDiscover: true,

  /** Как часто обновлять пул каналов, минут. */
  refreshMinutes: 20,

  /** Пропускать каналы, у которых на странице нет тега «Drops Enabled». */
  skipIfNoDrops: true,

  /** Ставить минимальное качество 160p. Меняет глобальную настройку Twitch. */
  lowQuality: true,

  /** Восстанавливать прежнее качество после остановки. */
  restoreQualityOnStop: true,

  /** Отключать звук на фарм-вкладках. */
  mute: true,

  /** Уведомлять, когда дроп засчитан. */
  notifyOnDrop: true,

  /** Открывать фарм-вкладки в отдельном окне. */
  separateWindow: false,

  /** Возобновлять фарм после перезапуска браузера. */
  resumeOnStartup: true,

  /** Слова, по которым канал отбрасывается (через запятую). */
  blacklist: [],

  /** Минимум зрителей, чтобы брать канал в пул. */
  minViewers: 0,

  /** Сколько последних каналов не переиспользовать подряд. */
  cooldownCount: 5,
};

export const EMPTY_SESSION = {
  running: false,
  startedAt: null,
  slots: [],
  poolUpdatedAt: null,
  nextRefreshAt: null,
  stats: { switches: 0, offlineSkips: 0, dropNotices: 0 },
  lastError: null,
};

export const EMPTY_POOL = {
  updatedAt: null,
  channels: {},
};

/** Разрешённые диапазоны — защита от мусора в настройках. */
export const LIMITS = {
  slots: [1, 4],
  rotateMinutes: [1, 240],
  refreshMinutes: [5, 240],
  minViewers: [0, 1000000],
  cooldownCount: [0, 100],
};
