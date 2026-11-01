// 名片底图 (移植自 Stronghold-Protocol, 需求方 2026-11-01: 「Q2 ①+②」):
// 底图来自本服务器已有的素材 —— 四张模拟场景加载图（assets.json ui['loading/loading_ac_*']）与阵营徽记
// （ui['campLogo/logo_*']，白徽记配阵营色底）。卡片 id 是 `loading:<key>` 或 `camp:<key>`；未知 id 什么都不显示。
//
// ★ 与源仓的差异（移植时的取舍，需求方知情）：
//   · 源仓的「组织徽记」(23 张 ui['campLogo/logo_babel']…)：**源仓自己也没有这些图** —— assets.json 有条目，但
//     public/assets/ui/campLogo/ 只有 19 张阵营徽记，组织徽记一张都不在盘上。没有素材，也就不可能画（业主明令
//     「不要自己画」），所以这一组**不提供**。
//   · 源仓的 `skin:<id>` 卡片要 assets.json 的 skins[].illustration（约 4 MB 一张全幅立绘）：我方的 assets.json
//     里 315 套皮肤**一套都没有 illustration 字段**（只有 180×360 半身 portrait / avatar / spine）。同样没有素材，
//     所以这一组也**不提供**。将来 build-data 补上 illustration 后，在这里加回 skin 分支即可。
//
// 选择存在浏览器（NAMECARD_PREF），随 room.card 一起发给房间，同盟里的博士都能看到（ui/playerCard.js, server/lobby.js）。
// 底图显示的范围可上下拖动（feedback #61）：y 是百分比（NAMECARD_Y_PREF / room.card bgY）；徽记没有可裁的部分。
// 样式：css/screens/lobby.css（.has-nc / .nc-layer / .nc-pick / .nc-adjust）。
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { data, useData } from '../data.js';
import { t, N_ } from '../../../shared/i18n.js';

export const NAMECARD_PREF = 'room.namecard';
export const NAMECARD_Y_PREF = 'room.namecard.y';

/** A stored or received vertical position: an integer 0–100, else null (the card's default). @param {unknown} y */
export const namecardY = (y) => (Number.isInteger(y) && y >= 0 && y <= 100 ? y : null);

/** The default position of a card (css/screens/lobby.css .nc-layer). */
const defaultY = () => 50;

/**
 * The position after dragging a picture of `aspect` (height / width) by `dy` px in a plate of `width` × `height` drawn
 * `background-size: cover`: the picture follows the pointer (dragging down shows more of its top).
 * @returns {number} an integer 0–100; `from` when the whole height already shows
 */
export function dragNamecardY(from, dy, { width, height, aspect }) {
  const spare = width * aspect - height;
  if (!(spare > 0)) return from;
  return Math.max(0, Math.min(100, Math.round(from - (dy / spare) * 100)));
}

/** The loading pictures (one per simulation difficulty). */
const LOADING = [
  { key: 'prototype', name: N_('模拟·原型') },
  { key: 'core', name: N_('模拟·核心') },
  { key: 'hard', name: N_('模拟·险境') },
  { key: 'abyss', name: N_('模拟·终极') },
];

