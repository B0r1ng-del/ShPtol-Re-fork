// server/match/match/settle.js — Match methods: SETTLE (the LP loss — a leaker's 联防 survivors —, stats, bounty coins,
// the IN_BATTLE layer gains clamped by layerGainRoom, CHAR_DAMAGE tickers, eliminations, the 联防 outcome the SETTLE
// view carries) and RESULT (finish: m.result to every human still here, onEnd).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, layerGainRoom } from '../../../shared/constants.js';
import { uniteSurvivors } from '../unite.js';
import { buildResult } from '../results.js';
import { FLOW_TICKER_PRIORITY, DELAYS } from './common.js';
import { consumeRelicLpLoss, reviveSelf, settleRelics } from '../relics.js';
import { msg } from '../../../shared/i18n.js';
import { onSettle, resetRoundCounters } from '../botEmotes.js';
import { creditedKillsOf } from '../../sim/spec.js';

export class MatchSettle {
  settle(plan, uniteResult) {
    this.phase = PHASE.SETTLE;
    this.runner = null;
    this._stopClientCombat();
    // the pending in-battle gains the views showed become persistent below (alive players) or lapse (DESIGN §20.15)
    for (const ps of this.order) if (ps.pendingLayerGains) { ps.pendingLayerGains = null; ps.dirty(); }
    const cap = this.gd.lpCapPerRound;
    // a 联防 battle that could not run at all (synthetic result) must not wipe the leakers' losses: charge their own leaks
    const uniteRan = !!(plan && uniteResult && !uniteResult.synthetic);
    const survivors = uniteRan ? uniteSurvivors(plan, uniteResult) : null;
    // The 联防's outcome as data for the SETTLE view (m.public.uniteResult, views.js; GitHub #235, PR #112 by @Convey123):
    // each client pops the official result box from it (ui/gameLogic/phases.js uniteResultBox) — `through` = the leakers'
    // enemies that still got through (uncapped; only decides whether 「全员无伤！」 is true), `losses` = every alive
    // player's own LP charge of this round, the same `loss` deducted below, so the box and the LP bar never disagree. A
    // leaker's own battle leaks are not its charge in a 联防 round, which is why the client cannot work the number out
    // itself. No ticker line: the official reports the outcome in the one dialog. null when no 联防 resolved.
    this.uniteResultView = uniteRan && plan.leakers.length ? {
      through: plan.leakers.reduce((n, lk) => n + Math.max(0, survivors.get(lk.playerId) || 0), 0),
      helpers: plan.helpers.map((p) => p.playerId),
      leakers: plan.leakers.map((p) => p.playerId),
      losses: {},
    } : null;
    const alive = this.alivePlayers();
    // 六.E: the collectible-adjusted charge is no longer derivable from the leak count (a shield absorbs part of it, a
    // 时间机器 reverses it), so SETTLE publishes the number itself (`m.public.roundLosses`, read by the result dialog).
    // Only with the switch on — an off match keeps its payload exactly as before.
    if (this.relicsOn) this.roundLossesView = { round: this.round, losses: {} };
    for (const ps of alive) {
      const r = this.lastResults.get(ps.playerId) || { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0 };
      const counted = (r.leaked || []).filter((l) => l && l.counted !== false).length;
      const rawLoss = uniteRan && plan.leakers.includes(ps) ? Math.min(cap, survivors.get(ps.playerId) || 0) : Math.min(cap, counted);
      // 六.E: 时间机器 reverses this round's loss and 护盾 absorbs part of it (both only with the switch on; the helpers
      // read no relic while `ps.relics` is empty, but the gate keeps every collectible path behind the one flag)
      const loss = this.relicsOn ? consumeRelicLpLoss(ps, rawLoss) : rawLoss;
      if (this.roundLossesView) this.roundLossesView.losses[ps.playerId] = loss;
      if (this.uniteResultView) this.uniteResultView.losses[ps.playerId] = loss;
      ps.lp -= loss;
      ps.stats.lpLost += Math.max(0, loss);
      ps.stats.leaks += counted;
      ps.stats.kills += Number(r.killed) || 0;
      ps.stats.dmgDealt += Number(r.damageDealt) || 0;
      ps.stats.healing += Number(r.healingDone) || 0;
      if (r.perfect !== false && counted === 0) ps.stats.perfectRounds++;
      // bounty coins (own battle + unite kills) are credited to the next prep
      let coins = Math.max(0, Math.trunc(Number(r.coins) || 0));
      const up = uniteResult && uniteResult.perPlayer && uniteResult.perPlayer[ps.playerId];
      if (up) {
        coins += Math.max(0, Math.trunc(Number(up.coins) || 0));
        ps.stats.dmgDealt += Number(up.damageDealt) || 0;
        ps.stats.kills += Number(up.killed) || 0;
      }
      ps.creditedKills += creditedKillsOf(r) + creditedKillsOf(up);
      // perfect-payout bounties (战术特训): own phase perfect
      for (const b of ps.bounties) if (b.card.payout === 'perfect' && counted === 0 && r.perfect !== false) coins += b.card.coin;
      if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
      for (const b of ps.bounties) b.roundsLeft--;
      ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
      // IN_BATTLE layer gains (normal battles only), at most the room left under the match's layer ceiling (the
      // official 999, as the battle's live copy: Battle.addLayers; Infinity while 解除叠层上限 is on); a bond at the cap
      // gains nothing and dispatches nothing
      for (const [bondId, n] of Object.entries(r.layerGains || {})) {
        if (!this.gd.bond(bondId) || !(n > 0)) continue;
        const before = ps.layers[bondId] || 0;
        const add = layerGainRoom(before, Math.floor(n), this.gd.layerCap);
        if (!(add > 0)) continue;
        ps.layers[bondId] = before + add;
        this.dispatch(ps, 'onLayers', { bondId, from: before, to: ps.layers[bondId], reason: 'battle' });
      }
      this._charDamageTickers(ps, r);
      this.dispatch(ps, 'onBattleResult', { result: r, lpLoss: loss, perfect: counted === 0 && r.perfect !== false, unite: uniteResult || null });
      // 六.E: this round's shield expires; 「时光之末」 revives a player the loss just eliminated; a surviving player with
      // a perfect (or 逆风) round draws a collectible offer. All three are behind the one switch.
      if (this.relicsOn) {
        ps.relicShield = 0;
        reviveSelf(ps);
        if (ps.lp > 0) settleRelics(ps, r, { completed: r.relicCompleted === true });
      }
      ps.recompute();
    }
    for (const ps of alive) {
      if (ps.lp <= 0) {
        ps.lp = 0;
        ps.eliminate(this.round);
        this.toast(ps, 'error', '你的目标生命值耗尽，已被淘汰');
        this.tickerText(msg('{name}博士的目标生命值已耗尽', { name: ps.name }), FLOW_TICKER_PRIORITY);
      }
    }
    this.fields = [];
    this.watchers.clear();
    this.markPublic();
    onSettle(this); // one emote per alive AI per round (enabled by default; SP_BOT_EMOTES=0 silences it)
    // 六.E: a pending collectible choice (multiplayer: up to 30 s) holds the phase open before the next round; off, the
    // phase's own SETTLE deadline runs exactly as before.
    if (this.relicsOn) this._waitRelicChoices(() => this.afterSettle());
    else this.setDeadline(DELAYS.SETTLE / 1000, () => this.afterSettle(), { silent: this.soloUntimed });
  }

