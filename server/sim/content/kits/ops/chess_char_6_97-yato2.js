// server/sim/content/kits/ops/chess_char_6_97-yato2.js — 麒麟R夜刀 (char_1029_yato2) kit, tier 6 (自定义, 2026-10-13).
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md. 6★ 特种 / 处决者(executor)。
// 数值全部来自官方数据表的 blackboard；技能/天赋/模组描述来自 PRTS 麒麟R夜刀。三个技能在数据里都是被动
// （spType 8，无 SP）—— PRTS：S3「※部署瞬间即进入技能状态」，S1/S2 同为部署后自动进入技能状态。
//   - 形态：普通 _a = E2 Lv1 / rank 4 / 无模组；精锐 _b = E2 Lv60 / rank 7 / EXE-Y 罗德岛制式双刀 stage 1
//     （数据承载 {hp135,atk23} + 特性追加「周围四格没有友方干员时攻击力+10%」（traitBb.atk））。
//   - 特性（处决者）：再部署时间大幅减少、可以且优先攻击自身阻挡的单位 —— 职业层承担（professions.js executor）。
//   - T1 双雷剑麒麟（E0 起，attack@atk_scale_1 按相位）：攻击额外造成攻击力 6%/13%/20% 的法术伤害。
//   - T2 鬼人强化状态（E2 起）：技能期间及技能结束后 10 秒内攻击力 +13%（atk / duration）。
//   - 时间基准（2026-10-14 用户修订，引擎实测）：**1 干员秒 = 1 引擎秒** —— 引擎里 SP 自然回复 1/秒、DP 1/秒、
//     攻击间隔与官方 attackTime 1:1（simdata 不做缩放）；「两倍速」只是屏幕速度（COMBAT_TIME_SCALE=2：每真实秒
//     推进 2 引擎秒，客户端 spine 动画按 1:1 引擎秒播放 = 官方节奏 ×2 屏幕速度）。旧 K=2 换算是错的，全部帧时长
//     直接按干员秒 = 引擎秒取值。
//   - 部署前摇（用户帧数据）：部署后 1 干员秒（30 干员帧）固定前摇，首攻落在前摇后半个攻击间隔
//     （+100 攻速实测首段 37 干员帧 = 30 前摇 + 半个 0.465s 间隔 ⇒ deploy 时 atkCd = 1 + interval/2）。
//   - 攻击间隔按干员时间：她的每次普攻后冷却 = 攻击间隔（干员秒 = 引擎秒；追加的连击段不重置冷却）。
//   - S1 鬼人化（非默认，常驻被动姿态）：攻击速度 +attack_speed，攻击变为二连击；
//     对同一目标的第三次攻击变为六连击 —— 追加两次攻击、不重复计数。六连击的段排布（用户帧数据，
//     I = 攻击间隔）：第四段 = 第三段 + 固定 4 干员帧（不随攻速），第五段 = 第三段 + 1×I（随攻速）；
//     六连击动画占用 2×I（下一次攻击延后到此，十连击周期 = 4×I —— 钩子在 updateAlly 的 atkCd 赋值前触发，
//     Math.max 不会压回）。
//   - S2 乱舞（**默认**，见 chess.json defaultSkillIndex 1；kind 'duration' + activateOnDeploy —— 怒潮凛冬 S3
//     同款的部署限时施放：正式 cast 语义、空放不需要接敌、技能条按 duration 倒数、动画走 cast 通道）：
//     部署 1 干员秒前摇（Start_2），随后 Skill_2 固定动画 3.433 干员秒内按官方 spine 命中帧打完 16 次斩击
//     （0.4 → 2.967s，每刀 atk_scale × ATK 物理伤害）；**前摇+动画期间她无法进行普通攻击**（flags disarm，
//     2026-10-14 用户口径），嘲讽等级 +1（skill mods）；「攻击倍率同时应用于普通攻击与第一天赋」的窗口 =
//     skill.active（duration 施放只在窗口内 active，不再需要 mem 时间戳）。
//   - S3 空中回旋乱舞（非默认，kind 'duration' + activateOnDeploy，同样空放）：Start_3 前摇 1 干员秒（官方
//     spine）后**弹道**释放（2026-10-13 用户修订：本体原地不动，等于发射一枚穿透弹）—— 无敌/不可阻挡为
//     skill flags（随 cast 同起同终，引擎自动移除），弹道从前体所在格中心沿朝向飞行，8 格/秒、每帧（1/30s）
//     判定一次攻击，碰撞半径 0.51（+敌人体积 → 取 0.8 判定）内所有敌人（含空中）受到 atk_scale × ATK 物理伤害；
//     每造成一次技能伤害使弹道突进距离 +dist_unit(0.3) 格，初始 min_dist(2)、至多 max_dist(5) 格，不超出地图边界
//     [ASSUMED: 「最大突进距离受视野影响」按地图边界近似]；晕眩/冻结/沉睡免疫（一减状态抵抗率 -100% ≈ 时长
//     1/1000，以免疫近似，beforeStatus 钩子在 install，按 skill.active 判窗口）；PRTS 备注「攻击倍率同时应用于
//     第一天赋」→ 弹道期间第一天赋 ×atk_scale。
//   - 模组 EXE-Y（精锐 stage1）：特性追加「周围四格没有友方干员时攻击力+10%」（traitBb.atk）。
//   - 干员自身效果【采集单第 8 项】麒麟之魂（garrison_992，2026-10-14 用户修订：加「再部署时间-50%」；
//     同日三次修订：层池 =【东】【突袭】【不屈】——**已激活者**的层数合计（未激活的不计入；全部未激活则
//     无加成也不流血），流失 50→100/秒；2026-10-16 用户修订：再部署 -50%→-75%、【狂龙症】期间攻击力 +50%；
//     2026-10-17 用户修订：【狂龙症】不再给「损失量 2 倍」的屏障，改为 90% 物理与法术伤害减免）：
//     再部署时间-75%（乘算 s.redeployMul）；部署时失去当前生命值的 50%（不再转化为屏障）；
//     层数合计每叠 3 层，自身攻击力 +1/2%，【狂龙症】期间另 +50% 攻击力并获得 90% 物理/法术减伤，
//     但每秒失去 100 点生命（流失；「每秒」= 干员秒 = 引擎秒）。⚠️ 她自己的干员效果（reason 'op' 由加层方标注）。「已激活/层数」内联读
//     battle.getPlayer(pid).bonds[id]（kit 禁 import support/index.js —— kits_layout.test.js）。
//     攻击加成与流血按合计层数生效（加成随层实时变化，tick 刷新）；【狂龙症】随部署获得、死亡/撤退时结束。

