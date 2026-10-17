// 「交流」表情键的挂载条件（fork，在线聊天）。
//
// 需求方 2026-10-17：「关闭『房间配置』里的『在线聊天』后，局内的『交流』表情键会消失」—— 修之前 game.js 那两处
// 都写成 `chatOn && ...`，于是 chatOn === false 时**两处都不渲染**，按钮彻底消失。这是本文件要钉住的那条规则：
//
//   * 在线聊天 **开** + 窗口**展开** ⇒ 按钮在聊天窗里（窗外那份不渲染，免得两个）
//   * 在线聊天 **开** + 窗口**收起** ⇒ 按钮在左下角（`.gm__corner`）
//   * 在线聊天 **关**            ⇒ 按钮在左下角 —— 与官方版一模一样，这是它唯一的位置
//   * 观战席                    ⇒ 永远没有按钮（官方规则：观战不能发表情）
//
// 判据用**源码契约**（这层是 JSX 条件，没有 DOM 可断言）；浏览器里的实际渲染由
// test/ui/emotes.e2e.test.js（SP_E2E=1）覆盖。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const SRC = readFileSync(path.join(ROOT, 'public/js/screens/game.js'), 'utf8');

/** The corner block: from its `<div class=…gm__corner…>` to the line that closes it (the first `</div>` after the
 *  EmoteWheel it wraps — the block's own comments may mention tags, so a plain indexOf is not enough). */
function cornerBlock() {
  const start = SRC.indexOf("class=${`gm__corner");
  assert.ok(start >= 0, 'the corner block exists in screens/game.js');
  const wheel = SRC.indexOf('EmoteWheel', start);
  assert.ok(wheel > start, 'the corner block renders an EmoteWheel');
  const end = SRC.indexOf('</div>', wheel);
  assert.ok(end > wheel, 'the corner block has a closing tag after the wheel');
  return SRC.slice(start, end);
}

test('在线聊天关掉时，「交流」表情键仍然渲染在左下角（官方版的位置）', () => {
  const corner = cornerBlock();
  assert.match(corner, /EmoteWheel/, 'the wheel is rendered inside the corner block');
  // The CONDITION actually written into the markup (the comment above it also mentions these names, so read the JSX line).
  const line = corner.split('\n').find((l) => l.includes('? html`<${EmoteWheel}'));
  assert.ok(line, 'the wheel has a conditional in the corner block');
  assert.match(line, /!chatOn \|\| !chatOpen/, 'the corner wheel renders when the option is OFF or the window is folded');
  assert.doesNotMatch(line, /chatOn && !chatOpen/, '`chatOn && !chatOpen` would hide the wheel on a room with 在线聊天 off');
});

test('观战席永远拿不到表情键（官方规则）', () => {
  const corner = cornerBlock();
  assert.match(corner, /!spectator\s*&&/, 'the corner wheel is guarded by !spectator');
  assert.match(SRC, /emote=\$\{spectator \? null :/, 'the chat window\'s own copy is guarded too');
});

test('窗口展开时按钮只在聊天窗里（不会同屏出现两个）', () => {
  assert.match(SRC, /ChatWindow[\s\S]{0,400}?emote=\$\{spectator \? null : html`<\$\{EmoteWheel\}/,
    'the open window carries the wheel');
  // 角落那一份的条件必须能排除「开着且展开」这一格
  const corner = cornerBlock();
  assert.match(corner, /!chatOn\s*\|\|\s*!chatOpen/, 'the corner copy is suppressed exactly while the window is open and expanded');
});

test('左侧收起态仍给折叠的聊天窗让位（.is-chat-folded 那条样式约定没被删）', () => {
  assert.match(SRC, /gm__corner\$\{chatOn && !chatOpen \? ' is-chat-folded' : ''\}/,
    'the folded window still lifts the corner row above itself');
});
