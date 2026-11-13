// server/match/match/combat.js — Match methods: the battles of a normal round — Battle construction (newBattle, the
// spawn list sanitised, a player's normal field after the onBattleStart handlers), the COMBAT phase in both modes
// (server-run streaming, client-side combat), the per-field results and the sim-error log, then 联防 or SETTLE.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO, CHEAT_ENEMY_HP } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { withBounties, anyEnemy } from '../waves.js';
import { redistributeRelicWaves } from '../relicWaves.js';
import { planUnite } from '../unite.js';
import { FieldRunner, DeadBattle } from '../fields.js';
import { DELAYS } from './common.js';
import { previewPlayer } from '../preview.js';
import { morphBattleOpt } from '../../../shared/plugins/rules.js';
// 危机合约 (shared/crisis.js): the one place a contract's compiled numbers touch the engine.
import { applyCrisisFx, crisisEnemyMul, crisisSpawnRhythm } from './crisisFx.js';
import { planCrisisM5 } from './crisisM5.js';
import { crisisSpecialSpawns } from './crisisSpecial.js';
import { crisisSquadSpawns, crisisPairSpawns, crisisTogetherSpawns, Q4_KEYS, Q9_KEYS, Q4_WINDOW, Q9_WINDOW, Q8_GUARD_KEYS, Q8_BLADE_KEYS, Q8_WINDOW } from './crisisSpawnShape.js';
import { crisisNamedEnemyMul } from './crisisQTargets.js';

export class MatchCombat {
  /** Construct a battle; a constructor failure yields a finished stand-in (clean result) and is logged. */
  newBattle(opts, { preview = false } = {}) {
    const full = { data: this.ds, content: this.battleContent, logger: this.log, ...opts, ...morphBattleOpt(this.rules),
      ...(preview ? { logger: {}, quiet: true } : {}) };
    try {
      const battle = new this.BattleClass(full);
      // 危机合约: E1 / F1 ride on the deploy hook; A1 / B1 are already folded into the spawn list by _crisisSpawns. Nothing
      // is installed for an ordinary room (this.gd.crisisFx is null), so a normal battle stays untouched.
      if (this.gd.crisisFx) applyCrisisFx(battle, this.gd.crisisFx);
      return battle;
    } catch (e) {
      if (!preview) this.reportError(`battle ${opts.fieldId} construct`, e);
      return new DeadBattle(full, 'forced');
    }
  }

