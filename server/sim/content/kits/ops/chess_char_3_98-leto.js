// server/sim/content/kits/ops/chess_char_3_98-leto.js — 烈夏 (char_194_leto) kit, tier 3 (自定义, 2026-10-12).
// Kit contract and rules: ../README.md. 5★ 领主 (lord, professions.js SUB.lord: 可对空、近身 1.0 / 远程 0.8)。
// 数值全部来自官方数据表 blackboard；技能/天赋/模组描述来自 PRTS 烈夏。
//   - 形态：普通 _a = E1 Lv60 / rank 4 / 无模组；精锐 _b = E2 Lv55 / rank 7 / LOR-Y 旧衣服 stage 1（tier 3）。
//     默认技能 S2（chess.json defaultSkillIndex 1）。
//   - T1 快点快点！（E1 +10 / E2 +21；本数据版本 bb 24 为精二值，talentBb 按相位解析）：开启技能时，
//     【乌萨斯学生自治团】干员攻击速度 +X，持续至技能结束（她的 skillStart 触发、skillEnd 撤销）。
//   - S1 迅捷打击·γ型（共享，非默认）：ATK / ASPD +（blackboard）。
//   - S2 一呼百应（默认）：ATK +115%，额外攻击一个目标，远程攻击不再降低攻击力（技能期间 profile.rangedScale=1）；
//     施放时立刻使技能就绪的【乌萨斯学生自治团】干员同时开启技能（def.raw.teamId 'student'，skill.activate free）。
//   - 模组 LOR-Y 旧衣服（精锐 stage1，数据承载 attr {atk40,def25} + 特性追加「攻击范围内存在2名及以上敌人时
//     攻击速度+12」）：0.1s 周期按初始攻击范围判定敌人数（PRTS ※每隔0.1秒判定）。
//   - 干员自身效果【采集单第 8 项】学生代表（garrison_987）：<获得干员时>获得 1（普通）/ 2（精锐）个道具 ——
//     这是**获得（prep）事件**，走 garrisons/meta.js 的自定义处理器 act2autochess_gar_eff_987_a/b（SERVER_GAIN，
//     按获得形态的 _a/_b 各自触发），本 kit（战斗侧）不含它。

import { num, talentBb, skillRec, moduleBb } from '../shared/tier1.js';

const S1 = 'skcom_quickattack[3]';
const S2 = 'skchr_leto_2';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** 【乌萨斯学生自治团】: character_table teamId `student` — data/chess.json 不载 teamId，用 charId 名单（与早露 kit 同源）。 */
const STUDENTS = new Set(['char_196_sunbr', 'char_115_headbr', 'char_194_leto', 'char_405_absin', 'char_195_glassb',
  'char_197_poca', 'char_1051_headb2']);
const isStudent = (a) => !!a && a.kind === 'op' && STUDENTS.has(a.def?.charId);

export default {
  chess_char_3_98_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2);

    const s2Spec = {
      kind: 'duration',
      mods: { atkPct: num(b2.atk, 1.15) },
      targeting: { maxTargets: 1 + Math.max(1, Math.floor(num(b2['attack@max_target'], 1))) }, // 额外攻击一个目标
      onStart({ battle, unit }) {
        // 远程攻击不再降低攻击力（技能期间）
        unit.profile.rangedScale = 1;
        // 立刻使技能就绪的【乌萨斯学生自治团】干员同时开启技能（就绪 = ready 且未在技能期间；免费激活不消耗她的 SP）
        for (const a of battle.allyUnits) {
          if (a === unit || !isStudent(a)) continue;
          const sk = a.skill;
          if (!sk || sk.active || sk.kind === 'passive' || !sk.ready) continue;
          sk.activate('skill', { free: true });
        }
      },
      onEnd({ battle, unit, skill }) {
        delete unit.profile.rangedScale; // 复原 → SUB.lord 的 0.8
        // 快点快点！的攻速 buff「持续至技能结束」
        for (const a of battle.allyUnits) {
          const b = a.findBuff('talent:leto:students');
          if (b && b.source === unit) battle.removeBuff(a, b);
        }
      },
    };
    const s1Spec = { kind: 'duration', mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) } };

    return {
      skill: s2Spec,                       // 默认技能（S2）只写顶层 skill
      skills: { [S1]: s1Spec },
      install(battle, unit) {
        // ---- T1 快点快点！----
        const aspd = num(t0.attack_speed, num(t0.value, 0));
        if (aspd > 0) {
          battle.on('skillStart', (c) => {
            if (c.unit !== unit) return;
            for (const a of battle.allyUnits) {
              if (!isStudent(a) || !a.alive || !a.deployed) continue;
              battle.addBuff(a, { key: 'talent:leto:students', duration: (skill_timeLeft(c.skill) || 1e9) + 0.1, mods: { aspd }, tags: ['talent'], source: unit });
            }
          }, { owner: unit });
        }
        // ---- 模组 LOR-Y 特性追加：范围内 ≥2 名敌人 → 攻速+12（0.1s 周期判定，PRTS ※）----
        const lor = num(moduleBb(chess).attack_speed, 0);   // LOR-Y 特性追加（模组 bb attack_speed）
        if (lor > 0) {
          battle.every(0.1, () => {
            if (!unit.alive || !unit.deployed) return;
            const cnt = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).length;
            const cur = unit.findBuff('trait:leto:lor');
            if (cnt >= 2 && !cur) battle.addBuff(unit, { key: 'trait:leto:lor', duration: 0.15, mods: { aspd: lor }, tags: ['trait'] });
            else if (cnt < 2 && cur) battle.removeBuff(unit, cur);
          }, { owner: unit });
        }
      },
    };
  },
};

/** The running skill's remaining time (for「持续至技能结束」的 buff 时长）。 */
function skill_timeLeft(skill) {
  return skill && skill.isTimed && Number.isFinite(skill.timeLeft) ? skill.timeLeft : null;
}
