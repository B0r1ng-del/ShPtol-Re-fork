// Shared enums & constants (server + browser). Pure ESM, no Node APIs.

import { N_ } from './i18n.js';

export const PROTOCOL_VERSION = 1;
/** Release version shown to players (title screen, server banner, /healthz). Kept equal to package.json "version"
 * (test/version.test.js); PROTOCOL_VERSION above is the separate wire-format number. */
export const APP_VERSION = '0.2.6';
/** A development build (the public `dev` branch): the title screen, the boot banner and the README say so, and
 * tools/package.mjs refuses to build a release zip from it without --allow-dev. */
export const DEV_BUILD = /-dev$/.test(APP_VERSION);

export const MAX_SEATS = 4;
/**
 * Seat cap of the 终极模拟 room — the fork's third room mode. The official 终极模拟 ("与至多6名博士组成同盟，共享干员池，
 * 联防协作抵御敌潮") hosts up to SIX 博士, where 独立模拟 is 1 and 同盟模拟 is MAX_SEATS (4). MAX_SEATS keeps its meaning
 * for every pre-existing room: solo = 1 seat, coop = 4, ultimate = ULTIMATE_SEATS.
 */
export const ULTIMATE_SEATS = 6;
/** Room modes a `room.create` may ask for, in lobby-card order. */
export const ROOM_MODES = Object.freeze(['solo', 'coop', 'ultimate']);
/** Seat cap per room mode (solo 1 / coop MAX_SEATS / ultimate ULTIMATE_SEATS); unknown modes fall back to MAX_SEATS. */
export const SEATS_BY_MODE = Object.freeze({ solo: 1, coop: MAX_SEATS, ultimate: ULTIMATE_SEATS });
/** Seat cap of a room mode: the lobby's seat grid, the protocol's seat ranges and the room screen all read it. */
export const roomSeatCap = (roomMode) => SEATS_BY_MODE[roomMode] ?? MAX_SEATS;
/** 终极模拟 offers no difficulty picker: its single difficulty is the ABYSS table (AC-4), kept on the mode record. */
export const ULTIMATE_DIFFICULTY = 'ABYSS';
/**
 * Spectator seats of a co-op room (community report #26, owner's decision 2026-10-04) — a remake feature: the official
 * room has 1–4 players and no spectator seat (there only eliminated players and 联防 bystanders watch, research 09 §3.1).
 * A spectator never counts as a player, may not act, and watches like an eliminated player (server/lobby.js spectate,
 * server/match/match/watch.js addSpectator).
 */
export const MAX_SPECTATORS = 2;
export const ROOM_CODE_LEN = 4;
export const NAME_MAX_LEN = 12;

/**
 * 房主配置 — the room options the host sets in the 准备房间 (room.setHostConfig, room.state.hostConfig). Each one is a
 * boolean with a documented default; the room keeps them across its matches and the match reads them when it starts.
 * Only a room with at least two seats can use the ones that share something between players (the panel hides itself
 * when there is nobody to share with — 独立模拟 has a single seat).
 *
 *   sharedPool    共享卡池   on  — 全同盟共用一个干员池 (the official rule: every player draws from one stock, and one
 *                                  player taking a copy takes it from everybody — gamedata.poolCopies × coopPoolMultiplier)
 *                            off — every player has their own stock of every 干员: nothing anybody takes is denied to
 *                                  the others (a remake option, off is NOT official)
 *   sharedBounty  共享悬赏   on  — 全队共用一套悬赏决策牌，先选先得 (one 机变 悬赏 draft, and a card taken is gone for
 *                                  the rest of the team)
 *                            off — every player gets their own set of 悬赏 cards (a remake option)
 *   aiPicksLast   AI 队友最后选择 — the co-op option of GitHub #338 (room.setAiPicksLast): kept here so the panel shows
 *                                  every room option in one place; its own message and room.state field stay
 *   multiAlliance 多同盟模式 on  — more than one 博士 may take the SAME 策略 (the 队友已选 lock of the strategy draft is
 *                                  lifted; Match.bandTaken)
 *                            off — the official rule: 每个策略只能由一位博士选择
 *   itemSell      装备可售卖 on  — a loose item (hand / temp) may be sold for ITEM_SELL_PRICE funds: the same gate 销毁
 *                                  has (an equipped one stays locked either way), paying instead of destroying
 *                            off — the official rule and the default: an item can only be 销毁 (PlayerItems.destroy)
 */