/** The factions with an emblem in the material, each with a tint for the card behind the white emblem. */
const CAMPS = [
  { key: 'rhodes', name: N_('罗德岛'), tint: '#1f3a4a' },
  { key: 'lungmen', name: N_('龙门'), tint: '#5a2a1c' },
  { key: 'yan', name: N_('炎'), tint: '#6a1f1f' },
  { key: 'higashi', name: N_('东'), tint: '#5c2a3e' },
  { key: 'victoria', name: N_('维多利亚'), tint: '#2a3358' },
  { key: 'kazimierz', name: N_('卡西米尔'), tint: '#4a3b1c' },
  { key: 'laterano', name: N_('拉特兰'), tint: '#5a4c1e' },
  { key: 'leithanien', name: N_('莱塔尼亚'), tint: '#3c2a52' },
  { key: 'columbia', name: N_('哥伦比亚'), tint: '#1f3f58' },
  { key: 'ursus', name: N_('乌萨斯'), tint: '#3a3a3a' },
  { key: 'siracusa', name: N_('叙拉古'), tint: '#4a1e2a' },
  { key: 'iberia', name: N_('伊比利亚'), tint: '#1e3c3c' },
  { key: 'egir', name: N_('阿戈尔'), tint: '#163a4e' },
  { key: 'sargon', name: N_('萨尔贡'), tint: '#5a4418' },
  { key: 'kjerag', name: N_('谢拉格'), tint: '#2c4656' },
  { key: 'sami', name: N_('萨米'), tint: '#24443a' },
  { key: 'minos', name: N_('米诺斯'), tint: '#4e3220' },
  { key: 'bolivar', name: N_('玻利瓦尔'), tint: '#2e4a22' },
  { key: 'rim', name: N_('雷姆必拓'), tint: '#4a3420' },
];

/** 组织徽记 (源仓 public/js/ui/namecards.js ORGS，官方 handbook_team_table 的名字)。徽记素材在 ui['campLogo/logo_*']。 */
const ORGS = [
  { key: 'babel', name: '巴别塔', tint: '#3a3026' },
  { key: 'rhine', name: '莱茵生命', tint: '#1e3a4a' },
  { key: 'penguin', name: '企鹅物流', tint: '#3f3a1c' },
  { key: 'blacksteel', name: '黑钢国际', tint: '#2c2f33' },
  { key: 'karlan', name: '喀兰贸易', tint: '#2a4050' },
  { key: 'glasgow', name: '格拉斯哥帮', tint: '#3a2a2e' },
  { key: 'abyssal', name: '深海猎人', tint: '#14343f' },
  { key: 'siesta', name: '汐斯塔', tint: '#4a3a22' },
  { key: 'dublinn', name: '深池', tint: '#2c3f2a' },
  { key: 'followers', name: '使徒', tint: '#2e2a4a' },
  { key: 'lgd', name: '龙门近卫局', tint: '#512a22' },
  { key: 'pinus', name: '红松骑士团', tint: '#4a2420' },
  { key: 'chiave', name: '贾维团伙', tint: '#2a4438' },
  { key: 'lee', name: '鲤氏侦探事务所', tint: '#3f3320' },
  { key: 'rainbow', name: '彩虹小队', tint: '#2c3440' },
  { key: 'student', name: '乌萨斯学生自治团', tint: '#3c3c44' },
  { key: 'sui', name: '炎-岁', tint: '#5a2a20' },
  { key: 'sweep', name: 'S.W.E.E.P.', tint: '#2a3a36' },
  { key: 'elite', name: '罗德岛-精英干员', tint: '#22323e' },
  { key: 'action4', name: '行动组A4', tint: '#2a3640' },
  { key: 'reserve1', name: '行动预备组A1', tint: '#2a3a44' },
  { key: 'reserve4', name: '行动预备组A4', tint: '#2a3a44' },
  { key: 'reserve6', name: '行动预备组A6', tint: '#2a3a44' },
];
const ORG_IDS = new Set(ORGS.map((c) => `camp:${c.key}`));


/**
 * 特工工牌 (需求方 2026-11-01): 19 tall VALORANT player-card plates, downloaded into public/assets/ui/valBadge/.
 * They are a single vertical plate (268 × 640), so they crop like a 立绘, not like a scene — kind 'badge'.
 * The files are not in git (public/assets/ is ignored, AGENTS.md「No game art in git」): tools/fetch-assets.mjs
 * cannot reach them either, so a machine without them simply shows no 特工工牌 section.
 */
