/**
 * Самотест: гоняет реальный код расширения против живого API Twitch
 * с замоканным окружением chrome.*.
 *
 * Запуск:  node tools/selftest.mjs
 */
import { pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// --------------------------------------------------------------- mock chrome

const store = {};
const alarms = new Map();
const createdTabs = [];
let tabSeq = 1000;

globalThis.chrome = {
  storage: {
    local: {
      async get(keys) {
        const list = Array.isArray(keys) ? keys : [keys];
        const out = {};
        for (const key of list) if (key in store) out[key] = store[key];
        return out;
      },
      async set(items) {
        Object.assign(store, items);
      },
    },
    onChanged: { addListener() {}, removeListener() {} },
  },
  alarms: {
    async clear(name) {
      alarms.delete(name);
    },
    create(name, info) {
      alarms.set(name, info);
    },
    onAlarm: { addListener() {} },
  },
  tabs: {
    async create({ url, active }) {
      const tab = { id: ++tabSeq, url, active };
      createdTabs.push(tab);
      return tab;
    },
    async update(id, props) {
      const tab = createdTabs.find((t) => t.id === id);
      if (!tab) throw new Error('no tab');
      Object.assign(tab, props);
      return tab;
    },
    async get(id) {
      const tab = createdTabs.find((t) => t.id === id);
      if (!tab) throw new Error('no tab');
      return tab;
    },
    async remove(id) {
      const i = createdTabs.findIndex((t) => t.id === id);
      if (i >= 0) createdTabs.splice(i, 1);
    },
    async query() {
      return [];
    },
    sendMessage() {
      return Promise.resolve();
    },
  },
  notifications: { async create() {} },
  runtime: { getURL: (p) => p },
};

// -------------------------------------------------------------------- helpers

let pass = 0;
let fail = 0;
function check(name, condition, detail = '') {
  if (condition) {
    pass++;
    console.log(`  ok   ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const importModule = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

// ---------------------------------------------------------------------- тесты

const api = await importModule('src/background/twitch-api.js');
const farmer = await importModule('src/background/farmer.js');
const storage = await importModule('src/shared/storage.js');

console.log('\n1. resolveGame по названию');
const valorant = await api.resolveGame('valorant');
check('игра найдена', valorant?.id === '516575', JSON.stringify(valorant));
const lol = await api.resolveGame('League of Legends');
check('второй запрос работает', lol?.id === '21779', JSON.stringify(lol));
const miss = await api.resolveGame('такой игры нет 12345');
check('несуществующая игра -> null', miss === null, JSON.stringify(miss));

console.log('\n2. валидация логинов');
check('нормальный логин', api.isValidLogin('xqc'));
check('кириллица отклоняется', !api.isValidLogin('канал'));
check('инъекция отклоняется', !api.isValidLogin('x" on {id} x{'));
check('длинный логин отклоняется', !api.isValidLogin('a'.repeat(26)));

console.log('\n3. findDropChannels: только каналы с дропами');
const found = await api.findDropChannels(valorant.id);
check('каналы найдены', found.channels.length > 0, `${found.channels.length} шт.`);
check('игра определена', found.game.name === 'VALORANT', found.game.name);
console.log(`     ${found.channels.map((c) => `${c.login}(${c.viewers})`).join(', ')}`);

console.log('\n4. findDropChannels на игре без дропов (Dota 2)');
const dota = await api.findDropChannels('29595');
check('пустой список без ошибок', Array.isArray(dota.channels), `${dota.channels.length} шт.`);

console.log('\n5. checkLive батчем');
const logins = found.channels.slice(0, 5).map((c) => c.login);
const live = await api.checkLive(logins);
check('ответ на все логины', live.size === logins.length, `${live.size}/${logins.length}`);
const onlineCount = [...live.values()].filter((v) => v.live).length;
check('каналы онлайн', onlineCount > 0, `${onlineCount} онлайн`);
const junk = await api.checkLive(['канал', 'x" on {id} x{', 'goodname']);
check('мусорные логины отброшены', junk.size === 1, `${[...junk.keys()].join(',')}`);

console.log('\n6. refreshPool строит пул');
await storage.saveSettings({ games: [{ id: valorant.id, name: valorant.name }, { id: lol.id, name: lol.name }] });
const pool = await farmer.refreshPool({ force: true });
const poolChannels = Object.values(pool.channels);
check('пул не пуст', poolChannels.length > 0, `${poolChannels.length} каналов`);
check(
  'в пуле только каналы с дропами',
  poolChannels.every((c) => c.gameId === valorant.id || c.gameId === lol.id),
);
check('у каналов есть viewers', poolChannels.every((c) => Number.isFinite(c.viewers)));
console.log(`     ${poolChannels.slice(0, 6).map((c) => `${c.login}:${c.gameName}`).join(', ')}`);

console.log('\n7. start() поднимает слот и открывает вкладку');
const result = await farmer.start();
check('start успешен', result.ok === true, JSON.stringify(result));
const session = await storage.getSession();
check('слот создан', session.slots.length === 1, `${session.slots.length}`);
check('канал назначен', Boolean(session.slots[0]?.login), session.slots[0]?.login);
check('вкладка открыта в фоне', createdTabs.every((t) => t.active === false));
check('будильник ротации поставлен', alarms.has('tdf:rotate'), [...alarms.keys()].join(','));
console.log(`     вкладка: ${createdTabs.map((t) => t.url).join(', ')}`);

console.log('\n8. tick() переключает при истечении таймера');
const first = session.slots[0].login;
await storage.saveSession({ ...session, slots: [{ ...session.slots[0], until: Date.now() - 1000 }] });
await farmer.tick('Ротация');
const after = await storage.getSession();
check('канал сменился или взят другой из пула', after.slots[0].login !== first || after.stats.switches > 1, `${first} -> ${after.slots[0].login}`);
console.log(`     ${first} -> ${after.slots[0].login} (переключений: ${after.stats.switches})`);

console.log('\n9a. отчёт контент-скрипта не роняет слот (решает API)');
const before9 = await storage.getSession();
const slot9 = before9.slots[0];
await farmer.handleTabStatus({ tabId: slot9.tabId, login: slot9.login, live: false, dropsTag: null });
const after9 = await storage.getSession();
check('канал не выкинут из-за DOM-вердикта', after9.slots[0].login === slot9.login, `${slot9.login} -> ${after9.slots[0].login}`);

console.log('\n9b. API сообщает, что канал офлайн -> переключение');
const offlineLogin = 'riotgames'; // заведомо не в эфире
const offlineStatus = await api.checkLive([offlineLogin]);
check('тестовый канал действительно офлайн', offlineStatus.get(offlineLogin)?.live === false);
const session9 = await storage.getSession();
await storage.saveSession({
  ...session9,
  slots: [{ ...session9.slots[0], login: offlineLogin, displayName: offlineLogin, until: Date.now() + 15 * 60_000 }],
});
await farmer.tick('Ротация');
const after9b = await storage.getSession();
check(
  'переключились на живой канал',
  after9b.slots[0].login !== offlineLogin && Boolean(after9b.slots[0].login),
  `${offlineLogin} -> ${after9b.slots[0].login}`,
);

console.log('\n10. stop() закрывает вкладки');
const stopResult = await farmer.stop();
check('stop успешен', stopResult.ok === true);
const stopped = await storage.getSession();
check('сессия остановлена', stopped.running === false);
check('слоты очищены', stopped.slots.length === 0);
check('вкладки закрыты', createdTabs.length === 0, `${createdTabs.length} осталось`);
check('будильник снят', !alarms.has('tdf:rotate'));

console.log('\n11. start() без игр отказывает');
await storage.saveSettings({ games: [] });
const noGames = await farmer.start();
check('корректный отказ', noGames.ok === false && noGames.reason === 'no-games', JSON.stringify(noGames));

console.log(`\nИтог: ${pass} ok, ${fail} fail`);
process.exit(fail ? 1 : 0);