export const HOST_CONFIG_KEYS = Object.freeze(['sharedPool', 'sharedBounty', 'aiPicksLast', 'multiAlliance', 'itemSell']);
/** Defaults of HOST_CONFIG_KEYS: the official behaviour of each option. */
export const HOST_CONFIG_DEFAULTS = Object.freeze({ sharedPool: true, sharedBounty: true, aiPicksLast: false, multiAlliance: false, itemSell: false });
/**
 * The HOST_CONFIG_KEYS a single-seat room (独立模拟) may still set: the ones that share something between players are
 * meaningless with nobody to share with (the lobby refuses them, the panel hides them), a rule about one's own items is
 * not. The panel shows exactly these rows in a solo room and nothing else.
 */
export const HOST_CONFIG_SOLO_KEYS = Object.freeze(['itemSell']);

/**
 * 房主配置 装备可售卖 (`itemSell`): what one sold item pays. The one definition — the server pays it
 * (PlayerEconomy.sell), the audit checks it and the client prints it (ui/underframe.js, ui/detailPanel.js).
 */
export const ITEM_SELL_PRICE = 1;

/**
 * Mod 开关 — the lobby's per-device gameplay switches (a fork feature, `room.create.mods`). They live in the 模式界面
 * only, beside 干员调配, and they are NOT room options: they are a local preference the creator carries into the room it
 * creates (`public/js/ui/mods.js`, localStorage), and the match then runs under them like it runs under the difficulty.
 * A joiner plays the host's rules — the server keeps the room's mods, the same way it keeps the mode and the difficulty.
 *
 * Each one defaults OFF, so a room created without them, and every caller that passes nothing (the golden scenarios,
 * the rehearsal tools, every test), is byte-identical to the official mode.
 *
 *   noBondBan  关闭盟约禁用  on  — no 盟约 is disabled this match, in ANY mode: neither the per-match draw of
 *                                  server/match/pool.js (`config.bans` / `modes[].bans`) nor the mode's own static
 *                                  `inactiveBondIds` list (标准模拟's ten, 终极模拟's none). This is the fork's original
 *                                  二.1 "此模式下所有盟约不会被禁用", now a switch instead of a property of 终极模拟.
 *                             off — the official rule, exactly as before: the difficulty draws its bans and the mode's
 *                                  static list stays off ("本局禁用").
 *   untimedSp  机变不限时  on  — the 机变 draft of ANY mode runs without a clock (`spFirst` / `spTurn` are not armed);
 *                                  it ends when every alive player has picked, exactly like 独立模拟's draft already
 *                                  does (`soloUntimed`).
 *                             off — the official timed draft (`config.timers.spFirst` / `spTurn`, auto-pick on expiry).
 *   randomSpVote 机变随机分配 on  — the 机变 draft of ANY mode offers the 「随机分配」 vote: any player may vote instead of
 *                                  picking, and as soon as half the alive players have voted the system hands the cards
 *                                  out at random, one per alive player. 悬赏决策 never offers it (its card adds enemies
 *                                  to the PICKER's own battles, so handing it to somebody else would break the
 *                                  attribution) — the same rule 终极模拟's own `spDraft.randomVote` follows (二.4).
 *                             off — no vote button anywhere the mode itself does not ask for it (the official draft).
 */
export const MOD_KEYS = Object.freeze([
  'noBondBan', 'untimedSp', 'randomSpVote', 'extraRounds', 'targetedPick', 'uncapLayers',
  'packRhine', 'packAphris', 'packRelic', 'packExtra6', 'packCustom',
]);
/** Defaults of MOD_KEYS: the official behaviour of each switch (all off). */
export const MOD_DEFAULTS = Object.freeze({
  noBondBan: false, untimedSp: false, randomSpVote: false, extraRounds: false, targetedPick: false, uncapLayers: false,
  packRhine: false, packAphris: false, packRelic: false, packExtra6: false, packCustom: false,
});

