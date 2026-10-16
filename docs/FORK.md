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

## 扩展模拟 — the fork's third room mode

`扩展模拟` is the official game's third 模拟方式 (alongside 独立模拟 and 同盟模拟) but upstream only models the first
two: a room is `solo` or `coop` and the mode id is `mode_{single|multi}_{difficulty}`. The fork adds it as a real
third room mode.

| | 独立模拟 `solo` | 同盟模拟 `coop` | 扩展模拟 `ultimate` |
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
  stays the two-valued *behaviour* switch, so 扩展模拟 plays with the co-op rules (联防, pairing, merged LP).
- `public/js/screens/lobby.js` — the third mode card and the single-difficulty rendering (`MODE_CARDS`,
  `difficultyInfo`, `effDifficulty`).
- `public/js/screens/room.js` — `normalizeSeats()` pads to `roomSeatCap(room.mode)`; the difficulty picker is
  replaced by a fixed tag.
- `tools/fork-overrides.mjs` — the `mode_ultimate_abyss` record (a copy of the AC-4 co-op mode plus the fork's own
  fields).

What the fork mode deliberately starts as: **an exact copy of AC-4 co-op**, so the room is playable the moment it
exists. The fork's per-mode rules land on top of it one change at a time, each one extending
`tools/fork-overrides.mjs` and its own test file:
- **二.1 盟约禁用（2026-10-13 反转）** — the six-博士 room bans 盟约 **exactly like 同盟模拟**. 二.1 first gave the mode
  its own `bans: { core: 0, addon: 0 }` table so the seeded per-match draw of `server/match/pool.js` removed nothing
  and no 干员 ever left the shop. The owner's ruling reverses that — 「六人模式恢复像同盟模拟一样禁用一些盟约，全不禁止
  需要在 Mod 菜单开启」 — so the record carries **no** table of its own and `GameData.bans()` falls back to the
  difficulty's (`config.bans`, ABYSS = 3 core + 4 add-on), byte-for-byte what `mode_multi_abyss` resolves. 「全不禁止」
  is now the Mod 开关 `noBondBan`'s job (四.1): it overrides `bans()` with `{ core: 0, addon: 0 }` and empties
  `modeInactiveBonds` in every mode. The mode's difficulty card lost its 「盟约与干员全部解锁」 line with it, because
  the draw makes that claim false. The mode still has ONE record (`mode_ultimate_abyss`, `ULTIMATE_DIFFICULTY`), so
  `modeIdFor('ultimate', d)` always names it and `Match` / `StubMatch` clamp a 扩展模拟 room's difficulty to ABYSS: an
  id naming a record that is not in `config.modes` left `GameData` with an empty mode record and the draw came back
  wrong (player report, fixed). `test/fork-ultimate-bans.test.js`.
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
- **二.4 机变阶段改造 — NOW SWITCH-CONTROLLED (the owner's report of 2026-10-13).** 二.4 first hard-coded
  `spDraft: { untimed: true, parallel: false, randomVote: { families: ['supply', 'shop', 'tactic'] } }` on the mode, which
  made both Mod 开关 dead in 六人模式: `GameData.spDraftRules` ORed the mode's own value into the switch's answer, so
  turning 机变不限时间 OFF left `untimed: true` standing and turning 机变随机分配 OFF left the vote offered. The owner's
  ruling — 「关闭时，恢复原版的时间限制」 and 「在六人模式中，该开关应能正确控制」 — is that the switches DECIDE: the mode
  declares no block, and OFF is the official draft in every mode. `spDraftRules` still reads a mode's own block as the
  DEFAULT a switch overrides, so a future mode can declare one; `parallel` stays false regardless (三.4). See 四.1 / 四.2.
  `Match.voteRandomChoice` (the `g.choiceRandom` intent, `Match.js` SP_DRAFT section) tallies votes: `votes × 2 ≥ alive`
  resolves the draft by `resolveRandomChoice`, which shuffles the random-eligible cards and the alive players and hands one
  card to each — over their own pick, which is the point of the vote. Below half, **every player keeps a card, the voter
  included**: a vote is a request rather than a decision, so `spDone` counts only cards, the voter keeps its turn and may
  pick normally, and `finishSpDraft` backfills any living seat that still holds nothing. (It used to be the reverse —
  「a player who only voted and lost the vote takes nothing this round」 — which is the reported 「导致最后一名玩家没有拿到任何
  道具或敌人」.) UNTIMED ("移除原有的时间限制") means the phase ends when every alive player has picked.
  The turn order is KEPT (`parallel: false`, the owner's report of 2026-10-12: 「无论在哪个机变阶段，它都没有按照顺序来，而是谁
  手快谁先抢到」 — the official 机变 is a turn order, the overlay's 决策顺序 row, one 博士 at a time). 二.4 first made the
  whole draft parallel on the theory that no clock + one player at a time could stall the round; the order came back, and
  `g.choiceRandom` is accepted at ANY time, not only on the voter's turn (`voteRandomChoice` no longer requires `parallel`),
  so the vote remains the escape hatch of an untimed draft. A seat that neither picks nor votes can still hold the round —
  as in any untimed turn-based draft — and the host can hand it to the AI (AI 托管), which picks for it.
  悬赏 cards are never drawn (`randomChoiceEligible` refuses `family === 'bounty'`) and in a 悬赏决策 draft the vote is not
  offered at all — "悬赏类不要添加随机机制" (a bounty adds its enemies to the PICKER's own next battles, so handing it to
  somebody else would break the attribution). The draft's `randomOffer` in `m.public` is non-null exactly when the vote
  is offered for that draft, so `public/js/ui/choiceOverlay.js` renders the 随机分配 button on the frame alone — keyed on
  `randomOffer`, never on `parallel`. `server/match/audit.js` accepts a player ending with a card it drew or picked.
  `test/fork-ultimate-sp-vote.test.js`.
- **二.4 also needed a 机变 schedule** — `choices.schedule` is keyed by modeId and the official data has no entry for a
  mode that never shipped, so without one the fork mode fell back to a plain 道具补给 draft every round (no 悬赏 at all,
  and the vote would have had nothing to gate). `applyForkChoices()` in `tools/fork-overrides.mjs` copies AC-4's
  schedule onto the fork modeId in `data/choices.json`; `tools/fork-data.mjs` and `tools/build-data.mjs` apply it like
  the config layer, and `test/fork-data.test.js` guards it with the same idempotence check.
- **二.5 大厅与房间的版面** — the fork's third mode made two upstream grids wrong, because both were sized for two
  modes and four seats:
  - **模式卡** — `public/css/screens/lobby.css` `.mode-cards` was `grid-template-columns: 1fr 1fr`, so with three
    cards (独立模拟 / 同盟模拟 / 扩展模拟) the third wrapped onto a second row at a different width. It is now
    `repeat(3, minmax(0, 1fr))`: three EQUAL 竖向 choices in one row, every card keeping its portrait shape
    (icon over name over description).
  - **六席位** — the 同盟模拟 seat grid is `repeat(4, minmax(0, 3.8rem))` with one row, which left seats 5–6 on a
    half-empty second row of a different width. `public/js/screens/room.js` now adds `seats--ultimate` for
    `room.mode === 'ultimate'` and `public/css/screens/room.css` gives it
    `repeat(6, minmax(0, 1fr))` / `minmax(0, 1fr)`: six EQUAL 竖向 positions in one row, same size, in seat order.
    A six-seat room needs its own grid rule; the co-op and solo rooms are untouched.
  `test/client-static.test.js` guards both rules and the class wiring.
- **二.6 表情：一键十连与弹幕** — two switches in the 交流 panel, both per device (localStorage), both OFF by default, and
  both usable in EVERY mode (they are not 扩展模拟-only rules):
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
- **二.10 对局选项（怪物强化滑条）** — 需求方 2026-10-15: 「在房主设置菜单中，按照图中所示添加对应功能，并确保该功能在所有模式
  中均通用」. Under the 房主配置 switches, the same dialog carries a **对局选项 / MATCH OPTIONS** block: four sliders —
  **怪物血量 / 怪物攻击 / 怪物防御 / 怪物魔抗** — that strengthen **every enemy of the match**, each worth **+10 % per
  step up to +100 %** (`HOST_ENEMY_MAX_STEPS` 10, `HOST_ENEMY_STEP_PCT` 10). A warning line under them states the total
  (「本局敌人已获得强化（合计 N%），请谨慎调整」). The requester's screenshot is the source for the four labels, the
  +10 %/+100 % rule and that warning; the block's placement (inside 房主配置, under the switch rows) is the fork's.
  - **Every mode**, 独立模拟 included: a buff on one's own enemies shares nothing with teammates, so unlike the 共享
    options there is no solo gate (`HOST_ENEMY_SOLO_KEYS` is the whole list, and the panel does not filter it out).
  - **One place decides.** `GameData.enemyScale` folds HP / ATK into the official round table, so every consumer of it
    inherits them: ordinary spawns, 部位, bounty adds, a leader's mid-fight summons (`flags.enemyScale`, read by
    `sim/content/bosses.js summonMods`) and the client, which builds its spec from the same numbers. DEF / RES have no
    place in the round table, so `GameData.enemyBuffDefRes` → `waves.js roundMods` writes `defMul` / `resMul` (only when
    they are not 1, so an unbuffed spec is byte-identical). A leader's HP is the **shared pool**, so `enemyBuff.hp` lands
    there instead: `GameData.bossPoolHp` and `finalAssault.bossPoolHp` both multiply it (a test asserts they agree).
  - **No buff = byte-identical.** `enemyBuffMul` returns `null` when all four are 0 (the default, and what every caller
    that passes nothing gets), so `GameData.enemyBuff` is null, `enemyScale` returns the shape it always did and no spawn
    gains a key. **golden did not move.**
  - **Transport.** `room.setEnemyBuff { key, steps }` (host-only, before the match, `steps` an integer in
    `[0, HOST_ENEMY_MAX_STEPS]`; an unknown key or an out-of-range count is `BAD_MSG`), `room.state.enemyBuff` and
    `opts.enemyBuff` → `Match.enemyBuff` → `m.public.enemyBuff`. Kept across the room's matches like the difficulty, and
    a change un-readies the other humans.
  - **A slider is not a button.** The client's `setEnemyBuff` deliberately bypasses the screen's `run()` helper: a drag
    emits one input event per step, and `run()`'s `inFlight` guard would drop every step after the first while its
    `busy` state disabled all four sliders (and every switch row) for the length of each round trip — measured in a
    browser, a 1→7 drag landed on +10 %. Each step now fires its own idempotent request (last-write-wins on the server)
    and a failure still surfaces as a toast.
  `test/lobby-enemy-buff.test.js` (protocol, host-only, defaults, un-ready, solo allowed, kept across matches),
  `test/match/enemy-buff.test.js` (the four multipliers' engine behaviour: ordinary spawns, the boss branch's split —
  ATK/DEF/RES yes, HP no —, the shared pool, every mode, the summons' flag, and that no buff changes any number),
  `test/ui/host-config.test.js` (the panel rows and the markup).
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
  official game exactly. **四.1 shipped the framework and its first two switches (`noBondBan`, `untimedSp`); 四.2 adds a
  third (`randomSpVote`); 五.1 adds `extraRounds` and `targetedPick` and is the reference for how to add one.**
  - **五.1 「额外 4 回合」 (`extraRounds`)** — 「开启时：无论单人、同盟、终极模拟，回合数都由 14 回合变为 18 回合。新增的 4 回合皆为
    普通回合，即不是 Boss 回合。关闭时：恢复原版 14 回合。」 The owner chose (asked directly) that the boss **moves later**
    rather than the run continuing past it, so 「14 → 18」 means the boss round itself becomes 18 and the four inserted
    rounds are ordinary ones before it. `GameData.extraRounds` returns `MOD_EXTRA_ROUNDS` (4) or 0; `lastRound` /
    `bossRound` / `hiddenRound` add it, and `roundCfg(r)` remaps the round number: rounds before the old last round are
    unchanged, the inserted ones reuse the mode's **last ordinary round table** (its battlefield, prep time, timers —
    deliberately not a new generated table, so nothing downstream has to learn about them), and the boss / hidden rounds
    are served shifted back by the same amount. Because it is a `GameData` seam and not a data edit, it needs no
    `fork-overrides.mjs` entry and moves no golden file (the switch defaults OFF).
  - **五.1 「定向甄选」 (`targetedPick`)** — 「三个相同干员合为进阶干员时，奖励的高阶干员三选一阶段，三个干员的刷新机制改为：从当前已
    激活最高层数的盟约旗下的干员中随机。」 `GameData.highestLayerActiveBond(bonds)` picks the single **active** bond with the
    most layers (an inactive bond's stored layers do not count — the game's own rule; ties resolve by `bondIds` order so
    it is deterministic), `chessOfBond()` lists its shop-eligible operators, and `PlayerState.pushRewardOffer` restricts
    the roll to them **for `source === 'merge'` only** — a strategy's or an item's explicit-id offer is passed through
    untouched. The draw stays **bond-first, topped up** rather than bond-only: at the promotion tier a bond usually has
    fewer than three operators (炎 has exactly one at tier 2), and a reward offer must never hand back an empty slot.
    Both switches are covered by `test/fork-mod-rounds-and-pick.test.js`.
  - **What a switch is, and what it is not (2026-10-16 改口径).** A Mod 开关 started life as a **per-device
    preference** behind the 模式界面's 「Mod」按钮 (「本机偏好，开局时带到自己创建的房间」) and the creator carried it into the
    room it made (`room.create.mods`). **The owner then had the whole left column moved into 房主配置**, and that makes
    them **room options**: the lobby's Mod button and its submenu are gone (`public/js/ui/mods.js` keeps only the
    catalogue — `MOD_ROWS` / `MOD_COLS` / `modsOn` / `rememberMods`), the host flips them inside the room through the new
    `room.setMods` (one `MOD_KEYS` switch at a time, `NOT_HOST` for a guest, `ROOM_STARTED` during a match, un-readies the
    other humans like a difficulty change), and `room.state.mods` shows the same values to every seat. The room keeps
    them across its matches and hands them to the match as `opts.mods`; a joiner plays **the host's** rules, the same way
    it plays the host's mode and difficulty. The old per-device path survives for one thing only: `room.create.mods`
    still carries the creator's last-used switches in, so a host does not start from all-off every time. 房主配置 (二.7)
    is therefore no longer untouched by the switches — it is their home, holding three sections: the room options, the
    Mod 开关 block, and 对局选项 (二.10).
  - **The two columns went to different panels (2026-10-16 晚，同一位需求方).** The owner's second requirement that day
    split the block the first one had just assembled: 「将以下功能从 mod 菜单分类中移动到**房主配置菜单 → 对局选项**中：
    关闭盟约禁用 / 机变不限时间 / 额外4回合 / 定向甄选 / 解除叠层上限」 — the five **game-rule** switches (col `rule`) now sit
    under 「对局选项」 **beside the enemy-buff sliders** (screens/room.js `MatchOptionSection` draws both halves; each keeps
    its own message, `room.setMods` and `room.setEnemyBuff`, so neither needed changing) — and 「在「选择模拟协议」界面新建一个
    「mod菜单」按钮，放置在「干员调配」旁边 … 将以下功能移动到新建的「mod菜单」中：莱茵生命 / 谬因·并入莱茵 / 收藏品玩法」 — the three
    **内容包** switches (col `pack`) have their own 「Mod 菜单」 dialog, opened from a button beside 干员调配 on the 选择模拟
    协议 screen (`public/js/screens/mods.js` `ModMenuButton` / `ModMenuDialog`).
    - `MOD_ROWS` is unchanged (it is still the fork's record of what the switches ARE, and the pack rows still carry
      `PACK_AUTHORS` in their ⓘ); the split is now also **where each row is drawn**, and it is data, not a second list:
      `MOD_RULE_ROWS` / `MOD_PACK_ROWS` are the two filtered halves of the same catalogue, and each panel renders its own
      half. 房主配置's badge counts only its half, so the two buttons never both claim the same switch.
    - The 「Mod 菜单」 dialog edits the **device preference** (`modsOn` / `rememberMods`), because the lobby has no room
      yet; `room.create` carries it in exactly as before. 房主配置 still writes the **room** (`room.setMods`). Same
      `MOD_KEYS` either way, so the two surfaces can never disagree about what a switch means.
    - 
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
      from a property of 扩展模拟 into a switch that works in **all** modes, which is exactly what the requester asked
      for. The client must not re-derive the config's list behind the server's back, so `modeOffBonds(mode, mods)`
      (`public/js/ui/gameLogic/bonds.js`) and `matchInfoModel` read `m.public.mods` and grey nothing with it on.
    - **`untimedSp` 机变不限时间** — `spDraftRules.untimed` follows the switch in EVERY mode: on, the draft arms no clock
      (`spFirst` / `spTurn` are not read) and ends when every alive player has picked; off, the mode's own value decides,
      and a mode that never asked for an untimed draft — 扩展模拟 included — is on the official clock again (30 s first
      turn, 16 s after). The mode's block is the DEFAULT the switch OVERRIDES, never an OR: the owner's report of
      2026-10-13 was that ORing it into the answer left the switch dead in 六人模式 (「无论开启还是关闭，在所有模式里机变阶段
      都是不限时的，开关没有生效」). It never touches `parallel` or `randomFamilies` — those belong to 三.4 and to 四.2.
    - **`randomSpVote` 机变随机分配** — `spDraftRules.randomFamilies` likewise follows the switch: on, the vote is offered
      in every mode, with the mode's own list when it declares one and `MOD_RANDOM_SP_FAMILIES` otherwise; off, only a
      mode that declares its own list offers it, so every official mode — 扩展模拟 included — offers nothing. Same root
      cause and same fix as `untimedSp` above (「该 mod 功能在六人模式里无论开启还是关闭都不生效」).
    - **A losing 随机分配 vote no longer costs a player its card.** A vote is a request to let the system allocate, not a
      decision to take nothing: `spDone` counts only CARDS (a vote used to count as a finished turn, which skipped the
      seat and let the phase end with it holding nothing — 「导致最后一名玩家没有拿到任何道具或敌人」), so a voter keeps its
      turn and may pick normally; `finishSpDraft` also backfills any living seat that still holds nothing.
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

