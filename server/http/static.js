// server/http/static.js — the static file server (routes.js hands it every GET / HEAD that is not an API route):
// (i18n-ignore-file: the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
//     /        → public/      (index.html for directories)
//     /data/   → data/        (generated game data)
//     /shared/ → shared/      (ESM shared with the browser)
//     /sim/    → server/sim/  (the battle simulation, read-only, `.js` only — client-side
//                              combat, DESIGN §14; the Node-only loader nodeData.js is not served)
//     /studio/… → never: the plugin studio's page (public/studio/) is served by server/studio/index.js behind its gate (this
//                machine and the local network only) — a path here that is the studio's, in any spelling, is a 404
//     /data.js → a generated browser stand-in of server/data.js (the sim's content modules
//                import `../../../data.js`; in the browser it serves the data injected with
//                /sim/simdata.js setSimData). No other server file is ever served.
//     /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 — the same audio files, addressed
//                **without** an extension so download managers (IDM / 迅雷 …) stop popping a
//                "下载文件信息" dialog for every BGM track (media.js, shared/media.js, public/js/media.js)
//     /packs/index.json → the language packs of this server (server/plugins/registry.js: public/i18n/, the pack
//                folders of packs/ and the lang plugins of plugins/, re-read when they change; never cached)
//     /packs/<id>/<file> → a file of a pack or lang plugin folder — only one its manifest names (registry servable)
//     /plugins/index.json → the plugin catalogue: every plugin and pack found, by class and status, and the vanilla
//                content hash (DESIGN §32; never cached). Of plugins/ only the files a lang manifest names (through
//                /packs/<id>/<file>), the files a loaded cosmetic overlay names and the frame files of a loaded ui
//                plugin (/p/…; a ui file also sends the frame Content-Security-Policy) are served
//     /cs/<cs16>/index.json → the manifest of the vanilla content set (server/plugins/identity.js contentIndexOf),
//                cached for good — for this server's vanilla `cs` (its first 16 hex digits) and, from P1c (DESIGN §32.6),
//                a content set with gameplay plugins a room uses or used lately (server/plugins/contentSets.js: the same
//                shape with `vanilla: false`, its plugins, settings and modes)
//     /cs/<cs16>/data/<file>.json, /cs/<cs16>/i18n/<lang>.json → a data or translation file that content set changed,
//                its served bytes from memory (cached for good; every other file of the set is named by its plain
//                /data/…?v=<8 hex> URL in the manifest)
//     /vs/<vs16>/overlay.json → a visual set of cosmetic plugins (server/plugins/visualSet.js): its composition and
//                its plugins' writes, which a page lays over the manifest it loaded itself (a room's set, a player's
//                personal plugin) — no-cache, the body's hash as ETag; 404 for a set this server does not know
//     /p/<id>/<hash8>/<path> → a file of a loaded cosmetic plugin — only one its overlay names — or a frame file of a
//                loaded ui plugin (html / js / css / png under entry.client). registry pluginFile is the whitelist
//                (no dot file, no `..`; only the very file the scan hashed — a symbolic link put in its place, or in place
//                of a folder on its way, is never followed, wherever it leads). A ui file's response carries
//                UI_FRAME_CSP (shared/plugins/ui.js); a cosmetic file does not. A hash naming its current bytes (its own
//                first 8 hex digits, or its Spine model's) answers `immutable` for a year while the file keeps the size,
//                mtime, inode and ctime it was hashed with; any other hash, or a file changed since the scan, the current
//                file with `no-cache` — as for /assets/~<hash>/ below — and a changed file has the registry read the
//                folders again. An audio file is also served without its extension — /p/<id>/<hash8>/<path without
//                .mp3 / .ogg> — for the same download managers as /media/ below (public/js/media.js mediaUrl; when both
//                a .mp3 and a .ogg are listed, the one whose hash the URL names)
//     /assets/~<hash>/…, /fonts/~<hash>/…, /media/~<hash>/… → the same files: the content-hash segment
//                (shared/assetPaths.js) is stripped. A hash that names the file's current bytes (assetIndex.js
//                urlHashOk: its own hash, or its Spine model's) answers `immutable` for a year; any other hash —
//                an old page, a URL derived from another file's — the current file with `no-cache`
//     /data/assets.json, /data/local-assets.json, /data/local-fx.json → the served manifests (assetViews.js: every
//                art URL with its content-hash segment; no-cache, the ETag of the view) once the asset index is ready,
//                the files as they are before that or without an index
//
// Files under public/assets/ and public/fonts/ get their content hash as ETag when the index has it (a file whose
// size or mtime changed since asks for a rescan), others size + mtime. Traversal & dotfile protection, a directory
// without its trailing slash → 301, 404 page; an absent data/local-assets.json or data/local-fx.json is answered with
// an empty manifest.
// Files go out through files.js serveFile.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { MEDIA_PREFIX } from '../../shared/media.js';
import { splitHashedPath } from '../../shared/assetPaths.js';
import { ROOT, noopLog } from './config.js';
import { sendError, sendJson } from './common.js';
import { MIME, CompressCache, IMMUTABLE_CACHE, isNotModified, serveFile, serveBuffer } from './files.js';
import { ASSET_INDEX_ROOTS, hashedFileOpts } from './assetIndex.js';
import { serveMedia } from './media.js';
import { createPluginRegistry, sameIdentity, statIdentity } from '../plugins/registry.js';
import { computeVanillaContent } from '../plugins/identity.js';
import { createVisualSets } from '../plugins/visualSet.js';
import { isStudioPath } from '../studio/paths.js';
import { PACKS_URL, PACK_INDEX_FILE } from '../../shared/packs.js';
import { PLUGINS_URL, PLUGIN_INDEX_VERSION, buildPluginIndex, extOf, isPackPath, isPluginId } from '../../shared/plugins/manifest.js';
import { csUrlPart } from '../../shared/plugins/identity.js';
import { FILE_URL_DIGITS, PLUGIN_AUDIO_EXTS, PLUGIN_FILES_URL, VISUAL_DOC_FILE, VISUAL_SETS_URL, VS_URL_DIGITS } from '../../shared/plugins/visual.js';
import { SIM_WORKER_CSP } from './csp.js';
// 工坊素材路由 (工坊 mod 层移植, 2026-10-16): the prefix and extension allowlist a pack's own art is served under.
import { WORKSHOP_ASSET_PREFIX, WORKSHOP_ASSET_TYPES, ROUTE_CACHE_HEADERS, isCacheOnlyPath } from './workshop.js';
import { DYNAMIC_ROUTE_CACHE_HEADERS, runDynamicRoute } from './routeMount.js';
import { WORKSHOP_PANEL_PREFIX, WORKSHOP_RESOURCE_PREFIX } from '../../shared/workshop.js';
import { pipeline } from 'node:stream/promises';

