// ui/presetPanel.js — 预设面板 (owner:「给干员调配 干员持有 自选编队 都增加预设功能 … 迅速转换策略 切换预设
// 还有导出导入功能将皮肤和语音都带上」).
//
// 面板挂在「干员调配」的底部工具条上,三个标签页都能打开 —— 因为一个预设同时覆盖三者,只在一个标签页里能用到
// 就没法体现"整套配置"这件事。
//
// 数据层是 ui/presets.js(纯函数、已单测);这里负责:
//   * 把五个存储读成一份快照、再写回去(**每个存储独立 try**:一个写失败不该让其余三个不生效);
//   * 保存 / 应用 / 重命名 / 删除 / 分享码 / 文件导入导出;
//   * 显示"这份预设里有哪些干员被本局 ban 了"——「迅速转换策略」的动机就在这里。

import { useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Modal, Tooltip, confirmDialog } from './components.js';
import { t } from '../../../shared/i18n.js';
import { useStore, savePref } from '../store.js';
import { toast } from './toasts.js';
import { data } from '../data.js';
import { audio } from '../audio.js';
// 干员调配 / 干员持有 / 自选编队 / 潜能·练度
import { loadoutStore, setEntries, setNotOwned, setDiyPicks, setOps } from './loadoutSync.js';
// 皮肤 / 语音
import { skinsStore, setSkins } from './skins.js';
import { bannedPerBond } from './gameLogic.js';
import {
  readPresets, writePresets, sanitizeSnapshot, snapshotCounts, sameSnapshot,
  serializePreset, parsePreset, presetFilePayload, parsePresetFile, presetFilename,
  cleanPresetName, PRESET_MAX, PRESET_NAME_MAX,
} from './presets.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

// ---- 文件往返(和 loadout.js 里那对同形,但那份是私有的;各自一份比改那个大文件安全)------------------

function downloadText(filename, text) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readFileText(file) {
  if (file && typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(fr.error || new Error('read failed'));
    fr.readAsText(file);
  });
}

// ---- 六个存储的桥接 -------------------------------------------------------------------------------


/**
 * 当前配置 → 一份快照。
 *
 * 六样都取**store 里的当前值**,而不是重新读 localStorage:界面上的才是玩家看到的,
 * 而且 store 已经做过清洗与持久化。
 */
export function captureSnapshot() {
  const lo = loadoutStore.get();
  let voicePrefs = {};
  try { voicePrefs = audio?.getVoicePrefs?.() || {}; } catch { /* 音频没起来时留空 */ }
  return sanitizeSnapshot({
    loadout: lo?.entries || {},
    notOwned: lo?.notOwned || [],
    diy: lo?.diy || {},
    // 潜能 / 练度 (0.2.2): keyed by charId, shared by 干员调配 and 自选编队 — one map covers both
    ops: lo?.ops || {},
    skins: skinsStore.get()?.skins || {},
    voicePrefs,
  });
}

/**
 * 一份快照 → 当前配置。**逐项独立**:某一项写失败(配额、数据没加载完)不影响其余项。
 * @param {any} snap
 * @returns {{ applied: string[], failed: string[] }}
 */
export function applySnapshot(snap) {
  const s = sanitizeSnapshot(snap);
  const applied = [];
  const failed = [];
  const step = (name, fn) => { try { fn(); applied.push(name); } catch { failed.push(name); } };
  step('loadout', () => setEntries(s.loadout));
  step('notOwned', () => setNotOwned(s.notOwned));
  step('diy', () => setDiyPicks(s.diy));
  // 一整份写一次(不是逐个干员):每次写都会持久化并通知订阅者
  step('ops', () => setOps(s.ops));
  step('skins', () => setSkins(s.skins));
  step('voicePrefs', () => {
    audio?.loadVoicePrefs?.(s.voicePrefs);
    // 语音偏好是 audio 自己持久化的(setVoicePref 那边写),这里补一次,免得刷新后丢
    try { savePref('voicePrefs', s.voicePrefs); } catch { /* 配额 */ }
  });
  return { applied, failed };
}

