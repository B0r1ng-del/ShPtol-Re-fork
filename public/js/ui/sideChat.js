// public/js/ui/sideChat.js — 贴边可折叠的**对局内**聊天面板 (owner:「再选择策略最右边加个可以折叠贴边的聊天」).
//
// WHAT IT IS
//   选择策略 (BAND_DRAFT) 是一块**独立整屏** (screens/game.js 的 `mode === 'draft'` 分支),上面没有对局 HUD,
//   所以 HUD 上的 `ui/chat.js ChatBar` 在这页**看不到** —— 选策略的十几秒里没法说话。这个面板补上那一段。
//
// WHICH CHANNEL
//   **对局内**聊天(`store.chat` / `g.chat` → `m.chat`),不是房间聊天(`store.roomChat` / `room.chat`)。
//   两个频道是**故意分开**的(见 store.js 的说明):开局之后 `room.chat` 会被服务端拒掉(`WRONG_PHASE`),
//   而对局内的行带队伍/座位标签,属于这一局。选择策略已经在**对局中**,所以只能是对局内频道。
//
// WHY FIXED + A COLLAPSE
//   面板 `position: fixed` 贴在视口右边缘:折叠时只剩一条窄标签(带未读计数),展开时滑出面板本体。
//   折叠状态记在 localStorage —— 玩家收起一次就不该每局都重新展开。
//   它浮在 `.draft__main` 的第三列(策略详情)之上,所以展开时会盖住详情栏的右半边;
//   这是"贴边抽屉"的正常代价,而标签本身很窄、点一下就能收起,详情随时可以看回来。

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Modal, Button } from './components.js';
import { useStore, shallowEqual, isSpectating } from '../store.js';
import { actions } from './gameActions.js';
import { CHAT_MAX_LEN } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 折叠状态跨对局记住:玩家收起一次,下一局不该又自己弹出来。 */
const OPEN_KEY = 'sp.sideChat.open';

function readOpen() {
  try { return localStorage.getItem(OPEN_KEY) === '1'; } catch { return false; }
}
function writeOpen(on) {
  try { localStorage.setItem(OPEN_KEY, on ? '1' : '0'); } catch { /* 隐私模式忽略 */ }
}

/** `HH:MM` —— 与房间聊天 / 对局内历史用同一种读法。 */
function clockOf(ms) {
  try {
    const d = new Date(ms);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  } catch { return ''; }
}

/**
 * @param {{ players?: any[]|null, myId?: string|null, openSignal?: number }} props
 *   `players` 用来把发言人的座位翻成 `[P3]` 这样的标签;不传就只显示名字。
 *   `openSignal` — 对局里按「聊天」快捷键时由屏幕 +1,用来展开面板(同 `ui/chat.js ChatBar` 的老做法)。
 *     桌面端那个快捷键本来开着 `ChatBar` 的输入框;`ChatBar` 撤掉之后这个信号必须接过来,
 *     否则快捷键会变成"按了没反应"。**按快捷键时仍然自动聚焦** —— 那是明确的"我要打字"意图。
 */