/** 包声明的战斗逻辑模块的服务前缀（`pack.json.server.battle`，与 `/workshop-kits/` 同一类通道）。 */
const WORKSHOP_BATTLE_PREFIX = '/workshop-battle/';

/**
 * `/workshop-kits/<pack>/<rel>` → `<packDir>/kits/<rel>`（DESIGN §34.18），URL 不该被回答时返回 null。
 *
 * 三道门，次序刻意让每一种拒绝都与「文件根本不在」不可区分：
 *   1. 第一段必须是**已装载**的包 —— 没装的包在这里压根没有目录（表就是 `loadWorkshop` 的结果建的），
 *      所以「别的包的路径」不是特例，只是一次查表未命中；
 *   2. `decoded` 已经由调用方 `decodeURIComponent` **正好解一次**，所以 `%2e%2e` 到这里就是 `..`，按段拒掉
 *      —— **绝不二次解码**（二次解码正是 `%252e%252e` 变成 `..` 的路）；
 *   3. 其余部分必须是非空 `.js`，没有空段 / `.` / `..`、没有反斜杠，且解析后的路径必须留在 `<packDir>/kits/`
 *      之下 —— 用 `path.resolve` + `path.relative` 判，**绝不字符串前缀匹配**（前缀判据会放过
 *      `<packDir>/kits-evil/x.js`）。
 *
 * 文件在不在留给调用方的 `readFile`：未命中与穿越必须给出同一个 404 体。
 * @param {string} decoded 百分号解码后的请求路径
 * @param {Map<string, string>|null} kitDirs 包 id → `<packDir>/kits`（`workshopKitDirsFor`）
 * @returns {string|null} 绝对路径，或 null
 */
function resolvePackRelativeKit(decoded, kitDirs) {
  if (!kitDirs || !kitDirs.size) return null;
  const rest = decoded.slice('/workshop-kits/'.length);
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;                                  // 没有包段，或没有文件段
  const pack = rest.slice(0, slash);
  const rel = rest.slice(slash + 1);
  const dir = kitDirs.get(pack);
  if (!dir) return null;                                        // 未知 / 未装载的包
  if (!rel.endsWith('.js') || rel.includes('\\')) return null;
  const segments = rel.split('/');
  if (segments.some((s) => !s || s === '.' || s === '..')) return null;
  const abs = path.resolve(dir, ...segments);
  const back = path.relative(path.resolve(dir), abs);
  if (!back || back.startsWith('..') || path.isAbsolute(back)) return null;
  return abs;
}
import { UI_FRAME_CSP } from '../../shared/plugins/ui.js';

/** Browser stand-in of server/data.js, served at /data.js (see the header). Served byte for byte: its first line names the entry, server/index.js. */
export const DATA_SHIM_JS = `// Generated by server/index.js — browser stand-in for server/data.js (DESIGN §14 client-side combat).
// The simulation's content modules (/sim/content/support/index.js) import getData() from here; it returns the game data
// the page injected with /sim/simdata.js setSimData(data).
import { getSimData } from './sim/simdata.js';
export function getData() { return getSimData() || {}; }
export function resetData() {}
`;
/** Files under server/sim that are never served (Node-only). */
const SIM_PRIVATE = new Set(['nodedata.js']); // lower-case (compared case-insensitively)

