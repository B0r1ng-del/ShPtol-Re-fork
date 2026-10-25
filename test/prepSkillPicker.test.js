// 三.2 整备阶段改技能（需求方 2026-10-23）。
//
// 需求原文：「允许玩家在局内的整备阶段修改干员的技能。原本局内整备阶段点开干员详细只能看到大厅干员调配里选好的技能；
// 希望实现在局内整备阶段干员详细里展示他的三个技能，能手动修改选择，让他下一场战斗用出另一种技能。当整局游戏结束、
// 再开下一局时，干员技能默认还是干员调配里调好的那一个。」
//
// 本条钉四件事：
//   1. 服务端**收**休整期的 `room.loadout`，且只在这个座位还没准备时（`prepLoadout: prep` 档）；
//   2. 提交是**叠加**语义：没点名的干员保留当前配发（`mergeLoadoutEntries`）；
//   3. 客户端那一格只在四个条件同时成立时才画（`skillPicker`）：档位是 prep、休整期、自己棋盘上的干员、技能不止一个；
//   4. **不新增协议消息** —— 走的就是既有的 `room.loadout`（源码级断言，防止有人再加一条）。
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { BEHAVIOUR_SWITCHES, behaviourIsDefault, behaviourValue } from '../shared/behaviour.js';
import { LOADOUT_PHASES, loadoutPhasesFor, mergeLoadoutEntries } from '../server/match/match/platform.js';
import { PHASE } from '../shared/constants.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