  /**
   * Spawn list of a field after the onBattleStart handlers (which may edit `ev.spawns`): malformed entries are dropped
   * and a kill bounty is copied into `mods.bountyCoins`, so a leaked bounty enemy keeps paying its killer in 联防.
   */
  _sanitizeSpawns(list, ownerPlayerId = null) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      // ★ 弧光的契约敌人在 data/enemies-crisis.json：用 gd.enemy() 判会把整条 spawn 丢掉（敌人一个都不出场）。
      //   其它赛季保持 gd.enemy() —— 放宽它会让普通对局的队伍构成漂移。
      const known = this.gd.arcSeason ? anyEnemy(this.gd, s.enemyKey) : this.gd.enemy(s.enemyKey);
      if (!s || typeof s !== 'object' || typeof s.enemyKey !== 'string' || !known) continue;
      const spec = { ...s, mods: s.mods && typeof s.mods === 'object' ? { ...s.mods } : {} };
      if (ownerPlayerId && spec.ownerPlayerId == null) spec.ownerPlayerId = ownerPlayerId;
      const coins = spec.bounty && typeof spec.bounty === 'object' ? Math.trunc(Number(spec.bounty.coins) || 0) : 0;
      if (coins > 0 && spec.mods.bountyId == null && spec.mods.bountyCoins == null) spec.mods.bountyCoins = coins;
      out.push(spec);
    }
    return out;
  }

  /**
   * 危机合约 T4：把当回合「特殊类」敌人（acType === 'SPECIAL'）里最后 30% 改成第 30 秒从两个公开入口
   * 同时出生，总数不变。没装 T4 时 crisisSpecialSpawns 原样返回 list。
   */
  /**
   * 危机合约 Q4 / Q9 的 II 档：方阵成队（interval × squad）与穿刺手两名一组（+ 生命 20%）。
   * 两者都只整形 spawn 列表，总数不变；没装对应合约时原样返回同一个数组。
   */
  _crisisShapeSpawns(list) {
    const fx = this.gd.crisisFx;
    if (!fx || !Array.isArray(list)) return list;
    let out = list;
    if (fx.Q4 && typeof fx.Q4 === 'object') {
      out = crisisSquadSpawns(out, fx.Q4, Q4_KEYS, this.round, Q4_WINDOW);
    }
    if (fx.Q9 && typeof fx.Q9 === 'object') {
      out = crisisPairSpawns(out, fx.Q9, Q9_KEYS, this.round, Q9_WINDOW);
    }
    if (fx.Q8 && typeof fx.Q8 === 'object') {
      out = crisisTogetherSpawns(out, fx.Q8, Q8_GUARD_KEYS, Q8_BLADE_KEYS, this.round, Q8_WINDOW);
    }
    return out;
  }

  _crisisSpecialSpawns(list) {
    const fx = this.gd.crisisFx;
    if (!fx || !fx.T4) return list;
    return crisisSpecialSpawns(this.gd, list, fx.T4, this.round);
  }

  /**
   * 危机合约 R4：把本回合被标记的精英（pickCrisisMark 选出）生命提高 —— 只改它自己 spawn 的 mods，
   * 走的是 spawns.js 已经支持的通道（和 A1/B1 的合约倍率同一个位置）。没装 R4 时 this.crisisMarkThisRound
   * 恒为 undefined，list 原样返回。
   */
  _crisisMarkSpawns(ps, list) {
    const key = this.crisisMarkThisRound;
    if (!key || !Array.isArray(list)) return list;
    const r4 = this.gd.crisisFx && this.gd.crisisFx.R4;
    if (!r4 || typeof r4 !== 'object') return list;
    const mul = Number.isFinite(r4.hpMul) && r4.hpMul > 0 ? r4.hpMul : 1.25;
    return list.map((s) => {
      if (!s || (s.enemyKey || s.key) !== key) return s;
      const prev = s.mods && Number.isFinite(s.mods.maxHpMul) ? s.mods.maxHpMul : 1;
      return { ...s, mods: { ...(s.mods || {}), maxHpMul: prev * mul } };
    });
  }

  _normalBattle(ps) { return this.newBattle(this._normalOpts(ps)); }

  /**
   * 六.E 解压玩具 (relic_156): each player's normal-round spawns before bounties are placed — the collectible halves a
   * holder's enemies and hands them to the other alive players (or, on its 10 % trigger, concentrates all of them on one
   * holder). Only reached with `packRelic` on; a match without the switch keeps its own spawns (see `_normalOpts`).
   */
  _normalRelicSpawns() {
    const plans = this.alivePlayers().filter((ps) => !ps.left).map((ps) => ({
      ps, routes: this.wave.routes,
      spawns: withBounties(this.gd, this.round, this.wave, ps.bounties, ps.playerId).map((s) => ({ ...s, ownerPlayerId: ps.playerId })),
    }));
    return redistributeRelicWaves(plans, { solo: this.isSolo, round: this.round, seed: this.seed });
  }

  /** Battle options of a player's normal field (after the onBattleStart handlers). */
  _normalOpts(ps, { preview = false, board = ps.board } = {}) {
    const wave = preview ? structuredClone(this.wave) : this.wave;
    if (preview) ps = previewPlayer(ps, board);
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    // the client's list: bounty units inserted among their host action's own units, which are re-timed around them.
    // ★ 2026-11-08: with 六.E on, the wave a battle fields is the one `_normalRelicSpawns` redistributed — 解压玩具
    // (relic_156) halves a holder's enemies and hands them to the others, or concentrates them on one holder on its 10 %
    // trigger. views.js:322 already rendered the PREP preview from that list, but this live path kept the raw wave, so
    // the preview and the battle disagreed (test/match/relic-waves.test.js:61 'both ends field 9 / 1' caught it: the
    // battle fielded 5 and never moved one). Read the redistribute for the live path too; with the switch off
    // `relicsOn` is false and this stays exactly `withBounties(...)` as before, so no official match changes.
    const relicSpawns = this.relicsOn ? this._normalRelicSpawns().get(ps.playerId) : null;
    const spawns = (relicSpawns || withBounties(this.gd, this.round, wave, ps.bounties, ps.playerId)).map((s) => ({ ...s, ownerPlayerId: ps.playerId }));
    // `waveSpawns`: the round's own wave before this player's bounties (a copy), so a draw every player shares picks the
    // same units (鸭爵, GitHub #839)
    const waveSpawns = (wave.spawns || []).map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    const ev = { input, kind: 'normal', round: this.round, spawns, waveSpawns, ...(preview ? { preview: true } : {}) };
    // Preview construction failures go to the rehearsal's discard path, never Match.dispatch's live error sink.
    if (preview) this.dispatcher.dispatch(ps, 'onBattleStart', ev);
    else this.dispatch(ps, 'onBattleStart', ev);
    const list = this._sanitizeSpawns(Array.isArray(ev.spawns) ? ev.spawns : spawns, ps.playerId);
    const mainBond = this._crisisMainBondOf(ps);
    return {
      seed: deriveSeed(this.seed, `n:${this.round}:${ps.seat}`),
      kind: 'normal',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: { ...GEO.NORMAL_RECT },
      timeLimit: wave.timeLimit,
      players: [ev.input && typeof ev.input === 'object' ? ev.input : input],
      // 危机合约 A1 / B1: the contract's enemy multipliers fold into each spawn's own `mods` — the same channel the
      // 作弊 switch uses just below. spawns.js multiplies them in AFTER the enemy's data and `enemyOverrides`, so a
      // contract raises whatever the wave actually spawns, not a table value the wave may have replaced.
      spawns: crisisSpawnRhythm(
        this._crisisSpawns(
          this._cheatSpawns(ps, this._crisisMarkSpawns(ps, this._crisisShapeSpawns(this._crisisSpecialSpawns(list))), wave.overrides),
        ),
        this.gd.crisisFx,
      ),
      routes: wave.routes,
      sharedBoss: null,
      // 危机合约 (shared/crisis.js): the contract's compiled effects travel ON THE SPEC, beside the other rules flags —
      // the server builds its own battle from this same object and every client replica reads it, so the numbers a
      // fight applies and the numbers the effects column shows come from one place. `crisisFx` is absent on an ordinary
      // room, which keeps an ordinary spec byte-identical to what it was.
      flags: {
        layerGainsEnabled: true,
        uncapLayers: this.gd.uncapLayers,
        ...this.gd.dp,
        ...(this.gd.crisisFx ? { crisisFx: this.gd.crisisFx } : {}),
        // 危机合约 U1：这名玩家是不是本回合的承压位（crisisFx 只读这个 flag）
        ...(ps.crisisPressure ? { crisisPressure: true } : {}),
        // 危机合约 R4：本回合被标记的精英 key（crisisFx 只读这个 flag；没装 R4 时不写）
        ...(this.crisisMarkThisRound && this.gd.crisisFx && this.gd.crisisFx.R4 ? { crisisMark: this.crisisMarkThisRound } : {}),
        // 危机合约 I2 / I3：这名玩家的主核心盟约（成员数 > 2 的核心盟约里最多的那个）。
        // 与 bot.js mainCoreBond 同一判据；没到 2 人以上时不登记（crisisFx 会记 skipped，不猜）。
        ...(mainBond ? { crisisMainBond: mainBond } : {}),
      },
      fieldId: `n:${ps.playerId}`,
      enemyOverrides: wave.overrides,
      waveId: wave.templateId,
    };
  }

  /**
   * 作弊菜单 「怪物血量降为 1 血」: stamp the HP multiplier onto a player's OWN normal-field spawns.
   *
   * `mods.hpMul` is the sim's existing per-spawn HP multiplier (`server/sim/battle/spawns.js`: the enemy's `def.maxHp`
   * is multiplied by it before the unit is built, and `units.js` floors the result at 1), so setting it to
   * `CHEAT_ENEMY_HP / base` lands every enemy on exactly `CHEAT_ENEMY_HP` whatever its own data HP is. The sim itself,
   * the enemy data and the `enemyOverrides` table the mode already uses are all left alone.
   *
   * `base` must be the SAME number the sim will multiply: the enemy's own `stats.maxHp` (the server's generated record
   * nests its numbers under `stats`; the sim's `normalizeEnemy` reads `stats.maxHp ?? stats.hp`), unless the wave's own
   * `enemyOverrides` replaces it — that table is applied to `def` *before* the multiplier, so it wins when present.
   * Reading `def.maxHp` off the raw record gives `undefined` and would silently skip every spawn.
   *
   * Deliberately NORMAL-FIELD ONLY: 联防 builds its spec through `_uniteOpts` (a shared field for several players), so
   * a cheat enabled by one player can never reach it — the owner's 「联防阶段不生效」. Boss / hidden fields are a shared
   * pool for the pair for the same reason and are not touched here either.
   * @param {any} ps the player whose cheats to read
   * @param {any[]} list the sanitized spawn list of that player's field
   * @param {any} overrides the field's own `enemyOverrides` table (the wave's)
   * @returns {any[]} the same list, with `mods.hpMul` forced where the switch is on
   */
  _cheatSpawns(ps, list, overrides = null) {
    if (ps?.cheats?.enemyOneHp !== true) return list;
    const ov = overrides && typeof overrides === 'object' ? overrides : {};
    return list.map((s) => {
      const def = this.gd.enemy(s.enemyKey);
      const dataHp = def && def.stats ? def.stats.maxHp ?? def.stats.hp : def && def.maxHp;
      const o = ov[(def && def.key) || s.enemyKey] ?? ov[s.enemyKey];
      const base = o && o.stats ? o.stats.maxHp ?? o.stats.hp ?? dataHp : dataHp;
      if (!Number.isFinite(base) || base <= 0) return s;
      return { ...s, mods: { ...(s.mods && typeof s.mods === 'object' ? s.mods : {}), hpMul: CHEAT_ENEMY_HP / base } };
    });
  }

  /**
   * 危机合约 A1 (敌方血量) / B1 (敌方攻击): multiply each spawn's own `mods` by the contract's factors.
   *
   * Folded into the spawn list rather than an enemy hook because that is where the engine already reads them
   * (server/sim/battle/spawns.js: `mods.hpMul` / `mods.atkMul`, applied after the enemy's own data and after
   * `enemyOverrides`). Returns the list UNTOUCHED — not a copy — when the contract has no A/B route, so an ordinary
   * round allocates nothing new and its result is unchanged.
   * @param {any[]} list
   * @returns {any[]}
   */
  /**
   * 危机合约 I2 / I3 的「主核心盟约」：成员数 > 2 的核心盟约里成员最多的那个（null = 还没登记）。
   *
   * 与 server/match/bot.js 的 mainCoreBond 同一判据（那里是 AI 选路用的私有函数），这里只是把同一个事实
   * 写进战斗 spec 的 flags，好让 crisisFx 知道该保护哪个盟约的层数。没有合约时不读也不写。
   * @param {any} ps
   * @returns {string|null}
   */
  _crisisMainBondOf(ps) {
    if (!this.gd.crisisFx || !ps || !ps.bonds) return null;
    let top = null;
    let topN = 2;
    for (const id of this.gd.bondIds) {
      const b = ps.bonds[id];
      const n = b ? b.count || 0 : 0;
      if (n > topN && this.gd.bond(id)?.isCore) { topN = n; top = id; }
    }
    return top;
  }

  _crisisSpawns(list) {
    const fx = this.gd.crisisFx;
    if (!fx) return list;
    const { hpMul, atkMul, speedMul } = crisisEnemyMul(fx);
    if (hpMul === 1 && atkMul === 1 && speedMul === 1) return list;
    return (Array.isArray(list) ? list : []).map((s) => {
      const m = s && s.mods && typeof s.mods === 'object' ? s.mods : {};
      // Q 敌群异变 names its targets by enemy key (crisisQTargets.js): only THAT enemy is touched
      const named = s && typeof s.enemyKey === 'string' ? crisisNamedEnemyMul(fx, s.enemyKey) : {};
      return { ...s, mods: {
        ...m,
        hpMul: (m.hpMul ?? 1) * hpMul * (named.hpMul ?? 1),
        atkMul: (m.atkMul ?? 1) * atkMul,
        speedMul: (m.speedMul ?? 1) * speedMul,
      } };
    });
  }

  startCombat() {
    if (this.clientCombat) { this._startCombatClient(); return; }
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    this.lastResults = new Map();
    this.fields = alive.map((ps) => ({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], battle: this._normalBattle(ps), live: true }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, { onDone: (runner) => this.combatDone(runner) });
    this.runner.start();
  }

  _startCombatClient() {
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    this.lastResults = new Map();
    this.watchers.clear();
    const fields = alive.map((ps) => this._ccField({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], opts: this._normalOpts(ps) }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._launch(fields);
    // every fighting human runs its own field; eliminated humans (and spectator seats) keep watching (research 09 §3.1
    // "Keep-watching auto-observes the first available field", switching freely with 前往查看): a replica of the field
    // of the player they follow — the one they last watched, else the first player still in (item 56) — else the first
    for (const f of fields) for (const pid of f.players) {
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left) continue;
      this.watchers.set(pid, f.fieldId);
      this._sendStart(pid, f);
    }
    const first = fields.find((f) => f.mode === 'client') || fields[0] || null;
    if (first) {
      for (const ps of this._viewers()) {
        if (ps.alive || this.watchers.has(ps.playerId)) continue;
        const f = this._watchTargetField(ps, fields) || first;
        this.watchers.set(ps.playerId, f.fieldId);
        this._sendStart(ps.playerId, f, { watch: true });
      }
    }
    this.markPublic();
  }

  /** Aggregate a finished field's content/engine errors (battle.errors: unique records) for diagnostics. */
  _collectSimErrors(f, res) {
    this.simErrors += Number(res && res.errors) || 0;
    const list = f && f.battle && Array.isArray(f.battle.errors) ? f.battle.errors : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const key = `${e.label}|${e.who || ''}|${e.message}`;
      let rec = this.simErrorLog.get(key);
      if (!rec) {
        if (this.simErrorLog.size >= 500) continue;
        rec = { label: String(e.label), who: String(e.who || ''), message: String(e.message), stack: e.stack ? String(e.stack) : null, battles: 0, count: 0 };
        this.simErrorLog.set(key, rec);
      }
      rec.battles++;
      rec.count++;
    }
  }

  combatDone(runner) { this._finishCombat((f) => runner.resultOf(f)); }

  /** Every normal field has its result: record them, then 联防 or SETTLE. */
  _finishCombat(resultOf) {
    if (this.phase !== PHASE.COMBAT) return;
    this._stopClientCombat();
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        // 六.E: `relicCompleted` marks a result a collectible offer may be drawn from (a real clear / timeout, never a
        // synthetic one). Stamped behind the switch, so an off match records the exact object it did before the port.
        this.lastResults.set(pid, this.relicsOn
          ? (pp ? { ...pp, synthetic: !!res.synthetic, relicCompleted: !res.synthetic && (res.reason === 'cleared' || res.reason === 'timeout') }
            : { killed: 0, total: 0, leaked: [], perfect: true, synthetic: true, layerGains: {}, coins: 0, damageDealt: 0, unitsEnd: [], unitStats: [] })
          : (pp || { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, unitsEnd: [], unitStats: [] }));
        // the views show the layers the battle reached until settle() makes them persistent (DESIGN §20.15)
        const ps = this.players.get(pid);
        const gains = pp && pp.layerGains && typeof pp.layerGains === 'object' ? pp.layerGains : null;
        if (ps && gains && Object.keys(gains).length) { ps.pendingLayerGains = { ...gains }; ps.dirty(); }
      }
    }
    for (const f of this.fields) f.live = false;
    this.deadline = 0;
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterCombat());
  }

  /**
   * After the COMBAT_END pause: 联防 or SETTLE. The plan is made now, from the players still in — a player who quit
   * during the last field or the pause (中途退出 = eliminated, board cleared) is neither a helper nor a leaker whose
   * enemies re-enter.
   */
  _afterCombat() {
    if (this.phase !== PHASE.COMBAT) return;
    const plan = planUnite(this, this.lastResults);
    if (plan) { this.startUnite(plan); return; }
    // 危机合约 M5：第 6/10 回合即使没有漏怪也要强制拼场（40 秒援护战，每名参加者追加两名固定精英）。
    // 没装 M5 时 planCrisisM5 恒为 null，普通房间的流程逐字节不变。
    const forced = planCrisisM5(this);
    if (forced) { this.startUnite(forced); return; }
    this.settle(null, null);
  }
}
