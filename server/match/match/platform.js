// server/match/match/platform.js — Match methods: the platform interface of the server/match/Match.js header
// (server/lobby.js ⇄ Match) — start, handle (validation, error isolation, flush; the intents themselves: intents.js
// _handle), setLoadout (INFO_CHECK only), onDisconnect / onReconnect and the full resync of one human, onLeave and 中途退出
// = elimination (_quit), dispose.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { C2S } from '../../../shared/protocol.js';
import { autoSelectRelic } from '../relics.js';
import { PHASE, ERR } from '../../../shared/constants.js';
import { syntheticResult } from '../fields.js';
import { FLOW_TICKER_PRIORITY, OK, fail } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { behaviourValue, BEHAVIOUR_SWITCHES } from '../../../shared/behaviour.js';

const GAME_TYPES = new Set(Object.keys(C2S).filter((t) => Object.hasOwn(C2S, t) && (t.startsWith('g.') || t.startsWith('b.'))));

/**
 * 工坊 mod 层 (behaviour `prepLoadout`): the phase sets `room.loadout` is accepted in. `locked` is the official rule
 * (INFO_CHECK only — what this file used to spell out inline); `prep` additionally accepts the 休整期.
 */
export const LOADOUT_PHASES = Object.freeze({ locked: Object.freeze([PHASE.INFO_CHECK]), prep: Object.freeze([PHASE.INFO_CHECK, PHASE.PREP]) });

/**
 * The phases THIS match accepts `room.loadout` in.
 *
 * ★ 需求方 2026-10-23：「允许玩家在局内的整备阶段修改干员的技能」—— 于是 **PREP 成为默认可改的阶段**，不再需要包声明
 * `prepLoadout: "prep"`。业主同时明确：**只影响这一局**（包含往后的全部回合），大厅的干员调配不受影响，下一局仍以
 * 大厅那份为准 —— 这正是本文件既有行为的语义（`ps.setLoadout` 改的是**这一场**的 PlayerState；座位的 `seat.loadout`
 * 只在大厅 / INFO_CHECK 由 `room.loadout` 写入），所以只需要把默认阶段集从 `locked` 换成 `prep`。
 *
 * 包仍然可以说 `locked` 把这一格收回去（那是「收紧」，on-by-default 之后仍然允许 —— 与 `behaviourIsDefault` 的
 * 「没声明 = 官方」不同，这里没声明 = **新默认**）。为了不破坏既有包的语义，判据改成：**只有显式声明 `locked` 才收**，
 * 其余（没声明 / 声明 prep）都给 PREP。
 * @param {Array<{ switch: string, option: string }>|null|undefined} decl the match's behaviour declaration
 * @returns {readonly string[]}
 */
export function loadoutPhasesFor(decl) {
  // 按**生效值**判断：`behaviourValue` 对「没声明」返回 null，所以这里显式回落到表里的 default（现在是 `prep`）。
  // `locked` ⇒ 只有 INFO_CHECK（包显式收紧）；其余（没声明 / prep）⇒ INFO_CHECK + PREP。
  const v = behaviourValue(decl, 'prepLoadout') ?? BEHAVIOUR_SWITCHES.prepLoadout.default;
  return v === 'locked' ? LOADOUT_PHASES.locked : LOADOUT_PHASES.prep;
}

/**
 * 工坊 mod 层 (behaviour `prepLoadout: "prep"`): a PREP-phase `room.loadout` OVERLAYS this round's issue instead of
 * replacing it — the player re-equips some operators, the rest keep what the round handed them. Only the pack path
 * reaches this (the default gate stops at INFO_CHECK), so the official flow never merges anything.
 * @param {Record<string, any>|null|undefined} current the loadout the round issued
 * @param {Record<string, any>|null|undefined} incoming the entries this submit names
 * @returns {Record<string, any>}
 */
export function mergeLoadoutEntries(current, incoming) {
  const out = { ...(current && typeof current === 'object' ? current : {}) };
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    for (const [id, entry] of Object.entries(incoming)) {
      if (entry && typeof entry === 'object' && !Array.isArray(entry)) out[id] = entry;
    }
  }
  return out;
}

export class MatchPlatform {
  start() {
    if (this.disposed || this.ended || this.phase !== PHASE.LOBBY) return;
    this.guard(() => {
      if (!this.gd.visibleChess.length || this.pool.entries.size === 0) {
        this.log.error?.(`[match ${this.roomCode}] game data unusable (no chess pool) — ending the match`);
        this.phase = PHASE.INFO_CHECK;
        this.markPublic();
        this.flush(true);
        this.finish({ victory: false, reason: 'error' });
        return;
      }
      this.enterInfoCheck();
    });
  }