  /**
   * CHAR_DAMAGE tickers: one per board unit of the battle (its highest threshold); units created in battle (summons,
   * no board uid) count once per unit type (the highest of them) — a result can never announce more units than the
   * lineup has kinds of.
   */
  _charDamageTickers(ps, r) {
    const steps = (Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts : []).filter((b) => b.type === 'CHAR_DAMAGE' && Array.isArray(b.params)).map((b) => Number(b.params[0])).filter((n) => n > 0).sort((a, b) => b - a);
    if (!steps.length) return;
    const board = new Set();
    for (const p of ps.board.values()) board.add(p.uid);
    const best = new Map();
    for (const u of r.unitStats || []) {
      if (!u) continue;
      const key = Number.isInteger(u.uid) && board.has(u.uid) ? `uid:${u.uid}` : `def:${u.defId}`;
      const cur = best.get(key);
      if (!cur || (Number(u.dmg) || 0) > (Number(cur.dmg) || 0)) best.set(key, u);
    }
    for (const u of best.values()) {
      const hit = steps.find((s) => (u.dmg || 0) >= s);
      if (hit) this.tickerFor('CHAR_DAMAGE', [ps.name, u.name || u.defId, String(hit)], { playerId: ps.playerId, param: String(hit) });
    }
  }

  afterSettle() {
    if (!this.alivePlayers().length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    resetRoundCounters(this); // AI bot merge-counter resets each round (server/match/botEmotes.js)
    this.startRound(this.round + 1);
  }

  finish({ victory, hiddenCleared = false, reason = 'defeat' }) {
    if (this.ended || this.disposed) return;
    this.ended = true;
    if (this.runner) { try { this.runner.stop(); } catch { /* ignore */ } this.runner = null; }
    this._stopClientCombat();
    this.cancel(this._phaseTimer);
    this.cancel(this._turnTimer);
    for (const h of this._timers) { try { this.sched.clearTimeout(h); } catch { /* ignore */ } }
    this._timers.clear();
    this.phase = PHASE.RESULT;
    this.deadline = 0;
    for (const f of this.fields) f.live = false;
    this.outcome = { victory: !!victory, hiddenReached: this.hiddenReached, hiddenCleared: !!hiddenCleared, reason };
    let result;
    try {
      result = buildResult(this, this.outcome);
    } catch (e) {
      this.reportError('buildResult', e);
      result = { t: 'm.result', victory: !!victory, roundsPassed: 0, reason, modeId: this.modeId, difficulty: this.difficulty, players: [] };
    }
    this.lastResultMsg = result;
    this.markPublic();
    try { this.flush(true); } catch (e) { this.reportError('flush', e); }
    // every human still here gets the settlement — the spectator seats the same public rows (none of them their own)
    for (const ps of this._viewers()) this.sendTo(ps.playerId, { ...result, playerId: ps.playerId });
    const { t, ...summary } = result;
    void t;
    summary.errors = this.errorCount;
    try { this.onEndFn(summary); } catch (e) { this.reportError('onEnd', e); }
  }
}
