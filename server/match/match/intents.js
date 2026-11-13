// server/match/match/intents.js — Match methods: the g.* / b.* intent router (_handle: the prep intents go to
// PlayerState, the drafts, watching, the pause and the battle reports to the match), emotes, AI 托管 (setAutoplay,
// kickBot) and g.unitStats (the stats the board's units start their next battle with: a preview battle, started, read
// and dropped).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { unitStatsEntry } from '../../../shared/protocol.js';
import { autoSelectRelic } from '../relics.js';
import { PHASE, ERR, EMOTES, EMOTE_COOLDOWN_MS, EMOTE_BURST_COUNT, GEO, CHAT_MAX_LEN, CHAT_COOLDOWN_MS } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { OK, fail } from './common.js';
import { onHumanEmote } from '../botEmotes.js';

export class MatchIntents {
  /**
   * 危机合约 H5 / J6 的配额检查 —— 在意图真正执行**之前**拦。
   * H5：每休整期主动购买/出售/使用消耗品合计上限（免费操作也计；自动赠送、自动合成不计）。
   * J6：每休整期最多使用的「基础等价消耗装备」份数（基础品质 1 份、进阶 2 份，共用配额）。
   * 未选合约时 fx 为空 ⇒ 直接放行，零开销、零行为变化。
   */
  _crisisQuota(ps, t, msg) {
    const fx = this.gd.crisisFx;
    if (!fx) return null;
    const ACT = new Set(['g.buy', 'g.sell', 'g.equip', 'g.art', 'g.destroy']);
    const h5 = fx.H5, j6 = fx.J6;
    if (h5 && Number.isFinite(h5.cap) && ACT.has(t) && (ps.crisisActions ?? 0) >= h5.cap) {
      return fail(ERR.BAD_TARGET, 'crisis action cap reached');
    }
    if (j6 && Number.isFinite(j6.cap) && (t === 'g.equip' || t === 'g.art')) {
      // 基础品质 1 份、进阶品质 2 份，共用配额。ps.find(uid) 是引擎找棋子的唯一入口。
      const uid = msg.itemUid ?? msg.uid;
      const loc = uid != null ? ps.find(uid) : null;
      const piece = loc && loc.piece;
      if (piece && piece.kind === 'item') {
        // ★ piece 上没有 golden 字段（实测 piece.golden === undefined）—— 品质要问 gamedata。
        const cost = this.gd.isGolden(piece.id) ? 2 : 1;
        if ((ps.crisisEquipCost ?? 0) + cost > j6.cap) {
          return fail(ERR.BAD_TARGET, 'crisis equip quota reached');
        }
      }
    }
    // J4 制式限流：同名进阶装备全队最多 team 件、每名玩家最多 each 件（基础装备不限；已淘汰玩家不计）。
    // ★ "同名" = baseIdOf(id) 相同（_a / _b 是同一件装备的两个品质）；只有进阶（_b）计入。
    const j4 = fx.J4;
    if (j4 && Number.isFinite(j4.team) && t === 'g.equip') {
      const uid = msg.itemUid ?? msg.uid;
      const loc = uid != null ? ps.find(uid) : null;
      const piece = loc && loc.piece;
      if (piece && piece.kind === 'item' && this.gd.isGolden(piece.id)) {
        const base = this.gd.baseIdOf(piece.id);
        let teamCount = 0, mineCount = 0;
        for (const other of this.order) {
          // "已淘汰玩家的装备不计入"
          if (other.eliminated) continue;
          // ★ target.items 里放的是**棋子 piece 对象**（items.js:132 `target.items.push(item)`），不是装备 id。
          for (const p2 of other.allChess ? other.allChess() : []) {
            for (const it of p2.items || []) {
              const id = it && it.id;
              if (!id || !this.gd.isGolden(id) || this.gd.baseIdOf(id) !== base) continue;
              teamCount++;
              if (other === ps) mineCount++;
            }
          }
        }
        if (mineCount >= (Number.isFinite(j4.each) ? j4.each : 1)) {
          return fail(ERR.BAD_TARGET, 'crisis J4 per-player cap reached');
        }
        if (teamCount >= j4.team) {
          return fail(ERR.BAD_TARGET, 'crisis J4 team cap reached');
        }
      }
    }
    return null;
  }

  /** 执行前算出这件装备要记几份（基础 1 / 进阶 2）；非装备意图返回 0。 */
  _crisisEquipCostOf(ps, msg) {
    if (!this.gd.crisisFx) return 0;
    const uid = msg.itemUid ?? msg.uid;
    const loc = uid != null ? ps.find(uid) : null;
    const piece = loc && loc.piece;
    if (!piece || piece.kind !== 'item') return 0;
    return this.gd.isGolden(piece.id) ? 2 : 1;
  }