describe('三.2 整备阶段改技能', () => {
  test('the switch defaults to `prep` — an unconfigured room accepts a PREP loadout', () => {
    assert.equal(BEHAVIOUR_SWITCHES.prepLoadout.default, 'prep', 'default档是 prep（需求方：局内整备阶段就能改）');
    assert.equal(behaviourIsDefault([], 'prepLoadout'), true, '没有声明 ⇒ 就是默认档');
    // 没有声明时 `behaviourValue` 返回 null（「什么都没说」）—— 这个 null 在读取处就是**默认档** prep
    assert.equal(behaviourValue([], 'prepLoadout'), null, '无声明 = 没有任何显式档位');
    assert.equal(loadoutPhasesFor([]).includes(PHASE.PREP), true, '于是 PREP 被收（默认档的实际效果）');
  });

  test('prep档 accepts INFO_CHECK and PREP; a pack may still declare `locked`', () => {
    assert.deepEqual([...LOADOUT_PHASES.prep], [PHASE.INFO_CHECK, PHASE.PREP]);
    assert.deepEqual([...loadoutPhasesFor([])], [PHASE.INFO_CHECK, PHASE.PREP], '无声明 ⇒ 收 PREP');
    assert.deepEqual([...loadoutPhasesFor([{ switch: 'prepLoadout', option: 'locked' }])], [PHASE.INFO_CHECK], '包可以显式收紧');
  });

  test('a PREP submit MERGES: operators it does not name keep what the round issued', () => {
    const current = { 'chess_a': { skill: 1, module: null }, 'chess_b': { skill: 0, module: null } };
    const incoming = { 'chess_a': { skill: 2 } };
    const merged = mergeLoadoutEntries(current, incoming);
    assert.deepEqual(merged['chess_a'], { skill: 2 }, '点名的干员换了技能');
    assert.deepEqual(merged['chess_b'], { skill: 0, module: null }, '没点名的原样保留');
  });

  test('an empty PREP submit changes nothing (the whole board keeps its skills)', () => {
    const current = { 'chess_a': { skill: 1, module: null } };
    assert.deepEqual(mergeLoadoutEntries(current, {}), current);
    assert.deepEqual(mergeLoadoutEntries(current, null), current);
  });

  test('★ no new protocol message: the client submits through the existing `room.loadout`', () => {
    const game = read('public/js/screens/game.js');
    const sync = read('public/js/ui/loadoutSync.js');
    // 客户端拿的就是 loadoutSync 的 setEntries，而不是自己发一条消息
    // （`prepLoadoutAllowed` 是同一模块导出的闸门判据，读服务端同一个落点；它不是第二条消息）
    assert.match(game, /import \{[^}]*\bsetEntries\b[^}]*\} from '\.\.\/ui\/loadoutSync\.js'/, 'game.js 用 setEntries');
    assert.match(sync, /msgType: 'room\.loadout'/, 'loadoutSync 仍然只发 room.loadout');
    assert.match(sync, /export function prepLoadoutAllowed\(\)/, '闸门判据也来自 loadoutSync');
    // 没有第二条「改技能」的消息类型
    for (const text of [game, sync]) assert.doesNotMatch(text, /'room\.setSkill'|'g\.setSkill'/);
  });

  test('★ 局内改技能不写回局外配置：sendMatchLoadout 只发服务端，不碰 pref / 不碰 store', () => {
    // 需求方 2026-10-25 原话：「出到局外的干员调配还是一开始的样子」。
    // 这一条钉的是**实现约束**：局内那条路径一旦顺手调了 setEntries / savePref，局外配置就被污染了。
    const sync = read('public/js/ui/loadoutSync.js');
    const start = sync.indexOf('export function sendMatchLoadout');
    assert.ok(start > 0, 'sendMatchLoadout 存在');
    const fn = sync.slice(start, sync.indexOf('\n}', start) + 2);
    assert.match(fn, /net\.request\('room\.loadout'/, '只发 room.loadout');
    // 这两个是「写局外」的入口：一个写 store、一个写 localStorage
    assert.doesNotMatch(fn, /loadoutStore\.set|setEntries\(|savePref\(|localStorage/, '不写 store / 不写 pref');
  });

  test('★ 归属判据不能拿 detailLoadout 与 priv.loadout 比引用（undefined vs null 永远不等）', () => {
    // 需求方 2026-10-25 报「局内还是不能改技能」，浏览器 DOM 里只有 .dskill 没有 .dskpick —— 即 skillPicker 返回 null。
    // 真根因：`detailLoadout` = `priv?.loadout ?? null`，而服务端没发这一项时 `priv.loadout` 是 **undefined**，
    // `null !== undefined` 恒为真 ⇒ 一个还没有任何调配记录的座位，技能格一次都打不开。
    const game = read('public/js/screens/game.js');
    const start = game.indexOf('const skillPicker = (() => {');
    assert.ok(start > 0, 'skillPicker 存在');
    const block = game.slice(start, game.indexOf('})();', start));
    assert.doesNotMatch(block, /if \(detailLoadout !== priv\.loadout\) return null;/, '不能拿两者直接比引用');
    assert.doesNotMatch(block, /\(detailLoadout \?\? null\) !== \(priv\.loadout \?\? null\)/,
      '也不能两边都 ?? null：队友的 unitLoadout() 在没有调配时同样返回 null，会被误判成自己');
    // 正确判据：这张卡落到的 piece 属于我（自己的棋盘 / 手牌 / 整备区都是自己）
    assert.match(block, /resolved\.ownerId != null && resolved\.ownerId !== myId/, '按 piece 归属判，不按 loadout 引用判');
  });

  test('the picker only appears where the requirement says it may', () => {
    const game = read('public/js/screens/game.js');
    const start = game.indexOf('const skillPicker = (() => {');
    assert.ok(start > 0, 'skillPicker 存在');
    const block = game.slice(start, game.indexOf('})();', start));
    // ① 档位是 prep  ② 休整期  ③ 卡落到自己的某块 piece  ④ 技能不止一个
    assert.match(block, /!prepLoadoutOpen \|\| phase !== PHASE\.PREP/, '档位与相位两个闸门');
    assert.match(block, /priv\.ready/, '准备了就锁死');
    assert.match(block, /!resolved\.piece/, '只认自己的 piece（棋盘 / 手牌 / 整备区都算）');
    assert.match(block, /opt\.skills\.length < 2/, '只有一个技能时没有可选项');
    // 只改技能，不碰模组
    assert.match(block, /delete entry\.skill; else entry\.skill = index/, '只写 skill');
    assert.doesNotMatch(block, /entry\.module\s*=/, '不写 module');
    // ★ 需求方 2026-10-25：手牌 / 整备区也要能改。`indexPieces` 收 board/hand/temp/research 四区，
    //   而「还没买的商店卡」没有 piece ⇒ 上面那条 `!resolved.piece` 已经把它挡住了（显示默认技能、不给选）。
    const placement = read('public/js/ui/gameLogic/placement.js');
    for (const area of ['board', 'hand', 'temp']) {
      assert.match(placement, new RegExp(`area: '${area}'`), `indexPieces 收 ${area} 区（局内点得到就有 piece）`);
    }
  });

  test('the detail card draws one FULL card per skill, and the current one is marked', () => {
    const panel = read('public/js/ui/detailPanel.js');
    assert.match(panel, /skillPicker\.options\.map/, '每个技能一个按钮');
    assert.match(panel, /data-skill-opt=\$\{i\}/, '带一个可供测试认出的属性');
    assert.match(panel, /is-on/, '当前选中的那个高亮');
    assert.match(panel, /onClick=\$\{\(\) => skillPicker\.onPick\(i\)\}/, '点一下就提交');
    // ★ 需求方 2026-10-25 定稿：「把该干员的所有技能都平铺出来，点哪个用哪个」——
    //   每张卡要自带图标 + 名字 + 标签 + 描述（先前那排小图标看不到描述，等于还得靠记忆猜）。
    assert.match(panel, /dskpick__card/, '每张技能卡一个容器');
    assert.match(panel, /dskpick__icon/, '图标');
    assert.match(panel, /dskpick__name/, '名字');
    assert.match(panel, /skillTags\(rec\)/, '标签（SP 类型 / 触发方式 / 初动消耗）');
    assert.match(panel, /dskpick__desc/, '描述正文容器');
    assert.match(panel, /rec\.descRaw \|\| rec\.desc/, '描述取自这一条技能自己的 desc');
    // 平铺时不再单独画「当前技能」那一条（卡片本身就是那条），避免同一个技能出现两次
    assert.match(panel, /skillPicker \? null : html`<\$\{RichText\} as="p" text=\$\{sk\.descRaw \|\| sk\.desc\}/, '平铺时不重复画当前技能');
  });
});
