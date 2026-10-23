// server/sim/content/kits/ops/chess_char_5_99-veen.js — 维伊 (char_4226_veen) kit, tier 5 (自定义, 2026-10-12).
// Kit contract and rules: ../README.md. 机制与自选 kit op-veen.js（同一干员的 DIY 版）逐条同源，仅按预设棋子契约
// 改写；op-veen.js 于本批退役（维伊转预设棋）。形态：普通 _a = E2 Lv1 / rank 4 / 无模组；精锐 _b = E2 Lv55 /
// rank 7 / MSC-Y 军械库 stage 1（tier 5）。默认技能 S3（chess.json defaultSkillIndex 2）。
// 数值全部来自官方数据表 blackboard；PRTS 维伊 备注（能量储存/转置能量/战争技艺/S2 S3 细则）见 op-veen.js 头注存档。
//   - 干员自身效果【采集单第 8 项】奥术共鸣（garrison_985）：【乌萨斯】+【奥术】**已激活**盟约层数每合计满 3 层 →
//     攻击力 +1%（普通）/ +2%（精锐）；未激活的不纳入统计（2026-10-13 用户修订，0.5s 周期重读）。

import { num, up, talentBb, moduleBb, traitBb, skillRec, batMod, toggleBuff } from '../shared/tier1.js';
import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skchr_veen_1';
const S2 = 'skchr_veen_2';
const S3 = 'skchr_veen_3';
const ANY = Object.freeze({ canHitFly: true });
/** 用赤铁铭记 备注 "弹射间隔0.5，弹射半径1.7". */
const BOUNCE_IV = 0.5;
const BOUNCE_R = 1.7;
const S2_STACK = 'veen:s2stack';

/** 干员自身效果（奥术共鸣）：读的盟约与每 3 层的攻击力加成（0.5s 周期重读）。 */
const RESONANCE_BONDS = ['ursusShip', 'arcaneShip'];
const RESONANCE_KEY = 'talent:veen:resonance';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const warKey = (unit) => `veen:war:${unit.id}`;
const marked = (unit, e) => !!e.findBuff(warKey(unit));
const skillOn = (unit, id) => !!(unit.skill && unit.skill.active && unit.skill.id === id);
/**
 * Her stored energies (per deployment): `s` stored, `t` 转置能量, `q` the volleys in flight per target, `use` the S3 bullets of
 * the attack just made, `k` the S2 stacks.
 */
const stateOf = (unit) => unit.trait.veen ?? (unit.trait.veen = { s: 0, t: 0, q: new Map(), use: 0, k: 0 });

/** Enemies she may pick: in her range (or blocked by her), none under her 战争技艺. */
function validTargets(battle, unit, prof) {
  const cands = battle.enemiesInKeys(unit.rangeKeys, unit, prof);
  for (const e of battle.blockedTargets(unit, prof)) if (!cands.includes(e)) cands.push(e);
  return cands.filter((e) => !marked(unit, e));
}

