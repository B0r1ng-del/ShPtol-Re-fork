// server/sim/content/kits/ops/chess_char_5_97-saga.js — 嵯峨 (char_362_saga) kit, tier 5 (自定义, 2026-10-13).
// Conventions of the tier-5 kits: ../shared/tier5.js; kit contract and rules: ../README.md. 6★ 尖兵 (先锋, pioneer)。
// 机制逐条同源自选 kit op-saga.js（2026-10-13 嵯峨转预设后已删除，推导记录见 git 历史），仅按预设棋子契约改写
// （默认技能 S3 提到顶层 `skill`；skills 只列 S1/S2）。数值全部来自官方 blackboard；机制细节与 [ASSUMED] 项：
//   - 形态：普通 _a = E2 Lv1 / rank 4 / 无模组；精锐 _b = E2 Lv60 / rank 7 / SOL-X 何处寻驮？ stage 1
//     （tier 5 惯例；SOL-X stage1 = 阻挡敌人时攻击力和防御力各 +8%，由数据承载 → traitBb）。
//   - T1 劝善：自身伤害不致命（≤1 点）+ 目标 ≤1 点时附加重伤（击杀者回 2 技力）；不攻击重伤单位（skipEnemy）。
//   - T2 清明：生命值低于 hp_ratio 时（每次部署一次）获得 prob 物理闪避与每秒回 6% 生命，持续 duration。
//   - S1 冲锋号令·γ型（非默认，AUTO）：+cost 部署费用。
//   - S2 除恶（非默认，2 充能）：+cost 部署费用；十字范围最多 6 名地面敌人 atk_scale × ATK 物理伤害，0.7s 后
//     检测击杀其中重伤单位（killer 嵯峨）。
//   - S3 怒目（默认，见 chess.json defaultSkillIndex 2）：持续回费、间隔 +0.5、距离 +1、ATK +atk、同时攻击阻挡
//     的所有敌人、目标低于 attack@hp_ratio 追加一次攻击。
//   - 干员自身效果【采集单第 8 项】同门切磋（garrison_989，2026-10-16 用户修订：单血线 70%，+12/24，
//     只加**已激活**的自身盟约 —— 加层目标回到第三次口径）：自身和身前的干员获得特质 —— 每场战斗生命值首次
//     降低至 70% 以下时，使**该干员自身所属盟约中已激活者** +12/24。⚠️ 她自己的干员效果（reason 'op' 由加层方标注）。
//     口径 [ASSUMED]：部署时判定身前干员（身前无干员则只授予自身）；每来源独立记账（与缠丸的特质互不占用）。

import { num, talentBb, moduleBb, traitBb, skillRec, toggleBuff, batMod, giveSp, up } from '../shared/tier1.js';
import { absoluteRangeKeys, canTargetEnemy, sortEnemyTargets } from '../../../targeting.js';

const S1 = 'skcom_charge_cost[3]';
const S2 = 'skchr_saga_2';
const S3 = 'skchr_saga_3';
/** The 重伤 buff (gamedata_const ba.dying): one per enemy — "重伤期间的单位无法再被施加重伤". */
export const DYING = 'saga:dying';
/** S2 除恶 备注 "攻击附加延迟检测Buff：0.7s后进行检测" (no blackboard key). */
export const S2_CHECK = 0.7;
/** S2 除恶 "对十字范围内最多6名地面敌人" — the text's number when it cannot be read (no blackboard key). */
const S2_MAX = 6;
/** The x-6 cross (skill range) when the data carries no grid. */
const X6 = Object.freeze([[2, 0], [1, 0], [0, -2], [0, -1], [0, 0], [0, 1], [0, 2], [-1, 0], [-2, 0]]);
/** 除恶's selection: ground enemies only ("地面敌人"), 重伤 ones included (no skipEnemy). */
const GROUND = Object.freeze({ canHitFly: false, groundOnly: true });

/** 干员自身效果（同门切磋）：血线加层数值（普通形态 / 精锐形态）：70% 线 → +12/24（2026-10-16 用户修订）。 */
const TH = (golden) => (golden ? 24 : 12);

