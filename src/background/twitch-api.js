import { GQL_URL, WEB_CLIENT_ID, DROP_TAG } from '../shared/constants.js';

/** Транспорт: один POST с массивом операций, Twitch отвечает массивом результатов. */
async function gql(payload) {
  const res = await fetch(GQL_URL, {
    method: 'POST',
    headers: {
      'Client-ID': WEB_CLIENT_ID,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`GQL HTTP ${res.status}`);
  return res.json();
}

async function gqlOne(query, variables) {
  const json = await gql({ query, variables });
  if (json.errors?.length) throw new Error(json.errors[0].message || 'GQL error');
  return json.data;
}

/** Логин канала валиден только как [A-Za-z0-9_]{1,25} — иначе не подставляем его в запрос. */
export function isValidLogin(login) {
  return typeof login === 'string' && /^[A-Za-z0-9_]{1,25}$/.test(login);
}

/** Игра по названию или ID. Название регистронезависимое, но должно совпадать дословно. */
export async function resolveGame(input) {
  const value = String(input || '').trim();
  if (!value) return null;
  if (/^\d+$/.test(value)) {
    const data = await gqlOne(`query ($id: ID!) { game(id: $id) { id name } }`, { id: value });
    return data.game;
  }
  const data = await gqlOne(`query ($name: String!) { game(name: $name) { id name } }`, { name: value });
  return data.game;
}

/** Топ игр по умолчанию — используется, чтобы быстро наполнить выбор в настройках. */
export async function topGames(first = 30) {
  const data = await gqlOne(
    `query ($first: Int!) { games(first: $first) { edges { node { id name } } } }`,
    { first },
  );
  return data.games.edges.map((e) => e.node);
}

// SORT подставляется в текст запроса, потому что это enum, а не строка.
const dropStreamsQuery = (sort) =>
  `query Farm($id: ID!) {
  game(id: $id) {
    id
    name
    streams(options: { sort: ${sort}, freeformTags: ["${DROP_TAG}"] }) {
      edges { node { id viewersCount channel { id name displayName } } }
    }
  }
}`;

/**
 * Онлайн-каналы с включёнными дропами в игре.
 *
 * Фильтр `freeformTags: ["DropsEnabled"]` работает только как литерал в тексте
 * запроса — через variables эндпоинт его игнорирует и возвращает 0 строк.
 * Эндпоинт отдаёт не больше ~10 каналов за запрос, поэтому два разных sort
 * (по зрителям и по недавним) позволяют собрать заметно больший пул.
 */
export async function findDropChannels(gameId, { sorts = ['VIEWER_COUNT', 'RECENT'] } = {}) {
  const seen = new Map();
  const game = { id: gameId, name: null };

  for (const sort of sorts) {
    let data;
    try {
      data = await gqlOne(dropStreamsQuery(sort), { id: String(gameId) });
    } catch {
      continue; // одна из сортировок может быть недоступна — не теряем остальные
    }
    if (!data?.game) continue;
    game.name = data.game.name;
    for (const edge of data.game.streams.edges) {
      const node = edge?.node;
      const login = node?.channel?.name;
      if (!isValidLogin(login) || seen.has(login)) continue;
      seen.set(login, {
        login,
        displayName: node.channel.displayName || login,
        channelId: node.channel.id || null,
        gameId: game.name ? data.game.id : gameId,
        gameName: data.game.name,
        viewers: Number(node.viewersCount) || 0,
      });
    }
  }
  return { game, channels: [...seen.values()] };
}

/** Батч-проверка онлайна: до 20 каналов за один запрос. */
export async function checkLive(logins) {
  const valid = [...new Set(logins.filter(isValidLogin))].slice(0, 20);
  if (!valid.length) return new Map();

  const results = await gql(
    valid.map((login) => ({
      query: `query { channel(name: "${login}") { name displayName stream { id } } }`,
    })),
  );
  const map = new Map();
  const list = Array.isArray(results) ? results : [results];
  list.forEach((r, i) => {
    const ch = r?.data?.channel;
    if (!ch) return;
    map.set(ch.name, {
      live: Boolean(ch.stream?.id),
      streamId: ch.stream?.id || null,
      displayName: ch.displayName || ch.name,
    });
  });
  return map;
}