export default {
  chess_char_5_99_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const t1 = talentBb(chess, 1);
    const tb = traitBb(chess);
    const hidden = moduleBb(chess);   // MSC-Y: attack_speed
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const merge = Math.max(1, Math.floor(num(tb.merge_cnt, 3)));
    const tMax = Math.max(1, Math.floor(num(tb.times, 9) / merge));
    const war = { dur: num(t1['attack@duration']), value: num(t1['attack@value']), max: Math.max(1, Math.floor(num(t1['attack@max_stack_cnt'], 1))) };
    const s2 = { atk: num(b2['attack@veen_s_2_buff[stack].atk']), aspd: num(b2['attack@veen_s_2_buff[stack].attack_speed']), max: Math.max(0, Math.floor(num(b2['attack@veen_s_2_buff[stack].max_stack_cnt']))) };

    /** 战争技艺: `n` stacks on `e`. */
    function warOn(battle, unit, e, n) {
      if (!e || !e.alive || !(war.value > 0) || !(war.dur > 0) || !(n > 0)) return;
      battle.addBuff(e, {
        key: warKey(unit), duration: war.dur, refresh: 'stack', stacks: Math.min(n, war.max), maxStacks: war.max, source: unit,
        interval: 1, data: { value: war.value },
        onTick: ({ battle: b, unit: t, buff }) => { b.dealDamage(unit, t, { amount: buff.data.value * buff.stacks, type: 'arts', canDodge: false, tags: ['talent', 'dot', 'veenWar'] }); },
      });
    }
    /** S2: `n` more stacks (a released shot). */
    function s2Stack(battle, unit, n) {
      if (!skillOn(unit, S2) || !(s2.max > 0)) return;
      const v = stateOf(unit);
      v.k = Math.min(s2.max, v.k + n);
      battle.addBuff(unit, { key: S2_STACK, mods: { atkPct: s2.atk * v.k, aspd: s2.aspd * v.k }, tags: ['skill'] });
    }
    /** One hit of the volley: `atk` (cached at release) × `scale` arts, then `stacks` of 战争技艺. */
    function hitOnce(battle, unit, t, atk, scale, stacks, attackId, isSkill) {
      battle.dealDamage(unit, t, { amount: atk * scale * unit.s.atkScaleMul, type: 'arts', isAttack: true, isSkill, attackId, tags: ['veen'] });
      warOn(battle, unit, t, stacks);
    }
    /** S3: `n` bounces from `from`, every BOUNCE_IV s, each bounce × the cached `atk`. */
    function bounces(battle, unit, from, n, atk, attackId) {
      const hit = new Set([from]);
      let cur = from;
      const step = (left) => {
        if (left <= 0) return;
        battle.after(BOUNCE_IV, () => {
          const near = battle.enemiesInRadius(cur.x, cur.y, BOUNCE_R).filter((e) => canTargetEnemy(unit, e, ANY));
          let pool = near.filter((e) => !hit.has(e));
          if (!pool.length) pool = near.filter((e) => e !== cur);
          if (!pool.length) pool = near;
          let next = null, bd = Infinity;
          for (const e of pool) {
            const d = hypot(e.x - cur.x, e.y - cur.y);
            if (d < bd - 1e-9 || (Math.abs(d - bd) <= 1e-9 && next && e.spawnSeq < next.spawnSeq)) { bd = d; next = e; }
          }
          if (!next) return;   // nobody within reach: the bounces left are lost
          battle.fx('veenBounce', { x: cur.x, y: cur.y, id: unit.id, target: next.id });
          hit.add(next);
          cur = next;
          battle.dealDamage(unit, next, { amount: atk * num(b3['attack@bounce_atk_scale'], 1) * unit.s.atkScaleMul, type: 'arts', isAttack: true, attackId, tags: ['veen', 'veenBounce'] });
          warOn(battle, unit, next, 1);
          step(left - 1);
        });
      };
      step(n);
    }
    /** The main bolt of an attack lands on `victim`: every hit of its volley (released in order), then the S3 bounces. */
    function land(battle, unit, victim, attackId, isSkill) {
      const v = stateOf(unit);
      const list = v.q.get(victim.id);
      const rec = list ? list.shift() : null;
      if (list && !list.length) v.q.delete(victim.id);
      if (!rec) { hitOnce(battle, unit, victim, unit.s.atk, 1, 1, attackId, isSkill); return; }
      for (const p of rec.pre) { if (!victim.alive) return; hitOnce(battle, unit, victim, p.atk, p.scale, p.stacks, attackId, isSkill); }
      if (!victim.alive) return;
      hitOnce(battle, unit, victim, rec.main.atk, rec.main.scale, 1, attackId, isSkill);
      if (rec.main.bounces > 0) bounces(battle, unit, victim, rec.main.bounces, rec.main.atk, attackId);
      for (const p of rec.post) { if (!victim.alive) return; hitOnce(battle, unit, victim, p.atk, p.scale, p.stacks, attackId, isSkill); }
    }

    const s3Spec = {
      kind: 'ammo',
      ammo: num(b3['attack@trigger_time'], 1),
      mods: { aspd: num(b3.attack_speed) },
      // bullets: 1 per stored energy, merge_cnt per 转置能量 the attack released (none without)
      onAttack(ctx) {
        ctx.noAmmo = true;
        const { battle, unit, skill } = ctx;
        const v = stateOf(unit);
        const n = v.use;
        v.use = 0;
        for (let i = 0; i < n && skill.active; i++) {
          skill.ammoLeft--;
          battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
          if (skill.ammoLeft <= 0) skill.end('ammo');
        }
      },
    };
    return {
      skill: s3Spec,   // 默认技能（S3）只写顶层 skill
      trait: {
        hitsFn: () => 0,   // the volley's hits are the kit's (land)
        onEachHit(battle, unit, victim, hc) { if (hc.kind === 'main' && victim && victim.side === 'enemy') land(battle, unit, victim, hc.attackId, !!hc.isSkill); },
        // only enemies under her 战争技艺 in range: no valid target — she holds her fire (and stores energy)
        canAttack(battle, u) { return validTargets(battle, u, u.profile).length > 0; },
        // the mystic store (the shared profile calls it at her attack check with no valid target — professions.js
        // installMystic: an attack action, the interval restarts): one energy, 3 merge into a 转置能量; none once the
        // 转置能量 are at their cap (a full store: she idles)
        storeEnergy(battle, unit) {
          const v = stateOf(unit);
          if (v.t >= tMax) return false;
          if (++v.s >= merge) { v.s -= merge; v.t++; }
          return true;
        },
        install(battle, unit) {
          battle.on('deploy', (ctx) => { if (ctx.unit === unit) unit.trait.veen = null; }, { owner: unit });
          battle.on('death', (ctx) => { if (ctx.unit && ctx.unit.side === 'enemy') stateOf(unit).q.delete(ctx.unit.id); }, { owner: unit });
        },
      },
      skills: {
        [S1]: { kind: 'duration', trigger: { rule: 'SP_FULL' }, mods: { aspd: num(b1.attack_speed) } },
        [S2]: {
          kind: 'duration',
          mods: { batPct: batMod(b2.base_attack_time, chess) },
          onStart({ battle, unit }) { stateOf(unit).k = 0; battle.removeBuff(unit, S2_STACK); },
          onEnd({ battle, unit }) { stateOf(unit).k = 0; battle.removeBuff(unit, S2_STACK); },
        },
      },
      talents: [
        { install(battle, unit) { // “在挥刀之前”: ATK while holding a 转置能量, ASPD while holding none
          const atk = num(t0.atk), aspd = num(t0.attack_speed);
          if (atk) toggleBuff(battle, unit, 'talent:veen:merged', () => stateOf(unit).t > 0, { atkPct: atk });
          if (aspd) toggleBuff(battle, unit, 'talent:veen:unmerged', () => stateOf(unit).t === 0, { aspd });
        } },
        { install(battle, unit) { // 战争技艺: the stacks come with every hit (warOn); she never picks a marked enemy
          battle.on('beforeAttack', (ctx) => {
            if (ctx.attacker !== unit || ctx.targets.every((e) => !marked(unit, e))) return;
            const prof = ctx.profile || unit.profile;
            const cands = validTargets(battle, unit, prof);
            sortEnemyTargets(battle, unit, cands, prof.priority);
            ctx.targets = cands.slice(0, Math.max(1, ctx.targets.length));
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // ---- 干员自身效果：奥术共鸣（无条件安装）----
        // 【乌萨斯】+【奥术】**已激活**盟约层数合计每满 3 层 → 攻击力 +1%/+2%（未激活的不纳入，2026-10-13 用户修订）。
        const resonance = chess?.isGolden ? 0.02 : 0.01;
        battle.every(0.5, () => {
          if (!up(unit)) return;
          const ps = battle.getPlayer?.(unit.ownerId);
          if (!ps) return;
          let total = 0;
          for (const id of RESONANCE_BONDS) {
            const bond = ps.bonds?.[id];
            if (bond?.active) total += Math.max(0, num(bond.layers, 0));
          }
          const atkPct = Math.floor(total / 3) * resonance;
          const cur = unit.findBuff(RESONANCE_KEY);
          if (!(atkPct > 0)) { if (cur) battle.removeBuff(unit, cur); return; }
          if (!cur || cur.mods?.atkPct !== atkPct) {
            battle.addBuff(unit, { key: RESONANCE_KEY, persist: true, allowDead: true, refresh: 'replace', mods: { atkPct }, tags: ['talent'] });
          }
        }, { owner: unit, immediate: true });
        // MSC-Y: ASPD while she holds stored energy
        const msc = num(hidden.attack_speed);
        if (msc) toggleBuff(battle, unit, 'trait:veen:stored', () => { const v = stateOf(unit); return v.s + v.t > 0; }, { aspd: msc });
        // the volley leaves with the attack: 转置能量 → main → stored, each with the ATK of its release (S2 stacks between)
        battle.on('attack', (ctx) => {
          if (ctx.attacker !== unit || !ctx.targets.length) return;
          const v = stateOf(unit);
          const t = v.t, s = v.s;
          v.t = 0; v.s = 0;
          const s3 = skillOn(unit, S3);
          const pre = [], post = [];
          for (let i = 0; i < t; i++) { if (!s3) pre.push({ atk: unit.s.atk, scale: merge, stacks: merge }); s2Stack(battle, unit, merge); }
          const main = { atk: unit.s.atk, scale: s3 ? num(b3['attack@base_atk_scale'], 1) : 1, bounces: s3 ? s + merge * t : 0 };
          s2Stack(battle, unit, 1);
          for (let i = 0; i < s; i++) { if (!s3) post.push({ atk: unit.s.atk, scale: 1, stacks: 1 }); s2Stack(battle, unit, 1); }
          v.use = s3 ? s + merge * t : 0;
          ctx.targets.forEach((tg, i) => {
            const list = v.q.get(tg.id) ?? [];
            list.push(i === 0 ? { pre, main, post } : { pre: [], main: { atk: main.atk, scale: main.scale, bounces: 0 }, post: [] });
            v.q.set(tg.id, list);
          });
          if (t || s) battle.fx('veenVolley', { x: unit.x, y: unit.y, id: unit.id, target: ctx.targets[0].id, stored: s, merged: t });
        }, { owner: unit });
      },
    };
  },
};