// ---------------------------------------------------------------------------------------------------
// Static file handler
// ---------------------------------------------------------------------------------------------------

/** Optional per-machine art manifests (tools/local-extract: the local art, the official effects' files — DESIGN §33)
 * and the empty stand-in served when one is absent. */
const LOCAL_ART_MANIFESTS = new Set(['local-assets.json', 'local-fx.json']);
const EMPTY_LOCAL_ART = Buffer.from(JSON.stringify({ version: 1, source: 'none', count: 0, groups: {} }));

/** The content-set manifest's cache policy: its URL names its content (the `cs`), so it never changes. */
const IMMUTABLE_JSON = 'public, max-age=31536000, immutable';
/** /vs/<vs16>/overlay.json */
const VISUAL_DOC = new RegExp(`^${VISUAL_SETS_URL}([0-9a-f]{${VS_URL_DIGITS}})/${VISUAL_DOC_FILE.replace('.', '\\.')}$`);
/** A plugin file URL's hash segment. */
const FILE_HASH = new RegExp(`^[0-9a-f]{${FILE_URL_DIGITS}}$`);
/** /cs/<cs16>/<path> of a content set with gameplay plugins (DESIGN §32.6). */
const CS_FILE = /^\/cs\/([0-9a-f]{16})\/([A-Za-z0-9._\/-]{1,200})$/;

/**
 * Create the static request handler.
 * @param {{ publicDir: string, dataDir: string, sharedDir: string, simDir?: string, packsDir?: string, pluginsDir?: string,
 *   packs?: ReturnType<typeof createPluginRegistry>, content?: import('../plugins/identity.js').VanillaContent | null,
 *   log?: object,
 *   assetIndex?: ReturnType<typeof import('./assetIndex.js').createAssetIndex> | null,
 *   views?: ReturnType<typeof import('./assetViews.js').createManifestViews> | null,
 *   visual?: ReturnType<typeof createVisualSets> | null,
 *   contents?: ReturnType<typeof import('../plugins/contentSets.js').createContentSets> | null }} dirs
 *   packs: the server's plugin registry (default: one over publicDir, dataDir, packsDir and pluginsDir — ROOT/packs, and
 *   the plugins/ folder beside packsDir); content: the vanilla content (default: computed from simDir, sharedDir and
 *   dataDir on first use); assetIndex / views: the content hashes and the served manifests (none: plain URLs,
 *   size-mtime ETags); visual: the visual sets (default: one over the registry — a registry of 0.2.0's shape has none:
 *   /vs/ and /p/ answer 404); contents: the content sets with gameplay plugins (DESIGN §32.6; none: only the vanilla
 *   set's /cs/ manifest)
 * @returns {(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse, rawPath: string, query: string) => Promise<void>}
 */
