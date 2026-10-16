// server/http/routes.js — the node:http request listener. Every response gets the security headers (common.js), then:
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//   * a URL longer than 4096 characters → 414; one that does not parse → 400;
//   * /studio and /studio/… → the plugin studio (server/studio/index.js: for this machine and the local network only — any
//     other client gets the 404 page; its API also takes POST / PUT / DELETE), when the server has one;
//   * any method but GET / HEAD → 405 with `Allow: GET, HEAD`;
//   * GET /healthz → JSON status (protocol `version`, release `app`, uptime, the served `build`, the vanilla content
//     hash `content.vanilla`, the modded content sets in use `content.sets` and — only when there are some — how many
//     unofficial plugins the server has, `content.plugins` (the title screen's count before any hello) — DESIGN §32 —,
//     sockets, sessions,
//     rooms, matches), never cached; `?traffic=1` adds the traffic counters (traffic.js: bytes by category since the
//     start, WebSocket wire and payload bytes) for a loopback or private-network client only — the maintainer's
//     decision of 2026-10-12: the figures are the host's, so any other client, also one a tunnel or proxy on this
//     machine forwards, gets the plain report (net.js clientAddress, honouring TRUST_PROXY like the WebSocket limits);
//   * everything else → the static files (static.js).
// Every response's body bytes count in the traffic counters (traffic.js meter). A route that throws is logged and
// answers 500.

import { PROTOCOL_VERSION, APP_VERSION } from '../../shared/constants.js';
import { buildTag } from './buildTag.js';
import { setSecurityHeaders, sendError, sendJson, splitUrl } from './common.js';
import { clientAddress, isLocalIp, TokenBucket } from '../net.js';
// mod 目录的两条路径（server/http/mods.js）：`serveMods` 只认它们，准入（429）也只覆盖它们。
import { MODS_CATALOG_URL, MOD_FILE_PREFIX } from './mods.js';

const MAX_URL_LENGTH = 4096;

/**
 * mod 目录路由（`/mods/index.json` 与包文件的清单）的限流：**每客户端地址**一只桶，照本仓既有做法
 * （`server/net.js` 的 `TokenBucket`，WebSocket 准入与账号认证用的是同一个类）。
 *
 * 为什么这条只读路由要限流：它是**唯一**会被客户端在进房前反复拉取的清单（浏览器本地缓存的比对基准），而它背后
 * 是一次扫描包树的读；不限流的话一个循环重连的客户端就能让宿主一直重新生成清单。超限回 **429 + `Retry-After`**，
 * 而不是静默降级成空清单 —— 客户端要能分辨「被限流了」与「服务器没有包」，前者该退避重试，后者该走官方数据。
 */
const MODS_RATE_PER_SEC = 1;
const MODS_RATE_BURST = 10;
/** 空闲桶的回收线：只在放行路径上扫，代价摊在正常请求里（这张表本身也该有界）。 */
const MODS_BUCKET_IDLE_MS = 10 * 60_000;

/** `{ plugins: n }` when the server has n > 0 unofficial plugins (the lobby's visual sets count them), else nothing. */
function pluginCount(lobby) {
  let n;
  try { n = Number(lobby?.plugins?.unofficial?.()) || 0; } catch { n = 0; }
  return n > 0 ? { plugins: n } : {};
}

/** The content sets with gameplay plugins rooms hold now (DESIGN §32.6; 0 without any). */
function contentSets(lobby) {
  try { return Number(lobby?.plugins?.contentInUse?.()) || 0; } catch { return 0; }
}

/**
 * The GET /healthz body (`withTraffic`: plus the traffic counters and the asset index's state, `?traffic=1`).
 * @param {{ startedAt: number, network: import('../net.js').Network, registry: import('../net.js').SessionRegistry,
 *           lobby: import('../lobby.js').Lobby, content?: { cs: string } | null,
 *           traffic?: ReturnType<typeof import('./traffic.js').createTrafficCounter>,
 *           assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *           views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null }} health
 *   content: the server's vanilla content (server/plugins/identity.js)
 * @param {boolean} [withTraffic]
 */
export function healthReport({ startedAt, network, registry, lobby, content = null, traffic, assetIndex, views, trusted }, withTraffic = false) {
  const report = {
    ok: true, version: PROTOCOL_VERSION, app: APP_VERSION, uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    // the runtime the server is serving right now (public/js/ui/buildGuard.js): a page whose own build is
    // older than this reloads itself, so a deploy reaches clients that never reload
    build: buildTag(),
    // what its rooms play (DESIGN §32): the vanilla content hash, and how many content sets with gameplay plugins rooms
    // hold now (P1c, §32.6 — a room's cosmetic plugins leave its cs the vanilla one, §32.3); how many unofficial plugins
    // it has, when it has some (a page's title screen says so; P1a)
    ...(content ? { content: { vanilla: content.cs, sets: contentSets(lobby), ...pluginCount(lobby) } } : {}),
    sockets: network.connectionCount, sessions: registry.size, ...lobby.stats(),
  };
  if (trusted && Object.keys(trusted).length) report.plugins = trusted;
  if (withTraffic && traffic) report.traffic = traffic.snapshot();
  // content-hashed asset URLs (assetIndex.js / assetViews.js): off, building, or ready with how many files and URLs
  if (withTraffic) report.assetHashes = assetIndex ? { ...assetIndex.stats(), views: views ? views.stats() : null } : null;
  return report;
}