- **四.2 Mod 开关 机变随机分配** — the third Mod 开关 (`randomSpVote`), the owner's requirement 3: 「机变阶段随机抽取选项：改为
  全模式都有」. The vote machinery already exists — 二.4 built it for 扩展模拟 (`g.choiceRandom`; half the alive players
  resolve the draft, one card each) — so nothing about *how* the vote works changes here. What changes is **who is
  offered it**.
  - **Why it is a switch and not a default.** The owner's call of 2026-10-13: 「放进 Mod 子菜单，默认关闭（推荐）」. Turning
    it on for every mode unconditionally would be a behavioural change to the official modes, which this fork only makes
    deliberately; as a switch that defaults off, the official draft is untouched and the feature is opt-in, exactly like
    四.1's two.
  - **The seam is `GameData.spDraftRules.randomFamilies`** — the list the client's vote button (`choiceOverlay.js`
    `randomVoteAvailable` / `voteOffered`) and the server's `randomVoteOffered()` both key on. The switch fills it in for
    a mode whose own `spDraft` does not, and **never narrows one that does**: 扩展模拟 keeps its own list, and a mode
    that lists a narrower one keeps exactly that. `MOD_RANDOM_SP_FAMILIES` (`shared/constants.js`) is the switch's
    default list — 道具补给 / 机密商店 / 战术决策.
  - **悬赏 is never in the list**, whatever the switch says. That is 二.4's rule and it is structural, not cosmetic: a
    悬赏 card adds its enemies to the *picker's* own next battles, so handing it to somebody else would break the
    attribution. `randomVoteOffered()` already filters on the draft's family, so a 悬赏决策 draft offers no button.
  - **It does not touch the timer or the turn order.** `untimed` and `parallel` are 四.1's and 二.4's business; the test
    suite pins that turning this switch on leaves both exactly as they were (a real 险境模拟 draft stays timed and
    sequential with the vote offered).
  - **No golden file moves** (verified: roster 49 / bonds 46 / fields 22 / matches 22 / standins 10 / diy 140 all
    match) — the switch defaults off, so every golden scenario's draft is the official one.
  `test/fork-mod-random-sp.test.js` (the catalogue and its default, every official mode unchanged with it off and
  offering the vote with it on, 扩展模拟 keeping its own families, a malformed own list falling back to the switch's, a
  real co-op draft accepting the vote and resolving at half, and independence from the other two switches).

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

## Merging upstream

