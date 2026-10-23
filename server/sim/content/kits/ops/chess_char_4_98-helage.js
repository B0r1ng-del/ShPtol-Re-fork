// server/sim/content/kits/ops/chess_char_4_98-helage.js — 赫拉格 (char_188_helage) kit, tier 4 (自定义).
// Conventions of the tier-4 kits: ../shared/tier4.js; kit contract and rules: ../README.md.
//
// 4_98(自定义) 赫拉格 — 武者 (musha)。数值全部来自官方数据表的 blackboard，此处不写死。
// 机制与自选 kit op-helage.js（同一干员的 DIY 版）逐条同源，仅按预设棋子契约改写：
//   - 形态：普通 _a = E2 Lv1 / 技能 rank 4 / 无模组；精锐 _b = E2 Lv60 / rank 7 / SBL-X 藏锋 stage 1
//     （data/backups.json shopCharChessInfoData[tier4]，采集单口径：_a 不吃模组，_b 模组生效）。
//   - 特性（武者）「不成为治疗目标，攻击到敌人回复 70 生命」：职业层承担（professions.js `musha`，
//     installMushaHeal — noHeal + 每次输出伤害回 value 血），本 kit 不重复实现。
//   - T1 月盈星亏（本数据版本 E0 起解锁）：坚忍 —— 攻速 +min_attack_speed × 已损生命份额（线性，达
//     min_hp_ratio 时最大），每 tick 刷新；_a 50/0.5、_b 100/0.3（blackboard）。
//   - T2 运筹帷幄（精英 2 起）：未阻挡敌人时生命回复速度 +hp_recovery_per_sec（60，潜能 4 起 70）。
//   - S1 新月（攻击回复，AUTO，非默认）：下次攻击 atk_scale × ATK，连续攻击两次。
//   - S2 弦月（时间回复，MANUAL，默认，见 chess.json defaultSkillIndex 1）：ATK +atk，二连击，75% 物理闪避。
//   - S3 满月（时间回复，MANUAL，非默认）：ATK +atk，攻击范围 +ability_range_forward_extend 格，最多
//     attack@max_target 个目标。
//   - 模组 SBL-X 藏锋（精锐，数据承载 stage1 {hp230,atk55}）：特性显示段「生命值低于 50% 获得 25% 庇护」=
//     隐藏模组天赋（index 0 的 damage_resistance / hp_ratio）—— 庇护取最高（tier1.js holdProtect）。
//     003「热的雪」未选用：tb.hp_ratio 缺省时免死钩子静默不装。
//   - 干员自身效果【采集单第 8 项】老将刀意：2026-10-18 用户修订 → 改为 <休整期开始时>使已激活的
//     【乌萨斯】【远见】盟约层数+8/16 —— 移交 garrisons/meta.js（act2autochess_gar_eff_982_a/b，
//     SERVER_PREP_START 事件），本 kit 的 kill 监听与相关常量已移除。

import { num, traitBb, skillRec, toggleBuff, up, onHitOn, holdProtect, PROTECT_TICK_HOLD } from '../shared/tier1.js';

const S1 = 'skchr_helage_1';
const S2 = 'skchr_helage_2';
const S3 = 'skchr_helage_3';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** The blackboard of the talent with data index `i` ({} when absent; module parts with a new index included). */
const talentAt = (chess, i) => (chess?.talents ?? []).find((t) => t && t.index === i)?.bb ?? {};

export default {
  chess_char_4_98_a: (bb, chess) => {
    const t0 = talentAt(chess, 0), t1 = talentAt(chess, 1), t2 = talentAt(chess, 2);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);

    const s2Spec = {
      kind: 'duration',
      mods: { atkPct: num(b2.atk), dodgePhys: num(b2.prob) },
      attack: { hits: 2 },
    };
    const s1Spec = {
      kind: num(skillRec(chess, S1)?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
      attack: { atkScale: num(b1.atk_scale, 1), hits: 2 },
    };
    const s3Spec = {
      kind: 'duration',
      mods: { atkPct: num(b3.atk) },
      targeting: { rangeExtend: num(b3.ability_range_forward_extend), maxTargets: Math.max(1, Math.floor(num(b3['attack@max_target'], 1))) },
    };

    return {
      // 默认技能放顶层 `skill`（content/index.js selectSkillSpec：默认技能绝不能同时进 skills 映射）。
      skill: s2Spec,                                  // 默认技能 = 弦月（数据 defaultSkillIndex 1）
      skills: { [S1]: s1Spec, [S3]: s3Spec },         // 只列非默认技能

      talents: [
        { install(battle, unit) { // 月盈星亏: 坚忍 ASPD up to min_attack_speed, reached at min_hp_ratio HP (linear in the HP lost)
          const maxAs = num(t0.min_attack_speed), minHp = num(t0.min_hp_ratio);
          if (!(maxAs > 0) || !(minHp < 1)) return;
          const key = 'talent:helage:berserk';
          battle.on('tick', () => {
            const cur = unit.findBuff(key);
            if (!up(unit)) { if (cur) battle.removeBuff(unit, key); return; }
            const v = maxAs * Math.max(0, Math.min(1, (1 - unit.hpRatio) / (1 - minHp)));
            if (cur && Math.abs((cur.data?.v ?? 0) - v) < 0.05) return;
            if (v < 0.05) { if (cur) battle.removeBuff(unit, key); return; }
            battle.addBuff(unit, { key, mods: { aspd: v }, data: { v }, tags: ['talent'] });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 运筹帷幄: 生命回复速度 while blocking nobody
          const regen = num(t1.hp_recovery_per_sec);
          if (regen > 0) toggleBuff(battle, unit, 'talent:helage:regen', () => unit.blocking.length === 0, { hpRegen: regen });
          const lowHp = num(t2.hp_ratio), lowRegen = num(t2.hp_recovery_per_sec);
          if (lowRegen > 0 && lowHp > 0) {
            toggleBuff(battle, unit, 'talent:helage:regenLow', () => unit.blocking.length > 0 && unit.hpRatio < lowHp, { hpRegen: lowRegen });
          }
        } },
      ],
      install(battle, unit) {

        // SBL-X “藏锋”: 生命值低于50%时，获得25%的庇护 — the shared 庇护 (holdProtect: the strongest of every
        // source holds), refreshed every tick and at each hit on him while he is below
        const dr = num(t0.damage_resistance), drBelow = num(t0.hp_ratio);
        if (dr > 0 && drBelow > 0) {
          const keep = () => { if (up(unit) && unit.hpRatio < drBelow) holdProtect(battle, unit, dr, PROTECT_TICK_HOLD, unit); };
          battle.on('tick', keep, { owner: unit });
          onHitOn(battle, unit, keep);
        }
        // SBL-Y “热的雪” 未选用 —— tb.hp_ratio 缺省，钩子不会安装（保留以与 op-helage.js 同构）
        const rise = num(tb.hp_ratio);
        if (rise > 0) {
          battle.on('fatal', (ctx) => {
            if (ctx.unit !== unit || ctx.prevented || unit.mem.helageRoseSeq === unit.deploySeq) return;
            unit.mem.helageRoseSeq = unit.deploySeq;
            ctx.prevented = true;
            unit.hp = Math.max(1, unit.s.maxHp * rise);
            battle.fx('undying', { x: unit.x, y: unit.y, id: unit.id });
          }, { owner: unit, priority: -50 });
        }
      },
    };
  },
};
