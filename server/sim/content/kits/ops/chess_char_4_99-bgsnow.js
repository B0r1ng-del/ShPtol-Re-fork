// server/sim/content/kits/ops/chess_char_4_99-bgsnow.js — 鸿雪 (char_4055_bgsnow) kit, tier 4 (自定义, 2026-10-12).
// Kit contract and rules: ../README.md. 机制与自选 kit op-bgsnow.js（同一干员的 DIY 版）逐条同源，仅按预设棋子契约
// 改写；op-bgsnow.js 于本批退役（鸿雪转预设棋）。形态：普通 _a = E2 Lv1 / rank 4 / 无模组；精锐 _b = E2 Lv55 /
// rank 7 / ARC-Y 打字机色带 stage 1（tier 4）。默认技能 S3（chess.json defaultSkillIndex 2）。
// 数值全部来自官方数据表 blackboard；PRTS 鸿雪 / “打字机” 备注（{{**|82%|下降18%}}=×0.82、点题的后 2 段为持续伤害、
// 弱点速记的近身提升与周围八格、召唤物生命周期与独立再部署）见 op-bgsnow.js 头注存档。
//   - 干员自身效果【采集单第 8 项】休整犒赏（garrison_986，2026-10-16 用户修订：付与对象「身后」→「身前」）：
//     <休整期结束时>自身和身前干员的所属盟约层数+4/8 ——
//     这是**休整期（prep）事件**，走 garrisons/meta.js 的自定义处理器 act2autochess_gar_eff_986_a/b（SERVER_PREP_FIN），
//     本 kit（战斗侧）不含它。

import { num, up, traitBb, skillRec, batMod } from '../shared/tier1.js';
import { absoluteRangeKeys } from '../../../targeting.js';
import { bodyKeys, bodyInKeys } from '../../../body.js';
import { toLocal } from '../../../dir.js';
/** A unit that still has HP: the old `damage.js hasHp` (deleted in 0.3.2), same as 4_20-fartth.js's `downed`. */
const hasHp = (u) => !!u && u.alive && (u.bossPool ? u.bossPool.hp > 0 : u.hp > 0);
import { COLS } from '../../../constants.js';
import { startCountdown } from '../../tokens.js';

const S1 = 'skchr_bgsnow_1';
const S2 = 'skchr_bgsnow_2';
const S3 = 'skchr_bgsnow_3';
export const TYPEWRITER = 'token_10026_bgsnow_subbow';
const TS1 = 'sktok_bgsnow_1';
const TS2 = 'sktok_bgsnow_2';
const TS3 = 'sktok_bgsnow_3';
/** 锐笔速写's 正前方3格: the 3-2 line (range_table) — her tile and the three ahead. */
const FRONT_3 = Object.freeze([[0, 0], [0, 1], [0, 2], [0, 3]]);
/** 点题's two 持续伤害 hits (PRTS 伤害分类 attackType BUFF). */
const TAG_PRECIS = 'bgsnow:precis';
/** 自动打字机: the typewriter's life when neither the token nor the talent carries it (PRTS: 持续25秒 at E2). */
const LIFE_FALLBACK = 25;

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
/** First talent of a normalised token def holding `key` (token talents keep no index). */
const tokTalent = (def, key) => (def?.talents ?? []).find((t) => t && t.bb && t.bb[key] != null) ?? null;

/** ARC-Y 正前方: the enemy's body touches the unit's straight line ahead (local row 0, local column ≥ 0). */
function inFrontLine(unit, e) {
  for (const k of bodyKeys(e)) {
    const [lr, lc] = toLocal(Math.floor(k / COLS) - unit.tileR, (k % COLS) - unit.tileC, unit.dir);
    if (lr === 0 && lc >= 0) return true;
  }
  return false;
}

/** 点题 / its copy: the two 持续伤害 hits after the attack's first (普通伤害) hit, on the same target. */
function precisFollowUps(battle, unit, target, scale) {
  for (let i = 0; i < 2 && target && target.alive; i++) {
    battle.dealDamage(unit, target, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'dot', TAG_PRECIS] });
  }
}

