// server/sim/content/kits/ops/chess_char_2_98-botany.js — 伯塔尼 (char_4223_botany) kit, tier 2 (自定义).
// Conventions of the tier-2 kits: ../shared/tier2.js; kit contract and rules: ../README.md.
//
// 2_98(自定义) 伯塔尼 — 巫役 (ritualist)。数值全部来自官方数据表的 blackboard，此处不写死：
//   - 形态：普通 _a = E1 Lv60 / 技能 rank 4 / 无模组；精锐 _b = E2 Lv55 / rank 7 / RIT-X stage 1
//     （数据承载 {hp95,atk24}）。
//   - 特性（巫役）「攻击造成法术伤害，可以造成元素损伤」：数据 dmgType 'arts' + 元素伤害管线承担，
//     本 kit 不重复实现。
//   - T1 背弃沉默（精英 1 起，_a bb attack_speed 5 / potBelow 4；_b 7 / potBelow 6）：攻击范围内有敌人
//     侵蚀损伤爆发时攻速 +attack_speed，最多 max_stack_cnt(3) 层 —— 元素爆发事件 elementBurst（nymph T2
//     先例），爆发目标在她当前攻击范围内（bodyInKeys，op-phatm2 先例）。
//   - S1 谐波破坏（自动回复·自动触发，默认，见 chess.json defaultSkillIndex 0）：下次攻击 atk_scale × ATK
//     法术伤害并附带 ep_damage_ratio × ATK 侵蚀损伤；若目标未受到侵蚀损伤（侵蚀量谱为空且不在爆发冷却
//     [ASSUMED]）则额外造成 botany_s1_extra.atk_scale × ATK 法术伤害与 botany_s1_extra.ep_damage_ratio ×
//     ATK 侵蚀损伤。额外判定在自身侵蚀附伤之前取值（自己的附伤不能解锁自己的额外段）。
//   - S2 静域回声（自动回复·手动触发，非默认，30s）：攻击范围扩大（数据 rangeGrid），同时攻击
//     attack@max_target 个目标；每次攻击额外附带 attack@extra_atk_scale × ATK 物理伤害与
//     attack@ep_damage_ratio × ATK 侵蚀损伤（'hit' 钩子挂附加段，技能运行中生效）；范围内敌人侵蚀损伤
//     爆发冷却恢复 +attack@ep_break_recover_speed（爆发锁 buff timeLeft −= dt × recover，op-phatm2 S3 先例
//     [ASSUMED: 恢复速度为加算比例]）。
//   - 模组 RIT-X（精锐）「对精英和领袖敌人造成的元素损伤提升18%」（trait bb ep_damage_scale）：
//     她 'elementHit' 的 mul ×ep_damage_scale（pithst 同一特性的乘算口径）。
//   - 干员自身效果【采集单第 8 项】乌萨斯齐鸣：每次开启技能时（S1/S2 均触发 —— skillStart），攻击范围内
//     每有 1 名【乌萨斯】干员（def.raw.nationId 'ursus'，op-closur 先例；含她自己），使已激活的【乌萨斯】
//     层数 +3（普通）/ +6（精锐）层（2026-10-17 用户修订：原为【乌萨斯】【助力】各 +2/+4 → 收窄为仅
//     【乌萨斯】并改为 +3/+6）；每场战斗最多经此叠加 12（普通）/ 24（精锐）层（同批修订：8/16→12/24）
//     [ASSUMED: 上限按盟约各自计]；**需盟约已激活才叠层**（2026-10-11 用户确认），未激活的
//     盟约不提供层数；reason 'op'。「已激活」判定内联读 battle.getPlayer(pid).bonds[id].active
//     （kit 禁 import support/index.js —— kits_layout.test.js）。