const BADGES = [
  ['jett', N_('奇乐工牌')],
  ['skye', N_('斯凯工牌')],
  ['reyna', N_('芮娜工牌')],
  ['yoru', N_('夜露工牌')],
  ['astra', N_('星礈工牌')],
  ['kayo', N_('K/O工牌')],
  ['chamber', N_('尚勃勒工牌')],
  ['neon', N_('霓虹工牌')],
  ['fade', N_('黑梦工牌')],
  ['iso', N_('壹决工牌')],
  ['gekko', N_('盖可工牌')],
  ['deadlock', N_('暮蝶工牌')],
  ['raze', N_('钢锁工牌')],
  ['vyse', N_('维斯工牌')],
  ['harbor', N_('海神工牌')],
  ['tejo', N_('钛狐工牌')],
  ['waylay', N_('幻棱工牌')],
  ['neon2', N_('禁灭工牌')],
  ['clove', N_('迷核工牌')],
];
const badgeCard = ([key, name]) => Object.freeze({ id: `badge:${key}`, kind: 'badge', name, assetKey: `valBadge/${key}` });

const campCard = (c) => Object.freeze({ id: `camp:${c.key}`, kind: 'camp', name: c.name, tint: c.tint, assetKey: `campLogo/logo_${c.key}` });

/** Every card: { id, kind, name, assetKey, tint? }. */
export const NAMECARDS = Object.freeze([
  ...LOADING.map((c) => Object.freeze({ id: `loading:${c.key}`, kind: 'loading', name: c.name, assetKey: `loading/loading_ac_${c.key}` })),
  ...CAMPS.map(campCard),
  ...ORGS.map(campCard),
  ...BADGES.map(badgeCard),
]);

/** 干员皮肤立绘卡：id `skin:<我方皮肤 id>`。素材挂在 chars[charId].skins[id].illustration（315 套里 302 套有）。 */
const SKIN_CARDS = () => {
  const out = [];
  const m = data.get('assets');
  for (const cid of Object.keys(m?.chars || {})) {
    const sk = m.chars[cid]?.skins;
    if (!sk || typeof sk !== 'object') continue;
    for (const sid of Object.keys(sk)) {
      const rec = sk[sid];
      if (!rec || typeof rec.illustration !== 'string' || !rec.illustration) continue;
      out.push(Object.freeze({ id: `skin:${sid}`, kind: 'skin', name: rec.name || sid, skinId: sid, charId: cid }));
    }
  }
  return new Map(out.map((c) => [c.id, c]));
};
const BY_ID = new Map(NAMECARDS.map((c) => [c.id, c]));

/** 特工工牌 cards, in catalogue order (the seat card's portrait picker lists them after the operators). */
export const BADGE_CARDS = Object.freeze(NAMECARDS.filter((c) => c.kind === 'badge'));

/** The card of an id, or null (unknown / empty). @param {unknown} id */
export function namecardOf(id) {
  if (typeof id !== 'string') return null;
  // A skin card is built on demand: the catalogue lives in the loaded asset index, not in a module constant.
  if (id.startsWith('skin:')) return SKIN_CARDS().get(id) || null;
  return BY_ID.get(id) || null;
}