/**
 * 内容包开关 — the second column of the Mod submenu: whether a ported content pack may be used IN GAME. One key per
 * pack, all in MOD_KEYS (they travel with `room.create.mods` like every other switch, and a joiner plays the host's).
 *
 * ON  — every chess / bond / item of that pack is offered and plays normally.
 * OFF (the default) — its records are invisible to the match and to the client: they are filtered out of the shop pool,
 *                     the reels and every 干员/盟约 list, so a room created without the pack is the original content.
 *
 * A record carries its pack in ITS OWN `packId` field (`data/chess.json` / `backups.json` / `bonds.json` / `items.json`),
 * written by the fork's data layer (`tools/fork-overrides.mjs` → `tools/fork-data.mjs`); a record WITHOUT one is the
 * original content and is always offered. `packEnabled` is the whole rule, read by `GameData` (server) and by the
 * client's data store, so both agree on what a match contains.
 *
 * `PACK_AUTHORS` is the ported content's credit, shown in each switch's own ⓘ (the second column's tip).
 */
export const PACK_KEYS = Object.freeze(['packRhine', 'packAphris', 'packRelic', 'packExtra6', 'packCustom']);
export const PACK_AUTHORS = Object.freeze({
  packRhine: 'YUYUYUYUYUYUYUTOUA',
  packAphris: 'SrC204',
  packRelic: 'UNDFFIO',
  packExtra6: 'remember-4',
  packCustom: 'Lunac1a',
});
/**
 * Whether a data record of pack `packId` may be used under these switches. No `packId` = the original content (`null`
 * / `undefined` is truthy here only when the record names no pack, which is the whole point); an unknown pack id is
 * only available when a switch of that exact name is on, so a pack whose switch was removed stays off. An ARRAY of ids
 * means the record belongs to every one of them (`rhineShip` is contributed by both 莱茵生命 and 谬因·并入莱茵): it is
 * available when ANY of them is on, because either switch alone has to be able to bring its own bond with it.
 * @param {Record<string, boolean>|null|undefined} mods
 * @param {string|string[]|null|undefined} packId
 */
export const packEnabled = (mods, packId) => {
  if (Array.isArray(packId)) return packId.length === 0 || packId.some((id) => mods?.[id] === true);
  return !packId || mods?.[packId] === true;
};
/**
 * How many extra 普通回合 the 「额外 4 回合」 switch (`extraRounds`) inserts before the boss: the run goes 14 → 18 rounds
 * in every mode. `GameData.extraRounds` reads it; the inserted rounds reuse the last ordinary round's own table.
 */
export const MOD_EXTRA_ROUNDS = 4;
/**
 * 作弊菜单 (the floating cheat ball, a local-only development aid): the per-player switches a player can turn on for
 * ITSELF. They are NOT room options and NOT Mod 开关 — every one of them is per player, and they are gated to the PREP
 * phase by the server (`Match.cheat`). `PREF_CHEATS` is the device-local "show the ball at all" preference; the ball
 * only ever appears when that is on, so a normal player never sees it.
 */
export const CHEAT_KEYS = Object.freeze(['infiniteFunds', 'enemyOneHp']);
/** Defaults of CHEAT_KEYS: every cheat off. */
export const CHEAT_DEFAULTS = Object.freeze({ infiniteFunds: false, enemyOneHp: false });
/** 免费刷新 +5: how many free shop refreshes one press of the cheat button grants. */
export const CHEAT_FREE_REFRESH_STEP = 5;
/** 盟约 +100: how many layers one press of the cheat button adds to every stackable active bond. */
export const CHEAT_BOND_LAYER_STEP = 100;
/** The HP every enemy gets while a player has 「怪物血量降为 1 血」 on (their own normal fields only). */
export const CHEAT_ENEMY_HP = 1;
/**
 * 「无限金币」 keeps a player's funds at least this high, re-topped on every prep action, so the shop shows a large
 * number and nothing is ever unaffordable. Turning the switch off restores the funds the player had when it went on
 * (`PlayerState.cheatFundsSaved`), so the cheat leaves no trace on the economy.
 */
export const CHEAT_GOLD_FLOOR = 9999;
/**
 * The card families the 随机分配 vote may hand out when the `randomSpVote` switch offers it in a mode whose own
 * `spDraft` does not list any (二.4 lists its own; this is the switch's default). 悬赏 (`bounty`) is deliberately NOT
 * here: 「悬赏类不要添加随机机制」 — its card adds its enemies to the picker's own next battles, so handing it to somebody
 * else would break the attribution. A 悬赏决策 draft therefore never offers the vote, whatever the switch says.
 */
export const MOD_RANDOM_SP_FAMILIES = Object.freeze(['supply', 'shop', 'tactic']);
/**
 * Normalise a `mods` payload to exactly MOD_KEYS booleans: a missing / malformed value is the official default, so an
 * unknown key can never switch anything on. Pure and total — GameData and the match both run every value through it.
 * @param {any} mods
 * @returns {Record<string, boolean>}
 */
