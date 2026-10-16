// server/http/websocket.js — the real-time side of the server:
//
//   * session wiring: SessionRegistry (reconnect tokens) → Lobby (rooms, server/lobby.js) → Network (the socket
//     protocol, server/net.js), built from the startServer() options (config.js decides which go where);
//   * WebSocket (ws) at /ws, maxPayload 64 KB, permessage-deflate (WS_DEFLATE) → Network.handleConnection. Refused at
//     the upgrade: any other path 404; per-network socket limit for internet clients (maxConnectionsPerAddr, see net.js
//     clientAddress; local/LAN peers are exempt) 429; server full (maxConnections) or shutting down 503.

import { WebSocketServer } from 'ws';
import { Network, SessionRegistry, NET_DEFAULTS } from '../net.js';
import { Lobby } from '../lobby.js';
import { splitUrl } from './common.js';
// 工坊 mod 层移植 (2026-10-17, DESIGN §34): 包声明的 WS 车道（`server.http.wsLanes`）—— 每条车道在 `/ws` 之外占一个
// 路径，自己拥有那条 socket。判据（路径合法性 / 保留路径 / 上限）只有 `wsLanes.js` 一份。
import { validateLanes, resolveLane } from './wsLanes.js';
import { netOptionsFrom, lobbyOptionsFrom } from './config.js';

/** Inbound WebSocket frame limit (DESIGN §8). */
export const WS_MAX_PAYLOAD = 64 * 1024;

/**
 * permessage-deflate (RFC 7692) for the JSON text frames. A message from 1 KB up (m.public, m.private, b.start, welcome
 * …) is compressed on its own — no context is kept from one message to the next (`serverNoContextTakeover`) — with a
 * 2 KB window and zlib memLevel 7, so a connection holds about 72 KB of zlib state; smaller frames (pong, ok) go out
 * as they are. Measured on a solo session (rounds 3–5, the server's own counters, traffic.js): 173 KB of payload →
 * 60 KB on the wire; replaying a session's frames with larger windows gained nothing on these messages. Browsers
 * negotiate it by themselves; a client that offers none gets plain frames. The inflated size of a client frame still
 * counts against WS_MAX_PAYLOAD.
 */
export const WS_DEFLATE = Object.freeze({
  threshold: 1024,
  serverNoContextTakeover: true,
  serverMaxWindowBits: 11,
  zlibDeflateOptions: Object.freeze({ memLevel: 7 }),
});

/**
 * `ws` 自己的 `perMessageDeflate.threshold` 缺省值（1024；工坊 mod 层移植, 2026-10-16）。**只**用在「包没声明
 * threshold」时的诊断文案里 —— 引擎刻意不把库的缺省值抄成自己的配置，抄一份就是第二个会漂的真相。
 */
export const WS_DEFLATE_LIBRARY_THRESHOLD = 1024;

/**
 * Does every permessage-deflate offer of this `Sec-WebSocket-Extensions` header cap the server window below
 * WS_DEFLATE.serverMaxWindowBits? ws cannot accept such an offer and refuses the whole handshake (400), so the upgrade
 * drops the header instead and the connection goes uncompressed. No browser sends `server_max_window_bits`.
 * @param {string | string[] | undefined} header
 */
export function narrowDeflateOffer(header) {
  if (typeof header !== 'string') return false;
  const offers = header.split(',').map((s) => s.trim()).filter((s) => /^permessage-deflate\b/i.test(s));
  if (!offers.length) return false;
  return offers.every((offer) => {
    const m = /(?:^|;)\s*server_max_window_bits\s*=\s*"?(\d+)"?/i.exec(offer);
    return !!m && Number(m[1]) < WS_DEFLATE.serverMaxWindowBits;
  });
}

/**
 * The session stack of one server.
 * @param {{ MatchClass?: Function, seedFn?: () => number, [option: string]: any }} opts startServer() options
 * @param {{ data: object, log: object, content?: { cs: string } | null,
 *   plugins?: ReturnType<typeof import('../plugins/roomSets.js').createRoomSets> | null,
 *   hosts?: ReturnType<typeof import('../match/host/index.js').createMatchHosts> | null }} deps the game data the lobby's
 *   matches use, the logger, the vanilla content (server/plugins/identity.js: welcome / room.state content, BattleSpec
 *   cs), the room sets a room's host chooses from (room.setPlugins: visual and content sets), the match hosts a room with
 *   gameplay plugins plays in (DESIGN §32.6)
 * @returns {{ registry: SessionRegistry, lobby: Lobby, network: Network }}
 */
