// public/js/ui/crisisSelect.js — 危机合约 · 选择指标 (CONTINGENCY CONTRACT)
//
// Layout mirrors the official page (sh.bbsmc.cn/v024 js/ui/crisisPages.js): a three-row BOARD on an absolutely
// positioned track — one COLUMN per route, its tiers on the rows the route actually offers (cs-row / cs-tile,
// cs-tile--void for the gaps), GROUP HEADERS spanning each group's columns (cs-ghead / cs-gsep), connector links
// between consecutive tiers (cs-link) — then the picked list (cs-list / cs-item) and the bottom bar
// (cs-seed / cs-record / cs-go). Geometry copied verbatim from the source:
//   PITCH = 98, GGAP = 26   column pitch, extra gap between groups
//   VIEW_W = 847            the track's visible width
//   ROW_Y = [145, 280, 415] the three rows' y inside the board
//   ROUTE_W = 72            a group header's width; the first column starts at x = 21
//   LV_COLOR = ['#ff9a1a','#ff6a12','#f2341c']
// Art comes from the same sprites the official page uses (CC_UI), which this repo already vendors.
//
// It stays a THIN view: every rule comes from shared/crisis.js (the table the server checks a room against) and
// every seed answer from the server's crisis.preview push. A client that decided conflicts on its own would
// eventually disagree with the server and offer a contract create() refuses.

import { useCallback, useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { data, useData, getStage } from '../data.js';
import { loadPref, savePref } from '../store.js';
import { modeIdFor } from '../../../shared/constants.js';
import { fallbackTileClass } from './fallbackField.js';
import { audio } from '../audio.js';
import { arcAudio } from './crisisEventPage.js';
import { CrisisGlyph } from './crisisGlyph.js';
import { seedCode, parseSeedCode, randomSeed } from '../../../shared/crisisSeed.js';
import { enemyIconUrl } from './assetUrls.js';
import { net } from '../net.js';
import { readBest, subscribeBest } from './crisisRecords.js';
import { exportSelection, importSelection } from './crisisSelection.js';
import { t, N_ } from '../../../shared/i18n.js';
import {
  CRISIS_FX, CRISIS_ROUTES, CRISIS_GROUPS, checkCrisis, crisisConflict, crisisNeeds, crisisFxText, isCrisisImplemented, crisisTag, isCrisisSeed,
} from '../../../shared/crisis.js';
import {
  ARC_ROUTES, ARC_GROUPS, arcConflict, arcTag, arcMaxTotal,
} from '../../../shared/crisisArc.js';

const CC_UI = '/assets/local/sp-crisis-20261021-a94f75cbeb5d/ui/';
// 弧光作战's own art dir (official crisisShared.js CC_ART) — a different season ships different chrome.
const CC_ART = '/assets/local/cc4-arclight/';
const PITCH = 98;
const GGAP = 26;
const VIEW_W = 847;
const ROW_Y = [145, 280, 415];
const ROUTE_W = 72;
const X0 = 21;
const LV_COLOR = ['#ff9a1a', '#ff6a12', '#f2341c'];
// 跨档追加文本的罗马数字（官方 crisisTags.js ROMAN）: [Ⅱ xxx] 只在 ≥ Ⅱ 档出现
const ROMAN = ['Ⅰ', 'Ⅱ', 'Ⅲ'];
/** The contract's two shapes, in the order the page offers them (the official 单人/四人 radio). */
/** The two seasons this port ships. Each carries its own route table, groups, conflict test and validator; the page
 *  below is written against that shape, so switching seasons is switching the table, not a second page. */
const SEASONS = [
  { id: '', name: N_('重燃作战'), routes: CRISIS_ROUTES, groups: CRISIS_GROUPS, conflict: crisisConflict, tag: crisisTag, max: null },
  { id: 'arc', name: N_('弧光作战'), routes: ARC_ROUTES, groups: ARC_GROUPS, conflict: arcConflict, tag: arcTag, max: arcMaxTotal },
];
const MODES = [
  { id: 'solo', name: N_('单人合约') },
  { id: 'quad', name: N_('四人合约') },
];
const cx = (...p) => p.filter(Boolean).join(' ');

/** The mode's board: a column per route (its x inside the track, the rows it offers), group spans, the width. */
function boardFor(mode, season) {
  const cols = [];
  const groups = [];
  let x = X0;
  let g = null;
  for (const r of Object.values(season.routes)) {
    const rows = r && r.risk ? r.risk[mode] : null;
    if (!Array.isArray(rows) || !rows.length) continue;
    if (r.g !== g) {
      if (g) x += GGAP;
      groups.push({ g: r.g, x0: x, x1: x + ROUTE_W });
      g = r.g;
    } else {
      groups[groups.length - 1].x1 = x + ROUTE_W;
    }
    cols.push({ route: r, x, rows });
    x += PITCH;
  }
  return { cols, groups, width: x - PITCH + ROUTE_W + X0 };
}

/** 官方 Effect（crisisPages.js:62）: 每个 {a|b|c} 拆成 ＂<em>a</em>／<em class="is-on">b</em>／<em>c</em>＂，本档加 is-on；
 *  [Ⅱ xxx] 用 <em class="cs-fx-more">，已到该档加 is-on。parts 由 crisisFxText 给出（它已按档算好 on）。 */
function Effect({ tag, mode, lv }) {
  const fx = crisisFxText(tag.route.id, mode, lv || tag.lv);
  if (!fx) return null;
  return html`<span>${fx.parts.map((p) => (p.from
    ? html`<em class=${cx('cs-fx-more', p.on && 'is-on')}>［${ROMAN[p.from - 1]} ${p.text}］</em>`
    : p.text ?? p.vals.map((v, i) => html`${i ? '／' : ''}<em class=${i === p.on && 'is-on'}>${v}</em>`)))}</span>`;
}

/** 官方 ItemText（crisisPages.js:67）: ID + 名称 + 分档效果 + 本局目标。 */
function ItemText({ tag, mode, where = null }) {
  return html`<div class="cs-item__text"><b><i class="cs-item__id">${tag.route.id}</i>${tag.route.name}</b><${Effect} tag=${tag} mode=${mode} />
    ${where ? html`<small class="cs-item__where">${where}</small>` : null}</div>`;
}

/** 协议空间: the leader/elite codex (crisisPages.js:526 Enemies). Leaders come from data/bosses.json (non-hidden,
 *  non-arc), then the 特训精英 pool's ELITE entries, capped at ten cards like the official page. */
function EnemiesSheet({ onClose }) {
  // `ready` MUST be a dependency of the memo: useData() fills the store asynchronously, so a memo keyed on the
  // assets map alone would compute once against an empty store and never recompute (symptom: 0 cards, 10 slots).
  const ready = useData('bosses', 'enemies', 'factions', 'assets');
  const m = data.get('assets');
  const list = useMemo(() => {
    if (!ready) return [];
    const bosses = (data.list('bosses') || [])
      .filter((b) => b && !b.hidden && !/^boss_arc/.test(b.bossId || ''))
      .sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99))
      .map((b) => ({ key: b.enemyKey, name: b.name, rank: t('领袖') }));
    const special = Object.values(data.get('factions')?.types || {}).find((f) => f && f.type === 'SPECIAL');
    const elites = (special?.pool || [])
      .map((k) => data.lookup('enemies', k))
      .filter((e) => e && e.rank === 'ELITE' && enemyIconUrl(m, e.key))
      .filter((e, i, a) => a.findIndex((x) => x.name === e.name) === i)
      .slice(0, Math.max(0, 10 - bosses.length))
      .map((e) => ({ key: e.key, name: e.name, rank: t('精英') }));
    return [...bosses, ...elites].slice(0, 10);
  }, [ready, m]);
  const [pick, setPick] = useState(0);
  const cur0 = list[pick];
  const e = cur0 ? data.lookup('enemies', cur0.key) : null;
  // the data's ability text carries markup and {placeholders}; the official page strips both
  const plain = (s) => String(s || '').replace(/<[^>]*>/g, '').replace(/\{[^}]*\}/g, '');
  const abilities = (e?.abilities || []).map((a) => plain(a.text)).filter(Boolean).slice(0, 4);
  return html`
    <aside class="cs-sheet" onClick=${(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div class="cs-sheet__panel">
        <header>// ${t('协议空间')}<button type="button" class="cs-back" onClick=${onClose}><i></i>${t('返回')}</button></header>
        <h5 class="cs-en__h cs-en__h--list">${t('敌方一览')}</h5>
        <div class="cs-en__grid">
          ${list.map((x, i) => html`
            <button type="button" key=${x.key} class=${cx('cs-en__card', i === pick && 'is-on')} onClick=${() => setPick(i)} title=${x.name}>
              <i class="cs-en__topo"></i><span class="cs-en__ticks">▪ ▪ ▪</span>
              <img src=${enemyIconUrl(m, x.key)} alt="" />
              <span class="cs-en__rank">${x.rank}</span>
            </button>`)}
          ${Array.from({ length: Math.max(0, 10 - list.length) }, (_, i) => html`<i class="cs-en__card is-slot" key=${'s' + i}></i>`)}
        </div>
        <h5 class="cs-en__h cs-en__h--info">${t('敌方情报')}</h5>
        ${cur0 ? html`
          <div class="cs-en__head" key=${cur0.key}>
            <span class="cs-en__band"><i>ET.F</i></span>
            <img class="cs-en__art" src=${enemyIconUrl(m, cur0.key)} alt="" />
            <b class="cs-en__name">${cur0.name}</b>
            <span class="cs-en__lv">${cur0.rank} <i>No.</i></span>
            <b class="cs-en__no num">${e?.handbookIndex || '--'}</b>
          </div>
          <div class="cs-en__body">
            <span class="cs-en__label">${t('描述')}</span>
            <p>${plain(e?.desc) || t('暂无资料。')}</p>
            <span class="cs-en__label">${t('能力')}</span>
            ${abilities.length
              ? abilities.map((a, i) => html`<p class="cs-en__ab" key=${i}><i></i>${a}</p>`)
              : html`<p class="cs-en__ab"><i></i>${t('该敌人无特殊能力。')}</p>`}
          </div>` : html`<div class="cs-en__body"><p>${t('正在读取敌方资料…')}</p></div>`}
        <i class="cs-sheet__hatch"></i>
      </div>
    </aside>`;
}

