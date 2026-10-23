// server/sim/content/kits/ops/chess_char_6_99-poca.js — 早露 (char_197_poca) kit, tier 6 (自定义, 2026-10-12).
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.
//
// 6_99(自定义) 早露 — 攻城手 (siegesniper, professions.js SUB.siegesniper + data targetPriority 'heaviest')。
// 数值全部来自官方数据表的 blackboard，此处不写死。机制与自选 kit op-poca.js（同一干员的 DIY 版）逐条同源，
// 仅按预设棋子契约改写；op-poca.js 于本批退役（早露转预设棋）。
//   - 形态：普通 _a = E2 Lv1 / 技能 rank 4 / 无模组；精锐 _b = E2 Lv55 / rank 7 / SIE-X 攻城器械训练装置 stage 1
//     （shopCharChessInfoData[tier]；默认技能与模组见 tools/custom-content.mjs CHESS 配置）。
//   - 特性（攻城手）「优先攻击重量最重的敌人」：data targetPriority 'heaviest'（build-data 从特质文本推导） +
//     本 kit trait 的同款 priority；可对空由数据 canHitFly 承担。
//   - T1 深入骨髓（bb def_penetrate / atk_scale / value / extra_atk_scale）：对重量等级 ≥ value 的敌人无视
//     def_penetrate 的防御（defIgnorePct）；SIE-X 隐藏段 → ×atk_scale（dmgMul）+ stage2 的 extra 物理附加
//     （本数据版本 stage1：仅 atk_scale）。
//   - T2 学生楷模（bb atk；SIE-Y stage3 的 init_atk/max_atk 本版本不激活）：全部【乌萨斯学生自治团】干员
//     攻击力 +atk（编入队伍时——部署与否都算，statBuff 常驻）。
//   - S1 攻击力强化·γ型（共享，非默认）：ATK +atk（30s）。
//   - S2 分裂射击（非默认）：ATK +atk，attack@max_target 个目标（60s）。
//   - S3 雪崩击（默认，见 chess.json defaultSkillIndex 2）：ATK +atk；施放时鱼叉链接范围内最重的 max_target 个
//     敌人（束缚），每隔 hit_interval 秒沿链接发起一次 forceAttack（hit_duration/hit_interval 次）；链接断（倒下/
//     消失/隐匿/离地）即解缚，她被晕/冻/沉默时全部断链并结束；无链接时技能提前结束。她链接期间自身不普攻。
//   - 模组 SIE-X（精锐 stage1）：攻击重量等级 ≥3 的敌人时攻击力提升至 atk_scale（115%）。
//     SIE-Y “心” 未选用：tb.damage_scale 缺省时距离加成钩子静默不装。
//   - 干员自身效果【采集单第 8 项】雪崩攻势（garrison_983）：【乌萨斯】+【精准】**已激活**盟约层数每合计满 3 层 →
//     攻击力 +1%（普通）/ +2%（精锐）；未激活的不纳入统计（2026-10-13 用户修订，推翻 10-12 的「未激活也累计」口径）。
//     实现为 0.5s 周期重读（层数在战斗中增长），directMods atkPct（与盟约/天赋的攻击力百分比加算）。

import { num, talentBb, moduleBb, moduleOn, traitBb, skillRec, statBuff, onHitBy, enemiesInGrid, up } from '../shared/tier1.js';
import { hasHp } from '../../../damage.js';
import { hypot } from '../../../detmath.js';

const S1 = 'skcom_atk_up[3]';
const S2 = 'skchr_poca_2';
const S3 = 'skchr_poca_3';
/** 【乌萨斯学生自治团】: character_table teamId `student`（与烈夏/怒潮凛冬的 kit 共用一份名单）。 */
const STUDENTS = new Set(['char_196_sunbr', 'char_115_headbr', 'char_194_leto', 'char_405_absin', 'char_195_glassb',
  'char_197_poca', 'char_1051_headb2']);
const STUDENT_KEY = 'talent:poca:students';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const count = (v, d) => Math.max(1, Math.floor(num(v, d)));

/** 干员自身效果（雪崩攻势）：读的盟约与每 3 层的攻击力加成。 */
const AVALANCHE_BONDS = ['ursusShip', 'preciShip'];
const AVALANCHE_KEY = 'talent:poca:avalanche';