export function normalizeMods(mods) {
  const src = mods && typeof mods === 'object' && !Array.isArray(mods) ? mods : {};
  /** @type {Record<string, boolean>} */
  const out = {};
  for (const k of MOD_KEYS) out[k] = src[k] === true;
  return out;
}

export const DIFFICULTIES = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
export const DIFFICULTY_NAMES = { FUNNY: N_('标准模拟'), NORMAL: N_('险境模拟'), HARD: N_('绝境模拟'), ABYSS: N_('终极模拟') };
export const DIFFICULTY_COLORS = { FUNNY: '#f6a329', NORMAL: '#e85a1a', HARD: '#e73118', ABYSS: '#ff0024' };

// modeId in data/config.json = `mode_${type}_${difficulty.toLowerCase()}` with type single|multi|ultimate
const MODE_TYPE = Object.freeze({ solo: 'single', coop: 'multi', ultimate: 'ultimate' });
/**
 * Mode id of a room: `mode_${type}_${difficulty.toLowerCase()}`.
 *
 * 终极模拟 has exactly ONE record (`mode_ultimate_abyss`, ULTIMATE_DIFFICULTY — no difficulty picker), so its id must
 * not depend on whatever difficulty a caller happens to carry. data/config.json has no `mode_ultimate_normal` /
 * `_hard` / `_funny`, and an id naming a record that is not there leaves GameData with an empty mode record: the
 * mode's own `bans: { core: 0, addon: 0 }` is not read, `bans()` falls back to the difficulty table (ABYSS = 3 core +
 * 4 add-on) and the per-match draw of server/match/pool.js disables 盟约 again in a six-博士 room. Clamping here keeps
 * the "no bond bans" promise structural instead of resting on every caller remembering to pass ABYSS.
 */
export const modeIdFor = (roomMode, difficulty) =>
  roomMode === 'ultimate'
    ? `mode_ultimate_${ULTIMATE_DIFFICULTY.toLowerCase()}`
    : `mode_${MODE_TYPE[roomMode] || 'multi'}_${difficulty.toLowerCase()}`;

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  INFO_CHECK: 'INFO_CHECK',
  BAND_DRAFT: 'BAND_DRAFT',
  BATTLE_CHECK: 'BATTLE_CHECK',
  ROUND_START: 'ROUND_START',
  SP_DRAFT: 'SP_DRAFT',
  PREP: 'PREP',
  COMBAT: 'COMBAT',
  UNITE: 'UNITE',
  SETTLE: 'SETTLE',
  FINAL_ASSAULT: 'FINAL_ASSAULT',
  HIDDEN_CORE: 'HIDDEN_CORE',
  RESULT: 'RESULT',
});

export const PHASE_NAMES = {
  LOBBY: N_('等待中'), INFO_CHECK: N_('确认本局信息'), BAND_DRAFT: N_('选择策略'), BATTLE_CHECK: N_('协议启动'),
  ROUND_START: N_('回合开始'), SP_DRAFT: N_('机变阶段'), PREP: N_('休整期'), COMBAT: N_('作战中'), UNITE: N_('联防阶段'),
  SETTLE: N_('结算'), FINAL_ASSAULT: N_('最终攻势'), HIDDEN_CORE: N_('隐秘核心'), RESULT: N_('模拟结束'),
};

// Board geometry on the 19x21 stage grid (row 0 = bottom). See DESIGN §3.
export const GEO = Object.freeze({
  ROWS: 19, COLS: 21,
  FIELD: { r0: 9, r1: 12, c0: 2, c1: 10 },        // own deployable board region
  NORMAL_RECT: { r0: 9, r1: 12, c0: 0, c1: 10 },  // simulation rect for a normal battle
  UNITE_RECT: { r0: 9, r1: 12, c0: 0, c1: 20 },
  BOSS_RECT: { r0: 0, r1: 5, c0: 0, c1: 20 },
  HAND_ROW: 7, HAND_SIZE: 10,                      // hand slot idx = col 0..9
  TEMP_ROW: 8, TEMP_C0: 4, TEMP_SIZE: 5,           // temp slot idx 0..4 = cols 4..8
  PARTNER_COL_OFFSET: 8,
});

export const AREA = Object.freeze({ BOARD: 'board', HAND: 'hand', TEMP: 'temp', OUTSIDE: 'outside' });

