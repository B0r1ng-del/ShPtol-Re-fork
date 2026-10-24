// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger, the official versions
//                      this server offers (SP_VERSIONS / SP_VERSION_DEFAULT / SP_MAX_VERSION_HOSTS — versions.js below)
//   versions.js        the official versions (DESIGN §35.23, M1): each enabled one's cs, data, manifest
//                      (/cs/<cs16>/index.json) and data directory (/data/versions/<slug>/); their matches run in match
//                      hosts of their own (match/host/, kind 'version') — the pool exists when another version is
//                      enabled (the default: all four) and forks a process on the first match of one, never at boot;
//                      none when only 第二期下半 is enabled
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB,
//                      permessage-deflate from 1 KB; refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the language packs (/packs/index.json, /packs/<id>/<file>), the plugin catalogue
//                      (/plugins/index.json — the registry is plugins/registry.js), the vanilla content set's manifest
//                      (/cs/<cs16>/index.json — plugins/identity.js: the content hash `cs`, DESIGN §32), the visual sets
//                      of cosmetic plugins (/vs/<vs16>/…, plugins/visualSet.js) and their files (/p/<id>/<hash8>/…),
//                      the content sets of gameplay plugins (/cs/<cs16>/…, plugins/contentSets.js — DESIGN §32.6; the
//                      server owner's plugins/config.json: plugins/policy.js; a room's plugins: plugins/roomSets.js; its
//                      match then runs in that set's worker: match/host/)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, brotli / gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/assetIndex.js the content hashes of public/assets and public/fonts (built in the background, cached in
//                      .cache/asset-hashes.json by path + size + mtime; Spine models share one hash)
//   http/assetViews.js the served /data/assets.json, /data/local-assets.json and /data/local-fx.json: every art URL with
//                      its hash segment (/assets/~<hash>/…, immutable when the hash matches); the files stay unchanged
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400, the plugin studio (/studio/, studio/index.js —
//                      this machine and the local network only), 405, GET /healthz → JSON status, else static
//   http/traffic.js    the traffic counters: bytes sent per category (assets / audio / code / data) and on the
//                      WebSocket, since the start (GET /healthz?traffic=1)
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import path from 'node:path';
import { getData, loadData } from './data.js';
import { getBotStrategy } from './match/botStrategies.js';
import { noteLlmIgnored, releaseIgnoresExternalAi, validateExternalConfig } from './match/llmGate.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom, versionsFrom, parseRoomCode } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { siteCsp } from './http/csp.js';
import { DATA_SHIM_JS, createStaticHandler } from './http/static.js';
import { createPluginRegistry } from './plugins/registry.js';
import { computeVanillaContent } from './plugins/identity.js';
import { createVisualSets } from './plugins/visualSet.js';
import { createContentSets } from './plugins/contentSets.js';
import { createPluginPolicy } from './plugins/policy.js';
import { createRoomSets } from './plugins/roomSets.js';
import { createMatchHosts } from './match/host/index.js';
import { createVersionSets } from './versions.js';
import { versionById } from '../shared/versions.js';
import { t } from '../shared/i18n.js';
import { createTrustedRuntime } from './plugins/trustedRuntime.js';
import { trustedHostAllowed } from './plugins/trusted.js';
import { createStudio } from './studio/index.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createManifestViews } from './http/assetViews.js';
import { answerClientError } from './http/common.js';
import { createEventLoopMonitor } from './health/eventLoop.js';
import { createRoomWorkerPool } from './workers/roomPool.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';
// 工坊 mod 层移植 (2026-10-16, DESIGN §34): the pack-facing HTTP helpers live in ./http/workshop.js but stay part of this
// module's API, the same way the static / route helpers above do — tests and tools reach them from here.
import {
  buildWorkshopDataFiles, workshopKitFilesFor, workshopKitDirsFor, workshopPanelFilesFor, workshopAssetsFor, workshopRoutesFor,
  workshopResourceFilesFor, workshopModAssetsFrom, buildWorkshopI18nFiles, resourceServerPolicy, WORKSHOP_ASSET_PREFIX, WORKSHOP_ASSET_TYPES,
  workshopBattleFilesFor,
} from './http/workshop.js';
import { buildModCatalog } from './modCatalog.js';
import { createModsRoute, serveMods, MODS_CATALOG_URL, MOD_FILE_PREFIX } from './http/mods.js';
import {
  loadWorkshop, loadWorkshopKits, loadWorkshopHooks, loadWorkshopPanels, workshopThemeFor,
  dropUnavailablePreDispatchPacks, WORKSHOP_DIR,
} from './workshop.js';
import { loadMetaModules } from './match/metaPack.js';
import { loadBattleInstallers } from './battlePack.js';
import { loadRoomInstallers } from './roomPack.js';
import { loadServerModules, mountServerModules, stateRootFor, bootConfigSnapshot } from './modModules.js';
import { readModRegistry, applyModRegistry } from './modRegistry.js';
import { createModDispatch } from './modDispatch.js';
import { coreMounts } from './http/routeMount.js';
import { Match as DefaultMatch } from './match/Match.js';
import { adjudicatePackGraph } from '../shared/workshop.js';
import { transportPolicy } from './http/websocket.js';
import { workshopNotices } from './notices.js';
import { createRoomAssets } from './roomAssets.js';
import { materializeVoiceCdn, dropFailedVoiceCdnFiles } from './voiceCdn.js';

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
  // 创意工坊 (DESIGN §34): the workshop data-file builders and asset helpers.
  buildWorkshopDataFiles, workshopKitFilesFor, workshopKitDirsFor, workshopPanelFilesFor, workshopAssetsFor, workshopRoutesFor,
  workshopResourceFilesFor, workshopModAssetsFrom, buildWorkshopI18nFiles, resourceServerPolicy, WORKSHOP_ASSET_PREFIX, WORKSHOP_ASSET_TYPES,
  workshopBattleFilesFor,
  // 客户端 mod 本地缓存 (W-C): the catalogue builder and the routes a browser downloads from.
  buildModCatalog, createModsRoute, serveMods, MODS_CATALOG_URL, MOD_FILE_PREFIX,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string, pluginsDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 *   versionVoteMs?: number, versionRetryMs?: number,
 *   roomCode?: string | null,
 *   assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number }, studio?: boolean,
 *   matchHost?: object, versions?: { enabled?: 'all' | string[], default?: string, maxHosts?: number },
 * }} [opts]
 *   assetIndex: the content-hash index (default on; false or SP_ASSET_INDEX=0: off — config.js assetIndexOptionsFrom);
 *   studio: the plugin studio at /studio/ (default on for this machine and the local network — SP_STUDIO=local|off;
 *   false: none);
 *   matchHost: options of the match hosts (server/match/host/index.js — watchdogMs, matchOptions …; tests) — the
 *   version hosts' too; versions: the official versions this server offers (http/config.js versionsFrom; DESIGN §35.23);
 *   versionVoteMs / versionRetryMs: the version vote's answer window and the guard after a declined or expired vote (tests;
 *   server/lobby.js header "Official versions")
 *   roomCode: a fixed alliance key for every new room (--room-code; four letters or digits — config.js parseRoomCode);
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPluginRegistry>,
 *                     content: import('./plugins/identity.js').VanillaContent, visual: ReturnType<typeof createVisualSets>,
 *                     contents: ReturnType<typeof createContentSets>, hosts: ReturnType<typeof createMatchHosts>,
 *                     versions: ReturnType<typeof createVersionSets>, versionHosts: ReturnType<typeof createMatchHosts> | null,
 *                     traffic: ReturnType<typeof createTrafficCounter>, assetIndex: ReturnType<typeof createAssetIndex> | null,
 *                     views: ReturnType<typeof createManifestViews> | null, studio: ReturnType<typeof createStudio> | null,
 *                     close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  // A release ignores external-AI settings (one log line) and keeps the built-in bot (§35.66).
  // An unknown strategy id still fails here, before data is loaded or the port is opened.
  const log = opts.log || makeLogger(!!opts.quiet);
  if (releaseIgnoresExternalAi()) noteLlmIgnored(log);
  try {
    const strategy = getBotStrategy(process.env.SP_BOT_STRATEGY);
    if (strategy.id === 'external') validateExternalConfig();
  } catch (cause) {
    throw new Error(`Invalid SP_BOT_STRATEGY: ${cause.message}. Unset SP_BOT_STRATEGY to use the original bot (legacy).`, { cause });
  }
  const { port, host } = listenAddress(opts);
  const { publicDir, dataDir, sharedDir, packsDir, pluginsDir } = serveDirs(opts);
  const simDir = path.join(ROOT, 'server', 'sim');

  // 创意工坊 (工坊 mod 层移植, 2026-10-16, DESIGN §34): `workshopDir` is where the host keeps its packs. `undefined`
  // means the repository's own `workshop/` (which a plain install does not have — then the data load below is a no-op
  // and everything is byte-identical); `null` skips the feature entirely, which is what a test that wants the official
  // numbers passes.
  const workshopDir = opts.workshopDir === undefined ? WORKSHOP_DIR : opts.workshopDir;

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy, and a caller that
  // names a workshop root must get a FRESH load (the singleton is process-wide and its first caller wins).
  // ★ 叠加层用的包必须是**裁剪之后**那一份（DESIGN §34.13.3）：被装配路径裁掉的包连数据都不许进游戏 —— 所以
  // `loadData` 挪到 `pruned` 之后（下一步），这里只留一个 `let`。
  let data = null;
  // the vanilla content hash `cs` (DESIGN §32): the bytes of the served sim, shared code and game data, read once now —
  // like the data the matches use and the build tag below
  const content = computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log });
  log.info(`[content] vanilla ${content.cs.slice(0, 16)} (${Object.keys(content.simFiles).length} code files, ${Object.keys(content.data).length} data files)`);
  // language packs and plugins (docs/PACKS.md, docs/PLUGINS.md): scanned now — the start log names them — and again
  // whenever their folders change
  const scriptMode = process.env.SP_PLUGIN_SCRIPTS;
  const packs = createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log, scriptHost:host, scriptMode });
  packs.refresh(true);
  // the content hashes of the art (built in the background once listening) and the manifests served with them
  const indexOptions = assetIndexOptionsFrom(opts, publicDir);
  const assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
  const views = createManifestViews({ dataDir, index: assetIndex, log });
  // the visual sets of the cosmetic plugins (DESIGN §32 P1a): what a room's host switches on, served at /vs/ and /p/
  const visual = createVisualSets({ registry: packs, log });
  // the server owner's policy (plugins/config.json), the content sets of the gameplay plugins (served at /cs/<cs16>/…),
  // what a room's plugins make of both, and the match hosts a room with gameplay plugins plays in (DESIGN §32.6)
  const policy = createPluginPolicy({ pluginsDir, log });
  // 创意工坊 (DESIGN §34): 装载一次，四处投影共用（工坊 mod 层移植 2026-10-17）。从前这里是 `loadWorkshop` 各调一次
  // —— 扫描同一棵树两遍、算出两份互不相识的产物，而它们本该是同一份（`loadWorkshop` 是同步的纯函数，给定同一个
  // 目录两次结果相同；但两次调用意味着两次 IO 与两处可能分叉的失败点）。没有包时 `loaded` 是空壳，下面几处都是
  // `null` / `[]`，一切与从前逐字节相同。
  //
  // ★ 装配次序在这里是**语义**，不是风格（DESIGN §34.13.3）：`server.preDispatch` 的最后两种失败（模块装不上 /
  // 没有工厂导出）只能由动态 import 发现，而 `loadWorkshop` 与 `loadData` 都是同步的。所以判据**排在最前面**，
  // 一旦跑完就用 `dropUnavailablePreDispatchPacks` 把「声明了钩子却装不上」的包从已加载集合里**裁掉**，再把裁剪
  // 后的数组喂给下面每一个读者：数据叠加层、身份清单、kits、面板、资源表、Lobby/Network。以前这里是「包照旧加载、
  // 只是钩子没装上」—— 那种结局让运维以为自己有一道不存在的闸门，而它的内容却已经并进了游戏数据。
  const stateRoot = stateRootFor(ROOT);
  const loadedOnce = workshopDir ? loadWorkshop(workshopDir, { log }) : { packs: [], errors: [] };
  // 启用 / 禁用（DESIGN §35.47，`server/modRegistry.js`）：操作者的开关在这条装配流水线的**最上游**生效 ——
  // 被禁用的包连它的服务端载荷都不会被装载（没有 hook、没有订阅、没有字节），文件留在磁盘上，一条 `enable`
  // 命令就回来。被禁用的 id 同时进 `excludePacks`，数据叠加层与这里是同一次裁剪。
  const modRegistry = readModRegistry(stateRoot, { log });
  const registryApplied = applyModRegistry(loadedOnce.packs, modRegistry);
  for (const d of registryApplied.disabled) log.warn(`[mod-registry] "${d.id}" disabled (${d.where}) — not loaded`);
  // 依赖 / 冲突的装载期裁决（DESIGN §35.48）：缺失依赖、版本不合、互斥、级联与循环，全部在这一步**具名拒绝**
  // —— 一个依赖链断裂的包，和它依赖的那个一样「不在」。
  const adjudicated = adjudicatePackGraph(registryApplied.packs);
  for (const r of adjudicated.refused) log.warn(`[mod-registry] "${r.id}" refused: ${r.reason}`);
  const loadedForPayloads = { ...loadedOnce, packs: adjudicated.kept };
  // 四条服务端载荷通道，**同一个裁剪点**：声明了却装不上（import 失败 / 没有约定导出 / 源码里带非确定性）的包
  // 整份移出已加载集合，而不是「包照旧加载、只是它的效果不在」。
  const workshopHooks = await loadWorkshopHooks(loadedForPayloads, { log });
  const workshopMeta = await loadMetaModules(loadedForPayloads, { log });
  const serverModules = await loadServerModules(loadedForPayloads, { log, stateRoot });
  const battlePack = await loadBattleInstallers(loadedForPayloads, { log });
  const roomPack = await loadRoomInstallers(loadedForPayloads, { log });
  const pruned = dropUnavailablePreDispatchPacks(loadedForPayloads, [
    ...workshopHooks.errors, ...workshopMeta.errors, ...serverModules.errors, ...battlePack.errors, ...roomPack.errors,
  ]);
  if (pruned.removed.length) {
    log.warn(`[workshop] dropped ${pruned.removed.length} pack(s) whose declared server-side payload cannot be installed: `
      + pruned.removed.map((r) => `"${r.pack}" (${r.code})`).join(', '));
  }
  // 裁剪之后才有「这一版到底装了哪些包」：被别的声明裁掉的包**也不该**留下它的 meta 处理器或服务端模块
  // （否则一个装不上的包会继续在对局里 / 在 /healthz 上说话）。
  const survivors = new Set(pruned.packs.map((p) => p.id));
  const metaModules = workshopMeta.modules.filter((m) => survivors.has(m.id));
  const serverModulesLive = serverModules.modules.filter((m) => survivors.has(m.pack));
  const workshopLoaded = { ...loadedForPayloads, packs: pruned.packs, errors: pruned.errors };
  // ★ 数据叠加层在这之后才加载，而且喂给它的是**裁剪之后**那一份包（`packs: pruned.packs`）。`loadData` 从前自己
  // 又调一次 `loadWorkshop`，于是刚被裁掉的包的数据照样并进游戏数据 —— 那道闸门对它等于不存在。
  data = (opts.dataDir || opts.workshopDir !== undefined)
    ? loadData(dataDir, { log, workshopDir: null, packs: pruned.packs })
    : getData({ dir: dataDir, log, workshopDir: null, packs: pruned.packs });
  const contents = createContentSets({ registry: packs, vanillaData: data, log, maxSets: () => policy.get().maxSets });
  const roomSets = createRoomSets({ registry: packs, visual, contents, policy });
  // a child process per content set; SP_MATCH_HOST=worker asks for a worker thread instead (match/host/index.js header:
  // an out-of-memory abort in a worker thread ends the whole server)
  const transport = String(process.env.SP_MATCH_HOST || '').trim().toLowerCase() === 'worker' ? 'worker' : 'process';
  const hosts = createMatchHosts({ contents, log, options: { transport, maxWorkers: Math.max(1, policy.get().maxSets), ...(opts.matchHost || {}) } });
  // the official versions (DESIGN §35.23, M1): which ones (the option, else SP_VERSIONS …), their content, and — only
  // when one beyond 第二期下半 is enabled — the match hosts their rooms play in (counted apart from the plugin hosts)
  const versionCfg = versionsFrom(opts, log);
  const versions = createVersionSets({ enabled: versionCfg.enabled, defaultId: versionCfg.default, dataDir, vanilla: content, defaultData: data, log });
  // (the test options of matchHost apply to both pools, but never the version pool's kind or its own SP_MAX_VERSION_HOSTS)
  const versionHosts = versions.nonDefault.length
    ? createMatchHosts({ contents: versions, log, options: { transport, ...(opts.matchHost || {}), kind: 'version', maxWorkers: Math.max(1, versionCfg.maxHosts) } })
    : null;
  log.info(`[versions] enabled: ${versions.ids.map((id) => `${id} (${t(/** @type {any} */ (versionById(id)).label)}${id === versions.defaultId ? ', default' : ''})`).join(', ')}`);
  const simPool = createRoomWorkerPool({ data });
  const { registry, lobby, network } = createSessionStack(opts, { data, log, content, plugins: roomSets, hosts, versions, versionHosts, simPool });
  // Main-thread event-loop delay sampling (server/health/eventLoop.js): opt-in with SP_LOOP_SAMPLE=1, no worker pool involved, and a
  // LOCAL log line per window (`[loop] p50=… p95=… p99=… max=… cpu=… mem=… rooms=… humans=… phase=…`) — deliberately not
  // part of /healthz. This is what tells an operator whether a stall is the rehearsal / battle slice or something else.
  const eventLoop = createEventLoopMonitor({
    log,
    windowMs: opts.loopSample?.windowMs,
    counts: () => {
      const s = lobby.stats();
      const phases = new Set();
      let rehearsals = 0;
      for (const room of lobby.rooms.values()) {
        if (room.match?.phase) phases.add(room.match.phase);
        rehearsals += room.match?._rehearsalTasks?.size || 0;
      }
      return { rooms: s.rooms, matches: s.matches, humans: s.humans, spectators: s.spectators,
        phase: [...phases].sort().join('+') || 'idle', rehearsals };
    },
  });
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, simDir, packsDir, pluginsDir, packs, content, log, assetIndex, views, visual, contents, versions });
  // the plugin studio (DESIGN §32.9): its page and API for this machine and the local network; it watches plugins/ only
  // once it is used (hot reload), and rooms whose host is the author or alone follow a plugin's changes by themselves
  const studio = opts.studio === false ? null : createStudio({ publicDir, pluginsDir, dataDir, registry: packs, lobby, sessions: registry, log, fetch: opts.fetch });
  const trustedRuntime = await createTrustedRuntime({registry:packs,log});
  lobby.trustedRuntime = trustedRuntime;
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag(ROOT, { servedVersionDirs: versions.servedDirs() });

  const traffic = createTrafficCounter();
  const server = http.createServer(createRequestHandler({ serveStatic, csp: process.env.SP_CSP === 'off' ? null : siteCsp(publicDir), health: { startedAt, network, registry, lobby, content, traffic, assetIndex, views, trusted:trustedRuntime?.health, versions, versionHosts }, log, trustProxy: network.opts.trustProxy, studio, trustedRuntime }));
  server.on('clientError', answerClientError);
  const wss = attachWebSocket(server, { network, log, lanes: opts.wsLanes, traffic });

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;
    // Check the kernel's address too: aliases/DNS and bind fallback cannot weaken the owner gate.
    const actual = server.address();
    const scriptHost = actual && typeof actual === 'object' ? actual.address : '';
    packs.setScriptHost(scriptHost);
    const testGate = lobby.setTestHost(scriptHost);
    if (testGate.warn) log.warn(`[test-mode] ${testGate.warn}`);
    else if (testGate.enabled) log.info('[test-mode] test rooms enabled');
    if (!trustedHostAllowed(scriptHost, scriptMode)) {
      lobby.trustedRuntime = null;
      await trustedRuntime?.close();
    }
  } catch (e) {
    network.close(); // stop heartbeat/sweep timers of the half-built server
    hosts.close();
    versionHosts?.close();
    assetIndex?.close();
    studio?.close();
    eventLoop?.close();
    await simPool?.close();
    await trustedRuntime?.close();
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));
  assetIndex?.start();
  // started only once the server is listening: the first window then reports real counts, not a half-built hall
  eventLoop?.start();

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  // 包的服务端模块的 `onBoot`：**绑上端口之后**才跑 —— 「服务起来了」对它们是一句真话，而**真正绑到的** port / host
  // 也才是这个快照里该有的值（包只能观察，不能设值：快照是深冻结的）。每个回调单独 try（`mountServerModules.boot`
  // 内部就是这么做的），一个包炸了不影响别的包，也不影响启动。没有包声明 `boot` 时是一次空循环。
  modMount.boot(bootConfigSnapshot({ port: actualPort, host: boundHost, stateRoot }));
  const url = `http://${displayHost(boundHost)}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      // 包的服务端模块的 `onShutdown`：**只记日志、不阻塞关闭**（`mountServerModules.shutdown` 内部逐条 try）。
      // 没有包声明 `shutdown` 时是一次空循环。
      try { modMount.shutdown(); } catch (e) { log.error('[shutdown] mod modules', e); }
      try { hosts.close(); } catch (e) { log.error('[shutdown] match hosts', e); }
      try { versionHosts?.close(); } catch (e) { log.error('[shutdown] version hosts', e); }
      // after the lobby: every room is gone, so no rehearsal can still be waiting on a thread
      try { await simPool?.close(); } catch (e) { log.error('[shutdown] simulation pool', e); }
      eventLoop?.close();
      network.close();
      assetIndex?.close();
      studio?.close();
      await trustedRuntime?.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, registry, packs, content, visual, contents, hosts, versions, versionHosts, traffic, assetIndex, views, studio, eventLoop, simPool, close };
}

/**
 * The `--room-code ABCD` / `--room-code=ABCD` argument of this process entry, or null when it is absent. The value is
 * read once at startup and lives only in this server instance: there is no environment variable and nothing is
 * persisted, so stopping the server and starting it again without the argument is random again. A missing or invalid
 * value throws (the boot helper reports it and exits) instead of silently starting random.
 * @param {string[]} [argv]
 * @returns {string | null}
 */
export function roomCodeFromArgv(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--room-code') {
      const v = argv[i + 1];
      if (v == null || v.startsWith('-') || !v.trim()) throw new RangeError('--room-code needs 4 letters or digits');
      return parseRoomCode(v);
    }
    if (a.startsWith('--room-code=')) {
      const v = a.slice('--room-code='.length);
      if (!v.trim()) throw new RangeError('--room-code needs 4 letters or digits');
      return parseRoomCode(v);
    }
  }
  return null;
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(() => startServer({ roomCode: roomCodeFromArgv() }));