/** Does the query ask for the traffic counters (`traffic`, `traffic=1`, `traffic=true`)? */
const wantsTraffic = (query) => /(?:^|&)traffic(?:=(?:1|true|yes))?(?:&|$)/i.test(query || '');

/**
 * The request listener for `http.createServer`.
 * @param {{ serveStatic: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse,
 *             rawPath: string, query: string) => Promise<void>,
 *           health: Parameters<typeof healthReport>[0], log: object, trustProxy?: 'auto' | boolean,
 *           csp?: string | null,
 *           studio?: { handles: (rawPath: string) => boolean, handle: (req: any, res: any, rawPath: string, query: string) => Promise<void> } | null }} deps
 *   trustProxy: whose forwarding headers name the client (net.js clientAddress; the server's TRUST_PROXY); studio: the
 *   plugin studio (server/studio/index.js), or none
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void}
 */
export function createRequestHandler({ serveStatic, health, log, trustProxy = 'auto', studio = null, csp = null, trustedRuntime = null, modsCatalog = null }) {
  /** @type {Map<string, TokenBucket>} 客户端地址 → mod 目录路由的桶 */
  const modBuckets = new Map();

  /**
   * mod 目录路由的准入。true = 放行（桶里有票，或这条路由没接）。超限回 429（带 `Retry-After`）。
   * @param {import('node:http').IncomingMessage} req
   * @param {import('node:http').ServerResponse} res
   * @returns {boolean}
   */
  function admitModRead(req, res) {
    const key = req.socket && req.socket.remoteAddress ? req.socket.remoteAddress : 'unknown';
    const now = Date.now();
    let bucket = modBuckets.get(key);
    if (!bucket) { bucket = new TokenBucket(MODS_RATE_PER_SEC, MODS_RATE_BURST, now); modBuckets.set(key, bucket); }
    if (bucket.take(now)) {
      // 顺手回收空闲桶（这张表本身也该有界）；只在放行路径上扫，代价摊在正常请求里。
      if (modBuckets.size > 1) {
        for (const [other, b] of modBuckets) if (other !== key && now - b.at > MODS_BUCKET_IDLE_MS) modBuckets.delete(other);
      }
      return true;
    }
    res.setHeader('Retry-After', '1');
    sendJson(req, res, 429, { error: 'RATE' });
    return false;
  }

  async function handleRequest(req, res) {
    const url = req.url || '/';
    if (url.length > MAX_URL_LENGTH) { sendError(req, res, 414, '请求地址过长 · URI too long'); return; }
    const parts = splitUrl(url);
    if (!parts) { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (trustedRuntime && parts.rawPath.startsWith('/x/') && await trustedRuntime.route(req,res,parts.rawPath)) return;
    if (studio && studio.handles(parts.rawPath)) { await studio.handle(req, res, parts.rawPath, parts.query); return; }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
      return;
    }
    // mod 目录（`/mods/catalog.json` 与 `/mods/file/<包>/<路径>`，server/http/mods.js）：浏览器拿它比对本地缓存。
    // 位置与 Forge 相同 —— 在 405 之后、静态之前；`serveMods` 自己判路径，不认得就返回 false 落到静态
    // （它是**同步**的正是为了让调用方用返回值决定要不要继续路由）。准入（429）只覆盖它认领的这两条路径：
    // 静态文件的既有策略一个字节都不动。
    if (modsCatalog && (parts.rawPath === MODS_CATALOG_URL || parts.rawPath.startsWith(MOD_FILE_PREFIX))) {
      if (!admitModRead(req, res)) return;
      if (modsCatalog.serve(req, res, parts.rawPath, parts.query, modsCatalog.routes)) return;
    }
    if (parts.rawPath === '/healthz') {
      const withTraffic = wantsTraffic(parts.query) && isLocalIp(clientAddress(req, trustProxy).ip);
      sendJson(req, res, 200, healthReport(health, withTraffic));
      return;
    }
    await serveStatic(req, res, parts.rawPath, parts.query);
  }

  return (req, res) => {
    setSecurityHeaders(res);
    if (csp) res.setHeader('Content-Security-Policy', csp);
    if (health.traffic) health.traffic.meter(res, splitUrl(req.url || '/')?.rawPath || '/');
    handleRequest(req, res).catch((e) => {
      log.error('[http] request failed', e);
      sendError(req, res, 500, '服务器内部错误 · Internal error');
    });
  };
}