export const PIECE_KIND = Object.freeze({ CHESS: 'chess', ITEM: 'item', TOKEN: 'token' });

/**
 * Whether the placed piece of a skill's summon (赫默's 医疗探机, 巫恋's 诅咒娃娃) also deploys once, for free, at the
 * battle start. true = the PRTS reading (卫戍协议/帮助 §作战阶段: "所有手动部署的召唤物，无视所属干员的持有状态…作战开始时
 * 立即部署一次", example 赫默's drone), settled by the user on 2026-10-01 after playtest #6 (DESIGN §20); false = the
 * playtest #4 reading ("是赫默开技能释放一次，不是开局直接就部署了"): it takes its tile only when the owner's skill gives one.
 * Either way the piece re-appears on its tile each time the owner's skill gives one.
 * One switch for everything that depends on it: the sim (server/sim/content/tokens.js dockSkillSummons) and the summon
 * card's hint (public/js/ui/detailPanel.js summonDeployHint). docs/PLAYING.md §4 and docs/SIM.md (token pieces) state
 * the rule in prose — test/ui/playtest6_summons.test.js fails until they match the value.
 */
export const SKILL_SUMMON_START_DEPLOY = true;

/**
 * Official per-bond layer cap (docs/research/11-limits-official.md §1): the client's
 * `Torappu.Battle.AutoChessBattleConst.MAX_GARRISON_STACK = 999`, and its bond counter (`AddBondCount`) stores
 * `min(L + n, 999)` — each bond stops at 999 on its own; the community reports bonds sitting at 999 while fed (巴哈姆特
 * 12534 "每把都能999层", 12316 "999謝"; research 02 §layers). The only implementation of the cap (DESIGN §20.12). Every
 * writer of a bond's layers goes through `layerGainRoom`: the prep-side gains (server/match/player/economy.js addLayers —
 * 特质, items, bands, 机变 cards, bonds), the settle of the in-battle gains (server/match/match/settle.js) and the live in-battle
 * copy (server/sim/battle/economy.js addLayers, as the client's AddBondCount) — and the dev tools' direct writes (tools/matchrun.mjs
 * --layers, tools/balance.mjs applyBoard); a gain at the cap adds 0 (no onLayers, no 'layer'
 * event), and the client-result check (server/match/fields.js) bounds a reported gain by the room left. Milestones paid
 * per N layers (远见, 奇迹, 维多利亚 …) stop with the count. 0 / Infinity = no cap.
 */
export const BOND_LAYER_CAP = 999;

/**
 * The cap in force for a match: the official `BOND_LAYER_CAP`, or no cap at all while the 「解除叠层上限」 Mod switch
 * (`uncapLayers`) is on. ONE function so every writer of a bond's layers agrees — the switch lifts the ceiling and
 * nothing else, every other layer rule (who may gain, `requireActive`, the per-battle allowance, the client-result
 * bound) is untouched.
 * @param {{uncapLayers?: boolean}|null|undefined} mods the match's Mod 开关 (GameData.mods)
 * @returns {number} the layer ceiling, or Infinity for no ceiling
 */
export function layerCapFor(mods) {
  if (mods && mods.uncapLayers === true) return Infinity;
  return BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity;
}

/**
 * The layers a gain of `n` actually adds to a bond holding `before` under BOND_LAYER_CAP: min(n, cap − before), never
 * negative (a count already at or over the cap gains 0 and is never lowered); 0 for a non-positive / non-finite `n`
 * except +Infinity (= "the room left").
 * `cap` defaults to the official ceiling, so every pre-existing caller keeps the official behaviour byte for byte; a
 * caller passing `layerCapFor(gd.mods)` (Infinity while 解除叠层上限 is on) lifts it.
 * @param {number} before
 * @param {number} n
 * @param {number} [cap]
 */
export function layerGainRoom(before, n, cap = BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity) {
  if (!(n > 0)) return 0;
  const c = cap > 0 ? cap : Infinity;
  const b = Number.isFinite(before) && before > 0 ? before : 0;
  return Math.max(0, Math.min(n, c - b));
}

