// 四.2 Forge 工坊跳转按钮（需求方 2026-10-24）。
//
// 需求原文：「读取后端 sh/bat 脚本输出的 `Studio:  http://localhost:3000/studio/#key=…` 这样的语段，在游戏 UI 里加一个
// 按钮，按下跳转到上面读取出的地址。」
//
// 浏览器读不到服务器窗口，所以那条地址只能由服务端给。本项目的取法是**一个只对本机开口的端点**
// `/api/studio-link`（server/http/routes.js）：
//   * 本机 ⇒ 带 `#key=` 的深链；
//   * 局域网其它设备 ⇒ 不带 key 的 `/studio/`（能看，改动被 gate 拒）；
//   * 服务器关了工作台 ⇒ `url: null`，客户端不画按钮。
//
// 钉四件事：
//   1. 端点在，且判据是**请求地址**而不是 Host 头（Host 能被隧道写）；
//   2. 只有 loopback 拿到 key；
//   3. key 与 `studio.pageUrl()` 是**同一份**（不另造一个 key 来源）；
//   4. 客户端不写死地址，且没有地址时不画按钮。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('四.2 Forge 工坊跳转按钮', () => {
  test('the endpoint exists and answers JSON', () => {
    const routes = read('server/http/routes.js');
    assert.match(routes, /export const STUDIO_LINK_PATH = '\/api\/studio-link'/, '端点常量');
    assert.match(routes, /parts\.rawPath === STUDIO_LINK_PATH/, '路由分支');
    assert.match(routes, /sendJson\(req, res, 200, \{ url: withKey \|\| plain, keyed: !!withKey \}\)/, '回的是 JSON');
  });

  test('★ only a loopback request gets the key; a LAN device gets the plain page', () => {
    const routes = read('server/http/routes.js');
    const at = routes.indexOf('if (parts.rawPath === STUDIO_LINK_PATH)');
    const block = routes.slice(at, routes.indexOf('await serveStatic', at));
    // 判据是**连接地址**（clientAddress 读 socket + 受信任的转发头），不是 Host
    assert.match(block, /isLoopback\(peer\)/, '本机才给 key');
    assert.match(block, /clientAddress\(req, trustProxy\)/, '用连接地址，不是 Host 头');
    // 局域网那一支必须存在，且不带 key
    assert.match(block, /plain = studio \? `\$\{base\.replace/, '局域网得到裸 /studio/');
    assert.match(block, /withKey \|\| plain/, '本机优先给带 key 的那一份');
  });

  test('the key comes from the studio itself, never a second source', () => {
    const routes = read('server/http/routes.js');
    assert.match(routes, /studio\.pageUrl\(base\)/, '复用 studio 的 pageUrl（key 在它手里）');
    // 不在路由里自己读 .studio-key 文件 / 自己生成 key
    assert.doesNotMatch(routes, /\.studio-key/, '不自己读 key 文件');
    assert.doesNotMatch(routes, /randomBytes/, '不自己造 key');
  });

  test('studio off ⇒ url null, so the client draws no button', () => {
    const routes = read('server/http/routes.js');
    assert.match(routes, /const plain = studio \? .* : null/, '工作台关着时 plain 是 null');
    assert.match(routes, /\{ url: withKey \|\| plain, keyed: !!withKey \}/, '于是 url 是 null');
  });

  test('the client asks the server instead of hardcoding an address', () => {
    const lobby = read('public/js/screens/lobby.js');
    assert.match(lobby, /fetch\(STUDIO_LINK_PATH/, '去问服务端');
    assert.doesNotMatch(lobby, /127\.0\.0\.1:8787/, '不再写死 editor 的地址');
    assert.doesNotMatch(lobby, /FORGE_EDITOR_URL/, '旧常量已删');
    // 没有地址时不画
    assert.match(lobby, /studioHref \? html`<a class="btn btn--secondary btn--square lobby-forge"/, '没有地址就不画按钮');
    assert.match(lobby, /data-testid="forge-link"/, '按钮有可测的标识');
  });

  test('the button lives in the lobby top bar (需求方 2026-10-24: 大厅顶栏)', () => {
    const lobby = read('public/js/screens/lobby.js');
    const at = lobby.indexOf('topbar__tools');
    assert.ok(at > 0, '顶栏工具组');
    const tail = lobby.slice(at, at + 2000);
    assert.match(tail, /lobby-forge/, '按钮在工具组里');
  });
});