import { COLS } from '../../../constants.js';
import { num, talentBb, skillRec, traitBb, up } from '../shared/tier1.js';

const S1 = 'skchr_yato2_1';
const S2 = 'skchr_yato2_2';
const S3 = 'skchr_yato2_3';

const bbOf = (chess, id) => skillRec(chess, id)?.bb ?? {};
const DONG = 'dongShip';
const RAID = 'raidShip';    // 【突袭】
const INDOM = 'indomShip';  // 【不屈】（2026-10-14 三次修订：层池 =【东】【突袭】【不屈】三盟约，已激活者层数合计）
/** 部署前摇：1 干员秒（官方 spine Start_1/Start_2/Start_3 均为 1s 固定动画，2026-10-14 spine 对齐确认）；
 *  首攻再等半个攻击间隔（见文件头）。 */
const DEPLOY_WINDUP = 1;
/**
 * S2 乱舞（官方 spine 对齐 2026-10-14）：Start_2 前摇 1 干员秒 + Skill_2 动画 3.433 干员秒内 16 刀。
 * 命中帧 = skel 里 Skill_2 的 OnAttack 事件时间（固定攻击动画，不受攻击速度影响）；官方 blackboard 没有
 * duration 键（旧实现 uniform 3s/16 刀是近似），以 spine 为准。
 */
const DANCE_WINDUP = 1;
const SKILL2_HITS = [0.4, 1.067, 1.133, 1.4, 1.667, 1.933, 2, 2.2, 2.267, 2.633, 2.7, 2.767, 2.8, 2.867, 2.9, 2.967];
const DANCE_WINDOW = 3.433;
/** S1 六连击：第三段与第四段二连击的间隔固定 4 干员帧（不随攻速；用户帧数据；spine Skill_Attack3 的
 *  OnAttack 对 0.367→0.633 = 常速 0.267s，+100 攻速下 ×2 即 4 干员帧，与该排布互相印证）。 */
