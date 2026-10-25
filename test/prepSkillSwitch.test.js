// 局内改技能：连续切换必须都生效（需求方 2026-10-25「第二次点击根本不生效，更别谈多次切换」）。
//
// 这一条**跑真实的 Match + PlayerState**，不是读源码正则 —— 前面几轮就是靠正则断言「验证通过」却始终
// 修不对。这里走完整链路：建房 → 进 PREP → setLoadout(换技能 2) → setLoadout(换回技能 1) → 读 ps.loadout。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { makeMatch, give } from './match/harness.js';
import { loadoutOptions } from '../shared/protocol.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** 找一个至少有两个技能、且能当棋手用的干员。 */
function pickTwoSkillChess(m) {
  for (const id of m.gd.visibleChess) {
    const rec = m.gd.chess(id);
    if (!rec || rec.isGolden) continue;
    const opt = loadoutOptions(rec, m.gd.chess(rec.goldenId) || null);
    if (opt && Array.isArray(opt.skills) && opt.skills.length >= 2) return { id, rec, opt };
  }
  return null;
}

test('★ 同一回合内连续切两次技能都生效（换得过去，也换得回来）', () => {
  const h = makeMatch({ mode: 'solo', fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const pick = pickTwoSkillChess(m);
  assert.ok(pick, '本局数据里应有一个 ≥2 技能的干员');

  const { id, opt } = pick;
  // 必须挑**非默认**的那个技能来切 —— 选回默认时 checkLoadout 会把条目丢掉（那是 DESIGN §16 的语义），
  // 用它做「换过去」的断言会误判成「没写进去」。
  const first = opt.skills.find((s) => s !== opt.defaultSkill);
  assert.ok(first != null, '应有一个非默认技能');
  const second = opt.skills.find((s) => s !== first) ?? opt.defaultSkill;
  assert.notEqual(first, second, '两个不同的技能索引');

  // 第一次：换到非默认技能
  const r1 = m.setLoadout(ps.playerId, { [id]: { skill: first } });
  assert.deepEqual(r1, { ok: true }, '第一次切换应被接受');
  assert.equal(ps.loadout[id]?.skill, first, `第一次切换后 loadout 里应是 ${first}`);

  // 第二次：换到另一个（默认）—— 这就是原先「不生效」的那一步
  const r2 = m.setLoadout(ps.playerId, { [id]: { skill: second } });
  assert.deepEqual(r2, { ok: true }, '第二次切换也必须被接受');
  if (second === opt.defaultSkill) {
    assert.equal(ps.loadout[id], undefined, '换回默认后旧选择必须被删掉（而不是原地留着）');
  } else {
    assert.equal(ps.loadout[id]?.skill, second, `第二次切换后应是 ${second}`);
  }

  // 第三次：再换回非默认的那个，确认不是「只能两次」
  const r3 = m.setLoadout(ps.playerId, { [id]: { skill: first } });
  assert.deepEqual(r3, { ok: true });
  assert.equal(ps.loadout[id]?.skill, first, '第三次仍然生效');

  h.m.dispose();
});

test('★ 换回「默认技能」也要真的清掉旧选择（不能被 checkLoadout 丢默认条目而失效）', () => {
  const h = makeMatch({ mode: 'solo', fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const pick = pickTwoSkillChess(m);
  assert.ok(pick);
  const { id, opt } = pick;
  const def = opt.defaultSkill;
  const other = opt.skills.find((s) => s !== def);
  assert.ok(other != null, '应有一个非默认技能');

  // 换成非默认
  assert.deepEqual(m.setLoadout(ps.playerId, { [id]: { skill: other } }), { ok: true });
  assert.equal(ps.loadout[id]?.skill, other);

  // 换回默认：checkLoadout 会把「等于默认」的条目丢掉，但 setLoadout 的 merge 必须按**提交点名的 id** 删旧的
  assert.deepEqual(m.setLoadout(ps.playerId, { [id]: { skill: def } }), { ok: true });
  assert.equal(ps.loadout[id], undefined, '选回默认后不应留下任何记录（旧选择被删掉）');

  h.m.dispose();
});

test('★ 服务端改完 loadout 必须把新的 m.private 推回给这个玩家（客户端才有新基线）', () => {
  // 这才是「第二次点击不生效」的真根因：PREP 分支原先只 ps.recompute()，没有 markPrivate。
  // 客户端拿不到新 priv.loadout，就一直用开局那份当基线。
  const h = makeMatch({ mode: 'solo', fake: true }).start();
  h.toPrep(1);
  const m = h.m;
  const ps = h.ps('p_0');
  const pick = pickTwoSkillChess(m);
  assert.ok(pick);
  const { id, opt } = pick;
  const other = opt.skills.find((s) => s !== opt.defaultSkill);

  // 记录发给这个玩家的 m.private 帧
  const frames = [];
  h.onSend.push((pid, msg) => { if (pid === ps.playerId && msg && msg.t === 'm.private') frames.push(msg); });

  assert.deepEqual(m.setLoadout(ps.playerId, { [id]: { skill: other } }), { ok: true });
  // flush 一次（m.private 是标脏后批量发的）
  m.flush?.();

  assert.ok(frames.length > 0, '改完技能后应至少有一帧 m.private 发给该玩家');
  const last = frames[frames.length - 1];
  assert.equal(last.loadout?.[id]?.skill, other, '推回去的 loadout 必须含这次的新选择');

  h.m.dispose();
});

test('★ lobby 转发给 match 的必须是**原始 entries**（归一化会丢掉「等于默认」的条目）', () => {
  // 需求方 2026-10-25 那个「换得过去、换不回来」的最后一环。
  // `server/lobby.js` 的 `loadout()` 原先按 `rules.prepLoadout === 'prep'` 分叉：
  //   有 → 传原始 entries；没有 → 传 `checkLoadout` 归一化后的 `loadout`。
  // 而归一化会把「等于默认」的条目丢掉，于是**未装任何 mod 的普通房间**（走的正是 else 分支）
  // 在「点回默认技能」时传下去的是空对象，merge 删不到旧选择。
  // 现在两条路统一传原始 entries —— setLoadout 自己会校验，并按「这次点过名的 id」删旧记录。
  const src = readFileSync(join(ROOT, 'server/lobby.js'), 'utf8');
  const at = src.indexOf('loadout(session, { entries, ops })');
  assert.ok(at > 0, 'lobby.loadout 存在');
  const body = src.slice(at, src.indexOf('\n  /**', at));
  assert.match(body, /room\.match\.setLoadout\(session\.playerId, entries, ops\)/, '必须把原始 entries 交给 match');
  assert.doesNotMatch(body, /setLoadout\(session\.playerId, loadout, opsSet\)/,
    '不能把归一化后的 loadout 交下去（等于默认的条目在那里已经被丢掉了）');
});

test('★ 调完 setLoadout 必须立刻 flush（markPrivate 只标脏，不 flush 就永远发不出去）', () => {
  // 需求方 2026-10-25 那个「第二次点击不生效」的最最后一环：
  // `room.loadout` 是 lobby **直接调** match.setLoadout 的，走的不是 match 自己的消息循环，
  // 所以没有任何地方替它 flush。setLoadout 里的 markPrivate 只是把私密视图标脏 ——
  // 不 flush，新的 m.private 永远发不出去，客户端一直拿旧基线。
  const src = readFileSync(join(ROOT, 'server/lobby.js'), 'utf8');
  const at = src.indexOf('loadout(session, { entries, ops })');
  const body = src.slice(at, src.indexOf('\n  /**', at));
  assert.match(body, /room\.match\.flush\?\.\(\)/, 'setLoadout 之后必须 flush，让新的 private 回到玩家');
  // 且 flush 必须在 setLoadout 之后（顺序反了就白标脏）
  const iSet = body.indexOf('room.match.setLoadout');
  const iFlush = body.indexOf('room.match.flush');
  assert.ok(iSet > 0 && iFlush > iSet, 'flush 必须在 setLoadout 之后');
});
