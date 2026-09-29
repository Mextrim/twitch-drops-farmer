/**
 * Мок chrome.* для предпросмотра UI без установки расширения.
 * Подключается обычным <script> до загрузки модулей страницы.
 */
(() => {
  const store = {
    settings: {
      version: 1,
      games: [
        { id: '516575', name: 'VALORANT' },
        { id: '21779', name: 'League of Legends' },
        { id: '509658', name: 'Just Chatting' },
      ],
      slots: 2,
      rotateMinutes: 15,
      autoDiscover: true,
      refreshMinutes: 20,
      skipIfNoDrops: true,
      lowQuality: true,
      restoreQualityOnStop: true,
      mute: true,
      notifyOnDrop: true,
      separateWindow: false,
      resumeOnStartup: false,
      blacklist: ['russian', 'политика'],
      minViewers: 20,
      cooldownCount: 5,
    },
    session: {
      running: true,
      startedAt: Date.now() - 52 * 60_000,
      nextRotateAt: Date.now() + 7 * 60_000 + 12_000,
      slots: [
        {
          index: 0,
          tabId: 11,
          login: 'tenz',
          displayName: 'TenZ',
          gameName: 'VALORANT',
          viewers: 5929,
          since: Date.now() - 8 * 60_000,
          until: Date.now() + 7 * 60_000,
          live: true,
          dropsTag: true,
          progressText: '37%',
        },
        {
          index: 1,
          tabId: 12,
          login: 'jankos',
          displayName: 'Jankos',
          gameName: 'League of Legends',
          viewers: 1697,
          since: Date.now() - 12 * 60_000,
          until: Date.now() + 3 * 60_000,
          live: true,
          dropsTag: false,
          progressText: null,
        },
      ],
      poolUpdatedAt: Date.now() - 4 * 60_000,
      stats: { switches: 47, offlineSkips: 6, dropNotices: 3 },
      lastError: null,
    },
    pool: {
      updatedAt: Date.now() - 4 * 60_000,
      channels: Object.fromEntries(
        [
          ['valorant', 'VALORANT', 39140],
          ['tenz', 'VALORANT', 5929],
          ['jankos', 'League of Legends', 1697],
          ['thinkingmansvalo', 'VALORANT', 1277],
          ['zikzlol', 'VALORANT', 1158],
          ['arii', 'VALORANT', 593],
          ['yinsu', 'VALORANT', 533],
          ['angelknivez', 'VALORANT', 308],
          ['chemicaldumplings', 'League of Legends', 67],
        ].map(([login, game, viewers], i) => [
          login,
          {
            login,
            displayName: login,
            gameId: game === 'VALORANT' ? '516575' : '21779',
            gameName: game,
            viewers,
            uses: i,
            lastUsedAt: i < 4 ? Date.now() - i * 9 * 60_000 : 0,
            lastSeenAt: Date.now() - 4 * 60_000,
          },
        ]),
      ),
    },
    log: [
      { ts: Date.now() - 300_000, level: 'info', message: 'Фарм запущен: слотов 2, ротация 15 мин' },
      { ts: Date.now() - 240_000, level: 'info', message: 'Пул обновлён: каналов 41 по 3 играм' },
      { ts: Date.now() - 180_000, level: 'warn', message: 'Канал офлайн: shanks_ttv' },
      { ts: Date.now() - 120_000, level: 'info', message: 'Ротация: TenZ (5929 зрит., VALORANT)' },
      { ts: Date.now() - 60_000, level: 'success', message: 'Дроп засчитан на TenZ' },
    ],
  };

  const pick = (payload) => {
    const keys = payload?.type === 'GET_STATE'
      ? ['settings', 'session', 'pool']
      : payload?.type === 'GET_LOG'
        ? ['log']
        : [];
    const out = {};
    for (const key of keys) out[key] = store[key];
    return out;
  };

  const game = { id: '516575', name: 'VALORANT' };
  const poolChannels = Object.values(store.pool.channels);

  window.chrome = {
    runtime: {
      getURL: (p) => `/src/../${p}`,
      openOptionsPage: async () => {},
      sendMessage: async (msg) => {
        switch (msg?.type) {
          case 'GET_STATE':
            return {
              ok: true,
              settings: store.settings,
              session: store.session,
              poolSize: poolChannels.length,
              poolUpdatedAt: store.pool.updatedAt,
            };
          case 'GET_LOG':
            return { ok: true, log: store.log };
          case 'RESOLVE_GAME':
            return { ok: true, game };
          case 'PREVIEW_GAME':
            return { ok: true, game, channels: poolChannels.filter((c) => c.gameId === msg.gameId) };
          case 'TOP_GAMES':
            return { ok: true, games: store.settings.games };
          case 'START':
          case 'STOP':
            store.session.running = msg.type === 'START';
            return { ok: true };
          case 'SKIP':
            return { ok: true };
          case 'SETTINGS_PATCH':
            Object.assign(store.settings, msg.patch);
            return { ok: true, settings: store.settings };
          case 'REFRESH_POOL':
            return { ok: true, pool: store.pool };
          default:
            return { ok: true };
        }
      },
      onMessage: { addListener() {} },
    },
    storage: {
      local: {
        get: async (k) => {
          const list = Array.isArray(k) ? k : [k];
          const out = {};
          for (const key of list) if (key in store) out[key] = store[key];
          return out;
        },
        set: async (items) => Object.assign(store, items),
      },
      onChanged: { addListener() {}, removeListener() {} },
    },
    tabs: { create: async () => ({}), sendMessage: async () => {} },
  };

  window.__previewStore = store;
})();
