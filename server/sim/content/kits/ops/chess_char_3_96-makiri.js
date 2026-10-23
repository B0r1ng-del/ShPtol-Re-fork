// server/sim/content/kits/ops/chess_char_3_96-makiri.js — 松桐 (char_4199_makiri) kit, tier 3 (自定义, 2026-10-17).
// Conventions of the tier-3 kits: ../shared/tier3.js; kit contract and rules: ../README.md. 5★ 先锋 / 策士(counsellor)。
// 数值全部来自官方数据表的 blackboard。本槽位（chess_char_3_96）2026-10-17 由吉星（char_4203_kichi，已下线）改绑松桐。
//   - 形态：普通 _a = E2 Lv1 / rank 4；精锐 _b = E2 Lv60 / rank 7。松桐**没有模组**（chess.moduleId = null，
//     build-data 给精锐形态写一个 inactive 的占位 module，同蒂比 2_13），所以本 kit 不读 moduleBb。
//   - T1 慢手有筹（精英 1 起）：在战场停留 interval(30) 秒后，**仅一次**，使场上所有重装(TANK)与辅助(SUPPORT)干员
//     攻击力 +atk（E2 +10%）。[ASSUMED] 官方文本还含「待部署区」的干员 —— 战斗内没有手牌（手牌属备战侧
//     match 层），故只作用于场上的合格干员；每次（重新）部署各计一次，退场未满 30 秒则不计。
//   - S1 入场安排（非默认，AUTO / spType INCREASE_WITH_TIME）：立即获得 cost(10) 点部署费用。
//     文本里的「使当前待部署区最右边的 N 名干员部署费用 -4」属备战侧（战斗内无手牌）→ 不实现。
//   - S2 万手成局（默认，见 chess.json defaultSkillIndex 1，15 秒）：每 interval(1) 秒补给 cost(1) 点部署费用
//     （全文共 value 15 点），攻击力 +makiri_s_2[passive].atk，每秒回复
//     makiri_s_2[passive].hp_recovery_per_sec_by_max_hp_ratio 比例的最大生命值。
//     文本里的「技能开启时立即使待部署区所有重装与辅助干员费用 -1、最大生命 +max_hp（最多叠 max_stack_cnt 次，
//     持续至下次撤退）」同上（备战侧）→ 不实现。
//   - 干员自身效果特质（garrison_991，2026-10-17 用户口径）：<休整期结束时>使已激活的【东】【远见】盟约层数
//     +5/+10 —— prep 事件，走 garrisons/meta.js 的自定义处理器 act2autochess_gar_eff_991_a/b（bondListLayers，
//     只加已激活者），本 kit（战斗侧）不含它。

import { num, talentBb, skillRec, up } from '../shared/tier1.js';

const S1 = 'skchr_makiri_1';
const S2 = 'skchr_makiri_2';
/** S2 的 blackboard 用了带方括号的复合键（逐字取自 skill_table）。 */
const ATK_KEY = 'makiri_s_2[passive].atk';
const REGEN_KEY = 'makiri_s_2[passive].hp_recovery_per_sec_by_max_hp_ratio';

/** 重装 / 辅助（talent 的付与对象）。 */
const isDefOrSupp = (a) => !!a && a.kind === 'op' && (a.def?.profession === 'TANK' || a.def?.profession === 'SUPPORT');

export default {
  chess_char_3_96_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);          // 慢手有筹：interval / atk
    const b1 = skillRec(chess, S1)?.bb ?? {};
    const b2 = skillRec(chess, S2)?.bb ?? {};
    const hasTalent = Array.isArray(chess?.talents) && chess.talents.length > 0;

    const s1Spec = {
      kind: 'instant', trigger: 'SP_FULL',
      onStart({ battle, unit }) {
        const n = num(b1.cost);
        if (!(n > 0)) return;
        battle.addDp(unit.ownerId, n);
        battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
      },
    };

    const s2Spec = {
      kind: 'duration',
      duration: skillRec(chess, S2)?.duration ?? 15,
      mods: { atkPct: num(b2[ATK_KEY]), hpRegenRatio: num(b2[REGEN_KEY]) },
      onStart({ unit }) { unit.mem.makiriDp = { acc: 0, got: 0 }; },
      onTick({ battle, unit, dt }) {
        const st = unit.mem.makiriDp;
        const iv = num(b2.interval, 1), n = num(b2.cost), total = num(b2.value);
        if (!st || !(iv > 0) || !(n > 0)) return;
        st.acc += dt;
        while (st.acc + 1e-9 >= iv && st.got + n <= total + 1e-9) {
          st.acc -= iv;
          st.got += n;
          battle.addDp(unit.ownerId, n);
        }
      },
      onEnd({ battle, unit, reason }) {
        const st = unit.mem.makiriDp;
        unit.mem.makiriDp = null;
        // 技能自然结束时的最后一跳（与嵯峨 S3 / op-saga 的写法一致）
        const total = num(b2.value);
        if (st && reason === 'duration' && total - st.got > 1e-9) battle.addDp(unit.ownerId, total - st.got);
      },
    };

    return {
      skill: s2Spec,                        // 默认技能 = S2 万手成局（数据 defaultSkillIndex 1）
      skills: { [S1]: s1Spec },             // 只列非默认技能
      talents: [{
        install(battle, unit) {
          // ---- T1 慢手有筹：在战场停留 30 秒后，仅一次，场上所有重装 / 辅助攻击力 +10% ----
          if (!hasTalent) return;
          const iv = num(t0.interval, 30), atk = num(t0.atk, 0.1);
          if (!(iv > 0) || !(atk > 0)) return;
          battle.on('deploy', ({ unit: u }) => {
            if (u !== unit) return;
            const seq = unit.deploySeq;
            battle.after(iv, () => {
              // 退场（或换了一次部署）就不算「停留满 iv 秒」
              if (!up(unit) || unit.deploySeq !== seq) return;
              let n = 0;
              for (const a of battle.allies()) {
                if (!isDefOrSupp(a)) continue;
                battle.addBuff(a, {
                  key: 'talent:makiri:atk', persist: true, allowDead: true, visible: true,
                  refresh: 'replace', source: unit, mods: { atkPct: atk }, tags: ['talent'],
                });
                n++;
              }
              if (n > 0) battle.fx('talent', { x: unit.x, y: unit.y, id: unit.id, name: 'makiri:atk', n });
            }, { owner: unit });
          }, { owner: unit });
        },
      }],
    };
  },
};