  /** 成功后记一次配额（H5 计所有主动操作；J6 按基础 1 / 进阶 2 计消耗装备）。 */
  _crisisQuotaSpend(ps, t, msg, equipCost = 0) {
    const fx = this.gd.crisisFx;
    if (!fx) return;
    const ACT = new Set(['g.buy', 'g.sell', 'g.equip', 'g.art', 'g.destroy']);
    if (fx.H5 && ACT.has(t)) ps.crisisActions = (ps.crisisActions ?? 0) + 1;
    if (fx.J6 && Number.isFinite(fx.J6.cap) && (t === 'g.equip' || t === 'g.art')) {
      ps.crisisEquipCost = (ps.crisisEquipCost ?? 0) + equipCost;
    }
  }

  _handle(ps, msg) {
    const denied = this._crisisQuota(ps, msg.t, msg);
    if (denied) return denied;
    // ★ 装备成功后它会从 hand 移到棋子的 items 里 ⇒ ps.find(itemUid) 变 null，
    //   记账时再查就查不到了。所以在执行**之前**把品质记下来。
    const equipCost = this._crisisEquipCostOf(ps, msg);
    const out = this._route(ps, msg);
    // ★ OK 是 Object.freeze({ok:true})，而 ps.equip 等返回的是**新对象** {ok:true} ⇒ out === OK 恒为 false，
    //   原来那版等于只对极少数返回同一个 OK 常量的意图记账。改成按形状判断。
    if (out && out.ok === true) this._crisisQuotaSpend(ps, msg.t, msg, equipCost);
    return out;
  }

