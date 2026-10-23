// server/sim/content/kits/ops/chess_char_5_98-turdus.js — 乌啾 (char_4224_turdus) kit, tier 5 (自定义, 2026-10-12).
// Kit contract and rules: ../README.md. 5★ 链愈师 (chainhealer, professions.js SUB.chainhealer: 3 跳、每跳 -25%)。
// 数值全部来自官方数据表 blackboard；技能/天赋/模组描述来自 PRTS 乌啾。
//   - 形态：普通 _a = E1 Lv60 / rank 4 / 无模组；精锐 _b = E2 Lv55 / rank 7 / XAH-X “睡前故事” stage 1
//     （tier 5；模组特性更新：跳跃衰减 25% → falloff 15%）。默认技能 S2（chess.json defaultSkillIndex 1）。
//   - 特性（链愈师）「恢复友方单位生命，且会在3个友方单位间跳跃，每次跳跃治疗量降低25%」：职业层承担
//     （SUB.chainhealer heal.mode 'chain' count 3 falloff 0.25）；XAH-X 在数据侧把 falloff 覆写为 0.15（模组
//     特性 bb），kit 不重复实现。
//   - T1 久病良医（E1 110% / E2 120%）：受到**自身的**跳跃治疗时治疗量提升至对应比例，并额外进行一次不衰减
//     的治疗跳跃 [ASSUMED：额外一跳 = 对她治疗范围内另一名（或同一名剩余）受伤友方按本次未衰减的治疗量补一次]。
//   - S1 火钳秘咒（非默认）：攻击速度+80，每次治疗的跳跃次数+1（25s）——jump 修正按 lumen 先例在技能期间改写
//     profile.heal.count（-1/+1 配对，技能结束复原）。
//   - S2 “捉迷藏！”（默认，瞬发）：流失 15% 当前生命（battle.loseHp，utage 先例）→ 立即治疗一次（范围内生命
//     最低的受伤友方，治疗量 = 攻击力）→ 该目标每秒受到治疗量为 35% 攻击力的增益治疗，持续 12s（HoT buff，
//     agoat2 先例）→ 治疗的所有目标获得迷彩 12s（battle camou，buffs.js）。
//   - 模组 XAH-X（精锐 stage1，数据承载 attr {hp165,atk38} + 特性 falloff 覆写）。
//   - 干员自身效果【采集单第 8 项】病床巡视（garrison_984）：每次开启技能时，攻击范围内每有 1 名【乌萨斯】干员
//     （def.raw.nationId 'ursus'，含她自己），使已激活的【乌萨斯】【迅捷】层数 +3（普通）/ +6（精锐）
//     （2026-10-17 用户修订：2/4→3/6）——每场战斗每种盟约最多 12/24 层（同批修订：8/16→12/24）
//     （unit.mem 记账，同 op-botany 乌萨斯齐鸣的写法与口径）。

import { num, talentBb, skillRec, up } from '../shared/tier1.js';
import { COLS } from '../../../constants.js';

const S1 = 'skchr_turdus_1';
const S2 = 'skchr_turdus_2';
const JUMP_KEY = 'talent:turdus:ownJump';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const isUrsus = (a) => !!a && a.kind === 'op' && (a.def?.raw?.nationId ?? a.def?.nationId) === 'ursus';
// 2026-10-16 修正：范围键是 r*COLS+c（queries.js 建 rangeKeySet、tokens.js/tier6.js 都这么算），
// 原来写死 1000 永远匹配不上 → 「范围内每名【乌萨斯】」实际只数到她自己（A 档永远 +1 人）。
const inRangeOf = (unit, a) => !!(unit.rangeKeySet && a && Number.isInteger(a.tileR) && Number.isInteger(a.tileC)
  && unit.rangeKeySet.has(a.tileR * COLS + a.tileC));
/** 久病良医: candidates bb {0:1.25,1:1.25}——官方字段缺相位区分，按解锁相位取 E1/E2（PRTS 110%/120%）。 */
const OWN_JUMP = (chess) => (chess?.isGolden ? 1.2 : 1.1);