const SIX_GAP = 4 / 30;
/** S3 空中回旋乱舞：Start_3 前摇 1 干员秒（官方 spine）后才释放弹道；无敌/不可阻挡为 skill flags（随 cast 同起同终）。 */
const DASH_WINDUP = 1;
/** S3 弹道：8 格/秒、每帧（1/30s）判定一次攻击；碰撞半径 0.51 + 敌人体积 → 判定 0.8。 */
const BULLET_SPEED = 8, BULLET_DT = 1 / 30, BULLET_RADIUS = 0.8;
/** S3 弹道最长飞行（bb max_dist 5 ÷ 8 格/秒）——cast 时长的弹道段。 */
const DASH_MAX_FLIGHT = 5 / BULLET_SPEED;
/** S3 期间的状态免疫（一减状态抵抗率 -100% ≈ 免疫）。 */
const DASH_IMMUNE = new Set(['stun', 'freeze', 'sleep']);
const DANCE_TAG = 'yato2Dance';

export default {
  chess_char_6_97_a: (bb, chess) => {
    const t0 = talentBb(chess, 0);   // 双雷剑麒麟: attack@atk_scale_1（按解锁相位 6%/13%/20%）
    const t1 = talentBb(chess, 1);   // 鬼人强化状态（E2）: atk / duration
    const tb = traitBb(chess);       // EXE-Y stage1: atk（周围四格无友方干员时攻击力+10%）
    const b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const golden = !!chess?.isGolden;

    /** 前方一格的 tile key（技能用；引擎键编码 = r × COLS + c —— 旧实现 ×1000 查不到敌人，2026-10-13 修复）。 */
    const frontKey = (unit) => {
      const [fr, fc] = unit.fwd ?? [0, 0];
      return (unit.tileR + fr) * COLS + (unit.tileC + fc);
    };

    const s1Spec = {
      // 部署即触发一次**有持续时间的**技能（与耀骑士临光 S2 / 弑君者同型：计时部署施放，无技能条）：
      // 鬼人化只在技能期间生效（攻速 + 二连击随 cast 起终），结束后普攻回到 Attack1→2→3 序列。
      // 旧实现是 kind 'passive' + skillAnim 3600（姿态常驻整场），客户端因此永远认为技能开着、
      // 普攻一直走 Skill_Attack 序列（业主报障 2026-10-15）。
      kind: 'duration', activateOnDeploy: true, duration: num(b1.duration, 20),
      spCost: 0, spType: 'none', trigger: 'NEVER',
      mods: { aspd: num(b1.attack_speed, 45) },
      attack: { hits: 2 },
    };
    // 部署限时施放（怒潮凛冬 S3 同款）：正式 cast —— 空放不需要接敌、技能条按 duration 倒数、
    // skill 事件与 UF.SKILL 走引擎的 cast 通道（mods/flags 随 cast 自动起终）。
    const s2Spec = {
      kind: 'duration', activateOnDeploy: true,
      duration: DANCE_WINDUP + DANCE_WINDOW,    // 前摇 Start_2 1s + Skill_2 动画 3.433s
      mods: { taunt: num(b2.taunt_level, 1) },  // 技能期间嘲讽 +1（taunt_level）
      flags: { disarm: true },                  // 期间无法普攻（乱舞的技能伤害不受影响；2026-10-14 用户口径）
      onStart({ battle, unit, skill }) {
        // 部署 1 干员秒前摇（Start_2）后，Skill_2 固定动画 3.433 干员秒内按官方 spine 命中帧打 16 刀
        // （每刀 atk_scale × ATK 物理伤害）—— 全部命中帧都落在动画窗口内
        const n0 = skill.activations, dep = unit.deploySeq;
        const scale = num(b2.atk_scale, 1.3);
        for (const t of SKILL2_HITS) {
          battle.after(DANCE_WINDUP + t, () => {
            if (!(unit.alive && unit.deployed && unit.deploySeq === dep && skill.active && skill.activations === n0)) return;
            // 本格 + 身前一格（业主口径 2026-10-15：技能描述只写身前一格，机制上自身所在格也吃伤害）
            const foes = battle.enemiesInKeys([unit.tileR * COLS + unit.tileC, frontKey(unit)], unit, unit.profile);
            if (!foes.length) return;
            for (const e of foes) {
              if (!e.alive) continue;
              battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', DANCE_TAG] });
            }
          }, { owner: unit });
        }
      },
    };
    const s3Spec = {
      kind: 'duration', activateOnDeploy: true,
      // 前摇 Start_3 1s + 弹道最长飞行（上限 5 格 ÷ 8 格/秒）+ 收尾余量：结束帧正好接 Skill_3_End
      duration: DASH_WINDUP + DASH_MAX_FLIGHT + 0.25,
      flags: { invulnerable: true, unblockable: true, disarm: true },   // 期间无敌且不可阻挡、不普攻（随 cast 自动起终）
      onStart({ battle, unit, skill }) {
        const n0 = skill.activations, dep = unit.deploySeq;
        const scale = num(b3.atk_scale, 2.6);
        const minDist = num(b3.min_dist, 2), maxDist = num(b3.max_dist, 5);
        const perHit = num(b3.dist_unit, 0.3);
        // 弹道：从本体所在格中心沿朝向飞行，**本体原地不动**（world 坐标 x=列, y=行，每格 1 单位）。
        const [fr, fc] = unit.fwd ?? [0, 0];
        const st = { x: unit.x, y: unit.y, dist: 0, gained: minDist };
        let judgedStart = false;   // 弹道起点 = 本体所在格：第一帧先判一次，之后每帧判新位置
        const step = () => {
          // 本次部署的这次施放的弹道：一次中途死亡后的滞留 step（owner 计时器在倒地期间继续跑）直接作废
          if (!(unit.alive && unit.deployed && unit.deploySeq === dep && skill.active && skill.activations === n0)) return;
          if (st.dist >= st.gained - 1e-9 || st.dist >= maxDist) return;   // 飞行结束（距离用尽）
          const mv = Math.min(BULLET_SPEED * BULLET_DT, st.gained - st.dist, maxDist - st.dist);
          const nx = st.x + fc * mv, ny = st.y + fr * mv;
          if (!battle.grid.inRect(Math.round(ny), Math.round(nx))) return; // 不超出地图边界
          // 每帧判定一次攻击：碰撞范围内所有敌人（含空中）；每造成一次技能伤害使突进距离 +dist_unit。
          // 帧判定是**可重复**的（业主口径 2026-10-15）：大体型 boss 停在判定圈里会被连续帧打中、连续 +dist_unit，
          // 直到距离用尽（8 格/秒的弹道本身很快，小体型一般只吃一两帧）。
          const hitAt = (hx, hy) => {
            let n = 0;
            for (const e of battle.foesInRadius(hx, hy, BULLET_RADIUS, true)) {
              if (!e.alive) continue;
              battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', isSkill: true, canDodge: false, tags: ['skill', 'yato2Dash'] });
              n++;
            }
            return n;
          };
          let hits = 0;
          if (!judgedStart) { judgedStart = true; hits += hitAt(st.x, st.y); }   // 本体格（起点）也要吃伤害
          st.x = nx; st.y = ny; st.dist += mv;
          hits += hitAt(st.x, st.y);
          st.gained = Math.min(maxDist, st.gained + hits * perHit);
          battle.after(BULLET_DT, step, { owner: unit });
        };
        // 弹道本体在 Start_3 前摇 1 干员秒后才释放（官方 spine）；无敌/不可阻挡由 skill flags 承担
        battle.after(DASH_WINDUP, step, { owner: unit });
      },
    };

    return {
      // 默认技能放顶层 `skill`（content/index.js selectSkillSpec：默认技能绝不能同时进 skills 映射）。
      skill: s2Spec,                                  // 默认技能 = 乱舞（2026-10-13 用户修订，原 S3；数据 defaultSkillIndex 1）
      skills: { [S1]: s1Spec, [S3]: s3Spec },         // 只列非默认技能
      talents: [
        { install(battle, unit) { // 双雷剑麒麟：攻击额外造成攻击力 atk_scale_1 的法术伤害
          const scale = num(t0['attack@atk_scale_1'], num(t0.atk_scale_1, 0));
          if (!(scale > 0)) return;
          const ts2 = num(b2.talent_scale, 1);   // S2 乱舞窗口：第一天赋效果提升至 talent_scale 倍（PRTS 备注）
          const ts3 = num(b3.atk_scale, 2.6);    // S3 突进：攻击倍率同时应用于第一天赋（PRTS 备注）
          battle.on('hit', (c) => {
            if (c.source !== unit || !c.target || c.target.side !== 'enemy') return;
            const d = c.dmg;
            if (!d || !d.isAttack || d.cancel || d.type === 'element' || !c.target.alive) return;
            if (Array.isArray(d.tags) && (d.tags.includes('yato2Talent'))) return;
            // duration 施放只在窗口内 active（不再需要 mem 时间戳；passive 的 active 永真问题不适用于 duration）
            const sk = unit.skill;
            let mul = 1;
            if (sk && sk.active && sk.id === S3) mul = Math.max(mul, ts3);
            else if (sk && sk.active && sk.id === S2) mul = Math.max(mul, ts2);
            battle.dealDamage(unit, c.target, { amount: unit.s.atk * scale * mul, type: 'arts', canDodge: false, tags: ['yato2Talent'] });
          }, { owner: unit });
        } },
        { install(battle, unit) { // 鬼人强化状态：技能期间及结束后 10s 内攻击力 +atk
          // 用 tick 统一处理：技能激活期间持续刷新（时长 10s），结束后残余 10s 自然过期；
          // S1 常驻被动期间等价常驻 [ASSUMED]。
          const atk = num(t1.atk, 0.13);
          if (!(atk > 0)) return;
          battle.on('tick', () => {
            if (!up(unit)) return;
            const sk = unit.skill;
            if (sk && sk.active) battle.addBuff(unit, { key: 'talent:yato2:oni', duration: num(t1.duration, 10), refresh: 'replace', mods: { atkPct: atk }, visible: true, tags: ['talent'] });
          }, { owner: unit });
        } },
      ],
      install(battle, unit) {
        // ---- 部署前摇：1 干员秒固定前摇 + 首攻落在前摇后半个攻击间隔（+100 攻速实测 37 干员帧 =
        // 30 前摇 + 半个 0.465s 间隔）。skill.reset 已在此前应用 passive 的攻速 mods。----
        battle.on('deploy', (c) => {
          if (c.unit !== unit || !up(unit)) return;
          unit.atkCd = Math.max(unit.atkCd, DEPLOY_WINDUP + unit.s.interval / 2);
        }, { owner: unit });

        // ---- 攻击间隔按干员时间（1 干员秒 = 1 引擎秒）：她的每次普攻后冷却 = 攻击间隔
        // （追加的连击段不重置冷却；六连击那下的占用在下方钩子里另设）。----
        battle.on('attack', (c) => {
          if (c.attacker !== unit || unit.mem.yato2Extra) return;
          unit.atkCd = Math.max(unit.atkCd, unit.s.interval);
        }, { owner: unit });

        // ---- S3 弹道期间：晕眩/冻结/沉睡免疫（一减状态抵抗率 -100% ≈ 时长 1/1000，以免疫近似）----
        battle.on('beforeStatus', (ctx) => {
          const sk = unit.skill;
          if (ctx.target === unit && sk && sk.active && sk.id === S3 && DASH_IMMUNE.has(ctx.status)) ctx.cancel = true;
        }, { owner: unit });

        // ---- 模组 EXE-Y stage1：周围四格没有友方干员时攻击力 +10%（traitBb.atk）----
        const solo = num(tb.atk, 0);
        if (solo > 0) {
          const check = () => !(battle.allyUnits || []).some((a) => a !== unit && a.kind === 'op' && a.alive && a.deployed
            && a.ownerId === unit.ownerId && Math.max(Math.abs(a.tileR - unit.tileR), Math.abs(a.tileC - unit.tileC)) <= 1);
          const cur = () => unit.findBuff('trait:yato2:solo');
          battle.on('tick', () => {
            if (!up(unit)) return;
            const on = check(), have = !!cur();
            if (on && !have) battle.addBuff(unit, { key: 'trait:yato2:solo', duration: 0.5, refresh: 'replace', mods: { atkPct: solo }, tags: ['trait'] });
          }, { owner: unit });
        }
        // ---- S2 乱舞的攻击倍率窗口：cast 期间（前摇+动画）她的攻击 ×atk_scale（普通攻击）----
        // duration 施放只在窗口内 active，按 skill.active 判定即可（passive 的 active 永真问题不适用）。
        const scale2 = num(b2.atk_scale, 1.3);
        if (scale2 !== 1) {
          battle.on('hit', (c) => {
            const sk = unit.skill;
            if (c.source !== unit || !(sk && sk.active && sk.id === S2)) return;
            const d = c.dmg;
            if (!d || d.cancel || d.type === 'element') return;
            if (Array.isArray(d.tags) && (d.tags.includes(DANCE_TAG) || d.tags.includes('yato2Dash'))) return;
            d.mul *= scale2;
          }, { owner: unit });
        }
        // ---- S1 鬼人化：对同一目标的第三次攻击变为六连击（追加两次攻击，追加不计数）----
        // 段排布（用户帧数据，I = 攻击间隔）：第三段（本次攻击）后固定 4 干员帧落第四段，再过 1×I 落第五段
        // （随攻速）；六连击动画占用 2×I —— 下一次攻击延后到此，十连击周期 = 4×I（钩子在 ai.js updateAlly 的
        // atkCd 赋值前触发，Math.max 不会压回）。
        battle.on('attack', (c) => {
          if (c.attacker !== unit || !(unit.skill?.active && unit.skill.id === S1)) return;
          if (unit.mem.yato2Extra) return;
          const list = (c.targets || []).filter((e) => e && e.side === 'enemy' && e.alive);
          if (!list.length) return;
          const dep = unit.deploySeq;
          const counts = unit.mem.yato2Counts = unit.mem.yato2Counts || new Map();
          const due = [];
          for (const e of list) {
            const n = (counts.get(e.id) || 0) + 1;
            counts.set(e.id, n);
            if (n % 3 === 0) due.push(e);
          }
          if (!due.length) return;
          const iv = unit.s.interval;
          unit.atkCd = Math.max(unit.atkCd, iv * 2);
          const seg = (delay) => battle.after(delay, () => {
            if (!up(unit) || unit.deploySeq !== dep || !unit.canAct) return;
            const t = due.filter((e) => e.alive);
            if (!t.length) return;
            unit.mem.yato2Extra = true;
            try { battle.forceAttack(unit, t, { noAmmo: true }); }
            finally { unit.mem.yato2Extra = false; }
          }, { owner: unit });
          seg(SIX_GAP);      // 第四段：第三段 + 固定 4 干员帧（不随攻速）
          seg(iv);           // 第五段：第三段 + 1×I（随攻速）
        }, { owner: unit });

        // ---- 干员自身效果：麒麟之魂（无条件安装，先于模组分支）----
        // 再部署时间-75%（2026-10-16 用户修订 50%→75%；乘算进 s.redeployMul，deploy.js 的 respawn 计时读取）；
        // 部署时失去当前生命值的 50%（2026-10-17 起不再给出屏障）；【东】【突袭】【不屈】（均需已激活，2026-10-14 二次修订）
        // 每叠 3 层 [ASSUMED: 三盟约层数合计] 攻击力 +1/2%（tick 随层刷新），生效起每秒失去 100 点生命（流失）。
        battle.addBuff(unit, { key: 'trait:yato2:redeploy', persist: true, allowDead: true, mods: { redeployMul: 0.25 }, tags: ['trait'] });
        const per = golden ? 0.02 : 0.01;
        // ---- 【狂龙症】(trait:yato2:oni)：部署（含各种方式的再部署）时获得，自身死亡或撤退时结束，**只允许一层** ----
        // 瞬时：失去当前生命 50%（不再转化为屏障）；持续：攻击力 +50%、90% 物理与法术伤害减免
        // （physTakenMul / artsTakenMul = 0.1 —— 庇护语义，只减物理与法术，见 tier1.protectMods 同口径），
        // 且每秒流失 100 点生命（由 every(1) 按"这面 buff 在不在"驱动；2026-10-17 用户修订：屏障 → 90% 减伤）。
        // 不屈/突袭那种原地再部署没有死过 → buff 还在 → 不重复挂第二层、也不重复扣那 50%（业主口径 2026-10-15）。
        const ONI = 'trait:yato2:oni';
        const ONI_MODS = Object.freeze({ atkPct: 0.5, physTakenMul: 0.1, artsTakenMul: 0.1 });
        const grantOni = () => {
          if (unit.findBuff(ONI)) return;                       // 已经带着：不叠加、不重复扣血
          const loss = unit.hp * 0.5;
          if (loss > 0 && unit.hp - loss >= 1) {
            unit.hp -= loss;                                    // 失去当前生命值的 50%（2026-10-17：不再给屏障）
            battle.fx('buff', { x: unit.x, y: unit.y, id: unit.id, kind: 'yato2:oni' });
          }
          battle.addBuff(unit, { key: ONI, visible: true, source: unit, mods: ONI_MODS, tags: ['trait'] });
        };
        const dropOni = () => { const b = unit.findBuff(ONI); if (b) battle.removeBuff(unit, b); };
        // ownerId 只用于读盟约层数，不该决定"部署失血 + 上狂龙症"是否发生（旧实现在这里 return，
        // 再部署路径上 ownerId 一旦为空就既不扣血也不上 buff —— 业主报障"再部署后不流血"的一半成因）
        battle.on('deploy', (c) => {
          if (c.unit !== unit || !up(unit)) return;
          grantOni();
        }, { owner: unit });
        battle.on('death', (c) => { if (c.unit === unit) dropOni(); }, { owner: unit });
        battle.on('tick', () => {
          if (!up(unit) || unit.ownerId == null) return;
          const ps = battle.getPlayer?.(unit.ownerId);
          const rec = ps?.bonds ?? {};
          const have = unit.findBuff('garrison:yato2:atk');
          // 层数 =【东】【突袭】【不屈】中**已激活**盟约的层数合计（未激活的不计入，2026-10-14 三次修订；
          // 全部未激活 → 无攻击加成）。流血不再由层数驱动：它属于【狂龙症】，从部署起持续到死亡/撤退。
          const pool = [DONG, RAID, INDOM];
          let L = 0, any = false;
          for (const id of pool) {
            const b = rec[id];
            if (!(b?.active)) continue;
            any = true;
            L += b.layers ?? 0;
          }
          if (!any) {
            if (have) battle.removeBuff(unit, have);
            return;
          }
          const n = Math.floor(L / 3);
          if (n > 0) {
            const want = per * n;
            if (have && Math.abs((have.data?.v ?? 0) - want) > 1e-9) battle.removeBuff(unit, have);
            if (!have || Math.abs((have.data?.v ?? 0) - want) > 1e-9) {
              battle.addBuff(unit, { key: 'garrison:yato2:atk', persist: true, allowDead: true, visible: true, mods: { atkPct: want }, data: { v: want }, tags: ['garrison'] });
            }
          } else if (have) battle.removeBuff(unit, have);
        }, { owner: unit });
        battle.every(1, () => {
          if (!unit.deployed) { dropOni(); return; }             // 撤退（离场）也结束【狂龙症】
          if (!up(unit)) return;                                 // 倒地：buff 已由 death 钩子摘掉
          if (!unit.findBuff(ONI)) return;                       // 没有【狂龙症】就不流血
          // 流失 100 点/干员秒（1 干员秒 = 1 引擎秒；2026-10-14 三次修订 50→100）；若会减成负数 → 流失全部当前生命
          // （= 受到致命伤害，走 fatal 流程：死战/不屈等照常结算）
          const loss = Math.min(100, unit.hp);
          if (loss > 0) battle.loseHp(unit, loss, { source: unit, tags: ['garrison:yato2:drain'] });
        }, { owner: unit });
      },
    };
  },
};
