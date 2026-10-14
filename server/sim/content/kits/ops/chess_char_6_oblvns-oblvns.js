// server/sim/content/kits/ops/chess_char_6_oblvns-oblvns.js — 丰川祥子 (char_4182_oblvns) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.
//
// 领主 (lord: ranged attacks at 80 % ATK — professions.js) whose every attack is a homing note rather than a shot, and
// whose three skills are the three ways of playing them: S1 eight notes of a falling scale as one charge-throw, S2 a
// piano / organ timbre toggle, S3 both timbres at once, each tracking the enemies that resist it most.
//
// 音符 (notes) live in the battle's projectile list (`unit.mem.sakikoNotes`), so they keep flying after the attack that
// fired them, are pruned one `T1 delay` s after they leave her range, and each standing note gives every 颂歌 (Ave
// Mujica) member DEF / RES penetration (T1) — the count is the `sakiko:notes` buff.
//
// Fever: one shared counter per player (450 points, +`T2 cnt` per damage instance she deals). Reaching it on a cast
// opens a 20 s window during which S3 is extended and kept free, S2 fires twice, and S3's lethal hit is survived until
// the window closes (then she leaves). FEVER_* are the two window constants.
//
// Sources: the official skill/talent blackboards of data/chess.json (S1 atk_scale 0.65 → 0.04 ×8, S2 +60 % ATK / +80
// ASPD, S3 1.55 ×2 phys + ×2 arts, T1 delay 1 s / 3 % DEF / 2 % RES / 10 notes, T2 +3 Fever / +16 ASPD in range) and
// the skill texts. Ported from the 内容包 source (docs/EXTRA-OPERATORS.md). [ASSUMED]: notes fly straight at their
// target (the official client's curved trajectories and random launch angles are not modelled), and every note is
// fired at once in a volley rather than spread over the cast.

import { canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';

/** Fever: the shared counter's cap, the window it opens, and the seconds one S1 cast re-arms it for. */
const FEVER_MAX = 450;
const FEVER_WINDOW = 20;
/** S1: number of notes one cast plays, and the blackboard keys of their falling scale (`atk_scale`, `atk_scale_2` …). */
const S1_NOTES = 8;
const S1_SCALE = (bb, i) => (i === 1 ? bb.atk_scale : bb[`atk_scale_${i}`]) ?? 0;

const live = (u) => !!u && u.alive && u.deployed && !u.hidden;

export default {
  chess_char_6_oblvns_a: (bb, chess) => {
    const sid = chess.skill?.skillId ?? null;
    const t0 = chess.talents?.find((t) => t.index === 0)?.bb ?? {};
    const t1 = chess.talents?.find((t) => t.index === 1)?.bb ?? {};
    const moduleOn = !!chess.module?.active;
    const maxNotes = Math.max(1, t0.max_cnt ?? 1);
    let shoot = () => {};
    let isFever = () => false;

    // S1 (充能2次, "充能至最大层数时自动释放"): one cast = the whole eight-note scale, the timbre of the moment
    const s1Skill = {
      kind: 'charges', trigger: 'NEVER',
      onStart({ battle, unit }) {
        for (let i = 1; i <= S1_NOTES; i++) shoot('arts', S1_SCALE(bb, i));
        if (isFever()) battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'fever' });
      },
    };
    // S2 (自动释放时切换音色): 钢琴 = +ATK, 风琴 = +ASPD; the timbre buff persists until the next cast
    const s2Skill = {
      kind: 'instant',
      onStart({ battle, unit }) {
        unit.mem.sakikoOrgan = !unit.mem.sakikoOrgan;
        battle.addBuff(unit, {
          key: 'sakiko:timbre', persist: true, visible: true,
          mods: unit.mem.sakikoOrgan ? { aspd: bb['attack@attack_speed'] ?? 0 } : { atkPct: bb['attack@attack'] ?? 0 },
        });
      },
    };
    // S3 (ACTIVE_RANGE, duration): both timbres, and the skill's own 20 s window is suspended while Fever runs
    const s3Skill = {
      kind: 'duration',
      targeting: { rangeGrid: chess.skill?.rangeGrid ?? undefined },
      onStart({ unit }) { unit.mem.sakikoFeverNew = isFever(); },
      onTick({ skill, dt }) { if (isFever()) skill.timeLeft += dt; },
    };
    const skill = sid === 'skchr_oblvns_1' ? s1Skill : sid === 'skchr_oblvns_2' ? s2Skill : s3Skill;

    return {
      skills: { skchr_oblvns_1: s1Skill, skchr_oblvns_2: s2Skill, skchr_oblvns_3: s3Skill },
      skill,
      install(b, u) {
        u.profile.noAttack = true;          // her attacks are the notes the kit fires, not the lord's arrow
        u.mem.sakikoNotes = [];
        /** One Fever counter per player, shared by every 祥子 of that player. */
        const state = (b._sakikoFever ??= new Map());
        if (!state.has(u.ownerId)) state.set(u.ownerId, { value: 0, until: 0 });
        const fever = state.get(u.ownerId);
        let next = 0;
        let repeat = 0;
        let wasFever = false;
        const activeFever = () => fever.until > b.time;
        isFever = activeFever;

        /** The notes still inside her range (the rest are on their way out and expire one `delay` after leaving). */
        const prune = () => {
          for (const p of u.mem.sakikoNotes) {
            const inside = u.rangeKeySet.has(Math.round(p.y) * b.grid.cols + Math.round(p.x));
            if (inside) p._sakikoExitAt = null; else p._sakikoExitAt ??= b.time;
            if (p._sakikoExitAt != null && b.time - p._sakikoExitAt >= (t0.delay ?? 1)) b.projectiles.list = b.projectiles.list.filter((q) => q !== p);
          }
          u.mem.sakikoNotes = u.mem.sakikoNotes.filter((p) => b.projectiles.list.includes(p));
          return Math.min(maxNotes, u.mem.sakikoNotes.length);
        };

        const foes = (unit) => {
          const list = b.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true }).filter((e) => canTargetEnemy(unit, e, { canHitFly: true }));
          sortEnemyTargets(b, unit, list, unit.profile.priority);
          return list;
        };
        /** Fire one note: a homing projectile carrying the ATK the moment it left (PRTS: 音符伤害采用发射时攻击力). */
        shoot = (type = 'phys', scale = 1, priority = null) => {
          if (!live(u)) return;
          const list = foes(u);
          if (priority) list.sort((a, z) => z.s[priority] - a.s[priority]);
          const e = list[0];
          const seq = u.deploySeq;
          const skillShot = sid === 'skchr_oblvns_2' || u.skill?.active;
          // 无言的约定: a module note is a skill note and ignores the trait's ranged penalty
          const moduleSkill = moduleOn && skillShot;
          const rangedMul = e && !moduleSkill ? (u.profile.dmgMul?.(b, u, e) ?? 1) : 1;
          const amount = u.s.atk * scale * rangedMul;
          const p = b.addProjectile({
            from: u, target: e, to: e ? undefined : { x: u.x + u.fwd[1] * 4, y: u.y + u.fwd[0] * 4 },
            speed: sid === 'skchr_oblvns_2' && u.mem.sakikoOrgan ? 2 : 4,
            visual: type === 'arts' ? 'bolt' : 'arrow', source: u, maxAge: 5,
            onHit({ target }) {
              if (target && live(u) && u.deploySeq === seq) {
                b.dealDamage(u, target, { amount, type, isAttack: true, isSkill: sid === 'skchr_oblvns_3' && u.skill.active, tags: ['sakikoNote'] });
              }
            },
          });
          u.mem.sakikoNotes.push(p);
        };

        const reset = () => {
          u.mem.sakikoOrgan = false;
          u.mem.sakikoFallen = false;
          next = b.time;
          b.removeBuff(u, 'sakiko:timbre');
          if (sid === 'skchr_oblvns_2') b.addBuff(u, { key: 'sakiko:timbre', persist: true, mods: { atkPct: bb['attack@atk'] ?? 0 } });
        };
        reset();
        b.on('deploy', ({ unit }) => { if (unit === u) reset(); }, { owner: u });
        // 孤行者的低语 T2: every damage instance she deals feeds the shared Fever counter
        b.on('damaged', (c) => {
          if (c.source === u && c.amount > 0 && !activeFever()) fever.value = Math.min(FEVER_MAX, fever.value + (t1.cnt ?? 0));
        }, { owner: u });
        b.on('skillStart', ({ unit }) => {
          if (unit === u && fever.value >= FEVER_MAX && !activeFever()) {
            fever.value = 0;
            fever.until = b.time + FEVER_WINDOW;
            b.fx('buff', { x: u.x, y: u.y, id: u.id, kind: 'fever' });
          }
        }, { owner: u });
        // S3's 致命伤 survival: only inside the Fever window, and it ends when the window does
        b.on('fatal', (c) => {
          if (c.unit === u && !c.prevented && sid === 'skchr_oblvns_3' && u.skill?.active && activeFever()) {
            c.prevented = true;
            u.hp = 1;
            u.mem.sakikoFallen = true;
            b.addBuff(u, { key: 'sakiko:feverSurvival', duration: fever.until - b.time, flags: { invulnerable: true, noHeal: true } });
          }
        }, { owner: u, priority: -80 });

        b.every(0.05, () => {
          if (!live(u)) return;
          const f = activeFever();
          if (wasFever && !f) {
            if (sid === 'skchr_oblvns_3' && u.skill?.active && u.mem.sakikoFeverNew) u.skill.end('fever');
            if (u.mem.sakikoFallen) { u.mem.sakikoFallen = false; b.kill(u); return; }
          }
          wasFever = f;
          if (f && sid === 'skchr_oblvns_3' && !u.skill?.active) u.skill.activate('fever', { free: true });
          if (f && sid === 'skchr_oblvns_1' && b.time >= repeat) { repeat = b.time + 1; u.skill.activate('fever', { free: true }); }
          // S1's "充能至最大层数时自动释放一次" — the kit owns the cast (trigger NEVER)
          if (sid === 'skchr_oblvns_1' && !f && u.skill?.charges === u.skill.maxCharges && b.time >= u.skill.opReadyAt && u.canAct && !u.s.flags.silence) {
            u.skill.activate('fullCharges');
          }
          // 无言的约定 (the module's 「攻击范围内存在2名及以上敌人时攻击速度+12」) is NOT installed here: the clause is the
          // engine's own (`server/sim/content/traitMods.js` traitAttackSpeedRule → crowdInRange), which reads the folded
          // `trait.bb.attack_speed`, counts through the engine's targeting and refuses to double-apply. A hand-written copy
          // here would be a second owner of one stat (test/sim/trait_attack_speed.test.js pins the closed list).
          const notes = prune();
          b.addBuff(u, {
            key: 'sakiko:notes', duration: 0.1,
            mods: { defIgnorePct: notes * (t0.def_penetrate_ratio ?? 0), resIgnorePct: notes * (t0.magic_resist_penetrate_ratio ?? 0) },
          });
          for (const a of b.alliesInGrid(u).filter((a) => a.kind === 'op')) {
            b.addBuff(a, { key: 'sakiko:tempo', duration: 0.1, mods: { aspd: t1.attack_speed ?? 0 } });
          }
          if (u.s.flags.stun || u.s.flags.disarm || u.s.flags.sleep || b.time < next) return;
          next = b.time + u.s.interval;
          u.stats.attacks++;
          u.lastAttackAt = b.time;
          if (sid === 'skchr_oblvns_3' && u.skill?.active) {
            // 各自追踪法抗最高和防御最高的敌人: two phys notes on the highest DEF, two arts notes on the highest RES
            for (let n = 0; n < 2; n++) { shoot('phys', bb['attack@atk_scale'] ?? 1, 'def'); shoot('arts', bb['attack@atk_scale'] ?? 1, 'res'); }
          } else {
            const twice = sid === 'skchr_oblvns_2' && f;
            const type = sid === 'skchr_oblvns_2' && u.mem.sakikoOrgan ? 'arts' : 'phys';
            for (let n = 0; n < (twice ? 2 : 1); n++) shoot(type);
          }
          const targets = foes(u).slice(0, 1);
          if (targets.length) b._ev(['atk', u.id, targets[0].id, 'none']);
          if (b._hooks.attack) b.emit('attack', { attacker: u, targets, isSkill: sid === 'skchr_oblvns_3' && !!u.skill?.active });
          u.skill?.onAttackPerformed(targets, sid === 'skchr_oblvns_3' && !!u.skill?.active);
        }, { owner: u });
      },
    };
  },
};