  /**
   * @param {string} playerId
   * @param {{ t: string }} msg validated intent
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  handle(playerId, msg) {
    const ps = this.players.get(playerId) || this.spectators.get(playerId);
    if (!ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    // a spectator seat only watches (the platform routes nothing else of it)
    if (ps.spectator && (!msg || msg.t !== 'g.watch')) return fail(ERR.SPECTATOR);
    if (this.disposed || this.ended) {
      // A report that crossed the match end (the last b.progress of a field, a delegated rehearsal's answer) is stale:
      // ignored, never an error (DESIGN §14 — an error frame without a rid would surface as a toast in the browser).
      if (msg && msg.t === 'b.rehearsalResult') return OK;
      return this.clientCombat && msg && (msg.t === 'b.progress' || msg.t === 'b.result') ? OK : fail(ERR.WRONG_PHASE);
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string' || !GAME_TYPES.has(msg.t)) return fail(ERR.BAD_MSG);
    let res;
    try {
      res = this._handle(ps, msg);
    } catch (e) {
      this.reportError(`handle ${msg.t}`, e);
      res = fail(ERR.INTERNAL);
    }
    try { this.flush(); } catch (e) { this.reportError('flush', e); }
    if (res && typeof res === 'object' && res.error) return res;
    return OK;
  }

  /**
   * room.loadout during the match (DESIGN §16): only while INFO_CHECK runs (the briefing's 干员调配 entry); the lobby
   * already checked it against the data (PlayerState.setLoadout re-checks it). `ops` (0.2.2): the per-operator 潜能 /
   * 练度 that come with it (undefined = unchanged).
   * @param {string} playerId
   * @param {Record<string, { skill: number, module: string|null }> | null} loadout
   * @param {Record<string, { potential: number, cultivate: number }> | null} [ops]
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  setLoadout(playerId, loadout, ops = undefined) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left) return fail(ERR.NOT_IN_ROOM);
    // 工坊 mod 层移植 (2026-10-16, behaviour `prepLoadout`): the phases this match accepts room.loadout in. With no
    // such declaration `loadoutPhasesFor` returns LOADOUT_PHASES.locked = [INFO_CHECK], which is exactly the gate
    // this line used to spell out — a vanilla match is byte-identical, and a pack may additionally open PREP.
    const phases = loadoutPhasesFor(this.behaviour);
    if (this.disposed || this.ended || !phases.includes(this.phase)) return fail(ERR.WRONG_PHASE, 'loadout locked for this match');
    // 工坊 mod 层 (behaviour `prepLoadout: "prep"`): in 休整期 the submit OVERLAYS this round's issue, and a seat that
    // has already readied up has locked its issue in. Neither branch is reachable on the default gate (which stops at
    // INFO_CHECK), so the official flow takes the plain path below unchanged.
    const inPrep = this.phase === PHASE.PREP && phases.includes(PHASE.PREP);
    if (inPrep && ps.ready) return fail(ERR.WRONG_PHASE, 'loadout locked for this match (this seat has readied up)');
    const entries = inPrep ? mergeLoadoutEntries(ps.loadout, loadout) : loadout;
    let res = OK;
    this.guard(() => {
      if (!ps.setLoadout(entries, ops)) { res = fail(ERR.BAD_TARGET, 'loadout does not match the game data'); return; }
      this.markPrivate(ps);
    });
    return res;
  }

  onDisconnect(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || this.disposed) return;
    this.guard(() => {
      ps.connected = false;
      // 六.E: a disconnected player's open collectible offer is auto-picked, so the others are not held by the choice
      if (this.relicsOn && ps.relicOffer) { autoSelectRelic(ps); this._completeRelicChoices(); }
      // A disconnected human's silence is never consent to a new setup.
      this.cancelSetupVote();
      // a paused solo battle resumes (the server takes the field over; nobody is left to resume it)
      this._resume();
      if (this.clientCombat) this._authorityLost(ps, 'disconnect');
      // a rehearsal this host was running falls back to the server (DESIGN §14; a no-op without tasks)
      this._rehearsalHostChanged();
      this.markPublic();
    });
  }

  onReconnect(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || this.disposed) return;
    this.guard(() => {
      const was = ps.connected;
      ps.connected = true;
      this._resync(ps);
      if (!was) this.markPublic();
    });
  }

  /**
   * The full state of one human (a reconnect, a resync, a spectator seat): m.public, its m.private (players only), the
   * field it is on / watches — a spectator, like an eliminated player, the field of the player it follows (item 56),
   * else the first; in a prep phase that player's board — or the result once ended.
   */
  _resync(ps) {
    const playerId = ps.playerId;
    this.sendTo(playerId, this.publicView());
    if (!this.ended) {
      if (!ps.spectator) {
        ps._lastPriv = null;
        this._sendPrivate(ps, true);
      }
      if (this.clientCombat) this._resendBattle(ps);
      else if (!this.fields.length && this._follows(ps)) this._followScout(ps, { keep: true });
      else {
        let fid = this.watchers.get(playerId);
        if (!fid && ps.spectator && this.fields.length) { fid = (this._watchTargetField(ps, this.fields) || this.fields[0]).fieldId; this.watchers.set(playerId, fid); }
        if (fid) this._sendField(playerId, fid);
      }
    } else if (this.lastResultMsg) {
      this.sendTo(playerId, { ...this.lastResultMsg, playerId });
    }
  }