export function createSessionStack(opts, { data, log, content = null, plugins = null, hosts = null, workshop = null }) {
  const netOptions = netOptionsFrom(opts);
  const registry = new SessionRegistry({ reconnectWindowMs: netOptions.reconnectWindowMs ?? NET_DEFAULTS.reconnectWindowMs });
  const lobbyOptions = lobbyOptionsFrom(opts);
  const lobby = new Lobby({ registry, log, MatchClass: opts.MatchClass, getData: () => data, seedFn: opts.seedFn, content, plugins, hosts, options: lobbyOptions, workshop });
  const network = new Network({ registry, handler: lobby, log, options: netOptions });
  return { registry, lobby, network };
}

/**
 * Count a socket in the traffic counters (traffic.js): its wire bytes from now until it closes, the payload of every
 * message it sends (ws.send wrapped) and receives.
 * @param {import('ws').WebSocket} ws
 * @param {import('node:http').IncomingMessage} req
 * @param {ReturnType<typeof import('./traffic.js').createTrafficCounter>} traffic
 */
function meterSocket(ws, req, traffic) {
  const socket = req.socket;
  traffic.wsOpen(socket);
  const send = ws.send;
  ws.send = function meteredSend(data, ...rest) {
    traffic.wsSent(data);
    return send.call(this, data, ...rest);
  };
  ws.on('message', (data) => traffic.wsReceived(data));
  ws.once('close', () => traffic.wsClose(socket));
}

/**
 * Serve the WebSocket endpoint /ws on `server` (its 'upgrade' event).
 * @param {import('node:http').Server} server
 * @param {{ network: Network, log: object, traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter> }} deps
 * @returns {WebSocketServer}
 */
export function attachWebSocket(server, { network, log, lanes, traffic = null }) {
  // A bad table is a configuration error, and it fails here — at boot, named — rather than leaving the operator with a
  // lane that answers 404 forever (the silent-revert shape this family has been burned by before).
  const table = validateLanes(lanes ?? []);
  if (table.problems.length) throw new Error(`bad ws lane table: ${table.problems.join('; ')}`);
  if (table.lanes.length) log.info('[ws] lanes: ' + table.lanes.map((l) => `${l.path} (${l.id})`).join(', '));
  const wss = new WebSocketServer({ noServer: true, maxPayload: WS_MAX_PAYLOAD, perMessageDeflate: { ...WS_DEFLATE }, clientTracking: false });
  wss.on('connection', (ws, req) => {
    if (traffic) meterSocket(ws, req, traffic);
    network.handleConnection(ws, req);
  });
  wss.on('error', (e) => log.error('[ws] server error', e));

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    const parts = splitUrl(req.url || '/');
    const reject = (status, text) => {
      try { socket.end(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { socket.destroy(); }
    };
    if (!parts) { reject(404, 'Not Found'); return; }
    const lane = parts.rawPath === '/ws' ? null : resolveLane(parts.rawPath, table.lanes);
    if (!lane && parts.rawPath !== '/ws') { reject(404, 'Not Found'); return; }
    const refused = network.admission(req);
    if (refused === 'per-address') { reject(429, 'Too Many Requests'); return; }
    if (refused) { reject(503, 'Service Unavailable'); return; }
    if (lane) {
      // The lane owns the socket from here. Anything it throws closes that socket and says which lane said it —
      // falling through to /ws would let a client ask for `/duel/lobby` and land in a Stronghold match.
      try { lane.onUpgrade(req, socket, head, { reject, log, lane }); } catch (e) {
        log.error(`[ws] lane ${lane.id} failed`, e);
        socket.destroy();
      }
      return;
    }
    if (narrowDeflateOffer(req.headers['sec-websocket-extensions'])) delete req.headers['sec-websocket-extensions'];
    try {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } catch (e) {
      log.error('[ws] upgrade failed', e);
      socket.destroy();
    }
  });
  return wss;
}