export function createStaticHandler({ publicDir, dataDir, sharedDir, simDir = path.join(ROOT, 'server', 'sim'), packsDir = path.join(ROOT, 'packs'),
  pluginsDir = path.join(path.dirname(path.resolve(packsDir)), 'plugins'), packs = null, content = null, log = noopLog,
  assetIndex = null, views = null, visual = null, contents = null, workshopJson = null, workshopAssets = null,
  workshopKitFiles = null, workshopKitDirs = null, workshopPanelFiles = null, workshopBattleFiles = null,
  workshopResourceFiles = null, workshopI18n = null, resourcePolicy = 'serve', workshopRoutes = null, modRoutes = null }) {
  const registry = packs || createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log: /** @type {any} */ (log) });
  const sets = visual || (typeof registry.pluginFile === 'function' ? createVisualSets({ registry, log }) : null);
  let vanilla = content;
  const vanillaContent = () => (vanilla ||= computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log: /** @type {any} */ (log) }));
  const mounts = [
    { prefix: '/data/', name: 'data', dir: path.resolve(dataDir) },
    { prefix: '/shared/', name: 'shared', dir: path.resolve(sharedDir) },
    // the simulation: ES modules only (no directory listings, no other file types, no Node-only loader)
    { prefix: '/sim/', name: 'sim', dir: path.resolve(simDir), only: new Set(['.js']), deny: SIM_PRIVATE },
    { prefix: '/', name: 'public', dir: path.resolve(publicDir) },
  ];
  // the real path of public/studio/ (the plugin studio's page — never a static file, in whatever spelling the disk folds:
  // /ſtudio/ on a case-insensitive macOS disk, /studio./ on Windows)
  let studioReal;
  const studioRealPath = async () => {
    if (studioReal === undefined) studioReal = await fsp.realpath(path.join(path.resolve(publicDir), 'studio')).catch(() => null);
    return studioReal;
  };
  const shimBody = Buffer.from(DATA_SHIM_JS);
  const shimTag = `"shim-${shimBody.length.toString(16)}"`;
  const gzipCache = new CompressCache(); // brotli and gzip bodies (files.js)

  return async function serveStatic(req, res, rawPath, query) {
    let decoded;
    try { decoded = decodeURIComponent(rawPath); } catch { sendError(req, res, 400, '请求地址无效 · Bad request'); return; }
    if (!decoded.startsWith('/') || decoded.includes('\0') || decoded.includes('\\')) {
      sendError(req, res, 400, '请求地址无效 · Bad request');
      return;
    }
    // a pack declared `serverPolicy: "cache-only"` (DESIGN §34.30): the whole server stops serving /assets/ and /fonts/
    // — 412 before the filesystem is ever touched, so the client falls back to its own cache instead of re-fetching
    if (resourcePolicy === 'cache-only' && isCacheOnlyPath(decoded)) {
      res.writeHead(412, { 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : '资源不回源 · Cache only');
      return;
    }
    // the plugin studio's page is never a static file (server/studio/index.js isStudioPath: any spelling of /studio/)
    if (isStudioPath(decoded)) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
    // /assets/~<hash>/x → /assets/x (the hash decides the cache policy below)
    const hashed = splitHashedPath(decoded);
    const urlHash = hashed.hash;
    decoded = hashed.path;
    if (decoded === '/data.js') {
      const headers = { 'Content-Type': MIME['.js'], 'Cache-Control': 'no-cache', ETag: shimTag, 'Content-Length': shimBody.length };
      if (isNotModified(req, shimTag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : shimBody);
      return;
    }
    // The plugin catalogue (server/plugins/registry.js; never cached) and the vanilla content set's manifest
    if (decoded === `${PLUGINS_URL}index.json`) {
      const vanilla = vanillaContent().cs;
      // a registry of 0.2.0's shape (a caller's own `packs`) has no catalogue: an empty one
      sendJson(req, res, 200, typeof registry.pluginIndex === 'function' ? registry.pluginIndex({ vanilla }) : buildPluginIndex([], { vanilla }));
      return;
    }
    if (decoded.startsWith('/cs/')) {
      const c = vanillaContent();
      if (decoded !== `/cs/${csUrlPart(c.cs)}/index.json`) {
        // a content set with gameplay plugins (DESIGN §32.6, server/plugins/contentSets.js): its manifest and its patched
        // data files — a URL naming its content, so cached for good; 404 for a set this server does not keep
        const m = CS_FILE.exec(decoded);
        const f = m && contents && !m[2].split('/').some((s) => s === '' || s === '.' || s === '..' || s.startsWith('.')) ? contents.file(m[1], m[2]) : null;
        if (!f) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
        await serveBuffer(req, res, { body: f.body, hash: `cs-${m[1]}-${(f.sha256 || 'index').slice(0, 8)}`, type: f.type || MIME['.json'], cacheControl: IMMUTABLE_JSON, key: `cs:${decoded}`, cache: gzipCache });
        return;
      }
      const body = Buffer.from(JSON.stringify(c.index));
      const tag = `"cs-${csUrlPart(c.cs)}-v${PLUGIN_INDEX_VERSION}"`;
      const headers = { 'Content-Type': MIME['.json'], 'Cache-Control': IMMUTABLE_JSON, ETag: tag, 'Content-Length': body.length };
      if (isNotModified(req, tag, new Date(0))) { delete headers['Content-Length']; res.writeHead(304, headers); res.end(); return; }
      res.writeHead(200, headers);
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // Visual sets (server/plugins/visualSet.js): a set's composition and writes
    if (decoded.startsWith(VISUAL_SETS_URL)) {
      const m = VISUAL_DOC.exec(decoded);
      const doc = m && sets ? await sets.doc(m[1]) : null;
      if (!doc) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
      await serveBuffer(req, res, { body: doc.body, hash: doc.hash, type: MIME['.json'], cacheControl: 'no-cache', key: `vs:${decoded}`, cache: gzipCache });
      return;
    }
    // A cosmetic plugin's files, or a ui plugin's frame files, at the hash of their bytes (see the header)
    if (decoded.startsWith(PLUGIN_FILES_URL)) {
      const [id, hash, ...segments] = decoded.slice(PLUGIN_FILES_URL.length).split('/');
      const rel = segments.join('/');
      const ok = isPluginId(id) && FILE_HASH.test(hash || '') && segments.length > 0 && isPackPath(rel)
        && !segments.some((x) => x === '' || x === '.' || x === '..' || x.startsWith('.'));
      let f = ok && sets ? sets.file(id, rel) : null;
      // extension-less audio (download managers: shared/media.js): the listed audio file of that name — the one whose
      // hash the URL names when there are two
      if (!f && ok && sets && !extOf(rel)) {
        const found = PLUGIN_AUDIO_EXTS.map((e) => sets.file(id, rel + e)).filter(Boolean);
        f = found.find((x) => x.urlHashes.has(hash)) || found[0] || null;
      }
      // the very file the scan hashed: a symbolic link put in its place is never followed (wherever it leads — another
      // file of the folder, a dot file, outside), nor is one put in place of a folder on its way (its real path changed)
      const st = f ? await fsp.lstat(f.abs).catch(() => null) : null;
      const real = st && st.isFile() ? await fsp.realpath(f.abs).catch(() => null) : null;
      if (!st || !st.isFile() || !real || real !== f.real) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
      // still the bytes that were hashed: the same size, mtime, inode and ctime (registry.js statIdentity) — else the
      // current file goes out with no-cache and the folders are read again
      const same = sameIdentity(statIdentity(st), f);
      if (!same) sets.noteChanged();
      await serveFile(req, res, f.abs, st, 'plugins', segments, query, gzipCache, log, {
        // the ETag: the content hash of the bytes the scan hashed — of a changed file, its stat identity (size and mtime
        // alone would revalidate a rewrite that kept them: a 304 for other bytes)
        contentHash: same ? f.sha256.slice(0, 16) : `${st.size.toString(16)}-${Math.floor(st.mtimeMs).toString(16)}-${st.ino.toString(16)}-${Math.floor(st.ctimeMs * 1000).toString(16)}`,
        cacheControl: same && f.urlHashes.has(hash) ? IMMUTABLE_CACHE : 'no-cache',
        // [ASSUMED] the frame CSP is only on a ui plugin's /p/ files (f.frame), including its sandbox
        // allow-scripts (no allow-same-origin). serveFile puts it on 200, 206 and 304. 'self' may not match
        // the opaque origin.
        headers: f.frame ? { 'Content-Security-Policy': UI_FRAME_CSP } : null,
      });
      return;
    }
    // Language packs (server/plugins/registry.js): the live index, and only the files a lang manifest names
    if (decoded.startsWith(PACKS_URL)) {
      const parts = decoded.slice(PACKS_URL.length).split('/');
      if (parts.length === 1 && parts[0] === PACK_INDEX_FILE) { sendJson(req, res, 200, registry.index()); return; }
      const abs = parts.length >= 2 && !parts.some((s) => s === '' || s === '.' || s === '..') ? registry.servable(parts[0], parts.slice(1).join('/')) : null;
      const st = abs ? await fsp.stat(abs).catch(() => null) : null;
      if (!st || !st.isFile()) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
      await serveFile(req, res, abs, st, 'packs', parts, query, gzipCache, log);
      return;
    }
    // Extension-less audio (download-manager avoidance): /media/bgm/act1 → /assets/audio/bgm/act1.mp3
    if (decoded.startsWith(MEDIA_PREFIX)) {
      await serveMedia(req, res, decoded.slice(MEDIA_PREFIX.length), query, publicDir, gzipCache, log, { urlHash, assetIndex });
      return;
    }
    // The served manifests: every art URL with its content hash (assetViews.js), once the index is ready
    if (views && (decoded === '/data/assets.json' || decoded === '/data/local-assets.json' || decoded === '/data/local-fx.json')) {
      const view = await views.get(decoded.slice('/data/'.length));
      if (view) {
        await serveBuffer(req, res, { body: view.body, hash: view.hash, type: MIME['.json'], cacheControl: 'no-cache', key: `view:${decoded}`, cache: gzipCache });
        return;
      }
    }
    // 创意工坊 (工坊 mod 层移植, 2026-10-16, DESIGN §34): a data file a pack TOUCHED is served merged, not as the
    // on-disk original — the browser must see the same view the server's matches use, or a pack's operator would play
    // server-side and be invisible client-side. `workshopJson` maps only the files `applyWorkshop` actually changed
    // (`buildWorkshopDataFiles`), so an untouched file keeps the plain static path below byte for byte.
    if (workshopJson && workshopJson.size && decoded.startsWith('/data/')) {
      const body = workshopJson.get(decoded.slice('/data/'.length, -'.json'.length));
      if (body) {
        await serveBuffer(req, res, { body, hash: null, type: MIME['.json'], cacheControl: 'no-cache', key: `wsjson:${decoded}`, cache: gzipCache });
        return;
      }
    }
    // 包给**已有语种**补的词条（`pack.json.i18n`, docs/WORKSHOP.md §1.10）：`/i18n/<code>.json` 在有包声明时送
    // **合并体**（官方文件 + 包的新增键，已有键绝不覆盖），与上面 `/data/*.json` 逐字同一条纪律 —— 客户端读的就是
    // 这个 URL（public/js/ui/lang.js），而 `public/i18n/<code>.json` 一个字节都不改。没有包声明 i18n 时这张表是
    // 空的 ⇒ 请求落到下面的普通静态路径，行为逐字节不变。
    if (workshopI18n && workshopI18n.size && decoded.startsWith('/i18n/') && decoded.endsWith('.json')) {
      const code = decoded.slice('/i18n/'.length, -'.json'.length);
      const body = code && !code.includes('/') ? workshopI18n.get(code) : null;
      if (body) {
        await serveBuffer(req, res, { body, hash: null, type: MIME['.json'], cacheControl: 'no-cache', key: `wsi18n:${decoded}`, cache: gzipCache });
        return;
      }
    }
    // 包声明的**战斗逻辑**模块（`pack.json.server.battle`，DESIGN §34.17）：与 `/workshop-kits/` 同一条通道，但
    // **只服务装载器登记过的 URL**，不放宽成「包内子树」—— 服务端把它当 data: URL 加载，data: 没有目录，相对路径
    // 无从解析，所以它也没有需要「按 URL 解出包内相对路径」的第二个消费者，登记表就是它全部的入口。
    if (workshopBattleFiles && workshopBattleFiles.size && decoded.startsWith(WORKSHOP_BATTLE_PREFIX)) {
      const abs = workshopBattleFiles.get(decoded);
      if (!abs) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let body;
      try {
        body = await fsp.readFile(abs);
      } catch (e) {
        log.error('[workshop] battle module read failed', e);
        sendError(req, res, 404, '页面不存在 · Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // 工坊行为层 (docs/WORKSHOP.md §4, DESIGN §34.18): serve a pack's kit module as an ES module, so the BROWSER runs
    // the very code the server runs. Two halves: a URL the loader registered → the kit file itself; `<包>/<rel>` where
    // `<包>` is a LOADED pack → `<packDir>/kits/<rel>`, so a kit may import its OWN siblings with a downward relative
    // specifier (`./lib/util.js` → `/workshop-kits/<pack>/lib/util.js`). That is the geometry §34.18 rests on: on disk
    // the specifier means `<packDir>/kits/lib/util.js` and in the URL it means the same file, because the `kits/`
    // segment is not in the URL and `resolvePackRelativeKit` adds it back.
    if (workshopKitFiles && workshopKitFiles.size && decoded.startsWith('/workshop-kits/')) {
      const abs = workshopKitFiles.get(decoded) ?? resolvePackRelativeKit(decoded, workshopKitDirs);
      if (!abs) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let body;
      try {
        body = await fsp.readFile(abs);
      } catch (e) {
        log.error('[workshop] kit read failed', e);
        sendError(req, res, 404, '页面不存在 · Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME['.js'], 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // 包声明的资源容器与清单（`pack.json.assets`, DESIGN §34.13, docs/WORKSHOP.md §1.9.4）：`/workshop-resources/`
    // 下**只有装载器注册过的两个 URL** 会被回答 —— 未注册 / 穿越 / 不在声明里的路径一律 404，所以目录穿越在这里
    // 不是「被挡住」，而是**没有可以穿越的目标**（键就是那两个 URL 字符串）。容器可达数百 MB，所以它**流式**
    // 出去（`createReadStream` + `pipeline`），绝不整读进内存；清单小，照读。`?v=<hash12>` 是缓存键。
    if (workshopResourceFiles && workshopResourceFiles.size && decoded.startsWith(WORKSHOP_RESOURCE_PREFIX)) {
      const entry = workshopResourceFiles.get(decoded);
      if (!entry) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let st;
      try {
        st = await fsp.stat(entry.file);
        if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      } catch (e) {
        if (!e || !['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG'].includes(e.code)) log.error('[workshop] resource stat failed', e);
        sendError(req, res, 404, '页面不存在 · Not found');
        return;
      }
      /** @type {Record<string, string|number>} */
      const headers = {
        'Content-Type': entry.kind === 'manifest' ? MIME['.json'] : 'application/octet-stream',
        'Content-Length': st.size,
        'Cache-Control': 'no-cache',
      };
      // The digest the loader verified (`server/workshop.js assetsIssues`), stated on the wire so a downloader can
      // check the bytes it received against the same value the server checked them against — no second hashing pass.
      if (entry.sha256) headers['X-SP-Resource-Sha256'] = entry.sha256;
      res.writeHead(200, headers);
      if (req.method === 'HEAD') { res.end(); return; }
      try {
        await pipeline(fs.createReadStream(entry.file), res);
      } catch (e) {
        // The headers are gone by now, so the only honest answer is to cut the connection: a truncated body with a
        // 200 and a full Content-Length is exactly what a client cannot detect.
        log.error('[workshop] resource stream failed', e);
        res.destroy();
      }
      return;
    }
    // C 层注册点 (DESIGN §34.8, docs/WORKSHOP.md §1.9.3): a pack's panel module, served as an ES module the BROWSER
    // imports — the twin of the kit route, and the reason `/workshop-assets` can keep refusing `.js`. Only URLs the
    // loader registered are servable. Since the owner's ruling of 2026-10-10 the same route also serves a panel's OWN
    // stylesheets (`.css`): a declaration that brings a whole new component cannot be expressed as theme variables.
    const panelExt = decoded.endsWith('.css') ? '.css' : decoded.endsWith('.js') ? '.js' : '';
    if (workshopPanelFiles && workshopPanelFiles.size && decoded.startsWith(WORKSHOP_PANEL_PREFIX) && panelExt) {
      const abs = workshopPanelFiles.get(decoded);
      if (!abs) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      let body;
      try {
        body = await fsp.readFile(abs);
      } catch (e) {
        log.error('[workshop] panel read failed', e);
        sendError(req, res, 404, '页面不存在 · Not found');
        return;
      }
      const type = panelExt === '.css' ? 'text/css; charset=utf-8' : MIME['.js'];
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': body.length, 'Cache-Control': 'no-cache' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // 包声明的只读路由 (`pack.json.routes`, DESIGN §34.13 / docs/WORKSHOP.md §1.9)。刻意放在核心挂载之前：`path`
    // 是作者显式声明的绝对路径，命中它就是命中它 —— 一条声明过的路径不该因为磁盘上恰好有个同名核心文件而变成别的
    // 东西（所以「声明了但文件不在」在下面的 stat 里是 404，不是回落）。只读、只 GET/HEAD、只 `.json`，并且**只有
    // 精确命中的声明路径**才会被回答 —— 目录穿越在这里不是「被挡住」，而是**没有可以穿越的目标**：`..` 永远拼不出
    // 一个已声明的 key。空 Map ⇒ 整块跳过（干净安装逐字节不变）。
    if (workshopRoutes && workshopRoutes.size) {
      const route = workshopRoutes.get(decoded);
      if (route) {
        let body;
        try {
          const st = await fsp.stat(route.file);
          if (!st.isFile()) throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
          body = await fsp.readFile(route.file);
        } catch (e) {
          if (!e || !['ENOENT', 'ENOTDIR', 'EISDIR', 'ENAMETOOLONG'].includes(e.code)) log.error('[workshop] route read failed', e);
          sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : '');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME['.json'], 'Content-Length': body.length,
          'Cache-Control': ROUTE_CACHE_HEADERS[route.cache] || ROUTE_CACHE_HEADERS['no-cache'],
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }
    }
    // 包声明的**动态只读端点**（`server.modules[*].uses` 含 `route`）：与上面静态那一半同一条几何，但内容由包的
    // 几何（只答**逐字命中**的声明路径，所以 `..` 没有可以穿越的目标），但内容由包的一个**同步**回调现算，并且这一层
    // 另有四条纪律（挂在 `server/http/routeMount.js`）：路径必须在 `/mod/<包id>/…` 里、不许落在引擎保留的命名空间里、
    // 只有 `no-store`/`no-cache`、回调必须同步返回 JSON 可序列化的值。空 Map ⇒ 整块跳过（干净安装逐字节不变）。
    if (modRoutes && modRoutes.size) {
      const entry = modRoutes.get(decoded);
      if (entry) {
        const result = runDynamicRoute(entry.handler);
        if (!result.ok) {
          log.warn?.(`[workshop] ${entry.pack}/${entry.module} route "${decoded}": ${result.reason}`);
          sendError(req, res, 500, '服务器内部错误 · Internal error');
          return;
        }
        res.writeHead(200, {
          'Content-Type': MIME['.json'], 'Content-Length': result.body.length,
          'Cache-Control': DYNAMIC_ROUTE_CACHE_HEADERS[entry.cache] || DYNAMIC_ROUTE_CACHE_HEADERS['no-store'],
        });
        res.end(req.method === 'HEAD' ? undefined : result.body);
        return;
      }
    }
    // 工坊素材 (工坊 mod 层移植, 2026-10-16, DESIGN §34): a pack's OWN art, served read-only from `<pack>/assets/**`.
    // This is the one hole in "the repo ships no game assets": a pack may carry its own (a licence-cleared sprite, a
    // custom icon, a voice line) and the CLIENT has to be able to fetch it or the content cannot render. Deliberately
    // narrow: only the registered packs, only their `assets/` subtree (never the pack's data, kits or manifest), an
    // extension allowlist so the folder can never serve a script the page would execute, and no directory listing.
    if (workshopAssets && workshopAssets.size && decoded.startsWith(WORKSHOP_ASSET_PREFIX)) {
      const rel = decoded.slice(WORKSHOP_ASSET_PREFIX.length);
      const segments = rel.split('/').filter((s) => s.length > 0);
      const pack = segments.shift();
      const bad = !pack || !workshopAssets.has(pack) || !segments.length
        || segments.some((s) => s === '..' || s === '.' || s.startsWith('.'));
      const ext = bad ? '' : path.extname(segments[segments.length - 1]).toLowerCase();
      if (bad || !WORKSHOP_ASSET_TYPES.has(ext)) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      const dir = path.join(workshopAssets.get(pack), 'assets');
      const abs = path.join(dir, ...segments);
      if (abs !== dir && !abs.startsWith(dir + path.sep)) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }
      let body;
      try {
        const st = await fsp.stat(abs);
        if (!st.isFile()) throw new Error('not a file');
        body = await fsp.readFile(abs);
      } catch { sendError(req, res, 404, '页面不存在 · Not found'); return; }
      // a pack's art is immutable in practice (a repack ships a new version) and can be large: cache it like /assets/
      res.writeHead(200, {
        'Content-Type': WORKSHOP_ASSET_TYPES.get(ext) || 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control': 'public, max-age=86400',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    // Bare mount paths (e.g. "/data") → treat as the mount directory.
    const mount = mounts.find((m) => decoded.startsWith(m.prefix) || decoded === m.prefix.slice(0, -1)) || mounts[mounts.length - 1];
    const rest = decoded.length > mount.prefix.length ? decoded.slice(mount.prefix.length) : '';
    const segments = rest.split('/').filter((s) => s.length > 0);
    if (segments.some((s) => s === '..' || s === '.')) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }
    if (segments.some((s) => s.startsWith('.'))) { sendError(req, res, 404, '页面不存在 · Not found'); return; }
    if (mount.only && (!segments.length || !mount.only.has(path.extname(segments[segments.length - 1]).toLowerCase())
      // (case-insensitive: the host may be Windows / macOS, where NODEDATA.JS opens nodeData.js)
      || (mount.deny && mount.deny.has(segments[segments.length - 1].toLowerCase())))) {
      sendError(req, res, 404, '页面不存在 · Not found');
      return;
    }
    let absPath = path.join(mount.dir, ...segments);
    if (absPath !== mount.dir && !absPath.startsWith(mount.dir + path.sep)) { sendError(req, res, 403, '禁止访问 · Forbidden'); return; }

    let stat;
    let viaDirectory = false;
    try {
      stat = await fsp.stat(absPath);
      if (stat.isDirectory()) {
        if (!decoded.endsWith('/')) {
          // Built from normalized segments (never from the raw path) so "//host" can't become an open redirect.
          const loc = (mount.prefix + segments.map(encodeURIComponent).join('/') + '/').replace(/\/{2,}/g, '/');
          res.writeHead(301, { Location: loc + (query ? `?${query}` : ''), 'Cache-Control': 'no-cache', 'Content-Length': 0 });
          res.end();
          return;
        }
        absPath = path.join(absPath, 'index.html');
        segments.push('index.html');
        viaDirectory = true;
        stat = await fsp.stat(absPath);
      }
      // Not a regular file, or a file addressed like a directory ("/app.js/") → 404.
      if (!stat.isFile() || (decoded.endsWith('/') && !viaDirectory)) {
        throw Object.assign(new Error('not a file'), { code: 'ENOENT' });
      }
      if (mount.deny) {
        // the on-disk name decides (case-insensitive file systems, Windows 8.3 short names like NODEDA~1.JS)
        const real = await fsp.realpath(absPath);
        if (mount.deny.has(path.basename(real).toLowerCase())) throw Object.assign(new Error('private'), { code: 'ENOENT' });
      }
    } catch (e) {
      if (e && e.code === 'ENOENT' && mount.name === 'data' && segments.length === 1 && LOCAL_ART_MANIFESTS.has(segments[0])) {
        // Optional local-client art (DESIGN §13): an install without it gets an empty manifest instead of a 404,
        // so browsers don't log an error on every page load. Clients treat empty groups as "no local art".
        res.writeHead(200, { 'Content-Type': MIME['.json'], 'Cache-Control': 'no-cache', 'Content-Length': EMPTY_LOCAL_ART.length });
        res.end(req.method === 'HEAD' ? undefined : EMPTY_LOCAL_ART);
      } else if (e && (e.code === 'ENOENT' || e.code === 'ENOTDIR' || e.code === 'EISDIR' || e.code === 'ENAMETOOLONG')) {
        sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : '');
      } else if (e && (e.code === 'EACCES' || e.code === 'EPERM')) {
        sendError(req, res, 403, '禁止访问 · Forbidden');
      } else {
        log.error('[http] stat failed', e);
        sendError(req, res, 500, '服务器内部错误 · Internal error');
      }
      return;
    }
    const first = segments[0] || '';
    if (mount.name === 'public' && (first.toLowerCase().startsWith('studio') || /[^\x00-\x7f]/.test(first))) {
      const studio = await studioRealPath();
      const real = studio ? await fsp.realpath(absPath).catch(() => null) : null;
      if (studio && (!real || real === studio || real.startsWith(studio + path.sep))) { sendError(req, res, 404, '页面不存在 · Not found', decoded.length <= 200 ? decoded : ''); return; }
    }
    // Compare the actual file, including case-insensitive / encoded aliases, before every 200/206/304.
    if (mount.name === 'public' && path.basename(absPath).toLowerCase() === 'simworker.js') {
      const real = await fsp.realpath(absPath);
      const worker = await fsp.realpath(path.join(publicDir, 'js/battle/simWorker.js')).catch(() => null);
      if (real === worker) res.setHeader('Content-Security-Policy', SIM_WORKER_CSP);
    }
    const indexed = mount.name === 'public' && segments.length > 1 && ASSET_INDEX_ROOTS.includes(segments[0]);
    const opts = indexed ? hashedFileOpts(assetIndex, segments.join('/'), stat, urlHash) : (urlHash ? { cacheControl: 'no-cache' } : {});
    await serveFile(req, res, absPath, stat, mount.name, segments, query, gzipCache, log, opts);
  };
}
