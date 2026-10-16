// 在线聊天 (fork) — the in-match chat window, and the home of the 交流 emote button while it is on.
//
// WHAT THIS IS
// The room option `onlineChat` (shared/constants.js HOST_CONFIG_KEYS, room.setHostConfig) turns on a floating window in
// the corner of a match. It shows the room's chat (`m.chat`, one line per `g.chat`) with each speaker's name and avatar,
// folds in the 交流 emote button (the wheel renders INSIDE the window instead of the HUD corner), and collapses down to
// its title bar so it covers almost nothing while a battle runs. With the option off nothing here renders and the wheel
// stays exactly where it was.
//
// WHY THE WHEEL MOVES IN
// The owner asked for it (2026-10-16): 交流 belongs to the same "talk to the room" surface as chat, so the option owns
// both. `EmoteWheel` is used unchanged — same button, same panel, same cooldown — it is only re-parented into the
// window's body, so nothing about sending an emote differs.
//
// NAMES AND AVATARS
// A chat line carries only `playerId`; the name and seat come from `room.state.seats` (store `s.room.seats`, which stays
// populated during a match), the same source the ready room and the team panel use. A spectator has no seat, so the line
// falls back to 观战者 — the window never guesses a name it does not have.

import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { html, Icon, AvatarFrame, MicroLabel } from './components.js';
import { GIcon } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';
import { CHAT_MAX_LEN } from '../../../shared/constants.js';

/** The seat whose `playerId` this is (store `room.seats`, `spectators`), or null when the room does not list them. */
export function speaker(room, playerId, myId) {
  const seats = Array.isArray(room?.seats) ? room.seats : [];
  const seat = seats.find((s) => s && s.playerId === playerId);
  if (seat) return { name: seat.name || t('博士'), seat: seat.seat | 0, isBot: !!seat.isBot, self: playerId === myId };
  if (Array.isArray(room?.spectators) && room.spectators.some((s) => s && s.playerId === playerId)) {
    return { name: t('观战者'), seat: 0, isBot: false, self: playerId === myId };
  }
  return { name: t('博士'), seat: 0, isBot: false, self: playerId === myId };
}

/** The moment a line was sent, as a short HH:MM stamp (the viewer's own clock — the window is not a log). */
export function stamp(at) {
  const d = new Date(at);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * The floating 在线聊天 window.
 *
 * @param {{ lines: Array<{seq:number, playerId:string, text:string, at:number}>, room: any, myId: string|null,
 *   open: boolean, onToggle: (open:boolean)=>void, onSend: (text:string)=>void, emote?: any, disabled?: boolean }} props
 *   `emote` is the rendered `<EmoteWheel/>` vnode, re-parented into the window's body (null ⇒ no wheel, e.g. spectating).
 */
export function ChatWindow({ lines, room, myId, open, onToggle, onSend, emote = null, disabled = false }) {
  const [text, setText] = useState('');
  const logRef = useRef(null);
  const list = Array.isArray(lines) ? lines : [];

  // follow the newest line (the log scrolls; the panel is short, so a new line must bring itself into view)
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [list.length, open]);

  // Esc closes the body the same way the 收起 button does (the window is not a modal: it never traps focus)
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement;
      // a draft in the box is what Esc should drop first, like every other input on this screen
      if (el instanceof HTMLInputElement && el.value) { setText(''); return; }
      onToggle(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const submit = (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || disabled) return;
    onSend(body);
    setText('');   // the server trims and caps; the box clears on send rather than on the echo, so typing keeps up
  };

  return html`<div class=${`chat ${open ? 'is-open' : 'is-folded'}`} data-testid="chat-window">
    <div class="chat__head">
      <button type="button" class="chat__title" data-testid="chat-toggle" aria-expanded=${open ? 'true' : 'false'}
        title=${open ? t('收起') : t('展开')} aria-label=${t('在线聊天')} onClick=${() => onToggle(!open)}>
        <${GIcon} name="chat" class="chat__icon" />
        <span class="chat__titletext">${t('在线聊天')}</span>
        <${MicroLabel}>CHAT<//>
        <${Icon} name=${open ? 'collapse' : 'expand'} class="chat__chev" />
      </button>
    </div>
    ${open ? html`<div class="chat__body">
      <div class="chat__log" ref=${logRef} data-testid="chat-log" role="log" aria-label=${t('在线聊天')}>
        ${list.length ? list.map((l) => {
          const who = speaker(room, l.playerId, myId);
          return html`<div class=${`chat__line ${who.self ? 'is-self' : ''}`} key=${l.seq} data-testid="chat-line">
            <${AvatarFrame} size="sm" name=${who.name} seat=${who.seat} bot=${who.isBot} self=${who.self} />
            <div class="chat__speech">
              <div class="chat__meta">
                <span class="chat__name">${who.name}</span>
                <span class="chat__stamp num">${stamp(l.at)}</span>
              </div>
              <p class="chat__text">${l.text}</p>
            </div>
          </div>`;
        }) : html`<p class="chat__empty">${t('还没有人发言。')}</p>`}
      </div>
      ${emote}
      <form class="chat__form" onSubmit=${submit}>
        <input class="chat__input" type="text" value=${text} maxlength=${CHAT_MAX_LEN} autocomplete="off"
          data-testid="chat-input" placeholder=${t('说点什么…')} aria-label=${t('发言')}
          disabled=${disabled} onInput=${(e) => setText(e.currentTarget.value)} />
        <button type="submit" class="chat__send" data-testid="chat-send" disabled=${disabled || !text.trim()}
          title=${t('发送')} aria-label=${t('发送')}><${Icon} name="chevrons" /></button>
      </form>
    </div>` : null}
  </div>`;
}
