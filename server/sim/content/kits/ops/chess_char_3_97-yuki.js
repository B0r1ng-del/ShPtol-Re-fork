// server/sim/content/kits/ops/chess_char_3_97-yuki.js — 白雪 (char_118_yuki) kit, tier 3 (自定义, 2026-10-13).
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md. 4★ 狙击 / 炮手(aoesniper)。
// 数值全部来自官方数据表的 blackboard；技能/天赋/模组描述来自 PRTS 白雪。
//   - 形态：普通 _a = E1 Lv60 / rank 4 / 无模组；精锐 _b = E2 Lv55 / rank 7 / ART-Y 手里剑 stage 1
//     （数据承载 {hp80,aspd3} + 特性追加「攻击时无视敌人100点的防御力」）。
//   - 特性（炮手）「攻击造成群体物理伤害」：职业层承担（professions.js aoesniper，溅射半径 1.0），本 kit 不重复实现。
//   - T1 重型手里剑（E2 起，_b）：攻击间隔略微增大(+0.2)，但攻击力 +20%。
//   - S1 敌飙（非默认）：攻击范围 +2 格（25s）。
//   - S2 凝武（默认，见 chess.json defaultSkillIndex 1，25s）：攻击变为投掷回旋的大飞镖 —— 命中目标移动速度
//     降低（attack@move_speed）并每秒受到 attack@atk_scale × ATK 的法术伤害，持续 attack@duration（DoT debuff，
//     每次命中刷新）；期间溅射半径缩小为 0.75（PRTS ※开启后飞镖溅射范围缩小为半径 0.75）、飞镖可对其移动路径
//     中的敌人造成伤害（溅射层天然覆盖弹道路径 [ASSUMED]）。
//   - 模组 ART-Y（精锐 stage1）：特性追加「攻击时无视敌人100点防御力」→ mods.defIgnoreFlat（moduleBb）。
//   - 干员自身效果【采集单第 8 项】武库清点（garrison_990）：<获得干员时>**自身所属盟约** +4/8
//     （2026-10-17 用户修订：原「已激活的层数最高的盟约 +3/6」→ 与鸿雪 986 同口径：自身全部所属盟约、
//     未激活也加，不挑层数最高者）—— prep 事件，
//     走 garrisons/meta.js 自定义处理器 act2autochess_gar_eff_990_a/b（SERVER_GAIN），本 kit（战斗侧）不含它。

import { num, talentBb, skillRec, traitBb, moduleOn, batMod } from '../shared/tier1.js';

const S1 = 'skchr_yuki_1';
const S2 = 'skchr_yuki_2';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};

export default {
  chess_char_3_97_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);          // 重型手里剑（仅精英 2）：base_attack_time / atk
    const hasTrait = Array.isArray(chess?.talents) && chess.talents.length > 0;
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2);
    const modOn = moduleOn(chess);
    const tb = traitBb(chess);              // ART-Y stage1 特性追加: def_penetrate_fixed（模组特性并入 trait bb）

    const s1Spec = {
      kind: 'duration',
      duration: skillRec(chess, S1)?.duration ?? 25,
      targeting: { rangeExtend: num(b1.ability_range_forward_extend, 2) },
    };
    const s2Spec = {
      kind: 'duration',
      duration: skillRec(chess, S2)?.duration ?? 25,
    };

    return {
      skill: s2Spec,                        // 默认技能 = S2 凝武（数据 defaultSkillIndex 1）
      skills: { [S1]: s1Spec },             // 只列非默认技能
      talents: [{
        install(battle, unit) {
          // ---- T1 重型手里剑（精英 2）：攻击间隔 +0.2s、攻击力 +20% ----
          if (hasTrait) {
            const atk = num(t0.atk, 0.2), bat = num(t0.base_attack_time, 0);
            const mods = {};
            if (atk) mods.atkPct = atk;
            if (bat) mods.batPct = batMod(bat, chess);   // flat 秒 → 引擎的间隔百分比换算
            if (mods.atkPct || mods.batPct) battle.addBuff(unit, { key: 'talent:yuki:shuriken', persist: true, visible: true, allowDead: true, mods });
          }
          // ---- 模组 ART-Y stage1：攻击时无视敌人 100 点防御力 ----
          const pen = modOn ? num(tb.def_penetrate_fixed, 0) : 0;
          if (pen > 0) battle.addBuff(unit, { key: 'module:yuki:pen', persist: true, visible: true, allowDead: true, mods: { defIgnoreFlat: pen } });
        },
      }],
      install(battle, unit) {
        // ---- S2 凝武（非默认技能，运行中的每次命中附加减速 + 法术 DoT）----
        const ms = num(b2['attack@move_speed'], -0.25);
        const scale = num(b2['attack@atk_scale'], 0.6);
        const dur = num(b2['attack@duration'], 1);
        if (!(dur > 0)) return;
        // 溅射半径缩小为 0.75（PRTS ※）—— 技能运行期间改写 profile（op-turdus profile.heal 同款写法）
        const enter = () => {
          const p = unit.profile;
          unit.mem.yukiSplash = p?.splashRadius;
          if (p) p.splashRadius = 0.75;
        };
        const leave = () => {
          const r = unit.mem.yukiSplash;
          if (r != null && unit.profile) unit.profile.splashRadius = r;
          unit.mem.yukiSplash = null;
        };
        battle.on('skillStart', (c) => { if (c.unit === unit && c.skill?.id === S2) enter(); }, { owner: unit });
        battle.on('skillEnd', (c) => { if (c.unit === unit) leave(); }, { owner: unit });
        // 命中附带的减速 + 法术 DoT（每秒 attack@atk_scale × ATK，持续 attack@duration）
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.target || c.target.side !== 'enemy') return;
          if (!(unit.skill?.active && unit.skill.id === S2)) return;
          const t = c.target;
          const d = c.dmg;
          if (!d || d.cancel || d.type === 'element' || !t.alive) return;
          if (Array.isArray(d.tags) && d.tags.includes('yukiDot')) return;   // DoT 自不再挂（防递归）
          const atk = unit.s.atk;
          battle.addBuff(t, {
            key: 'skill:yuki:dart', duration: dur, interval: 1, source: unit, visible: true,
            mods: { moveMul: Math.max(0, 1 + ms) },
            data: { atk: atk * scale },
            onTick: ({ battle: b, unit: x, buff }) => {
              if (!x.alive) return;
              b.dealDamage(unit, x, { amount: buff.data.atk, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'yukiDot'] });
            },
          });
        }, { owner: unit });
      },
    };
  },
};
