// server/sim/content/kits/ops/chess_char_1_11-skgoat.js — 地灵 (char_183_skgoat) kit, tier 1 (hidden).
// Conventions of the tier-1 kits: ../shared/tier1.js; kit contract and rules: ../README.md.

import { num, talentBb, traitBb, up, enemiesInGrid } from '../shared/tier1.js';

export default {
  // ---------------------------------------------------------------------------------------------------------------
  // 1_11 地灵 攻击力强化·β型 (S1): ATK +atk. Elite 地质勘探: trait 停顿 +sluggish s (module trait 1.2 s included).
  // S2 流沙化: 停止攻击，攻击范围内的敌方单位每 interval 秒停顿 sluggish 秒（blackboard interval 1.8 / sluggish 0.8）。
  chess_char_1_11_a: (bb, chess) => {
    const add = num(talentBb(chess, 0).sluggish);
    const kit = { skill: { kind: 'duration', mods: { atkPct: num(bb.atk) } } };
    if (add > 0) kit.trait = { onHitStatus: { key: 'sluggish', duration: num(traitBb(chess).sluggish, 0.8) + add } };
    // S2 (index 1): a periodic status pulse inside the attack range, and she stops attacking while it runs.
    kit.skills = {
      skchr_skgoat_2: (sbb) => ({
        kind: 'duration',
        noAttack: true,
        install: (battle, unit) => {
          const interval = num(sbb.interval, 1.8);
          const sluggish = num(sbb.sluggish, 0.8);
          battle.every(interval, () => {
            if (!up(unit)) return;
            for (const e of enemiesInGrid(battle, unit, unit.def.rangeGrid ?? null)) {
              battle.addBuff(e, { key: 'sluggish', duration: sluggish, source: unit, tags: ['skill'] });
            }
          }, { owner: unit });
        },
      }),
    };
    return kit;
  },
};