/** Is `e` 重伤 (whoever put it there)? */
export const isDying = (e) => !!(e && typeof e.findBuff === 'function' && e.findBuff(DYING));

/**
 * 重伤 on enemy `e` from `saga` (PRTS 术语释义 重伤): move speed ×(1 + ms), unblockable (禁用近战), 禁疗, no HP regeneration;
 * a forced, 无来源 death `life` s later — never while 消失, at once when it comes back from 消失. The killer of a 重伤
 * enemy gets `sp` SP (the talent's kill hook reads `data.sp`). Nothing when it already holds one.
 */
function applyDying(battle, saga, e, { sp, life, ms }) {
  if (!e || !e.alive || isDying(e)) return;
  battle.addBuff(e, {
    key: DYING, source: saga, visible: true,
    mods: { moveMul: Math.max(0, 1 + ms), hpRegen: -1e9 },
    flags: { unblockable: true, healFree: true, noHeal: true },
    data: { sp, until: battle.time + life, hidden: !!e.hidden },
    onTick: ({ battle: b, unit: x, buff }) => {
      const d = buff.data;
      if ((d.hidden && !x.hidden) || (!x.hidden && b.time + 1e-9 >= d.until)) { b.kill(x, null); return; }
      d.hidden = !!x.hidden;
    },
  });
  battle.fx('dying', { x: e.x, y: e.y, id: e.id, from: saga.id });
}