/**
 * 工坊 mod 层移植 (2026-10-16, `pack.json.server.transport`, DESIGN §34.30): a pack's declared transport options →
 * the `perMessageDeflate` object actually handed to `ws`, plus the effective values for the host-metrics panel.
 *
 * With NO pack declaring `server.transport` the answer is exactly the engine's own WS_DEFLATE — the same object the
 * server has always passed — so a deployment without workshop packs is byte-identical (the `transport` block just
 * reports what it already was). A pack turns compression off, or retunes it, by declaring the switch; the smaller pack
 * id wins when two declare it, and the loser is named.
 *
 * @param {Map<string, object>|Record<string, object>|null} policies pack id → normalised `server.transport`
 * @param {{ log?: object|null }} [opts]
 * @returns {{ perMessageDeflate: false|object, transport: { deflate: boolean|null, params: string|null,
 *   maxPayload: number, threshold: number|null } }}
 */
export function transportPolicy(policies, { log = null } = {}) {
  const entries = (policies && typeof policies.entries === 'function'
    ? [...policies.entries()]
    : Object.entries(policies || {}))
    .filter(([id, decl]) => id && decl && typeof decl.deflate === 'boolean')
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  if (!entries.length) {
    return {
      perMessageDeflate: { ...WS_DEFLATE },
      transport: { deflate: true, params: null, maxPayload: WS_MAX_PAYLOAD, threshold: WS_DEFLATE.threshold },
    };
  }
  const [winnerId, winner] = entries[0];
  for (const [id] of entries.slice(1)) {
    log?.warn?.(`[workshop] server.transport declared by "${id}" is ignored: "${winnerId}" declares it too and the smaller pack id wins (DESIGN §34.30)`);
  }
  if (winner.deflate !== true) {
    log?.info?.(`[workshop] server.transport: "${winnerId}" declares deflate: false — per-message deflate stays OFF (the engine default is ON, so this declaration is what turns it off; the declaration is named so the choice is visible)`);
    return {
      perMessageDeflate: false,
      transport: { deflate: false, params: null, maxPayload: WS_MAX_PAYLOAD, threshold: null },
    };
  }
  /** 只把**声明过**的键交给 `ws`：省掉的字段用库自己的缺省（引擎不抄第二份）。基线是引擎自己的 WS_DEFLATE，包声明过的键盖在它上面。 */
  /** @type {Record<string, any>} */
  const perMessageDeflate = { ...WS_DEFLATE };
  /** @type {string[]} */
  const params = [];
  for (const key of ['threshold', 'concurrencyLimit', 'serverMaxWindowBits', 'clientMaxWindowBits', 'serverNoContextTakeover', 'clientNoContextTakeover']) {
    if (winner[key] === undefined) continue;
    perMessageDeflate[key] = winner[key];
    params.push(`${key}=${winner[key]}`);
  }
  if (winner.level !== undefined || winner.memLevel !== undefined) {
    /** @type {Record<string, number>} */
    const zlibDeflateOptions = {};
    if (winner.level !== undefined) { zlibDeflateOptions.level = winner.level; params.push(`level=${winner.level}`); }
    if (winner.memLevel !== undefined) { zlibDeflateOptions.memLevel = winner.memLevel; params.push(`memLevel=${winner.memLevel}`); }
    perMessageDeflate.zlibDeflateOptions = zlibDeflateOptions;
  }
  const threshold = winner.threshold === undefined ? (perMessageDeflate.threshold ?? WS_DEFLATE_LIBRARY_THRESHOLD) : winner.threshold;
  const transport = {
    deflate: true,
    params: params.length ? params.join(' ') : null,
    maxPayload: WS_MAX_PAYLOAD,
    threshold,
  };
  log?.info?.(`[workshop] server.transport: per-message deflate ON by "${winnerId}" (${transport.params || 'ws defaults'}; threshold ${transport.threshold}) — this is a process-wide socket option, so it applies to every client and every pack`);
  return { perMessageDeflate, transport };
}
