// server/sim/content/kits/ops/chess_char_3_99-gyuki.js — 缠丸 (char_289_gyuki) kit, tier 3 (2026-10-13 从 tier 2 调整).
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md.
//
// 3_99(自定义) 缠丸 — 无畏者 (fearless)。数值全部来自官方数据表的 blackboard，此处不写死：
//   恶鬼体质 (精英 2)：防御力-20%，但最大生命值 +20%（潜能 5 起 +23% → talentBb(chess,0).max_hp）
//   生命回复·β型 S1 (skcom_heal_self[2])：立即恢复最大生命的 30%(Lv4) / 40%(Lv7) — bb.hp_ratio
//   恶鬼之力   S2 (skchr_gyuki_2)：防御力降至 0、攻击力 +90%(Lv4) / +105%(Lv7) — bb.atk
//   DRE-Y 断竹插花作品 (模组)：生命+270 攻击+35 由数据承载；特性追加 —— 被击倒时不撤退且回复所有生命，
//     但生命上限 -60%、攻击速度 +30（单次部署只触发 1 次）[ASSUMED: 模组 1 级]
//   干员自身效果【采集单第 8 项】恶鬼血战（2026-10-16 用户修订：单血线 70%，**自身已激活的盟约统一 +12/24**
//   —— 取消 2026-10-14 的按盟约分档：【东】与【不屈】各 +12（普通）/ +24（精锐）；加层目标仍是**已激活**的自身盟约）：
//   每场战斗自身生命值首次降低至 70% 以下时，使 **自身所属盟约中已激活者** 加层（reason 'op'；「已激活」内联读
//   battle.getPlayer(pid).bonds[id].active —— kit 禁 import support/index.js —— kits_layout.test.js）。
//
// 注：无畏者的分支特性「可以且优先攻击自身阻挡的单位」由职业/索敌层承担（server/sim/professions.js fearless），
// 本 kit 不重复实现。
// 注：kit 文件禁止 import 任何 `index.js`（kits_layout.test.js），引擎 API 直接用 battle.*。

import { num, talentBb, moduleOn, skillBbOf, up } from '../shared/tier1.js';

const S1 = 'skcom_heal_self[2]';   // 生命回复·β型（非默认技能）
const S2 = 'skchr_gyuki_2';        // 恶鬼之力（默认技能，见 chess.json defaultSkillIndex 1）

/** 模组：免死后生命上限 -60%、攻击速度 +30（需求单口径，与官方 DRE-Y 1 级特性一致）。 */
const MOD_HP_CAP = -0.6;
const MOD_ASPD = 30;
/** 「单次部署只触发 1 次」的标记（跨战斗状态放 unit.mem，不用模块级变量）。 */
const MOD_FIRED = 'gyuki:moduleFired';
/** 干员自身效果（恶鬼血战）：70% 血线每场战斗一次的标记（mem 键）。 */
const THR_70 = 'gyuki:thr70';
/** 干员自身效果（恶鬼血战）：血线加的层数（2026-10-16 用户修订：取消按盟约分档，自身**已激活**的盟约统一
 *  +12（普通）/ +24（精锐））。 */
const TH = (golden) => (golden ? 24 : 12);

/** 干员的所属盟约（chess 记录 bonds，data/chess.json 直挂字段）。 */
const ownBonds = (u) => (Array.isArray(u.def?.bonds) ? u.def.bonds : Array.isArray(u.def?.raw?.bonds) ? u.def.raw.bonds : []);

/**
 * 干员自身效果（恶鬼血战）：生命首次降到 70% 以下时，给「目标自身所属盟约中已激活者」加层（每场战斗一次；
 * 2026-10-13 第五次修订：加层目标回到已激活口径，内联读 battle.getPlayer(pid).bonds[id].active —— kit 禁
 * import support/index.js —— kits_layout.test.js）。
 * `th` = 加层数值：数字（所有已激活盟约同一档）或 { bondId: 层数 }（按盟约分档）；未列出的已激活盟约按 0 处理。
 * 缠丸当前用数字档（2026-10-16 用户修订：+12/24，原先的按盟约分档已取消）。
 * `keys` = mem 标记键前缀（同一干员身上多个来源的特质互不共用触发次数）。
 */
