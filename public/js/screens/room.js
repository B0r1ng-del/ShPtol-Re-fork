// Room screen (同盟等待室): the mode's seat cards (4 in co-op, 6 in 终极模拟; avatar frame, name, ready state, AI badge,
// host crown), host controls (difficulty picker — 终极模拟 has none, add/remove AI and the 「AI 队友最后选择」 switch in
// co-op, start), invite code with copy code / copy link, ready toggle and leave.
//
// Start rule (server/lobby.js): room.start needs every *other* human connected and ready; the
// host's start counts as the host's ready. So 开始模拟 is enabled exactly then and sends room.start
// alone (no separate room.ready round trip that could leave the host "ready" after a failed start).
// Solo rooms show a single seat.
// Spectator seats (community report #26, a remake feature): a co-op room with spectators shows the 观战席 strip under
// the seats — names, offline marks, the host's ✕ (room.removeSpectator) — and a spectator's own view swaps the ready
// button for 观战中 and offers 入座 (room.join of the room) while a player seat is free.
// Plugins (DESIGN §32 P1a): the tag under the title — 「原版」 or 「插件 ×N」 — opens the 插件 panel (ui/pluginPanel.js:
// the host switches the room's plugins, everybody else reads them). With gameplay plugins (§32.6: a content set of its
// own — the tag reads 「非官方」 too) every seat shows whether its page has loaded and checked the room's content
// (seats[].content: 载入中 / 就绪 / 校验失败), 准备就绪 and 开始模拟 wait for it (the server refuses them before:
// CONTENT_NOT_READY), and a plugin mode the host chose shows beside the difficulty.
// Texts go through t() (docs/I18N.md).

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, DIFFICULTY_NAMES, DIFFICULTY_COLORS, MAX_SPECTATORS, HOST_CONFIG_DEFAULTS, HOST_ENEMY_MAX_STEPS, HOST_ENEMY_STEP_PCT, MOD_DEFAULTS, normalizeEnemyBuff, roomSeatCap } from '../../../shared/constants.js';
import { MOD_ROWS, MOD_RULE_ROWS, modsCount, rememberMods } from '../ui/mods.js';
import {
  html, Button, Icon, MicroLabel, PingPill, AvatarFrame, DifficultyTag, DifficultyIcon, Tooltip, confirmDialog, doctorNo, Modal, SwitchRow,
} from '../ui/components.js';
import { toast, toastError } from '../ui/toasts.js';
import { copyText } from '../ui/clipboard.js';
import { GuideButton } from '../ui/guide.js';
import { openStats } from './stats.js';
import { SettingsButton } from '../ui/settings.js';
import { LoadoutButton } from './loadout.js';
import { PluginTag, isModdedRoom } from '../ui/pluginTag.js';
import { hasScriptConsent, rememberScriptConsent } from '../content.js';
import { net } from '../net.js';
import { store, useStore, shallowEqual, emptyMatch, isSpectating } from '../store.js';
import { difficultyInfo } from './lobby.js';
import { t, tc, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * Seats padded to the room's capacity (ultimate 6, co-op 4, solo 1), each null or a seat record.
 * @param {any} room room.state payload
 * @returns {(null | {seat:number, playerId:any, name:string, isBot:boolean, ready:boolean, connected:boolean})[]}
 */
export function normalizeSeats(room) {
  const cap = roomSeatCap(room?.mode);
  const src = Array.isArray(room?.seats) ? room.seats : [];
  const out = [];
  for (let i = 0; i < cap; i++) {
    const s = src[i];
    out.push(s && typeof s === 'object' ? { ...s, seat: Number.isInteger(s.seat) ? s.seat : i } : null);
  }
  return out;
}

/**
 * Derived room facts for the local player.
 * @param {any} room
 * @param {any} myId
 */
export function roomFacts(room, myId) {
  const seats = normalizeSeats(room);
  const occupied = seats.filter(Boolean);
  const humans = occupied.filter((s) => !s.isBot);
  const mine = occupied.find((s) => s.playerId === myId) || null;
  const isHost = room?.hostId != null && room.hostId === myId;
  const others = humans.filter((s) => s.playerId !== myId);
  // The host never readies: starting the match is the host's ready (server rule), so the count
  // treats the host as ready — "已就绪 0/1" next to "准许进入模拟" would contradict itself.
  const isReady = (s) => !!s.ready || s.playerId === room?.hostId;
  const readyHumans = humans.filter(isReady).length;
  const othersReady = others.every((s) => s.ready && s.connected !== false);
  // a room with gameplay plugins (DESIGN §32.6): every player's page has loaded and checked its content (the host's too)
  const modded = isModdedRoom(room);
  const contentReady = !modded || humans.every((s) => s.content === 'ready');
  return {
    seats, occupied, humans, mine, isHost, readyHumans, isReady,
    emptySeats: seats.filter((s) => !s).length,
    canStart: isHost && othersReady && !!mine && contentReady && (!room?.content?.trusted || humans.every(s => room.content.trusted.consent[s.seat])),
    othersReady,
    modded,
    contentReady,
    myContent: modded ? (mine?.content || 'loading') : 'ready',
    // spectator seats (never players: not in `humans`, never counted for ready / start)
    spectators: Array.isArray(room?.spectators) ? room.spectators.filter((s) => s && typeof s === 'object') : [],
    spectating: isSpectating(room, myId),
  };
}

/**
 * 房主配置 (room.setHostConfig, room.state.hostConfig): the room options the host sets in the 准备房间, in the order the
 * panel shows them. `on` is the option's own default (HOST_CONFIG_DEFAULTS) when the server sends nothing.
 * `key` is the room.setHostConfig key, `label` the switch's text and `tip` its one-line explanation — both msgids
 * (N_: the table is built once, before a language can change; the panel calls t() where they are shown).
 * `solo` marks the rows a single-seat room may still set (HOST_CONFIG_SOLO_KEYS): they share nothing between players, so
 * 独立模拟 gets exactly those and nothing else.
 */
export const HOST_CONFIG_ROWS = Object.freeze([
  { key: 'sharedPool', label: N_('共享卡池'), tip: N_('全同盟共用一个干员池'), on: true, solo: false },
  { key: 'sharedBounty', label: N_('共享悬赏'), tip: N_('全队共用一套悬赏决策牌，先选先得'), on: true, solo: false },
  { key: 'aiPicksLast', label: N_('AI 队友最后选择'), tip: N_('策略与机变轮选时，所有博士先于 AI 队友选择'), on: false, solo: false },
  { key: 'multiAlliance', label: N_('多同盟模式'), tip: N_('官方规则：每个策略只能由一位博士选择'), on: false, solo: false },
  { key: 'itemSell', label: N_('装备可售卖'), tip: N_('开启后装备可以出售，售价 1 块钱；关闭时装备只能销毁'), on: false, solo: true },
  // 在线聊天 (fork, 需求方 2026-10-16): the in-match chat window. `solo: true` since 2026-10-17 — the owner reported the
  // option was unusable (「在线聊天选项无法使用」), and the cause was that a single-seat room both hid this row and had the
  // lobby refuse the write (HOST_CONFIG_SOLO_KEYS). A solo host may turn the window on; it still carries the 交流 wheel.
  // ★ `on: true` since 2026-10-17 (需求方: 「其中的『在线聊天』改为默认开启」), matching HOST_CONFIG_DEFAULTS.onlineChat.
  { key: 'onlineChat', label: N_('在线聊天'), tip: N_('开启后局内显示可收起的聊天窗口，全房间的博士都能发言，「交流」表情按钮也会收入其中'), on: true, solo: true },
]);

/**
 * The 房主配置 panel of a room: one row per HOST_CONFIG_ROWS entry, `{ key, label, tip, on, editable }`, or null when
 * the panel does not apply. It shows in every 准备房间 — the host edits it, everybody else sees the same values
 * read-only (like the difficulty picker and 「AI 队友最后选择」). A single-seat room (独立模拟) has no teammates, so it
 * gets only the rows that share nothing between players (HOST_CONFIG_SOLO_KEYS, 装备可售卖); the server refuses the rest
 * there. No room at all ⇒ no panel.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {Array<{ key: string, label: string, tip: string, on: boolean, editable: boolean }> | null}
 */
export function hostConfigPanel(room, myId) {
  if (!room) return null;
  const cfg = room.hostConfig;
  const editable = room.hostId != null && room.hostId === myId;
  return HOST_CONFIG_ROWS.filter((r) => room.mode !== 'solo' || r.solo).map((r) => ({
    key: r.key,
    label: r.label,
    tip: r.tip,
    // 「AI 队友最后选择」 predates the panel and keeps its own room.state field; the rest live in hostConfig
    on: r.key === 'aiPicksLast' ? room.aiPicksLast === true : (cfg && typeof cfg[r.key] === 'boolean' ? cfg[r.key] : r.on),
    editable,
  }));
}

/**
 * The 房主配置 row of one option key, or null in a solo room (no teammates: the server refuses those options there).
 * 「AI 队友最后选择」 (GitHub #338) is one of them and reads its own pre-existing room.state field.
 * @param {any} room room.state payload @param {any} myId @param {string} key
 * @returns {{ key: string, label: string, tip: string, on: boolean, editable: boolean } | null}
 */
export function hostConfigOption(room, myId, key) {
  const rows = hostConfigPanel(room, myId);
  return rows ? rows.find((r) => r.key === key) || null : null;
}

/** Invite link for a room code (current page URL with ?room=CODE). */
export function inviteLink(code) {
  const loc = globalThis.location;
  const base = loc ? `${loc.origin}${loc.pathname}` : '';
  return `${base}?room=${encodeURIComponent(code)}`;
}

/**
 * Copy text to the clipboard (async API with a textarea fallback for insecure contexts). Moved to ui/clipboard.js so
 * 干员调配 can use it without importing this screen (which imports loadout.js): re-exported here for existing callers.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export { copyText };

function SeatCard({ seat, index, room, facts, myId, busy, onAddBot, onRemoveBot, onKick }) {
  const coop = room.mode !== 'solo';
  if (!seat) {
    const canAdd = coop && facts.isHost;
    return html`<article class="seat seat--empty" style=${`--seat-i:${index}`}>
      <header class="seat__head"><span class="seat__no num">P${index + 1}</span><${MicroLabel}>SEAT ${String(index + 1).padStart(2, '0')}<//></header>
      <div class="seat__art seat__art--empty">
        <div class="seat__radar" aria-hidden="true"></div>
        <span class="seat__wait">${t('等待博士加入')}</span>
        <${MicroLabel}>AWAITING DOCTOR<//>
      </div>
      <footer class="seat__foot">
        ${canAdd
          ? html`<${Button} variant="secondary" size="sm" icon="robot" block=${true} loading=${busy === `add`} onClick=${onAddBot}>${t('添加 AI 队友')}<//>`
          : html`<span class="seat__state t-dim">${t('空位')}</span>`}
      </footer>
    </article>`;
  }
  const consent = room.content?.trusted?.consent?.[seat.seat];
  const isMe = seat.playerId === myId;
  const isHostSeat = seat.playerId === room.hostId;
  const offline = seat.connected === false && !seat.isBot;
  // The host never needs to toggle ready: starting the match readies them (server rule).
  const state = offline ? 'offline' : seat.ready || seat.isBot ? 'ready' : isHostSeat ? 'host' : 'waiting';
  return html`<article class=${`seat brackets${isMe ? ' is-me' : ''}${isHostSeat ? ' is-host' : ''}${seat.isBot ? ' is-bot' : ''} is-${state}`}
      style=${`--seat-i:${index}`}>
    ${consent ? html`<span data-testid="script-consented">${t('已同意')}</span>` : null}
    <header class="seat__head">
      <span class="seat__no num">P${index + 1}</span>
      <${MicroLabel}>SEAT ${String(index + 1).padStart(2, '0')}<//>
      ${isHostSeat ? html`<span class="seat__host"><${Icon} name="crown" />${t('创建者')}</span>` : null}
    </header>
    <div class="seat__art">
      <div class="seat__stripes" aria-hidden="true"></div>
      <${AvatarFrame} size="xl" name=${seat.name} seat=${index} bot=${seat.isBot} self=${isMe} ready=${state === 'ready'} offline=${offline} />
      ${seat.isBot ? html`<span class="seat__bot-label"><${Icon} name="robot" />${t('AI 队友')}</span>` : null}
    </div>
    <div class="seat__who">
      <span class="seat__name">${seat.name || t('博士')}</span>
      ${isMe ? html`<span class="seat__you">${t('你')}</span>` : null}
    </div>
    <${MicroLabel}>${seat.isBot ? 'AUTONOMOUS UNIT' : `DOCTOR #${doctorNo(seat.playerId)}`}<//>
    ${facts.modded && !seat.isBot ? html`<span class=${`seat__content is-${seat.content || 'loading'}`} data-testid="seat-content">
      ${seat.content === 'ready' ? t('插件内容就绪') : seat.content === 'failed' ? t('插件内容校验失败') : t('插件内容载入中')}
    </span>` : null}
    <footer class="seat__foot">
      <span class=${`seat__state seat__state--${state}`}>
        ${state === 'ready' ? html`<${Icon} name="check" />${t('已就绪')}`
          : state === 'offline' ? html`<${Icon} name="wifiOff" />${t('连接中断')}`
          : state === 'host' ? html`<${Icon} name="crown" />${t('待命中')}`
          : html`<${Icon} name="hourglass" />${t('准备中')}`}
      </span>
      ${seat.isBot && facts.isHost ? html`<${Tooltip} text=${t('移除该 AI 队友')}>
        <${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rm${index}`} onClick=${() => onRemoveBot(index)} aria-label=${t('移除 AI 队友')} />
      <//>` : null}
      ${!seat.isBot && !isMe && facts.isHost ? html`<${Tooltip} text=${t('将该博士移出同盟')}>
        <${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `kick${index}`} onClick=${() => onKick(index, seat.name, seat.playerId)} aria-label=${t('移出该博士')} />
      <//>` : null}
    </footer>
  </article>`;
}

/** 观战席: the room's spectators (host: ✕ frees a seat), and 入座 for a spectator while a player seat is free. */
function SpectatorBar({ facts, myId, busy, onRemove, onSit }) {
  if (!facts.spectators.length) return null;
  return html`<section class="specbar" aria-label=${t('观战席')}>
    <span class="specbar__label"><${Icon} name="eye" />${t('观战席')}<b class="num">${facts.spectators.length}</b><span class="num t-dim">/${MAX_SPECTATORS}</span></span>
    ${facts.spectators.map((s) => html`<span key=${s.playerId} class=${`specbar__who${s.playerId === myId ? ' is-me' : ''}${s.connected === false ? ' is-offline' : ''}`}>
      ${s.connected === false ? html`<${Icon} name="wifiOff" />` : null}${s.name || t('博士')}${s.playerId === myId ? html`<span class="seat__you">${t('你')}</span>` : null}
      ${facts.isHost ? html`<${Button} variant="ghost" size="sm" square=${true} icon="close" loading=${busy === `rs${s.playerId}`}
        onClick=${() => onRemove(s.playerId)} aria-label=${t('移出观战者 {name}', { name: s.name || '' })} title=${t('移出该观战者')} />` : null}
    </span>`)}
    ${facts.spectating && facts.emptySeats > 0 ? html`<${Button} size="sm" icon="user" loading=${busy === 'sit'} onClick=${onSit}>${t('入座')}<//>` : null}
  </section>`;
}

function InviteBox({ code, name, difficulty }) {
  const copy = async (what) => {
    // the copied link carries an invitation line (#103): 「{name}邀请你加入卫戍协议：盟约【{difficulty}】」
    const invite = t('{name}邀请你加入卫戍协议：盟约【{difficulty}】', { name: name ?? '', difficulty: DIFFICULTY_NAMES[difficulty] ? t(DIFFICULTY_NAMES[difficulty]) : '' });
    const ok = await copyText(what === 'code' ? code : `${inviteLink(code)} ${invite}`);
    if (ok) toast(what === 'code' ? t('已复制同盟密钥 {code}', { code }) : t('已复制邀请链接'), 'success');
    else toast(t('复制失败，请手动复制'), 'warn');
  };
  return html`<div class="invite brackets">
    <div class="invite__label"><${Icon} name="key" /><span>${t('同盟密钥')}</span><${MicroLabel}>ALLIANCE KEY<//></div>
    <div class="invite__code num selectable" aria-label=${t('同盟密钥 {code}', { code })}>${[...String(code)].map((ch, i) => html`<span key=${i}>${ch}</span>`)}</div>
    <div class="invite__btns">
      <${Button} size="sm" icon="copy" onClick=${() => copy('code')}>${t('复制密钥')}<//>
      <${Button} size="sm" icon="link" onClick=${() => copy('link')}>${t('复制链接')}<//>
    </div>
  </div>`;
}

function DifficultyPicker({ room, isHost, busy, onPick }) {
  // 扩展模拟 has a single difficulty (AC-4): no radiogroup, just the mode's own tag
  if (room.mode === 'ultimate') {
    return html`<div class="dpick dpick--ro">
      <${DifficultyTag} difficulty=${room.difficulty} size="lg" code=${difficultyInfo(room.mode, room.difficulty).code} />
      <span class="t-dim">${t('扩展模拟固定难度')}</span>
    </div>`;
  }
  if (!isHost) {
    return html`<div class="dpick dpick--ro">
      <${DifficultyTag} difficulty=${room.difficulty} size="lg" code=${difficultyInfo(room.mode, room.difficulty).code} />
      <span class="t-dim">${t('由创建者选择')}</span>
    </div>`;
  }
  return html`<div class="dpick" role="radiogroup" aria-label=${t('模拟难度')}>
    ${DIFFICULTIES.map((d) => html`<button key=${d} type="button" role="radio" aria-checked=${room.difficulty === d ? 'true' : 'false'}
        class=${`dpick__opt${room.difficulty === d ? ' is-active' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[d]}`}
        disabled=${!!busy} onClick=${() => room.difficulty !== d && onPick(d)}>
      <${DifficultyIcon} difficulty=${d} />${t(DIFFICULTY_NAMES[d].replace('模拟', ''))}
    </button>`)}
  </div>`;
}

/**
 * 房主配置「对局选项」— the four enemy buffs of a room (room.setEnemyBuff, HOST_ENEMY_KEYS), in the order the panel shows
 * them. Each row is one slider: `key` the message's key, `label` its text, `icon` the glyph before it and `tip` the
 * explanation behind the ⓘ. Every mode shows all four — a buff on one's own enemies shares nothing with teammates, so
 * there is no solo restriction (需求方 2026-10-15: 「确保该功能在所有模式中均通用」).
 *
 * A slider's value is an integer count of 10 % steps (HOST_ENEMY_MAX_STEPS = 10, i.e. +100 %); 0 is the official numbers.
 */
export const HOST_ENEMY_ROWS = Object.freeze([
  { key: 'enemyHp', label: N_('怪物血量'), icon: 'shield', tip: N_('每格 +10%，最高 +100%：本局全部敌人（含首领与联防）的最大生命值按此提高') },
  { key: 'enemyAtk', label: N_('怪物攻击'), icon: 'sword', tip: N_('每格 +10%，最高 +100%：本局全部敌人（含首领与联防）的攻击力按此提高') },
  { key: 'enemyDef', label: N_('怪物防御'), icon: 'shield', tip: N_('每格 +10%，最高 +100%：本局全部敌人（含首领与联防）的防御力按此提高') },
  { key: 'enemyRes', label: N_('怪物魔抗'), icon: 'shield', tip: N_('每格 +10%，最高 +100%：本局全部敌人（含首领与联防）的法术抗性按此提高') },
]);

/**
 * The 对局选项 rows of a room: `{ key, label, icon, tip, steps, editable }`, or null when there is no room. Everybody
 * sees the same values (they describe the enemies the whole room fights); only the host may move a slider.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {Array<{ key: string, label: string, icon: string, tip: string, steps: number, editable: boolean }> | null}
 */
export function enemyBuffPanel(room, myId) {
  if (!room) return null;
  const cfg = normalizeEnemyBuff(room.enemyBuff);
  const editable = room.hostId != null && room.hostId === myId;
  return HOST_ENEMY_ROWS.map((r) => ({ ...r, steps: cfg[r.key], editable }));
}

/** The total the room has reached, as a percentage of buff across all four sliders (the warning line's number). */
export const enemyBuffTotal = (rows) => (rows || []).reduce((n, r) => n + r.steps, 0) * HOST_ENEMY_STEP_PCT;

/**
 * 房主配置 — the host's room options in a dialog (the 干员调配 button's pattern: a button in the ready bar opens it).
 * One <SwitchRow/> per option (图二, 2026-10-13): the name on the left, the pill switch on the right, and the option's
 * own explanation behind the ⓘ after the name (hover on a desktop, long press on a phone). The host toggles them;
 * everybody else sees the same state read-only (the switches render disabled), with a dim 「由创建者设置」 in the header
 * saying who owns them. Nothing is rendered in a single-seat room (null rows).
 *
 * 「对局选项」 sits under the switches: the four enemy-buff sliders (需求方 2026-10-15) and — since 2026-10-16 (owner) —
 * the five game-rule Mod switches (关闭盟约禁用 … 解除叠层上限), which moved here out of the 模式界面's Mod submenu. Same
 * editability rule — the host moves them, everybody else reads them. The 内容包 switches did NOT come along: they have
 * their own 「Mod 菜单」 dialog on the lobby screen (screens/mods.js), so this dialog has two sections, not three.
 */
function HostConfigDialog({ rows, enemyRows, modRows, open, busy, onClose, onToggle, onEnemy, onMod }) {
  if (!rows || !rows.length) return null;
  const editable = rows.some((r) => r.editable);
  return html`<${Modal} open=${open} onClose=${onClose} tone="mint" width="min(9rem, 96vw)"
      title=${t('房间配置')} micro="HOST CONFIG"
      actions=${html`<${Button} variant="secondary" onClick=${onClose}>${t('完成')}<//>`}>
    <div class="hostcfg">
      ${editable ? null : html`<p class="hostcfg__note">${t('由创建者设置：只有房主可以修改这些选项。')}</p>`}
      ${/* 需求方 2026-10-17 (图三): the 「对局选项」 block moved to the TOP of the dialog — its header and note are what the
           owner pointed at with the upper line, while the switch rows keep their own order below it. */
        (enemyRows && enemyRows.length) || (modRows && modRows.length)
        ? html`<${MatchOptionSection} rows=${modRows} enemyRows=${enemyRows} busy=${busy} onMod=${onMod} onEnemy=${onEnemy} />`
        : null}
      <div class="hostcfg__rows">
        ${rows.map((r) => html`<${SwitchRow} key=${r.key}
          label=${t(r.label)} tip=${t(r.tip)} on=${r.on}
          disabled=${!r.editable || !!busy}
          testid=${`hostcfg-${r.key}`} infoTestid=${`hostcfg-info-${r.key}`}
          onChange=${(v) => r.editable && onToggle(r.key, v)} />`)}
      </div>
    </div>
  <//>`;
}

/**
 * 对局选项 — everything that changes THIS match's rules: the five game-rule Mod switches on top, then the four
 * enemy-buff sliders under them (需求方 2026-10-15: 「对局选项」 was the sliders' own heading, and 2026-10-16 the owner
 * moved the rule switches in under the same heading). Both halves keep their own data and their own message
 * (room.setMods / room.setEnemyBuff); this component only draws them together, so neither needed changing.
 */
function MatchOptionSection({ rows, enemyRows, busy, onMod, onEnemy }) {
  const switchRows = rows || [];
  const editable = switchRows.some((r) => r.editable);
  const total = enemyBuffTotal(enemyRows);
  const tipOf = (r) => t(r.tip);
  return html`<div class="ebuff">
    <div class="ebuff__head">
      <span class="ebuff__title"><${Icon} name="sliders" />${t('对局选项')}</span>
      <${MicroLabel}>MATCH OPTIONS<//>
    </div>
    ${switchRows.length ? html`<div class="mods mods--hostcfg">
      <p class="mods__note">${t('以下规则默认全部关闭（原版规则）；开启后会改变本局的玩法，对其他玩家同样生效。')}</p>
      <div class="mods__rows">
        <div class="mods__col" data-col="rule">
          ${switchRows.map((r) => html`<${SwitchRow} key=${r.key}
            label=${t(r.label)} tip=${tipOf(r)} on=${r.on}
            disabled=${!editable || !!busy}
            testid=${`hostcfg-mod-${r.key}`} infoTestid=${`hostcfg-mod-info-${r.key}`}
            onChange=${(v) => editable && onMod(r.key, v)} />`)}
        </div>
      </div>
    </div>` : null}
    ${enemyRows && enemyRows.length ? html`<div class="ebuff__rows">
      ${enemyRows.map((r) => html`<label class="set-row ebuff__row" key=${r.key}>
        <span class="set-row__label"><${Icon} name=${r.icon} />${t(r.label)}</span>
        <input class="set-range" type="range" min="0" max=${HOST_ENEMY_MAX_STEPS} step="1"
          value=${r.steps} style=${`--pct:${(r.steps / HOST_ENEMY_MAX_STEPS) * 100}%`}
          disabled=${!r.editable}
          data-testid=${`ebuff-${r.key}`} aria-label=${t(r.label)}
          onInput=${(e) => r.editable && onEnemy(r.key, Number(e.currentTarget.value))} />
        <span class="set-row__val num">+${r.steps * HOST_ENEMY_STEP_PCT}%</span>
      </label>`)}
    </div>` : null}
    ${enemyRows && enemyRows.length ? html`<p class="ebuff__hint">${t('每格 +10%，最高 +100% · 加强本局全部敌人（含首领与联防）')}</p>` : null}
    ${total > 0 ? html`<p class="ebuff__warn">${t('本局敌人已获得强化（合计 {n}%），请谨慎调整', { n: total })}</p>` : null}
  </div>`;
}

/**
 * The panel's Mod-开关 rows: one per MOD_ROWS entry, `{ key, col, label, tip, on, editable }`. Shown in EVERY mode — a
 * Mod 开关 changes the host's own match, so 独立模拟 gets them too (unlike the 共享 房主配置 options, which need
 * somebody to share with). No room at all ⇒ null.
 *
 * 2026-10-16 (owner): `modRows` is now only the 对局选项 half (MOD_RULE_ROWS) — the 内容包 switches left for the lobby's
 * 「Mod 菜单」 dialog (screens/mods.js), which reads the room's own state. `modPanel` still returns every MOD_ROWS entry
 * (it is the fork's record of what the switches ARE, and the pack switches are still room state); the caller filters.
 * @param {any} room room.state payload @param {any} myId
 * @returns {Array<{ key: string, col: string, label: string, tip: string, on: boolean, editable: boolean }> | null}
 */
export function modPanel(room, myId) {
  if (!room) return null;
  const mods = room.mods;
  const editable = room.hostId != null && room.hostId === myId;
  return MOD_ROWS.map((r) => ({
    key: r.key,
    col: r.col,
    label: r.label,
    tip: r.tip,
    // the server sends every MOD_KEYS key (room.state.mods); a missing payload is the official all-off
    on: mods && typeof mods[r.key] === 'boolean' ? mods[r.key] : MOD_DEFAULTS[r.key],
    editable,
  }));
}

/** The ready bar's 房主配置 button (the 干员调配 button's shape), showing how many options differ from their default. */
function HostConfigButton({ rows, enemyRows, modRows, busy, onClick }) {
  if (!rows || !rows.length) return null;
  // the switch rows that left their default, every enemy slider that is not at 0, and every Mod 开关 that is on
  const n = rows.filter((r) => r.on !== HOST_CONFIG_DEFAULTS[r.key]).length
    + (enemyRows || []).filter((r) => r.steps !== 0).length
    + modsCount(Object.fromEntries((modRows || []).map((r) => [r.key, r.on])));
  return html`<button type="button" class=${cx('btn', 'btn--secondary', 'btn--lg', 'hostcfg-entry')} data-testid="hostcfg-open"
      disabled=${!!busy} onClick=${onClick} title=${t('房间配置 · 只有房主可以修改')}>
    <${Icon} name="crown" class="btn__icon" />
    <span class="btn__label">${t('房间配置')}</span>
    ${n ? html`<span class="lo-entry__n num" aria-label=${t('{n} 项已调整', { n })}>${n}</span>` : null}
  </button>`;
}

/** Room screen component. */
export function RoomScreen() {
  const room = useStore((s) => s.room);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  const [busy, setBusy] = useState(null);
  // 房主配置 opens as a dialog over the room (the 干员调配 button's pattern), not as a band under the seats
  const [cfgOpen, setCfgOpen] = useState(false);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  if (!room) return null;
  const online = conn.status === 'online';
  const coop = room.mode !== 'solo';
  const ultimate = room.mode === 'ultimate';
  const facts = roomFacts(room, me.playerId);
  const myReady = !!facts.mine?.ready;
  const info = difficultyInfo(room.mode, room.difficulty);
  // 房主配置 (null in a single-seat room: nothing to share with, so neither the button nor the dialog renders)
  const cfgRows = hostConfigPanel(room, me.playerId);
  // 对局选项 (room.setEnemyBuff): the four enemy-buff sliders, shown in EVERY mode (no solo gate — a buff on one's own
  // enemies shares nothing with teammates). Same rows for everybody; only the host may move them.
  const enemyRows = enemyBuffPanel(room, me.playerId);
  // Mod 开关 (room.setMods): the fork's gameplay switches, shown in EVERY mode (they change this room's own match, so
  // 独立模拟 gets them too). Same rows for everybody; only the host may flip them.
  // 2026-10-16 (owner): only the 对局选项 half (MOD_RULE_ROWS) is in this dialog now — the 内容包 switches moved to the
  // lobby's 「Mod 菜单」 dialog (screens/mods.js). The badge count follows the same split, so the two buttons never both
  // claim the same switch.
  const modRows = (modPanel(room, me.playerId) || []).filter((r) => MOD_RULE_ROWS.some((k) => k.key === r.key));

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const toggleReady = () => run('ready', () => net.request('room.ready', { ready: !myReady }));
  const start = () => run('start', () => net.request('room.start', {}));
  const addBot = () => run('add', () => net.request('room.addBot', {}));
  const removeBot = (seat) => run(`rm${seat}`, () => net.request('room.removeBot', { seat }));
  // the host removes a human before the match (community report #17): asked first; the player may join again. The
  // confirmed player's id goes along: if they left and someone else took the seat meanwhile, the server refuses it.
  const kick = async (seat, name, playerId) => {
    if (inFlight.current) return;
    const ok = await confirmDialog({ title: t('移出同盟'), text: t('确定将「{name}」移出同盟吗？对方可以凭同盟密钥重新加入。', { name: name || t('博士') }), okText: t('移出'), danger: true });
    if (ok) run(`kick${seat}`, () => net.request('room.kick', { seat, playerId }));
  };
  const setDifficulty = (difficulty) => run('diff', () => net.request('room.setDifficulty', { difficulty }));
  // 房主配置 (room.setHostConfig): one option at a time, the key naming which (shared/constants.js HOST_CONFIG_KEYS).
  // 「AI 队友最后选择」 is one of the four rows and goes through the same message; room.setAiPicksLast (GitHub #338) stays
  // valid on the server for older clients.
  const setHostConfig = (key, on) => run(`hcfg${key}`, () => net.request('room.setHostConfig', { key, on }));
  // 对局选项 (room.setEnemyBuff): one slider at a time, `steps` the 10 % step count the slider now sits at.
  //
  // NOT through `run()`: a slider is a CONTINUOUS control (a drag emits an input event per step) and `run()` is built for
  // one-shot buttons — its `inFlight` guard would drop every step after the first and its `busy` state would disable all
  // four sliders (and every switch row) for the length of each round trip. The message is idempotent and the server keeps
  // last-write-wins, so firing each step and letting the state broadcast settle the UI is both correct and what a slider
  // is expected to do; a failure still surfaces as a toast.
  const setEnemyBuff = (key, steps) => {
    if (!online) { toast(t('连接中断，请稍候重试'), 'warn'); return; }
    net.request('room.setEnemyBuff', { key, steps }).catch(toastError);
  };
  // Mod 开关 (room.setMods): one switch at a time, the key naming which (shared/constants.js MOD_KEYS). The switches are
  // room options now, so this mirrors setHostConfig; the local preference is written too, so the next room this device
  // creates starts from the switches its host last used.
  const setMods = (key, on) => {
    rememberMods({ ...room.mods, [key]: on });
    return run(`mod${key}`, () => net.request('room.setMods', { key, on }));
  };
  // spectator seats: the host frees one; a spectator takes a free player seat with room.join of this room
  const removeSpectator = (playerId) => run(`rs${playerId}`, () => net.request('room.removeSpectator', { playerId }));
  const sit = () => run('sit', () => net.request('room.join', { code: room.code }));
  const leave = async () => {
    if (inFlight.current) return;
    const othersHere = facts.humans.some((s) => s.playerId !== me.playerId);
    if (facts.isHost && othersHere) {
      const ok = await confirmDialog({ title: t('离开同盟'), text: t('你是同盟的创建者，离开后创建者身份将移交或同盟解散。确定离开吗？'), okText: t('离开'), danger: true });
      if (!ok) return;
    }
    inFlight.current = true;
    setBusy('leave');
    try {
      await net.request('room.leave', {});
    } catch (err) {
      if (err?.code !== 'NOT_IN_ROOM') toastError(err);
    } finally {
      // Leaving locally is always safe: the server either confirmed or no longer has us in the room.
      store.set({ room: null, match: emptyMatch() });
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };

  const statusLine = !online
    ? html`<span class="t-orange"><${Icon} name="wifiOff" />${t('连接中断，正在重连…')}</span>`
    : facts.spectating
      ? html`<span class="t-lo"><${Icon} name="eye" />${t('观战中 · 不占博士席位，模拟开始后可切换观看各位博士')}</span>`
    : !coop
      ? html`<span class="t-mint">${t('*模拟协议已就绪，准许进入模拟')}</span>`
    : facts.modded && !facts.contentReady
      ? html`<span class="t-lo">${t('等待所有博士载入房间的插件内容')}</span>`
    : facts.isHost
      ? facts.canStart
        ? html`<span class="t-mint">${t('*同盟人数达标，准许进入模拟')}</span>`
        : html`<span class="t-lo">${t('等待所有博士准备就绪')}</span>`
      : myReady
        ? html`<span class="t-mint">${t('已就绪 · 等待创建者开始模拟')}</span>`
        : html`<span class="t-lo">${t('准备就绪后，创建者即可开始模拟')}</span>`;

  return html`<div class="screen room-screen">
    <header class="topbar">
      <div class="topbar__left">
        <${Tooltip} text=${t('离开同盟')} placement="bottom">
          <${Button} variant="danger" size="lg" square=${true} icon="exit" loading=${busy === 'leave'} onClick=${leave} aria-label=${t('离开同盟')} />
        <//>
        <div class="room-ping">
          <${PingPill} ms=${conn.ping} online=${online} />
          <${MicroLabel}>${t('当前延迟')}<//>
        </div>
        <${Button} variant="secondary" size="sm" icon="chart" class="stats-entry" onClick=${openStats} title=${t('统计数据')} aria-label=${t('统计数据')}>${t('统计')}<//>
        <${SettingsButton} class="room-settings" variant="secondary" label=${t('设置')} />
        <${GuideButton} class="room-guide" variant="secondary" label=${t('玩法说明')} />
      </div>
      <div class="topbar__center">
        <${MicroLabel} tone="mint">${ultimate ? 'EXTENDED LOBBY' : coop ? 'ALLIANCE LOBBY' : 'SOLO SIMULATION'}<//>
        <h1 class="topbar__title">${/* 扩展模拟 (需求方 2026-10-17): the title is the mode's own name, plain white — the red
              difficulty tag is dropped there (its single difficulty is fixed, AC-4, and the mode's name says it). */
            ultimate ? t('扩展模拟') : html`${coop ? t('同盟模拟') : t('独立模拟')}<span class="topbar__sep"></span><${DifficultyTag} difficulty=${room.difficulty} size="lg" />`}
          ${room.content?.modeId ? html`<span class="room-mode" data-testid="room-mode">${(room.content.modes || []).find((m) => m.id === room.content.modeId)?.name || room.content.modeId}</span>` : null}</h1>
        <${PluginTag} room=${room} myId=${me.playerId} />
      </div>
      <div class="topbar__right">
        ${coop ? html`<${InviteBox} code=${room.code} name=${me.name} difficulty=${room.difficulty} />` : html`<div class="solo-note"><${MicroLabel}>SINGLE OPERATOR<//><span>${t('仅限 1 名博士')}</span></div>`}
      </div>
    </header>

    <main class=${`seats${coop ? '' : ' seats--solo'}${room.mode === 'ultimate' ? ' seats--ultimate' : ''}`}>
      ${facts.seats.map((s, i) => html`<${SeatCard} key=${s ? `p${s.playerId}` : `e${i}`} seat=${s} index=${i} room=${room} facts=${facts}
        myId=${me.playerId} busy=${busy} onAddBot=${addBot} onRemoveBot=${removeBot} onKick=${kick} />`)}
      ${coop ? null : html`<aside class="solo-brief brackets">
        <${MicroLabel} tone="mint">BRIEFING<//>
        <h2>${DIFFICULTY_NAMES[room.difficulty] ? t(DIFFICULTY_NAMES[room.difficulty]) : ''}<span class="num t-dim"> ${info.code}</span></h2>
        <p>${info.desc}</p>
        <ul>
          ${info.effects.map((e) => html`<li key=${e}>${e}</li>`)}
          <li>${t('共')} <b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t('，满足条件时进入隐秘核心') : ''}</li>
          <li>${t('独立模拟中休整期与机变阶段不限时')}</li>
        </ul>
      </aside>`}
    </main>
    <${SpectatorBar} facts=${facts} myId=${me.playerId} busy=${busy} onRemove=${removeSpectator} onSit=${sit} />

    <footer class="room-bar">
      <div class="room-bar__left">
        <span class="room-bar__label">${t('模拟难度')}<${MicroLabel}>DIFFICULTY<//></span>
        <div class="room-bar__opts">
          <${DifficultyPicker} room=${room} isHost=${facts.isHost} busy=${busy} onPick=${setDifficulty} />
        </div>
      </div>
      <div class="room-bar__center">
        <div class="ready-count" hidden=${!coop}>
          <span class="t-lo">${t('已就绪')}</span>
          <b class="num">${facts.readyHumans}</b><span class="num t-dim">/${facts.humans.length}</span>
          <span class="ready-count__icons" aria-hidden="true">
            ${facts.humans.map((s) => html`<${Icon} key=${s.playerId} name="user" class=${facts.isReady(s) ? 'is-on' : ''} />`)}
          </span>
        </div>
        <div class="room-bar__status">${statusLine}</div>
      </div>
      <div class="room-bar__right">
        <${HostConfigButton} rows=${cfgRows} enemyRows=${enemyRows} modRows=${modRows} busy=${busy} onClick=${() => setCfgOpen(true)} />
        <${LoadoutButton} from="room" size="lg" class="room-loadout" label=${t('干员调配')} />
        ${facts.isHost
          ? html`<${Tooltip} text=${facts.canStart ? null : !facts.contentReady ? t('仍有博士未载入房间的插件内容') : t('仍有博士未准备就绪')}>
              <${Button} variant="primary" size="xl" icon="play" loading=${busy === 'start'} disabled=${!facts.canStart || !online} onClick=${start}>${t('开始模拟')}<//>
            <//>`
          : facts.spectating
            ? html`<${Button} variant="secondary" size="xl" icon="eye" disabled=${true}>${t('观战中')}<//>`
          : html`<${Tooltip} text=${!myReady && facts.myContent !== 'ready' ? t('房间的插件内容载入并通过校验后才能准备') : null}>
              <${Button} variant=${myReady ? 'primary' : 'secondary'} size="xl" icon=${myReady ? 'check' : 'hourglass'} active=${myReady}
              loading=${busy === 'ready'} disabled=${!online || !facts.mine || (!myReady && facts.myContent !== 'ready')} onClick=${toggleReady}>${myReady ? t('已就绪') : t('准备就绪')}<//>
            <//>`}
      </div>
    </footer>
    <${HostConfigDialog} rows=${cfgRows} enemyRows=${enemyRows} modRows=${modRows} open=${cfgOpen} busy=${busy} onClose=${() => setCfgOpen(false)} onToggle=${setHostConfig} onEnemy=${setEnemyBuff} onMod=${setMods} />
  </div>`;
}

/** Persistent across room/game routes, including spectators who never consent. */
export function TrustedNotice() {
  const state = useStore(s => s);
  const room = state.room, cs = room?.content?.cs, trusted = room?.content?.trusted;
  const seat = room?.seats?.find(s => s && s.playerId === state.me?.playerId);
  const [dismissed,setDismissed] = useState(null);
  const [busy,setBusy] = useState(false);
  const [review,setReview] = useState(false);
  const choose = async accept => {
    setBusy(true);
    try {
      if (seat) await net.request('room.consent',{cs,accept});
      rememberScriptConsent(cs,accept);
      setDismissed(cs); setReview(false);
      if (accept && trusted.plugins.some(p => p.permissions.includes('trusted.page'))) {
        const url = new URL(location.href); url.searchParams.set('cs',cs); url.searchParams.set('room',room.code);
        location.assign(url.href); return;
      }
      store.set({room:{...store.get().room}}); // wake the content loader after local persistence
    } catch (e) { toastError(e); }
    finally { setBusy(false); }
  };
  useEffect(() => {
    if (trusted && seat && hasScriptConsent(cs) && !trusted.consent?.[seat.seat] && !room.inMatch) {
      net.request('room.consent',{cs,accept:true}).catch(toastError);
    }
  },[cs,seat?.seat,!!trusted?.consent?.[seat?.seat]]);
  if (!trusted) return null;
  return html`<aside class="trusted-banner" data-testid="trusted-banner">
    <strong>${t('受信任插件')}</strong>
    <button onClick=${() => setReview(true)}>${t('查看风险与同意状态')}</button>
    <${Modal} open=${review || (dismissed !== cs && !hasScriptConsent(cs))} title=${t('受信任插件')} tone="red" closeOnBackdrop=${false}
      onClose=${() => room.inMatch ? setReview(false) : choose(false)} actions=${html`<${Button} disabled=${busy} onClick=${() => choose(false)} data-testid="script-decline">${t('拒绝')}<//>
        <${Button} disabled=${busy} onClick=${() => choose(true)} data-testid="script-accept">${t('同意运行')}<//>`}>
      <p>${t('它可以完全控制你的游戏页面')}</p>
      <p>${t('仅在你信任所有作者及以下代码时同意。换了内容组合需要重新同意。')}</p>
      <ul>${trusted.plugins.map(p => html`<li key=${p.id}><strong>${p.id} ${p.version}</strong>
        <p>${t('作者：{authors}',{authors:(p.authors || []).join(', ') || '—'})}</p>
        <p class="trusted-hash">SHA-256: ${p.hash}</p><p>${t('权限：{permissions}',{permissions:p.permissions.join(', ')})}</p></li>`)}</ul>
    <//>
  </aside>`;
}