export default {
  chess_char_6_99_a: (bb, chess) => {
    const t0 = talentBb(chess, 0), t1 = talentBb(chess, 1);
    const heavyAt = num(t0.value, 3);
    const heavy = (e) => !!e && e.side === 'enemy' && e.weight >= heavyAt;
    // SIE-X（隐藏段挂在深入骨髓 index：atk_scale / value；stage2 才有 extra_atk_scale——本版本无）
    const xScale = moduleOn(chess) ? num(t0.atk_scale, 1) : 1;
    const extra = num(t0.extra_atk_scale);
    const tb = traitBb(chess);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const avalanche = chess?.isGolden ? 0.02 : 0.01;

    /** S3: the links of the running cast (unit.mem.pocaS3 = { links: Set, left, timer }). */
    const unbind = (battle, unit, e) => {
      const b = e.findBuff('bind');
      if (b && b.source === unit) battle.removeBuff(e, b);
    };
    const linkBroken = (e) => !e.alive || !e.deployed || e.hidden || !!e.s.flags.outOfGround;
    const strike = (battle, unit, st) => {
      const targets = [...st.links].filter((e) => !linkBroken(e));
      if (!targets.length || !unit.canAct || st.left <= 0) return;
      st.left--;
      battle.forceAttack(unit, targets);
    };

    const s3Spec = {
      kind: 'duration',
      mods: { atkPct: num(b3.atk) },
      // no attack of her own while the links hold; the strikes are instant along them ('beam')
      attack: { noAttack: true, projectile: 'beam' },
      onStart({ battle, unit, skill }) {
        const links = enemiesInGrid(battle, unit, null, { n: count(b3.max_target, 3), priority: 'heaviest', canHitFly: true });
        const st = { links: new Set(links), left: count(num(b3.hit_duration, skill.duration) / Math.max(0.1, num(b3.hit_interval, 1)), 6), timer: null };
        unit.mem.pocaS3 = st;
        for (const e of links) {
          battle.applyStatus(e, 'bind', { duration: skill.timeLeft, source: unit });
          battle.fx('harpoon', { x: e.x, y: e.y, id: unit.id, target: e.id });
        }
        st.timer = battle.after(0, () => {
          if (unit.mem.pocaS3 !== st) return;
          strike(battle, unit, st);
          st.timer = battle.every(Math.max(0.1, num(b3.hit_interval, 1)), (b, sc) => {
            if (unit.mem.pocaS3 !== st || st.left <= 0) { sc.cancel(); return; }
            strike(battle, unit, st);
          }, { owner: unit });
        }, { owner: unit });
      },
      onTick({ battle, unit, skill }) {
        const st = unit.mem.pocaS3;
        if (!st) return;
        const f = unit.s.flags;
        if (f.stun || f.freeze || f.silence) { skill.end('interrupted'); return; }
        for (const e of [...st.links]) if (linkBroken(e)) { st.links.delete(e); unbind(battle, unit, e); }
        if (!st.links.size) skill.end('unlinked');
      },
      onEnd({ battle, unit }) {
        const st = unit.mem.pocaS3;
        unit.mem.pocaS3 = null;
        if (!st) return;
        if (st.timer) st.timer.cancel();
        for (const e of st.links) unbind(battle, unit, e);
      },
    };

    return {
      skill: s3Spec,                       // 默认技能（S3）只写顶层 skill，绝不进 skills 映射
      skills: {
        [S1]: { kind: 'duration', mods: { atkPct: num(b1.atk) } },
        [S2]: { kind: 'duration', mods: { atkPct: num(b2.atk) }, targeting: { maxTargets: count(b2['attack@max_target'], 2) } },
      },
      talents: [
        { install(battle, unit) { // 深入骨髓: def_penetrate 物理穿透 on heavy enemies; SIE-X stage2: the extra hit
          const pen = num(t0.def_penetrate);
          if (pen > 0) onHitBy(battle, unit, ({ target, dmg }) => { if (heavy(target)) dmg.defIgnorePct += pen; });
          if (extra > 0) {
            battle.on('damaged', (c) => {
              if (c.source !== unit || !c.dmg?.isAttack || !heavy(c.target) || !hasHp(c.target)) return;
              battle.dealDamage(unit, c.target, { amount: unit.s.atk * extra, type: 'phys', tags: ['talent', 'poca:extra'] });
            }, { owner: unit });
          }
        } },
        { install(battle, unit) { // 学生楷模: every student of her team ATK +atk（编入队伍时——部署与否都算）
          const team = battle.allyUnits.filter((a) => a.ownerId === unit.ownerId && a.kind === 'op' && STUDENTS.has(a.def?.charId));
          for (const a of team) statBuff(battle, a, STUDENT_KEY, { atkPct: num(t1.atk) });
        } },
      ],
      // 攻城手: heaviest first; SIE-X ×atk_scale on her attacks against heavy enemies
      trait: { priority: 'heaviest', ...(xScale !== 1 ? { dmgMul: (b, u, target) => (heavy(target) ? xScale : 1) } : null) },
      install(battle, unit) {
        // ---- 干员自身效果：雪崩攻势（无条件安装）----
        // 【乌萨斯】+【精准】**已激活**盟约层数合计每满 3 层 → 攻击力 +1%/+2%（未激活的不纳入，2026-10-13 用户修订）。
        battle.every(0.5, () => {
          if (!up(unit)) return;
          const ps = battle.getPlayer?.(unit.ownerId);
          if (!ps) return;
          let total = 0;
          for (const id of AVALANCHE_BONDS) {
            const bond = ps.bonds?.[id];
            if (bond?.active) total += Math.max(0, num(bond.layers, 0));
          }
          const atkPct = Math.floor(total / 3) * avalanche;
          const cur = unit.findBuff(AVALANCHE_KEY);
          if (!(atkPct > 0)) { if (cur) battle.removeBuff(unit, cur); return; }
          if (!cur || cur.mods?.atkPct !== atkPct) {
            battle.addBuff(unit, { key: AVALANCHE_KEY, persist: true, allowDead: true, refresh: 'replace', mods: { atkPct }, tags: ['talent'] });
          }
        }, { owner: unit, immediate: true });

        // SIE-Y: the farther the target, the more damage（未选用 SIE-Y 时 tb.damage_scale 缺省 → 不装）
        const ds = num(tb.damage_scale), lo = num(tb.min_dist, 1), hi = num(tb.max_dist, 4.5);
        if (ds > 0) {
          onHitBy(battle, unit, ({ target, dmg }) => {
            if (!dmg.isAttack) return;
            const d = hypot(target.x - unit.x, target.y - unit.y);
            dmg.mul *= 1 + ds * Math.max(0, Math.min(1, (d - lo) / Math.max(1e-6, hi - lo)));
          });
        }
      },
    };
  },
};
