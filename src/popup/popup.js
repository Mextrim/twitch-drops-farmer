import { formatDuration, formatTime } from '../shared/format.js';

const $ = (id) => document.getElementById(id);
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

let state = null;
let rotateMinutes = 15;

function badge(slot) {
  if (slot.live === false) return ['badge badge--bad', 'офлайн'];
  if (slot.dropsTag === false) return ['badge badge--warn', 'без дропов'];
  if (slot.dropsTag) return ['badge badge--ok', 'дропы'];
  return ['badge', 'проверка…'];
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
}

function renderSlots(session) {
  const host = $('slots');
  if (!session.slots?.length) {
    host.innerHTML = '<p class="empty">Фарм не запущен</p>';
    return;
  }
  host.innerHTML = '';
  const spanMs = rotateMinutes * 60_000;

  for (const slot of session.slots) {
    const [className, text] = badge(slot);
    const elapsed = slot.since ? Math.max(0, Date.now() - slot.since) : 0;
    const share = spanMs ? Math.min(100, Math.round((elapsed / spanMs) * 100)) : 0;

    const el = document.createElement('div');
    el.className = 'slot';
    el.innerHTML = `
      <div class="slot__row">
        <span class="slot__name">${escapeHtml(slot.displayName || slot.login || '…')}</span>
        <span class="${className}">${text}</span>
      </div>
      <div class="slot__meta">
        ${escapeHtml(slot.gameName || 'игра не определена')} · ${slot.viewers ?? 0} зрителей
      </div>
      <div class="slot__foot">
        <div class="bar"><div class="bar__fill" style="width:${share}%"></div></div>
        <button class="slot__skip" type="button">Пропустить</button>
      </div>`;

    el.querySelector('.slot__skip').addEventListener('click', async () => {
      el.querySelector('.slot__skip').disabled = true;
      await send('SKIP', { index: slot.index });
      refresh();
    });
    host.appendChild(el);
  }
}

function renderLog(log) {
  const host = $('log');
  host.innerHTML = '';
  for (const line of log.slice(-16).reverse()) {
    const el = document.createElement('div');
    el.className = `log__line log__line--${line.level}`;
    el.innerHTML = `<span class="log__time">${formatTime(line.ts)}</span><span>${escapeHtml(line.message)}</span>`;
    el.title = line.message;
    host.appendChild(el);
  }
}

async function refresh() {
  const [stateReply, logReply] = await Promise.all([send('GET_STATE'), send('GET_LOG')]);
  if (!stateReply?.ok) return;
  state = stateReply;

  const { session, settings } = stateReply;
  rotateMinutes = settings.rotateMinutes;

  const status = $('status');
  const statusText = $('statusText');
  const toggle = $('toggle');

  if (session.running) {
    status.className = 'head__status is-on';
    statusText.textContent = `Идёт фарм · ротация ${settings.rotateMinutes} мин`;
    toggle.textContent = 'Остановить';
    toggle.className = 'btn btn--stop';
  } else {
    status.className = session.lastError ? 'head__status is-error' : 'head__status';
    statusText.textContent = session.lastError || 'На паузе';
    toggle.textContent = 'Запустить';
    toggle.className = 'btn btn--primary';
  }

  $('statSlots').textContent = stateReply.poolSize;
  $('statSwitches').textContent = session.stats?.switches ?? 0;
  $('statNext').textContent = session.nextRotateAt
    ? formatDuration(Math.max(0, session.nextRotateAt - Date.now()))
    : '—';

  $('optMute').checked = settings.mute;
  $('optNotify').checked = settings.notifyOnDrop;
  $('optLowQuality').checked = settings.lowQuality;

  renderSlots(session);
  renderLog(logReply?.log || []);
}

$('toggle').addEventListener('click', async () => {
  const running = state?.session?.running;
  $('toggle').disabled = true;
  const reply = await send(running ? 'STOP' : 'START');
  $('toggle').disabled = false;
  if (reply && reply.ok === false) console.warn('start/stop:', reply.reason || reply.error);
  setTimeout(refresh, 300);
});

for (const [id, key] of [
  ['optMute', 'mute'],
  ['optNotify', 'notifyOnDrop'],
  ['optLowQuality', 'lowQuality'],
]) {
  $(id).addEventListener('change', async (event) => {
    await send('SETTINGS_PATCH', { patch: { [key]: event.target.checked } });
    refresh();
  });
}

$('refresh').addEventListener('click', async () => {
  $('refresh').disabled = true;
  $('refresh').textContent = 'Обновляю…';
  await send('REFRESH_POOL');
  $('refresh').textContent = 'Обновить пул';
  $('refresh').disabled = false;
  refresh();
});

$('inventory').addEventListener('click', () => send('OPEN_INVENTORY'));
$('options').addEventListener('click', () => send('OPEN_OPTIONS'));

refresh();
setInterval(refresh, 1000);