/**
 * Official boss-hit limit "限伤" (docs/research/11-limits-official.md §2): `AutoChessBattleConst.MAX_BATTLE_DAMAGE =
 * 300000`. In a boss battle outside training — our battle kinds 'boss' (Final Assault) and 'hidden' (Hidden Core) — a
 * single hit on a leader (`AutoChessBattleUtil.IsBossEnemy`: an enemyId of activity_table autoChessData.bossInfoDict
 * = data/bosses.json `enemyKey`; in the sim the tag-'boss' units: those leaders and their mirrored copies, never parts,
 * escorts or drones) whose `ceil(final damage)` ≥ this is CANCELLED: 0 damage, nothing credited to the shared pool
 * (`AutoChessStepModeManager._OnBossEnemyTakeDamage` → `modifier.Cancel()`). It is not a clamp: a hit of 299999 lands.
 * Checked in server/sim/damage.js (dealDamage after DEF / RES and every multiplier, before shields; Battle.loseHp — not
 * the 胄 drone link's pool share, `noHitLimit`, DESIGN §25.13.4). Minions, normal rounds and 联防 are unaffected.
 * 0 / Infinity = off.
 */
export const BOSS_HIT_LIMIT = 300000;

// Snapshot unit flag bits (DESIGN §8.2)
export const UF = Object.freeze({
  BLOCKED: 1, STUNNED: 2, FROZEN: 4, STEALTH: 8, SKILL: 16, SHIELD: 32, INVULN: 64, COLD: 128, SLEEP: 256, FLYING: 512,
});

export const ANIM = Object.freeze({ IDLE: 0, MOVE: 1, ATTACK: 2, SKILL: 3, DIE: 4, STUN: 5, DEPLOY: 6 });

export const ERR = Object.freeze({
  BAD_MSG: 'BAD_MSG',             // malformed / unknown message
  SESSION_IN_USE: 'SESSION_IN_USE', // a local recovery candidate cannot replace the connected holder
  RATE: 'RATE',                   // rate limited
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_STARTED: 'ROOM_STARTED',
  NOT_HOST: 'NOT_HOST',
  NOT_READY: 'NOT_READY',
  WRONG_PHASE: 'WRONG_PHASE',
  NO_FUNDS: 'NO_FUNDS',
  HAND_FULL: 'HAND_FULL',
  BOARD_FULL: 'BOARD_FULL',
  BAD_TILE: 'BAD_TILE',
  BAD_TARGET: 'BAD_TARGET',
  SOLD_OUT: 'SOLD_OUT',
  MAX_LEVEL: 'MAX_LEVEL',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ALREADY: 'ALREADY',
  TEMP_NOT_EMPTY: 'TEMP_NOT_EMPTY',
  ELIMINATED: 'ELIMINATED',
  SPECTATOR: 'SPECTATOR',         // a spectator seat only watches (MAX_SPECTATORS)
  INTERNAL: 'INTERNAL',
});

export const ERR_TEXT = {
  SESSION_IN_USE: N_('此对局仍在其他窗口中，或当前浏览器无法安全恢复。请关闭原窗口后重试。'),
  BAD_MSG: N_('无效的请求'), RATE: N_('操作过于频繁'), NOT_IN_ROOM: N_('你不在房间中'), ROOM_NOT_FOUND: N_('未找到该同盟密钥对应的房间'),
  ROOM_FULL: N_('房间已满'), ROOM_STARTED: N_('模拟已开始'), NOT_HOST: N_('只有房主可以操作'), NOT_READY: N_('仍有玩家未就绪'),
  WRONG_PHASE: N_('当前阶段无法进行该操作'), NO_FUNDS: N_('资金不足'), HAND_FULL: N_('整备区已满'), BOARD_FULL: N_('已达到部署上限'),
  BAD_TILE: N_('无法部署在该位置'), BAD_TARGET: N_('无效的目标'), SOLD_OUT: N_('已售出'), MAX_LEVEL: N_('调度中心已达最高等级'),
  NOT_YOUR_TURN: N_('尚未轮到你'), ALREADY: N_('已完成该操作'), TEMP_NOT_EMPTY: N_('临时整备区不为空'), ELIMINATED: N_('你已被淘汰'),
  SPECTATOR: N_('观战中无法进行该操作'), INTERNAL: N_('服务器内部错误'),
};