/** 抑扬格 / its copy: while `on(unit)`, every attack `prob` to deal ×scale (one roll per attack). */
function installIamb(battle, unit, prob, scale, on) {
  if (!(prob > 0) || !(scale > 0) || scale === 1) return;
  battle.on('hit', (ctx) => {
    const d = ctx.dmg, t = ctx.target;
    if (ctx.source !== unit || !t || t.side !== 'enemy' || !d.isAttack || d.isSplash || d.type === 'element' || !on(unit)) return;
    const m = unit.mem;
    if (!d.attackId || m.iambRollId !== d.attackId) {
      m.iambRollId = d.attackId;
      m.iambProc = battle.rng.chance(prob);
      if (m.iambProc) battle.fx('crit', { x: t.x, y: t.y, id: unit.id });
    }
    if (m.iambProc) d.amount *= scale;
  }, { owner: unit });
}

/**
 * The typewriter's kit: its skill (the copy of her skill the data gives), 弱点速记, its life and its redeploys.
 * `owner` = 鸿雪, `chess` = her composed record.
 */
function typewriterKit(t, owner, chess) {
  const def = t.def;
  const sk = def.skill ?? null;
  const tb = sk?.bb ?? {};
  const weak = tokTalent(def, 'duration');
  const wb = weak?.bb ?? {};
  const cut1 = -num(wb['bgsnow_token[def_down]_1.def']), cut2 = -num(wb['bgsnow_token[def_down]_2.def'], -cut1);
  const ring8 = /八格/.test(String(weak?.description ?? ''));
  const ownTalent = (chess?.talents ?? []).find((x) => x && x.index === 0)?.bb ?? {};
  const life = num(tokTalent(def, 'interval')?.bb?.interval, num(ownTalent.duration, LIFE_FALLBACK));
  const respawnMul = owner.skill?.id === S2 ? num(bbOf(chess, S2).respawn_time, 1) : 1;
  const near = () => {
    if (!up(owner)) return false;
    const dr = Math.abs(t.tileR - owner.tileR), dc = Math.abs(t.tileC - owner.tileC);
    return ring8 ? Math.max(dr, dc) === 1 : dr + dc === 1;
  };
  const skillOn = (u) => !!(u.skill && u.skill.active);
  let skill = null;
  if (sk?.id === TS1) skill = { kind: 'toggle', mods: { atkPct: num(tb.atk) } };
  else if (sk?.id === TS2) {
    const scale = num(tb.atk_scale, 1);
    skill = { kind: 'instant', attack: { atkScale: scale, onHit({ battle, unit, target }) { precisFollowUps(battle, unit, target, scale); } } };
  } else if (sk?.id === TS3) {
    skill = {
      kind: 'duration',
      targeting: { rangeGrid: sk.rangeGrid ?? [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4]] },
      mods: { batPct: batMod(tb.base_attack_time, { stats: def.stats }) },
      attack: { atkScale: num(tb['attack@atk_scale'], 1) },
    };
  }
  return {
    skill,
    talents: [{ install(battle, unit) { // 弱点速记: every damage of its attacks cuts the target's DEF (near her: more)
      const dur = num(wb.duration, 4);
      if (!(cut1 > 0) || !(dur > 0)) return;
      battle.on('damaged', (ctx) => {
        if (ctx.source !== unit || !ctx.target || ctx.target.side !== 'enemy' || !hasHp(ctx.target) || ctx.dmg?.type === 'element') return;
        battle.applyStatus(ctx.target, 'defDown', { duration: dur, value: near() ? cut2 : cut1, source: unit });
      }, { owner: unit });
    } }],
    install(battle, unit) {
      if (sk?.id === TS1) installIamb(battle, unit, num(tb.prob), num(tb.atk_scale, 1), skillOn);
      // 持续25秒: leaves `life` s after each deployment — a countdown summon (content/tokens.js startCountdown): 无敌,
      // 禁疗 [ASSUMED], its bar = the life left
      battle.on('deploy', (ctx) => {
        if (ctx.unit !== unit || !(life > 0)) return;
        startCountdown(battle, unit, life);
        const seq = unit.deploySeq;
        battle.after(life, () => { if (unit.alive && unit.deploySeq === seq) battle.retreat(unit, { reason: 'expired', permanent: true }); }, { owner: unit });
      }, { owner: unit });
      // 拥有独立的再部署时间: back on its tile after its redeploy time, paying its cost, while 鸿雪 stands (the piece is kept:
      // `removed` false, as content/tokens.js enableRespawn)
      battle.on('death', (ctx) => {
        if (ctx.unit !== unit || battle.finished) return;
        unit.removed = false;
        const at = battle.time + Math.max(0, num(unit.base.respawnTime) * respawnMul);
        unit.mem.respawnAt = at;
        battle.every(0.25, (b, sched) => {
          if (unit.alive || unit.removed) { sched.cancel(); return; }
          if (b.time + 1e-9 < at || !up(owner)) return;
          if (b.redeploy(unit, { free: false })) sched.cancel();
        }, { owner: unit });
      }, { owner: unit, priority: -10 });
    },
  };
}