export function SideChat({ players = null, myId = null, openSignal = 0 }) {
  const chat = useStore((s) => s.chat, shallowEqual);
  const online = useStore((s) => s.connection.status === 'online');
  // All phase screens share this component. Spectators read the public channel;
  // the existing server still refuses their g.chat and every other player intent.
  const readOnly = useStore((s) => isSpectating(s.room, s.me.playerId));
  const [open, setOpen] = useState(readOpen);
  const [text, setText] = useState('');
  /** 折叠期间到达的行数 —— 展开后清零(未读计数)。 */
  const [unread, setUnread] = useState(0);
  const [history, setHistory] = useState(false);
  const listRef = useRef(null);
  const histRef = useRef(null);
  const inputRef = useRef(null);
  /* 折叠时记住"已经看到哪一条",这样未读只数**新**行,不是数整个日志长度。 */
  const seenRef = useRef(chat.length ? chat[chat.length - 1].seq : 0);

  /**
   * 「聊天」快捷键:信号一变就展开并**聚焦输入框**。
   *
   * 快捷键本身就是"我要打字"的明确意图,所以这里聚焦是对的(桌面端尤其)。
   * 触屏上这个快捷键用不到,所以不会与"点击只打开"的规则冲突。
   */
  const firstSignal = useRef(openSignal);
  const wantFocus = useRef(false);
  /* 收起那一刻"光标在不在输入框里" —— 条件渲染会把输入框卸载,所以必须提前记下来 */
  const wasTyping = useRef(false);
  useEffect(() => {
    if (openSignal === firstSignal.current) return;
    firstSignal.current = openSignal;
    wantFocus.current = !readOnly;
    setOpen(true);
    writeOpen(true);
  }, [openSignal, readOnly]);

  // 折叠着来新消息 → 未读 +1;展开时全部标记已读
  useEffect(() => {
    const last = chat.length ? chat[chat.length - 1].seq : 0;
    if (open) { seenRef.current = last; setUnread(0); return; }
    if (last <= seenRef.current) return;
    const fresh = chat.filter((l) => l.seq > seenRef.current).length;
    seenRef.current = last;
    setUnread((n) => n + fresh);
  }, [chat, open]);

  /**
   * 展开后贴到最新一行 —— 但**不无条件聚焦输入框**。
   *
   * ⚠ 这里原来直接 `inputRef.current?.focus()`,在手机上就等于"点一下聊天就弹出软键盘、
   * 屏幕被顶上去一半",而玩家往往只是想看一眼谁说了什么
   * (owner:「手机端改成点击单纯打开 只有点击输入框才会输入」)。
   *
   * 只在两种明确要打字的情况下聚焦:
   *   · `wantFocus` —— 刚按了「聊天」快捷键(见上);
   *   · `wasTyping` —— **收起之前光标就在输入框里**(收起那一刻记下的,见 `toggle`)。
   *
   * ⚠ `wasTyping` 必须在 `toggle` 里判断,**不能在这里读 `document.activeElement`**:
   * 面板用的是**条件渲染**,收起时输入框整个被卸载,再展开时 `activeElement` 已经是 body ——
   * 那个信号在收起的那一刻就没了(第一版就是这么写的,实测"打字中收起再展开,焦点没回来")。
   */
  useEffect(() => {
    if (!open) return;
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (wantFocus.current || wasTyping.current) {
      wantFocus.current = false;
      inputRef.current?.focus();
    }
    wasTyping.current = false;
  }, [open, chat]);

  // 历史弹窗打开时也贴到最新一行(和面板同一个理由:不跟住对话的聊天比没有更糟)
  useEffect(() => {
    const el = histRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [history, chat]);

  /**
   * ⚠ 让位是靠 CSS 的 `:has()` 做的(见 draft.css `html:has(.sidechat.is-open)`),**不要**改成
   * 在这里给 `<html>` 加类。
   *
   * 踩过一次:写成 `useEffect(() => { classList.toggle(...); return () => classList.remove(...) }, [open])`
   * —— React 的 cleanup 在**每次依赖变化时**都会先跑,于是 `open` 一变,类先被删掉再被加回来,
   * 量出来就是"类设了但布局没动"。`:has()` 是纯 CSS 判断,没有这个时序问题,
   * 而且项目里已经有先例(contracts.css 的 `.ctrdetail:has(...)`)。
   */

  const toggle = (on) => {
    /*
     * 收起之前先看"光标是不是在输入框里" —— 组件用的是条件渲染,`setOpen(false)` 之后
     * 输入框立刻被卸载,那时再读 `document.activeElement` 只会得到 body。
     * 展开时如果这个标记是 true,就把光标还给玩家,不打断正在打字的人。
     */
    if (!on) {
      try { wasTyping.current = document.activeElement === inputRef.current; } catch { wasTyping.current = false; }
    }
    setOpen(on);
    writeOpen(on);
  };

  const send = () => {
    if (readOnly || !online) return;
    const line = String(text ?? '').replace(/\s+/g, ' ').trim();
    if (!line) return;
    try { actions.chat(line); } catch { /* 连接问题由顶部横幅报告 */ }
    setText('');
  };

  const onKey = (e) => {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); send(); return; }
    // Esc 收起而不是把整局操作交给对局快捷键(输入框本身已被 shortcuts.js 排除,这里只是让 Esc 有意义)
    if (e.key === 'Escape') { e.preventDefault(); toggle(false); }
  };

  /** 发言人的 `[P#]` 标签:座位从全房名单里查(对局内的行不带 seat,只有 playerId)。 */
  const seatOf = (playerId) => {
    if (!Array.isArray(players)) return null;
    const p = players.find((x) => x && x.playerId === playerId);
    return p && Number.isInteger(p.seat) ? p.seat + 1 : null;
  };

  /** 一条聊天行 —— 面板与历史弹窗共用,避免两处格式漂移。 */
  const line = (l, cls) => {
    const seat = seatOf(l.playerId);
    return html`<li key=${l.seq} class=${cx(cls, l.playerId === myId && 'is-mine')}>
      <span class="sidechat__at num">${clockOf(l.at)}</span>
      ${seat != null ? html`<span class="sidechat__seat num">[P${seat}]</span>` : null}
      <b class="sidechat__who">${l.name || (l.playerId === myId ? t('你') : t('博士'))}</b>
      <span class="sidechat__text">${l.text}</span>
    </li>`;
  };
  const emptyLine = (cls) => html`<li class=${cx(cls, 'sidechat__line--empty')}>
    <span class="sidechat__text">${t('还没有人说话')}</span></li>`;

  return html`<aside class=${cx('sidechat', open ? 'is-open' : 'is-closed')} aria-label=${t('对局聊天')}>
    ${/*
      折叠标签:只有**图标**那么大 (owner:「太大了 改成箭头指的那么大」—— 他圈的是左下角那排图标按钮的高度)。
      竖排的「聊天」二字已去掉,可发现性由 `title` / `aria-label` 兜住:悬停有提示、读屏有名字。
    */ null}
    <button type="button" class="sidechat__tab" onClick=${() => toggle(!open)}
      aria-expanded=${open ? 'true' : 'false'}
      title=${open ? t('收起聊天') : t('展开聊天')} aria-label=${open ? t('收起聊天') : t('展开聊天')}>
      <${Icon} name=${open ? 'chevronRight' : 'chat'} />
      ${!open && unread > 0 ? html`<span class="sidechat__dot num" aria-label=${t('{n} 条未读', { n: unread })}>${unread > 99 ? '99+' : unread}</span>` : null}
    </button>
    ${open ? html`<div class="sidechat__panel brackets">
      <div class="sidechat__label">
        <${Icon} name="chat" />
        <span>${t('对局聊天')}</span>
        <span class="sidechat__micro num">CHAT</span>
        ${/*
          查看历史 (owner:「然后加个查看历史消息的按钮」)。
          面板里只放得下最近几条(日志区自己滚动),历史弹窗把**全部**保留的行(main.js 的 CHAT_KEEP)列出来。
        */ null}
        <button type="button" class="sidechat__histbtn" onClick=${() => setHistory(true)}
          title=${t('查看历史消息')} aria-label=${t('查看历史消息')}>
          <${Icon} name="list" />
        </button>
        <button type="button" class="sidechat__close" onClick=${() => toggle(false)} title=${t('收起聊天')} aria-label=${t('收起聊天')}>
          <${Icon} name="chevronRight" />
        </button>
      </div>
      <ul class="sidechat__log" ref=${listRef}>
        ${chat.length ? chat.map((l) => line(l, 'sidechat__line')) : emptyLine('sidechat__line')}
      </ul>
      ${readOnly ? html`<p class="t-lo" role="status">${t('观战中')}</p>` : html`<div class="sidechat__row">
        <input
          class="sidechat__input"
          ref=${inputRef}
          type="text"
          id="side-chat-input"
          name="sideChat"
          value=${text}
          maxlength=${CHAT_MAX_LEN}
          placeholder=${online ? t('说点什么…') : t('连接已断开')}
          disabled=${!online}
          onInput=${(e) => setText(e.currentTarget.value)}
          onKeyDown=${onKey}
          aria-label=${t('对局聊天输入框')}
        />
        <button type="button" class="sidechat__send" disabled=${!online || !String(text).trim()}
          onClick=${send} title=${t('发送（Enter）')}><${Icon} name="send" /></button>
      </div>`}
    </div>` : null}
    ${/*
      历史弹窗:复用 `ui/chat.js` 里那套 `.chat__history*` 类名 —— 它们的样式在 profile.css 里,
      而 bundle.css 是**全局拼接**的,所有屏幕都加载得到,所以这里不必再写一份列表样式。
    */ null}
    <${Modal} open=${history} onClose=${() => setHistory(false)} title=${t('历史聊天')} micro="CHAT" width="6.4rem"
      actions=${html`<${Button} variant="ghost" onClick=${() => setHistory(false)}>${t('关闭')}</${Button}>`}>
      <ul class="chat__history" ref=${histRef}>
        ${chat.length
          ? chat.map((l) => {
              const seat = seatOf(l.playerId);
              return html`<li key=${l.seq} class=${cx('chat__hline', l.playerId === myId && 'is-mine')}>
                <span class="chat__hat num">${clockOf(l.at)}</span>
                ${seat != null ? html`<span class="chat__tag"><span class="chat__tseat num">[P${seat}]</span></span>` : null}
                <b class="chat__hwho">${l.name || (l.playerId === myId ? t('你') : t('博士'))}</b>
                <span class="chat__htext">${l.text}</span>
              </li>`;
            })
          : html`<li class="chat__hline chat__hline--empty"><span class="chat__htext">${t('还没有人说话')}</span></li>`}
      </ul>
    <//>
    ${/*
      ⚠ **卡池详情不在这里** (owner:「把查看其他分队卡池功能放在商店资金右下角 不要加到聊天里」)。
      它已搬到调度中心的资金区(`ui/shopBar.js` 的 `.funds`,组件是 `ui/poolDialog.js` 的 `PoolButton`)。
      卡池本来就是商店的东西,放在商店上更顺 —— 这里不再需要订阅 `match.public`。
    */ null}
  </aside>`;
}