// ---- 本局被 ban 的干员:预设里有多少受影响 ---------------------------------------------------------

/**
 * 一份快照里有哪些棋子被本局 ban 了,以及受影响的盟约。
 *
 * 「迅速转换策略」的前提是**看得见代价**:切到一份预设之前要知道它有多少要用的干员这局拿不到、
 * 哪些盟约因此点不亮 —— 否则切完才发现,比不切更糟。
 * @param {any} snap @param {any} pub m.public
 */
export function presetBans(snap, pub) {
  const bannedList = (Array.isArray(pub?.bannedChess) ? pub.bannedChess : []).filter((x) => typeof x === 'string');
  const banned = new Set(bannedList);
  if (!banned.size) return { hit: [], bonds: [], total: 0 };
  const s = sanitizeSnapshot(snap);
  const chess = data.lookup ? (id) => data.lookup('chess', id) : () => null;
  // 预设里"打算用"的棋子 = 调配里出现过的 + 被 ban 名单里同时出现在自选填报中的
  const ids = new Set(Object.keys(s.loadout));
  for (const v of Object.values(s.diy)) {
    const cid = v && typeof v === 'object' ? v.charId : null;
    if (typeof cid === 'string' && cid) ids.add(cid);
  }
  const hit = [];
  for (const id of ids) {
    if (!banned.has(id)) continue;
    const rec = chess(id);
    hit.push({ id, name: rec?.name || id, tier: rec?.tier ?? 0 });
  }
  hit.sort((a, b) => b.tier - a.tier || String(a.name).localeCompare(String(b.name)));
  /*
   * 每个盟约被禁了几名成员:bannedPerBond(bonds, bannedChess) —— 第二个参数是**被 ban 的棋子 id 列表**,
   * 它对每个盟约数 `visibleMembers` 里落在名单中的个数。盟约表来自 briefing 用的同一份数据。
   */
  const bonds = [];
  try {
    const list = data.list ? data.list('bonds') : null;
    const per = bannedPerBond(Array.isArray(list) ? list : [], bannedList);
    if (per instanceof Map) for (const [bid, n] of per) if (n > 0) bonds.push({ bondId: bid, n });
  } catch { /* 盟约表没加载完就算了 */ }
  return { hit, bonds, total: hit.length };
}

// ---- 面板 -----------------------------------------------------------------------------------------

/**
 * 预设面板。
 * @param {{ open: boolean, onClose: () => void, pub?: any }} props `pub` = m.public(有 bannedChess 时显示影响)
 */
