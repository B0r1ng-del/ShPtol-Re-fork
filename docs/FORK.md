# FORK.md — the fork's own layer

This repository is a fork of [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol)
(itself an unofficial fan remake of Arknights' 「卫戍协议：盟约」). Upstream is built to *reproduce* the official
game: every number in `data/*.json` is derived from the official client tables by `tools/build-data.mjs`, and the
project's own docs state that there is no custom balance (see the header of `server/match/gamedata.js`).

A fork that wants to **add** something the official game never shipped therefore cannot just edit the data files.
This document is the contract for how it does it.

## The rule

> Generated data is never hand-edited. A fork change to generated data lives in `tools/fork-overrides.mjs` and is
> applied by `node tools/fork-data.mjs`.

- `tools/fork-overrides.mjs` — one pure, **idempotent** function, `applyForkOverrides(config)`, holding every
  fork-only value in the generated config. It never mutates its input, returns the input unchanged when the data it
  needs is absent, and applying it twice yields the same object.
- `node tools/fork-data.mjs` — applies it to the committed `data/config.json` in place (atomic write, compact JSON
  exactly like the build pipeline). `--check` exits 1 when the file is stale (for CI).
- `tools/build-data.mjs` calls `applyForkOverrides()` on the freshly built config **before writing**, so a full
  `npm run build-data` (or a CI rebuild that reproduces `data/` byte-for-byte) keeps the fork's changes instead of
  dropping them.
- `test/fork-data.test.js` is the drift guard: it asserts `applyForkOverrides(require(data/config.json))` deep-equals
  the committed file, so a regeneration without the override, a hand-edit, or an edit to `data/config.json` instead of
  the override module all fail the suite with a one-line fix (`node tools/fork-data.mjs`).

Why not regenerate the whole of `data/` in every fork PR: the pipeline re-encodes ~6 MB of untouched data, which
makes a one-line fork change unreviewable. Why not patch at runtime (on load, in `server/data.js`): the browser reads
the same `data/config.json` over HTTP, so the file itself must carry the value.

## Running it

```bash
node tools/fork-data.mjs           # apply the overrides to data/config.json (idempotent)
node tools/fork-data.mjs --check   # exit 1 when data/config.json is stale
node --test test/fork-data.test.js # the drift guard
```

## 终极模拟 — the fork's third room mode

`终极模拟` is the official game's third 模拟方式 (alongside 独立模拟 and 同盟模拟) but upstream only models the first
two: a room is `solo` or `coop` and the mode id is `mode_{single|multi}_{difficulty}`. The fork adds it as a real
third room mode.

| | 独立模拟 `solo` | 同盟模拟 `coop` | 终极模拟 `ultimate` |
|---|---|---|---|
| seats | 1 | 4 (`MAX_SEATS`) | 6 (`ULTIMATE_SEATS`) |
| difficulty | picker (AC-1…AC-4) | picker (AC-1…AC-4) | fixed AC-4 (`ULTIMATE_DIFFICULTY`) |
| mode id | `mode_single_*` | `mode_multi_*` | `mode_ultimate_abyss` |
| data record | official | official | fork (`tools/fork-overrides.mjs`) |

Where it is wired in:

- `shared/constants.js` — `ULTIMATE_SEATS = 6`, `ROOM_MODES`, `SEATS_BY_MODE`, `roomSeatCap(roomMode)`,
  `ULTIMATE_DIFFICULTY = 'ABYSS'`, and `modeIdFor()`'s `MODE_TYPE` table (`ultimate → 'ultimate'`). `MAX_SEATS = 4`
  keeps its old meaning for every pre-existing room.
- `shared/protocol.js` — `room.create.mode` accepts `ROOM_MODES`; the `room.removeBot` / `room.kick` seat indexes are
  validated against `ULTIMATE_SEATS - 1` (the lobby refuses a seat its own room does not have).
- `server/lobby.js` — `Room` allocates `roomSeatCap(mode)` seats and `create()` forces
  `ULTIMATE_DIFFICULTY` for an `ultimate` room; `setDifficulty` refuses another value there.
- `server/match/Match.js` — `this.roomMode` keeps the third value (`'solo' | 'coop' | 'ultimate'`) while `this.mode`
  stays the two-valued *behaviour* switch, so 终极模拟 plays with the co-op rules (联防, pairing, merged LP).
- `public/js/screens/lobby.js` — the third mode card and the single-difficulty rendering (`MODE_CARDS`,
  `difficultyInfo`, `effDifficulty`).
- `public/js/screens/room.js` — `normalizeSeats()` pads to `roomSeatCap(room.mode)`; the difficulty picker is
  replaced by a fixed tag.
- `tools/fork-overrides.mjs` — the `mode_ultimate_abyss` record (a copy of the AC-4 co-op mode plus the fork's own
  fields).

What the fork mode deliberately starts as: **an exact copy of AC-4 co-op**, so the room is playable the moment it
exists. The fork's per-mode rules land on top of it one change at a time, each one extending
`tools/fork-overrides.mjs` and its own test file:
- **二.1 盟约不会被禁用** — the mode carries `bans: { core: 0, addon: 0 }` and `GameData.bans()` prefers a mode's own
  table over the difficulty's one (`config.bans`, ABYSS = 3 core + 4 add-on). Without it the seeded per-match draw of
  `server/match/pool.js` removes up to 7 盟约 and takes every 干员 whose whole bond list they cover out of the shop
  for the run. The mode has ONE record (`mode_ultimate_abyss`, `ULTIMATE_DIFFICULTY`), so `modeIdFor('ultimate', d)`
  always names it and `Match` / `StubMatch` clamp a 终极模拟 room's difficulty to ABYSS: an id naming a record that is
  not in `config.modes` left `GameData` with an empty mode record, its own `bans` went unread and the draw came back
  (a six-博士 room lost 7 盟约 and 25 干员 — player report, fixed). `test/fork-ultimate-bans.test.js`.
- **二.2 局内商店升级** — the mode carries its own `shopSlots` table: every operator level adds one 干员购买槽位
  (3 → 4 → 5 → 6 → 7) and the last one adds a second 道具购买槽位 instead
  (`{1:{3,1}, 2:{4,1}, 3:{5,1}, 4:{6,1}, 5:{7,1}, 6:{7,2}}`; official AC-4 is `{3,4,4,5,5,5}` with one item slot
  throughout). `GameData.shopSlots()` already reads the record and clamps to `chess ≤ 8 / item ≤ 4`, and
  `PlayerState.rollShop()` lays the slots out from it, so only the numbers change — but the bar is 17.6rem wide at
  level 6 instead of 12.7rem (measured in Chromium at 1920×1080, 1440×810, 1280×720, 1024×576 and 844×390: it still
  fits every viewport). `test/fork-ultimate-shop.test.js`.
- **二.3 敌人属性调整** — the mode carries `enemyAdjust: { fromRound: 4, normal: { hp: 1.1 }, leader: { hp: 1.2, def: 1.2,
  atk: 1.08 }, hidden: { hp: 1.35, def: 1.35, atk: 1.16 } }` (R4 on). `GameData.enemyExtras(r)` splits it by spawn
  class and `server/match/waves.js` folds it into the spawn mods: the ordinary +10 % HP goes on the non-leader branch
  only (so never on the leader, and never on a 部位/`isPart`), while the leader's / hidden core's ATK and DEF land on
  the leader branch as `atkMul` × factor and a `defMul` that is **only added when it is not 1** — an official spawn
  spec is therefore byte-identical to before. `defMul` is the spawn mod `server/sim/Battle.js:807-812` already
  supports, and `def × (1 + pct)` is exactly the additive reading of "防御 +20 %" in the damage formula
  (`server/sim/damage.js:12`). The HP part is **per boss id**: `GameData.bossHpExtra(bossId)` looks a hidden core up in
  `mode.hiddenBossWeights` (boss_8…boss_10 ⇒ ×1.35) and treats everything else as a 最终攻势 leader (boss_1…boss_7 ⇒
  ×1.20), and `bossPoolHp()` (both `GameData` and `server/match/finalAssault.js`) multiplies that boss's OWN
  `bloodPoint[difficulty]` — so the two classes are computed separately and neither can move the other's pool.
  Boss-owned runtime summons (`server/sim/content/bosses.js` `summon.hp_ratio`) never come from `enemyScale` and so
  stay outside all of it. `test/fork-ultimate-enemy-stats.test.js`.
- **二.4 机变阶段改造** — the mode carries `spDraft: { untimed: true, parallel: true, randomVote: { families: ['supply',
  'shop', 'tactic'] } }`. `GameData.spDraftRules` normalises it (all off without the block), `Match.enterSpDraft` turns
  the draft untimed and parallel, and `Match.voteRandomChoice` (the `g.choiceRandom` intent, `Match.js` SP_DRAFT
  section) tallies votes: `votes × 2 ≥ alive` resolves the draft by `resolveRandomChoice`, which shuffles the
  random-eligible cards and the alive players and hands one card to each — over their own pick, which is the point of
  the vote; below half every player keeps the card it picked, and a voter who picked nothing takes nothing. UNTIMED
  ("移除原有的时间限制") means the phase ends when every alive player has picked or voted; PARALLEL replaces the
  sequential turn order, because without a clock waiting on one player at a time could stall the round forever
  (`g.choice` from any player, `spTurn()` = the first player still to act, the AI seats schedule themselves). 悬赏 cards
  are never drawn (`randomChoiceEligible` refuses `family === 'bounty'`) and in a 悬赏决策 draft the vote is not offered
  at all — "悬赏类不要添加随机机制" (a bounty adds its enemies to the PICKER's own next battles, so handing it to
  somebody else would break the attribution). The draft's `randomOffer` in `m.public` is non-null exactly when the vote
  is offered for that draft, so `public/js/ui/choiceOverlay.js` renders the 随机分配 button on the frame alone.
  `server/match/audit.js` accepts a player ending after only a lost vote. `test/fork-ultimate-sp-vote.test.js`.
- **二.4 also needed a 机变 schedule** — `choices.schedule` is keyed by modeId and the official data has no entry for a
  mode that never shipped, so without one the fork mode fell back to a plain 道具补给 draft every round (no 悬赏 at all,
  and the vote would have had nothing to gate). `applyForkChoices()` in `tools/fork-overrides.mjs` copies AC-4's
  schedule onto the fork modeId in `data/choices.json`; `tools/fork-data.mjs` and `tools/build-data.mjs` apply it like
  the config layer, and `test/fork-data.test.js` guards it with the same idempotence check.
- **二.5 大厅与房间的版面** — the fork's third mode made two upstream grids wrong, because both were sized for two
  modes and four seats:
  - **模式卡** — `public/css/screens/lobby.css` `.mode-cards` was `grid-template-columns: 1fr 1fr`, so with three
    cards (独立模拟 / 同盟模拟 / 终极模拟) the third wrapped onto a second row at a different width. It is now
    `repeat(3, minmax(0, 1fr))`: three EQUAL 竖向 choices in one row, every card keeping its portrait shape
    (icon over name over description).
  - **六席位** — the 同盟模拟 seat grid is `repeat(4, minmax(0, 3.8rem))` with one row, which left seats 5–6 on a
    half-empty second row of a different width. `public/js/screens/room.js` now adds `seats--ultimate` for
    `room.mode === 'ultimate'` and `public/css/screens/room.css` gives it
    `repeat(6, minmax(0, 1fr))` / `minmax(0, 1fr)`: six EQUAL 竖向 positions in one row, same size, in seat order.
    A six-seat room needs its own grid rule; the co-op and solo rooms are untouched.
  `test/client-static.test.js` guards both rules and the class wiring.
- **二.6 表情：一键十连与弹幕** — two switches in the 交流 panel, both per device (localStorage), both OFF by default, and
  both usable in EVERY mode (they are not 终极模拟-only rules):
  - **一键十连** — with the switch on, one tap on an emote sends it ten times. The client sends ONE `g.emoteBurst { id }`
    (shared/protocol.js) and `MatchIntents.emoteBurst` broadcasts the same `m.emote` `EMOTE_BURST_COUNT` (10) times, so
    every client renders it exactly like ten ordinary sends. It charges the single-send cooldown once — it is one send,
    not ten — so ten quick taps can never flood a room. `g.emote` itself is untouched.
  - **弹幕** — the emotes the room has just sent also FALL down the screen like snowflakes (`ui/emotes.js`
    `EmoteBarrage` + `css/emotes.css` `@keyframes emo-fall`): each item starts at its own random x, sways and turns a
    little on the way down, and is gone once it passes the bottom edge (the element is dropped at the end of its flight —
    the animation's `forwards` fill would otherwise park it on screen). It is a display layer over the broadcast
    `m.emote` stream, so a teammate's emote falls on everyone's screen. It only ADDS the layer: the avatar bubble that
    shows what a player sent keeps working with the switch on (tying the two hid every sent emote).
  The panel is `.49rem` taller for the switch band (`.ewheel__panel::after`), and the switches live in a small store
  (`emotePrefsStore` / `setEmotePref`) because `savePref` notifies nothing — reading the pref at render time alone would
  leave the layer stale until an unrelated frame arrived. `test/fork-emote-burst.test.js`,
  `test/client-static.test.js`.
- **二.7 房主配置** — the fork's own 准备房间 panel (`room.setHostConfig`), in **every** mode's ready room and editable by
  the host alone. It is a fork feature: the official room has a difficulty picker and 「房间未满4人时搜寻队友」 only
  (research 06 §3.2), and no source documents these four options — the labels and explanations are the requester's.
  The key list is normative in `shared/constants.js` (`HOST_CONFIG_KEYS` / `HOST_CONFIG_DEFAULTS`); the room keeps the
  values across its matches and the match reads them when it starts, exactly like the difficulty.
  - **共享卡池** (default **on**) — on: one 干员 stock for the whole team, so a copy one player takes is gone for the
    others (the official rule: `economy.coopPoolMultiplier` doubles one shared pool, `server/match/pool.js`).
    Off: `MatchInfra.poolFor` hands each player their own `SharedPool` with the same caps and bans, built on first use —
    only the contention goes away. Every per-player read and roll goes through `PlayerState.stock()`
    (`player/economy.js` `_rollChessSlot`, `player/acquire.js`, `player/diy.js` `poolOf`, `effectsMeta.js` `rollChess` /
    `rollPool`, `match/spDraft.js` `rollPool`, the bot's valuation in `bot.js`, the audit's roll check and the
    invariants' per-player balance check).
  - **共享悬赏** (default **on**) — on: one 悬赏决策 draft whose first pick consumes the card (「全队共用一套悬赏决策牌，
    先选先得」). Off: `MatchSpDraft.spCardsShared` is false for a 悬赏决策 draft, so `spCardAvailable` ignores `taken` and
    the client's `normalizeSp` marks only my own pick — a teammate taking a card leaves it pickable for me.
    `[ASSUMED]` The option covers the 悬赏决策 draft it names; the 教鞭's own personal choice
    (`offerBountyChoice`) is per-player by construction and is left alone.
  - **AI 队友最后选择** (default **off**) — GitHub #338's option, unchanged (`room.setAiPicksLast` still works and both
    messages write the same value; `room.state.aiPicksLast` follows). It is listed in the panel so all four room options
    sit together.
  - **多同盟模式** (default **off**) — on: `Match.bandTaken` returns false, so more than one 博士 may take the SAME 策略;
    off: the official 「每个策略只能由一位博士选择」 (`server/match/match/phases.js`, and the client's 队友已选 lock in
    `public/js/screens/bandDraft.js` reads the same `m.public.hostConfig.multiAlliance`).
  - **Scope** — the panel shows in the ready room of every mode with more than one seat (独立模拟 has nobody to share
    with: `hostConfigPanel` returns null and the lobby refuses those options with `BAD_TARGET`). The match clamps all
    three to the official values in a solo match whatever a caller passes, so a caller that passes nothing — the golden
    scenarios, the rehearsal tools, every existing test — behaves exactly as before (no golden scenario moved).
  - **私人房间** — the fifth row of the requester's screenshot is deliberately **out of scope** (the requester's call:
    「忽略私人房间的选项」).
  `test/lobby-host-config.test.js` (protocol, host-only, defaults, un-ready, keep-across-matches, solo refusal),
  `test/match/host-config.test.js` (each option's engine behaviour and that none of them draws from a random stream),
  `test/ui/host-config.test.js` and `test/ui/ai-picks-last.test.js` (the panel and its rows).
- **二.8 自选编队 10 个名额** — the 自选编队 tab has **5 slots per tier (5 × 5阶 + 5 × 6阶 = 10)** instead of the official
  2 + 2. A 自选 slot is not a UI concept: it is a `data/chess.json` record pair (`…_diyN_a` normal / `…_diyN_b` elite)
  listed in `data/backups.json` `diy.slots`, and both files are build products of `tools/build-data.mjs` (the official
  `act.diyChessDict` / `charShopChessDatas` tables have exactly four slots), so the extra ones are built in the fork
  layer like every other fork value:
  - `applyForkChess(chess)` — the three extra pairs per tier, copied from that tier's first official slot pair. Every
    official slot of a tier shares its `status` (normal E2 Lv1 rank 4; elite E2 Lv60 rank 7 with the module at stage 1
    for tier 5 / 3 for tier 6), its price (4 / sell 1) and its merge (3), and the operator comes from the PICK rather
    than the record — so a copy is that tier's slot under new ids. `identifier` continues the official run (the official
    自选 records end at 265) and `shopSortId` continues the tier's own 自选 sequence (tier 5: 24, 25 → 26…; tier 6:
    21, 22 → 23…). Neither is read for a 自选 record (`visible: false`, so the shop-order readers skip it) — they are
    carried because the record shape is (`shared/standIn.js IDENTITY_FIELDS`).
  - `applyForkBackups(backups)` — the matching `diy.slots` entries. Each copies its tier's official slot metadata
    (`shopLevel` — the 调度中心 level the slot enters the shop at — and `requirement`); only `goldenId` differs. Nothing
    else in `backups` needed a fork entry: the unit forms and the summon variants are keyed by `statusKey` (a new slot
    reuses its tier's `status`) and `diy.prototypes` / `locked` / `ownedPool` are keyed by tier, not by slot.
  - Both appliers are pure and **own** their ids exactly like `applyForkOverrides` owns the fork mode record: every id
    in `FORK_DIY_SLOT_IDS` is dropped and rebuilt from its tier's official template, so a hand-edit of one is reverted
    and caught by the drift guard. They must recognise the `_b` twin of a previous run too, or a second pass reads it as
    an official anchor and reorders the file.
  - `tools/fork-data.mjs` applies both to the committed `data/chess.json` / `data/backups.json`, and
    `tools/build-data.mjs` applies them inside the **per-potential-rank loop** (`main()`), before `buildBackups` — not
    once on the full-potential pass: `attachPotential` rebuilds each chess record from `passes.map((p) => p.chess[id])`
    and reports "missing at a rank" for an id only one pass has. Applying before `buildBackups` also lets the new
    slots' forms and prototype picks be validated like the official ones, and `applyForkBackups` then replaces the
    `shopLevel: null` that `buildBackups` gives them (the official shop-level table lists only the four official slots).
  - `DIY_LIMITS.slots` rises 8 → 10 (`shared/protocol.js`) so a full roster fits the wire check. The tier rules are
    **count-independent** and needed no change: "the same operator twice in one tier" and "an owned operator in one
    slot" are `Map`/`Set`-based, not count-based.
  - **Scope** — the official 4 slots and their data are untouched (the applier only appends), the official modes' rules
    are untouched, and the golden corpus deliberately keeps rotating its 自选 configurations onto the **official** two
    slots per tier (`tools/golden.mjs DIY_CORPUS_SLOTS`): every slot of a tier shares its `status`, so which one a piece
    is fielded as cannot change a battle — rotating over the fork's slots too would only rewrite all 140 diy digests
    with a different slot id and carry no information. **No golden file moved** (verified: all 140 diy scenarios are
    byte-identical once the slot id is normalised).
  `test/fork-data.test.js` (the drift guard for both files, purity, idempotence, build order, and that `backups` needed
  nothing else), `test/fork-diy-slots.test.js` (a full 10-slot roster through the real match engine: wire limit, stocks,
  shop levels, battle records, tier rules), plus the updated count assertions in `test/data.test.js`,
  `test/backups.test.js`, `test/diy.test.js`, `test/ui/diy-ui.test.js` and `test/golden-diy.test.js`.

## Fork change log

| Change | What it does | Where |
|---|---|---|
| 终极模拟 room | the third room mode, six seats, fixed AC-4, `mode_ultimate_abyss` | as listed above |
| 二.1 盟约不禁用 | the mode draws 0 bond bans (`bans: { core: 0, addon: 0 }`), `modeIdFor('ultimate', …)` always resolves `mode_ultimate_abyss` and a 终极模拟 room's difficulty is clamped to ABYSS; its card says 盟约与干员全部解锁 | `tools/fork-overrides.mjs`, `server/match/gamedata.js` (`bans()`), `shared/constants.js` (`modeIdFor`), `server/match/Match.js`, `server/match/StubMatch.js`, `test/fork-ultimate-bans.test.js` |
| 二.2 商店升级槽位 | one 干员槽 per operator level (3→7) and a second 道具槽 at level 6 | `tools/fork-overrides.mjs` (`shopSlots`), `test/fork-ultimate-shop.test.js` |
| 二.3 敌人属性调整 | R4 on: ordinary +10 % HP; leader +20 % HP/+20 % DEF/+8 % ATK; hidden core +35 % HP/+35 % DEF/+16 % ATK — HP per boss id | `tools/fork-overrides.mjs` (`enemyAdjust`), `server/match/gamedata.js` (`enemyExtras`/`bossHpExtra`), `server/match/waves.js`, `server/match/finalAssault.js`, `test/fork-ultimate-enemy-stats.test.js` |
| 二.4 机变去时限 + 投票 | untimed, parallel draft with a 随机分配 vote (half the alive players resolves it randomly, one card each; 悬赏 never drawn and never voted on) + the AC-4 机变 schedule for the fork mode | `tools/fork-overrides.mjs` (`spDraft`, `applyForkChoices`), `server/match/Match.js` (SP_DRAFT), `server/match/gamedata.js` (`spDraftRules`), `shared/protocol.js` (`g.choiceRandom`), `server/match/audit.js`, `public/js/ui/choiceOverlay.js`, `public/js/ui/gameLogic.js`, `public/js/ui/gameActions.js`, `public/js/screens/game.js`, `test/fork-ultimate-sp-vote.test.js` |
| 二.5 版面 | 三个模式卡是一行三个等宽的竖向选择；终极模拟房间是六个等宽的竖向席位（同盟模拟的四座网格与独立模拟都不受影响） | `public/css/screens/lobby.css` (`.mode-cards`), `public/css/screens/room.css` (`.seats--ultimate`), `public/js/screens/room.js`, `test/client-static.test.js` |
| 二.6 表情：一键十连 + 弹幕 | one tap sends an emote 10 times (one `g.emoteBurst`, one cooldown); emotes also fall like snowflakes from a random x, fading out past the bottom edge, on every client's screen | `shared/constants.js` (`EMOTE_BURST_COUNT`/`EMOTE_BARRAGE_MS`), `shared/protocol.js` (`g.emoteBurst`), `server/match/match/intents.js` (`emoteBurst`), `public/js/ui/emotes.js` (`EmoteBarrage`, `emotePrefsStore`, the two switches), `public/css/emotes.css` (`emo-fall`), `public/js/ui/gameActions.js`, `public/js/screens/game.js`, `test/fork-emote-burst.test.js`, `test/client-static.test.js` |
| 二.7 房主配置 | 每个模式的准备房间都有一个房主配置面板（仅房主可改）：共享卡池、共享悬赏、AI 队友最后选择、多同盟模式；房间跨对局保留，开局时交给对局。私人房间按用户要求不做 | `shared/constants.js` (`HOST_CONFIG_KEYS`/`HOST_CONFIG_DEFAULTS`), `shared/protocol.js` (`room.setHostConfig`), `server/lobby.js`, `server/match/Match.js`, `server/match/match/infra.js` (`poolFor`), `server/match/match/spDraft.js`, `server/match/match/phases.js`, `server/match/player/*`, `server/match/bot.js`, `server/match/invariants.js`, `server/match/audit.js`, `public/js/screens/room.js`, `public/css/screens/room.css`, `public/js/screens/bandDraft.js`, `public/js/ui/gameLogic/draft.js`, `test/lobby-host-config.test.js`, `test/match/host-config.test.js`, `test/ui/host-config.test.js` |
| 二.8 自选编队 10 个名额 | 自选编队每阶 5 个名额（5 阶 5 + 6 阶 5 = 10，官方为每阶 2）：额外 6 个槽位由 fork 数据层生成（`chess.json` 的 `…_diyN_a`/`_b` 记录对 + `backups.json` 的 `diy.slots`），复制同阶官方槽位的 status/价格/合成数；`DIY_LIMITS.slots` 8 → 10；官方 4 槽位与所有官方模式规则不变，**golden 未移动** | `tools/fork-overrides.mjs` (`applyForkChess`/`applyForkBackups`), `tools/fork-data.mjs` (LAYER), `tools/build-data.mjs` (per-rank 循环), `shared/protocol.js` (`DIY_LIMITS`), `data/chess.json`, `data/backups.json`, `tools/golden.mjs` (`DIY_CORPUS_SLOTS`), `test/fork-data.test.js`, `test/fork-diy-slots.test.js` |
