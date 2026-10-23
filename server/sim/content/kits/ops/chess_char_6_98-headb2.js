// server/sim/content/kits/ops/chess_char_6_98-headb2.js — 怒潮凛冬 (char_1051_headb2) kit, tier 6 (自定义).
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.
//
// 6_98(自定义) 怒潮凛冬 — 撼地者 (hammer)。机制与自选 kit op-headb2.js（同一干员的 DIY 版）逐条同源，
// 仅按预设棋子契约改写（默认技能 S3 提到顶层 `skill`；skills 只列 S1/S2）。数值全部来自官方 blackboard：
//   - 形态：普通 _a = E2 Lv1 / rank 4 / 无模组；精锐 _b = E2 Lv60 / rank 7 / HAM-X 迟到的勋章 stage 1
//     （数据承载 {hp250,atk63,def21}）。
//   - 特性（撼地者）50% 溅射：职业层承担（professions.js hammer，trait bb atk_scale_2/ability_range_radius）。
//   - T1 汹涌怒火：特性溅射 ×damage_scale；溅射到的每个高台对周围四格（x-5）地面敌人造成
//     attack@splash_atk_scale × ATK 物理伤害，E2 起附带 0.5s 停顿（attack@sluggish）。
//   - T2 万众巨潮：技能期间全场干员 ATK/DEF +atk/+def，【乌萨斯学生自治团】×scale_bonus。
//   - S1 誓不低头（非默认）：ATK +atk、攻速 +attack_speed，30s。
//   - S2 绝不罢休（非默认，AUTO/SP_FULL）：范围扩大 + ATK/DEF，第二次起翻倍且无限持续；被动：每个高台
//     触发第一天赋回 sp_per_highland 技力。
//   - S3 无可抵挡（默认，见 chess.json defaultSkillIndex 2）：五次锤击（1.8s 间隔、不受攻速影响），每次
//     atk_scale × ATK 且 ATK 额外 +atk_step 叠加；高台溅射 ×3.5、束缚 unmovable 秒、扩散。
//   - 模组 HAM-X：溅射范围内 ≥cnt 个敌人 → 当次攻击 ×atk_scale_e。
//   - 干员自身效果【采集单第 8 项】勇冠三军（2026-10-13 用户修订，替换 2026-10-12 的 4%/8% 物理版）：造成伤害时
//     额外附带自身生命上限 75%（普通）/ 150%（精锐）的**真实伤害**。⚠️ 她自己的干员效果（reason 'op' 由加层方
//     标注；这里只读层）。口径 [ASSUMED]：「生命上限」为自身（沿 2026-10-12 采集口径）；与天赋 damage_scale
//     同区、不受其影响（真实伤害不吃 dmg.mul）；不作用于她造成的元素损伤（她不产生元素损伤）。
//     「已激活/层数」内联读 battle.getPlayer(pid).bonds[id]（kit 禁 import support/index.js ——
//     kits_layout.test.js）。
//
// 机制细节（高台溅射 x-5、锤击帧、扩散）与 [ASSUMED] 项的完整推导见 op-headb2.js 头注，此处不重复。

