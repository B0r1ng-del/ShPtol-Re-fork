// server/match/match/spDraft.js — Match methods: the 机变 draft (SP_DRAFT: turn order, timers, AI picks, the card applied
// by choices.js applyCard), the personal bounty choice of the Art 教鞭 (offerBountyChoice / pickPersonalChoice /
// autoPickPersonalChoice: held by the player inside PREP — no phase, no timer of its own) and the rolls the meta effects
// ask for — bounties (addBounty), item ids (rollItemId) and choices.json pools (rollPool).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { generateDraft, applyCard, bountyBattles, isMultiRoundBounty, bountyCard } from '../choices.js';
import { onPickCard } from '../botEmotes.js';
import { weightedPick } from '../waves.js';
import { botPickCard } from '../bot.js';
import { OK, fail, DELAYS } from './common.js';

/** Cards of the personal choice (PRTS 卫戍协议：盟约 下半 §法术 教鞭: "于3个战术特训的悬赏任务中选择一项"). */
const PERSONAL_OFFER_SIZE = 3;

export class MatchSpDraft {
  enterSpDraft() {
    const draft = generateDraft(this.gd, this.rngDraft, this.round, { stageId: this.stageId, bondAvailable: (bondId) => this.bondLive(bondId), itemAvailable: id => this.itemPool.canGain(id) });
    const alive = this.alivePlayers();
    if (!draft || !alive.length) { this.enterPrep(); return; }
    this.phase = PHASE.SP_DRAFT;
    let order = alive.map((p) => p.playerId);
    if (!this.isSolo) this.rngDraft.shuffle(order);
    // 「AI 队友最后选择」 (GitHub #338): humans before AI seats, after the same shuffle (MatchPhases.humansFirst)
    order = this.humansFirst(order);
    // untimed: solo and any single-human match (soloUntimed); the co-op order / 6 cards stay. A MODE may switch the
    // whole draft untimed and parallel and offer the random-allocation vote (fork 二.4 — GameData.spDraftRules), and
    // the 四.2 Mod 开关 does the same for every mode (its own families, or the switch's default list).
    const rules = this.gd.spDraftRules;
    const untimed = this.soloUntimed || rules.untimed;
    this.sp = {
      ...draft, order, idx: 0, picks: {}, taken: {}, untimed, turnDeadline: 0,
      parallel: rules.parallel, randomOffer: rules.randomFamilies, randomVotes: new Set(), randomResolved: false,
    };
    this.setDeadline(0);
    this.startSpTurn();
    this.markPublic();
  }

  /**
   * The 机变 draft rules (`GameData.spDraftRules`): the MODE's own (fork 二.4) merged with the 四.2 Mod 开关 —
   * `untimed`, `parallel` and `randomFamilies`. Every one of them is off for every official mode with the switches
   * off, which keeps the sequential timed draft exactly as it was.
   */
  get spRules() { return this.gd.spDraftRules; }

  spTurn() {
    const s = this.sp;
    if (!s) return null;
    // a parallel draft has no turn: the "current" player is simply the first one still to act (the bot scheduler
    // and the client's turn cue read this, nothing gates a pick on it)
    if (s.parallel) return s.order.find((pid) => !this.spDone(pid)) ?? null;
    return s.order[s.idx] ?? null;
  }

  /**
   * Whether a player has finished its 机变 turn: it holds a CARD. A vote alone is not a finish.
   *
   * THIS IS THE FIX FOR THE OWNER'S BUG OF 2026-10-13 (「有玩家选择“随机分配”后，该玩家无法选择道具…系统判定投票随机分配的玩家
   * 不够，便直接结束了机变阶段，导致最后一名玩家没有拿到任何道具或敌人」). A vote used to count as done
   * (`|| s.randomVotes.has(playerId)`), so the seat was skipped: when the vote then failed to reach half, the draft ran
   * out of players to ask, `finishSpDraft` fired, and the voter ended the round with NOTHING — it could not even pick.
   * A vote is a REQUEST to let the system allocate, not a decision to take nothing, so only a card ends a turn. The
   * voter's own turn still comes, and picking normally is exactly what the owner asked for
   * (「选择「随机分配」的玩家应能正常选择道具或敌人或增益」).
   */
  spDone(playerId) {
    const s = this.sp;
    if (!s) return true;
    return s.picks[playerId] != null;
  }

