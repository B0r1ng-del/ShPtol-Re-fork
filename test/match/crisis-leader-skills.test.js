// 危机合约 · S1/S2/S5 — leader SKILL cooldown contracts, measured against the REAL wave overrides.
//
// These three ride an existing engine seam: `content/enemies/helpers.js:abOf` reads a wave's `overrides` table
// (`sk[prefabKey].cd / .icd`), and `bossRounds` passes `wave.overrides` through. So a cooldown contract is a table
// patch, not a sim change — which is why these tests measure the patched TABLE rather than a battle.
//
// Real numbers from data/waves.json:
//   “萨米的意志”  act1autochess_h07_07 → enemy_9033_acdeer: Lasso cd 60 / icd 40, Doom 999/999
//   “假想敌：铳”  act1autochess_h07_02 → enemy_9017_achunt: skill 1 cd 999 / icd 999
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { GameData } from '../../server/match/gamedata.js';
import { crisisRules } from '../../shared/crisis.js';

const ROOT = path.resolve(import.meta.dirname, '../..');
const DATA = {};
for (const f of fs.readdirSync(path.join(ROOT, 'data'))) {
  if (f.endsWith('.json')) DATA[f.replace(/\.json$/, '')] = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', f), 'utf8'));
}
const DEER = 'enemy_9033_acdeer';
const HUNT = 'enemy_9017_achunt';
const skillOf = (table, key, prefab) => {
  const s = ((table[key] || {}).skills || []).find((x) => x && x.prefabKey === prefab);
  return s ? { cd: s.cooldown, icd: s.initCooldown } : null;
};
const gdFor = (mode, tags) => {
  const gd = new GameData(DATA, mode === 'quad' ? 'mode_multi_hard' : 'mode_single_hard');
  const r = crisisRules({ mode, tags });
  gd.crisisFx = r ? r.fx : null;
  return gd;
};

const DEER_WAVE = DATA.waves.act1autochess_h07_07.overrides;
const HUNT_WAVE = DATA.waves.act1autochess_h07_02.overrides;

test('没有对应合约时返回同一个表（普通局波次零改动）', () => {
  const ov = DEER_WAVE;
  assert.equal(gdFor('solo', []).crisisBossSkillOverrides(ov, {}), ov, '原对象');
});

test('S2 冰原狂潮 — 自然涌动 首次 40→30（提前25%）、冷却 60→50（缩短约17%）', () => {
  const gd = gdFor('solo', ['S2-1']);
  const out = gd.crisisBossSkillOverrides(DEER_WAVE, {});
  assert.deepEqual(skillOf(out, DEER, 'Lasso'), { cd: 50, icd: 30 });
  // Doom 不受影响
  assert.deepEqual(skillOf(out, DEER, 'Doom'), { cd: 999, icd: 999 });
  // 二档同样的冷却，另加「半血前也同时攻击2名目标」（由 targets 字段表达，不在此表）
  const out2 = gdFor('solo', ['S2-2']).crisisBossSkillOverrides(DEER_WAVE, {});
  assert.deepEqual(skillOf(out2, DEER, 'Lasso'), { cd: 50, icd: 30 });
});

test('S1 最终之罚重燃 — 第二领袖的最终之罚冷却 → 24（需同选领袖方案）', () => {
  const gd = gdFor('solo', ['L2-1', 'S1-1']);
  const out = gd.crisisBossSkillOverrides(HUNT_WAVE, {});
  assert.equal(skillOf(out, HUNT, '1').cd, 24);
});

test('S5 接力号令 — 第二领袖首次等待减半（需同选 L3）', () => {
  const gd = gdFor('solo', ['L3-1', 'S5-1']);
  const out = gd.crisisBossSkillOverrides(HUNT_WAVE, {});
  assert.equal(skillOf(out, HUNT, '1').icd, 499.5, '999 × 0.5');
});

test('改表不改原表（原 wave 的 overrides 不动）', () => {
  const before = JSON.stringify(DEER_WAVE);
  gdFor('solo', ['S2-1']).crisisBossSkillOverrides(DEER_WAVE, {});
  assert.equal(JSON.stringify(DEER_WAVE), before, '源表零改动');
});
test('S3 护卫合流 — 50%/100% 加入，每批向下取整至少1名', () => {
  assert.equal(gdFor('solo', ['L2-1', 'S3-1']).crisisEscortShare(4), 2, '4 × 50%');
  assert.equal(gdFor('solo', ['L2-1', 'S3-1']).crisisEscortShare(1), 1, '至少 1 名');
  assert.equal(gdFor('solo', ['L2-1', 'S3-1']).crisisEscortShare(3), 1, '3 × 50% = 1.5 → 1');
  assert.equal(gdFor('solo', ['L2-1', 'S3-2']).crisisEscortShare(4), 4, '100%');
  assert.equal(gdFor('solo', []).crisisEscortShare(4), 0, '无合约不加护卫');
});

test('S4 同步共鸣 — 每30秒比较两领袖生命百分比，差>15点减伤25%/10秒，否则双方增伤15%/8秒', () => {
  assert.equal(gdFor('quad', []).crisisLeaderResonance(), null, '无合约');
  assert.deepEqual(gdFor('quad', ['L2-1', 'S4-1']).crisisLeaderResonance(), {
    period: 30, gap: 0.15, cut: 0.25, cutDur: 10, vuln: 0.15, vulnDur: 8,
  });
});

test('S6 双首破局 — 登场发 20 技力 + 护盾（单人15%/四人20%）10秒；20秒后两领袖攻速+10', () => {
  assert.equal(gdFor('solo', []).crisisDualEntrance(), null, '无合约');
  assert.deepEqual(gdFor('solo', ['L2-1', 'S6-1']).crisisDualEntrance(), { sp: 20, shield: 0.15, shieldDur: 10, after: 20, aspd: 10 });
  assert.deepEqual(gdFor('quad', ['L2-1', 'S6-1']).crisisDualEntrance(), { sp: 20, shield: 0.2, shieldDur: 10, after: 20, aspd: 10 });
});