// ---- 开局种子 · 种子码 (official crisisPages.js:591 SeedDialog) ---------------------------------------------
// The code is how a run gets handed to someone else: 8 Crockford base-32 characters with a check digit, so a
// mistyped digit is caught before the run starts. Typing one reproduces that seed's map, leaders and first shop.
/* 开局种子（官方 crisisPages.js 的 SeedDialog）—— 图四那张。
   主体是「出怪顺序」：把服务器 crisis.preview 返回的 picks 逐回合画出来（回合号 / 敌人图标 / 名称 / 基础名 / 穿插），
   弧光作战额外有「只决定出怪顺序」的专属说明与领袖固定行。 */
function SeedCodeDialog({ seed, onApply, onClose, preview = null, isArc = false }) {
  useData('enemies', 'enemies-crisis', 'bosses');
  const [text, setText] = useState(() => seedCode(seed));
  const parsed = parseSeedCode(text);
  const ok = !!parsed.seed;
  const apply = () => { if (ok) onApply(parsed.seed); };
  const assets = data.get('assets');
  // ★ 契约专用敌人（enemy_1326_cbagen 等）只在 data/enemies-crisis.json 里 —— build-data.mjs 把它们从
  //   enemies.json 拆出去了（见 tools/build-data.mjs「契约专用敌人拆出去」那段）。只查 'enemies' 会拿到 null，
  //   面板就退化成显示 key。这里两表都查。
  const en = (key) => data.lookup('enemies', key) || data.lookup('enemies-crisis', key) || null;
  const picks = preview && Array.isArray(preview.picks) ? preview.picks : null;
  const leaderName = (id) => (data.lookup('bosses', id) || {}).name || id;
  return html`
    <div class="cs-sheet cs-seed-modal" onClick=${(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <section class="cs-seed-panel" role="dialog" aria-modal="true" aria-label=${t('开局种子')}>
        <header>
          <div><small>CRISIS CONTRACT · SEED</small><h2>${t('开局种子')}</h2></div>
          <button type="button" class="cs-sheet__x" onClick=${onClose} aria-label=${t('关闭')}></button>
        </header>
        ${isArc ? html`<p>${t('弧光作战的开局种子')}<b>${t('只决定出怪顺序')}</b>${t('：每回合来哪一组弧光敌人、穿插哪些卫戍协议敌人。两名领袖固定：第14回合 多萝西，第15回合 “唤醒”（打赢第14回合必定进入）。地图固定为「危机合约 滞空焦点」；商店刷出的干员、机变、策略候选、禁用盟约和策略带来的随机奖励每局重新随机，不受种子影响。')}</p>`
          : html`<p>${t('怪物指标可直接选择：对应回合会替换部分随机怪物，保持原波次总数；地图指标仍须匹配地图。地图、基础波次和商店由开局种子决定。同一种子 + 同一组指标 + 同样的 BAN 地图，开局完全一样；之后的商店会随各自的操作而不同。')}</p>`}

        ${picks ? html`<ol class="cs-seed-order">${picks.map((x, r) => (x ? html`<li key=${r}>
          <em>${r === 14 ? t('终局护卫') : r === 15 ? t('隐藏护卫') : t('第{n}回合', { n: r })}</em>
          <img src=${enemyIconUrl(assets, x.key)} alt="" />
          <b>${(en(x.key) || {}).name || x.key}</b>
          <small>${x.key}</small>
          ${x.normal || x.elite ? html`<small class="cs-seed-mix">${t('穿插')} ${[x.normal, x.elite].filter(Boolean).map((k) => (en(k) || {}).name || k).join('、')}</small>` : null}
        </li>` : null))}</ol>` : html`<div class="cs-seed-rule">${t('正在读取本种子的出怪顺序…')}</div>`}

        ${isArc && preview && preview.leader ? html`<div class="cs-seed-rule">${t('领袖（固定）：第14回合 {a}；第15回合 {b}', { a: leaderName(preview.leader), b: leaderName(preview.hidden) })}</div>` : null}

        <div class="cs-seed-input">
          <input type="text" value=${text} maxLength=${12} placeholder="XXXX-XXXX" spellcheck=${false} autocomplete="off"
            aria-label=${t('种子码')} onInput=${(e) => setText(e.currentTarget.value)}
            onKeyDown=${(e) => { if (e.key === 'Enter') apply(); }} />
          <button type="button" onClick=${() => setText(seedCode(randomSeed()))}>${t('随机换一个')}</button>
        </div>
        <div class=${cx('cs-seed-msg', ok && 'is-ok')} role="status">${text
          ? (ok ? t('种子有效 · {code}', { code: seedCode(parsed.seed) }) : t(parsed.error))
          : t('输入其他博士分享的 8 位种子码即可打同一局；不区分大小写，可以不输入中间的横线')}</div>
        <footer>
          <button type="button" onClick=${onClose}>${t('取消')}</button>
          <button type="button" class="is-primary" disabled=${!ok} onClick=${apply}>${t('确定')}</button>
        </footer>
      </section>
    </div>`;
}

// ---- 地图预览 (official crisisPages.js MapPreview) -------------------------------------------------------------
// Two shapes, exactly as the official pages have them:
//   · 弧光 MapPreview: one fixed map-focus.webp + the gravity note. The official arc has ONE map, so it ships one
//     picture and never draws tiles. The title falls back to 危机合约 滞空焦点 (official fallback text — `custom_cc4_focus`
//     has no record in data/stages.json).
//   · 重燃: the stage's own rows drawn with fallbackTileClass, the same tile classes the fallback board uses.
//     This site serves the official art behind a 412 hot-link guard, so the board is drawn from the data.
function StageThumb({ stage }) {
  const rows = Array.isArray(stage?.rows) ? stage.rows : [];
  if (!rows.length) return html`<div class="cs-mapview__thumb is-empty"></div>`;
  const cols = Math.max(...rows.map((r) => String(r).length));
  return html`
    <div class="cs-mapview__thumb" style=${{ '--cols': cols, '--rows': rows.length }}>
      ${rows.map((line, r) => Array.from({ length: cols }, (_, c) => html`
        <i key=${r + ':' + c} class=${'cs-mapview__tile ff-tile--' + fallbackTileClass(stage, r, c)}></i>`))}
    </div>`;
}