  _route(ps, msg) {
    switch (msg.t) {
      case 'g.infoReady':
        if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
        if (this.setupVote) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
        if ((msg.setupRevision ?? 0) !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup changed; confirm the current revision');
        if (!ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
        return OK;
      case 'g.rerollVote': return this.voteSetupReroll(ps, msg.voteId, msg.agree);
      case 'g.band': return this.pickBand(ps, msg.bandId);
      case 'g.bandSkip': return this.skipBand(ps);
      // the strategy highlighted in the draft screen (what a timed-out turn takes, timeoutBand)
      case 'g.bandFocus': return this.bandFocus(ps, msg.bandId ?? null);
      case 'g.buy': return ps.buy(msg.slot);
      case 'g.refresh': return ps.refresh();
      case 'g.freeze': return ps.freeze();
      case 'g.levelUp': return ps.levelUp();
      case 'g.sell': return ps.sell(msg.uid);
      // dir: the deploy wheel's facing (DESIGN §3; absent ⇒ PlayerState reads to.dir, then RIGHT)
      case 'g.move': return ps.move(msg.uid, msg.to, msg.dir);
      case 'g.equip': return ps.equip(msg.itemUid, msg.targetUid, msg.replaceUid ?? null);
      case 'g.art': return ps.useArt(msg.itemUid, msg.row, msg.col, msg.dir);
      case 'g.destroy': return ps.destroy(msg.uid);
      // 装备拆卸 (behaviour `unequip`, DESIGN §35.43.2): with the switch off this is g.destroy's own refusal, byte for byte
      case 'g.unequip': return ps.unequip(msg.itemUid);
      case 'g.reward': return ps.pickReward(msg.idx);
      case 'g.choice': return msg.choiceId !== undefined
        ? this.pickPersonalChoice(ps, msg.idx, msg.choiceId)
        : this.pickCard(ps, msg.idx);
      // 机变 随机分配 vote (fork 二.4): the player votes for the random allocation instead of picking
      case 'g.choiceRandom': return this.voteRandomChoice(ps);
      // a plugin interaction window (PLUGIN API v2, docs/PLUGINS.md §10b): the window's own id, not a draft card —
      // the host applies the declared primitive, a plugin never reaches the match state itself
      case 'g.offer': return this.requestOffer(ps, msg.offerId, msg.idx, msg);
      case 'g.offerRefresh': return this.requestOfferRefresh(ps, msg.offerId, msg.idx, msg);
      case 'g.ready': return ps.setReady(!!msg.ready);
      // 作弊菜单 (the floating cheat ball, a local-only aid): this player's own cheats, PREP only
      case 'g.cheat': return this.cheat(ps, msg);
      case 'g.emote': return this.emote(ps, msg.id);
      case 'g.emoteBurst': return this.emoteBurst(ps, msg.id);
      // 在线聊天 (fork, host option `onlineChat`): one message relayed to the room as m.chat
      case 'g.chat': return this.chat(ps, msg.text);
      // playerId: the player tapped (a shared field names two) — the watch preference (item 56)
      case 'g.watch': return this.watch(ps, msg.fieldId, msg.playerId ?? null);
      case 'g.autoplay': return this.setAutoplay(ps, !!msg.on);
      case 'g.pause': return this.setPause(ps, !!msg.on);
      // 六.E: the collectible choice of the SETTLE phase and the 「时光之末」 revival of an eliminated teammate
      case 'g.relic': return this.pickRelicChoice(ps, msg.offerId, msg.idx);
      case 'g.relicRevive': return this.reviveTeammate(ps, msg.relicId, msg.playerId);
      // the stats the board's units start their next battle with (the detail card in prep, user playtest #4 item 7)
      case 'g.unitStats': return this.unitStats(ps, msg.seq ?? null);
      case 'g.leave': this.onLeave(ps.playerId); return OK;
      case 'g.test': return this.applyTestCommand(ps, msg);
      case 'b.progress': return this._onProgress(ps, msg);
      case 'b.result': return this._onResult(ps, msg);
      // the host's answer to a delegated bot layout rehearsal (DESIGN §14): a report, never an error — an unknown,
      // expired or foreign task is ignored (MatchRehearsal._onRehearsalResult)
      case 'b.rehearsalResult': this._onRehearsalResult(ps, msg); return OK;
      default: return fail(ERR.BAD_MSG);
    }
  }

  /**
   * g.cheat {set?, freeRefresh?} — 作弊菜单 (the floating cheat ball, a local-only development aid). Every effect is the
   * CALLER's own: the state lives on `ps` (PlayerState.cheats), the enemy-HP switch is only ever read while building that
   * player's own normal field (`combat.js _cheatSpawns`), and 联防 / boss fields never read it at all.
   *
   * PREP ONLY, as the owner asked (「对局开始无法使用作弊功能，只有在准备阶段生效」): the check is the same `PHASE.PREP`
   * gate the shop uses, plus the `ready` refusal, so a cheat cannot be flipped once the player has locked in. AI seats
   * and eliminated players cannot cheat either.
   */
  cheat(ps, msg = {}) {
    if (!ps || ps.isBot) return fail(ERR.BAD_MSG);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE, 'cheats are PREP only');
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    return ps.cheat(msg);
  }

  emote(ps, id) {
    if (!EMOTES.includes(id)) return fail(ERR.BAD_MSG, 'unknown emote');    const now = this.sched.now();
    if (now - ps.lastEmoteAt < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
    ps.lastEmoteAt = now;
    this.broadcast({ t: 'm.emote', playerId: ps.playerId, id });
    // an AI teammate can react to a human's emote (enabled by default: server/match/botEmotes.js, SP_BOT_EMOTES=0 silences it)
    onHumanEmote(this, ps.playerId, id);
    return OK;
  }

  /**
   * 一键十连 (fork): ONE send broadcasts the same emote `EMOTE_BURST_COUNT` times, so a single tap shows ten arrivals.
   * It shares the single-send cooldown (one send, not ten — ten quick taps can never flood a room), and each frame is a
   * plain `m.emote`, so every client renders it exactly like ten ordinary sends.
   */
  emoteBurst(ps, id) {
    if (!EMOTES.includes(id)) return fail(ERR.BAD_MSG, 'unknown emote');
    const now = this.sched.now();
    if (now - ps.lastEmoteAt < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
    ps.lastEmoteAt = now;
    for (let i = 0; i < EMOTE_BURST_COUNT; i++) this.broadcast({ t: 'm.emote', playerId: ps.playerId, id });
    return OK;
  }

  /**
   * 在线聊天 (fork, the host's 房主配置 `onlineChat`): one `g.chat` is relayed to the whole room as `m.chat`, the same
   * shape emotes take. Refused when the room never turned the option on (`WRONG_PHASE`) — the server is the one that
   * decides, so a client that shows the window anyway cannot type into a room that has chat off.
   *
   * `text` is trimmed here and re-checked against CHAT_MAX_LEN (the protocol already caps it; a programmatic caller —
   * the stub match, a test — may not have gone through that path). An empty message is BAD_MSG rather than a silent
   * drop, so a client that trimmed its own input knows why nothing appeared. One message a second per player, the
   * emote's own cooldown, so chat and emotes share the same "don't flood the room" budget.
   */
  chat(ps, text) {
    if (this.onlineChat !== true) return fail(ERR.WRONG_PHASE, 'chat is off in this room');
    if (!ps || ps.isBot) return fail(ERR.BAD_MSG, 'bots do not chat');
    if (typeof text !== 'string') return fail(ERR.BAD_MSG, 'no text');
    const body = text.trim();
    if (!body || body.length > CHAT_MAX_LEN) return fail(ERR.BAD_MSG, 'empty or too long');
    const now = this.sched.now();
    if (now - ps.lastChatAt < CHAT_COOLDOWN_MS) return fail(ERR.RATE);
    ps.lastChatAt = now;
    this.broadcast({ t: 'm.chat', playerId: ps.playerId, text: body, seq: ++this.chatSeq });
    return OK;
  }

  setAutoplay(ps, on) {
    if (ps.autoplay === on) return OK;
    ps.autoplay = on;
    this.markPublic();
    if (on) this.kickBot(ps);
    // 六.E: 托管 turned on mid-offer picks for the player too (the offer's own waiting path covers a player already at
    // 托管 when it opened)
    if (this.relicsOn && on && this.phase === PHASE.SETTLE && ps.relicOffer) { autoSelectRelic(ps); this._completeRelicChoices(); }
    return OK;
  }

  /** Let the bot act for a (newly) bot-controlled seat in the current phase. */
  kickBot(ps) {
    if (!ps.botControlled || this.ended) return;
    this.offersChanged();
    if (this.phase === PHASE.INFO_CHECK && !ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
    else if (this.phase === PHASE.BAND_DRAFT && this.draftTurn() === ps.playerId) this.scheduleBandBot();
    else if (this.phase === PHASE.SP_DRAFT && this.spTurn() === ps.playerId) this.scheduleSpBot();
    else if (this.phase === PHASE.PREP && ps.alive && !ps.ready) this.scheduleBotPrep(ps, 0);
  }

  /**
   * g.unitStats { seq? } (user playtest #4 item 7: the detail card showed fixed record stats): the stats every unit of
   * the player's board will fight with at the start of its next battle — equipment, bonds and their layers, 特质, the
   * band and 机变 effects — computed exactly by the shared sim. The player's battle input after the onBattleStart meta
   * handlers (`ev.preview: true`, no enemies — those handlers must not change the match for a preview) builds a Battle
   * of the battle's options that is started (initial deployment + battleStart hooks), read and dropped: it is never
   * stepped: deployment skills contribute their initial stats but their timers do not advance. No SP / skill timer is
   * sent, and the real battle gets fresh units. Pushed to the player as `m.unitStats { seq, round, units }`
   * (units: shared/protocol.js unitStatsEntry, board operators and summons by uid); cached per input (a build costs
   * ≈ 0.3–0.7 ms). Prep phases only (ROUND_START, 机变, PREP); a battle's live stats come from the browser's own sim.
   * @param {PlayerState} ps @param {number|null} seq echoed (the client keeps the newest answer)
   */
  unitStats(ps, seq = null) {
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.ROUND_START && this.phase !== PHASE.SP_DRAFT && this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    const units = this._unitStatsOf(ps);
    this.sendTo(ps.playerId, { t: 'm.unitStats', seq: Number.isInteger(seq) ? seq : null, round: this.round, units });
    return OK;
  }

  /** The start-of-battle stats of a player's board units (see unitStats); [] when the preview battle cannot be built. */
  _unitStatsOf(ps) {
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const ev = { input, kind: 'normal', round: this.round, preview: true };
    this.dispatch(ps, 'onBattleStart', ev);
    const players = [ev.input && typeof ev.input === 'object' ? ev.input : input];
    let key = null;
    try { key = JSON.stringify([this.round, this.stageId, this.battleContent, players]); } catch { key = null; }
    if (!this._unitStatsCache) this._unitStatsCache = new WeakMap(); // PlayerState → { key, units } (the last preview)
    const cached = this._unitStatsCache.get(ps);
    if (key && cached && cached.key === key) return cached.units;
    const units = [];
    // the flags of the battle it previews: a normal round gains IN_BATTLE layers from its start (a <战斗开始时> layer gain
    // raises bond stats at t = 0 there too); the Final Assault / Hidden Core fight without (previewed as a normal field)
    const bossRound = this.round === this.gd.bossRound || this.round === this.gd.hiddenRound;
    const b = this.newBattle({
      seed: deriveSeed(this.seed, `preview:${this.round}:${ps.seat}`), kind: 'normal', modeId: this.modeId, round: this.round,
      stageId: this.stageId, rect: { ...GEO.NORMAL_RECT }, timeLimit: 60, players, spawns: [], routes: this.wave ? this.wave.routes : [],
      sharedBoss: null, flags: { layerGainsEnabled: !bossRound, uncapLayers: this.gd.uncapLayers, ...this.gd.dp }, fieldId: `n:${ps.playerId}`, recordEvents: false,
    });
    try {
      if (typeof b.start === 'function') b.start();
      for (const u of Array.isArray(b.allyUnits) ? b.allyUnits : []) {
        if (u && Number.isInteger(u.uid) && (u.kind === 'op' || u.kind === 'token')) units.push(unitStatsEntry(u, u.s));
      }
    } catch (e) { this.reportError('unitStats', e); }
    this._unitStatsCache.set(ps, { key, units });
    return units;
  }
}