The fork tracks [sganggs/Stronghold-Protocol](https://github.com/sganggs/Stronghold-Protocol) and periodically merges a
release into `master` on a `merge/stronghold-<version>` branch. **Upstream wins every conflict in a file the fork does
not own**; a file the fork *does* own keeps the fork's rule, and the two are adapted where both changed the same line.

A merge must be a real merge commit (two parents, one of them the upstream release): `git merge <tag>`. The `v0.2.5`
merge was landed as a **squash** (one parent), so `v0.2.5` never became an ancestor and every later merge fell back to
the 0.2.4 merge base — the conflict surface of `v0.2.6` was 37 files instead of the handful the 0.2.5 sync had already
settled. The `v0.2.6` merge restores the true history (`v0.2.6` **is** an ancestor of the merge now).

### v0.2.6 (2026-10-14, 135 commits)

37 files conflicted. The rule above resolved 24 of them by taking upstream wholesale (`CHANGELOG.md`, `README.md`,
`package.json` / `package-lock.json`, `docs/DEPLOY.md`, `docs/DESIGN.md`, the whole `public/js/render/**` scene/audio
work, `server/match/player/diy.js`'s neighbours, and the upstream-only tests). The rest:

| File | Resolution |
|---|---|
| `data/choices.json` | generated — upstream's file taken, then `node tools/fork-data.mjs` re-applied `applyForkChoices` (+2346 bytes) |
| `test/golden/matches.json` | generated — upstream's file taken, then `node tools/golden.mjs --update`. **Only `matches.json` moved content** (1323 lines); `roster` / `bonds` / `fields` / `standins` / `diy` came out byte-identical to upstream v0.2.6, which is the check that the fork changed nothing outside the shop-RNG stream (§三.5 shifts it) |
| `public/i18n/*.json` (4 packs) | 3-way merge by key (upstream wins a key it changed; a key only the fork changed keeps the fork's text; deletions are honoured). The fork renamed the 二.8 key 「5阶与6阶各有**两个**自选名额」→「**五个**」, so the old key is dropped — a leftover of the rename, not a loss |
| `shared/constants.js` | `APP_VERSION` '0.2.5' → '0.2.6' (upstream); `MOD_KEYS` untouched |
| `public/js/ui/components.js` | **fork wins**: upstream has no `SwitchRow`, and the fork's Mod / 房主配置 panels share it (#23) |
| `public/js/ui/settings.js` | **both**: upstream's 弹药数量 toggle *and* the fork's 显示作弊菜单 toggle, in upstream's corrected formatting |
| `server/match/player/acquire.js` | **both** (the 0.2.5 rule again): the fork's `this.stock()` cascade **and** upstream's `diyStockEntries()` |
| `server/match/player/economy.js` | fork's import line (adds `CHEAT_KEYS`, `CHEAT_FREE_REFRESH_STEP`, `CHEAT_GOLD_FLOOR`) |
| `public/js/screens/game.js` | **fork wins**: both hunks are the cheat ball's `<CheatBall>` mount (#26) |
| `docs/PLAYING.md` | hunk 1 = the fork's 10 自选 slots (二.8); hunks 2–3 = upstream's 弹药数量 + diagnostics |
| `docs/design/client.md` | all three hunks upstream (the fork never changed those lines) |
| `test/match/watch-bonds.test.js` | **fork wins** on all three: the merged import list, the `give`/`countIn` helpers and #27's mid-battle spectate expectations |

**One fork feature was silently lost by a wrong `upstream wins` and had to be restored by hand:**
`server/match/player/diy.js` — the fork's `stock()` accessor (and the `poolOf` line that routes through it) is the
共享卡池 (房主配置) feature. Upstream has neither, so a plain take-theirs deleted them while the fork's
`PlayerState._rollChessSlot` / `_rollItemSlot` still call `this.stock()`. The symptom was spectacular and misleading:
**727 test failures**, every one of them `this.stock is not a function` thrown from the first `startRound`, reported by
tests as unrelated as `could not reach PREP R1`. `MatchInfra.poolFor` comes from the fork's own
`server/match/match/infra.js` (which merges cleanly), so only this one accessor had to come back. **Lesson for the next
merge: a file the fork touched at all is fork-owned, however small the delta — check the fork-only symbols, not just
whether upstream also touched it.**

Two failures then remained, both **upstream's own** and neither a merge defect:

- `test/match/funnel-redeploy.test.js` located Rockrock at a hard-coded `slots[3]`; the fork's §三.5 fills every slot a
  level-up opens, so the card had moved. Fixed by finding it **by id** (the same fix the 0.2.5 merge made).
- `test/lobby.test.js`'s two wall-clock tests (`rate limit … bucket refills`, `flooding … closes the socket`) fail at
  this machine's default `node --test` concurrency (16 cores → 15 files at once) and pass at CI's: **6514 pass / 0 fail**
  at `--test-concurrency=4`, and **pristine upstream v0.2.6 fails the same two** (162 failures in its own tree). The test
  file and `server/net.js` are byte-identical to upstream, so nothing here is ours to fix; upstream already tried once
  (`d4cdd567`, the flood test's burst loop).

`v0.2.5` (2026-10-12, 77 commits, 221 files) was merged this way. Seven files conflicted:
| File | Resolution |
|---|---|
| `data/choices.json` | generated — upstream's file taken wholesale, then `node tools/fork-data.mjs` re-applied the fork layer (`applyForkChoices`) |
| `test/golden/matches.json` | generated — upstream's file taken, then `node tools/golden.mjs --update` (upstream 0.2.5 moves 43+ scenarios of its own; the fork's §三.5 shifts the shop RNG stream on top) |
| `public/i18n/ko.json` | upstream's text wins for every key it changed (PR #490 added sentence-final periods); the fork's own keys are adapted in (38 kept) |
| `server/match/player/acquire.js` | **both changes kept**: the fork's `this.stock()` (per-player pool while 共享卡池 is off) **and** upstream §30.23's `diyStockEntries()` (a reward offer of the newly reached tier includes 自选 of that tier). The fork's old `diyRollEntries()` here was the *shop's* set, which is exactly what §30.23 replaced |
| `docs/PLAYING.md` | the fork's 10 自选 slots (二.8) kept; upstream's new promotion-reward sentence adapted in |
| `test/match/diy-shop.test.js` | header comment merged (fork's per-slot stock + upstream's reward-tier rule) |
| `test/match/watch-bonds.test.js` | import list merged (the fork's `give` + upstream's ordering) |

Two upstream tests then failed for reasons the merge itself created, both fixed in this commit:

- `test/match/funnel-redeploy.test.js` located Rockrock at a hard-coded `slots[3]`. The fork's §三.5 fills every slot a
  level-up opens, which draws from the shop rng and so moves the card (it lands at slot 2 now). The test now finds the
  card **by id** — same card, same route, same assertions.
- `test/scene-assets.test.js` computed `ROOT` from `new URL(import.meta.url).pathname`, which is `/H:/port-work/test/…`
  on Windows, so `path.resolve` produced `H:\H:\port-work\.gitignore` and the read threw `ENOENT`. It now uses
  `fileURLToPath` like the other 64 suites. **This was upstream's own Windows bug, not a merge artifact.**

The same merge also rescued a stranded fork change: **PR #18 (四.2 机变随机分配) had been merged into its base branch
`feat/mod-switches` instead of `master`**, so `randomSpVote` never reached `master` even though the PR read as merged.
It is cherry-picked onto this merge (`498f324e`), which is why `MOD_KEYS` here has three switches and not two. A
stacked PR whose base is another feature branch must be **re-based onto `master` (or merged into it) before its base
branch is closed** — GitHub reports the child as MERGED either way, so the gap is silent.

- **四.3 商店保底（6 人模式）** — the owner's requirement 4: 「6人模式里的商店升到5级后，第一个槽位无论怎么刷新，必定是5阶干员，
  到达6级商店后，第一个槽位无论怎么刷新，必是5阶或6阶干员」, and on when it applies: 「只要在该等级，每次刷新都保底」.
  - **What it is.** In the six-博士 room (扩展模拟), the **first 干员槽位** is filled from a guaranteed tier from level 5
    on: level 5 → a 5 阶 operator, level 6 → a 5 阶 or 6 阶 operator. Every roll at that level obeys it — a manual
    refresh, the round start's automatic refresh, and the level-up that opens the slot. Levels 1–4 carry no floor.
  - **It is a data table, not a branch.** `modes[mode_ultimate_abyss].shopFloor = { 5: { tiers: [5] }, 6: { tiers: [5, 6] } }`
    in `tools/fork-overrides.mjs` (so a `npm run build-data` keeps it, and `test/fork-data.test.js` is the drift guard),
    read by `GameData.shopFloor(level)` and applied by `PlayerState._rollChessSlot(floor)`. A mode without `shopFloor`
    has no floor at all, which is every official mode — the requirement names the SIX-博士 mode, and this way it cannot
    leak into 同盟模拟 / 独立模拟. `shopFloor()` also filters the tiers to 1…maxShopLevel and to the level itself, so a
    malformed table can never ask for an impossible tier.
  - **The tier is drawn, not fixed.** `_rollChessSlot(floor)` shuffles the listed tiers with the shop rng and draws from
    the first that has copies left, so the pick is deterministic per seed like every other shop roll and level 6 really
    does produce both 5 阶 and 6 阶 cards (the test asserts both occur). A listed tier with nothing left falls through
    to the next, and then to the ordinary draw — a guarantee must never hand back an **empty** slot.
  - **Only the first slot, and only when it is rerolled.** A frozen first slot keeps its own card, exactly as every
    other slot keeps its own; the floor applies to the positions being drawn.
  - **`server/match/audit.js` had to forward the argument.** Its `_rollChessSlot` wrapper called `orig()` with no
    arguments, so a floored draw would have silently become an ordinary one whenever verification is on. The wrapper now
    forwards `floor` and additionally fails a floored draw that landed outside the listed tiers while one of them still
    had copies.
  - **No golden file moves** (verified: roster 49 / bonds 46 / fields 22 / matches 22 / standins 10 / diy 140 all
    match) — the golden corpus is 同盟模拟 / 独立模拟 only (no 扩展模拟 scenario at all), and those modes carry no
    `shopFloor`.
  `test/fork-shop-floor.test.js` (the table and its malformed-input handling, every official mode having none, 60 rolls
  at level 5 all landing on 5 阶, 120 at level 6 on 5 阶 or 6 阶 with **both** tiers observed, the guarantee across all
  three kinds of roll, a frozen first slot keeping its card, the other slots staying unfloored, levels 1–4 unfloored, an
  official mode unfloored, and the fall-through when the guaranteed tier is empty).

## Fork change log

| Change | What it does | Where |
|---|---|---|
| 扩展模拟 room | the third room mode, six seats, fixed AC-4, `mode_ultimate_abyss` | as listed above |
| 二.1 盟约禁用（已反转） | **2026-10-13 反转**：六人模式**像同盟模拟一样禁盟约**（模式记录不再带 `bans`，回落到 ABYSS 的 3+4），「全不禁止」改由 Mod 开关 `noBondBan` 控制；难度卡的「盟约与干员全部解锁」随之删除。`modeIdFor('ultimate', …)` 仍始终解析 `mode_ultimate_abyss`，房间难度仍钳到 ABYSS | `tools/fork-overrides.mjs`, `data/config.json`, `server/match/gamedata.js` (`bans()`), `shared/constants.js` (`modeIdFor`), `server/match/Match.js`, `server/match/StubMatch.js`, `public/js/screens/lobby.js`, `test/fork-ultimate-bans.test.js`, `test/fork-data.test.js` |
| 五.0 Mod 子菜单弹窗结构 | **bug 修复**：`ModButton` 原本把 `<ModDialog/>` 渲染在自己的 `<button>` 内部，一个嵌套同时造成四个症状——按下弹窗内任意处时祖先按钮的 `:active`（`transform`）成为 `position:fixed` 的包含块，遮罩从视口塌成按钮的 ~76×36 角落盒子（卡在右上角）；按下把弹窗移出指针，pointerup 落在别处，开关点不动（功能无法启用）；弹窗内的点击冒泡到按钮的 `onClick` 重新 `setOpen(true)`（反复弹出）；「完成」同理关不掉。现在弹窗是按钮的**兄弟节点**（Fragment，与房主配置同一形状） | `public/js/ui/mods.js`, `test/ui/mod-menu.test.js`, `test/ui/mod-menu.e2e.test.js` |
| 二.2 商店升级槽位 | one 干员槽 per operator level (3→7) and a second 道具槽 at level 6 | `tools/fork-overrides.mjs` (`shopSlots`), `test/fork-ultimate-shop.test.js` |
| 二.3 敌人属性调整 | R4 on: ordinary +10 % HP; leader +20 % HP/+20 % DEF/+8 % ATK; hidden core +35 % HP/+35 % DEF/+16 % ATK — HP per boss id | `tools/fork-overrides.mjs` (`enemyAdjust`), `server/match/gamedata.js` (`enemyExtras`/`bossHpExtra`), `server/match/waves.js`, `server/match/finalAssault.js`, `test/fork-ultimate-enemy-stats.test.js` |
| 二.4 机变去时限 + 轮次顺序 + 投票 | untimed draft that KEEPS the turn order (`parallel: false` — the owner's 2026-10-12 report 「谁手快谁先抢到」) with a 随机分配 vote castable at any time (half the alive players resolves it randomly, one card each; 悬赏 never drawn and never voted on) + the AC-4 机变 schedule for the fork mode | `tools/fork-overrides.mjs` (`spDraft`, `applyForkChoices`), `data/config.json`, `server/match/Match.js` (SP_DRAFT), `server/match/gamedata.js` (`spDraftRules`), `server/match/match/spDraft.js` (`spDone`/`startSpTurn`/`voteRandomChoice`), `server/match/match/views.js`, `shared/protocol.js` (`g.choiceRandom`), `server/match/audit.js`, `public/js/ui/choiceOverlay.js`, `public/js/ui/gameLogic/draft.js`, `public/js/screens/game.js`, `test/fork-ultimate-sp-vote.test.js`, `test/fork-data.test.js` |
| 二.5 版面 | 三个模式卡是一行三个等宽的竖向选择；扩展模拟房间是六个等宽的竖向席位（同盟模拟的四座网格与独立模拟都不受影响） | `public/css/screens/lobby.css` (`.mode-cards`), `public/css/screens/room.css` (`.seats--ultimate`), `public/js/screens/room.js`, `test/client-static.test.js` |
| 二.6 表情：一键十连 + 弹幕 | one tap sends an emote 10 times (one `g.emoteBurst`, one cooldown); emotes also fall like snowflakes from a random x, fading out past the bottom edge, on every client's screen | `shared/constants.js` (`EMOTE_BURST_COUNT`/`EMOTE_BARRAGE_MS`), `shared/protocol.js` (`g.emoteBurst`), `server/match/match/intents.js` (`emoteBurst`), `public/js/ui/emotes.js` (`EmoteBarrage`, `emotePrefsStore`, the two switches), `public/css/emotes.css` (`emo-fall`), `public/js/ui/gameActions.js`, `public/js/screens/game.js`, `test/fork-emote-burst.test.js`, `test/client-static.test.js` |
| 二.7 房主配置 | 每个模式的准备房间都有一个房主配置面板（仅房主可改）：共享卡池、共享悬赏、AI 队友最后选择、多同盟模式、装备可售卖；房间跨对局保留，开局时交给对局。**装备可售卖**（默认关闭）关闭时是官方行为：装备只能销毁；开启时装备可**出售**，售价 1 块钱（`ITEM_SELL_PRICE`，一处定义，服务端付款、审计核对、客户端显示）。出售与销毁走**同一条路径**（`PlayerItems.destroy`）——同样只收备牌区/临时区的散装装备（已配发的依旧锁死，`equipped items are locked`），区别只是卖出去会进账，所以「神秘顾客」这类装备自己的 `onDestroy` 照样结算。**独立模拟也能用的开关**（`HOST_CONFIG_SOLO_KEYS`）：装备可售卖与（2026-10-17 起）在线聊天；其余四项都要有队友才有意义，服务端在单人房照样拒绝它们，面板在单人房只显示这两行 | `shared/constants.js` (`HOST_CONFIG_KEYS`/`HOST_CONFIG_DEFAULTS`/`HOST_CONFIG_SOLO_KEYS`/`ITEM_SELL_PRICE`), `shared/protocol.js` (`room.setHostConfig`), `server/lobby.js`, `server/match/Match.js` (`itemSell`), `server/match/player/economy.js` (`sell`), `server/match/match/views.js`, `server/match/audit.js`, `server/match/match/infra.js` (`poolFor`), `server/match/match/spDraft.js`, `server/match/match/phases.js`, `server/match/player/*`, `server/match/bot.js`, `server/match/invariants.js`, `public/js/screens/room.js`, `public/css/screens/room.css`, `public/js/screens/bandDraft.js`, `public/js/ui/gameLogic/draft.js`, `public/js/ui/gameLogic/placement.js`, `public/js/ui/facing.js`, `public/js/ui/detailPanel.js`, `public/js/screens/game.js`, `public/i18n/en.json`, `test/lobby-host-config.test.js`, `test/match/host-config.test.js`, `test/ui/host-config.test.js` |
| 二.8 自选编队 10 个名额 | 自选编队每阶 5 个名额（5 阶 5 + 6 阶 5 = 10，官方为每阶 2）：额外 6 个槽位由 fork 数据层生成（`chess.json` 的 `…_diyN_a`/`_b` 记录对 + `backups.json` 的 `diy.slots`），复制同阶官方槽位的 status/价格/合成数；`DIY_LIMITS.slots` 8 → 10；官方 4 槽位与所有官方模式规则不变，**golden 未移动** | `tools/fork-overrides.mjs` (`applyForkChess`/`applyForkBackups`), `tools/fork-data.mjs` (LAYER), `tools/build-data.mjs` (per-rank 循环), `shared/protocol.js` (`DIY_LIMITS`), `data/chess.json`, `data/backups.json`, `tools/golden.mjs` (`DIY_CORPUS_SLOTS`), `test/fork-data.test.js`, `test/fork-diy-slots.test.js` |
| 二.9 一键满配 | 干员调配顶栏加「一键满配」（在「全部恢复默认」旁）：一次确认把所有干员的潜能与练度设回满配（潜能 6、精英阶段2-60级）。满配本来就是默认值，所以这个按钮只是清掉被调低的条目——**不引入任何数值计算**，也不碰技能与模组。全模式通用（需求方决定） | `public/js/ui/loadoutModel.js` (`maxAllOps`/`maxAllOpsCount`), `public/js/screens/loadout.js`, `public/i18n/*.json`, `test/ui/potential-ui.test.js`, `test/ui/loadout-rows.test.js` |
| 三.1–三.3 UI 回顾 | 隐藏局内盟约与干员详细两处滚动条；⚙ / 📖 / ⛶ 从角落移到顶栏左侧（交流留在角落），窄屏换到第二行并给盟约栏让出左侧；大厅顶栏左右两组按钮同高（触摸屏 36 px）；「界面改动要兼顾电脑与手机」写成 client.md §10 的设备规则 | `public/css/screens/game-panels.css`, `public/css/screens/game.css`, `public/css/devices.css`, `public/css/components.css`, `public/js/ui/hud.js`, `public/js/screens/game.js`, `public/js/ui/fieldHost.js`, `public/js/screens/lobby.js`, `docs/design/client.md`, `test/ui/playtest5-ui.test.js`, `test/ui/issue5-fold-camera.test.js`, `test/ui/playtest5-ui.e2e.test.js`, `test/ui/devices.e2e.test.js` |
| 三.4–三.6 三个玩法 bug | 三.4 机变恢复轮次顺序（见 二.4）；三.5 升级调度中心立刻补上新栏位的干员（全模式，0.2.2 §27.52 的反转）；三.6 场上没有成员的盟约不再留在盟约栏（层数仍保留，结算记录例外） | `tools/fork-overrides.mjs` (`spDraft`), `data/config.json`, `server/match/match/spDraft.js`, `server/match/match/views.js`, `public/js/ui/choiceOverlay.js`, `server/match/player/economy.js`, `server/match/audit.js`, `server/match/bondsMeta.js` (`bondList`), `server/match/results.js`, `docs/META.md`, `docs/PLAYING.md`, `tools/golden.mjs`, `test/golden/matches.json`, `test/fork-ultimate-sp-vote.test.js`, `test/fork-data.test.js`, `test/match/feedback5-shop-levelslots.test.js`, `test/match/bonds.test.js`, `test/match/watch-bonds.test.js`, `test/match/bot-smarter.test.js`, `test/golden-diy.test.js`, `test/golden-standins.test.js` |
| 五.1 额外 4 回合 + 定向甄选 | 两个新 Mod 开关，默认关闭。`extraRounds`「额外 4 回合」：全模式 14 → 18 回合，新增 4 回合都是普通回合，Boss 回合后移到第 18 回合（插入的回合复用该模式最后一个普通回合的表）。`targetedPick`「定向甄选」：三选一晋升奖励改为从当前已激活最高层数的盟约旗下的干员中抽（bond 优先、不足则补齐，绝不交空槽；只有 `source === 'merge'` 受影响）。golden 未移动 | `shared/constants.js` (`MOD_KEYS`/`MOD_DEFAULTS`/`MOD_EXTRA_ROUNDS`), `server/match/gamedata.js` (`extraRounds`/`lastRound`/`bossRound`/`hiddenRound`/`roundCfg`, `chessBondIds`/`chessOfBond`/`highestLayerActiveBond`), `server/match/player/acquire.js` (`pushRewardOffer`), `public/js/ui/mods.js`, `public/i18n/*.json`, `test/fork-mod-rounds-and-pick.test.js` |
| 四.1b Mod 开关分家 + 在线聊天 | 2026-10-16 晚（需求方）：Mod 开关的左列**拆到两个面板** — 五个规则开关（`noBondBan`/`untimedSp`/`randomSpVote`/`extraRounds`/`targetedPick`/`uncapLayers`… 其中 `randomSpVote` 见四.2）进**房主配置 → 对局选项**，与「怪物血量/攻击/防御/魔抗」四个滑条同段（screens/room.js `MatchOptionSection`；两半各用各的消息，`room.setMods` / `room.setEnemyBuff`）；三个内容包开关进 选择模拟协议 界面**新建的「Mod 菜单」**对话框（`public/js/screens/mods.js`，按钮置于 干员调配 旁）。catalogue 仍是 `MOD_ROWS`，新增 `MOD_RULE_ROWS` / `MOD_PACK_ROWS` 两个筛选结果；作者的 ⓘ 跟着内容包走进了新对话框（房主配置不再引用 `PACK_AUTHORS`）。同轮新增**在线聊天**：`HOST_CONFIG_KEYS` 加 `onlineChat`（默认关；2026-10-17 起**在** `HOST_CONFIG_SOLO_KEYS`——此前被排除导致单人房既看不到也设不了这个开关），局内浮动聊天窗（Acrylic 毛玻璃、可收起/展开、显示发言人名字与头像、手机端自适应），开启时**「交流」按钮收入窗内**；新增 `g.chat {text}` / `m.chat {playerId, text, seq}`（`CHAT_MAX_LEN` 120、`CHAT_COOLDOWN_MS` 1 s、房间没开则 `WRONG_PHASE`——由服务器决定聊天是否存在）。「交流」按钮同时**放大 15%**（.7 → .805，两套渲染路径同步）。golden 与 `data/` 未动 | `shared/constants.js` (`CHAT_MAX_LEN`/`CHAT_COOLDOWN_MS`/`CHAT_KEEP`, `HOST_CONFIG_KEYS`/`HOST_CONFIG_DEFAULTS`), `shared/protocol.js` (`g.chat`/`m.chat`), `server/lobby.js`, `server/match/Match.js` (`onlineChat`/`chatSeq`), `server/match/match/intents.js` (`chat()`), `server/match/match/views.js`, `server/match/StubMatch.js`, `server/match/PlayerState.js`, `public/js/ui/chat.js` (新), `public/js/screens/mods.js` (新), `public/js/ui/mods.js`, `public/js/screens/room.js`, `public/js/screens/lobby.js`, `public/js/screens/game.js`, `public/js/ui/gameActions.js`, `public/js/ui/gameComponents.js`, `public/js/ui/fieldHost.js`, `public/js/main.js`, `public/js/store.js`, `public/css/chat.css` (新), `public/css/emotes.css`, `public/css/devices.css`, `public/css/screens/lobby.css`, `public/index.html`, `public/i18n/*.json`, `docs/design/network.md`, `docs/PLAYING.md`, `test/lobby-chat.test.js` (新), `test/ui/host-config.test.js`, `test/pack-switches.test.js` |
| 四.1 Mod 开关 | 模式界面顶栏加「Mod」按钮与子菜单（与干员调配平行，只在该页出现）：本机偏好，随创建的房间生效。`noBondBan` 关闭盟约禁用——全模式都不再有随机禁用与固有禁用盟约（把二.1 从扩展模拟的属性推广成开关）；`untimedSp` 机变不限时间——全模式机变不再计时，关掉则恢复各模式自己的时限（扩展模拟不例外，见 2026-10-13 修复）。开关默认关闭，golden 未移动 | `shared/constants.js` (`MOD_KEYS`/`MOD_DEFAULTS`/`normalizeMods`), `shared/protocol.js` (`room.create.mods`), `server/match/gamedata.js` (`mods`, `bans()`, `modeInactiveBonds`, `spDraftRules`), `server/match/Match.js`, `server/match/match/views.js`, `server/lobby.js`, `public/js/ui/mods.js`, `public/js/screens/lobby.js`, `public/js/ui/gameLogic/bonds.js`, `public/js/ui/matchInfo.js`, `public/js/screens/game.js`, `public/js/screens/bandDraft.js`, `public/css/screens/lobby.css`, `public/i18n/*.json`, `test/fork-mod-switches.test.js`, `test/lobby-mods.test.js`, `test/lobby-ultimate.test.js` |
| 四.2 机变随机分配 | Mod 子菜单第三个开关 `randomSpVote`（默认关）：全模式的机变都可以投票「随机分配」，过半即随机发放（悬赏决策除外，二.4 的规则）。投票机制本身就是二.4 的，这里只决定「谁被提供」——`spDraftRules.randomFamilies` 由开关决定：开着则模式自己的名单优先、没有就用开关的默认名单，关掉则只有自己声明了名单的模式才提供（扩展模拟不再硬编码，见 2026-10-13 修复）。落选的投票者照样拿卡。golden 未移动 | `shared/constants.js` (`randomSpVote`, `MOD_RANDOM_SP_FAMILIES`), `server/match/gamedata.js` (`spDraftRules`), `server/match/match/spDraft.js` (`spDone`/`finishSpDraft`), `public/js/ui/mods.js` (`MOD_ROWS`), `public/js/ui/choiceOverlay.js` (comment), `public/i18n/*.json`, `test/fork-mod-random-sp.test.js`, `test/fork-ultimate-sp-vote.test.js` |
| 四.1c 菜单四修 | 2026-10-17（需求方报 4 个问题，全是四.1b 交付的回归）：①**对局选项的开关未对齐** —— `.mods--hostcfg` 里只剩规则那半列，而它继承的 `.mods__rows` 是**两列** grid，单列被挤在左半、开关停在对话框中间；改为单列满宽，与上方 `.hostcfg__rows` 的开关落在同一 x（`public/css/screens/room.css`）。②**Mod 菜单按「完成」关不掉** —— 对话框被渲染在 `<Button>` 的 children 里，而 `<button>` 不能嵌 `<button>`（对话框自己的「完成」和每个开关都是），浏览器强制闭合外层按钮 ⇒ 对话框被重新挂载、关闭后反复弹出；改为**兄弟节点**（`<${Fragment}>` 包住按钮与对话框，同 `ui/resumeMatch.js` 的 `ResumeMatchButton`）。③**在线聊天在独立模拟里不可用** —— 它当初被排除在 `HOST_CONFIG_SOLO_KEYS` 外，单人房**既不显示这一行、服务端也拒绝写入**；现已在册，单人房照常显示并可开。④**一打开面板就显示第一项解释** —— `<Modal>` 打开时 `focusFirst()` 取第一个可 Tab 元素，而每个设置式对话框的第一个就是 `<SwitchRow>` 的 ⓘ，**程序化聚焦**与键盘聚焦无法区分 ⇒ `Tooltip` 立刻弹出该行说明；`focusFirst` 现在跳过 `.tt-anchor`（ⓘ 仍是 tab 可达，只是**不做初始焦点**）。golden 与 `data/` 未动 | `public/css/screens/room.css`, `public/js/screens/mods.js`, `public/js/screens/room.js`, `public/js/ui/components.js`, `shared/constants.js` (`HOST_CONFIG_SOLO_KEYS`), `docs/design/network.md`, `docs/PLAYING.md`, `test/pack-switches.test.js`, `test/ui/host-config.test.js`, `test/ui/switch-row.test.js` |

| 四.1d 局内 HUD 与聊天六改 | 2026-10-17（需求方）：①**作战统计按钮搬进顶栏** —— 它原在左下角 `.gm__corner`，现在和 ⚙ / 📖 / ⛶ 同排（`.gm__tools` 里的 `.gm__gear gm__metrics`，同一个方形控件）。**面板跟着按钮走**：`.combat-metrics` 从「向上一跳」（`bottom: 100%`，以角落为锚）改为**挂在顶栏那一行下面**（`top: calc(100% + …)`，`.gtop` 是最近的定位祖先），`ui/combatMetricsLayout.js` 相应从「角落里还剩多少空间」改为「那一行底边到视口底部还剩多少」，经 `--combat-available-height` 喂给 CSS 的 `max-height`（CSS 里留了 `--combat-anchor-bottom` 回退，首帧也有值）。②**盟约条居中** —— `.gm__bonds` 由 `left: 1.56rem` 左对齐改为 `left: 0; right: 0; justify-content: center`。**用 flex 不用 `transform`**：`transform` 会让这个盒子成为 `position: fixed` 提示层的包含块（Mod 对话框踩过的同一类 bug）。随之删掉 `@media (max-aspect-ratio: 16/10)` 的 `right: 4.6rem`——它原本只在左对齐时有意义，居中后会把中心拽偏。③**聊天窗内表情菜单显示错误** —— `.chat__body .ewheel__panel` 曾把面板翻成向下展开（`bottom: auto; top: 100%`），而 `.chat` 又是 `overflow: hidden`，于是只有第一排表情格的顶部一条露出来。现改为像角落里一样**向上展开**（只保留 `left: 0`），且窗口**不再裁切**（`overflow: visible`；日志仍由 `.chat__log` 自己滚）。④**表情面板改 Acrylic** —— `.ewheel__panel::before/::after` 由不透明的 `emoji_bkg`/`rgba(19,19,19,.92)` 换成聊天窗同款毛玻璃配方（`rgba(14,19,17,.62)` + `backdrop-filter: blur(.12rem) saturate(1.6)`，`@supports` 回退到 `.94`）；面板不再绘制 `--ewheel-bg` 那张 sprite（**格子**仍绘制自己的 `--ewheel-cell`，表情本身一个像素都没动）。⑤**聊天窗收起时「交流」仍在外面** —— 从前是 `chatOn ? null : <EmoteWheel/>`，窗口一收（`.is-folded`）轮盘就**没有任何地方渲染**。现在左下角那份以折叠状态为条件（`chatOn && !chatOpen`），窗口那份只在展开时传入，两者**互斥**、共用一个 `emoteOpen`，所以折叠再展开不会丢面板状态。⑥**新增聊天弹幕** —— 设置里多一行「聊天弹幕」（`chatBarrage`，默认关闭，同「作战统计」的形态）；打开后房间里的发言以弹幕横穿屏幕，**带发送者名字**（名字走 `speaker()`，与聊天窗同一个来源，永远不会把一句话记到别人头上）。泳道与时长**由该行的 `seq` 决定**（`barrageTrack`，不用 `Math.random`），所以同一句话永远走同一行、重渲染不会让正在飞的弹幕跳位；飞行结束即从图层移除（CSS 的 `forwards` 会把元素永久停在终点）。golden 与 `data/` 未动 | `public/js/screens/game.js`, `public/js/ui/combatMetrics.js`, `public/js/ui/combatMetricsLayout.js`, `public/js/ui/chat.js` (`ChatBarrage`/`barrageTrack`), `public/js/ui/settings.js`, `public/js/ui/gameLogic/settings.js` (`chatBarrage`), `shared/constants.js` (`CHAT_BARRAGE_*`), `public/css/screens/game.css`, `public/css/chat.css`, `public/css/emotes.css`, `public/i18n/*.json`, `docs/design/client.md`, `docs/PLAYING.md`, `test/ui/hud-chat-tweaks.test.js` (新), `test/ui/playtest5-ui.test.js`, `test/ui/gameLogic.test.js` |
| 四.1e UI 八改 | 2026-10-17（需求方，八项）：①/②**六人模式改名「扩展模拟」** —— `tools/fork-overrides.mjs` 的 `mode_ultimate_abyss.name` 由「终极模拟」改为「扩展模拟」，经 `tools/fork-data.mjs` 落到 `data/config.json`（不用手改 data）；模式卡同步 `MODE_CARDS.ultimate`（`name`/`en: EXTENDED SIMULATION`，2026-10-17 需求方）。**官方 ABYSS 难度仍叫「终极模拟」**（`DIFFICULTY_NAMES.ABYSS`），只有这个房间自己的名字变了。房间顶栏整条标题直接显示白色「扩展模拟」，**去掉原来那条红色难度标签**（需求方 2026-10-17），micro label 相应改为 `EXTENDED LOBBY`；难度选择区仍显示 AC-4 标签，文案改为「扩展模拟固定难度」。③**「对局选项」整块上移**到「房间配置」对话框最上方（标题＋说明＋规则开关＋滑条），开关行顺序不动；`.hostcfg > .ebuff:first-child` 去掉顶部那条分隔线（它原本用于和上方开关行分隔，现在上方没有东西了）。④**作弊菜单与详情卡改 Acrylic** —— 单独一个 PR，配方与文件清单见 四.1f（本 PR 不含它）。⑤**「房主配置」改名「房间配置」**（`HOST_CONFIG_KEYS` 与服务器字段名一个没动，只改界面文案与 i18n），并且 **`在线聊天` 改为默认开启** —— `HOST_CONFIG_DEFAULTS.onlineChat: false → true`，这是唯一一个不等于官方行为的默认值；房间配置面板 `HOST_CONFIG_ROWS.onlineChat.on` 同步为 `true`，关掉即回到官方 HUD（窗口、`g.chat`、收进窗内的「交流」一起消失）。⑥**「交流」与折叠的聊天窗上下并列** —— 两者原本都锚在左下角 `.24rem`，像素级重叠，轮盘盖住了窗口的「展开」标题栏；现在 `.gm__corner` 在折叠态带 `is-chat-folded`，`bottom` 抬到窗口标题栏（`.34rem`／手机 34 px）之上，手机断点同步。⑦**聊天弹幕并轨到表情菜单的「弹幕」开关** —— 上一轮它在设置里另立一行（`chatBarrage`），本轮删除该设置项，`screens/game.js` 直接读 `emotePrefsStore`（`const chatBarrage = barrage`），因此**一个开关同时管表情飘落与聊天弹幕**；`ui/emotes.js` 的 `DEFAULT_SETTINGS.chatBarrage` 与 `sanitizeSettings` 一并移除，tooltip 文案补上聊天那半。⑧**盟约居中的真正根因** —— 上一轮把 `.gm__bonds` 的 `left/right` 改成 0 并 `justify-content: center`，但**被居中的是 [折叠箭头 + 盟约条] 这一组**，44 px 的箭头占了半个身位，条的中心因此偏右 22 px。新增 `.gm__bond-box`（`position: relative`）作为唯一 flex 子项，箭头改 `position: absolute; right: 100%` 挂在盒子左侧之外，于是居中的就是条本身；箭头脱离文档流后，折叠（盒子宽度归零）也不会让它横向跳动，44 × 44 命中区不变。golden 与 `test/golden/*` 未动 | `tools/fork-overrides.mjs`, `data/config.json`, `public/js/screens/lobby.js`, `public/js/screens/room.js`, `public/js/screens/game.js`, `public/js/ui/emotes.js`, `public/js/ui/chat.js`, `public/js/ui/settings.js`, `public/js/ui/gameLogic/settings.js`, `shared/constants.js` (`HOST_CONFIG_DEFAULTS`), `public/css/screens/game.css`, `public/css/screens/room.css`, `public/css/chat.css`, `public/i18n/*.json`, `docs/FORK.md`, `docs/PLAYING.md`, `docs/design/client.md`, `test/ui/hud-chat-tweaks.test.js`, `test/ui/host-config.test.js`, `test/lobby-chat.test.js`, `test/fork-data.test.js`, `test/client-static.test.js`, `test/ui/gameLogic.test.js` |
| 四.1f 面板 Acrylic | 2026-10-17（需求方，图四）：把**作弊菜单**与**干员／道具／地形装置／敌方入口／保护目标**的详情卡背景从近乎不透明的板子换成**毛玻璃**（Acrylic）—— 配方与 在线聊天 窗口、表情面板同一份（`rgba(…, .62)` + `backdrop-filter: blur(.12rem) saturate(1.6)`，`@supports` 就地回退到 `rgba(…, .94)`）。**六类详情共用 `.dpanel` 一个外壳**（`ui/detailPanel.js` 按 `detail.type` 换内容、不换容器），所以一处配方即覆盖需求方列的全部六类；作弊菜单是它自己的 `.cheatball__panel`，保留原薄荷边框（那是它的身份）。边框、阴影、动画与 `panelSlots` 的定位一分未动 —— 只有板子的材质变了。backdrop-filter 会让元素成为 `position: fixed` 后代的包含块，这里安全：所有 tooltip 都走应用级 `<TooltipLayer/>`，不在卡内。golden 未移动 | `public/css/screens/game-panels.css`, `test/ui/acrylic-panels.test.js` (新) |
| 四.3 商店保底 | 6 人模式（扩展模拟）商店 5 级后第一个槽位必出 5 阶干员，6 级后必出 5 阶或 6 阶——**每次刷新都保底**（手动刷新、回合开始、升级开槽）。做成数据表 `modes[mode_ultimate_abyss].shopFloor`，官方模式没有这张表所以不受影响；保底阶无货时回落到下一阶再到普通抽取，绝不交出空槽位。golden 未移动（语料里没有扩展模拟） | `tools/fork-overrides.mjs` (`shopFloor`), `data/config.json`, `server/match/gamedata.js` (`shopFloor()`), `server/match/player/economy.js` (`_rollChessSlot(floor)`/`rollShop`/`_openLevelSlots`), `server/match/audit.js` (转发 `floor`), `test/fork-shop-floor.test.js`, `test/fork-data.test.js` |
| 六.1 解除叠层上限 | 第六个 Mod 开关 `uncapLayers`「解除叠层上限」（默认关闭）。关闭时是官方行为：每名干员的盟约叠层上限 999（`BOND_LAYER_CAP`，对应客户端的 `MAX_GARRISON_STACK`），到顶后继续获得的层数加不上去。开启时解除上限，可以叠到 999 层以上。**只解除上限**：谁可以叠（`requireActive`）、每场战斗的叠加上限（`60 + 4·round` 与干员特质允许量）、结算校验、层数里程碑全部不变。实现上把上限收敛成 `layerCapFor(mods)` 一处定义，所有写层入口（备战 `player/economy.js addLayers`、结算 `match/settle.js`、战斗内 `sim/battle/economy.js addLayers`、联防 `unite.js helperStats`、界面 `bondsMeta.bondsWithGains`）都改读 `gd.layerCap`；`layerGainRoom(before, n, cap?)` 多了可选的第三个参数，**不传时与改动前逐字节相同**，所以所有既有调用者与 golden 都不动。战斗内的开关以**布尔** `flags.uncapLayers` 传递（不是 `Infinity`）：客户端也从 JSON BattleSpec 构造同一个 Battle，`Infinity` 过不了 JSON。golden 未移动 | `shared/constants.js` (`uncapLayers`, `layerCapFor`, `layerGainRoom(before, n, cap?)`), `server/match/gamedata.js` (`layerCap`/`uncapLayers`), `server/match/player/economy.js`, `server/match/match/settle.js`, `server/match/bondsMeta.js` (`bondsWithGains(bonds, gains, cap?)`), `server/match/player/round.js`, `server/match/unite.js`, `server/match/invariants.js`, `server/sim/battle/economy.js`, `server/match/match/{combat,intents,bossRounds,unitePhase}.js`, `server/match/bot.js`, `public/js/ui/mods.js`, `public/i18n/*.json`, `docs/PLAYING.md`, `test/mod-layer-cap.test.js` |
| 六.2 额外内容开关（第二列） | Mod 子菜单拆成**两列**：左列是规则开关（六个），右列「额外内容」是**三个移植内容包**的开关，每个默认关闭、每个的 ⓘ 里写着原作者（`PACK_AUTHORS`）。关闭 = **完全不加载**：`data/*.json` 里属于该包的记录带自己的 `packId`，`GameData` 构造时用 `filterRawData` **一次性剥掉**，之后商店池、机变、盟约名单、详情卡、客户端校验**每一个访问器**只看到这一局真的有的内容；一个包也可以给**别人的**记录贡献内容（`packBonds`：谬因原本是官方干员，「谬因·并入莱茵」让她成为莱茵生命成员），关掉时同样被收回。`packId` 允许是**数组**（`rhineShip` 由 `packRhine` 与 `packAphris` 共同贡献，**任一开**即算开），空数组 = 不属于任何包 = 永远可用。全关时 `filterRawData` 返回**同一个对象**（零分配），所以既有测试 / golden / 未开任何开关的房间走的是改动前的代码路径。客户端由 `data.setPacks(mods)` 走同一套规则（`public/js/data.js`，`public/js/main.js` 从 `m.public.mods` / `room.state.mods` 驱动），两端一致。golden 未移动 | `shared/constants.js` (`PACK_KEYS`/`PACK_AUTHORS`/`packEnabled`), `shared/packData.js` (`filterFile`/`filterRawData`/`effectiveBonds`/`withPackBonds`/`recordAvailable`/`PACK_ID_FIELD`/`PACK_BONDS_FIELD`), `server/match/gamedata.js` (`this.raw = filterRawData(…)`, `chessBondIds`), `public/js/data.js` (`setPacks`), `public/js/main.js`, `public/js/ui/mods.js` (`MOD_ROWS[].col`/`MOD_COLS`/`tipOf`), `public/css/screens/lobby.css` (`.mods__rows` 两列 grid，≤640px 单列), `public/i18n/*.json`, `docs/PLAYING.md`, `test/pack-switches.test.js` |
| 六.3 莱茵生命盟约 + 谬因·并入莱茵 | 第一个移植内容包：`rhineShip`「莱茵生命」盟约（阈值 3 / 6 / 9 名不同成员，`bondType` SEASON）。**盟约本身**（不含科研装置）：达到 6 名时，己方**已部署**的莱茵**输出**干员获得科研装置基础攻击力的 **15%**（精锐 **25%**）作为**额外攻击力**——用引擎真实的 `atkFlat`（**最终加算**，`units.js` 的 `(base + atkFlat)·(1+atkPct) + atkFinal`），所以它是加在百分比之后的固定值，与盟约原文「作为额外攻击力」一致。排除集照源仓库：**伊芙利特**、**治疗干员**、以及**塞雷娅**（源扩展给她的 六.4 治疗特质取代了共享）。数值与源扩展一致：装置基础攻击 300、每层科研 +4（`base_atk + atk_per_stack·L`），黑板书走**和其他所有盟约相同的** `env_gbuff_new`（`buffs:[{key:'env_gbuff_new',…}]`，`rhineBb`/`bondBb` 都读它）。`[ASSUMED]`：装置本身在 **六.4**，所以在装置缺席时直接用盟约自己的公式读装置基础攻击，否则这条盟约的标志性效果会恒为 0；六.4 落地后改为读已部署装置。**谬因·并入莱茵**没有源码可抄，机制就是把官方干员谬因（`char_4229_aphris`，自选）加进盟约：与其让 `packAphris` 复制一份盟约记录，不如让 `rhineShip` 的 `packId` 是**数组** `['packRhine','packAphris']`——两个开关**任一开**都能带来盟约（只有盟约没成员、或只有成员没盟约都无意义），谬因的成员身份写在 `data/backups.json` 的 `packBonds:{packAphris:['rhineShip']}` 上，关掉时由 `shared/packData.js effectiveBonds` 收回。committed 数据是**全开**的真相、开关负责**移除**（strip 语义），所以 `test/data.test.js` 仍能校验一个自洽的数据集（每个成员都列出该盟约、每个盟约都有 effect）。新增图标 `public/art/rhine/bond.svg`（作者自绘单色 SVG，见其 README 的许可边界），`data/assets.json` 由 `tools/fork-data.mjs` 的 `assets` LAYER 写入（该文件不归 `build-data.mjs` 管）。盟约在装置缺席时依然**完整可用**：能激活、能叠层、有自己的图标与描述。golden 未移动 | `tools/fork-overrides.mjs` (`FORK_RHINE*`, `applyForkBonds`/`applyForkEffects`/`applyForkPackMembers`/`applyForkPackAphris`/`applyForkAssets`), `tools/fork-data.mjs` (三条新 LAYER), `data/bonds.json`/`data/effects.json`/`data/chess.json`/`data/backups.json`/`data/assets.json`, `server/sim/content/bonds/addon/rhine.js`, `server/sim/content/bonds/addon.js`, `public/art/rhine/bond.svg`, `docs/PLAYING.md`, `test/pack-rhine.test.js`, `test/fork-data.test.js` (六.3 漂移守卫), `test/data.test.js` (23 → 24 盟约) |
| 六.C 新干员包（结城理 + 丰川祥子） | 第二个移植内容包 `packExtra6`（作者 remember-4），两名**联动**干员：**结城理**（`char_4217_makoto`，5 阶 傀儡师，塔纳托斯 / 俄耳甫斯 / 墨提斯三副人格）与**丰川祥子**（`char_4182_oblvns`，6 阶 领主，音符弹幕 + Fever 机制）。**两人都不是官方棋手**——没有任何赛季的黑板上有他们的商店行——所以数据层**整条合成**（`tools/fork-extra6.mjs` 的 `applyForkExtra6Act` 往 `charShopChessDatas` / `charChessDataDict` / `chessNormalIdLookupDict` / `garrisonDataDict` 写入自己的一行），下游的 `buildChess` / `buildBackups` / `buildGarrisons` / `buildBonds` 随后把他们当**原生记录**处理：棋手记录 `chess_char_5_makoto_a/_b`、`chess_char_6_oblvns_a/_b` 都是 `chessType: 'PRESET'`（特许——`backup.charId` 就是自己，所以既不是需要别的干员的补位，也不进自选池）。**格位**：5 阶结城理的精英模组等级读该阶官方黄金行（1），6 阶丰川祥子读作 3，与官方 PRESET 精英一致。**开关语义**（六.2 的三条通道，这条包全都用到了）：① 四条棋手记录带 `packId: 'packExtra6'`（`applyForkPackMembers`）；② 他们加入的**官方**盟约（`emptyShip` / `lateranoShip` / `indomShip`）带 `packMembers: { packExtra6: [...] }`——`packId` 只管记录自己的存亡，**被指向的成员名单**要由 `shared/packData.js withPackMembers` 单独收回，否则棋手记录没了、盟约名单里还留一行幽灵（客户端 `public/js/ui/gameLogic/bonds.js` 按 `visibleMembers` 画行）；③ 特质记录 `garrison_makoto_a/_b` 由 `applyForkGarrisons` 按 `owners` 认领打上 `packId`。两支 kit `server/sim/content/kits/ops/chess_char_5_makoto-makoto.js`（引擎 `dollkeeper` 的 `<替身>` 人格机：`dollSwap` 进出、T1 置换人格的定身、T2 总攻击真实伤害、S3 塔纳托斯↔俄耳甫斯换人）与 `chess_char_6_oblvns-oblvns.js`（`noAttack` 领主，音符作为弹丸、每玩家 Fever 计数器、三技能音色）都注册进 `kits/index.js`；客户端 `public/js/render/units.js` 的 `FORMS` 补了 `char_4217_makoto` 的五套立绘（`body` / `makoto_s1` / `makoto_s2` / `makoto_s3a` / `makoto_s3b`）。`tools/fetch-assets.mjs` 的 `dataExtras` 从 `chess.json` 反查这两名干员的立绘与技能图标（`backups.units` 里没有他们），`data/assets.json` 因此收录两张卡的头像 / 半身像 / 战斗 Spine。**版权**：默认关闭的开关可以包含联动干员——这是需求方 2026-10-14 的决定，覆盖了 2026-10-05 「联动干员不进数据」的旧口径；旧口径对**自选池**仍然成立（`test/diy.test.js` 的 `COLLAB` 名单不变），而这两个人现在是棋手，所以自动离开了那份「池外 6★」名单。golden 未移动（语料按 `packId` 过滤） | `tools/fork-extra6.mjs` (新增：`FORK_EXTRA6_*`, `applyForkExtra6Act`), `tools/build-data.mjs` (`loadContext` 注入 + `validateAll` 112 → 114), `tools/fork-overrides.mjs` (`applyForkPackMembers`/`applyForkBonds`/`applyForkGarrisons`), `tools/fetch-assets.mjs` (`dataExtras`), `tools/golden.mjs` (`CHESS` 按 `filterRecords` 过滤), `shared/packData.js` (`withPackMembers`/`PACK_MEMBERS_FIELD`), `server/sim/content/kits/index.js`, `server/sim/content/kits/ops/chess_char_5_makoto-makoto.js` (新增), `server/sim/content/kits/ops/chess_char_6_oblvns-oblvns.js` (新增), `public/js/render/units.js` (`FORMS`), `public/js/ui/mods.js`, `public/i18n/*.json`, `data/chess.json`/`data/bonds.json`/`data/garrisons.json`/`data/backups.json`/`data/assets.json`, `test/pack-extra6.test.js` (新增), `test/data.test.js`, `test/backups.test.js`, `test/ui/loadout.test.js` |
| 六.D 自选干员包（结案：无内容可移植） | 源内容包 **`自选干员`（作者 Lunac1a）没有可移植的差量**，本条**结案、不做**。源包的说明是「望、赤刃明霄陈、丰川祥子、维什戴尔仅三技能；凯尔希·思衡托仅二技能。其他技能暂停验收」，而本 fork 的这四名干员**已经完整**且比源包更全：`op-wang.js`（426 行，含弹药返还与溢出自动部署）、`op-chen3.js`（329 行，S2 突进用 `moveRedeploy`）、`op-kalts2.js`（362 行，锚点链接 + 3.5 倍速飞行 + 待投放再部署）、`op-wisdel.js`（314 行）。源包唯一独有的是**战斗内手动输入通道**（`customActions.js` / `customInputs.js`），那是本 fork 的引擎设计背离（AGENTS.md 要求维护者拍板），需求方 2026-10-14 决定**不引入**。丰川祥子已随 六.C 落地。复核证据：`node --test test/content/op_wang.test.js` 20/20、`test/content/op_kalts2.test.js` 10/10 全过；棋手与锚点的官方「休整阶段放置」在本 fork 由 `placeableTokens`（`server/match/gamedata.js:786`、`player/diy.js:114`）+ `_gate()`（`player/prep.js:12`，`alive` + `PHASE.PREP` + `!ready`）实现并已测（30/30）。golden 未移动 | 无（不改代码） |
| 六.E 收藏品玩法（本局收藏品） | 第四个移植内容包 `packRelic`（作者 **UNDFFIO**，「沉沦者的黑流树海／拟造物质编目」），默认关闭。**关闭 = 逐字节原版**：`Match` 构造时 `this.relicsOn = packEnabled(this.mods,'packRelic')`，所有可观测行为（回合开始抽藏品、经济增项、结算扣血/护盾/复活/三选一、`m.public`/`m.private`/`m.result` 的新字段、`g.relic`/`g.relicRevive` 两个 intent、断线自动领取、SETTLE 截止时间、审计不变量）都收在这一个布尔后面；关掉时不发 offer、不占用任何随机流、结算路径与改动前一致。**只做加法不改写**：46 件藏品定义在 `shared/relics.js`（五档稀有度，供服务端 / 浏览器界面 / 战斗模拟共用），引擎侧只加了 `units.js` 的防⇄法抗兑换（`defToRes`/`resToDef`/`defResClear` 三个 mods 键）与 `buffs.js` 的白名单。**一件未移植**：源包第 47 件「鸭梨手机」（No.157，全队累计难度降低 2 级）需要源扩展的「超限模拟」累计难度等级（`shared/difficulty.js`），本 fork 的难度是 `FUNNY/NORMAL/HARD/ABYSS` 四个固定值、没有等级可降，故连图标文案一并省去。其余 46 件的服务端接线分散在 `relics.js`（结算/护盾/复活/经济）、`MatchRelics`（三选一与「时光之末」救队友）、`bossRounds.js`（共享生命池的护盾分摊与血池耗尽自动复活）、`audit.js`（资金与复活不变量）；客户端是 `relicPanel.js`（图标栏 + 三选一弹窗 + 图鉴列表）、`relicJournal.js`（本机收藏记录）、`numberMask.js`（木棍 No.159 的界面数字遮蔽，含 Pixi 文本与七段计数器两层）。**美术**：41 张官方图标由 `tools/assets/relics.mjs` 的 `RELIC_ICON_FILES` 映射到 PRTS 编目图片，5 张原创 PNG 原稿随源码存在 `tools/assets/custom-relics/`（`prepareCustomRelicIcons` 在离线/强制/清理模式下都从原稿恢复运行副本），`data/assets.json` 的 `relics` 映射共 46 项；`node tools/fetch-relic-icons.mjs` 可单独补齐。**i18n**：需求方 2026-10-15 决定**本项目今后只适配简体中文、不再补多语言**，故 `public/i18n/*.json` 一字未动（新 UI 文案以中文 msgid 直接显示；`node tools/i18n.mjs check` 的缺口只来自本 PR 新增文案，CI 不含该步骤）。规则、掉落概率、五档权重与 46 件清单见 `docs/COLLECTIBLES.md`。golden 未移动 | `shared/relics.js` (新增), `server/sim/content/relics.js` (新增), `server/sim/units.js` (防⇄法抗), `server/sim/buffs.js`, `server/sim/content/index.js` (`relics` 域), `server/match/relics.js` (新增), `server/match/match/relics.js` (新增 `MatchRelics`), `server/match/relicWaves.js` (新增「解压玩具」), `server/match/player/relics.js` (新增), `server/match/Match.js` (`relicsOn`/`_relicContinue`), `server/match/PlayerState.js`, `server/match/player/round.js`, `server/match/player/views.js`, `server/match/match/{views,settle,combat,bossRounds,intents,platform}.js`, `server/match/results.js`, `server/match/audit.js`, `shared/protocol.js` (`g.relic`/`g.relicRevive`), `public/js/ui/relicPanel.js` (新增), `public/js/ui/relicJournal.js` (新增), `public/js/ui/numberMask.js` (新增), `public/js/ui/relic-digits.ttf` (新增), `public/js/ui/{assetUrls,components,gameActions,guide}.js`, `public/js/ui/gameLogic/phases.js`, `public/js/screens/{game,result}.js`, `public/js/{store,render/app}.js`, `public/css/screens/{game-panels,guide,result}.css`, `tools/assets/relics.mjs` (新增), `tools/assets/plan.mjs`, `tools/fetch-relic-icons.mjs` (新增), `tools/fetch-assets.mjs`, `tools/package.mjs`, `tools/assets/custom-relics/relic_15{4,5,6,8,9}.png` (新增), `data/assets.json`, `docs/COLLECTIBLES.md` (新增), `docs/PLAYING.md`, `test/content/relics.test.js` (新增) |
| 六.F 莱茵生命全量移植（科研装置 + 扩展干员） | 第五个移植内容包，也是 **六.3 的正式落地**——源扩展把「莱茵生命」整条链路做在 `content/rhine.js`（战斗侧）与 `content/rhineMeta.js`（备战侧），本条把这两块**全量**搬进本 fork，默认关闭（`packRhine`，`packEnabled(mods,'packRhine')`）。**关闭 = 逐字节原版**：`test/data.test.js` 的 strip 往返（全开数据经 `filterRawData(undefined, …)` 收回后与 HEAD 的 `data/*.json` 逐字段相等）已复核，`test/match`+`test/sim`+`test/ui` 的可见干员数在全关时仍是 **114**、全开 **120**。**数据层**：12 条棋手记录 `chess_rhine_{mayer,wuhoo,eunectes,ifrit,astgenne,dorothy}_{a,b}`（`identifier` **10005–10016**，`RHINE_IDENTIFIER = 10005 + index*2 + (gold?1:0)`，与官方棋手号段不撞），5 个 token（`token_10004_otter_motter` 梅尔的机械水獭、`token_10025_doroth_recttp` 多萝西的共振装置、以及三台装置 `token_rhine_{medical,energy,laser}`），4 件装备 `chess_item_rhine_{terminal,mainframe}_{a,b}`，16 条特质 `garrison_rhine_*`，4 条效果 `eff_rhine_*`。**盟约** `rhineShip`（阈值 **3 / 6 / 9**，`bondType` SEASON，`packId` 是数组 `['packRhine','packAphris']` 以兼容 **谬因·并入莱茵**）成员 10 名、可见 9 名。**装置机制**（`shared/rhineResearch.js` 是数值单一真相，服务端/浏览器/模拟共用）：基础攻击 **300** + 每层科研 **+4**；3 名启动一台、6 名两台、9 名三台；**生态维持仪**（医疗，治疗 + 减速 + 2 段钙质化）与**能量谐振仪**（充能脉冲，3 格满充放一次）各有 2 级突破、每级 **5 研究点**（参战成功 +2 / 失败 +1，突破后清零不保留溢出），**激光钻机**只有 1 级、锁最大生命值最高的敌人、满 **20 秒**后每秒追加目标最大生命值的真实伤害（`0.05% + 每层 0.0005%`）。`[ASSUMED]`：激光钻机不积累研究点或突破（源描述里没有它的研究点口径，按武器化装置处理）。**六.3 的旧实现已删除**：`server/sim/content/bonds/addon/rhine.js`（`git rm`）——它按源扩展早期版本把 6 名共享做成一条 buff，与 `content/rhine.js` 的 `rhine:sharing`（读**已部署**装置）会**双重加算**，故只保留后者（`bonds/addon.js` 顶部注释记了这次交接）。**开关语义**（沿用六.2 的三条通道）：① 12 条棋手记录带 `packId`；② 六名扩展干员加入的**官方**盟约（`sargonShip` / `preciShip` / `skillfulShip` / `arcaneShip` / `emptyShip` / `soloShip`）带 `packRestore.packRhine`——`packId` 只管记录存亡，**被指向的成员名单**要收回，否则盟约名单里留幽灵行；③ **重定阶与换帧**：塞雷娅（`chess_char_5_11_a`）V→**III**（价 4→3）、白面鸮（`chess_char_5_16_a`、`chess_char_4_21_a`）→III，`garrisonIds` 换成 `garrison_rhine_saria_a` / `garrison_rhine_ptilopsis_a`——这 6 条棋手记录带 `packRestore.packRhine`（`{tier, bonds, garrisonIds, price}`，存的是**移植前**的旧值），`shared/packData.js` 的 `withPackRestore` 在开头还原，`withPackBonds`/`effectiveBonds` 随后仍能正确剔除。**`[ASSUMED]` 与源扩展的偏差**：源扩展用**整份 `data/vanilla/` profile**（`dataProfile` / `data/vanilla/*.json` / 客户端 `ui/dataProfile.js`）表达「关掉就是原版」，本 fork 已有 PR-B..E 建立的 `pack*` 三通道 strip 约定，故**不引入 profile 机制**，改用 `packRestore` 记录旧值——这是需求方 2026-10-15 拍板的方向（`六.3` 起一致）。同样**未移植**源扩展的**六席（六人协作）布局**与**卡兹戴尔扩展**（`kazdelShip` / `shared/kazdel.js` / `tools/assets/kazdel-plan.mjs` / `public/art/kazdel/` / `public/js/render/fx/kazdel.js` / `ui/kazdelHud.js` / `kazdelState.js`）：它们与莱茵同源但属于**另外的包**，不属于「莱茵生命」这一条内容，故不在本 PR。**bot**：`server/match/bot.js` 新增 `rhineBotRecord(m, ps, piece)`（把装置 token 的兜底记录换成装置的保守战斗模型：医疗转治疗、能量按技能频率估充能、激光按锁定单体且 `rangeGrid: []`）与 `rhineLaserExposure(initialDps, seconds, maxHp, layers)`（积分钻机增伤——含 20 秒爬坡与之后按目标最大生命值的真实伤害），`pieceValue` 给 9 名门槛加权（`rhineCapacity(bonds[RHINE_BOND])*8`，解锁激光再 +40），`placeTokensSteps` 优先落**已研发**的科研装置。**客户端**：`public/js/render/rhineDevices.js`（新增，`ResearchDeviceActor`：三台装置的自绘模型 + 阶段/充能/激光锁定状态机）、`public/js/ui/rhineDock.js`（新增，科研备牌区面板：装置卡、研究点/阶段进度、作用范围文案 `researchRangeText`、`laserProgressText`）、`public/css/screens/rhine.css`（新增，并在 `public/index.html` 挂载）。接线点：`render/units.js`（`researchDevice`/`researchActor`，装置不画朝向楔形、不加载 Spine、走 `unitSpriteTexture` 而不是头像菱形遮罩，能量装置把 SP 条当充能表）、`render/fx/{kinds,simfx,zones,system}.js`（9 个新 fx 种类 `rhine{Heal,Pulse,Ecology,Laser}` / `dorothy{Trap,Critical,Chain}` / `form` / `burn`；`researchArea` 注册进 `FX_METHOD_ORDER`；持续的生态场用 keyed `tileFlash` 且不被普通命中闪烁挤掉）、`render/app.js` + `render/app/info.js`（`renderInfo` 透出 `researchStage`/`researchActive`/`researchLaser*`/`sp`/`spMax`，晚到的视图 `setResearchStage` 回放到当前阶段；`drawHighlight` 支持圆形范围并按 `GEO` 战场矩形裁剪）、`render/{tiles,textures,prepfield}.js`（`circleRangeSections` 圆形高亮、`unitSpriteTexture`、`circleToDisp`）、`ui/gameLogic/placement.js`（`indexPieces` 认 `priv.research.hand`；`canPlace`/`dropIntent` 处理 `area: 'research'` 与装置上限）、`ui/fallbackField.js`（低配 2D 回退把圆形范围画成 SVG 弧、能量装置充能有 `role=progressbar`）、`ui/detailPanel.js`（装置卡：科研装置 chip、基础攻击提示、作用范围、锁定与增伤）、`screens/game.js`（挂 `RhineDock`、拖拽时预览科研范围、朝向轮读装置半径）。**服务端**：`server/match/player/research.js`（新增 `PlayerResearch`：装置备牌区、研究点/阶段/解锁、场上限）、`snapshot.js`（装置的 `researchStage`/`researchActive`/`researchLaser*` 与把研究充能映射进 `sp`/`spMax` 的普通技能条槽位——断线重连与中途入场都能还原，是修掉的一处**观战隐私/状态泄漏**之外的正常回放）、`player/{placement,views,round}.js`、`PlayerState.js`、`fields.js`、`invariants.js`、`match/watch.js`（`_spectatorSpec` 剥掉 `research.hand`：装置备牌区是私有信息，**不得**进观战视图）、`sim/{damage,simdata}.js`、`sim/content/index.js`（`rhine` / `rhineMeta` 两个域 + `RHINE_KITS`）、`sim/content/{rhine,rhineMeta}.js`（新增）、`sim/content/kits/rhine{,Assault,New,Support}.js`（新增）、`sim/content/items/battle.js`、`sim/content/garrisons/battle.js`。**美术**：`public/art/rhine/`（作者自绘 14 个文件：`bond.svg` 与三台装置的 `*.svg`/`*-unit.png`，另有 `source/v2/laser.png` 原稿，许可边界见该目录 README）由 `tools/assets/rhine-plan.mjs`（`rhineArtInput` / `addRhineArt`，6 名干员 + 2 个 token）接线进 `tools/fetch-assets.mjs`，`data/assets.json` 收录三名干员的头像/半身像/技能图标与装置图标（**源码在 `tools/`，产物在 `public/art/`，官方素材仍不入 git**）。**工具**：`tools/rhine-data.mjs`（新增 `RHINE_ADDITIONS`，从上游 0.2.4 源表编译 12 条棋手 + token + 装备，`refreshLockedFrom` 在重定阶后重算 `backups.diy.locked[tier][charId].from`——否则塞雷娅 V→III 会留下过期补位名单）、`tools/rhine-data-source.json`、`tools/rhine-i18n.mjs`（`refreshRhineTranslations` 刷新 `data/i18n/*` 里 121 系列的旧译文）、`tools/golden.mjs`（改用 `filterRawData`，让 golden 语料按包过滤而不是只看裸记录）。**golden 未移动**：六个语料族（roster 19 / bonds 23 / fields 6 / matches 11 / standins 5 / diy 2）全部匹配。 | `tools/rhine-data.mjs` (新增), `tools/rhine-i18n.mjs` (新增), `tools/rhine-data-source.json` (新增), `tools/assets/rhine-plan.mjs` (新增), `tools/{build-data,fork-data,fork-overrides,golden,fetch-assets}.mjs`, `shared/rhineResearch.js` (新增), `shared/rhineRange.js` (新增), `shared/packData.js` (`withPackRestore`/`PACK_RESTORE_FIELD`), `server/match/player/research.js` (新增), `server/match/player/{placement,views,round}.js`, `server/match/{PlayerState,fields,invariants}.js`, `server/match/match/watch.js`, `server/sim/snapshot.js`, `server/sim/{damage,simdata}.js`, `server/sim/content/{index,rhine,rhineMeta}.js`, `server/sim/content/kits/rhine{,Assault,New,Support}.js` (新增), `server/sim/content/{bonds/addon.js,items/battle.js,garrisons/battle.js}`, `server/sim/content/bonds/addon/rhine.js` (删除), `server/match/bot.js`, `data/{chess,bonds,garrisons,items,tokens,effects,backups,assets}.json`, `data/i18n/{en,ja,ko,zh-TW}.json`, `public/i18n/en.json`, `public/index.html`, `public/css/screens/rhine.css` (新增), `public/js/render/rhineDevices.js` (新增), `public/js/ui/rhineDock.js` (新增), `public/js/render/{units,tiles,textures,app,interp,prepfield}.js`, `public/js/render/app/info.js`, `public/js/render/fx/{kinds,simfx,zones,system}.js`, `public/js/ui/{detailPanel,fallbackField,facingWheel,gameLogic/placement}.js`, `public/js/screens/{game,game/range}.js`, `public/art/rhine/*` (新增), `test/pack-rhine.test.js` (新增), `test/{data,backups,diy,package,i18n,i18n-data,i18n-packs}.test.js`, `test/content/*`, `test/match/*`, `test/sim/*`, `test/ui/*`, `test/render/*` |
| 六.F 莱茵科技：道具框与商店共用一个槽位 | 莱茵生命的**科研装置选择框**与**商店干员表**改为**互斥共用商店那一个槽位**（右下角），默认显示**商店**。原先道具框是屏幕**左下角**的独立绝对定位块（`css/screens/rhine.css .rhine-dock`），既在商店旁边重复一列卡片，又压在交流按钮的角上。现在它作为**弹性子元素**交给商店栏（`ShopBar` 的 `rhineDock` 属性；`screens/game.js` 不再自己渲染 `RhineDock`），于是工具栏（剩余可放置角色 / 莱茵科技 / 冻结 / 刷新）**始终在被显示的那个框上方**——备战相机预留的 HUD 带（`ui/fieldHost.js HUD_REM.shopBarTop`）因此仍然量得到可见的框，而一个高度未知的绝对定位浮层做不到这一点。切换是 **CSS 而非条件渲染**（`screens/game.js` 的 `rhineOpen`，默认 `false` = 商店；`.shopbar.has-rhine .shopbar__row{display:none}` 与 `.shopbar:not(.has-rhine) .rhine-dock{display:none}`），所以商店的两次点击待确认卡、滚动位置与冻结/晋升奖励状态都能跨切换保留——道具框只是被隐藏，从不卸载。**「莱茵科技」按钮**是商店原生的 `.toolbtn`（`toolbtn--rhine`，薄荷色，显示道具框时 `is-on`），因此与冻结（冰蓝）、刷新（琥珀）并列读作第三个工具；它**只在莱茵生命激活时存在**，与道具框自身的渲染条件相同（`RhineDock` 在科研位锁定时返回 null），所以未激活的房间不会给出一个它兑现不了的切换。道具框原来的**提示行**（`.rhine-dock__hint`：「3人可部署1台…」/「点击高亮格或拖动到棋盘部署」）**删除**——每张卡片的作用范围行与「盟约 N 层 · 部署 d/c」表头已经承载了同样的信息。顺带修掉两个**真实的部署 bug**（根因，不是症状）：`PlayerPieces.find` 从未扫描**科研位**，于是装置出科研位的每一次 `g.move` 都答「无效的目标」；`shared/protocol.js` 的 `target()` 不接受 `{area:'research'}`，于是**收回**答「无效的请求」。另外 `public/dev/game-mock.html` 自该面板加入以来一直**漏引** `css/screens/rhine.css`——这就是 mock 截图里它没有样式的原因 | `public/js/ui/rhineDock.js`, `public/js/ui/shopBar.js`, `public/js/screens/game.js`, `public/css/screens/rhine.css`, `public/css/screens/game-shop.css`, `public/dev/game-mock.html`, `server/match/player/pieces.js`, `shared/protocol.js`, `test/match/rhine-deploy.test.js` (新增), `test/ui/rhine-toggle.test.js` (新增), `test/ui/rhine-toggle.e2e.test.js` (新增) |
| 三.7 局内 UI 四条补充（2026-10-15） | 四条局内 UI 调整：**交流按钮整体缩到 70%**（`css/emotes.css .ewheel__btn`：回退盒 `min-width`/`height`、精灵宽 `--ewb-w`、图标与标签全部 ×.7，`css/devices.css` 里为它让位的 `.dpanel` 同步缩放；`test/ui/issue5-fold-camera.test.js` 里角标带的高度公式同改）；**删除自选干员局内脚下的「自选」标签**（`screens/game/standInTags.js`：`diyPieces`、`.sitag--diy` 规则与 `data-diy` 属性一并移除——自选干员在商店卡（`.scard__diy`）、画出来的模型和详情卡（`.dtag-diy`）里都已经明示，脚下再来一个只是噪音，因此是删除而非隐藏；「替补」标签不受影响）；**修复「剩余可放置角色」长度异常**（`css/screens/game-shop.css`：上一版用 `flex-basis:100%` 让它独占一行，同时把标签本身**拉满整行宽度**，现补 `max-width: fit-content`，恢复内容宽度与右对齐，莱茵科技按钮仍自动落在冻结左侧）；**莱茵科技框拉宽、高度对齐商店**（`css/screens/rhine.css`：`.rhine-dock` 高度钉成 `calc(2.44rem + 3px)`＝商店行的 padding×2 + 2.24rem 卡片 + 3px 边框，卡片列由 1.56rem 拉宽到 2.3rem、字号与图标相应放大，卡片改为纵向 flex 让「详情」贴底，并删掉「窄屏收窄列宽」的媒体查询——字号随 rem 缩放，收窄列只会让文字更多折行进一个固定高度） | `public/css/emotes.css`, `public/css/devices.css`, `public/css/screens/game-shop.css`, `public/css/screens/rhine.css`, `public/css/screens/game-panels.css`, `public/js/screens/game/standInTags.js`, `public/js/screens/game.js`, `docs/design/client.md`, `test/ui/diy-ui.test.js`, `test/ui/diy.e2e.test.js`, `test/ui/issue5-fold-camera.test.js`, `test/ui/text-scale.test.js` |
| 作弊菜单：盟约+100 | 作弊菜单（`ui/cheats.js`，本机开关，默认关闭）新增第四个控件 **「盟约+100」**（一次性按钮，交互与「免费刷新 +5」一致：点一次加一次）。效果：该玩家**所有已激活且可叠层**的盟约层数 +100。「可叠层」就是 `!noStack`——四条无层数的盟约（调和、绝技、独行、协防干员）被跳过，而不是塞进一个没人读的数字；加层集合取自 `this.bonds`（该玩家**真正激活**的盟约），不是完整盟约表。加层走 `addLayers` 而非直接写 `layers[]`，因此「解除叠层上限」开关、999 上限、所有 `onLayers` 处理器与 `m.layer` 动画的行为与正常加层完全一致；每条盟约之间会 `recompute`，因为莱茵生命的层数可能解锁下一台装置，而按 N 层结算的里程碑盟约（远见、奇迹、维多利亚 …）会触发它自己的给予 | `shared/constants.js` (`CHEAT_BOND_LAYER_STEP`), `shared/protocol.js` (`g.cheat.bondLayers`), `server/match/player/economy.js` (`_cheatBondLayers`), `public/js/ui/cheats.js`, `public/js/ui/gameActions.js`, `public/js/screens/game.js`, `public/i18n/en.json`, `test/cheat-menu.test.js`, `test/ui/cheat-ui.test.js`, `docs/design/client.md` |
| 六.C 新干员包改为内嵌（2026-10-15） | 需求方决定：「新干员包」与「额外干员包」**不再设开关，直接内嵌游戏、默认开启**。做法是**把包身份整个删掉**而不是做一个永远为真的开关——`packExtra6` / `packCustom` 从 `MOD_KEYS` / `MOD_DEFAULTS` / `PACK_KEYS` / `PACK_AUTHORS` 与 Mod 子菜单的 `MOD_ROWS` 一并移除（`normalizeMods` / `modsCount` / `packEnabled` 一行未动），`tools/fork-overrides.mjs` 里三处标记同时删掉：`applyForkPackMembers` 不再给四条棋手记录盖 `packId`、`applyForkBonds` 不再写 `packMembers`、`applyForkGarrisons`（连同 `FORK_APPLIERS` 里的 `garrisons` 一项）整个删除。于是 `data/{chess,bonds,garrisons}.json` 里那 4 条 `packId` 与 3 条 `packMembers` 消失，**结城理 / 丰川祥子成为与官方干员完全一样的普通内容**——`packEnabled(mods, undefined)` 恒为真，任何房间都含有他们，而 strip 语义与「关闭 = 逐字节原版」的保证对**仍然存在的三个包**不变。`额外干员包` 本来就没有任何记录（六.D 结案），删键无副作用。**可见干员数 112 → 114**（`test/match/pool.test.js` 的池容量与两处计数、`test/ui/loadout.e2e.test.js` 的 `.lo-card` 计数、`test/match/pool.test.js` 的 L6 / L2 分阶占比按新分母重测）；`tools/build-data.mjs` 的 `validateAll` 断言本来就是 114，未动。**golden 按规则移动**（语料是「默认房间」，多两名可见干员即改变每一次商店抽取）：roster 49 → **50** 个场景（新增 `roster-050`）、bonds / fields / matches 三个语料族全部重算，standins / diy 未移动；`tools/golden.mjs` 与 `test/golden/README.md` 的计数注释同步。`test/pack-extra6.test.js` 由「开关控制整包」改写为「内嵌内容」的断言（无 `packId`、无 `packMembers`、默认房间即含两人），`test/pack-switches.test.js` 的合成用例改用仍在的三个包 | `shared/constants.js` (`MOD_KEYS`/`MOD_DEFAULTS`/`PACK_KEYS`/`PACK_AUTHORS`), `public/js/ui/mods.js` (`MOD_ROWS`), `tools/fork-overrides.mjs` (`applyForkPackMembers`/`applyForkBonds`/`applyForkGarrisons` 删除/`FORK_APPLIERS`), `data/chess.json`/`data/bonds.json`/`data/garrisons.json`, `test/golden/{roster,bonds,fields,matches}.json`, `tools/golden.mjs`, `test/golden/README.md`, `test/pack-extra6.test.js`, `test/pack-switches.test.js`, `test/match/pool.test.js`, `test/ui/loadout.e2e.test.js`, `docs/PLAYING.md` |
| 二.10 对局选项 | 房主配置新增「**对局选项** / MATCH OPTIONS」区块（需求方 2026-10-15 截图）：**怪物血量 / 怪物攻击 / 怪物防御 / 怪物魔抗** 四个滑条，**每格 +10%、最高 +100%**（`HOST_ENEMY_MAX_STEPS` 10 / `HOST_ENEMY_STEP_PCT` 10），加强**本局全部敌人**，下方一行显示合计（「本局敌人已获得强化（合计 N%），请谨慎调整」）。**全模式通用**（独立模拟也有：强化的是自己的敌人，不涉及与队友共享，故无单人限制）。实现上**一处生效**：`GameData.enemyScale` 把 HP / ATK 折进官方回合表，于是普通怪、部位、悬赏怪、首领战内召唤物（`flags.enemyScale`，`bosses.js summonMods` 读取）与客户端自建 spec **全部**继承；DEF / RES 回合表里没有位置，由 `GameData.enemyBuffDefRes` → `waves.js roundMods` 写 `defMul` / `resMul`（为 1 时不写键，保证未强化时逐字节相同）；首领的 HP 是**共享池**，所以 `enemyBuff.hp` 落在 `GameData.bossPoolHp` 与 `finalAssault.bossPoolHp`（两者断言一致）。**无强化 = 逐字节原版**：`enemyBuffMul` 在四项全 0 时返回 `null`，`golden 未移动`。传输：`room.setEnemyBuff { key, steps }`（仅房主、开局前、越界即 `BAD_MSG`）、`room.state.enemyBuff`、`opts.enemyBuff` → `Match.enemyBuff` → `m.public.enemyBuff`；跨对局保留，改动会让其他玩家重新确认。**滑条不是按钮**：客户端的 `setEnemyBuff` 有意绕过 `run()`——拖动每格都会触发 input，而 `run()` 的 `inFlight` 会丢掉第一步之后的每一次、`busy` 又会把四个滑条连同所有开关一起禁用（浏览器实测 1→7 拖动只落在 +10%）；现在每格各自发一次幂等请求（服务端后写覆盖），失败仍弹 toast | `shared/constants.js` (`HOST_ENEMY_KEYS`/`HOST_ENEMY_DEFAULTS`/`HOST_ENEMY_MAX_STEPS`/`HOST_ENEMY_STEP_PCT`/`HOST_ENEMY_SOLO_KEYS`/`normalizeEnemyBuff`/`enemyBuffMul`), `shared/protocol.js` (`room.setEnemyBuff`), `server/lobby.js` (`enemyBuff`/`setEnemyBuff`), `server/match/Match.js`, `server/match/gamedata.js` (`enemyBuff`/`enemyScale`/`enemyBuffDefRes`/`bossPoolHp`), `server/match/waves.js` (`roundMods(scale, ex, gd)` 与首领分支), `server/match/finalAssault.js` (`bossPoolHp`), `server/match/match/views.js`, `public/js/screens/room.js` (`HOST_ENEMY_ROWS`/`enemyBuffPanel`/`enemyBuffTotal`/`EnemyBuffSection`), `public/css/screens/room.css` (`.ebuff`), `public/i18n/en.json`, `test/lobby-enemy-buff.test.js`, `test/match/enemy-buff.test.js`, `test/ui/host-config.test.js`, `docs/FORK.md`, `docs/PLAYING.md` |