  /**
   * Whether a card of the current draft is contended between the players: the 悬赏决策 draft while 共享悬赏 is on (the
   * official rule 「全队共用一套悬赏决策牌，先选先得」 — the first pick consumes the card). A draft of any other family is
   * always contended (the option names 悬赏 only), and 共享悬赏 off gives every player its own set of 悬赏 cards, so
   * nothing is denied to anybody.
   * [ASSUMED] No official source states what the option does to the 教鞭's own personal choice (offerBountyChoice,
   * which is per-player by construction) — it is left alone; the option covers the 悬赏决策 draft the label names.
   */
  get spCardsShared() { return this.sharedBounty || this.sp?.family !== 'bounty'; }

  spCardAvailable(card) { return !!card && (this.sp?.taken[card.idx] == null || !this.spCardsShared) && (card.kind !== 'item' || this.itemPool.canGain(card.id)); }

  startSpTurn() {
    const s = this.sp;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    if (s.parallel) {
      // 二.4: no clock — everyone decides at once and the draft ends when every alive player has picked or voted
      this.setDeadline(0);
      const available = s.cards.filter((c) => this.spCardAvailable(c)).map((c) => c.idx);
      const pending = s.order.map((pid) => this.players.get(pid)).filter((ps) => ps && ps.alive && !this.spDone(ps.playerId));
      if (!pending.length || !available.length) { this.later(0, () => this.finishSpDraft()); return; }
      for (const ps of pending) if (ps.botControlled) this.scheduleSpBot(ps.playerId);
      this.markPublic();
      return;
    }
    const token = ++this._turnToken;
    // Advance past every seat that already holds a card. A seat that VOTED is deliberately NOT skipped (the owner's bug
    // report of 2026-10-13): a vote is a request to let the system allocate, not a decision to give up the card, so the
    // seat keeps its turn and may pick normally — 「选择「随机分配」的玩家应能正常选择道具或敌人或增益」. Skipping it was
    // what emptied the queue, ended the phase and left the voter with nothing when the vote failed to reach half.
    while (s.idx < s.order.length) {
      const ps = this.players.get(s.order[s.idx]);
      if (!ps || !ps.alive || this.spDone(ps.playerId)) { s.idx++; continue; }
      break;
    }
    const available = s.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
    if (s.idx >= s.order.length || !available.length) { this.setDeadline(0); this.later(0, () => this.finishSpDraft()); return; }
    if (!s.untimed) {
      const first = s.idx === 0;
      const secs = first ? this.gd.timer('spFirst') : this.gd.timer('spTurn');
      this.setDeadline(secs, () => {
        if (this.phase !== PHASE.SP_DRAFT || token !== this._turnToken) return;
        const ps = this.players.get(this.spTurn());
        if (!ps) return;
        const avail = s.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
        if (!avail.length) { this.finishSpDraft(); return; }
        this._applyCard(ps, avail[Math.floor(this.rngDraft() * avail.length)]);
      });
      s.turnDeadline = this.deadline;
    } else {
      this.setDeadline(0);
    }
    const cur = this.players.get(this.spTurn());
    if (cur && cur.botControlled) this.scheduleSpBot();
    this.markPublic();
  }

  /** The AI seat `playerId` (default: the current turn) takes its 机变 action. */
  scheduleSpBot(playerId = this.spTurn()) {
    const token = this._turnToken;
    this.later(this.scaled(DELAYS.BOT_ACTION), () => {
      if (this.phase !== PHASE.SP_DRAFT || !this.sp) return;
      const ps = this.players.get(playerId);
      if (!ps || !ps.botControlled || this.spDone(ps.playerId)) return;
      // the sequential draft keeps the turn token / turn rule; a parallel one only needs the player to be pending
      if (!this.sp.parallel && (token !== this._turnToken || this.spTurn() !== ps.playerId)) return;
      const avail = this.sp.cards.filter(c => this.spCardAvailable(c)).map(c => c.idx);
      if (!avail.length) return;
      this._applyCard(ps, botPickCard(this, ps, this.sp.cards, avail));
    });
  }