import { num, talentBb, traitBb, skillRec, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';
import { bodyInKeys } from '../../../body.js';
import { hasHp } from '../../../damage.js';

const S1 = 'skchr_botany_1';
const S2 = 'skchr_botany_2';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const isUrsus = (a) => !!a && a.kind === 'op' && (a.def?.raw?.nationId ?? a.def?.nationId) === 'ursus';
const isElite = (e) => !!e && (e.isBoss || e.def?.rank === 'ELITE' || e.def?.rank === 'BOSS');
/** 目标「未受到侵蚀损伤」：侵蚀量谱为空且不在侵蚀爆发冷却 [ASSUMED]。 */
const erosionFree = (t) => !!t && !t.findBuff('erosionBurst') && !((t.elem?.erosion ?? 0) > 0);
/** `a`（含她自己）是否在 `unit` 当前攻击范围内（rangeKeySet 缺失时按不在计）。 */
const inRangeOf = (unit, a) => !!(unit.rangeKeySet && a && Number.isInteger(a.tileR) && Number.isInteger(a.tileC)
  && unit.rangeKeySet.has(a.tileR * COLS + a.tileC));

/** 干员自身效果：开启技能时每个范围内【乌萨斯】干员给的层数 / 本场上限（普通 / 精锐）。
 *  2026-10-17 用户修订：加层目标收窄为仅【乌萨斯】（原【乌萨斯】【助力】），+2/4→+3/6、8/16→12/24。 */
const CRY_BOND = 'ursusShip';

export default {
  chess_char_2_98_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1);
    const b2 = bbOf(chess, S2);
    const s2rec = skillRec(chess, S2);
    const epScale = num(tb.ep_damage_scale, 1);
    const cryPer = chess?.isGolden ? 6 : 3;   // 每次开启技能每名【乌萨斯】加的层数（2026-10-17 用户修订：2/4→3/6）
    const cryCap = chess?.isGolden ? 24 : 12; // 每场上限（2026-10-17 用户修订：8/16→12/24）

    // S1 谐波破坏（默认）：下次攻击 + 侵蚀附伤 + 条件额外段
    const s1Spec = {
      kind: 'instant',
      attack: {
        atkScale: num(b1.atk_scale, 1),
        dmgType: 'arts',
        onHit({ battle, unit, target }) {
          if (!target || !target.alive || !hasHp(target)) return;
          const atk = unit.s.atk;
          // 「未受到侵蚀损伤」在自身附伤之前判定（先判额外段，再上附伤）
          const free = erosionFree(target);
          if (free) {
            const exAtk = num(b1['botany_s1_extra.atk_scale']), exEp = num(b1['botany_s1_extra.ep_damage_ratio']);
            if (exAtk > 0) battle.dealDamage(unit, target, { amount: atk * exAtk, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'botany'] });
            if (exEp > 0) battle.dealDamage(unit, target, { type: 'element', element: 'erosion', amount: atk * exEp, tags: ['skill', 'botany'] });
          }
          const ep = num(b1.ep_damage_ratio);
          if (ep > 0) battle.dealDamage(unit, target, { type: 'element', element: 'erosion', amount: atk * ep, tags: ['skill', 'botany'] });
        },
      },
    };
    // S2 静域回声（非默认）：范围扩大 + 攻 2 目标 + 爆发冷却加速（每次攻击的附加段在 install 的 'hit' 钩子）
    const recover = num(b2['attack@ep_break_recover_speed']);
    const s2Spec = {
      kind: 'duration',
      targeting: { rangeGrid: s2rec?.rangeGrid ?? null, maxTargets: Math.max(1, Math.floor(num(b2['attack@max_target'], 1))) },
      onTick({ battle, unit, dt }) {
        if (!(recover > 0) || !unit.rangeKeySet) return;
        for (const e of battle.enemies) {
          if (!e.alive || e.hidden || !bodyInKeys(e, unit.rangeKeySet)) continue;
          const lock = e.findBuff('erosionBurst');
          if (lock && Number.isFinite(lock.timeLeft)) lock.timeLeft -= dt * recover;
        }
      },
    };

    return {
      // 默认技能放顶层 `skill`（content/index.js selectSkillSpec：默认技能绝不能同时进 skills 映射）。
      skill: s1Spec,                                  // 默认技能 = 谐波破坏（数据 defaultSkillIndex 0）
      skills: { [S2]: s2Spec },                       // 只列非默认技能

      talents: [{
        install(battle, unit) {
          // ---- 干员自身效果：乌萨斯齐鸣（无条件安装，先于天赋/模组分支）----
          // 开启技能时（S1/S2 均触发）：范围内每个【乌萨斯】干员 → 已激活的【乌萨斯】+3/+6 层，
          // 每场战斗最多 12/24 层（unit.mem 记账，跨部署累计 —— unit 是每场战斗的作用域）。
          battle.on('skillStart', (c) => {
            if (c.unit !== unit || unit.ownerId == null || !up(unit)) return;
            unit.mem = unit.mem || {};
            const ps = battle.getPlayer?.(unit.ownerId);
            if (!ps) return;
            const n = battle.allyUnits.filter((a) => a !== unit ? (a.alive && a.deployed && !a.hidden && isUrsus(a) && inRangeOf(unit, a)) : true).length;
            if (!(n > 0)) return;
            const st = ps.bonds?.[CRY_BOND];
            if (!st || !st.active) return;             // 「需盟约已激活才叠层」（2026-10-11 用户确认）
            const used = num(unit.mem.botanyCryUrsus, 0);
            const add = Math.min(n * cryPer, Math.max(0, cryCap - used));
            if (!(add > 0)) return;
            const got = battle.addLayers(unit.ownerId, CRY_BOND, add, 'op', { source: unit });
            if (got > 0) unit.mem.botanyCryUrsus = used + got;
          }, { owner: unit });

          // ---- T1 背弃沉默：范围内敌人侵蚀损伤爆发 → 攻速叠层（≤3）----
          const as = num(t0.attack_speed), maxStacks = Math.max(1, Math.floor(num(t0.max_stack_cnt, 3)));
          if (as > 0) {
            battle.on('elementBurst', (c) => {
              if (c.element !== 'erosion' || c.target?.side !== 'enemy' || !up(unit) || !unit.rangeKeySet) return;
              if (!bodyInKeys(c.target, unit.rangeKeySet)) return;
              battle.addBuff(unit, { key: 'talent:botany:aspd', refresh: 'stack', maxStacks, mods: { aspd: as }, tags: ['talent'] });
            }, { owner: unit });
          }

          // ---- 模组 RIT-X（精锐）：对精英/领袖敌人的元素损伤 ×ep_damage_scale ----
          if (epScale !== 1) {
            battle.on('elementHit', (ctx) => {
              if (ctx.source !== unit || ctx.dmg?.type !== 'element' || ctx.target?.side !== 'enemy') return;
              if (!isElite(ctx.target)) return;
              ctx.dmg.mul *= epScale;
            }, { owner: unit });
          }
        } }],
      // S2 运行中的每次攻击附加段（额外物理 + 侵蚀）——放 install：与所选技能无关，只在 S2 运行时生效
      install(battle, unit) {
        const extraAtk = num(b2['attack@extra_atk_scale']), extraEp = num(b2['attack@ep_damage_ratio']);
        if (!(extraAtk > 0) && !(extraEp > 0)) return;
        battle.on('hit', (c) => {
          if (c.source !== unit || !c.target || c.target.side !== 'enemy') return;
          if (!(unit.skill?.active && unit.skill.id === S2)) return;
          const d = c.dmg;
          if (!d || d.cancel || d.type === 'element' || !hasHp(c.target)) return;
          if (Array.isArray(d.tags) && d.tags.includes('botany')) return;   // 附加段自己不再挂附加段（防递归）
          const atk = unit.s.atk;
          if (extraAtk > 0) battle.dealDamage(unit, c.target, { amount: atk * extraAtk, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'botany'] });
          if (extraEp > 0) battle.dealDamage(unit, c.target, { type: 'element', element: 'erosion', amount: atk * extraEp, tags: ['skill', 'botany'] });
        }, { owner: unit });
      },
    };
  },
};