export function hpThresholdLayers(battle, unit, target, { th, keys }) {
  const mem = target.mem = target.mem || {};
  const below70 = target.hp < target.s.maxHp * 0.7;
  if (mem[keys[0]] || !below70 || target.ownerId == null) return;
  mem[keys[0]] = true;                                     // 触发即消耗（首次下降计一次，与激活状态无关）
  const player = battle.getPlayer(target.ownerId);
  const bonds = ownBonds(target).filter((id) => player?.bonds?.[id]?.active);
  for (const id of bonds) {
    const amt = typeof th === 'object' && th !== null ? (th[id] ?? 0) : th;
    if (amt > 0) battle.addLayers(target.ownerId, id, amt, 'op', { source: unit });
  }
}

export default {
  chess_char_3_99_a: (bb, chess) => {
    // 天赋：恶鬼体质（**精英 2 起才解锁** —— 普通形态的 record.talents 为空，绝不能套用默认值）。
    const hasTrait = Array.isArray(chess?.talents) && chess.talents.length > 0;
    const talent = talentBb(chess, 0);
    const traitMods = hasTrait ? { defPct: num(talent.def, -0.2), hpPct: num(talent.max_hp, 0.2) } : null;
    const modOn = moduleOn(chess);
    const golden = !!chess?.isGolden;
    const th = TH(golden);

    const s1B = skillBbOf(chess, S1);
    const s2B = skillBbOf(chess, S2);
    const s1HealRatio = () => num(s1B.hp_ratio, 0.4);
    const s2AtkPct = () => num(s2B.atk, 1.05);

    const s1Spec = {
      kind: 'instant', heal: true,
      onStart({ battle, unit }) {
        if (unit.alive) battle.heal(unit, unit, unit.s.maxHp * s1HealRatio(), { self: true, tags: ['skill'] });
      },
    };
    // 防御力降至 0 = defPct -1（units.js: def × (1 + defPct)）
    const s2Spec = { kind: 'duration', mods: { defPct: -1, atkPct: s2AtkPct() } };

    return {
      // 默认技能放顶层 `skill`（content/index.js selectSkillSpec: 默认技能必须只在这里）。
      skill: s2Spec,                                  // 默认技能 = 恶鬼之力（数据 defaultSkillIndex 1）
      skills: { [S1]: s1Spec },                       // 只列**非默认**技能
      talents: [{
        install(battle, unit) {
          unit.mem = unit.mem || {};
          // allowDead: the kit installs its buffs at battle setup, before the unit is deployed (`addBuff` refuses an
          // un-alive unit otherwise — the engine's own setup-time buffs pass it too, battle/players.js).
          if (traitMods) battle.addBuff(unit, { key: 'gyuki:trait', persist: true, visible: true, allowDead: true, mods: traitMods });

          // ---- 干员自身效果：恶鬼血战（与模组无关，必须在 !modOn 的提前返回之前注册）----
          // **不筛 isMember**：这是她自己的效果，只认触发者是不是她。只加已激活的盟约（第五次修订）。
          // tick 判定（而非只挂 'damaged'）：流失/环境/屏障转化等一切形式的生命值下降都计入「生命值降低至」。
          battle.on('tick', () => {
            if (!up(unit) || unit.ownerId == null) return;
            hpThresholdLayers(battle, unit, unit, { th, keys: [THR_70] });
          }, { owner: unit });

          if (!modOn) return;

          // 模组特性追加（免死）：被击倒时不撤退、回复所有生命，但生命上限 -60%、攻速 +30，单次部署仅 1 次。
          battle.on('fatal', (ctx) => {
            if (ctx.unit !== unit || ctx.prevented || unit.mem[MOD_FIRED]) return;
            unit.mem[MOD_FIRED] = true;
            ctx.prevented = true;
            battle.addBuff(unit, { key: 'gyuki:module', persist: true, visible: true, allowDead: true, mods: { hpPct: MOD_HP_CAP, aspd: MOD_ASPD } });
            unit.markDirty?.();                       // 让 unit.s 重新聚合（生命上限已变）
            unit.hp = unit.s.maxHp;                   // 按变化后的生命上限 100% 复原
          }, { owner: unit, priority: 10 });

          // 每次（重新）部署都恢复一次触发机会 —— 「单次部署只触发 1 次」
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.mem[MOD_FIRED] = false; }, { owner: unit });
        },
      }],
    };
  },
};