  pickCard(ps, idx) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.sp.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    // a parallel draft (fork 二.4) accepts every pick at any time; the sequential one keeps the turn rule
    if (!this.sp.parallel && this.spTurn() !== ps.playerId) return fail(ERR.NOT_YOUR_TURN);
    if (!Number.isInteger(idx) || idx < 0 || idx >= this.sp.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.spCardAvailable(this.sp.cards[idx])) return fail(ERR.SOLD_OUT);
    this._applyCard(ps, idx);
    return OK;
  }

  /**
   * 机变 随机分配 vote (fork 二.4): the player asks the system to hand the cards out at random instead of picking one
   * itself. As soon as HALF of the alive players have voted (`votes × 2 ≥ alive`) the system hands the cards out at
   * random — one per alive player, over their own pick — and the round moves on; below half every player keeps the card
   * it picked. Refused unless the mode offers the vote, and never in a 悬赏决策 draft ("悬赏类不要添加随机机制").
   *
   * Available at ANY time, not only on the voter's turn: the vote is the escape hatch that ends an untimed draft without
   * waiting for a seat that never acts (the owner's ruling of 2026-10-12 kept the order AND this).
   *
   * VOTING DOES NOT COST A PLAYER ITS CARD (owner's bug report of 2026-10-13). A vote is a request, not a decision to
   * take nothing: the seat keeps its turn (`spDone` no longer counts a vote) and may pick normally afterwards — that is
   * the reported 「选择「随机分配」的玩家应能正常选择道具或敌人或增益」. `startSpTurn` does skip a seat that has voted when
   * choosing whose turn is NEXT (a pending voter must not stall the queue), but that seat is still asked for a card
   * before the draft can end, and `resolveRandomChoice` gives one to every seat that is still empty.
   * @returns {{ ok: true } | { error: string, detail?: string }}
   */
  voteRandomChoice(ps) {
    if (this.phase !== PHASE.SP_DRAFT || !this.sp) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const s = this.sp;
    if (!s.randomOffer || !this.randomVoteOffered()) return fail(ERR.WRONG_PHASE, '随机分配 is not offered in this 机变'); // i18n-ignore (developer diagnostic)
    if (s.randomVotes.has(ps.playerId) || s.picks[ps.playerId] != null) return fail(ERR.ALREADY);
    s.randomVotes.add(ps.playerId);
    this.markPublic();
    if (this.voteRandomReached()) { this.resolveRandomChoice(); return OK; }
    // advance past this seat for TURN purposes (it already asked), but it keeps its claim on a card
    this.startSpTurn();
    return OK;
  }

  /** Whether this draft offers the vote at all: the mode lists the family, and the family is never 悬赏. */
  randomVoteOffered() {
    const s = this.sp;
    if (!s || !s.randomOffer) return false;
    return s.family !== 'bounty' && s.randomOffer.includes(s.family);
  }

  /** Whether HALF of the alive players (inclusive) have voted for the random allocation. */
  voteRandomReached() {
    const s = this.sp;
    if (!s) return false;
    const alive = this.alivePlayers().length;
    return alive > 0 && s.randomVotes.size * 2 >= alive;
  }

  /** Whether the random draw may hand `card` out: a listed family, and never a 悬赏 card. */
  randomChoiceEligible(card) {
    const s = this.sp;
    if (!s || !s.randomOffer || !card) return false;
    if (card.family === 'bounty') return false; // 悬赏 adds its enemies to the PICKER's own battles — never handed out
    return s.randomOffer.includes(card.family);
  }

  /**
   * Hand the draft's random-eligible cards out, one per alive player, in a shuffled order — the picker's own choice is
   * overridden, which is the point of the vote. Every player still gets at most one card, and the pick/taken maps stay
   * consistent for the audit.
   */
  resolveRandomChoice() {
    const s = this.sp;
    if (!s || s.randomResolved) return;
    s.randomResolved = true;
    const alive = this.alivePlayers().filter((p) => p.alive);
    const pool = s.cards.filter((c) => s.taken[c.idx] == null && this.randomChoiceEligible(c));
    this.rngDraft.shuffle(alive);
    this.rngDraft.shuffle(pool);
    const n = Math.min(pool.length, alive.length);
    for (let k = 0; k < n; k++) {
      const ps = alive[k];
      const card = pool[k];
      s.picks[ps.playerId] = card.idx;
      s.taken[card.idx] = ps.playerId;
      try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
      this.markPrivate(ps);
    }
    this.markPublic();
    this.finishSpDraft();
  }

  _applyCard(ps, idx) {
    const s = this.sp;
    if (!s || s.picks[ps.playerId] != null || !this.spCardAvailable(s.cards[idx])) return;
    const card = s.cards[idx];
    if (!card) return;
    s.picks[ps.playerId] = idx;
    s.taken[idx] = ps.playerId;
    try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
    this.markPrivate(ps);
    this.markPublic();
    onPickCard(this, ps, card); // AI bots say "思考" when they take a bounty (enabled by default; SP_BOT_EMOTES=0 silences it)
    this.startSpTurn();
  }

  /**
   * End the 机变 draft and move to PREP.
   *
   * NOBODY LEAVES THE DRAFT EMPTY-HANDED (owner's bug report of 2026-10-13). The phase used to end as soon as the turn
   * order ran out, which left a player who had voted for the random allocation with NOTHING whenever that vote failed to
   * reach half — the reported 「导致最后一名玩家没有拿到任何道具或敌人」. The vote is now a request that keeps the seat's
   * turn (`spDone` counts only cards), so the normal paths already hand every seat a card; this is the last net before
   * PREP, for a seat that could not act for any other reason (it was eliminated, left, or every card was already taken).
   * A seat that can still be given a card gets one; when the draft really has no card left for it, nothing is invented.
   */
  finishSpDraft() {
    if (this.phase !== PHASE.SP_DRAFT) return;
    this.cancel(this._turnTimer);
    this._turnTimer = null;
    this._settleEmptySeats();
    this.enterPrep();
  }

  /**
   * Give a card to every living seat that reached the end of the 机变 with none, so a failed vote (or any other stalled
   * seat) never costs a player its card. Mirrors `resolveRandomChoice`'s own bookkeeping (`picks` + `taken` + `applyCard`)
   * rather than going through `_applyCard`, which would re-enter `startSpTurn` from inside the phase's teardown. Draws
   * from the cards the draft may hand out at random when it can — a voted-for allocation — else from any free card, and
   * does nothing once the draft has no card left to give.
   */
  _settleEmptySeats() {
    const s = this.sp;
    if (!s) return;
    let touched = false;
    for (const ps of this.alivePlayers()) {
      if (!ps || !ps.alive || s.picks[ps.playerId] != null) continue;
      const avail = s.cards.filter((c) => c && s.taken[c.idx] == null && this.spCardAvailable(c));
      if (!avail.length) break;
      const eligible = avail.filter((c) => this.randomChoiceEligible(c));
      const pool = eligible.length ? eligible : avail;
      const card = pool[Math.floor(this.rngDraft() * pool.length)];
      s.picks[ps.playerId] = card.idx;
      s.taken[card.idx] = ps.playerId;
      try { applyCard(this, ps, card); } catch (e) { this.reportError(`applyCard ${card.id}`, e); }
      this.markPrivate(ps);
      touched = true;
    }
    if (touched) this.markPublic();
  }

  /**
   * 教鞭 (content/items/meta.js, ctx.offerBountyChoice): the Art opens a PERSONAL choice (act2autochess choice event
   * `hunter_band_1`, choiceType PERSONAL_CHOOSE) between up to three of `candidates` — drawn once from the meta rng, kept in
   * `ps.personalChoice` (m.private only) until the owner confirms one with `g.choice { idx, choiceId }`. It lives inside
   * PREP: no phase of its own and no timer — the prep's deadline resolves it (prepDeadline), Ready is refused while it is
   * pending (PlayerPrep.setReady). Refused — before an rng draw or an id is used, so the Art stays in the hand — when it
   * is not the player's PREP, a choice is already open or no card is left to offer.
   * @param {import('../PlayerState.js').PlayerState} ps @param {any[]} candidates cards.bounty entries
   * @param {string} sourceItemId the Art
   */
  offerBountyChoice(ps, candidates, sourceItemId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    if (ps.personalChoice) return fail(ERR.BAD_TARGET, '请先完成当前教鞭选择'); // i18n-ignore: developer error detail
    if (!candidates.length) return fail(ERR.BAD_TARGET, '当前没有可用的战术特训'); // i18n-ignore: developer error detail
    const cards = this.rngMeta.shuffle(candidates.slice()).slice(0, PERSONAL_OFFER_SIZE);
    ps.personalChoice = { id: `${this.battlePrefix}.choice.${this.nextUid()}`, round: this.round, sourceItemId, cards };
    ps.dirty();
    return OK;
  }

  /** g.choice { idx, choiceId }: the owner's pick of its open personal choice — the card becomes a bounty on its next battles. */
  pickPersonalChoice(ps, idx, choiceId) {
    if (this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const pending = ps.personalChoice;
    if (!pending || pending.id !== choiceId || pending.round !== this.round) return fail(ERR.BAD_TARGET);
    if (!Number.isInteger(idx) || idx < 0 || idx >= pending.cards.length) return fail(ERR.BAD_TARGET);
    if (!this.addBounty(ps, pending.cards[idx])) return fail(ERR.BAD_TARGET);
    ps.personalChoice = null;
    ps.dirty();
    return OK;
  }

  /**
   * The pick made for a player who did not make it. 'bot': an AI seat or a human under AI 托管 — the bounty scorer of the
   * 机变 draft (bot.js botPickCard: the expected pay minus the expected LP lost against the own board, the bots' seeded rng
   * only breaks ties); 'random': the prep's deadline and a seat the engine finishes by other means — one of the cards at
   * random from the meta rng, like a 机变 turn that runs out. Nothing pending: nothing happens, no rng draw.
   */
  autoPickPersonalChoice(ps, mode) {
    const pending = ps.personalChoice;
    if (!pending) return undefined;
    const indices = pending.cards.map((c, i) => i);
    const idx = mode === 'bot'
      ? botPickCard(this, ps, pending.cards.map((c) => bountyCard(this.gd, c)), indices)
      : this.rngMeta.pick(indices);
    return this.pickPersonalChoice(ps, idx, pending.id);
  }

  addBounty(ps, card) {
    if (!ps || !card || !this.gd.enemy(card.enemyKey)) return null;
    // a multi-round card lasts MULTI_ROUND_BOUNTY_BATTLES battles (choices.js; the user's call after playtest #6)
    const rounds = bountyBattles(card);
    const b = {
      id: `bounty:${this.nextUid()}`,
      card: { effectId: card.effectId ?? card.id ?? null, name: card.name ?? '悬赏', desc: card.desc ?? '', tier: card.tier ?? 1, coin: Math.max(0, Math.trunc(Number(card.coin) || 0)), payout: card.payout === 'perfect' ? 'perfect' : 'kill', rounds, multiRound: isMultiRoundBounty(card), enemyKey: card.enemyKey, count: Math.max(1, Math.min(20, Number.isInteger(card.count) ? card.count : 1)) }, // i18n-ignore: a data-less card's fallback name
      roundsLeft: rounds,
    };
    ps.bounties.push(b);
    ps.dirty();
    return b.id;
  }

  /** Random item id: a choices.json server pool ({ pool }), a tier, or ≤ maxTier shop-eligible items. */
  rollItemId({ pool = null, tier = null, maxTier = 6, shopLevel = 6 } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof pool === 'string' && Object.hasOwn(pools, pool) ? pools[pool] : null;
    const rng = this.rngMeta;
    const tierList = (lo, hi) => { const out = []; for (let t = lo; t <= hi; t++) for (const id of this.gd.shopItemsByTier[t] || []) out.push(id); return out; };
    if (p && p.kind === 'equip') {
      if (Array.isArray(p.weighted) && p.weighted.length) {
        const pairs = p.weighted.filter((x) => Array.isArray(x) && this.gd.item(x[0]) && this.itemPool.canGain(x[0]));
        return this.itemPool.pick(rng, pairs.map(x => x[0]), new Map(pairs));
      }
      if (Array.isArray(p.items) && p.items.length) {
        const items = p.items.filter((id) => this.gd.item(id));
        return this.itemPool.pick(rng, items);
      }
      let list;
      if (Array.isArray(p.tiers) && p.tiers.length) list = p.tiers.flatMap((t) => this.gd.shopItemsByTier[t] || []);
      else list = tierList(1, p.maxTier === 'shopLevel' ? Math.max(1, Math.min(6, shopLevel)) : 6);
      return this.itemPool.pick(rng, list);
    }
    const list = Number.isInteger(tier) ? tierList(tier, tier) : tierList(1, Math.max(1, Math.min(6, maxTier)));
    return this.itemPool.pick(rng, list);
  }

  /**
   * Roll a choices.json pool (ctx.rollPool). Equip pools → rollItemId. Chess pools: an `items` (uniform) or `weighted`
   * list — only chess with a free pool copy (or outside the pool) qualify — else a copy-weighted draw from the shared
   * pool filtered by `tier` / `minTier` / `maxTier` (number or 'shopLevel') / `bond`; `golden: true` yields the elite id.
   * `extra` (the drawing player's 自选 stock, player/diy.js diyStockEntries) joins that shared-pool draw, `chessOf` reads the
   * bonds (the player's data view: a slotted slot's operator) — 0.2.0 WE2.
   * @returns {{ kind: 'item'|'chess', id: string, golden?: boolean } | null}
   */
  rollPool(poolId, { shopLevel = 6, extra = null, chessOf = null, pool = null } = {}) {
    const pools = this.gd.choices.pools && typeof this.gd.choices.pools === 'object' ? this.gd.choices.pools : {};
    const p = typeof poolId === 'string' && Object.hasOwn(pools, poolId) ? pools[poolId] : null;
    if (!p || typeof p !== 'object') return null;
    const lvl = Math.max(1, Math.min(6, Number.isInteger(shopLevel) ? shopLevel : 6));
    if (p.kind === 'equip') {
      const id = this.rollItemId({ pool: poolId, shopLevel: lvl });
      return id ? { kind: 'item', id } : null;
    }
    if (p.kind !== 'chess') return null;
    const rng = this.rngMeta;
    // 共享卡池 off: the caller's own pool (a per-player 机变 / 特质 draw must not read the team's stock)
    const stock = pool || this.pool;
    const free = (id) => {
      if (typeof id !== 'string' || !this.gd.chess(id)) return false;
      const base = this.gd.baseIdOf(id);
      return !stock.has(base) || stock.left(base) > 0;
    };
    let id = null;
    if (Array.isArray(p.weighted) && p.weighted.length) {
      const pairs = p.weighted.filter((x) => Array.isArray(x) && free(x[0]));
      id = pairs.length ? weightedPick(rng, pairs) : null;
    } else if (Array.isArray(p.items) && p.items.length) {
      const list = p.items.filter(free);
      id = list.length ? list[Math.floor(rng() * list.length)] : null;
    } else {
      const maxTier = p.maxTier === 'shopLevel' ? lvl : Number.isInteger(p.maxTier) ? p.maxTier : 6;
      const minTier = Number.isInteger(p.minTier) ? p.minTier : 1;
      const bond = typeof p.bond === 'string' ? p.bond : null;
      const recOf = typeof chessOf === 'function' ? chessOf : (cid) => this.gd.chess(cid);
      id = stock.roll(rng, {
        tier: Number.isInteger(p.tier) ? p.tier : null,
        maxTier,
        filter: (cid, e) => e.tier >= minTier && (!bond || (Array.isArray(recOf(cid)?.bonds) && recOf(cid).bonds.includes(bond))),
        extra,
      });
    }
    if (!id) return null;
    const golden = !!p.golden;
    return { kind: 'chess', id: golden ? this.gd.goldenIdOf(id) || id : id, golden };
  }
}