export function PresetPanel({ open, onClose, pub = null }) {
  const [list, setList] = useState(() => readPresets());
  const [name, setName] = useState('');
  const [io, setIo] = useState(null);       // { mode:'export'|'import', text:string, name?:string }
  const [busy, setBusy] = useState(false);
  const fileRef = useRef(null);

  // 当前配置:面板打开期间实时看着五项(玩家在预览里改了什么,高亮要跟着动)
  const live = useStore((v) => v, undefined, loadoutStore);
  const liveSkins = useStore((v) => v, undefined, skinsStore);
  const current = useMemo(() => captureSnapshot(), [live, liveSkins, open]);

  const persist = (next) => {
    if (!writePresets(next)) { toast(t('保存失败(存储空间不足或隐私模式)'), 'error'); return false; }
    setList(next);
    return true;
  };

  if (!open) return null;

  const counts = snapshotCounts(current);
  const bans = presetBans(current, pub);

  const onSave = () => {
    const n = cleanPresetName(name) || t('预设') + ' ' + (list.length + 1);
    if (list.length >= PRESET_MAX) { toast(t('预设数量已达上限'), 'warn'); return; }
    if (!counts.total) { toast(t('当前没有任何配置可保存'), 'warn'); return; }
    const next = [...list, { id: Math.random().toString(36).slice(2, 10), name: n, at: Date.now(), snap: current }];
    if (persist(next)) { setName(''); toast(t('已保存预设「{name}」', { name: n }), 'ok'); }
  };

  const onApply = async (p) => {
    const b = presetBans(p.snap, pub);
    if (b.total) {
      const okGo = await confirmDialog({
        title: t('应用预设「{name}」', { name: p.name }),
        text: t('这份预设里有 {n} 名干员本局被禁用({names})，相关盟约可能点不亮。仍要应用吗？', { n: b.total, names: b.hit.slice(0, 5).map((x) => x.name).join('、') }),
        okText: t('仍要应用'),
      });
      if (!okGo) return;
    }
    setBusy(true);
    const r = applySnapshot(p.snap);
    setBusy(false);
    if (r.failed.length) toast(t('部分项应用失败：{list}', { list: r.failed.join('、') }), 'warn');
    else toast(t('已应用预设「{name}」', { name: p.name }), 'ok');
  };

  const onDelete = async (p) => {
    const okGo = await confirmDialog({ title: t('删除预设'), text: t('删除「{name}」？', { name: p.name }), okText: t('删除') });
    if (okGo) { if (persist(list.filter((x) => x.id !== p.id))) toast(t('已删除'), 'ok'); }
  };

  const onRename = async (p) => {
    const v = window.prompt(t('新的名称'), p.name);
    if (v == null) return;
    const n = cleanPresetName(v);
    if (!n) { toast(t('名称不能为空'), 'warn'); return; }
    if (persist(list.map((x) => (x.id === p.id ? { ...x, name: n } : x)))) toast(t('已重命名'), 'ok');
  };

  const onShare = async (p) => {
    const code = serializePreset(p);
    setIo({ mode: 'export', text: code, name: p.name });
    try { await navigator.clipboard.writeText(code); toast(t('分享码已复制到剪贴板'), 'ok'); }
    catch { /* 剪贴板不可用:文本框里已经能看到,手动复制 */ }
  };

  const onDownload = (p) => {
    downloadText(presetFilename(p.name), JSON.stringify(presetFilePayload(p), null, 2));
    toast(t('已下载预设文件'), 'ok');
  };

  const applyImportText = (text) => {
    const raw = String(text || '').trim();
    if (!raw) return;
    let parsed = null;
    if (raw.startsWith('{')) {
      let obj = null;
      try { obj = JSON.parse(raw); } catch { toast(t('文件内容不是合法的 JSON'), 'error'); return; }
      parsed = parsePresetFile(obj);
    } else parsed = parsePreset(raw);
    if (!parsed.ok) { toast(t('无法识别的预设：{why}', { why: parsed.error }), 'error'); return; }
    const pf = presetBans(parsed.snap, pub);
    const next = [...list, { id: Math.random().toString(36).slice(2, 10), name: parsed.name, at: Date.now(), snap: parsed.snap }];
    if (!persist(next)) return;
    setIo(null);
    toast(t('已导入预设「{name}」', { name: parsed.name }) + (pf.total ? t('（其中 {n} 名干员本局被禁）', { n: pf.total }) : ''), 'ok');
  };

  const onFile = async (e) => {
    const f = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    try { applyImportText(await readFileText(f)); } catch { toast(t('读取文件失败'), 'error'); }
  };

  return html`<${Modal} open=${open} onClose=${onClose} title=${t('预设')} micro="PRESETS" width="8.2rem"
    actions=${html`<${Button} variant="primary" icon="check" onClick=${onClose}>${t('关闭')}</${Button}>`}>
    <div class="preset">
      ${/* 当前配置概览 + 本局禁用影响 ------------------------------------------------ */ null}
      <div class="preset__now">
        <div class="preset__nowhead">
          <b>${t('当前配置')}</b>
          <span class="preset__counts">
            ${t('调配')}<b class="num">${counts.loadout}</b>
            ${t('持有')}<b class="num">${counts.notOwned}</b>
            ${t('自选')}<b class="num">${counts.diy}</b>
            ${t('皮肤')}<b class="num">${counts.skins}</b>
            ${t('语音')}<b class="num">${counts.voicePrefs}</b>
          </span>
        </div>
        ${bans.total
          ? html`<div class="preset__ban" data-testid="preset-ban-now">
              <${Icon} name="warn" />
              <span>${t('本局禁用影响：{n} 名干员', { n: bans.total })}</span>
              <span class="preset__bannames">${bans.hit.slice(0, 8).map((x) => x.name).join('、')}${bans.hit.length > 8 ? ' …' : ''}</span>
            </div>`
          : null}
      </div>

      ${/* 保存当前 ---------------------------------------------------------------- */ null}
      <div class="preset__save">
        <input class="preset__input" id="preset-name-input" name="presetName" maxlength=${PRESET_NAME_MAX} placeholder=${t('给这套配置起个名字')}
          value=${name} onInput=${(e) => setName(e.currentTarget.value)}
          onKeyDown=${(e) => { if (e.key === 'Enter') onSave(); }} data-testid="preset-name" />
        <${Button} variant="primary" icon="plus" disabled=${busy || !counts.total} onClick=${onSave}>${t('保存为预设')}<//>
      </div>

      ${/* 预设列表 ---------------------------------------------------------------- */ null}
      <div class="preset__list" data-testid="preset-list">
        ${list.length ? list.map((p) => {
          const c = snapshotCounts(p.snap);
          const isCur = sameSnapshot(p.snap, current);
          const b = presetBans(p.snap, pub);
          return html`<div class=${cx('preset__item', isCur && 'is-current')} key=${p.id} data-preset=${p.id}>
            <div class="preset__itemhead">
              <b class="preset__name">${p.name}</b>
              ${isCur ? html`<span class="preset__cur">${t('当前')}</span>` : null}
              ${b.total ? html`<${Tooltip} text=${t('本局禁用：{names}', { names: b.hit.map((x) => x.name).join('、') })}>
                <span class="preset__warn" data-testid="preset-ban"><${Icon} name="warn" />${b.total}</span>
              </${Tooltip}>` : null}
              <span class="preset__spacer"></span>
              <span class="preset__meta" title=${t('干员调配 / 干员持有 / 自选编队 / 潜能·练度 / 皮肤 / 语音')}>${c.loadout}/${c.notOwned}/${c.diy}/${c.ops}/${c.skins}/${c.voicePrefs}</span>
            </div>
            <div class="preset__acts">
              <${Button} size="sm" variant="primary" icon="check" onClick=${() => onApply(p)} data-testid="preset-apply">${t('应用')}<//>
              <${Button} size="sm" variant="ghost" onClick=${() => onShare(p)}>${t('分享码')}<//>
              <${Button} size="sm" variant="ghost" icon="copy" onClick=${() => onDownload(p)}>${t('文件')}<//>
              <${Button} size="sm" variant="ghost" onClick=${() => onRename(p)}>${t('重命名')}<//>
              <${Button} size="sm" variant="ghost" icon="close" onClick=${() => onDelete(p)}>${t('删除')}<//>
            </div>
          </div>`;
        }) : html`<p class="preset__empty">${t('还没有预设。把当前配置存下来，之后就能一键切换。')}</p>`}
      </div>

      ${/* 导入 ------------------------------------------------------------------- */ null}
      <div class="preset__io">
        <${Button} size="sm" variant="secondary" icon="plus" onClick=${() => fileRef.current?.click()}>${t('导入文件')}<//>
        <${Button} size="sm" variant="secondary" onClick=${() => setIo({ mode: 'import', text: '' })}>${t('粘贴分享码')}<//>
        <input type="file" id="preset-import-file" name="presetFile" accept=".json,.txt,application/json,text/plain" class="preset__file" ref=${fileRef} onChange=${onFile} />
      </div>
    </div>
  </${Modal}>`;
}

