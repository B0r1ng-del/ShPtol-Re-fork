// Lobby screen: pick 独立模拟 / 同盟模拟 and a difficulty (标准/险境/绝境/终极), create a room,
// or join one with a 同盟密钥 (recent codes remembered) — as a player (加入同盟) or in one of its MAX_SPECTATORS
// spectator seats (观战: room.spectate, also while its match runs; community report #26, a remake feature — the
// official room has none). Shows connection status + ping. The top bar opens the read-only S.W.E.E.P.报告
// (screens/sweep.js: 盟约 / 策略 / 敌方资料 and the enemy codex).
//
// Difficulty descriptions come from data/config.json `modes[modeId]` when present, else from the
// official act2autochess `modeDataDict` texts embedded below (desc + effectDescList), so the
// screen is complete before data is generated. Rounds: solo 标准 = 9, everything else 14 (+R15
// hidden core on 险境+), per research 00-INDEX §2. Battlefield pool (`modes[].stages`): 标准 always
// plays 战场#01, 险境 draws one of 8, 绝境 / 终极 one of 7 (m01 excluded).
// Texts go through t() (docs/I18N.md); the module-level tables hold msgids (N_) translated where they are shown, the
// config.json mode texts come localized from data.js.

import { TestMark } from '../ui/testConsole.js';
import { ResumeMatchButton } from '../ui/resumeMatch.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, ROOM_CODE_LEN, MAX_SEATS, ULTIMATE_SEATS, ULTIMATE_DIFFICULTY, ROOM_MODES, MAX_SPECTATORS, modeIdFor, ERR } from '../../../shared/constants.js';
import { html, confirmDialog, Button, Icon, MicroLabel, Panel, TextField, PingPill, AvatarFrame, Tooltip, Spinner, DifficultyIcon, doctorNo, Modal } from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { GuideButton, openGuide } from '../ui/guide.js';
import { openStats } from './stats.js';
import { SweepReport } from './sweep.js';
import { SettingsButton } from '../ui/settings.js';
import { PwaInstallButton } from '../ui/device.js';
import { LoadoutButton } from './loadout.js';
import { ModMenuButton } from './mods.js';
import { modsOn } from '../ui/mods.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { getConfig, getMode, getStage, useData } from '../data.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { NoticesButton } from '../ui/notices.js';
// 大厅背景与音乐 (from the old UI PR #643's keep list): the generated scenes / one's own picture, and the lobby BGM.
import { useHubBackdrop, HubBackdrop, HubRadar, backdropTheme, BackdropSettings, BackdropGlyph } from '../ui/hubBackdrop.js';
import { Emblem } from './title.js';
import { AchievementEntry, AchievementPanel } from '../ui/achievements.js';
import { LobbyMusicButton } from '../ui/lobbyMusic.js';
// 选择模拟协议 (from the old UI PR #643's keep list): the full-screen page a mode opens — the difficulty's isometric
// scene at the left, the difficulty cards down the right.
import { ProtocolScene } from '../ui/protocolScene.js';
import { RadarScene, CreateArt, JoinArt } from '../ui/matchFlow.js';
import { useLeave } from '../ui/transitions.js';

/** Official mode texts (activity_table act2autochess.modeDataDict), fallback when config.json is absent. */
/**
 * Forge 工坊（需求方 2026-10-24）：按钮跳的是**插件工作台** `/studio/`，不是 `editor/` 那个独立进程。
 *
 * 地址不能写死：工作台的 key 只打印在服务器窗口里（server/http/boot.js），浏览器拿不到。所以服务端开了一个
 * 只对本机带 key 的端点（server/http/routes.js `STUDIO_LINK_PATH`），这个按钮问它要地址：
 *   * 本机打开页面 ⇒ 拿到带 `#key=` 的深链，点一下就能改插件；
 *   * 局域网其它设备 ⇒ 拿到不带 key 的 `/studio/`（能看，改动被 gate 拒）；
 *   * 服务器关了工作台 ⇒ `url: null`，按钮**不画**（画一个点了 404 的按钮不如不画）。
 */