const safeUrl = (src) => (typeof src === 'string' && src && !/["\\)]/.test(src) ? src : null);

/** The picture of a card in the loaded asset index, or null. */
export function namecardSrc(card, m = data.get('assets'), half = false) {
  if (card?.kind === 'skin') {
    // half: the picker's tile shows the half-body portrait (lazy), the plate the full illustration
    const rec = m?.chars?.[card.charId]?.skins?.[card.skinId];
    return safeUrl(half ? rec?.portrait : rec?.illustration);
  }
  // 特工工牌 (需求方 2026-11-01): the files are not in assets.json — they are downloaded by hand into
  // public/assets/ui/valBadge/ and are not part of the official material plan (tools/assets/plan.mjs cannot reach
  // them). The path is built here so the manifest stays the manifest; a machine without the files draws nothing.
  if (card?.kind === 'badge') return safeUrl(card.assetKey ? `/assets/ui/${card.assetKey}.png` : null);
  return safeUrl(card && m?.ui && typeof m.ui === 'object' ? m.ui[card.assetKey] : null);
}

/**
 * The card behind a name plate (the room's seat cards): put it inside a `.has-nc` element; nothing for no / an unknown card.
 * @param {{ card: string|null|undefined, y?: number|null }} props `y`: room.card bgY
 */
export function NameCardLayer({ card, y = null }) {
  useData('assets');
  const nc = namecardOf(card);
  const src = namecardSrc(nc);
  if (!nc || !src) return null;
  const pos = namecardY(y);
  // the kind goes on the class: a faction emblem is laid out as a mark (nc-layer--camp), a scene as a photograph
  return html`<span class=${'nc-layer nc-layer--' + nc.kind}
    style=${'--nc:url("' + src + '")' + (nc.tint ? '; --nc-tint:' + nc.tint : '') + (pos == null ? '' : '; --nc-y:' + pos + '%')} />`;
}

/** Whether a card has a picture to crop (a faction emblem does not). @param {any} nc */
const adjustable = (nc) => !!nc && nc.kind !== 'camp';

/** 调整显示范围 (feedback #61): a plate to drag up and down and the same as a slider, for a keyboard. */
function NameCardAdjust({ card, y, onAdjust, onDone }) {
  const nc = namecardOf(card);
  const src = namecardSrc(nc);
  const [pos, setPos] = useState(namecardY(y) ?? defaultY());
  const [aspect, setAspect] = useState(0);
  const [drag, setDrag] = useState(null);
  useEffect(() => {
    const img = new Image();
    img.onload = () => { if (img.naturalWidth) setAspect(img.naturalHeight / img.naturalWidth); };
    if (src) img.src = src;
  }, [src]);
  const onDown = (e) => setDrag({ at: e.clientY, from: pos });
  const onMove = (e) => {
    if (!drag) return;
    // a picture still loading counts as square, as most illustrations are: the plate never ignores the drag
    const el = e.currentTarget;
    const { width, height } = el.getBoundingClientRect();
    setPos(dragNamecardY(drag.from, e.clientY - drag.at, { width, height, aspect: aspect || 1 }));
  };
  const onUp = () => { if (drag) { setDrag(null); onAdjust(pos); } };
  return html`<div class="nc-adjust">
    <div class="nc-adjust__plate has-nc" data-testid="nc-adjust-plate" onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${onUp}>
      <${NameCardLayer} card=${card} y=${pos} />
      <span class="nc-adjust__hint">${t('上下拖动调整显示范围')}</span>
    </div>
    <input type="range" class="nc-adjust__range" min="0" max="100" step="1" value=${pos} aria-label=${t('调整显示范围')}
      onInput=${(e) => setPos(Number(e.currentTarget.value))} onChange=${(e) => onAdjust(Number(e.currentTarget.value))} />
    <div class="nc-adjust__foot">
      <button type="button" class="nc-adjust__btn" onClick=${() => { setPos(defaultY()); onAdjust(null); }}>${t('恢复默认')}</button>
      <button type="button" class="nc-adjust__btn nc-adjust__btn--go" data-testid="nc-adjust-done" onClick=${onDone}>${t('完成')}</button>
    </div>
  </div>`;
}

/**
 * 名片底图 picker: 不使用底图 and every card; picking a card with a picture goes on to its position (`onAdjust`), any
 * other closes it. Esc / the backdrop close it too.
 */
export function NameCardPicker({ current, y = null, onPick, onAdjust = null, onClose }) {
  useData('assets');
  const [adjusting, setAdjusting] = useState(false);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);
  // a skin's card: the picker shows its half-body art, the plate its full illustration
  const skinCard = (c) => {
    const src = namecardSrc(c, data.get('assets'), true);
    const on = current === c.id;
    return html`<button key=${c.id} type="button" class=${'nc-pick__card nc-pick__card--skin' + (on ? ' is-on' : '')}
        onClick=${() => pick(c.id)} title=${t(c.name)} data-testid=${'nc-skin-' + c.skinId}>
      <span class="nc-pick__art nc-pick__art--skin">${src ? html`<img src=${src} alt="" loading="lazy" draggable=${false} />` : null}
        <span class="nc-pick__name">${t(c.name)}</span></span>
      ${on ? html`<span class="nc-pick__on">${t('使用中')}</span>` : null}</button>`;
  };
  // 特工工牌: a tall plate (268 × 640) like a 立绘, so its tile reuses the skin tile's portrait ratio and name band
  const badgeTile = (c) => {
    const src = namecardSrc(c, data.get('assets'), true);
    const on = current === c.id;
    return html`<button key=${c.id} type="button" class=${'nc-pick__card nc-pick__card--skin nc-pick__card--badge' + (on ? ' is-on' : '')}
        onClick=${() => pick(c.id)} title=${t(c.name)} data-testid=${'nc-badge-' + c.id.slice(6)}>
      <span class="nc-pick__art nc-pick__art--skin">${src ? html`<img src=${src} alt="" loading="lazy" draggable=${false} />` : null}
        <span class="nc-pick__name">${t(c.name)}</span></span>
      ${on ? html`<span class="nc-pick__on">${t('使用中')}</span>` : null}</button>`;
  };
  const pick = (id) => {
    onPick(id);
    if (onAdjust && adjustable(namecardOf(id))) setAdjusting(true);
    else onClose();
  };
  const card = (c) => html`<button key=${c.id} type="button" class=${'nc-pick__card' + (current === c.id ? ' is-on' : '')} onClick=${() => pick(c.id)} title=${t(c.name)}>
    <span class="nc-pick__art has-nc"><${NameCardLayer} card=${c.id} /><span class="nc-pick__name">${t(c.name)}</span></span>
    ${current === c.id ? html`<span class="nc-pick__on">${t('使用中')}</span>` : null}</button>`;
  return html`<div class="nc-pick" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div class="nc-pick__panel" role="dialog" aria-modal="true" aria-label=${t('名片底图')}>
      <header class="nc-pick__head"><strong>NAME CARD</strong><span class="nc-pick__title">${t('名片底图')}</span>
        <button type="button" class="nc-pick__x" onClick=${onClose} aria-label=${t('关闭')}><${Icon} name="close" /></button></header>
      ${adjusting && namecardOf(current) ? html`<${NameCardAdjust} key=${current} card=${current} y=${y} onAdjust=${onAdjust} onDone=${onClose} />` : html`<div class="nc-pick__grid">
        <button type="button" class=${'nc-pick__card nc-pick__card--none' + (!namecardOf(current) ? ' is-on' : '')} onClick=${() => pick('')}>
          <span class="nc-pick__art"><${Icon} name="close" /><span class="nc-pick__name">${t('不使用底图')}</span></span></button>
        <h4 class="nc-pick__theme">${t('模拟场景')}</h4>
        ${NAMECARDS.filter((c) => c.kind === 'loading').map(card)}
        <h4 class="nc-pick__theme">${t('阵营徽记')}</h4>
        ${NAMECARDS.filter((c) => c.kind === 'camp' && !ORG_IDS.has(c.id)).map(card)}
        <h4 class="nc-pick__theme">${t('组织徽记')}</h4>
        ${NAMECARDS.filter((c) => ORG_IDS.has(c.id)).map(card)}
        <h4 class="nc-pick__theme">${t('干员皮肤立绘')}</h4>
        ${[...SKIN_CARDS().values()].map(skinCard)}

      </div>`}
      <footer class="nc-pick__foot"><small>${t('名片底图显示在同盟席位的名牌后面，同盟里的博士都能看到')}</small>
        ${!adjusting && onAdjust && adjustable(namecardOf(current)) ? html`<button type="button" class="nc-adjust__btn" data-testid="nc-adjust-open" onClick=${() => setAdjusting(true)}>${t('调整显示范围')}</button>` : null}
      </footer>
    </div>
  </div>`;
}
