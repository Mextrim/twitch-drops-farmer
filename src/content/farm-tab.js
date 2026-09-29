/**
 * Контент-скрипт фарм-вкладок.
 *
 * Запускается на всех страницах twitch.tv, но бездействует, пока background
 * не подтвердит, что вкладка принадлежит фарму. На активной вкладке:
 *  - ставит минимальное качество (160p) и отключает звук;
 *  - определяет, включены ли на канале дропы (тег в шапке канала);
 *  - определяет, что стрим ушёл в офлайн;
 *  - ловит всплывашки «дроп получен» и шлёт heartbeat в background.
 */
(() => {
  const isTwitchChannelPage = () => /^\/[A-Za-z0-9_]{1,25}$/.test(location.pathname);
  const loginFromPath = () => (isTwitchChannelPage() ? location.pathname.slice(1).toLowerCase() : null);

  const video = () => document.querySelector('video');

  /** Качество: Twitch хранит выбор в localStorage['video-quality']. */
  const QUALITY_KEY = 'video-quality';
  const LOW_QUALITY = { default: '160p30' };

  let config = null;
  let qualityApplied = false;
  let qualityBackup = null;
  let lastRoute = location.pathname;
  let lastClaimAt = 0;
  let claimedSent = false;
  let pageReadyAt = 0;

  /** Тег дропов и заголовок канала подгружаются асинхронно — не торопимся с выводами. */
  const SETTLE_MS = 25_000;

  const send = (type, data) =>
    chrome.runtime.sendMessage({ type, data }).catch(() => {});

  // ---------------------------------------------------------------- качество

  function applyQuality() {
    if (!config?.lowQuality || qualityApplied) return;
    const raw = localStorage.getItem(QUALITY_KEY);
    if (raw && raw.includes('160p')) {
      qualityApplied = true;
      return;
    }
    qualityBackup = raw;
    localStorage.setItem(QUALITY_KEY, JSON.stringify(LOW_QUALITY));
    qualityApplied = true;
  }

  function restoreQuality() {
    if (qualityBackup === null) return;
    try {
      if (qualityBackup === undefined) localStorage.removeItem(QUALITY_KEY);
      else localStorage.setItem(QUALITY_KEY, qualityBackup);
    } catch {
      /* localStorage может быть недоступен */
    }
    qualityBackup = null;
    qualityApplied = false;
  }

  // -------------------------------------------------------------------- звук

  function applyMute() {
    if (!config?.mute) return;
    const v = video();
    if (!v) return;
    if (!v.muted) {
      const button = document.querySelector('[data-a-target="player-mute-unmute-button"]');
      if (button) button.click();
      else v.muted = true;
    }
    v.volume = 0;
  }

  // -------------------------------------------------------------- детекторы

  /** Тег «Drops Enabled» в шапке канала — подтверждение, что дропы включены. */
  function hasDropsTag() {
    return Boolean(
      document.querySelector(
        'a[data-a-target^="Drops"], a[href*="/directory/all/tags/Drops"], [data-a-target="DropsEnabled"]',
      ),
    );
  }

  const OFFLINE_PATTERNS =
    /(this streamer is offline|isn'?t'? online|offline right now|не в эфире|не в эфире прямо сейчас|прямо сейчас не в эфире|チャンネルはオフライン|canal está desconectado)/i;

  function isOffline() {
    if (!video()) return false; // плеер ещё не смонтирован — это не офлайн
    const overlay = document.querySelector('[data-a-target="player-overlay-click-handler"]');
    const player = document.querySelector('[data-a-target="player"], .player-column__player');
    const scope = overlay || player;
    const text = (scope || document.body).innerText || '';
    if (OFFLINE_PATTERNS.test(text.slice(0, 2000))) return true;
    const v = video();
    return Boolean(v && v.error);
  }

  /** Текст прогресса дропа из тостов/панелей, если Twitch его показывает. */
  function readProgressText() {
    const candidates = document.querySelectorAll(
      '[data-a-target*="toast" i], [class*="toast" i], [class*="notification" i], [data-a-target*="drops" i]',
    );
    for (const el of candidates) {
      if (el.offsetParent === null) continue;
      const text = (el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!text || text.length > 160) continue;
      if (/\d+\s*%/.test(text) || /\d+\s*(ч|h|hr|м|m|min)\b/i.test(text)) return text;
    }
    return null;
  }

  const CLAIM_PATTERNS =
    /(drop\s+(was\s+)?claimed|claimed\s+a\s+drop|drop\s+received|дроп\s+(получен|забран|начислен)|получен\s+дроп)/i;

  function detectClaim() {
    if (claimedSent) return null;
    const host =
      document.querySelector('[data-a-target="notifications-list"], [class*="notification" i]') || document.body;
    const text = (host.textContent || '').replace(/\s+/g, ' ');
    if (!CLAIM_PATTERNS.test(text)) return null;
    const nowMs = Date.now();
    if (nowMs - lastClaimAt < 60_000) return null;
    lastClaimAt = nowMs;
    claimedSent = true;
    return readProgressText() || 'Новый предмет';
  }

  // ----------------------------------------------------------------- цикл

  /**
   * Статус дропов на канале.
   * null = «ещё не знаем»: шапка канала с тегами рендерится с задержкой,
   * и ранний ответ «дропов нет» приводил бы к лишним переключениям.
   */
  function dropsStatus() {
    if (!isTwitchChannelPage()) return null;
    if (hasDropsTag()) return true;
    return Date.now() - pageReadyAt > SETTLE_MS ? false : null;
  }

  function report(reason) {
    const login = loginFromPath();
    if (!login) return;
    const claimed = detectClaim();
    send('TAB_STATUS', {
      login,
      live: isOffline() ? false : Boolean(video()),
      dropsTag: dropsStatus(),
      progressText: readProgressText(),
      claimed: claimed || false,
      reason,
    });
  }

  function tick() {
    if (!config) return;
    applyMute();
    applyQuality();
    if (location.pathname !== lastRoute) {
      lastRoute = location.pathname;
      claimedSent = false;
      pageReadyAt = Date.now();
    }
    report('heartbeat');
  }

  async function init() {
    let answer;
    try {
      answer = await chrome.runtime.sendMessage({ type: 'FARM_TAB_ALIVE' });
    } catch {
      return; // service worker недоступен — остаёмся пассивными
    }
    if (!answer?.active) return;

    config = answer.config || {};
    pageReadyAt = Date.now();
    applyQuality();
    applyMute();

    const observer = new MutationObserver(() => {
      applyMute();
      const claim = detectClaim();
      if (claim) report('claim');
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });

    setInterval(tick, 10_000);
    setTimeout(tick, 2_500);
    window.addEventListener('pageshow', () => {
      claimedSent = false;
      tick();
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'FARM_STOP') restoreQuality();
  });

  init();
})();