export default {
  chess_char_4_99_a: (bb, chess) => {
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2), s3 = skillRec(chess, S3);
    const frontScale = num(traitBb(chess).atk_scale, 1);
    const s2Scale = num(b2.atk_scale, 1);
    const s3Scale = num(b3.atk_scale, 1), s3Front = num(b3['bgsnow_s_3[atk_up].atk_scale'], s3Scale);
    const s3Spec = {
      kind: 'duration',
      targeting: { rangeGrid: s3?.rangeGrid ?? null },
      mods: { batPct: batMod(b3.base_attack_time, chess) },
      attack: { atkScale: s3Scale },
    };
    return {
      skill: s3Spec,   // 默认技能（S3）只写顶层 skill
      skills: {
        [S1]: { kind: 'toggle', mods: { atkPct: num(b1.atk) } },
        [S2]: {
          kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
          // the 3-1 selects the target; her attack range stays her own (a 技能范围, not a range change)
          targeting: { rangeGrid: s2?.rangeGrid ?? null, showOwnRange: true },
          attack: { atkScale: s2Scale, onHit({ battle, unit, target }) { precisFollowUps(battle, unit, target, s2Scale); } },
          onStart({ unit }) { unit.atkCd = 0; }, // "立即": the pending attack goes off now when a target is there
        },
      },
      talents: [
        // 自动打字机 (and 弱点速记, the typewriter's own talent): her typewriter pieces run the typewriter's kit — set up
        // here, before the battle starts (Battle._setupUnit with a kit, as spawnToken's `kit` option)
        { install(battle, unit) {
          for (const t of battle.allyUnits) {
            if (t.kind !== 'token' || t.defId !== TYPEWRITER || t.ownerUnit !== unit || t.alive || t.deployed) continue;
            if (t.kit) battle.offOwner(t); // a piece set up before her: drop its generic kit's hooks
            battle._setupUnit(t, typewriterKit(t, unit, chess));
          }
        } },
      ],
      install(battle, unit) {
        const sid = unit.skill?.id;
        if (sid === S1) installIamb(battle, unit, num(b1.prob), num(b1.atk_scale, 1), (u) => !!u.skill?.active);
        // 锐笔速写: 正前方3格 ⇒ atk_up's scale instead of the skill's
        if (sid === S3 && s3Front !== s3Scale && s3Scale > 0) {
          battle.on('hit', (ctx) => {
            const d = ctx.dmg, t = ctx.target;
            if (ctx.source !== unit || !t || t.side !== 'enemy' || !d.isAttack || !unit.skill?.active) return;
            if (bodyInKeys(t, absoluteRangeKeys(FRONT_3, unit.tileR, unit.tileC, unit.dir, 0))) d.amount *= s3Front / s3Scale;
          }, { owner: unit });
        }
        // ARC-Y 打字机色带: 攻击正前方的敌人时攻击力提升至105%且无视其物理闪避
        if (frontScale > 0 && frontScale !== 1) {
          battle.on('hit', (ctx) => {
            const d = ctx.dmg, t = ctx.target;
            if (ctx.source !== unit || !t || t.side !== 'enemy' || d.type === 'element') return;
            if (!(d.isAttack || d.tags?.includes(TAG_PRECIS)) || !inFrontLine(unit, t)) return;
            d.amount *= frontScale;
            d.canDodge = false;
          }, { owner: unit });
        }
      },
    };
  },
};