export const STUDIO_LINK_PATH = '/api/studio-link';
/** 一次页面生命周期内只问一次；`undefined` = 还没问，`null` = 这台服务器没有工作台。 */
let studioLink;
export function studioLinkUrl() {
  if (studioLink !== undefined) return studioLink;
  studioLink = null;
  try {
    fetch(STUDIO_LINK_PATH, { headers: { Accept: 'application/json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { studioLink = j && typeof j.url === 'string' && j.url ? j.url : null; })
      .catch(() => { studioLink = null; });
  } catch { /* 没有 fetch（node 测试会 import 这个模块） */ }
  return studioLink;
}

export const MODE_TEXT = {
  single: {
    FUNNY: { code: 'AC-1', desc: N_('时长较短的模拟训练'), effects: [N_('可以快速完成作战'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
  multi: {
    FUNNY: { code: 'AC-1', desc: N_('敌方攻击强度较低的模拟训练'), effects: [N_('作战环境较为温和'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
  // 终极模拟 (the fork's third mode): one difficulty only — the AC-4 table, up to six 博士
  ultimate: {
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
};

/** Battlefield pool per difficulty when config.json is absent (the modes' `stages` lists; same for solo and co-op). */
export const STAGE_POOL = { FUNNY: ['act1autochess_m01'], NORMAL: 8, HARD: 7, ABYSS: 7 };

/**
 * Display name of a stage: stages.json when it is loaded, else derived from the id (act1 m0N → 战场#0N, act2 m0N → 战场#0(N+4)).
 * From the data name only its 战场#NN part (with a (上半) / (下半) mark) — 'Battlefield #NN (First Half)' in English.
 * @param {string} id e.g. 'act1autochess_m01'
 */
export function stageLabel(id) {
  const rec = getStage(id);
  if (rec && typeof rec.name === 'string' && rec.name) {
    const m = rec.name.match(/^(.*?#\d+(?:\s*[(（][^)）]*[)）])?)/);
    return m ? m[1] : rec.name.split(/\s+/)[0];
  }
  const m = String(id || '').match(/^act(\d)autochess_m(\d+)$/);
  return m ? t('战场#{no}', { no: String(Number(m[2]) + (m[1] === '2' ? 4 : 0)).padStart(2, '0') }) : '';
}

/**
 * The battlefield note of a difficulty (official wording): a single-stage pool is fixed ("战场固定为 战场#01"), a larger
 * one is drawn at random ("战场随机（共8张）").
 * @param {string[] | number | null | undefined} stages the mode's `stages` list (or a count)
 * @returns {string} '' when unknown
 */
export function stageNote(stages) {
  if (Array.isArray(stages)) {
    const ids = stages.filter((s) => typeof s === 'string' && s);
    if (ids.length === 1) { const name = stageLabel(ids[0]); return name ? t('战场固定为 {name}', { name }) : t('战场固定'); }
    return ids.length > 1 ? t('战场随机（共{n}张）', { n: ids.length }) : '';
  }
  return Number.isInteger(stages) && stages > 1 ? t('战场随机（共{stages}张）', { stages }) : '';
}

/** The lobby's mode cards, in display order: 独立模拟 / 同盟模拟 / 终极模拟 (the fork's six-博士 mode). */
export const MODE_CARDS = [
  {
    id: 'solo', name: N_('独立模拟'), en: 'SOLO SIMULATION', icon: 'user',
    desc: N_('独自调配资金与干员，以自己的节奏完成整场模拟。'),
    points: [N_('1 名博士'), N_('休整期与机变阶段不限时')],
  },
  {
    id: 'coop', name: N_('同盟模拟'), en: 'ALLIANCE SIMULATION', icon: 'users',
    desc: N_('与至多 {n} 名博士组成同盟，共享干员池，联防协作抵御敌潮。'), params: { n: MAX_SEATS - 1 },
    points: [N_('1–{n} 名博士 · 可由 AI 队友补位'), N_('联防阶段 · 最终攻势合并生命值')], pointParams: { n: MAX_SEATS },
  },
  {
    id: 'ultimate', name: N_('扩展模拟'), en: 'EXTENDED SIMULATION', icon: 'crown',
    desc: N_('与至多 {n} 名博士组成同盟，共享干员池，联防协作抵御敌潮。'), params: { n: ULTIMATE_SEATS },
    points: [N_('1–{n} 名博士 · 可由 AI 队友补位'), N_('固定为终极难度')], pointParams: { n: ULTIMATE_SEATS },
  },
];

/**
 * Text for a difficulty card, preferring data/config.json.
 * @param {'solo'|'coop'|'ultimate'} roomMode
 * @param {string} difficulty
 * @returns {{ code: string, desc: string, effects: string[], rounds: number, hidden: boolean, stageNote: string }}
 */
export function difficultyInfo(roomMode, difficulty) {
  const kind = roomMode === 'solo' ? 'single' : roomMode === 'ultimate' ? 'ultimate' : 'multi';
  const fallback = MODE_TEXT[kind][difficulty] || { code: '', desc: '', effects: [] };
  // modeIdFor() lower-cases the difficulty: never call it with a value the server did not validate.
  const m = DIFFICULTIES.includes(difficulty) ? getMode(modeIdFor(roomMode, difficulty)) : null;
  const effects = Array.isArray(m?.effectDescList)
    ? m.effectDescList.map((e) => String(e).replace(/^[·•・･\s]+/, '')).filter(Boolean)
    : fallback.effects.map((e) => t(e));
  const rounds = Number.isFinite(m?.lastRound) ? m.lastRound : roomMode === 'solo' && difficulty === 'FUNNY' ? 9 : 14;
  return {
    code: typeof m?.code === 'string' ? m.code : fallback.code,
    desc: typeof m?.desc === 'string' ? m.desc : t(fallback.desc),
    effects,
    rounds,
    hidden: difficulty !== 'FUNNY',
    stageNote: stageNote(Array.isArray(m?.stages) && m.stages.length ? m.stages : STAGE_POOL[difficulty]),
  };
}

const CODE_RE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LEN}}$`);
/**
 * Normalise user input into a room code: accepts a pasted invite link (`…?room=ABCD`), keeps
 * upper-cased alphanumerics and clamps to the code length.
 * @param {string} v
 * @returns {string}
 */
export function normalizeCode(v) {
  let s = String(v ?? '');
  const m = s.match(/[?&]room=([A-Za-z0-9]+)/);
  if (m) s = m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);
}

/**
 * A handler that Preact binds as `onClick=${fn}` receives the click EVENT as its first argument, and a default
 * parameter only applies to `undefined` — so `fn(c = code)` would normalise the event target into a nonsense code
 * (`String(el)` → `"[object HTMLElement]"` → "OBJE"). Only a string is ever a code; anything else falls back to the
 * input field. Returns null when neither yields a well-formed code.
 * @param {unknown} arg the argument a handler was called with
 * @param {string} field the current input-field value
 * @returns {string|null}
 */
export function codeArg(arg, field) {
  const k = normalizeCode(typeof arg === 'string' ? arg : field);
  return CODE_RE.test(k) ? k : null;
}

/**
 * Room code from a deep link query string (`?room=CODE`), or null when absent/malformed.
 * Accepts ROOM_CODE_LEN..ROOM_CODE_LEN+2 alphanumerics (the protocol's join limit).
 * @param {string} search e.g. location.search
 * @returns {string|null}
 */
export function parseRoomParam(search) {
  try {
    const raw = new URLSearchParams(search || '').get('room');
    if (!raw) return null;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) return null;
    return code.length >= ROOM_CODE_LEN && code.length <= ROOM_CODE_LEN + 2 ? code : null;
  } catch {
    return null;
  }
}

/** The lobby's normal default difficulty (no saved preference): what `?playtest=` without a usable key falls back to. */
export const DEFAULT_DIFFICULTY = 'FUNNY';

/**
 * One-click playtest from a deep link (`?playtest=1[&difficulty=KEY]`, the Forge 一键试玩 button).
 * Any non-empty value other than `0` / `false` turns it on, so `?playtest=1`, `?playtest=true` and a bare `?playtest=`
 * with no value never crash. The difficulty is validated against the shared DIFFICULTIES list: anything unknown
 * (a stale bookmark, a hand-edited URL) falls back to the lobby's own default — an invalid key must never reach the
 * server, where `room.create` answers with BAD_MSG instead of a match.
 * @param {string} search e.g. location.search
 * @returns {{ mode: 'solo', difficulty: string }|null} null = no playtest requested; `difficulty` is always valid
 */
export function parsePlaytestParam(search) {
  try {
    const p = new URLSearchParams(search || '');
    const raw = p.get('playtest');
    if (raw == null) return null;
    if (['', '0', 'false'].includes(String(raw).trim().toLowerCase())) return null;
    const want = String(p.get('difficulty') || '').trim().toUpperCase();
    return { mode: 'solo', difficulty: DIFFICULTIES.includes(want) ? want : DEFAULT_DIFFICULTY };
  } catch {
    return null;
  }
}

/** Recently joined/created co-op room codes (most recent first). */
export function recentRooms() {
  const list = loadPref('recentRooms', []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && CODE_RE.test(c)).slice(0, 4) : [];
}

/** @param {string} code */
export function rememberRoom(code, test = false) {
  if (!CODE_RE.test(code)) return;
  const recent = [code, ...recentRooms().filter((c) => c !== code)].slice(0, 4);
  const marks = loadPref('recentTestRooms', []);
  savePref('recentTestRooms', recent.filter(c => c === code ? test : Array.isArray(marks) && marks.includes(c)));
  savePref('recentRooms', recent);
}

export async function joinKnown(type, key) {
  try { return await net.request(type, { code: key }); } catch (err) {
    if (err?.code !== ERR.TEST_CONFIRM) throw err;
    const text = type === 'room.spectate'
      ? t('这是测试房间，不计入任何记录。确认观战？')
      : t('这是测试房间，不计入任何记录。确认加入？');
    if (await confirmDialog({ title: t('测试'), text })) {
      return net.request(type, { code: key, testAck: true });
    }
  }
}

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];
const TIP_ROTATE_MS = 5000; // matchingTipRotateInterval

/** Rotating tactical tips (config.json `tips`, weighted list of { tip, weight }). */
function TipsPanel() {
  const cfg = getConfig();
  const fallback = FALLBACK_TIPS.map((x) => t(x));
  const tips = Array.isArray(cfg?.tips)
    ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x)
    : fallback;
  const list = tips.length ? tips : fallback;
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * list.length));
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => i + 1), TIP_ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  const i = ((idx % list.length) + list.length) % list.length;
  return html`<div class="tips brackets">
    <div class="tips__head">
      <${Icon} name="info" />
      <span>${t('作战提示')}</span>
      <${MicroLabel}>TACTICAL TIPS<//>
      <span class="tips__idx num">${String(i + 1).padStart(2, '0')}<span class="t-dim">/${String(list.length).padStart(2, '0')}</span></span>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i - 1 + list.length)} aria-label=${t('上一条')}><${Icon} name="chevronLeft" /></button>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i + 1)} aria-label=${t('下一条')}><${Icon} name="chevronRight" /></button>
    </div>
    <p key=${i} class="tips__text">${list[i]}</p>
  </div>`;
}

function ModeCard({ card, selected, onSelect }) {
  return html`<button type="button" class=${`mode-card brackets${selected ? ' is-selected' : ''}`} onClick=${() => onSelect(card.id)}
      aria-pressed=${selected ? 'true' : 'false'}>
    <span class="mode-card__bg" aria-hidden="true"></span>
    <span class="mode-card__icon"><${Icon} name=${card.icon} /></span>
    <span class="mode-card__text">
      <${MicroLabel} tone=${selected ? 'mint' : undefined}>${card.en}<//>
      <span class="mode-card__name">${t(card.name)}</span>
      <span class="mode-card__desc">${t(card.desc, card.params)}</span>
      <span class="mode-card__points">${card.points.map((p) => html`<span key=${p}>${t(p, card.pointParams)}</span>`)}</span>
    </span>
    <span class="mode-card__check" aria-hidden="true"><${Icon} name="check" />${t('已选定')}</span>
  </button>`;
}

/** One tile of the hub's left column (密钥加入 …): icon, name, English line. */
function HubTile({ icon, label, en, onClick, children }) {
  return html`<button type="button" class="hub-tile" onClick=${onClick}>
    <span class="hub-tile__icon"><${Icon} name=${icon} /></span>
    <span class="hub-tile__text"><span class="hub-tile__label">${label}</span><span class="hub-tile__en">${en}</span></span>
    ${children}
  </button>`;
}

/** One of the hub's four mode entries along the bottom. */
function HubEntry({ card, onSelect }) {
  const tone = card.id === 'firepower' ? 'gold' : card.id === 'coop' ? 'bright' : card.id === 'ultimate' ? 'red' : undefined;
  return html`<button type="button" class=${`hub-entry${tone ? ` hub-entry--${tone}` : ''}`} onClick=${() => onSelect(card.id)}>
    <span class="hub-entry__icon"><${Icon} name=${card.icon} /></span>
    <span class="hub-entry__en">${card.en}</span>
    <span class="hub-entry__name">${t(card.name)}${card.badge ? html`<span class="mode-beta">${card.badge}</span>` : null}</span>
    <span class="hub-entry__corner" aria-hidden="true"></span>
  </button>`;
}

/** The S.W.E.E.P. report entry on the hub's right column (the fork's own screen). */
/** The S.W.E.E.P. report entry on the hub's right column — the upstream structure (`__glyph` / `__label` / `__tag`),
 *  which is what `.hub-plate`'s CSS actually styles. My first version invented `__icon` / `__text` / `__name`, so the
 *  plate rendered unstyled (the owner's screenshots 3 / 4). */
function SweepPlate({ onClick }) {
  return html`<button type="button" class="hub-plate hub-plate--sweep" onClick=${onClick} title=${t('S.W.E.E.P.报告：盟约、策略与敌方资料')}>
    <span class="hub-plate__glyph"><${Icon} name="book" /></span>
    <span class="hub-plate__label">S.W.E.E.P.${t('报告')}</span>
    <span class="hub-plate__tag">REPORT</span>
  </button>`;
}

/** The hand-drawn ring of the 已选定 stamp (two loose strokes). */
function StampRing() {  return html`<svg class="pcard__ring" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
    <path pathLength="1" d="M18 62C6 34 34 8 70 10c34 2 48 30 38 54-10 24-46 32-72 22C20 80 10 66 16 50" />
    <path pathLength="1" d="M30 20c22-14 62-12 78 10 12 18 4 44-16 54" />
  </svg>`;
}

/** One difficulty of 选择模拟协议: name, text, effects, and the code / rounds / 隐秘核心 / battlefield note below. */
function ProtoCard({ roomMode, difficulty, selected, onSelect }) {
  const info = difficultyInfo(roomMode, difficulty);
  return html`<button type="button" class=${`pcard${selected ? ' is-on' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`}
      onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="pcard__glow" aria-hidden="true"></span>
    <span class="pcard__head">
      <${DifficultyIcon} difficulty=${difficulty} class="pcard__glyph" />
      <span class="pcard__name">${t(DIFFICULTY_NAMES[difficulty])}</span>
    </span>
    <span class="pcard__desc">${info.desc}</span>
    <span class="pcard__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
    <span class="pcard__meta">
      ${info.code ? html`<span class="num">${info.code}</span>` : null}
      <span><b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t(' + 隐秘核心') : ''}</span>
      ${info.stageNote ? html`<span>${info.stageNote}</span>` : null}
    </span>
    <span class="pcard__stamp" aria-hidden="true"><${StampRing} /><span class="pcard__tick"><${Icon} name="check" /></span><span class="pcard__ok">${t('已选定')}</span></span>
  </button>`;
}

/**
 * 选择同盟方式: the screen 同盟模拟 opens (upstream `AllianceSelect`). The radar at the left with 入门协议, and on the
 * right 创建同盟 (a room at the remembered difficulty — changed inside the room), 搜寻队友 / 模拟邀约, and 加入同盟 with
 * its key field, 观战 and the recent keys. Esc or ‹ returns to the hub.
 *
 * Why its own screen: 同盟模拟 is not "a mode with a difficulty" like 独立模拟 — you first decide whether to create an
 * alliance or join one, and only the create branch goes on to pick a difficulty (ProtocolSelect).
 */
function AllySelect({ onClose, code, onCode, codeOk, recent, online, busy, onCreate, onJoin, onSpectate, onSearch, recruiting = 0, difficulty }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return html`<div class=${`proto ally${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label=${t('选择同盟方式')}>
    <div class="proto__bg ally__bg" aria-hidden="true"></div>
    <header class="proto-top">
      <button type="button" class="proto-back" onClick=${leave} title=${t('返回大厅 (Esc)')} aria-label=${t('返回大厅')}>
        <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
      </button>
      <div class="proto-title"><h2>${t('选择同盟方式')}</h2><span class="proto-title__mode ally__mode">${t('同盟模拟')}<i>ALLIANCE SIMULATION</i></span></div>
    </header>
    <div class="proto-body ally-body">
      <section class="ally-stage"><${RadarScene} />
        <button type="button" class="ally-guide" onClick=${() => openGuide(0)}><span class="ally-guide__icon"><${Icon} name="book" /></span>${t('入门协议')}</button>
      </section>
      <section class="ally-side">
        <button type="button" class="ally-card ally-card--create" disabled=${!online || busy === 'create'} onClick=${onCreate}>
          <span class="ally-card__art"><${CreateArt} /></span>
          <span class="ally-card__bar"><span class="ally-card__icon"><${Icon} name="plus" /></span>${t('创建同盟')}
            ${busy === 'create' ? html`<${Spinner} size="sm" />` : html`<small>${t('难度：{name}（可在同盟内更改）', { name: t(DIFFICULTY_NAMES[difficulty]) })}</small>`}</span>
        </button>
        <div class="ally-links">
          <button type="button" class="ally-pill" onClick=${onSearch}><${Icon} name="search" />${t('搜寻队友')}</button>
          <button type="button" class="ally-pill ally-pill--invite" onClick=${onSearch}>${t('模拟邀约')}${recruiting ? html`<b class="num">${recruiting}</b>` : null}<span class="ally-pill__mark" aria-hidden="true"></span></button>
        </div>
        <div class="ally-card ally-card--join">
          <span class="ally-card__art"><${JoinArt} /></span>
          <label class="ally-key"><${Icon} name="search" />
            <input type="text" value=${code} placeholder=${t('输入同盟密钥')} maxlength="64" autocomplete="off" spellcheck="false"
              onInput=${(e) => onCode(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') onJoin(); }} />
            ${codeOk ? html`<button type="button" class="ally-key__spec" disabled=${!online || busy === 'spectate'} onClick=${onSpectate}
              title=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}><${Icon} name="eye" />${t('观战')}</button>` : null}
          </label>
          ${recent.length ? html`<span class="ally-recent">${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')} onClick=${() => onCode(c)}>${c}</button>`)}</span>` : null}
          <button type="button" class="ally-card__bar ally-card__bar--join" disabled=${!codeOk || !online || busy === 'join'} onClick=${() => onJoin()}>
            <span class="ally-card__icon"><${Icon} name="users" /></span>${t('加入同盟')}${busy === 'join' ? html`<${Spinner} size="sm" />` : null}
          </button>
        </div>
      </section>
    </div>
  </div>`;
}

/**
 * 选择模拟协议: full screen over the hub — the selected difficulty's scene at the left (ui/protocolScene.js), the
 * difficulties down the right with the 已选定 stamp, 开始模拟 at the bottom right. Esc or ‹ returns to the hub.
 *
 * This is the flow the owner asked for (2026-10-24): the HUB picks a MODE only; the difficulty is chosen here, on its own
 * page, and 开始模拟 creates the room. The fork used to put both on one screen and create straight from the hub.
 */
function ProtocolSelect({ card, roomMode, difficulty, onDifficulty, onClose, online, busy, onCreate, testMode, asTest, onTestMode }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  const info = difficultyInfo(roomMode, difficulty);
  const label = roomMode === 'solo' ? t('开始独立模拟') : t('创建同盟');
  return html`<div class=${`proto${leaving ? ' is-leaving' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`} data-difficulty=${difficulty}
      role="dialog" aria-label=${t('选择模拟协议')}>
    <div class="proto__bg" aria-hidden="true"></div>
    <header class="proto-top">
      <button type="button" class="proto-back" onClick=${leave} title=${t('返回大厅 (Esc)')} aria-label=${t('返回大厅')}>
        <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
      </button>
      <div class="proto-title">
        <h2>${t('选择模拟协议')}</h2>
        <span class="proto-title__mode">${t(card.name)}<i>${card.en}</i></span>
      </div>
    </header>
    <div class="proto-body">
      <section class="proto-stage">
        <${ProtocolScene} key=${difficulty} difficulty=${difficulty} />
        <div class="proto-brief">
          <span class="proto-brief__code num">${info.code}</span>
          <b class="proto-brief__name">${t(DIFFICULTY_NAMES[difficulty])}</b>
          <p>${t(card.desc, card.params)}</p>
        </div>
      </section>
      <section class="proto-side">
        <div class="proto-list" role="radiogroup" aria-label=${t('模拟难度')}>
          ${/* 扩展模拟 is fixed to AC-4 (the server forces it): offering the other three cards let the page show a difficulty
               the room could never have — the owner's report of 2026-10-24. One card, not a disabled list of four. */
            (roomMode === 'ultimate' ? [ULTIMATE_DIFFICULTY] : DIFFICULTIES)
              .map((d) => html`<${ProtoCard} key=${d} roomMode=${roomMode} difficulty=${d} selected=${difficulty === d} onSelect=${onDifficulty} />`)}
        </div>
        <div class="proto-foot">
          ${roomMode === 'solo' ? html`<div class="proto-opts">
            <label class="proto-private" title=${t('不记录成绩，只用于试验阵容与模组')}>
              <input type="checkbox" checked=${testMode} onChange=${(e) => onTestMode(e.currentTarget.checked)} /><span>${t('测试')}</span></label>
          </div>` : null}
          ${/* 上游的 proto-start 不是普通 Button：它自带卫戍徽记 + 斜纹装饰（图一右下角那个），
               用 <Button> 加同名 class 只能拿到部分样式，所以这里照上游结构写。 */
            html`<button type="button" class="proto-start" disabled=${!online || busy === 'create'} onClick=${() => onCreate(asTest)}>
              <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
              <span class="proto-start__label">${busy === 'create' ? html`<${Spinner} size="sm" />` : null}${label}</span>
              <span class="proto-start__deco" aria-hidden="true"></span>
            </button>`}
        </div>
      </section>
    </div>
  </div>`;
}

/** Lobby screen component. */
export function LobbyScreen() {
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  useData('config');
  // Forge 工坊按钮的地址（服务端给；本机带 key）。第一次渲染时还没问到 ⇒ 这一帧不画，问到了下一帧就有了。
  const [studioHref, setStudioHref] = useState(() => studioLinkUrl());
  // 大厅背景 (from the old UI PR #643's keep list): the generated scenes or the player's own picture, and its dim /
  // blur / overlay / motion settings — a localStorage pref, the picture itself in IndexedDB (never uploaded).
  const bg = useHubBackdrop();
  const [bgOpen, setBgOpen] = useState(false);
  // 密钥加入 opens as a dialog over the hub (the new UI has no room for the join panel on the stage)
  const [joinOpen, setJoinOpen] = useState(false);
  // 成就统计 panel (the trimmed local build)
  const [achOpen, setAchOpen] = useState(false);
  useEffect(() => {
    if (studioHref) return undefined;
    let alive = true;
    const tick = () => { const u = studioLinkUrl(); if (alive && u) setStudioHref(u); };
    const id = setInterval(tick, 400);   // 问到了就停：studioLinkUrl 有缓存，tick 只是一次读
    return () => { alive = false; clearInterval(id); };
  }, [studioHref]);
  const [roomMode, setRoomMode] = useState(() => {
    const m = loadPref('lobby.mode', 'coop');
    return ROOM_MODES.includes(m) ? m : 'coop';
  });
  const [difficulty, setDifficulty] = useState(() => {
    const d = loadPref('lobby.difficulty', 'FUNNY');
    return DIFFICULTIES.includes(d) ? d : 'FUNNY';
  });
  const [code, setCode] = useState('');
  const [asTest, setAsTest] = useState(false);
  const testMode = useStore((s) => s.testMode === true);
  const [busy, setBusy] = useState(null);
  const [recent] = useState(recentRooms);
  const marks = loadPref('recentTestRooms', []);
  const [sweepOpen, setSweepOpen] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  const online = conn.status === 'online';
  const codeOk = CODE_RE.test(code);
  // 终极模拟 has no difficulty picker: whatever card is (not) picked, the room is created for AC-4 (the server forces it)
  const effDifficulty = roomMode === 'ultimate' ? ULTIMATE_DIFFICULTY : difficulty;


  const pickMode = (m) => { setRoomMode(m); savePref('lobby.mode', m); };
  const pickDifficulty = (d) => { setDifficulty(d); savePref('lobby.difficulty', d); };
  // 选择模拟协议 (owner 2026-10-24): the hub picks a MODE and opens this page; the difficulty is chosen there and 开始模拟
  // creates the room. `protoOpen` is the mode whose page is up (null = the hub).
  const [protoOpen, setProtoOpen] = useState(null);
  // 选择同盟方式 (upstream `AllianceSelect`): 同盟模拟 opens ITS OWN screen first (create / join / 寻队友), and only the
  // create branch continues to the difficulty page. 独立模拟 / 扩展模拟 go straight to ProtocolSelect.
  const [allyOpen, setAllyOpen] = useState(false);
  const openProto = (m) => { pickMode(m); if (m === 'coop') setAllyOpen(true); else setProtoOpen(m); };

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('尚未连接到服务器，请稍候'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  // Mod 开关 (ui/mods.js, MOD_KEYS): the switches are 房主配置 room options now (the lobby's Mod button is gone,
  // 2026-10-16), so the room is created with them ALL OFF and the host sets them in the room (room.setMods). This
  // device's last-used switches still ride along as the starting point, so a host who set them in a previous room does
  // not have to set them again; `modsOn()` is that remembered preference.
  const create = (asT = asTest) => run('create', () => net.request('room.create', {
    mode: roomMode, difficulty: effDifficulty, mods: modsOn(), ...(testMode && asT ? { test: true } : {}),
  }));
  const join = (c = code) => {
    // `onClick=${join}` hands the click EVENT as the first argument, and a default parameter only applies to
    // `undefined` — codeArg keeps an event target out of the key and falls back to the input field
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('join', () => joinKnown('room.join', k));
  };
  // a spectator seat: no player seat taken, nothing to do but watch (also a match already running)
  const spectate = (c = code) => {
    // same guard as join: `onClick=${spectate}` passes the click event, not a code
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('spectate', () => joinKnown('room.spectate', k).catch((err) => {
      // Clearer than the bare ERR_TEXT: the usual cause is a code that is not the host's (a remembered one from an
      // earlier room, or another machine's) — the server can only answer "no such room".
      if (err?.code === ERR.ROOM_NOT_FOUND) {
        toast(t('没有找到密钥 {k} 对应的同盟：请和房主核对密钥（同盟结束后密钥即失效）', { k }), 'warn');
        return;
      }
      if (err?.code === ERR.ALREADY) {
        toast(t('你已经是该同盟的博士：先离开同盟，才能以观战身份进入'), 'warn');
        return;
      }
      throw err;
    }));
  };
  const backToTitle = () => {
    identity.setEntered(false);
    store.set((s) => ({ session: { ...s.session, entered: false } }));
  };

  return html`<div class="screen lobby-screen lobby-hub" data-hub-theme=${backdropTheme(bg)}>
    <${HubBackdrop} bg=${bg} />
    <header class="topbar hub-topbar">
      <div class="topbar__left">
        <${Button} variant="ghost" size="sm" icon="chevronLeft" onClick=${backToTitle} title=${t('返回标题')}>${t('返回')}<//>
        <${PingPill} ms=${conn.ping} online=${online} />
        <span class="topbar__sep" aria-hidden="true"></span>
        <div class="topbar__tools">
          <${NoticesButton} />
          <${SettingsButton} class="lobby-settings" variant="secondary" square=${true} />
          <${GuideButton} class="lobby-guide" variant="secondary" square=${true} />
          <${Button} variant="secondary" size="sm" square=${true} class="hub-bg-btn" onClick=${() => setBgOpen(true)}
            title=${t('大厅背景')} aria-label=${t('大厅背景')}><${BackdropGlyph} /><//>
          <${LobbyMusicButton} />
          ${/* Forge 工坊（需求方 2026-10-24）：跳**插件工作台** `/studio/`（不是 editor/ 那个独立进程）。
               地址由服务端的 `/api/studio-link` 给（本机带 key，局域网不带）；没有工作台时 `studioLinkUrl()` 是
               null，这一整个按钮就不画 —— 点了 404 的按钮不如不画。 */
            studioHref ? html`<a class="btn btn--secondary btn--square lobby-forge" href=${studioHref} target="_blank" rel="noopener noreferrer"
              title=${t('Forge 工坊')} aria-label=${t('Forge 工坊')} data-testid="forge-link"><${Icon} name="hammer" /></a>` : null}
          <${PwaInstallButton} class="lobby-pwa" square=${true} />
        </div>
      </div>
      ${null /* The hub's top bar has NO centre title: the emblem and "卫戍协议：盟约" on the stage are the screen's name.
             Upstream's `.hub-topbar` is left + right only, and its background is a 4px→transparent gradient rather than
             the solid bar a plain `.topbar` gets — the two things the owner saw as 「一块纯黑」 and 「多一行字」. */
        }
      <div class="topbar__right">
        <${ResumeMatchButton} />
        ${/* Mod 菜单 (fork, 需求方 2026-10-16): the 内容包 switches' own dialog, beside 干员调配 as asked. The five
             game-rule switches are NOT here — they live in 房主配置 → 对局选项. */
          html`<${ModMenuButton} class="lobby-modmenu" />`}
        <${Button} variant="secondary" size="sm" icon="book" class="lobby-sweep" onClick=${() => setSweepOpen(true)}
          title=${t('S.W.E.E.P.报告：盟约、策略与敌方资料')}>S.W.E.E.P.<//>
        ${null /* 干员调配 has exactly ONE home in the new UI: the hub's right-column entry plate (`.hub-plate--loadout`
             below). The top bar used to carry a second copy — that is the duplicate the owner reported on 2026-10-24. */}
        <button type="button" class="me-chip me-chip--btn stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')}>
          <${AvatarFrame} size="sm" name=${me.name} seat=${0} self=${true} />
          <span class="me-chip__text">
            <span class="me-chip__name">${me.name || t('博士')}</span>
            <${MicroLabel}>${me.playerId != null ? `DOCTOR #${doctorNo(me.playerId)}` : 'DOCTOR'}<//>
          </span>
          <${Icon} name="chart" class="me-chip__stats" />
        </button>
      </div>
    </header>

    <main class="hub-stage">
      <div class="hub-center">
        <div class="hub-center__mark"><${HubRadar} bg=${bg} /><${Emblem} /></div>
        <div class="hub-center__en">STRONGHOLD PROTOCOL <b>ALLIANCE</b></div>
        <h1 class="hub-center__title">${t('卫戍协议：盟约')}</h1>
      </div>

      <aside class="hub-side">
        <${AchievementEntry} onOpen=${() => setAchOpen(true)} />
        <${HubTile} icon="key" label=${t('密钥加入')} en="JOIN WITH KEY" onClick=${() => setJoinOpen(true)} />
        <${TipsPanel} />
      </aside>

      <aside class="hub-right">
        <${SweepPlate} onClick=${() => setSweepOpen(true)} />
        <${LoadoutButton} from="lobby" size="lg" class="hub-plate hub-plate--loadout" label=${t('干员调配')} />
      </aside>

      <section class="hub-entries" aria-label=${t('模拟方式')}>
        <div class="hub-entries__row">
          ${MODE_CARDS.map((c) => html`<${HubEntry} key=${c.id} card=${c} onSelect=${openProto} />`)}
        </div>
      </section>
    </main>

    <${Modal} open=${joinOpen} title=${t('密钥加入')} micro="JOIN WITH KEY" width="min(9.2rem, calc(100vw - 2rem))"
      onClose=${() => setJoinOpen(false)}>
      <div class="join-dialog">
        <${TextField} size="code" icon="key" value=${code} placeholder=${t('输入同盟密钥 / 粘贴邀请链接')}
          transform=${normalizeCode} onInput=${(v) => setCode(normalizeCode(v))} onEnter=${() => join()} />
        <div class="join-dialog__row">
          <${Button} variant="amber" size="lg" icon="users" block=${true} loading=${busy === 'join'} disabled=${!codeOk || !online} onClick=${() => join()}>${t('加入同盟')}<//>
          <${Tooltip} text=${t('以观战者身份进入：不占博士席位，只能观看（每个同盟最多 {MAX_SPECTATORS} 名，模拟进行中也可进入）', { MAX_SPECTATORS })}>
            <${Button} variant="secondary" size="lg" icon="eye" class="join-spectate" disabled=${!codeOk || !online} onClick=${spectate}>${t('观战')}<//>
          <//>
        </div>
        <div class="join-foot">
          ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
            ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')}
              onClick=${() => setCode(c)}>${c}${Array.isArray(marks) && marks.includes(c) ? html` <${TestMark} />` : null}</button>`)}`
            : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
        </div>
      </div>
    <//>
    ${sweepOpen ? html`<${SweepReport} onClose=${() => setSweepOpen(false)} />` : null}
    ${bgOpen ? html`<${Modal} open=${true} title=${t('大厅背景')} micro="LOBBY BACKDROP" width="min(24rem, calc(100vw - 2rem))"
      onClose=${() => setBgOpen(false)}><${BackdropSettings} bg=${bg} /><//>` : null}
    ${allyOpen ? html`<${AllySelect} onClose=${() => setAllyOpen(false)} code=${code} onCode=${(v) => setCode(normalizeCode(v))}
      codeOk=${codeOk} recent=${recent} online=${online} busy=${busy} difficulty=${difficulty}
      onCreate=${() => { setAllyOpen(false); setProtoOpen('coop'); }} onJoin=${() => join()} onSpectate=${spectate}
      onSearch=${() => setJoinOpen(true)} />` : null}
    ${protoOpen ? html`<${ProtocolSelect} card=${MODE_CARDS.find((c) => c.id === protoOpen) || MODE_CARDS[0]} roomMode=${protoOpen}
      difficulty=${protoOpen === 'ultimate' ? ULTIMATE_DIFFICULTY : difficulty}
      onDifficulty=${(d) => { if (protoOpen !== 'ultimate') pickDifficulty(d); }}
      onClose=${() => setProtoOpen(null)} online=${online} busy=${busy} testMode=${testMode} asTest=${asTest}
      onTestMode=${setAsTest} onCreate=${(asT) => create(asT)} />` : null}
    ${achOpen ? html`<${Modal} open=${true} title=${t('成就统计')} micro="ACHIEVEMENTS" width="min(30rem, calc(100vw - 2rem))"
      onClose=${() => setAchOpen(false)}><${AchievementPanel} me=${me} onClose=${() => setAchOpen(false)} /><//>` : null}
  </div>`;
}