// ---- Emotes (交流, research 09 §4) -----------------------------------------------------------------------------
// The 36 official in-match emotes: display_meta_table emoticonData, scene AUTOCHESS_BATTLE, 6 themes × 6, one wheel
// page per theme in activity_table autoChessData.enabledEmoticonThemeIdList order, emotes by sortId. `g.emote { id }`
// / `m.emote { playerId, id }` carry the official emoji id. Generated reference: data/emotes.json
// (tools/build-emotes.mjs); test/ui/emotes.test.js keeps this table identical to it.
// Official emotes have no text (desc is null): `label` is ours and only ever an aria-label, never displayed.
// Art: extracted from a local client (tools/local-extract) to /assets/local/emoticon/<dir>/<picId>.png and listed in
// data/local-assets.json group `emoticon/<dir>`; also downloaded from the public mirror by tools/fetch-assets.mjs
// (tools/assets/plan.mjs UI_EXTRAS → data/assets.json ui['emoticon/<dir>/<picId>'], GitHub issue #42). The UI takes the
// local picture first, then the mirror copy, and shows a neutral glyph when neither is there. The picId is not
// derived from the id (autochess_battle_fooldoctor_03…06 → pic_fooldoctor_04/05/06/08_battle).
const emo = (id, sortId, picId, label) => Object.freeze({ id, sortId, picId, label });
export const EMOTE_THEMES = Object.freeze([
  { themeId: 'emoticon_autochess_basic', dir: 'basic', sortId: 100000, isBasic: true, name: N_('表情套组：卫戍协议'), emotes: [
    emo('autochess_battle_happy', 1001, 'pic_happy_battle', N_('开心')),
    emo('autochess_battle_scared', 1002, 'pic_scared_battle', N_('害怕')),
    emo('autochess_battle_sorry', 1003, 'pic_sorry_battle', N_('对不起')),
    emo('autochess_battle_thanks', 1004, 'pic_thanks_battle', N_('谢谢')),
    emo('autochess_battle_thinking', 1005, 'pic_thinking_battle', N_('思考')),
    emo('autochess_battle_nice_cooperate', 1006, 'pic_cooperate_battle', N_('合作愉快')),
  ] },
  { themeId: 'emoticon_originium_slug', dir: 'slug', sortId: 1001, isBasic: false, name: N_('表情套组：虫动'), emotes: [
    emo('slug_autochess_battle_nice_work', 2001, 'pic_nice_work_battle', N_('合作愉快！')),
    emo('slug_autochess_battle_thanks', 2002, 'pic_thanks_battle', N_('谢谢！')),
    emo('slug_autochess_battle_sorry', 2003, 'pic_sorry_battle', N_('对不起！')),
    emo('slug_autochess_battle_bye', 2004, 'pic_bye_battle', N_('再见！')),
    emo('slug_autochess_battle_distrust', 2005, 'pic_distrust_battle', '？？？'),
    emo('slug_autochess_battle_very_soon', 2006, 'pic_very_soon_battle', N_('很快就好！')),
  ] },
  { themeId: 'emoticon_autochess_basic_2', dir: 'basic_2', sortId: 100001, isBasic: true, name: N_('表情套组：卫戍协议'), emotes: [
    emo('autochess_battle_noproblem', 1007, 'pic_noproblem_battle', N_('没问题！')),
    emo('autochess_battle_respect', 1008, 'pic_respect_battle', N_('敬礼！')),
    emo('autochess_battle_call', 1009, 'pic_call_battle', N_('欢呼！')),
    emo('autochess_battle_playingcool', 1010, 'pic_playingcool_battle', N_('酷！')),
    emo('autochess_battle_sad', 1011, 'pic_sad_battle', N_('伤心')),
    emo('autochess_battle_dying', 1012, 'pic_dying_battle', N_('快死了')),
  ] },
  { themeId: 'emoticon_foolsday_doctor', dir: 'fooldoctor', sortId: 1002, isBasic: false, name: N_('表情套组：博士士'), emotes: [
    emo('autochess_battle_fooldoctor_01', 1020, 'pic_fooldoctor_01_battle', N_('博士士 1')),
    emo('autochess_battle_fooldoctor_02', 1021, 'pic_fooldoctor_02_battle', N_('博士士 2')),
    emo('autochess_battle_fooldoctor_03', 1022, 'pic_fooldoctor_04_battle', N_('博士士 3')),
    emo('autochess_battle_fooldoctor_04', 1023, 'pic_fooldoctor_05_battle', N_('博士士 4')),
    emo('autochess_battle_fooldoctor_05', 1024, 'pic_fooldoctor_06_battle', N_('博士士 5')),
    emo('autochess_battle_fooldoctor_06', 1025, 'pic_fooldoctor_08_battle', N_('博士士 6')),
  ] },
  { themeId: 'emoticon_foolsday_amiya', dir: 'foolamiya', sortId: 1003, isBasic: false, name: N_('表情套组：米米子'), emotes: [
    emo('autochess_battle_foolamiya_01', 1040, 'pic_foolamiya_01_battle', N_('米米子 1')),
    emo('autochess_battle_foolamiya_02', 1041, 'pic_foolamiya_02_battle', N_('米米子 2')),
    emo('autochess_battle_foolamiya_03', 1042, 'pic_foolamiya_03_battle', N_('米米子 3')),
    emo('autochess_battle_foolamiya_04', 1043, 'pic_foolamiya_04_battle', N_('米米子 4')),
    emo('autochess_battle_foolamiya_05', 1044, 'pic_foolamiya_05_battle', N_('米米子 5')),
    emo('autochess_battle_foolamiya_06', 1045, 'pic_foolamiya_06_battle', N_('米米子 6')),
  ] },
  { themeId: 'emoticon_foolsday_wisdel', dir: 'foolwisdel', sortId: 1004, isBasic: false, name: N_('表情套组：维维美'), emotes: [
    emo('autochess_battle_foolwisdel_01', 1060, 'pic_foolwisdel_01_battle', N_('维维美 1')),
    emo('autochess_battle_foolwisdel_02', 1061, 'pic_foolwisdel_02_battle', N_('维维美 2')),
    emo('autochess_battle_foolwisdel_03', 1062, 'pic_foolwisdel_03_battle', N_('维维美 3')),
    emo('autochess_battle_foolwisdel_04', 1063, 'pic_foolwisdel_04_battle', N_('维维美 4')),
    emo('autochess_battle_foolwisdel_05', 1064, 'pic_foolwisdel_05_battle', N_('维维美 5')),
    emo('autochess_battle_foolwisdel_06', 1065, 'pic_foolwisdel_06_battle', N_('维维美 6')),
  ] },
].map((t) => Object.freeze({ ...t, emotes: Object.freeze(t.emotes) })));
/** Every emote with its theme: `{ id, sortId, picId, label, themeId, dir }`, in wheel order. */
export const EMOTE_CATALOG = Object.freeze(EMOTE_THEMES.flatMap((t) => t.emotes.map((e) => Object.freeze({ ...e, themeId: t.themeId, dir: t.dir }))));
/** The 36 official emote ids (protocol whitelist: `EMOTES.includes(id)`). */
export const EMOTES = Object.freeze(EMOTE_CATALOG.map((e) => e.id));
const EMOTE_INDEX = new Map(EMOTE_CATALOG.map((e) => [e.id, e]));
/** Catalog record of an emote id, or null (safe for any input, including '__proto__'). */
export const emoteInfo = (id) => (typeof id === 'string' && EMOTE_INDEX.get(id)) || null;
// id-keyed maps without a prototype: a wire id like '__proto__' / 'toString' looks up undefined, never an Object method
const emoteMap = (pick) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(EMOTE_CATALOG.map((e) => [e.id, pick(e)]))));
/** Emote id → theme id. */
export const EMOTE_THEME = emoteMap((e) => e.themeId);
/** Emote id → our aria-label (never displayed). */
export const EMOTE_LABEL = emoteMap((e) => e.label);
/** data/local-assets.json group of an emote's art (`emoticon/<dir>`), or null. */
export const emoteArtGroup = (id) => { const e = emoteInfo(id); return e ? `emoticon/${e.dir}` : null; };
/** Canonical URL of an emote's extracted art (`/assets/local/emoticon/<dir>/<picId>.png`), or null for unknown ids. */
export const emoteArtPath = (id) => { const e = emoteInfo(id); return e ? `/assets/local/emoticon/${e.dir}/${e.picId}.png` : null; };
export const EMOTE_COOLDOWN_MS = 1000; // activity_table autoChessData.constData.chatCD (s)
export const EMOTE_BUBBLE_MS = 3000;   // constData.chatTime (s): how long a bubble stays up
/**
 * 一键十连 (fork): the emotes ONE `g.emoteBurst` sends. The burst shares the single-send cooldown — it is one send,
 * not ten — so ten quick taps can never flood a room.
 */
export const EMOTE_BURST_COUNT = 10;
/** How long one 弹幕 item takes to fall from the top edge to below the bottom one (a client-side display choice). */
export const EMOTE_BARRAGE_MS = 9000;