function MapPreviewSheet({ stage, onClose, arc = false }) {
  const name = arc ? (stage?.name || t('危机合约 滞空焦点')) : (stage?.name || stage?.id || t('未知地图'));
  return html`
    <div class=${cx('cs-sheet', arc ? 'ca-mapview-modal' : 'cs-mapview-modal')}
      onClick=${(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <section class=${arc ? 'ca-mapview-panel' : 'cs-mapview-panel'} role="dialog" aria-modal="true" aria-label=${t('地图预览')}>
        <header>
          <div><small>CRISIS CONTRACT · MAP</small><h2>${name}</h2></div>
          <button type="button" class="cs-sheet__x" onClick=${onClose} aria-label=${t('关闭')}></button>
        </header>
        ${arc
          ? html`<img src=${CC_ART + 'map-focus.webp'} alt=${name} />`
          : html`<${StageThumb} stage=${stage} />`}
        <p>${t('本期所有作战都在这张地图进行。踩下')}<b class="is-left">${t('橙色「‹‹」按钮')}</b>${t('，这一半场的重力转向左；踩下')}<b class="is-right">${t('青色「››」按钮')}</b>${t('转向右。敌人顺着重力走会变快、逆着走会变慢，干员朝向顺着重力攻击更快。作战中左上角「本局词条」下方会实时显示两个半场的重力方向。')}</p>
      </section>
    </div>`;
}

// ---- 指标首通奖励 (official crisisPages.js:478 FirstClear) -----------------------------------------------------
// A pure read-out: what a first clear of a tier-N indicator pays (15 / 30 / 45 晶化硬币), and the rule that clearing a
// higher tier of one route also pays its lower tiers. It carries no state — a record of which indicators were cleared
// would need a server-side profile, which this port does not have.
const FIRST_CLEAR_COINS = [[1, 15], [2, 30], [3, 45]];

/** 官方 crisisShare.js 的 CrisisShare：我的指标组合 <-> 分享码。
 *  ★ 只搬运指标（+ 种子/BAN），绝不夹带成绩。 */
function ShareSheet({ mode, tags, seed, bans, season, onApply, onClose }) {
  const [input, setInput] = useState(''), [msg, setMsg] = useState('');
  let code = '', err = '';
  try { code = exportSelection(mode, tags, { seed, bans, season }); } catch (e) { err = e.message; }
  const copy = async () => {
    try { await navigator.clipboard.writeText(code); setMsg(t('分享码已复制')); }
    catch { setMsg(t('请选中上方分享码，手动复制')); }
  };
  const apply = () => {
    try { onApply(importSelection(input)); }
    catch (e) { setMsg(e.message); }
  };
  return html`
    <div class="cs-sheet cs-share" onClick=${(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div class="cs-sheet__panel cs-share-panel">
        <header>
          <b>${t('导入与分享指标')}</b>
          <button type="button" class="cs-sheet__x" onClick=${onClose} aria-label=${t('关闭')}></button>
        </header>
        <p>${t('分享码包含所选模式与全部指标')}${seed != null ? '，' + t('以及开局种子（同样的出怪顺序）') : ''}${t('，不包含通关纪录。')}</p>
        <label>${t('我的指标组合')} · ${MODES.find((m) => m.id === mode)?.name || ''}</label>
        <textarea readonly value=${code} placeholder=${err} onFocus=${(e) => e.currentTarget.select()}></textarea>
        <button type="button" class="cs-share__copy" disabled=${!code} onClick=${copy}>${t('复制分享码')}</button>
        <label>${t('导入其他博士的指标组合')}</label>
        <textarea value=${input} placeholder=${t('粘贴 SPCC1. 开头的分享码')} maxLength=${2048}
          onInput=${(e) => { setInput(e.currentTarget.value); setMsg(''); }}></textarea>
        <div class="cs-share__note" role="status">${msg || t('导入后会替换当前选择，并切换至分享码对应的模式。')}</div>
        <footer>
          <button type="button" onClick=${onClose}>${t('取消')}</button>
          <button type="button" disabled=${!input.trim()} onClick=${apply}>${t('导入')}</button>
        </footer>
      </div>
    </div>`;
}

function FirstClearSheet({ onClose }) {
  return html`
    <div class="cs-sheet cs-first" onClick=${(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <div class="cs-first__panel">
        <header>
          <span class="cs-first__wm">${t('首通奖励')}</span>
          <b>${t('指标首通奖励')}</b><i class="cs-first__dots"></i>
          <button type="button" class="cs-sheet__x" onClick=${onClose} aria-label=${t('关闭')}></button>
        </header>
        <div class="cs-first__body">
          <div class="cs-first__flag"><img src=${CC_UI + 'flag.png'} alt="" />${t('该标记表示当前指标的首次通关奖励还未获得')}</div>
          <p>${t('每条指标首次通关后，可获得与其等级相应的晶化硬币奖励')}</p>
          <div class="cs-first__table">
            ${FIRST_CLEAR_COINS.map(([lv, n]) => html`
              <div class=${'cs-first__col c' + lv} key=${lv}>
                <b><span class="num">${lv}</span><img class="cs-star" src=${CC_UI + 'star.png'} alt="" /></b>
                <span><span class="num">${n}</span><img src=${CC_UI + 'coin.png'} alt="" /></span>
              </div>`)}
          </div>
          <p class="cs-first__note">${t('※ 同类效果的指标中，当首次通关该效果的高等级指标时，会同步获得该效果的低等级指标奖励')}</p>
        </div>
      </div>
    </div>`;
}

// ---- BAN 地图 (official crisisMapBans.js) --------------------------------------------------------------------
// The banned ids leave the map pool on the SERVER (crisis.preview / create pass them into setupMatchWaves), so this
// page only has to hold the list and the rule: at least one map stays available.
const BAN_KEY = 'sp.crisis.map-bans.v1';

