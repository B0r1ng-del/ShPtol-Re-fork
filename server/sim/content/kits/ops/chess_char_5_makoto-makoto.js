// server/sim/content/kits/ops/chess_char_5_makoto-makoto.js — 结城理 (char_4217_makoto) kit, tier 5.
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md.
//
// A 傀儡师 whose <替身> is not one body but a persona chosen by the skill: 俄耳甫斯 (S1), 塔纳托斯 (S2) or both
// (S3 — 塔纳托斯 first, 俄耳甫斯 instead once the skill is cast or he takes a lethal hit). The <替身> form itself is the
// engine's (professions.js installDollkeeper: the 20 s window, the switch animations, 阻回); this kit only shapes what
// the persona does while it is on, driven by the engine's `dollSwap` switch events (`{ unit, form }`: 'doll' entering,
// null leaving) rather than a hook of its own.
//
// Talents: T1 置换人格 — entering the <替身> form stops every enemy of the trait grid for `sluggish` s, and the persona
// brings ATK +85 %, max HP +35 %, and BAT +0.4 s (a longer attack interval, not a shorter one). T2 总攻击 — leaving the
// <替身> naturally (not by being knocked out, which the garrison counts instead) hits every enemy of the trait grid for
// 450 % ATK **true** damage.
// Modules (PUM-Y 彼此的声音): the elite's extra `trait.bb.max_hp` (+20 %) while a persona stands.
//
// Sources: the official skill/talent blackboards of data/chess.json (S1 1.5/40 %, S2 3 targets / 1.6 / 35 % fear /
// 2.3× execute, S3 +30 ASPD / 1.7 / 25 % heal / 3 targets / +2 block) and the skill texts. Ported from the
// 内容包 source (docs/EXTRA-OPERATORS.md); [ASSUMED]: the persona's range is the trait grid verbatim (the official
// client uses a separate persona range id, and the two agree on the data shipped here).

import { DOLL_SWITCH } from '../../../professions.js';
import { weaknessType, WEAKNESS_PRIORITY } from '../../garrisons/battle.js';

/** The persona the <替身> currently is: 'thanatos' (S2 / S3 first), 'orpheus' (S1 / S3 second), or null outside. */
const S1 = (sid) => sid === 'skchr_makoto_1';
const S2 = (sid) => sid === 'skchr_makoto_2';

/** 俄耳甫斯 / 塔纳托斯: the S3 branch swap has no clip set of its own beyond the persona's (public/js/render FORMS). */
const personaForm = (sid, persona) => (persona === 'thanatos' ? (S1(sid) ? 'makoto_s1' : S2(sid) ? 'makoto_s2' : 'makoto_s3a')
  : S1(sid) ? 'makoto_s1' : S2(sid) ? 'makoto_s2' : 'makoto_s3b');