export default {
  chess_char_5_98_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2);
    const layerPer = chess?.isGolden ? 6 : 3;   // 每次开启技能每名【乌萨斯】加的层数（2026-10-17 用户修订：2/4→3/6）
    const layerCap = chess?.isGolden ? 24 : 12; // 每场每盟约上限（2026-10-17 用户修订：8/16→12/24）

    /** S2: the one immediate heal — lowest-hp injured ally in range (herself included), one target. */
    const pickPatient = (battle, unit) => {
      const cands = battle.injuredAlliesInKeys(unit.rangeKeys, unit).filter((a) => up(a));
      if (!cands.length) return null;
      let best = null, ratio = Infinity;
      for (const a of cands) {
        const r = a.hp / Math.max(1, a.s.maxHp);
        if (r < ratio - 1e-9) { ratio = r; best = a; }
      }
      return best;
    };

    const s2Spec = {
      kind: 'instant',
      onStart({ battle, unit }) {
        // 流失 15% 当前生命
        const loss = unit.hp * 0.15;
        if (loss > 0 && unit.hp - loss >= 1) battle.loseHp(unit, loss, { source: unit });
        // 立即治疗一次
        const patient = pickPatient(battle, unit);
        if (!patient) return;
        const healed = [patient];
        battle.heal(unit, patient, unit.s.atk, { tags: ['skill', 'turdus'] });
        // 目标每秒受到治疗量为 35% 攻击力的增益治疗，持续 12s（HoT）
        const hotAtk = unit.s.atk * num(b2['attack@heal_scale'], 0.35);
        const hotDur = num(b2.duration, 12);
        if (hotAtk > 0 && hotDur > 0) {
          battle.addBuff(patient, {
            key: 'skill:turdus:hot', duration: hotDur, source: unit, interval: 1,
            data: { atk: hotAtk },
            onTick: ({ battle: b, unit: t, buff }) => { if (up(t)) b.heal(unit, t, buff.data.atk, { tags: ['skill', 'turdusHot'] }); },
          });
        }
        // 治疗的所有目标获得迷彩 12s
        for (const t of healed) battle.applyStatus(t, 'camou', { duration: num(b2.duration, 12), source: unit });
      },
    };
    const s1Spec = {
      kind: 'duration',
      mods: { aspd: num(b1.attack_speed, 80) },
      onStart({ unit }) { // 跳跃次数 +1（技能期间）
        const h = unit.profile && unit.profile.heal;
        if (h && Number.isFinite(h.count)) { unit.profile.heal = { ...h, count: h.count + 1 }; }
      },
      onEnd({ unit }) { // 复原
        const h = unit.profile && unit.profile.heal;
        if (h && Number.isFinite(h.count) && h.count > 3) { unit.profile.heal = { ...h, count: h.count - 1 }; }
      },
    };

    return {
      skill: s2Spec,                       // 默认技能（S2）只写顶层 skill
      skills: { [S1]: s1Spec },
      talents: [
        { install(battle, unit) { // 久病良医: 自身受到自己的跳跃治疗 → 治疗量 ×own + 额外一次不衰减的治疗跳跃
          const own = num(t0['chain.atk_scale_2'], num(t0['attack@chain.atk_scale_2'], OWN_JUMP(chess)));
          const mul = own > 1 ? own : OWN_JUMP(chess);
          battle.on('heal', (ctx) => {
            if (ctx.source !== unit || ctx.target !== unit || !up(unit)) return;
            if (ctx.opts?.tags?.includes('turdusOwnJump')) return;   // 额外跳不再触发
            ctx.amount *= mul;
            // 额外进行一次不衰减的治疗跳跃：范围内另一名受伤友方（无则不跳）按本次未衰减的治疗量补一次
            const cands = battle.injuredAlliesInKeys(unit.rangeKeys, unit).filter((a) => up(a) && a !== unit);
            if (!cands.length) return;
            let best = null, ratio = Infinity;
            for (const a of cands) {
              const r = a.hp / Math.max(1, a.s.maxHp);
              if (r < ratio - 1e-9) { ratio = r; best = a; }
            }
            if (best) battle.heal(unit, best, ctx.amount, { tags: ['talent', 'turdusOwnJump'] });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // ---- 干员自身效果：病床巡视（无条件安装，先于模组分支）----
        // 每次开启技能时：范围内每有 1 名【乌萨斯】干员（含她自己）→ 已激活的【乌萨斯】【迅捷】各 +3/+6 层，
        // 每场战斗每种最多 12/24 层（unit.mem 记账，跨部署累计——unit 是每场战斗的作用域）。
        battle.on('skillStart', (c) => {
          if (c.unit !== unit || unit.ownerId == null || !up(unit)) return;
          unit.mem = unit.mem || {};
          const ps = battle.getPlayer?.(unit.ownerId);
          if (!ps) return;
          const n = battle.allyUnits.filter((a) => a !== unit ? (a.alive && a.deployed && !a.hidden && isUrsus(a) && inRangeOf(unit, a)) : true).length;
          if (!(n > 0)) return;
          for (const [id, memKey] of [['ursusShip', 'turdusUrsus'], ['swiftShip', 'turdusSwift']]) {
            const st = ps.bonds?.[id];
            if (!st || !st.active) continue;        // 「需盟约已激活才叠层」
            const used = num(unit.mem[memKey], 0);
            const add = Math.min(n * layerPer, Math.max(0, layerCap - used));
            if (!(add > 0)) continue;
            const got = battle.addLayers(unit.ownerId, id, add, 'op', { source: unit });
            if (got > 0) unit.mem[memKey] = used + got;
          }
        }, { owner: unit });
      },
    };
  },
};