import { num, talentBb, traitBb, skillRec, up, giveSp } from '../shared/tier1.js';
import { hasHp } from '../../../damage.js';
import { COLS } from '../../../constants.js';
import { sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skchr_headb2_1';
const S2 = 'skchr_headb2_2';
const S3 = 'skchr_headb2_3';
/** PRTS 汹涌怒火 备注: "选择1.0半径内的地块触发溅射（重叠判定）". */
const HIGHLAND_PICK_RADIUS = 1.0;
/** PRTS 汹涌怒火 备注: "伤害溅射范围为周围4格+本格x-5（格子判定）" (symmetric: no rotation). */
const X5 = Object.freeze([[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]);
const HIGHLAND_DELAY = 0.1, S3_SPREAD_STEP = 0.125;
/** The battle skeleton's Skill_3 clip (30 fps): OnAttack at frames 33, 84, 133, 182 and 233. */
const FPS = 30, SKILL3_FRAMES = 277, HAMMER_FRAMES = Object.freeze([33, 84, 133, 182, 233]);
const HAMMER_REACH = 1.0, HAMMER_SPLASH = 1.5;
const STUDENTS = new Set(['char_196_sunbr', 'char_115_headbr', 'char_194_leto', 'char_405_absin', 'char_195_glassb',
  'char_197_poca', 'char_1051_headb2']);
const TIDE_IV = 0.25;
const TIDE_KEY = 'talent:headb2:tide';
const S2_KEY = 'skill:headb2:s2';
const STEP_KEY = 'skill:headb2:step';
const HAMMER_TAG = 'headb2Hammer';
const HIGHLAND_TAG = 'headb2Highland';
const GROUND = Object.freeze({ canHitFly: false });

/** 干员自身效果（勇冠三军）：附带真伤占自身生命上限的比例（普通/精锐）。 */
const RIDER_OF_MAXHP = (golden) => (golden ? 1.5 : 0.75);

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const tagged = (d, tag) => !!d && Array.isArray(d.tags) && d.tags.includes(tag);
const isOp = (a) => !!a && a.kind === 'op';

/** Tile keys of the 高台 (HIGH tiles) whose square the circle of radius `r` around (x, y) touches. */
function highlandsAround(battle, x, y, r = HIGHLAND_PICK_RADIUS) {
  const g = battle.grid, out = [];
  for (let row = Math.floor(y - r); row <= Math.ceil(y + r); row++) {
    for (let col = Math.floor(x - r); col <= Math.ceil(x + r); col++) {
      if (!g.inRect(row, col) || g.tile(row, col).height !== 'HIGH') continue;
      const dx = Math.max(Math.abs(x - col) - 0.5, 0), dy = Math.max(Math.abs(y - row) - 0.5, 0);
      if (dx * dx + dy * dy <= r * r + 1e-9) out.push(row * COLS + col);
    }
  }
  return out;
}
/** The 高台 next to tile key `k` (the spread of S3). */
function highlandNeighbours(battle, k) {
  const r = Math.floor(k / COLS), c = k % COLS, g = battle.grid, out = [];
  for (const [dr, dc] of X5) {
    if (!dr && !dc) continue;
    const rr = r + dr, cc = c + dc;
    if (g.inRect(rr, cc) && g.tile(rr, cc).height === 'HIGH') out.push(rr * COLS + cc);
  }
  return out;
}

export default {
  chess_char_6_98_a: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const s2 = skillRec(chess, S2);
    const splashMul = num(t0.damage_scale, 1);
    const hxScale = num(tb.atk_scale_e, 1), hxCnt = num(tb.cnt, Infinity);
    const hamx = (n) => (hxScale !== 1 && n >= hxCnt ? hxScale : 1);
    const traitShare = num(tb['attack@atk_scale_2'], 0.5);
    
    /** One 高台 taking effect: its x-5 ground enemies take the splash and 停顿 (束缚 during S3). */
    const highlandStrike = (battle, unit, k, atk, s3) => {
      const r = Math.floor(k / COLS), c = k % COLS;
      const keys = [];
      for (const [dr, dc] of X5) if (battle.grid.inRect(r + dr, c + dc)) keys.push((r + dr) * COLS + c + dc);
      const foes = battle.enemiesInKeys(keys, unit, GROUND);
      battle.fx('aoe', { x: c, y: r, radius: 1, id: unit.id, skill: 'headb2:highland' });
      if (!foes.length) return;
      const amount = atk * num(t0['attack@splash_atk_scale']) * (s3 ? num(b3.splash_atk_scale_bonus, 1) : 1) * hamx(foes.length);
      for (const e of foes) {
        if (!e.alive) continue;
        battle.dealDamage(unit, e, { amount, type: 'phys', isSplash: true, canDodge: false, sourceless: true, isProjectile: true, tags: [HIGHLAND_TAG] });
        if (!e.alive) continue;
        if (s3) battle.applyStatus(e, 'bind', { duration: num(b3.unmovable, 1), source: unit });
        else if (num(t0['attack@sluggish']) > 0) battle.applyStatus(e, 'sluggish', { duration: num(t0['attack@sluggish']), source: unit });
      }
    };
    /** A round of 汹涌怒火's 高台 splashes centred on (x, y) — see op-headb2.js for the S2 SP rider and the spread. */
    const highlandRound = (battle, unit, x, y, depth = 0) => {
      const tiles = highlandsAround(battle, x, y);
      if (!tiles.length) return;
      const seq = unit.deploySeq, atk = unit.s.atk;
      const s3 = !!(unit.skill?.active && unit.skill.id === S3);
      const sp = unit.skill?.id === S2 ? num(b2.sp_per_highland) : 0;
      const seen = new Set(tiles);
      const trigger = (k, step) => {
        if (sp > 0) giveSp(unit, sp);
        battle.after(step > 0 && s3 ? S3_SPREAD_STEP : HIGHLAND_DELAY, () => {
          if (!(unit.alive && unit.deployed && unit.deploySeq === seq)) return;   // 离场: the round stops
          highlandStrike(battle, unit, k, atk, s3);
          if (step >= depth) return;
          for (const nb of highlandNeighbours(battle, k)) if (!seen.has(nb)) { seen.add(nb); trigger(nb, step + 1); }
        }, { owner: unit });
      };
      for (const k of tiles) trigger(k, 0);
    };
    /** S3 hammer `k` (1-based): centred 1.0 ahead, a main target on the tile ahead if any, the 1.5 splash, the 高台 round. */
    const hammer = (battle, unit, k) => {
      const [fr, fc] = unit.fwd;
      const cx = unit.x + fc * HAMMER_REACH, cy = unit.y + fr * HAMMER_REACH;
      const tr = unit.tileR + fr, tc = unit.tileC + fc;
      let main = null;
      if (battle.grid.inRect(tr, tc)) {
        const cands = battle.enemiesInKeys([tr * COLS + tc], unit, unit.profile);
        sortEnemyTargets(battle, unit, cands, unit.profile?.priority ?? null);
        main = cands[0] ?? null;
      }
      const around = battle.foesInRadius(cx, cy, HAMMER_SPLASH, true).filter((e) => e !== main && !e.isFlying);
      const atk = unit.s.atk, scale = num(b3.atk_scale, 1) * hamx((main ? 1 : 0) + around.length);
      battle.fx('aoe', { x: cx, y: cy, radius: HAMMER_SPLASH, id: unit.id, skill: 'headb2:hammer' });
      if (main && main.alive) battle.dealDamage(unit, main, { amount: atk * scale, type: 'phys', isSkill: true, tags: ['skill', HAMMER_TAG] });
      for (const e of around) {
        if (!e.alive) continue;
        battle.dealDamage(unit, e, { amount: atk * scale * traitShare, type: 'phys', isSkill: true, isSplash: true, mul: splashMul, tags: ['skill', HAMMER_TAG] });
      }
      highlandRound(battle, unit, cx, cy, k - 1);
    };

    const s1Spec = { kind: 'duration', mods: { atkPct: num(b1.atk), aspd: num(b1.attack_speed) } };
    const s2Spec = {
      kind: 'toggle',
      trigger: { rule: 'SP_FULL' },
      targeting: { rangeGrid: s2?.rangeGrid ?? null },
      onStart({ battle, unit, skill }) {
        const later = (unit.mem.headb2S2Casts ?? 0) >= 1;
        unit.mem.headb2S2Casts = (unit.mem.headb2S2Casts ?? 0) + 1;
        const atk = later ? num(b2['headb2_s_2[second].atk']) : num(b2.atk);
        const def = later ? num(b2['headb2_s_2[second].def']) : num(b2.def);
        battle.addBuff(unit, { key: S2_KEY, mods: { atkPct: atk, defPct: def }, tags: ['skill'] });
        skill.timeLeft = later ? Infinity : Math.max(0.01, skill.duration);
      },
      onTick({ skill, dt }) {
        if (!Number.isFinite(skill.timeLeft)) return;
        skill.timeLeft -= dt;
        if (skill.timeLeft <= 1e-9) skill.end('duration');
      },
      onEnd({ battle, unit }) { battle.removeBuff(unit, S2_KEY); },
    };
    const s3Spec = {
      kind: 'duration',
      duration: SKILL3_FRAMES / FPS,
      mods: { atkPct: num(b3.atk_base) },
      attack: { noAttack: true },
      onStart({ battle, unit, skill }) {
        const n0 = skill.activations, seq = unit.deploySeq, step = num(b3.atk_step);
        let done = 0;
        for (const f of HAMMER_FRAMES) {
          battle.after(f / FPS, () => {
            if (!(unit.alive && unit.deployed && unit.deploySeq === seq && skill.active && skill.activations === n0)) return;
            if (!unit.canAct) return;   // a hammer due while she cannot act is lost [ASSUMED]
            hammer(battle, unit, done + 1);
            done++;
            if (step) battle.addBuff(unit, { key: STEP_KEY, mods: { atkPct: step * done }, tags: ['skill'] });
          }, { owner: unit });
        }
      },
      onEnd({ battle, unit }) { battle.removeBuff(unit, STEP_KEY); },
    };

    return {
      // 默认技能放顶层 `skill`（content/index.js selectSkillSpec：默认技能绝不能同时进 skills 映射）。
      skill: s3Spec,                                  // 默认技能 = 无可抵挡（数据 defaultSkillIndex 2）
      skills: { [S1]: s1Spec, [S2]: s2Spec },         // 只列非默认技能

      talents: [
        { install(battle, unit) { // 汹涌怒火: the trait splash ×damage_scale (the 高台 rounds: trait.afterHit and the hammers)
          if (splashMul === 1) return;
          battle.on('hit', (c) => {
            const d = c.dmg;
            if (c.source === unit && d.isAttack && d.isSplash && !tagged(d, HAMMER_TAG)) d.mul *= splashMul;
          }, { owner: unit });
        } },
        { install(battle, unit) { // 万众巨潮: every operator of the field ATK / DEF + while a skill of hers runs (students ×)
          const a = num(t1.atk), d = num(t1.def), x = num(t1.scale_bonus, 1);
          if (!a && !d) return;
          const inSkill = () => !!(unit.skill && unit.skill.active && unit.skill.kind !== 'passive');
          const give = () => {
            if (!up(unit) || !inSkill()) return;
            for (const o of battle.alliesFor(unit)) {
              if (!isOp(o)) continue;
              const k = STUDENTS.has(o.def?.charId) ? x : 1;
              const cur = o.findBuff(TIDE_KEY);
              if (cur && cur.source !== unit && (cur.data?.v ?? 0) > a * k && cur.timeLeft > 0.05) continue;
              battle.addBuff(o, { key: TIDE_KEY, duration: TIDE_IV + 0.1, mods: { atkPct: a * k, defPct: d * k }, source: unit, data: { v: a * k }, tags: ['aura'] });
            }
          };
          battle.every(TIDE_IV, give, { owner: unit });
          battle.on('skillStart', (c) => { if (c.unit === unit) give(); }, { owner: unit });
          battle.on('skillEnd', (c) => {
            if (c.unit !== unit) return;
            for (const o of battle.allyUnits) { const b = o.findBuff(TIDE_KEY); if (b && b.source === unit) battle.removeBuff(o, b); }
          }, { owner: unit });
        } },
      ],
      // 汹涌怒火's 高台 round after each attack, centred on its target
      trait: { afterHit: (battle, unit, target, hctx) => { if (unit.alive && unit.deployed) highlandRound(battle, unit, hctx.x, hctx.y); } },
      install(battle, unit) {
        // ---- 干员自身效果：勇冠三军（无条件安装，先于模组分支）----
        // 造成伤害时额外附带自身生命上限 4%（普通）/ 8%（精锐）的物理伤害。附加段自带 tag 并在钩子里跳过自己
        // （否则 dealDamage 再触发 'damaged' 无限递归，hookDepth>32 报错——同 op-poca 附加段的写法）。
        const rider = unit.s.maxHp * RIDER_OF_MAXHP(chess?.isGolden);
        battle.on('damaged', (c) => {
          if (c.source !== unit || !c.target || c.target.side !== 'enemy') return;
          const d = c.dmg;
          if (!d || d.type === 'element' || d.cancel || d.tags?.includes('headb2Rider') || !hasHp(c.target)) return;
          if (!(rider > 0)) return;
          battle.dealDamage(unit, c.target, { amount: rider, type: 'phys', tags: ['headb2Rider'] });
        }, { owner: unit });

        // S2: the cast count of a deployment [ASSUMED per deployment]
        battle.on('deploy', (c) => { if (c.unit === unit) unit.mem.headb2S2Casts = 0; }, { owner: unit });
        // HAM-X: ≥ cnt ground enemies in the splash range of the attack's target ⇒ ×atk_scale_e on each of its instances
        if (hxScale === 1) return;
        battle.on('hit', (c) => {
          const d = c.dmg;
          if (c.source !== unit || !d.isAttack || !d.attackId || tagged(d, HAMMER_TAG)) return;
          const m = unit.mem;
          if (m.headb2HamxId !== d.attackId) {
            // the first instance of an attack is its target's (ai.js resolveHit: the main hit, then the splash)
            const t = c.target;
            m.headb2HamxId = d.attackId;
            m.headb2HamxMul = hamx(1 + battle.foesInRadius(t.x, t.y, unit.profile?.splashRadius || 1, true).filter((e) => e !== t && !e.isFlying).length);
          }
          d.amount *= m.headb2HamxMul ?? 1;
        }, { owner: unit, priority: 5 });
      },
    };
  },
};