export default {
  chess_char_5_makoto_a: (bb, chess) => {
    const sid = chess.skill?.skillId ?? null;
    const t0 = chess.talents?.find((t) => t.index === 0)?.bb ?? {};
    const t1 = chess.talents?.find((t) => t.index === 1)?.bb ?? {};
    const grid = chess.trait?.rangeGrid ?? chess.rangeGrid;
    // every skill is the same cast — "立即切换为<替身>状态作战" — and every difference is by skill id. The engine's own
    // `dollSwitch` handler decides whether that starts or ends a <替身> (professions.js installDollkeeper: it no-ops while
    // one already stands, leaving `done` false), and the handler below reads that no-op as S3's 塔纳托斯 → 俄耳甫斯 swap.
    const skill = {
      kind: 'instant',
      onStart({ battle, unit }) {
        battle.emit('dollSwitch', { unit, reason: 'skill', done: false });
      },
    };
    return {
      skills: { skchr_makoto_1: skill, skchr_makoto_2: skill, skchr_makoto_3: skill },
      install(b, u) {
        const bodyProfile = { ...u.profile };
        const bodyRange = u.rangeGrid;
        let persona = null;
        const enemies = (fly = false) => b.unitsInGrid(u, grid, { side: 'enemy' }).filter((e) => fly || !e.isFlying);
        const allies = () => b.unitsInGrid(u, grid, { side: 'ally' }).filter((a) => a.kind === 'op');
        const refresh = () => {
          // the persona's grid is the trait grid (the body's own 2-tile melee range is what the <替身> replaces)
          u.rangeGrid = persona ? grid : bodyRange;
          u.form = persona ? personaForm(sid, persona) : null;
          u.profile = { ...bodyProfile };
          if (!persona) { b.removeBuff(u, 'makoto:persona'); u.markDirty(); b.refreshRange(u); return; }
          b.addBuff(u, {
            key: 'makoto:persona', flags: { silence: true },
            mods: {
              atkPct: t0.atk ?? 0,
              hpPct: (t0.max_hp_t1 ?? 0) + (chess.trait?.bb?.max_hp ?? 0),
              batPct: (t0.base_attack_time ?? 0) / Math.max(1e-6, u.base.bat),
              // only 塔纳托斯's S3 riding ASPD (the S1/S2 blackboards carry no such key)
              aspd: persona === 'thanatos' ? bb['talent@attack_speed'] ?? 0 : 0,
            },
          });
          u.profile.attack = 'ranged';
          u.profile.projectile = 'none';
          u.profile.dmgType = 'arts';
          u.profile.canHitFly = !S1(sid) && !S2(sid);
          u.profile.atkScale = bb['attack@atk_scale'] ?? 1;
          u.profile.maxTargets = S1(sid) ? 1 : bb['attack@max_target'] ?? 1;
          if (S1(sid)) {
            // 俄耳甫斯的竖琴: heals instead of attacking while half-HP ally stands in the trait grid
            u.profile.canAttack = () => {
              const hurt = b.injuredAlliesInKeys(u.rangeKeys, u).some((a) => a.hpRatio <= 0.5);
              u.profile.dmgType = hurt ? 'heal' : 'arts';
              u.profile.heal = hurt ? { mode: 'single', hpAtMost: 0.5 } : null;
              u.profile.atkScale = hurt ? bb['attack@heal_scale'] ?? 1 : bb['attack@atk_scale'] ?? 1;
              return true;
            };
          }
          if (persona === 'orpheus' && !S1(sid)) {
            u.profile.noAttack = true;
            // the branch's zero block is overridden in this S3 form (the normal 2-block is restored)
            const sub = u.findBuff('trait:substitute');
            if (sub) sub.mods.blockCnt = (bb['attack@block_cnt'] ?? 0) - u.base.blockCnt;
          }
          u.markDirty();
          b.refreshRange(u);
        };
        /** 俄耳甫斯's heal pulse: a 0.5 s wind-up, the list frozen at the start (deploy / persona checked again). */
        const healPulse = () => {
          if (!u.alive || !u.deployed || u.trait.dollSwitching || persona !== 'orpheus' || S1(sid)) return;
          const seq = u.deploySeq;
          const list = b.injuredAlliesInKeys(u.rangeKeys, u).slice(0, bb['attack@max_target_heal'] ?? 1);
          b.after(0.5, () => {
            if (!u.alive || !u.deployed || u.deploySeq !== seq || persona !== 'orpheus') return;
            for (const a of list) if (a.alive && a.deployed) b.heal(u, a, u.s.atk * (bb['attack@heal_scale'] ?? 0));
          }, { owner: u });
        };
        /** S3 only: 塔纳托斯 → 俄耳甫斯 on a cast or (below) a lethal hit. A substitute-to-substitute change: the 20 s
         *  window and the garrison count do not restart. */
        const orpheus = () => {
          if (!u.trait.doll || u.trait.dollSwitching || u.findBuff('makoto:changing') || persona !== 'thanatos' || S1(sid) || S2(sid)) return false;
          persona = 'orpheus';
          b.addBuff(u, {
            key: 'makoto:changing', duration: DOLL_SWITCH,
            flags: { invulnerable: true, noSp: true, noHeal: true, isolated: true, disarm: true },
            onExpire: healPulse,
          });
          refresh();
          u.hp = u.s.maxHp;
          b.fx('substitute', { x: u.x, y: u.y, id: u.id, form: u.form });
          return true;
        };
        // the engine's switch event (`{ unit, form }`: 'doll' entering the <替身>, null leaving it)
        b.on('dollSwap', ({ unit, form }) => {
          if (unit !== u) return;
          const doll = form === 'doll';
          persona = doll ? (S1(sid) ? 'orpheus' : 'thanatos') : null;
          refresh();
          if (doll) for (const e of enemies(true)) b.applyStatus(e, 'sluggish', { duration: t0.sluggish ?? 0, source: u });
          // only the natural return triggers 总攻击; a 替身 knocked out uses the death path (the garrison counts both)
          else for (const e of enemies(true)) b.dealDamage(u, e, { amount: u.s.atk * (t1.atk_scale ?? 0), type: 'true', tags: ['talent', 'makotoAllOut'] });
        }, { owner: u });
        // S3: a cast while a persona already stands is the 塔纳托斯 → 俄耳甫斯 swap. The engine's own dollSwitch handler
        // runs first (installDollkeeper, registered before this kit) and no-ops on an existing <替身>, leaving `done`
        // false — that no-op IS the swap signal.
        b.on('dollSwitch', (ctx) => {
          if (ctx.unit !== u || ctx.done) return;
          orpheus();
        }, { owner: u });
        b.on('fatal', (c) => {
          if (c.unit !== u || c.prevented) return;
          if (u.findBuff('makoto:changing') || orpheus()) c.prevented = true;
        }, { owner: u, priority: -90 });
        b.on('hit', (c) => {
          if (c.source === u && c.dmg?.isAttack && persona === 'thanatos' && !S2(sid)) c.dmg.type = weaknessType(u, c.target, c.dmg);
        }, { owner: u, priority: WEAKNESS_PRIORITY });
        b.on('damaged', (c) => {
          if (S2(sid) && persona === 'thanatos' && c.source === u && c.dmg?.isAttack && c.target?.alive && b.rng.chance(bb['attack@prob'] ?? 0)) {
            b.applyStatus(c.target, 'fear', { duration: bb['attack@fear'] ?? 0, source: u });
          }
        }, { owner: u });
        b.every(0.1, () => {
          if (!u.alive || !u.deployed || u.trait.dollSwitching || !persona) return;
          if (S2(sid)) {
            for (const e of enemies(true)) {
              if (e.s.flags.fear && e.hp <= u.s.atk * (bb['attack@kill_atk_scale'] ?? 0)) {
                b.dealDamage(null, e, { amount: bb['attack@kill_damage'] ?? 0, type: 'true', tags: ['execute'] });
              }
            }
          }
          if (persona === 'orpheus' && !S1(sid)) {
            for (const a of allies()) b.addBuff(a, { key: 'makoto:dodge', duration: 0.15, mods: { dodgePhys: bb['attack@prob'] ?? 0, dodgeArts: bb['attack@prob'] ?? 0 }, source: u });
          }
        }, { owner: u });
        b.every(bb['attack@interval'] ?? 1, healPulse, { owner: u });
        b.on('death', ({ unit }) => {
          if (unit !== u) return;
          persona = null;
          refresh();
        }, { owner: u });
      },
    };
  },
};