export default {
  chess_char_5_97_a: (bb, chess) => {
    const b1 = skillRec(chess, S1)?.bb ?? {}, b2 = skillRec(chess, S2)?.bb ?? {}, b3 = skillRec(chess, S3)?.bb ?? {};
    const s2 = skillRec(chess, S2);
    const t0 = talentBb(chess, 0);   // 劝善: move_speed, sp, interval
    const t1 = talentBb(chess, 1);   // 清明: hp_ratio, hp_recovery_per_sec_by_max_hp_ratio, prob, duration
    const hidden = moduleBb(chess);  // SOL-X stage 2+: hp_ratio, damage_scale; SOL-Y: runtime_cost (no effect)
    const tb = traitBb(chess);       // SOL-X: atk, def while blocking
    const maxHit = Math.max(1, Math.floor(num(/最多(\d+)名/.exec(String(s2?.desc ?? ''))?.[1], S2_MAX)));
    const golden = !!chess?.isGolden;
    const th = TH(golden);
    /** 干员的所属盟约（chess 记录 bonds，data/chess.json 直挂字段）。 */
    const ownBonds = (u) => (Array.isArray(u.def?.bonds) ? u.def.bonds : Array.isArray(u.def?.raw?.bonds) ? u.def.raw.bonds : []);
    /** 同门切磋的血线判定：生命首次降到 70% 以下（每场战斗一次；mem 键带本特质前缀，多来源互不占用）。
     *  加层只落**已激活**的自身盟约（2026-10-13 第五次修订：加层目标回到已激活口径；内联读 bonds[id].active）。 */
    const thresholdLayers = (battle, target) => {
      const mem = target.mem = target.mem || {};
      if (mem.sagaTrait70 || !(target.hp < target.s.maxHp * 0.7) || target.ownerId == null) return;
      mem.sagaTrait70 = true;
      const player = battle.getPlayer(target.ownerId);
      const bonds = ownBonds(target).filter((id) => player?.bonds?.[id]?.active);
      for (const id of bonds) battle.addLayers(target.ownerId, id, th, 'op', { source: target });
    };

    const s3Spec = {
      kind: 'duration',
      mods: { atkPct: num(b3.atk), batPct: batMod(b3.base_attack_time, chess) },
      targeting: { rangeExtend: num(b3.ability_range_forward_extend) },
      attack: { hitAllBlocked: true },
      onStart({ unit }) { unit.mem.sagaDp = { acc: 0, got: 0 }; },
      onTick({ battle, unit, dt }) {
        const st = unit.mem.sagaDp;
        const iv = num(b3.interval, 1), n = num(b3.cost), total = num(b3.value);
        if (!st || !(iv > 0) || !(n > 0)) return;
        st.acc += dt;
        while (st.acc + 1e-9 >= iv && st.got + n <= total + 1e-9) {
          st.acc -= iv;
          st.got += n;
          battle.addDp(unit.ownerId, n);
        }
      },
      onEnd({ battle, unit, reason }) {
        const st = unit.mem.sagaDp;
        unit.mem.sagaDp = null;
        // the last grant falls on the very end of its 20 s
        if (st && reason === 'duration' && num(b3.value) - st.got > 1e-9) battle.addDp(unit.ownerId, num(b3.value) - st.got);
      },
    };
    const s1Spec = {
      kind: 'instant', trigger: 'SP_FULL',
      onStart({ battle, unit }) {
        const n = num(b1.cost);
        battle.addDp(unit.ownerId, n);
        battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
      },
    };
    const s2Spec = {
      kind: num(s2?.maxChargeTime, 1) > 1 ? 'charges' : 'instant',
      onStart({ battle, unit }) {
        const n = num(b2.cost);
        battle.addDp(unit.ownerId, n);
        battle.fx('dp', { x: unit.x, y: unit.y, n, id: unit.id });
        const keys = absoluteRangeKeys(s2?.rangeGrid ?? X6, unit.tileR, unit.tileC, unit.dir, 0);
        const list = battle.enemiesInKeys(keys, unit, GROUND);
        sortEnemyTargets(battle, unit, list, unit.profile?.priority ?? null);
        const hit = list.slice(0, maxHit);
        battle.fx('aoe', { x: unit.x, y: unit.y, radius: 2, id: unit.id, skill: 'saga:cleanse', n: hit.length });
        for (const e of hit) {
          battle.dealDamage(unit, e, { amount: unit.s.atk * num(b2.atk_scale, 1), type: 'phys', isSkill: true, tags: ['saga:s2'] });
          if (!e.alive) continue;
          battle.addBuff(e, {
            key: 'saga:s2check', refresh: 'independent', maxStacks: 99, duration: S2_CHECK, source: unit,
            onExpire: ({ battle: b, unit: x }) => {
              if (!x.alive || !isDying(x)) return;
              b.kill(x, unit);
              if (x.alive) b.removeBuff(x, DYING);
            },
          });
        }
      },
    };

    return {
      // 默认技能放顶层 `skill`（content/index.js selectSkillSpec：默认技能绝不能同时进 skills 映射）。
      skill: s3Spec,                                  // 默认技能 = 怒目（数据 defaultSkillIndex 2）
      skills: { [S1]: s1Spec, [S2]: s2Spec },         // 只列非默认技能
      // 劝善 "嵯峨不攻击重伤单位"
      trait: { skipEnemy: isDying },
      talents: [
        { install(battle, unit) { // 劝善
          const sp = num(t0.sp), life = num(t0.interval, 10), ms = num(t0.move_speed, -0.8);
          // "自身造成的伤害不会致命（至多使目标生命值降至1点）" — before any other saver: it never was lethal
          battle.on('fatal', (c) => {
            if (c.source === unit && c.unit && c.unit.side === 'enemy' && !c.prevented) c.prevented = true;
          }, { owner: unit, priority: 100 });
          // "成功造成伤害后若目标生命值小于等于1则为目标附加重伤"
          battle.on('damaged', (c) => {
            const e = c.target;
            if (c.source !== unit || !e || e.side !== 'enemy' || !e.alive || e.bossPool || c.type === 'element' || e.hp > 1) return;
            applyDying(battle, unit, e, { sp, life, ms });
          }, { owner: unit });
          // "被击杀后使击杀者回复数点技力" — the killer of a 重伤 enemy she marked (none for the 无来源 natural death)
          battle.on('kill', (c) => {
            const d = c.victim && typeof c.victim.findBuff === 'function' ? c.victim.findBuff(DYING) : null;
            if (!d || d.source !== unit || !c.killer || c.killer.side !== 'ally') return;
            giveSp(c.killer, num(d.data?.sp));
          }, { owner: unit });
          // SOL-X stage 2+: "对生命值低于一半的单位造成的伤害提升15%"
          const hr = num(hidden.hp_ratio), ds = num(hidden.damage_scale, 1);
          if (hr > 0 && ds !== 1) {
            battle.on('hit', (c) => {
              if (c.source === unit && c.target && c.target.side === 'enemy' && c.target.hpRatio < hr) c.dmg.mul *= ds;
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 清明: once per deployment below hp_ratio — dodgePhys prob, hpRegenRatio, `duration` s
          const hr = num(t1.hp_ratio), p = num(t1.prob), regen = num(t1.hp_recovery_per_sec_by_max_hp_ratio), dur = num(t1.duration);
          if (!(hr > 0) || !(dur > 0)) return;
          battle.on('damaged', (c) => {
            if (c.target !== unit || !up(unit) || unit.mem.qingmingAt === unit.deploySeq) return;
            if (!(unit.hp < unit.s.maxHp * hr)) return;
            unit.mem.qingmingAt = unit.deploySeq;
            battle.addBuff(unit, { key: 'talent:saga:qingming', duration: dur, mods: { dodgePhys: p, hpRegenRatio: regen }, visible: true, tags: ['talent'] });
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'saga:qingming' });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // SOL-X 何处寻驮？: 阻挡敌人时攻击力和防御力各+8％
        const ma = num(tb.atk), md = num(tb.def);
        if (ma || md) toggleBuff(battle, unit, 'trait:saga:block', () => unit.blocking.length > 0, { atkPct: ma, defPct: md });
        // 怒目: one more attack on each target below attack@hp_ratio (checked before the hit) — a forced attack a tick later
        const hp3 = num(b3['attack@hp_ratio']);
        if (hp3 > 0) {
          let half = null;
          battle.on('beforeAttack', (c) => {
            if (c.attacker !== unit || unit.mem.sagaExtra || !unit.skill?.active || unit.skill.id !== S3) return;
            half = (c.targets || []).filter((e) => e && e.side === 'enemy' && e.hpRatio < hp3);
          }, { owner: unit, priority: -100 });
          battle.on('attack', (c) => {
            if (c.attacker !== unit || unit.mem.sagaExtra || unit.skill?.id !== S3) return;
            const list = half;
            half = null;
            if (!list || !list.length) return;
            const dep = unit.deploySeq;
            battle.after(0, () => {
              if (!up(unit) || unit.deploySeq !== dep || !unit.canAct || unit.s.flags.disarm) return;
              const t = list.filter((e) => e.alive && canTargetEnemy(unit, e, unit.profile));
              if (!t.length) return;
              unit.mem.sagaExtra = true;
              try { battle.forceAttack(unit, t, { noAmmo: true }); } finally { unit.mem.sagaExtra = false; }
            }, { owner: unit });
          }, { owner: unit });
        }

        // ---- 干员自身效果：同门切磋（无条件安装）----
        // 自身 + 部署时身前的干员获得「恶鬼血战」血线特质（各按其所属盟约结算；tick 判定，一切形式的生命下降都算）。
        // [ASSUMED] 部署时判定身前干员；身前干员在嵯峨部署后才站上来的不再补授。
        battle.on('tick', () => {
          if (!up(unit) || unit.ownerId == null) return;
          thresholdLayers(battle, unit);
        }, { owner: unit });
        battle.on('deploy', (c) => {
          if (c.unit !== unit) return;
          const [fr, fc] = unit.fwd ?? [0, 0];
          const tr = unit.tileR + fr, tc = unit.tileC + fc;
          const front = (battle.allyUnits || []).find((a) => a !== unit && a.kind === 'op' && a.alive && a.deployed
            && a.ownerId === unit.ownerId && a.tileR === tr && a.tileC === tc);
          if (!front) return;
          battle.on('tick', () => {
            if (!up(front) || front.ownerId == null) return;
            thresholdLayers(battle, front);
          }, { owner: front });
        }, { owner: unit });
      },
    };
  },
};