function readBans() {
  try {
    const v = JSON.parse(localStorage.getItem(BAN_KEY) || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
}

/** The mode's map pool: the active, positively weighted stages of its 绝境模拟 config record. */
function mapOptions(mode, config, stages) {
  const id = modeIdFor(mode === 'quad' ? 'coop' : 'solo', 'HARD');
  const pool = config?.modes?.[id]?.stages;
  return [...new Set(Array.isArray(pool) ? pool : [])]
    .filter((sid) => stages?.[sid] && stages[sid].active !== false && Number(stages[sid].weight) > 0)
    .map((sid) => ({ id: sid, name: stages[sid].name || stages[sid].stageName || sid }));
}

/** Keep only ids the pool still offers, at most all-but-one (the server applies the same list). */
function checkedBans(bans, options) {
  const ids = new Set(options.map((m) => m.id));
  return [...new Set((Array.isArray(bans) ? bans : []).filter((id) => typeof id === 'string' && ids.has(id)))]
    .slice(0, Math.max(0, options.length - 1));
}

/** The stored bans for `mode`, plus a setter that re-clamps them against the current pool. */
function useCrisisMapBans(mode) {
  const ready = useData('config', 'stages');
  const [saved, setSaved] = useState(readBans);
  const options = useMemo(() => (ready ? mapOptions(mode, data.get('config'), data.get('stages')) : []), [ready, mode]);
  const bans = useMemo(() => checkedBans(saved[mode], options), [saved, mode, options]);
  const change = useCallback((next) => {
    setSaved((prev) => {
      const value = { ...prev, [mode]: checkedBans(next, options) };
      try { localStorage.setItem(BAN_KEY, JSON.stringify(value)); } catch { /* private mode */ }
      return value;
    });
  }, [mode, options]);
  return { options, bans, change, ready: options.length > 0 };
}

function MapBanDialog({ options, bans, onChange, onClose, mode }) {
  const cap = Math.max(0, options.length - 1);
  return html`
    <div class="cs-sheet cs-map-modal" onClick=${(ev) => { if (ev.target === ev.currentTarget) onClose(); }}>
      <section class="cs-map-panel" role="dialog" aria-modal="true" aria-label=${t('BAN 地图')}>
        <header>
          <div><small>CRISIS CONTRACT · ${mode === 'quad' ? t('四人') : t('单人')}</small>
            <h2>${t('BAN 地图')} <em>${bans.length} / ${cap}</em></h2></div>
          <button type="button" class="cs-sheet__x" onClick=${onClose} aria-label=${t('关闭')}></button>
        </header>
        <p>${t('禁用的地图不会进入本局随机地图池，至少保留一张可用地图。')}</p>
        <div class="cs-map-grid">
          ${options.map((map, i) => {
            const banned = bans.includes(map.id);
            const last = !banned && bans.length >= cap;
            return html`
              <button type="button" key=${map.id} class=${cx('cs-map-choice', banned && 'is-banned')}
                role="checkbox" aria-checked=${banned} disabled=${last}
                title=${last ? t('至少保留一张可用地图') : map.name}
                onClick=${() => onChange(banned ? bans.filter((id) => id !== map.id) : [...bans, map.id])}>
                <span class="cs-map-choice__number">${String(i + 1).padStart(2, '0')}</span>
                <span class="cs-map-choice__name">${map.name}
                  <small>${last ? t('最后一张可用地图') : banned ? t('本局禁用') : t('可随机选中')}</small></span>
                <b>${banned ? 'BAN' : t('可用')}</b>
              </button>`;
          })}
        </div>
        <footer><span>${t('本局可用')} <b>${options.length - bans.length}</b> ${t('张 · 不改变合约分数')}</span>
          <button type="button" class="cs-map-clear" disabled=${!bans.length} onClick=${() => onChange([])}>${t('全部恢复')}</button>
        </footer>
      </section>
    </div>`;
}

// ---- first-visit guide (official crisisPages.js:455) ---------------------------------------------------------
// Every step is laid out in the reference video's pixels on the fixed 1280x720 stage, so the boxes are absolute;
// the box's 2000px box-shadow is what dims the rest of the page. Step 2 waits for the pick itself.
const GUIDE_STEPS = [
  { text: N_('在危机合约中，可自由选择指标组合，进行战斗挑战。'), banner: true },
  { box: [113, 148, 93, 115], tip: [210, 165, 333, 60], hand: [168, 205], wait: true,
    text: [N_('点击一个初始状态的'), N_('指标'), N_('即可'), N_('选中'), N_('该指标。')] },
  { box: [936, 87, 332, 124], tip: [618, 105, 312, 70], cont: [660, 190],
    text: [N_('已经选择的'), N_('指标'), N_('将展示在此处，同时可以查看具体的'), N_('指标效果'), '。'] },
  { box: [20, 108, 930, 472], tip: [333, 62, 307, 90], cont: [390, 163],
    text: [N_('指标按'), N_('风险'), N_('分为1—3级，不冲突的指标可以'), N_('叠加'), N_('选择。同一指标的不同等级、领袖登场方案之间存在'), N_('冲突'), N_('；部分指标'), N_('需要'), N_('先选对应的领袖方案，或本局种子里有其目标。')] },
  { box: [936, 624, 326, 73], tip: [630, 558, 310, 62], cont: [720, 625],
    text: [N_('选择指标后，点击此处即可开始挑战。')] },
];

/** The step text with its emphasised words: pairs of [plain, <em>strong</em>, plain, …]. */
function guideText(parts) {
  return parts.map((s, i) => (i % 2 ? html`<em>${s}</em>` : s));
}

function Guide({ step, onNext, onSkip, picked }) {
  const s = GUIDE_STEPS[step];
  // step 2 waits for the pick itself (the page advances it); if a tag is already picked it is passed
  useEffect(() => { if (s.wait && picked) onNext(); }, [step, picked]);
  const px = (v) => v + 'px';
  if (!s) return null;
  return html`
    <div class=${cx('cs-guide', s.banner && 'is-banner', s.wait && 'is-wait')} onClick=${s.wait ? null : onNext}>
      ${s.banner
        ? html`<div class="cs-guide__banner">${s.text}</div><div class="cs-guide__cont" style=${{ left: '540px', top: '112px' }}>${t('点击任意处继续')}</div>`
        : html`
          <i class="cs-guide__box" style=${{ left: px(s.box[0]), top: px(s.box[1]), width: px(s.box[2]), height: px(s.box[3]) }}></i>
          <div class=${cx('cs-guide__tip', s.wait && 'has-arrow')} style=${{ left: px(s.tip[0]), top: px(s.tip[1]), width: px(s.tip[2]), minHeight: px(s.tip[3]) }}><p>${guideText(s.text)}</p></div>
          ${s.hand ? html`<i class="cs-guide__hand" style=${{ left: px(s.hand[0]), top: px(s.hand[1]) }}></i>` : null}
          ${s.cont ? html`<div class="cs-guide__cont" style=${{ left: px(s.cont[0]), top: px(s.cont[1]) }}>${t('点击任意处继续')}</div>` : null}`}
      <button type="button" class="cs-guide__skip" onClick=${(e) => { e.stopPropagation(); onSkip(); }}>${t('跳过引导')}</button>
    </div>`;
}

/** 综合情报: the official stage/enemy briefing, the picks sorted by tier, and the running total (crisisPages.js:494). */
function IntelSheet({ rows, total, mode, desc, onToggleSort, onEnemies, onClose }) {
  return html`
    <aside class="cs-sheet" onClick=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="cs-sheet__panel">
        <header>// ${t('综合情报')}<button type="button" class="cs-sheet__x" onClick=${onClose} aria-label=${t('关闭')}></button></header>
        <div class="cs-intel__info">
          <h4>${t('关卡信息')}</h4>
          <p>${t('- 行动包含4个波次的连续战斗，击败所有波次的敌人后行动成功。')}<br />
            ${t('- 波次间会掉落治愈团块，触碰后可为全队干员回复生命值。')}<br />
            ${t('- 波次间有休整时间，此时不会视为脱离战斗。')}<br />
            ${t('- 行动存在倒计时，倒计时结束或全队干员生命值归零均会导致行动中断。')}<br />
            ${t('- 禁止使用战术物品和消耗品。')}</p>
          <h4>${t('敌人信息')}</h4>
          <p>${t('- 敌人由各路领袖及其护卫、特训精英构成。')}<br />
            ${t('- 部分敌人会对干员施加异常状态，叠加到一定程度时，干员会陷入晕眩。')}</p>
        </div>
        <button type="button" class="cs-intel__enemies" onClick=${onEnemies}>
          <img src=${CC_UI + 'icon-enemies.png'} alt="" /><span>${t('敌人详情')}</span>
        </button>
        <i class="cs-sheet__vsep"></i>
        <div class="cs-intel__sum">
          <span>${t('当前指标总计')}</span>
          <b><span class="num">${total}</span><img class="cs-star" src=${CC_UI + 'star.png'} alt="" /></b>
        </div>
        <div class="cs-intel__list">
          ${rows.length ? rows.map((tag) => html`
            <div key=${tag.id} class="cs-item cs-item--sheet">
              <span class="cs-lv" style=${{ background: LV_COLOR[tag.lv - 1] }}>
                <b class="num">${tag.lv}</b><img class="cs-star" src=${CC_UI + 'star.png'} alt="" />
              </span>
              <${CrisisGlyph} tag=${tag} class="cs-item__glyph" />
              <i class="cs-item__sep"></i>
              <${ItemText} tag=${tag} mode=${mode} />
              <img class="cs-item__flag" src=${CC_UI + 'flag.png'} alt="" />
            </div>`) : html`<div class="cs-empty"><b>${t('- 暂无指标 -')}</b></div>`}
        </div>
        <div class="cs-intel__sort">
          <span>${t('指标等级')}</span><i class="cs-caret"></i>
          <button type="button" onClick=${onToggleSort}>${desc ? t('降序') : t('升序')}
            <img class=${desc ? '' : 'is-up'} src=${CC_UI + 'icon-sort.png'} alt="" /></button>
        </div>
        <i class="cs-sheet__hatch"></i>
      </div>
    </aside>`;
}
export function CrisisSelect({ skin = 'rekindle', onClose, onCreate, busy = false, online = true }) {
  // 官方的舞台缩放: .cc-stage is a fixed 1280x720 stage; --cc-s fits it to the viewport (css/crisis-event.css).
  const [ccScale, setCcScale] = useState(1);
  useEffect(() => {
    const fit = () => {
      const s = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
      setCcScale(s);
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);

  const [mode, setMode] = useState('solo');
  const [picked, setPicked] = useState([]);
  // 首次进入的引导: null = done/skipped. The step 2 pick is observed, so the guide advances itself.
  const [guide, setGuide] = useState(() => (loadPref('crisis.guide', '') ? null : 0));
  const endGuide = useCallback(() => { setGuide(null); savePref('crisis.guide', '1'); }, []);
  // BAN 地图: the list rides crisis.preview (the server drops the ids from the map pool) and room.create.crisis.
  const mapBan = useCrisisMapBans(mode);
  // 地图预览: the stage currently being explained (null = closed). Opened from the 开局种子 line.
  const [mapView, setMapView] = useState(null);
  // 种子码 dialog: open/closed. Applying a code re-draws the run exactly like typing the seed.
  const [seedDlg, setSeedDlg] = useState(false);
  const [latest, setLatest] = useState(null);
  const [hover, setHover] = useState(null);
  const [seed, setSeed] = useState(null);
  const [preview, setPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [scroll, setScroll] = useState(0);
  const [sheet, setSheet] = useState(null);   // null | 'intel' — the official 综合情报 overlay
  const [sortDesc, setSortDesc] = useState(true);
  const [sortBy, setSortBy] = useState('order');   // 官方 cs-sort：'order' 选入顺序 / 'level' 指标等级
  const [sortMenu, setSortMenu] = useState(false); // 官方 cs-menu 展开态
  const alive = useRef(true);
  const track = useRef(null);
  useEffect(() => () => { alive.current = false; }, []);
  const seedRef = useRef(null);
  /* 横向滚轮：必须是非 passive 的 addEventListener —— Preact/React 的 onWheel 在 root 上被动注册，
     preventDefault() 会被忽略，竖向滚轮照样滚页面，轨道不动。用户实测「横向滚动没适配」即此。
     竖向 ΔY 映射到 scrollLeft；shift+滚轮 / 纯横向 ΔX 交回浏览器默认。 */
  /* ★ 关键：事件**根本到不了 .cs-track** —— 实测 elementFromPoint(500,300) 返回 `.cs-board__hit`
     （那是 .cs-board 里的一层 <i> 命中层，压在轨道上面），滚轮被它吃掉。
     所以监听挂到 **.cs-board** 上，靠冒泡接住；同时必须 { passive:false } 才能 preventDefault。 */
  useEffect(() => {
    const host = track.current && track.current.closest('.cs-board');
    if (!host) return undefined;
    const onWheel = (e) => {
      if (e.shiftKey) return;
      const el = track.current;
      if (!el) return;
      const dx = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
      if (!dx) return;
      const max = el.scrollWidth - el.clientWidth;
      if (max <= 0) return;
      const next = Math.max(0, Math.min(max, el.scrollLeft + dx));
      if (next === el.scrollLeft) return;
      e.preventDefault();
      el.scrollLeft = next;
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);
  useEffect(() => { seedRef.current = seed; }, [seed]);

  // 弧光作战的选择指标页也播 ARC_MENU（battleplan.mp3）—— 这一页由 lobby.js 直接挂，不经过 CrisisEventPage，
  // 所以曲目从 crisisEventPage 的 arcAudio() 复用（读 data/assets.json 的 audio.bgm.arcLobby/arcCombat），不写死路径。
  // 重燃不接（官方那三首没有文件）。卸载时清掉，回到大厅的 lobby 曲。
  useEffect(() => {
    if (skin !== 'arclight') return undefined;
    audio.setArcBgm(arcAudio());
    return () => audio.setArcBgm(null);
  }, [skin]);

  // 赛季: '' = 重燃作战 (the main board), 'arc' = 弧光作战. The season picks the route table, so the whole page follows.
  // 官方 crisisPages.js:180-181 —— skin 由父组件传入，页面内没有赛季切换按钮。
  // 'rekindle' = 重燃测试作战（CRISIS_ROUTES），'arclight' = 弧光作战（ARC_ROUTES + is-arclight 皮肤）。
  const isArc = skin === 'arclight';
  // 官方 crisisRecords.readBest：分季分模式的本机最高纪录（rn1 重燃 / arc1 弧光）。
  // 全服排行榜按用户要求不做，这里只读 localStorage。
  const rules = isArc ? 'arc1' : 'rn1';
  const [best, setBest] = useState(() => readBest('solo', rules));
  useEffect(() => subscribeBest((m, v, r) => { if (r === rules && m === mode) setBest(v); }), [mode, rules]);
  // 切模式要重读该模式的纪录（官方 crisisPages.js:264 同一行为）
  useEffect(() => { setBest(readBest(mode, rules)); }, [mode, rules]);
  const season = isArc ? 'arc' : '';
  const S = SEASONS.find((x) => x.id === season) || SEASONS[0];
  const board = useMemo(() => boardFor(mode, S), [mode, S]);
  const selection = useMemo(() => ({ mode, tags: picked, ...(season ? { season } : {}) }), [mode, picked, season]);
  // the SAME check the server runs: the page never offers something create() would refuse
  const checked = useMemo(() => checkCrisis(selection), [selection]);
  const total = checked ? checked.total : 0;

  const tagOf = useCallback((id) => {
    const route = S.routes[id.replace(/-\d+$/, '')];
    if (!route) return null;
    const i = Number(id.slice(id.lastIndexOf('-') + 1)) - 1;
    const rows = route.risk ? route.risk[mode] : null;
    const lv = Array.isArray(rows) ? rows[i] : 0;
    // the route's own effect text, with THIS tier's value lit — the same table the official page renders
    const fx = crisisFxText(route.id, mode, i + 1);
    // 「未实装」只对重燃作战（CRISIS_FX 的 89 条）成立：CRISIS_IMPLEMENTED 记的是本版本真正接上引擎的那些。
    // 弧光作战是另一套规则表（crisisArc.js 的 69 条，id 是 XA1…XO6）—— CRISIS_ROUTES 把两个赛季合在一起，
    // 所以这里不能用「在不在路由表里」判断，只能用「在不在主表 fx 表里」。
    const impl = !(route.id in CRISIS_FX) || isCrisisImplemented(route.id);
    // tier 是 1 起的档位（i 是 0 起的下标）—— crisisGlyph.js 的等级角标 tag-num<N>.png 读它。
    // ★ 网页版（sh.bbsmc.cn/v024）实测：**任何一档**都带 tag-num 角标，1 级也带（XA1 显示「Ⅰ」）。
    //   原先漏传 tier ⇒ tag.tier 恒 undefined ⇒ 角标一次都没渲染过，这就是用户图五说的「等级标识没移植」。
    return { id, route, lv, tier: i + 1, fx: fx ? fx.text : null, impl };
  }, [mode, S]);

  /** The routes a tag waits on — the same crisisNeeds table the server checks. */
  const needsOf = useCallback((tag, ids) => {
    if (!tag) return null;
    const routeIds = ids.map((x) => x.replace(/-\d+$/, ''));
    const missing = season ? tag.route.needs : crisisNeeds(tag.route, routeIds);
    return missing && missing.length ? missing : null;
  }, []);

  // NOTE the functional update: `toggle` closes over the `picked` of the render that produced it, and two clicks
  // inside one render (e.g. picking tier 2 right after tier 1) would both read the SAME stale array — the second
  // would then overwrite the first instead of replacing it. The server-issued rules are read from the fresh copy.
  const toggle = (tag) => {
    if (!tag) return;
    setPicked((prev) => {
      if (prev.includes(tag.id)) {
        setLatest((l) => (l === tag.id ? null : l));
        return prev.filter((x) => x !== tag.id);
      }
      // 官方 crisisPages.js:251 —— `rest = order.filter(x => !T.conflicts(tagOf(x), tag))`：
      // 选新档时把冲突项**静默摘掉**（同路由的另一档也一并摘），再 push 新档。
      // 官方**不弹 toast、不 return**；图三那种「已选 XA3，另一档标冲突」只是渲染态，点了就是换档。
      const rest = prev.filter((x) => {
        const o = tagOf(x);
        return !(o && S.conflict(o, tag));
      });
      setLatest(tag.id);
      return [...rest, tag.id];
    });
  };

  // The answers arrive as their own pushed messages ('crisis.preview' / 'crisis.seed'), NOT as the return value
  // of net.request: server/net.js answer() reduces a handler's { ok: true } to the bare { t: 'ok', rid } ack, so a
  // value attached to it never reaches the page.
  useEffect(() => {
    const offPreview = net.on('crisis.preview', (msg) => {
      if (!alive.current) return;
      const p = msg && msg.preview;
      setPreview(p || null);
      setLoading(false);
      setError(null);
      if (p && isCrisisSeed(p.seed) && !isCrisisSeed(seedRef.current)) setSeed(p.seed);
    });
    const offSeed = net.on('crisis.seed', (msg) => {
      if (alive.current && msg && isCrisisSeed(msg.seed)) setSeed(msg.seed);
    });
    return () => { offPreview(); offSeed(); };
  }, []);

  // ask again whenever the selection changes — debounced, because every edit changes the answer
  useEffect(() => {
    if (!checked) { setPreview(null); return undefined; }
    let cancelled = false;
    setLoading(true);
    setError(null);
    const timer = setTimeout(() => {
      // bans ride along so the previewed map is the one the match will draw (the server drops them from the pool)
      net.request('crisis.preview', { mode, tags: picked, ...(season ? { season } : {}), ...(isCrisisSeed(seed) ? { seed } : {}), ...(mapBan.bans.length ? { bans: mapBan.bans } : {}) })
        .catch((e) => { if (!cancelled && alive.current) { setError(e && e.code ? e.code : 'PREVIEW_FAILED'); setLoading(false); } });
    }, 180);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [mode, season, picked, seed, checked, mapBan.bans]);

  /** The seed preview's line for a tag: the rounds its enemies come in (14 = 终局突袭). */
  /* 悬停说明（官方 crisisPages.js 的 title）：`id 组·名（级）` + 换行 + 本档效果文案 + 换行 + 本局目标。
     官方把整段塞进原生 title 属性，浏览器自己弹浮层，没有自定义 tooltip 组件。 */
  const fxTextOf = (tag) => {
    if (!tag) return '';
    const r = crisisFxText(tag.route.id, mode, tag.lv);
    return r && r.text ? r.text : '';
  };

  const whereOf = (tag) => {
    if (!preview || !tag || !tag.route.targets) return null;
    const rounds = preview.rounds && preview.rounds[tag.id];
    if (!Array.isArray(rounds) || !rounds.length) return null;
    return t('本局目标：{rounds}', { rounds: rounds.map((r) => (r === 14 ? t('终局突袭') : t('第{n}回合', { n: r }))).join('、') });
  };

  const list = picked.map((id) => tagOf(id)).filter(Boolean);
  const groupSum = (g) => list.reduce((n, x) => n + (x.route.g === g ? x.lv : 0), 0);
  // 综合情报 lists the picks by tier (the official page sorts by 指标等级, desc by default)
  // 主列表（cs-list）与综合情报（IntelSheet）用**同一套**排序 —— 官方 crisisPages.js:268-272 的 list。
  const sortedList = list.slice().sort((a, b) => {
    const ai = picked.indexOf(a.id), bi = picked.indexOf(b.id);
    const d = sortBy === 'level' ? (a.lv - b.lv) || (ai - bi) : (ai - bi);
    return d * (sortDesc ? -1 : 1);
  });
  const intelRows = sortedList;
  // 用户图三/图四：网页版这一格显示的是**种子码**（2RFJ-CBRQ 这种 8 位 Crockford base-32），
  // 不是十进制数字。原先 `String(seed)` 直接把 24901833 摆出来 —— 既不可读也不可分享。
  const seedText = isCrisisSeed(seed) ? (seedCode(seed) || '—') : '—';

  return html`
    <div class="cc-host">
      <div class="cc-root" style=${{ '--cc-s': ccScale, '--cc-scale': 'scale(' + ccScale + ')' }}>
      <div class="cc-main">
        <div class=${cx('cc-page cs-page', isArc && 'is-arclight')}>
          ${/* 官方 crisisPages.js:328 —— 重燃的底是 .cc-bleed（inset:-40px + background cover），
              **不是** .cc-plate。.cc-plate 是 position:absolute;inset:0;width:1280px;height:720px，
              作为 .cc-page 的直接子级完全不跟 .cc-stage 的 scale() ⇒ 只以 1280×720 贴在左上角，
              比缩放后的舞台小 1.27 倍还偏左上（用户图一的「背景往左上偏移」）。 */''}
          ${isArc ? html`<div class="ca-fill ca-fill--cover"></div><div class="ca-acrylic"></div>`
            : html`<div class="cc-bleed" style=${{ backgroundImage: 'url(' + CC_UI + 'sel-plate.jpg)' }}></div>`}
          <div class="cc-stage">
          ${isArc ? html`
            <i class="cs-rpanel"></i>
            <img class="cs-bbar" src=${CC_ART + 'bottom-menu-bg.png'} alt="" />
            <button type="button" class="ca-back" onClick=${onClose} aria-label=${t('返回')} title=${t('返回')}>
              <img src=${CC_ART + 'btn-backbutton.png'} alt="" /></button>
            ${/* 用户第十次纠正：弧光指标页也不要 i（「i在弧光作战的指标页还有」）。
                官方 crisisPages.js:333 有它，但用户要删 —— 删掉本元素，覆盖它的 CSS 一并失效。 */''}
            <span></span>` : html`
            <div class="cc-crumb">// ${t('危机合约')} · ${t('重燃测试作战')}</div>
            <div class="cs-title"><i class="cs-title__block"></i>${t('选择指标')}<span class="cs-title__deco"><i></i><i></i><i></i><i></i><b></b></span></div>
            <i class="cs-topline"></i>
            <button type="button" class="cc-x" onClick=${onClose} aria-label=${t('关闭')} title=${t('关闭')}>
              <svg viewBox="0 0 20 20"><path d="M5 5l10 10M15 5L5 15" /></svg></button>`}

          <div class="cs-mode" role="radiogroup" aria-label=${t('合约模式')}>
            ${MODES.map((m) => html`
              <button type="button" key=${m.id} role="radio" aria-checked=${mode === m.id ? 'true' : 'false'}
                class=${mode === m.id ? 'is-on' : ''}
                onClick=${() => { if (mode !== m.id) { setMode(m.id); setPicked([]); setLatest(null); } }}>${t(m.name)}</button>`)}
          </div>
          <button type="button" class="cs-pill cs-pill--first" onClick=${() => setSheet('first')}>
            <img src=${CC_UI + 'star.png'} alt="" /><span>${t('首通奖励')}</span><i>?</i></button>
          ${/* 官方 crisisPages.js:344 —— 这颗是「导入与分享」，不是「综合情报」。 */''}
          <button type="button" class="cs-pill cs-pill--share" onClick=${() => setSheet('share')}>
            <span>${t('导入与分享')}</span><img src=${CC_UI + 'icon-share.png'} alt="" /></button>
          <i class="cs-vsep"></i>
          <div class=${cx('cs-sort', sortMenu && 'is-open')}>
            <button type="button" class="cs-sort__pick" onClick=${() => setSortMenu(!sortMenu)}>
              <span>${sortBy === 'order' ? t('选入顺序') : t('指标等级')}</span><i class="cs-caret"></i></button>
            <button type="button" class="cs-sort__dir" onClick=${() => setSortDesc((d) => !d)}>
              <span>${sortDesc ? t('降序') : t('升序')}</span>
              <img class=${sortDesc ? '' : 'is-up'} src=${CC_UI + 'icon-sort.png'} alt="" /></button>
            ${sortMenu ? html`<div class="cs-menu">${[['order', t('选入顺序')], ['level', t('指标等级')]].map(([k, n]) => html`
              <button type="button" class=${sortBy === k ? 'is-on' : ''} onClick=${() => { setSortBy(k); setSortMenu(false); }}>${n}${sortBy === k ? html`<i class="cs-tick"></i>` : null}</button>`)}</div>` : null}
          </div>

          <section class="cs-board">
            ${[1, 2, 3].map((lv) => html`
              <div class="cs-row" key=${lv} style=${{ top: ROW_Y[lv - 1] + 'px', '--lc': LV_COLOR[lv - 1] }}>
                <div class="cs-row__label">
                  <b class="num">${lv}</b><img class="cs-star" src=${CC_UI + 'star.png'} alt="" />
                  <span class="cs-row__tri">${Array.from({ length: lv }, () => html`<i></i>`)}</span>
                </div>
                <div class="cs-row__band"></div>
              </div>`)}
            <i class="cs-board__sep"></i>
          <i class="cs-board__hit"></i>
            ${/* ★ React 的 onWheel 是挂在 root 上的**被动**监听（passive:true）⇒ preventDefault() 无效，
                浏览器照样把竖向滚轮交给页面滚动，轨道根本不横移。用户实测「鼠标横向滚动没有适配」就是这个。
                改成 ref + addEventListener('wheel', h, { passive: false }) 手动注册。 */''}
            <div class="cs-track" ref=${track} onScroll=${(e) => setScroll(e.currentTarget.scrollLeft)}>
              <div class="cs-track__in" style=${{ width: board.width + 'px' }}>
                ${board.groups.map((gr, gi) => html`
                  <div class="cs-ghead" key=${gr.g} style=${{ left: gr.x0 + 'px', width: gr.x1 - gr.x0 + 'px' }}>
                    <b>${gr.g}</b><span>${t(S.groups[gr.g] || gr.g)}</span>
                    ${groupSum(gr.g) ? html`<em class="num">${groupSum(gr.g)}</em>` : null}
                  </div>
                  ${gi ? html`<i class="cs-gsep" style=${{ left: gr.x0 - GGAP / 2 - 13 + 'px' }}></i>` : null}`)}
                ${board.cols.flatMap((c) => c.rows.slice(0, -1).map((r, li) => (
                  c.rows[li + 1] === r + 1
                    ? html`<i class="cs-link" key=${c.route.id + '-l' + li} style=${{ left: c.x + 33 + 'px', top: ROW_Y[r - 1] + 108 + 'px' }}><b></b><b></b></i>`
                    : null)))}
                ${board.cols.flatMap((c) => c.rows.map((lv, i) => {
                  const tag = tagOf(c.route.id + '-' + (i + 1));
                  const on = picked.includes(tag.id);
                  // 官方 crisisPages.js:218 —— clashWith 直接问 T.conflicts，**不跳过同路由**：
                  // 同路由的另一档在视觉上就是「冲突」（图三 XA3 I 档那种），点下去才由 toggle 替换。
                  const clash = on ? null : picked.find((x) => {
                    const o = tagOf(x);
                    return o && S.conflict(tag, o);
                  });
                  const needs = on ? null : needsOf(tag, picked);
                  const showCancel = on && (hover === tag.id || (latest === tag.id && hover == null));
                  return html`
                    <button type="button" key=${tag.id}
                      class=${cx('cs-tile', on && 'is-on', clash && 'is-clash', needs && 'is-needs', latest === tag.id && on && 'is-latest', !tag.impl && 'is-gap')}
                      style=${{ left: c.x + 'px', top: ROW_Y[lv - 1] + 14 + 'px' }}
                      onClick=${() => toggle(tag)} onMouseEnter=${() => setHover(tag.id)} onMouseLeave=${() => setHover(null)}
                      title=${tag.route.id + ' ' + t(S.groups[tag.route.g] || tag.route.g) + '·' + tag.route.name
                        + ROMAN[tag.tier - 1]
                        + '（' + tag.lv + t('级') + '）'
                        + (fxTextOf(tag) ? '\n' + fxTextOf(tag) : '')
                        + (whereOf(tag) ? '\n' + whereOf(tag) : '')}>
                      <img class="cs-tile__flag" src=${CC_UI + 'flag.png'} alt="" draggable=${false} />
                      <${CrisisGlyph} tag=${tag} class="cs-tile__glyph" />
                      ${/* 用户图五：格子右下角要带编号（XA1 / XA2 / XB1 …）。
                           ★ route.id **本身已经含等级**（XA11 / XA12 / XA21 …），别再拼 tag.lv ——
                             实测拼了会变成 XA11、XA12 这种双份等级。 */''}
                      <span class="cs-tile__id">${tag.route.id}</span>
                      ${!tag.impl ? html`<span class="cs-tile__gap">${t('未实装')}</span>` : null}
        ${on ? html`<i class="cs-tile__check"></i>` : null}
                      ${clash ? html`<span class="cs-tile__clash">${t('冲突')}<i></i></span>` : null}
                      ${!clash && needs ? html`<span class="cs-tile__note">${t('需')}<br />${needs.join('/')}</span>` : null}
                      ${latest === tag.id && on ? html`<i class="cs-tile__mark"></i>` : null}
                      ${showCancel ? html`<span class="cs-tile__cancel">${t('取消选择')}</span>` : null}
                    </button>`;
                }))}
                ${board.cols.flatMap((c) => [1, 2, 3].filter((lv) => !c.rows.includes(lv)).map((lv) => html`
                  <i class="cs-tile cs-tile--void" key=${c.route.id + '-v' + lv} style=${{ left: c.x + 'px', top: ROW_Y[lv - 1] + 14 + 'px' }}></i>`))}
              </div>
            </div>
            ${scroll > 4 ? html`
              <button type="button" class="cs-scroll cs-scroll--l" aria-label=${t('向左')}
                onClick=${() => track.current.scrollBy({ left: -4 * PITCH, behavior: 'smooth' })}></button>` : null}
            ${scroll < board.width - VIEW_W - 4 ? html`
              <button type="button" class="cs-scroll cs-scroll--r" aria-label=${t('向右')}
                onClick=${() => track.current.scrollBy({ left: 4 * PITCH, behavior: 'smooth' })}></button>` : null}
          </section>

          <section class="cs-list">
            ${/* 官方 crisisPages.js:392 —— 等级徽章(重燃 cs-lv / 弧光 ca-lv) + 图标 + 分隔线 + 文本。 */''}
            ${/* 官方 crisisPages.js:392 —— 主列表读的就是**排过序**的列表（官方 list 由 useMemo 按
                sortBy/desc 产出，见 :268-272）。这里原来用的是未排序的 picked 原始数组 ⇒
                切「选入顺序 / 指标等级」时主列表毫无变化（用户报的「排序怎么调都不生效」）。 */''}
            ${sortedList.length ? sortedList.map((tag) => html`
              <div key=${tag.id} class="cs-item">
                ${isArc
                  ? html`<span class=${cx('ca-lv', tag.lv >= 3 && 'is-hi')} style=${{ borderImageSource: `url(${CC_ART}slot-bg.png)` }}>
                      <i style=${{ '--m': `url(${CC_ART}rune-detail-item-point-dec.png)` }}></i><b class="num">${tag.lv}</b></span>`
                  : html`<span class="cs-lv" style=${{ background: LV_COLOR[tag.lv - 1] }}>
                      ${latest === tag.id ? html`<i class="cs-lv__arrow"></i>` : null}<b class="num">${tag.lv}</b>
                      <img class="cs-star" src=${CC_UI + 'star.png'} alt="" />
                    </span>`}
                <${CrisisGlyph} tag=${tag} class="cs-item__glyph" />
                <i class="cs-item__sep"></i>
                <${ItemText} tag=${tag} mode=${mode} where=${whereOf(tag)} />
                <img class="cs-item__flag" src=${CC_UI + 'flag.png'} alt="" />
                <button type="button" class="cs-item__del" aria-label=${t('移除')}
                  onClick=${() => { setPicked((prev) => prev.filter((x) => x !== tag.id)); setLatest((l) => (l === tag.id ? null : l)); }}><i></i></button>
              </div>`) : html`
              <div class="cs-empty"><b>${t('- 暂无指标 -')}</b><span>${t('可在上方选择指标')}</span></div>`}
          </section>

          ${/* 官方 crisisPages.js:401 —— 弧光是一个 btn-clear.png 图标按钮（样式表把里面的 <i> 藏掉），
              重燃才是 <i></i>清空选择 那个 CSS 画的圆环箭头。 */''}
          ${/* 官方 crisisPages.js:401 —— 弧光的垃圾桶是**常驻**的（btn-clear.png），
              没有选择时靠 disabled + opacity:.45 变灰，而不是整颗消失。
              重燃那份官方是 ${order.length ? <button> : null}，保持原样。 */''}
          ${isArc ? html`
            <button type="button" class="cs-clear" disabled=${!picked.length}
              onClick=${() => { setPicked([]); setLatest(null); }}
              aria-label=${t('清空选择')} title=${t('清空选择')}>
              <img src=${CC_ART + 'btn-clear.png'} alt="" /></button>`
            : picked.length ? html`
            <button type="button" class="cs-clear" onClick=${() => { setPicked([]); setLatest(null); }}>
              <i></i>${t('清空选择')}</button>` : null}

          ${/* 开局种子 + 种子码 合成一个控件（官方是两个：cs-seed 换种子 / cs-seedcode 输码）。
             点开既是出怪顺序预览，也是种子码输入框 —— 查看与改写同一处。 */''}
          <button type="button" class=${cx('cs-seed', error && 'is-error')}
            title=${error ? t('读取开局信息失败，点击重试') : t('开局种子：点开查看每回合出怪顺序，也可输入别人的种子码')}
            onClick=${() => setSeedDlg(true)}>
            <i></i><b>${t('开局种子')}</b><span class="num">${seedText}</span>
            <small>${error ? t('开局信息读取失败，点击重试')
              : loading ? t('正在读取开局信息…')
              : preview ? t('只决定出怪顺序 · 点击查看')
              : t('点击查看或更换种子')}</small>
          </button>
          ${/* 官方全文没有 .cs-mapview 这个控件（crisisPages.js 出现 0 次）；地图预览走开局种子的 <small> 行，弧光另有 .ca-mapview 固定卡。整块删掉。 */''}

          ${/* 官方 crisisPages.js:402(arc) / :405(重燃) —— 这一块是**最高纪录**（指标总计在 .cs-score 里，不是这里）。
              arc 版 `style=backgroundImage:display-record-bg.png`；重燃官方只有 <Star big> + 数字 + 文案。
              用户要求「重燃这个元素同步成弧光样式」⇒ 两季都用 display-record-bg.png、都不放 star。 */''}
          ${/* 用户第十次：最高纪录放回左下角、**去掉背景**。
              所以只有弧光保留 display-record-bg.png；重燃用官方原样的无背景版。 */''}
          ${/* 用户 2026-11-08 17:04：直接去除背景（图二没有那块灰底）。内联 style 的 backgroundImage
                优先级高于任何类规则，所以必须在这里不传，纯靠 CSS 清不干净。 */''}
          <div class="cs-record">
            ${/* 用户 2026-11-08 17:04 / 17:30 两轮裁决。
                 17:04「你还不如不撤掉...大不了就行网页(图二)一样,直接去除背景」⇒ 弧光恢复独立 star、去背景。
                 17:30「重燃作战的最高记录怎么移下去了」⇒ **这套结构只能给弧光**：
                 重燃页 .cs-record 只有 140x50 的官方小格子，塞进 star+col 会把数字/文字挤烂。
                 所以按赛季分支：arc 走 [star + col]，重燃保持官方原样的 <b>+<span>。 */''}
            ${isArc ? html`<img class="cs-star cs-star--big" src=${CC_UI + 'star-big.png'} alt="" />
              <span class="cs-record__col"><b class="num">${best}</b>
                <span>${mode === 'quad' ? t('四人最高纪录') : t('单人最高纪录')}</span></span>`
              : html`<img class="cs-star cs-star--big" src=${CC_UI + 'star-big.png'} alt="" />
                <b class="num">${best}</b><span>${mode === 'quad' ? t('四人最高纪录') : t('单人最高纪录')}</span>`}
          </div>
          <i class="cs-bsep"></i>
          <i class="cs-bottomline"></i>
          ${/* 图五：官方 arc 的 .cs-score 是四层图叠出来的（btn-score 底 + halftone 色调 + diagram 线框 + 数字），
             重燃只有一个 <b> 加一颗星。 */''}
          ${isArc ? html`<div class="cs-score">
            <img class="cs-score__bg" src=${CC_ART + 'btn-score.png'} alt="" />
            <img class="cs-score__tone" src=${CC_ART + 'score-bg-halftone.png'} alt="" />
            <span class="cs-score__diagram"><img src=${CC_ART + 'diagram-bkg.png'} alt="" /><img src=${CC_ART + 'diagram-outline.png'} alt="" /></span>
            <b class="num">${picked.length ? (checked ? total : '--') : '--'}</b><small>${t('指标总计')}</small>
          </div>` : html`<div class="cs-score"><b class="num">${picked.length ? (checked ? total : '--') : '--'}</b>
            <img class="cs-star" src=${CC_UI + 'star.png'} alt="" /></div>`}
          ${/* 官方 arc 没有 cs-map-ban，改用 ca-mapview：一张固定地图的预览卡（地图固定为本期台面）。 */''}
          ${isArc ? html`<button type="button" class="ca-mapview" onClick=${() => setMapView(getStage(preview && preview.stageId) || null)} title=${t('查看本期固定地图')}>
            <img src=${CC_ART + 'map-focus.webp'} alt="" /><span><small>${t('地图（固定）')}</small><b>${(preview && preview.stage) || t('危机合约 滞空焦点')}</b></span></button>` : html`<button type="button" class=${'cs-map-ban' + (mapBan.bans.length ? ' has-bans' : '')}
            disabled=${!mapBan.ready} onClick=${() => setSheet('mapban')}
            title=${mapBan.ready ? (mapBan.bans.length ? mapBan.options.filter((m) => mapBan.bans.includes(m.id)).map((m) => m.name).join('、') : t('选择本局不出现的地图')) : t('地图列表载入中')}>
            <span>⊘</span><b>${t('BAN 地图')}</b>
            <small>${mapBan.ready ? mapBan.bans.length + ' / ' + (mapBan.options.length - 1) : t('载入中…')}</small></button>`}
          <button type="button" class=${cx('cs-go', (!picked.length || !checked || busy) && 'is-idle')}
            disabled=${!online || busy || !checked || !picked.length}
            onClick=${() => checked && onCreate({ ...selection, ...(isCrisisSeed(seed) ? { seed } : {}) })}>
            ${isArc ? html`<img src=${CC_ART + 'btn-start-battle-hard.png'} alt="" /><span>${t('开始行动')}</span>`
              : html`<img src=${CC_UI + 'emblem-go.png'} alt="" /><span>${t('行动开始')}</span><em>${'- > > >'}</em>`}</button>
          </div>
      ${sheet === 'intel' ? html`<${IntelSheet} rows=${intelRows} total=${checked ? total : 0} mode=${mode} desc=${sortDesc} onToggleSort=${() => setSortDesc((d) => !d)} onEnemies=${() => setSheet('enemies')} onClose=${() => setSheet(null)} />` : null}
      ${sheet === 'share' ? html`<${ShareSheet} mode=${mode} tags=${picked} seed=${seed} bans=${mapBan.bans} season=${isArc ? 'arc' : null}
    onApply=${(c) => {
      // 官方 crisisPages.js:276 applyShare —— 换成码里的模式与指标，并带上种子 / BAN 地图
      setMode(c.mode);
      setPicked(c.tags);
      setLatest(null);
      if (c.seed != null) setSeed(c.seed);
      if (c.bans) mapBan.change(c.bans);
      setSheet(null);
    }} onClose=${() => setSheet(null)} />` : null}
  ${sheet === 'enemies' ? html`<${EnemiesSheet} onClose=${() => setSheet(null)} />` : null}
      ${seedDlg ? html`<${SeedCodeDialog} seed=${seed} preview=${preview} isArc=${isArc} onClose=${() => setSeedDlg(false)}
        onApply=${(n) => { setSeed(n); setSeedDlg(false); }} />` : null}
      ${mapView ? html`<${MapPreviewSheet} stage=${mapView} arc=${isArc} onClose=${() => setMapView(null)} />` : null}
      ${sheet === 'first' ? html`<${FirstClearSheet} onClose=${() => setSheet(null)} />` : null}
      ${sheet === 'mapban' ? html`<${MapBanDialog} options=${mapBan.options} bans=${mapBan.bans}
        onChange=${mapBan.change} onClose=${() => setSheet(null)} mode=${mode} />` : null}
      ${guide != null ? html`<${Guide} step=${guide} picked=${picked.length > 0}
        onNext=${() => setGuide((g) => (g >= GUIDE_STEPS.length - 1 ? endGuide() : g + 1))}
        onSkip=${endGuide} />` : null}
        </div>
      </div>
      </div>
    </div>`;
}