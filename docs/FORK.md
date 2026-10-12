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
- **二.4 机变阶段改造** — the mode carries `spDraft: { untimed: true, parallel: false, randomVote: { families: ['supply',
  'shop', 'tactic'] } }`. `GameData.spDraftRules` normalises it (all off without the block), `Match.enterSpDraft` turns
  the draft untimed, and `Match.voteRandomChoice` (the `g.choiceRandom` intent, `Match.js` SP_DRAFT section) tallies
  votes: `votes × 2 ≥ alive` resolves the draft by `resolveRandomChoice`, which shuffles the random-eligible cards and
  the alive players and hands one card to each — over their own pick, which is the point of the vote; below half every
  player keeps the card it picked, and a voter who picked nothing takes nothing. UNTIMED ("移除原有的时间限制") means the
  phase ends when every alive player has picked or voted.
  The turn order is KEPT (`parallel: false`, the owner's report of 2026-10-12: 「无论在哪个机变阶段，它都没有按照顺序来，而是谁
  手快谁先抢到」 — the official 机变 is a turn order, the overlay's 决策顺序 row, one 博士 at a time). 二.4 first made the
  whole draft parallel on the theory that no clock + one player at a time could stall the round; the order came back, and
  the vote is what keeps an untimed sequential draft from ever stalling: `g.choiceRandom` is accepted at ANY time, not
  only on the voter's turn (`voteRandomChoice` no longer requires `parallel`; `spDone` counts a vote as done, so the
  turn advances past a voter; `m.public`'s status reads a voter as ready). A seat that neither picks nor votes can still
  hold the round — as in any untimed turn-based draft — and the host can hand it to the AI (AI 托管), which picks for it.
  悬赏 cards are never drawn (`randomChoiceEligible` refuses `family === 'bounty'`) and in a 悬赏决策 draft the vote is not
  offered at all — "悬赏类不要添加随机机制" (a bounty adds its enemies to the PICKER's own next battles, so handing it to
  somebody else would break the attribution). The draft's `randomOffer` in `m.public` is non-null exactly when the vote
  is offered for that draft, so `public/js/ui/choiceOverlay.js` renders the 随机分配 button on the frame alone — keyed on
  `randomOffer`, never on `parallel`. `server/match/audit.js` accepts a player ending after only a lost vote.
  `test/fork-ultimate-sp-vote.test.js`.
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
  the host alone. It opens as a **dialog** from a button in the ready bar, left of 干员调配 (`HostConfigButton` /
  `HostConfigDialog`, the shared `Modal` — the same pattern as 干员调配, so the options no longer take a band under the
  seats); the button's badge counts the options that differ from their default. It is a fork feature: the official room
  has a difficulty picker and 「房间未满4人时搜寻队友」 only (research 06 §3.2), and no source documents these four
  options — the labels and explanations are the requester's.
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
- **二.9 一键满配** — the 干员调配 tab's top bar gains **一键满配** beside 全部恢复默认: one confirmed click puts every
  operator of the roster back to 潜能 6 / 精英阶段2-60级, so a player who lowered operators for a faithful-to-the-official
  run does not have to restore them one by one (the requester's purpose: 「不用手动一个个切换干员强度」).
  - **It adds no stat math, and that is the whole design.** 潜能 6 / 精英阶段2-60级 already ARE
    `POTENTIAL_DEFAULT` / `CULTIVATE_DEFAULT` (`shared/potential.js` — the owner's 「默认满潜满加成」 of 2026-10-08), and
    `setOps` keeps an entry only when a value **differs** from the default. So "the maximum" is the **absence** of a
    setting: the button clears the lowered entries (`maxAllOps` → `setOps(ops, id, { potential: POTENTIAL_MAX,
    cultivate: CULTIVATE_MAX })`) and the sim, the shop cards and 局内数值 then read exactly the defaults they read
    before the player ever touched the selects. Nothing about the official 潜能 / 练度 rules, the wire format
    (`room.loadout.ops`) or the sim changes; the two values come from `POTENTIAL_MAX` / `CULTIVATE_MAX` rather than a
    literal 6 / 3, so a data change would move them.
  - **Scope** — it is deliberately scoped to the **roster** (`maxableIds` = the 干员调配 tab's list, the same scope as
    全部恢复默认) and touches **only** `ops`: skills and modules are never written (that is what 全部恢复默认 is for), and
    a 自选 pick's 潜能 / 练度 stays on its own slot card on the 自选编队 tab. The button is disabled while
    `maxAllOpsCount` is 0, so it is never a no-op click, and it confirms first because it changes many operators at once.
  - **Not mode-gated — universal, by the requester's own call** (2026-10-09: 「PR13的功能实现在干员调配设置里，也就是
    全模式通用」). It lives in the 干员调配 tab, so it shows in every mode. Like 自选编队 (official 0.2.0) and 二.7
    房主配置, it is a **局外设置** convenience on a screen shared by all three modes; it changes no rule of any mode,
    writes only values the player could have written by hand with the existing selects, and leaves the official modes'
    behaviour (and their 潜能 / 练度 semantics) exactly as it was. The 精锐 Lv.7 the requester named is **not** a setting
    at all: it is the elite chess record's own skill level in the data (`skills[].level = 7`, and the 普通 / 精锐 toggle
    on the detail is display-only), so nothing was added for it.
  `test/ui/potential-ui.test.js` (the model: the maximum is the default, only the named operators move, idempotence, the
  result is what the server keeps, only 潜能 / 练度 keys) and `test/ui/loadout-rows.test.js` (the button's wiring, its
  roster scope, its disabled state, and that it never touches the entries).

- **四.1 Mod 开关（模式界面）** — the 模式界面's top bar gains a **Mod** button with a submenu, laid out beside 干员调配
  (the requester's 图一: 「在模式界面添加 Mod 开关，mod开关只会在当前页面有，Mod 开关拥有一个子菜单，与顶栏干员调配平行放置」).
  The submenu holds the fork's gameplay switches; each one defaults OFF, so a player who never opens it plays the
  official game exactly.
  - **What a switch is, and what it is not.** A Mod 开关 is a **per-device preference**, not a room option: it lives in
    `localStorage` (`sp.pref.mods`, `public/js/ui/mods.js` — the `ui/emotes.js` 一键十连 / 弹幕 pattern), the 模式界面 is
    the only place that shows it, and the creator carries it into the room it makes (`room.create.mods`, the new
    optional field of `shared/protocol.js`). The room keeps it across its matches and hands it to the match as
    `opts.mods`; a joiner therefore plays **the host's** rules, the same way it plays the host's mode and difficulty.
    This is the requester's own choice (「本机偏好，开局时带到自己创建的房间」), and it is what makes the switches usable
    without a second lobby panel and without disturbing 房主配置 (二.7), which stays the host-only room option set.
  - **The catalogue is `MOD_KEYS` / `MOD_DEFAULTS` / `normalizeMods` in `shared/constants.js`.** `normalizeMods` is pure
    and total: a missing, malformed or unknown-keyed payload becomes the official default, so an unknown switch can
    never turn anything on. `room.create.mods` is validated against `MOD_KEYS` with boolean values — an unknown key is
    `BAD_MSG` rather than a silent drop, because a client asking for a switch the server does not have is a version
    mismatch and silently ignoring it would run a match the player did not ask for.
  - **`GameData` is where the switches act** (`server/match/gamedata.js`, built with `new GameData(data, modeId, mods)`),
    on three seams, each of which falls back to the official value when the switch is off:
    - **`noBondBan` 关闭盟约禁用** — `bans()` returns `{ core: 0, addon: 0 }` for every mode, and `modeInactiveBonds` is
      emptied. Both halves are needed: the per-match draw comes from `config.bans` (the difficulty table) or
      `modes[].bans`, while 标准模拟's ten 本局禁用 盟约 come from the mode's own `inactiveBondIds` list — leaving the
      second in place would make the switch half a switch. This is 二.1's 「此模式下所有盟约不会被禁用」 generalised
      from a property of 终极模拟 into a switch that works in **all** modes, which is exactly what the requester asked
      for. The client must not re-derive the config's list behind the server's back, so `modeOffBonds(mode, mods)`
      (`public/js/ui/gameLogic/bonds.js`) and `matchInfoModel` read `m.public.mods` and grey nothing with it on.
    - **`untimedSp` 机变不限时** — `spDraftRules.untimed` turns on for every mode, the 终极模拟 `spDraft` block or not,
      so `startSpTurn` arms no clock (`spFirst` / `spTurn` are not read) and the draft ends when every alive player has
      picked. The switch never touches `parallel` or `randomFamilies` — those belong to the mode (二.4) and to 四.2.
    - The third seam the switch reaches is the client's own countdown, which needs no code: the server sends
      `sp.untimed` (already the field 独立模拟's untimed draft uses) and `choiceOverlay.js` hides the timer from it.
  - **The match reports the switches back** on every frame (`m.public.mods`, `server/match/match/views.js`), like
    `hostConfig`, so a client can mark what a switch changed; `room.state.mods` shows them in the room.
  - **No golden file moves** (verified: roster 49 / bonds 46 / fields 22 / matches 20 / standins 10 / diy 140 all
    match). Every switch defaults off, so a match created without them — the golden scenarios, the rehearsal tools,
    every pre-existing test — is byte-identical to before; the 20 match scenarios pin exactly that.
  `test/fork-mod-switches.test.js` (the catalogue, `normalizeMods`'s totality, both switches' rules in every mode, a
  real match's pool and `m.public.mods`), `test/lobby-mods.test.js` (the wire: an official room without mods, a
  creator's switches reaching the match, partial payloads, the unknown-key refusal, the room keeping them across its
  matches and a host migration), and the `room.create.mods` protocol cases in `test/lobby-ultimate.test.js`.

- **三.1–三.3 UI 回顾（电脑 + 手机一并看）** — three items from the requester's screenshots, all **universal interface
  work**: no mode rule moves, no golden file moves.
  - **三.1 隐藏滚动条** — the 局内盟约 popup (`.bpop`) and the operator detail card's scroller (`.dpanel__scroll`) each
    showed a native scrollbar on their right edge (`public/css/screens/game-panels.css`). Both now use
    `scrollbar-width: none` plus a zero-width `::-webkit-scrollbar` (the repo's existing idiom: `stats.css` `.st-tabs`,
    `loadout.css`); scrolling and the content are unchanged.
  - **三.2 局内 ⚙ / 📖 / ⛶ 移到顶栏左侧** — the three buttons used to be a row in the bottom-left corner beside 交流. The
    requester asked for them **above, level with the top bar, 交流 excluded**. They are now `.gm__tools` in the top
    bar's left block (`public/js/ui/hud.js` `TopBar`'s `tools` slot, filled by `public/js/screens/game.js`), and 交流
    keeps the corner (`.gm__corner`) alone.
    - Desktop: `.56rem`, the same order as 离开's `.64rem` square; short touch screens: `max(.5rem, 28px)` with
      `max(.16rem, 10px)` gaps, so the 44 px hit areas are 44 px apart and never cover each other.
    - Narrow phones (< 768 CSS px, where the root scale is clamped at 40 px): the row does not fit beside
      离开 + ping + 难度 before the centre brackets (a 观战席 capsule widens that group again), so `css/devices.css`
      wraps it onto a **second line in the top-left** and lets `.gm__bonds` start right of it (`left: 3.4rem`). The
      strip's own top is deliberately unchanged, so `HUD_REM.bondStripBottom` (2.16 rem) and the prep camera's top band
      do not move, and the bench is never covered by a lowered strip.
    - `ui/fieldHost.js` `cornerBand` now measures the 交流 button alone (the corner's only control), so the folded
      shop's board grows a little; `HUD_REM.cornerTop` (.24 + .56 rem) is unchanged. The narrow-phone left detail card
      only has to clear 交流 now.
  - **三.3 大厅顶栏两侧平衡** — the requester: the two left squares were too large and the two right buttons too small.
    The left `.topbar__tools` squares drop 40 → **36 px** on touch screens (10 px gap, 46 px between hit-area centres);
    干员调配 rises from `size="sm"` to the default size and is floored at **36 px** tall with an 11 px label on touch
    screens, and the player chip takes the same `min-height` — both sides one height
    (`public/css/components.css`, `public/js/screens/lobby.js`).
  - **The standing convention** — the requester's long-term instruction: 「以后任何界面改动都要同时兼顾电脑与手机」.
    It is written down as the two-device rule in `docs/design/client.md` §10: `css/devices.css` is the last layer and
    carries the phone overrides, `test/ui/devices.e2e.test.js` runs the real HUD at 640×360 … 1366×768, and every
    further UI change is verified on both.
  `test/ui/playtest5-ui.test.js` + `test/ui/issue5-fold-camera.test.js` (the CSS rules and the HUD bands),
  `test/ui/playtest5-ui.e2e.test.js` (the three glyphs: regular gear, square, half the button; the screenshot moved to
  the top bar), `test/ui/devices.e2e.test.js` (the ≥ 44 px hit areas and the card never covering the row).

- **三.4–三.6 三个玩法 bug** — the requester's three reports of 2026-10-12, fixed in one change. Only 三.4 is a fork
  matter; 三.5 and 三.6 are universal rules (see the fork change log for the one golden move).
  - **三.4 机变恢复轮次顺序** — 「无论在哪个机变阶段，它都没有按照顺序来，而是谁手快谁先抢到」. 二.4's `parallel: true` was
    exactly that: it replaced the official turn order with "everyone decides at once". The order is back
    (`parallel: false`) and the 随机分配 vote stays, now castable at any time so an untimed sequential draft can still
    never stall. Details and the files in the 二.4 entry above.
  - **三.5 升级补货** — 「商店升级后，新的购买槽位不会自动刷新出现干员」. `PlayerState._openLevelSlots` draws a card into
    every position the new level opens, at the new level, instead of leaving it `null`. 0.2.2 §27.52 had made it empty
    on a second-hand reading of an official recording; the owner's ruling of 2026-10-12 puts the 0.2.0 behaviour back
    (the record stays in `docs/history/0.2.2.md` as the deviation). The cards already shown stay where they are, and
    the new card follows the freeze toggle as a refresh's do [ASSUMED]. **All modes** — the shop rule is not
    fork-specific. `server/match/player/economy.js`, `server/match/audit.js`, `docs/META.md` §3, `docs/PLAYING.md`.
    Golden: `matches` — **all 20 scenarios** move, because every bot levels its shop and now draws the new card (a
    shifted shop RNG stream, the same class of move §27.52 recorded); roster / bonds / fields / standins / diy are
    unchanged, and the fork mode is not in the golden corpus at all.
  - **三.6 撤下干员后盟约图标不激活** — 「场上没有相应的干员，盟约显示区还是继续显示对应的盟约」. The bond counting was never
    wrong (server `computeBonds` / the pushed `m.private` / the real client DOM all follow the count, 独行 included:
    2 deployed → dim, withdraw one → lit). What stayed on screen was a bond whose members had **all** left the field but
    which still had banked layers: `bondList` listed it on `b.layers > 0`, so the strip kept a dim disc for a bond with
    nobody on the field. It is now listed only while it has a member on the field or an active tier (`ps.layers` keeps
    the layers, so re-fielding a member brings the bond back with them). The settlement record is the one exception —
    `results.js` passes `keepLayerOnly` and still lists what the player ended the match with. `server/match/bondsMeta.js`
    (`bondList`), `server/match/results.js`, `docs/META.md` §3/§5. Golden: unchanged (the digests read `ps.bonds`
    directly, not `bondList`).

## Fork change log

| Change | What it does | Where |
|---|---|---|
| 终极模拟 room | the third room mode, six seats, fixed AC-4, `mode_ultimate_abyss` | as listed above |
| 二.1 盟约不禁用 | the mode draws 0 bond bans (`bans: { core: 0, addon: 0 }`), `modeIdFor('ultimate', …)` always resolves `mode_ultimate_abyss` and a 终极模拟 room's difficulty is clamped to ABYSS; its card says 盟约与干员全部解锁 | `tools/fork-overrides.mjs`, `server/match/gamedata.js` (`bans()`), `shared/constants.js` (`modeIdFor`), `server/match/Match.js`, `server/match/StubMatch.js`, `test/fork-ultimate-bans.test.js` |
| 二.2 商店升级槽位 | one 干员槽 per operator level (3→7) and a second 道具槽 at level 6 | `tools/fork-overrides.mjs` (`shopSlots`), `test/fork-ultimate-shop.test.js` |
| 二.3 敌人属性调整 | R4 on: ordinary +10 % HP; leader +20 % HP/+20 % DEF/+8 % ATK; hidden core +35 % HP/+35 % DEF/+16 % ATK — HP per boss id | `tools/fork-overrides.mjs` (`enemyAdjust`), `server/match/gamedata.js` (`enemyExtras`/`bossHpExtra`), `server/match/waves.js`, `server/match/finalAssault.js`, `test/fork-ultimate-enemy-stats.test.js` |
| 二.4 机变去时限 + 轮次顺序 + 投票 | untimed draft that KEEPS the turn order (`parallel: false` — the owner's 2026-10-12 report 「谁手快谁先抢到」) with a 随机分配 vote castable at any time (half the alive players resolves it randomly, one card each; 悬赏 never drawn and never voted on) + the AC-4 机变 schedule for the fork mode | `tools/fork-overrides.mjs` (`spDraft`, `applyForkChoices`), `data/config.json`, `server/match/Match.js` (SP_DRAFT), `server/match/gamedata.js` (`spDraftRules`), `server/match/match/spDraft.js` (`spDone`/`startSpTurn`/`voteRandomChoice`), `server/match/match/views.js`, `shared/protocol.js` (`g.choiceRandom`), `server/match/audit.js`, `public/js/ui/choiceOverlay.js`, `public/js/ui/gameLogic/draft.js`, `public/js/screens/game.js`, `test/fork-ultimate-sp-vote.test.js`, `test/fork-data.test.js` |
| 二.5 版面 | 三个模式卡是一行三个等宽的竖向选择；终极模拟房间是六个等宽的竖向席位（同盟模拟的四座网格与独立模拟都不受影响） | `public/css/screens/lobby.css` (`.mode-cards`), `public/css/screens/room.css` (`.seats--ultimate`), `public/js/screens/room.js`, `test/client-static.test.js` |
| 二.6 表情：一键十连 + 弹幕 | one tap sends an emote 10 times (one `g.emoteBurst`, one cooldown); emotes also fall like snowflakes from a random x, fading out past the bottom edge, on every client's screen | `shared/constants.js` (`EMOTE_BURST_COUNT`/`EMOTE_BARRAGE_MS`), `shared/protocol.js` (`g.emoteBurst`), `server/match/match/intents.js` (`emoteBurst`), `public/js/ui/emotes.js` (`EmoteBarrage`, `emotePrefsStore`, the two switches), `public/css/emotes.css` (`emo-fall`), `public/js/ui/gameActions.js`, `public/js/screens/game.js`, `test/fork-emote-burst.test.js`, `test/client-static.test.js` |
| 二.7 房主配置 | 每个模式的准备房间都有一个房主配置面板（仅房主可改）：共享卡池、共享悬赏、AI 队友最后选择、多同盟模式；房间跨对局保留，开局时交给对局。私人房间按用户要求不做 | `shared/constants.js` (`HOST_CONFIG_KEYS`/`HOST_CONFIG_DEFAULTS`), `shared/protocol.js` (`room.setHostConfig`), `server/lobby.js`, `server/match/Match.js`, `server/match/match/infra.js` (`poolFor`), `server/match/match/spDraft.js`, `server/match/match/phases.js`, `server/match/player/*`, `server/match/bot.js`, `server/match/invariants.js`, `server/match/audit.js`, `public/js/screens/room.js`, `public/css/screens/room.css`, `public/js/screens/bandDraft.js`, `public/js/ui/gameLogic/draft.js`, `test/lobby-host-config.test.js`, `test/match/host-config.test.js`, `test/ui/host-config.test.js` |
| 二.8 自选编队 10 个名额 | 自选编队每阶 5 个名额（5 阶 5 + 6 阶 5 = 10，官方为每阶 2）：额外 6 个槽位由 fork 数据层生成（`chess.json` 的 `…_diyN_a`/`_b` 记录对 + `backups.json` 的 `diy.slots`），复制同阶官方槽位的 status/价格/合成数；`DIY_LIMITS.slots` 8 → 10；官方 4 槽位与所有官方模式规则不变，**golden 未移动** | `tools/fork-overrides.mjs` (`applyForkChess`/`applyForkBackups`), `tools/fork-data.mjs` (LAYER), `tools/build-data.mjs` (per-rank 循环), `shared/protocol.js` (`DIY_LIMITS`), `data/chess.json`, `data/backups.json`, `tools/golden.mjs` (`DIY_CORPUS_SLOTS`), `test/fork-data.test.js`, `test/fork-diy-slots.test.js` |
| 二.9 一键满配 | 干员调配顶栏加「一键满配」（在「全部恢复默认」旁）：一次确认把所有干员的潜能与练度设回满配（潜能 6、精英阶段2-60级）。满配本来就是默认值，所以这个按钮只是清掉被调低的条目——**不引入任何数值计算**，也不碰技能与模组。全模式通用（需求方决定） | `public/js/ui/loadoutModel.js` (`maxAllOps`/`maxAllOpsCount`), `public/js/screens/loadout.js`, `public/i18n/*.json`, `test/ui/potential-ui.test.js`, `test/ui/loadout-rows.test.js` |
| 三.1–三.3 UI 回顾 | 隐藏局内盟约与干员详细两处滚动条；⚙ / 📖 / ⛶ 从角落移到顶栏左侧（交流留在角落），窄屏换到第二行并给盟约栏让出左侧；大厅顶栏左右两组按钮同高（触摸屏 36 px）；「界面改动要兼顾电脑与手机」写成 client.md §10 的设备规则 | `public/css/screens/game-panels.css`, `public/css/screens/game.css`, `public/css/devices.css`, `public/css/components.css`, `public/js/ui/hud.js`, `public/js/screens/game.js`, `public/js/ui/fieldHost.js`, `public/js/screens/lobby.js`, `docs/design/client.md`, `test/ui/playtest5-ui.test.js`, `test/ui/issue5-fold-camera.test.js`, `test/ui/playtest5-ui.e2e.test.js`, `test/ui/devices.e2e.test.js` |
| 三.4–三.6 三个玩法 bug | 三.4 机变恢复轮次顺序（见 二.4）；三.5 升级调度中心立刻补上新栏位的干员（全模式，0.2.2 §27.52 的反转）；三.6 场上没有成员的盟约不再留在盟约栏（层数仍保留，结算记录例外） | `tools/fork-overrides.mjs` (`spDraft`), `data/config.json`, `server/match/match/spDraft.js`, `server/match/match/views.js`, `public/js/ui/choiceOverlay.js`, `server/match/player/economy.js`, `server/match/audit.js`, `server/match/bondsMeta.js` (`bondList`), `server/match/results.js`, `docs/META.md`, `docs/PLAYING.md`, `tools/golden.mjs`, `test/golden/matches.json`, `test/fork-ultimate-sp-vote.test.js`, `test/fork-data.test.js`, `test/match/feedback5-shop-levelslots.test.js`, `test/match/bonds.test.js`, `test/match/watch-bonds.test.js`, `test/match/bot-smarter.test.js`, `test/golden-diy.test.js`, `test/golden-standins.test.js` |
| 四.1 Mod 开关 | 模式界面顶栏加「Mod」按钮与子菜单（与干员调配平行，只在该页出现）：本机偏好，随创建的房间生效。`noBondBan` 关闭盟约禁用——全模式都不再有随机禁用与固有禁用盟约（把二.1 从终极模拟的属性推广成开关）；`untimedSp` 机变不限时——全模式机变不再计时。两个开关默认关闭，golden 未移动 | `shared/constants.js` (`MOD_KEYS`/`MOD_DEFAULTS`/`normalizeMods`), `shared/protocol.js` (`room.create.mods`), `server/match/gamedata.js` (`mods`, `bans()`, `modeInactiveBonds`, `spDraftRules`), `server/match/Match.js`, `server/match/match/views.js`, `server/lobby.js`, `public/js/ui/mods.js`, `public/js/screens/lobby.js`, `public/js/ui/gameLogic/bonds.js`, `public/js/ui/matchInfo.js`, `public/js/screens/game.js`, `public/js/screens/bandDraft.js`, `public/css/screens/lobby.css`, `public/i18n/*.json`, `test/fork-mod-switches.test.js`, `test/lobby-mods.test.js`, `test/lobby-ultimate.test.js` |
