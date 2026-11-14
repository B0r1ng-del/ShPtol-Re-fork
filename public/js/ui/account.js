// 我的账号 (需求方 2026-11-14): the reference server's account dialog (sp.bbsmc.cn/v024 — the top bar's own chip opens
// it: a level badge, 名字 + DOCTOR #, the namecard behind it, and rows of account actions). This fork has no account
// service — the name and the namecard live in this browser (identity.loadName / cardStore) — so the dialog is the
// account's FORMS, not a remote profile: rename, avatar, and 更换名片底图, which opens the normal namecard picker.
//
// 排行榜 / 统计数据 are the project's own records (screens/stats.js, the same dialogs the lobby's 成就统计 card opens);
// 上传头像 / 更换名片 / 名字外观 have no backing here and are shown disabled with a title saying why. Deliberately NOT
// built: a fake uploader that writes nowhere.
import { useState } from '../../vendor/hooks.module.js';
import { html, Modal, doctorNo } from './components.js';
import { NameCardLayer, NameCardPicker, namecardOf } from './namecards.js';
import { cardStore, setCardBackground, setCardBackgroundY } from './seatArt.js';
import { useStore } from '../store.js';
import { identity } from '../net.js';
import { t } from '../../../shared/i18n.js';

/** The player's own name, kept in this browser (`identity.loadName` / `saveName`). */
export function useMyName() {
  const [name, setName] = useState(() => (typeof identity?.loadName === 'function' ? identity.loadName() : ''));
  const save = (next) => {
    const v = String(next || '').slice(0, 64);
    setName(v);
    try { identity?.saveName?.(v); } catch { /* storage off: the name still shows for this session */ }
  };
  return [name, save];
}

/**
 * 我的账号: the account dialog. `onStats` opens the project's 统计数据 (screens/stats.js); everything without a backing
 * service is a disabled row, so nothing pretends to work.
 * @param {{ open: boolean, onClose: () => void, myId?: string|null, onStats?: (() => void)|null }} props
 */
export function AccountDialog({ open, onClose, myId = null, onStats = null }) {
  const [name, setName] = useMyName();
  const [editing, setEditing] = useState(false);
  const [picking, setPicking] = useState(false);
  const bg = useStore((s) => s.bg, Object.is, cardStore);
  const bgY = useStore((s) => s.bgY, Object.is, cardStore);
  const card = namecardOf(bg);
  if (!open) return null;
  if (picking) {
    return html`<${NameCardPicker} current=${bg} y=${bgY} onPick=${setCardBackground}
      onAdjust=${setCardBackgroundY} onClose=${() => setPicking(false)} />`;
  }
  const noop = (why) => ({ disabled: true, title: why });
  return html`<${Modal} open=${open} title=${t('我的账号')} micro="ACCOUNT" onClose=${onClose} width="520px">
    <div class="acct">
      <div class=${'acct-me has-nc'} data-testid="acct-me">
        ${card ? html`<${NameCardLayer} card=${bg} y=${bgY} />` : null}
        <span class="acct-me__lv" aria-hidden="true">1</span>
        <span class="acct-me__id">
          <b class="acct-me__name">${name || t('博士')}</b>
          <small class="acct-me__no">DOCTOR #${doctorNo(myId ?? name)}</small>
        </span>
      </div>
      <div class="acct-row">
        <button type="button" class="acct-btn acct-btn--go" data-testid="acct-avatar" ${noop(t('本 fork 没有账号服务，头像不随账户保存'))}>
          ${t('上传头像')}</button>
        <button type="button" class="acct-btn" data-testid="acct-card" onClick=${() => setPicking(true)}>
          ${t('更换名片底图')}</button>
        <button type="button" class="acct-btn" ${noop(t('本 fork 没有名字外观'))}>${t('名字外观')}</button>
      </div>
      <div class="acct-row">
        <button type="button" class="acct-btn" data-testid="acct-rename" onClick=${() => setEditing(true)}>
          ${t('修改昵称')}</button>
      </div>
      ${editing ? html`<form class="acct-rename" onSubmit=${(e) => { e.preventDefault(); const v = new FormData(e.currentTarget).get('n'); setName(v); setEditing(false); }}>
        <label class="acct-rename__label" for="acct-name">${t('昵称')}</label>
        <input id="acct-name" class="acct-rename__in" name="n" value=${name} maxlength=${64} autocomplete="off" />
        <button type="submit" class="acct-btn acct-btn--go">${t('保存')}</button>
        <button type="button" class="acct-btn" onClick=${() => setEditing(false)}>${t('取消')}</button>
      </form>` : null}
      <button type="button" class="acct-btn acct-btn--wide" data-testid="acct-stats" onClick=${() => (onStats ? onStats() : null)}>
        ${t('统计数据')}</button>
    </div>
  <//>`;
}