  onLeave(playerId) {
    const ps = this.players.get(playerId);
    if (!ps || ps.isBot || ps.left || this.disposed) return;
    this.guard(() => {
      ps.left = true;
      this.cancelSetupVote();
      ps.connected = false;
      ps.autoplay = false;
      this.watchers.delete(playerId);
      if (this.ended) return;
      this._resume();
      if (this.clientCombat) this._authorityLost(ps, 'left');
      // a rehearsal the departed seat was running falls back to the server (DESIGN §14; a no-op without tasks)
      this._rehearsalHostChanged();
      this.markPublic();
      if (!this.order.some((p) => !p.isBot && !p.left)) {
        this.finish({ victory: false, reason: 'abandoned' });
        return;
      }
      this._quit(ps);
    });
  }

  /**
   * 中途退出 counts as elimination (research 00-INDEX §3, 01 §9, 06 §7 / §10.3): every copy the player holds goes back
   * to the shared pool at once, and the seat has no place in later rounds, the Final Assault pairing or the boss pool
   * (bloodPoint per player alive at the fight's start, DESIGN §25.13.4). Rounds passed = the rounds the player had
   * survived when leaving.
   */
  _quit(ps) {
    this.maybeEndInfo();
    if (!ps.alive) return;
    const phase = this.phase;
    const d = this.draft;
    if (phase === PHASE.BAND_DRAFT && d && !d.picks[ps.playerId]) {
      // the departed seat passes its turn with the default band (never one a teammate holds — defaultBand)
      const turn = this.draftTurn() === ps.playerId;
      d.picks[ps.playerId] = this.defaultBand(ps.playerId);
      ps.bandId = d.picks[ps.playerId];
      if (turn) this.startDraftTurn();
    }
    const passedRound = phase === PHASE.SETTLE ? this.round + 1 : Math.max(1, this.round);
    // its own normal battle has nobody left to fight for
    for (const f of this.fields) {
      if (f.live && f.kind === 'normal' && f.players.length === 1 && f.players[0] === ps.playerId) {
        if (this.clientCombat && f.cc) {
          if (!f.result) f.result = syntheticResult(f.players);
          this._fieldDone(f);
          continue;
        }
        try { f.battle.forceEnd('left'); } catch (e) { this.reportError('quit forceEnd', e); }
      }
    }
    ps.lp = 0;
    ps.eliminate(passedRound);
    this.tickerText(msg('{name}博士中途退出了模拟', { name: ps.name }), FLOW_TICKER_PRIORITY);
    if (this.bossWaves && (phase === PHASE.ROUND_START || phase === PHASE.SP_DRAFT || phase === PHASE.PREP)) {
      // before the boss fight: pair the players left again (the prep preview shows the new partner / template); a
      // player moved to the other half re-checks its board there at once (recompute → deployMap, marks it private)
      this._planBossWaves();
      for (const p of this.alivePlayers()) p.recompute();
    }
    // whoever scouted the departed player's board follows the next player still in (item 56)
    for (const v of this._viewers()) if (this.watchers.get(v.playerId) === `n:${ps.playerId}`) this._followScout(v);
    this.markPublic();
    if (this.teamLp != null) this._syncTeamLp();
    if (!this.alivePlayers().length) {
      // only eliminated spectators are left
      this.finish({ victory: false, reason: 'eliminated' });
      return;
    }
    if (phase === PHASE.SP_DRAFT && this.sp && this.spTurn() === ps.playerId) this.startSpTurn();
    else if (phase === PHASE.PREP) this.maybeEndPrep();
    // 六.E: a player who left had an open collectible offer — re-check whether the phase can go on without them
    else if (phase === PHASE.SETTLE) this._completeRelicChoices();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.runner) { try { this.runner.stop(); } catch { /* ignore */ } }
    this._stopClientCombat();
    this._cancelRehearsal();
    for (const h of this._timers) { try { this.sched.clearTimeout(h); } catch { /* ignore */ } }
    this._timers.clear();
    if (this._pubTimer) { try { this.sched.clearTimeout(this._pubTimer); } catch { /* ignore */ } this._pubTimer = null; }
    if (this.ownsScheduler) this.sched.dispose();
  }
}
