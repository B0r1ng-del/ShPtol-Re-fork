// 行动结束: the closing cut then the settlement (official crisisResult.js). The reference does a WebGL smear between
// the red flood screen and the plate; without WebGL it falls back to fading the flood over the settlement, which is
// what this does — same DOM, same CSS (css/screens/crisis-result.css), one tenth the code.
import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Icon, AvatarFrame, doctorNo } from './components.js';
import { data, useData } from '../data.js';
import { store, loadPref } from '../store.js';
import { chessAvatarUrl, chessPortraitUrl } from './assetUrls.js';
import { CARD_PREF, cardOperators } from './seatArt.js';
import { t } from '../../../shared/i18n.js';
import { seedCode } from '../../../shared/crisisSeed.js';

const CC_UI = '/assets/local/sp-crisis-20261021-a94f75cbeb5d/ui/';
const T_LAND = 730;    // the count lands as the red block hits
const T_EXIT = 1830;   // the band whips off, the smear starts
const T_SMEAR = 340;
const cx = (...p) => p.filter(Boolean).join(' ');
/** 官方 1280x720 舞台的缩放因子（crisisEventPage.js:239 同一公式）。
 *  结算页不在 .cc-root 里，拿不到那边注入的 --cc-s ⇒ .cc-stage 的
 *  缩小平移整条失效、回落 none，内容就从视口中心向右下铺开（用户报的「结算画面偏移」）。
 */
export function useStageScale() {
  const [s, setS] = useState(1);
  useEffect(() => {
    const fit = () => setS(Math.min(window.innerWidth / 1280, window.innerHeight / 720));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return s;
}

const mmss = (s) => `${String(Math.floor(s / 60) % 100).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

function SquadCard({ i, art, label, pill, state, check, avatar, name, sub, self, ok }) {
  const [bad, setBad] = useState(null);
  return html`
    <article class=${cx('cr-card', ok && 'is-ready', self && 'is-me')} style=${{ '--i': i }}>
      <span class="cr-card__clip"></span>
      <header class="cr-card__strip"><i></i><span class="num">${label}</span></header>
      <div class="cr-card__art">
        ${art && bad !== art ? html`<img src=${art} alt="" draggable=${false} onError=${() => setBad(art)} />`
          : html`<span class="cr-card__glyph">${[...(name || '?')][0]}</span>`}
        ${pill ? html`<span class="cr-card__pill">${pill}</span>` : null}
        <span class="cr-card__state">${check != null ? html`<span class="cr-card__box"><${Icon} name=${check ? 'check' : 'close'} /></span>` : null}${state}</span>
      </div>
      <div class="cr-card__plate">
        ${self ? html`<span class="cr-card__me"><${Icon} name="info" /></span>` : null}
        <${AvatarFrame} size="sm" name=${name} src=${avatar || undefined} self=${self} class="cr-card__av" />
        <span class="cr-card__name">${name}</span>
        <small class="cr-card__doc">${sub}</small>
      </div>
    </article>`;
}

/** tags: the picked tags · glyph(tag) → its symbol · best: the record before this run. */
export function CrisisResult({ tags = [], total = 0, best = 0, seconds = 0, glyph = () => '', victory = true, mode = 'solo', lineup = [], seed = null, onRetry, onDone, onShare = null }) {
  const [n, setN] = useState(0);
  // 0 the cut · 1 settlement mounted under the cut · 2 cut gone, band/emblem leaving · 3 settlement
  const [stage, setStage] = useState(0);
  const [fade, setFade] = useState(false);
  const record = victory && total > best;
  useEffect(() => {
    const t0 = performance.now(); let raf = 0;
    const tick = (now) => {
      const u = Math.min(1, (now - t0 - 30) / (T_LAND - 30));
      setN(u <= 0 ? 0 : Math.floor(total * (1 - (1 - u) ** 1.6) + 1e-6));
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const id = setTimeout(() => { setStage(1); setFade(true); }, T_EXIT);
    const id2 = setTimeout(() => setStage(3), T_EXIT + T_SMEAR);
    return () => { cancelAnimationFrame(raf); clearTimeout(id); clearTimeout(id2); };
  }, []);

  const ready = useData('chess', 'assets');
  const me = (store.get().me) || {};
  const squad = useMemo(() => {
    if (!ready) return { me: null, ops: [] };
    const m = data.get('assets');
    const cards = cardOperators(data.list('chess'));
    const portraits = { pool: cards.filter((c) => (c.rarity ?? 0) >= 5).sort((a, b) => (a.charId < b.charId ? -1 : 1)),
      byChar: new Map(cards.map((c) => [c.charId, c])), m, myId: me.playerId, myCard: String(loadPref(CARD_PREF, '') || '') };
    const out = [];
    const seen = new Set();
    const add = (c) => { if (c?.charId && !seen.has(c.charId) && chessPortraitUrl(m, c) && out.length < 3) { seen.add(c.charId); out.push(c); } };
    // the run's own final lineup first, then fill from the roster (no 盟约 helper stand-ins)
    for (const id of lineup) add(data.lookup('chess', id));
    const all = (data.list('chess') || []).filter((c) => c?.charId && !/辅助干员/.test(c.name || ''));
    for (let i = 0; out.length < 3 && all.length && i < all.length * 3; i++) add(all[(i * 7919 + total * 131) % all.length]);
    // the seat card's art: this browser's own 名片干员 first, then any card from the roster
    const mine = portraits.myCard && portraits.byChar.get(portraits.myCard);
    const meArt = chessPortraitUrl(m, mine || out[0] || null);
    return { me: meArt,
      ops: out.map((c) => ({ name: c.name, art: chessPortraitUrl(m, c), avatar: chessAvatarUrl(m, c), rarity: c.rarity, en: c.appellation })) };
  }, [ready, me.playerId, total]);
  const myName = me.name || t('博士');
  const ccS = useStageScale();

  const mark = html`
    <div class="cr-mark">
      <span class="cr-mark__emb"><img class="p1" src=${CC_UI + 'emblem-go.png'} alt="" /><img class="p2" src=${CC_UI + 'emblem-go.png'} alt="" /><img class="p3" src=${CC_UI + 'emblem-go.png'} alt="" /></span>
      <span class="cr-mark__n"><b class="num">${n}</b><img src=${CC_UI + 'star.png'} alt="" />${record ? html`<em>${t('新纪录')}</em>` : null}</span>
    </div>`;

  return html`
    <div class=${cx('cr', `cr--s${stage}`, fade && 'cr--fade')} style=${{ '--cc-s': ccS }}>
      <svg class="cr-defs" aria-hidden="true"><filter id="cr-mb" x="-30%" y="0" width="160%" height="100%"><feGaussianBlur stdDeviation="16 0" /></filter></svg>
      ${stage >= 1 ? html`
        <div class="cr-res">
          <div class="cc-bleed" style=${{ backgroundImage: `url(${CC_UI}sel-plate.jpg)` }}></div>
          <div class="cc-stage"><img class="cc-plate cr-res__plate" src=${CC_UI + 'sel-plate.jpg'} alt="" /></div>
          ${/* 官方这里是 <canvas class="cr-smear"> + WebGL 做横向撕裂（crisisResult.js 的 smear()）。
             本项目不用 WebGL：同一位置放一个 canvas，靠 CSS 的渐变遮罩 + 位移动画出等效的扫过感，
             阶段 3 一到就卸载。类名、位置、生命周期与官方一致。 */''}
          ${stage < 3 ? html`<canvas class="cr-smear" aria-hidden="true"></canvas>` : null}
          <div class="cc-stage cr-ui">
            <i class="cr-glitch"></i>
            <div class="cc-crumb">// ${t('行动结束')}</div>
            <div class="cr-head"><i class="cr-head__flare"></i><span class="cr-head__mark">CCO</span><b>${victory ? t('行动成功') : t('行动失败')}</b><span class="cr-head__lv">${['Ⅰ', 'Ⅱ', 'Ⅲ', 'Ⅳ'].map((r) => html`<i>${r}</i>`)}</span></div>
            <div class="cr-sum">
              <div class="cr-sum__red"><span>${t('指标总计')}</span>${record ? html`<em>${t('新纪录')}</em>` : null}<img src=${CC_UI + 'emblem-go.png'} alt="" /><b class="num">${total}</b></div>
              <div class="cr-sum__time"><span>${t('行动时长')}</span>${seed ? html`<span class="cr-seed">${t('开局种子')}<b class="num">${seedCode(seed)}</b></span>` : null}<b class="num">${mmss(seconds)}</b></div>
            </div>
            <div class=${cx('cr-tags', tags.length > 28 && 'is-dense')}>${tags.map((tg, i) => html`<span class="cr-tag" key=${tg.id} style=${{ '--i': i }}>${glyph(tg)}</span>`)}</div>
            <div class="cr-note"><span><i>i</i>${t('圣所已予以您新的评鉴')}</span><b class="num">${total}<img src=${CC_UI + 'star.png'} alt="" /></b></div>
            <div class=${cx('cr-squad', mode === 'solo' && 'cr-squad--solo')}>
              <${SquadCard} i=${0} art=${squad.me} label="P1" pill=${t('创建者')} check=${victory} state=${victory ? t('行动成功') : t('行动失败')}
                avatar=${null} name=${myName} sub=${`DOCTOR #${doctorNo(me.playerId)}`} self=${true} ok=${victory} />
              ${(mode === 'quad' ? squad.ops : []).map((op, i) => html`<${SquadCard} key=${i} i=${i + 1} art=${op.art} label=${op.rarity ? `${op.rarity}★` : ''}
                state=${html`<small>LV</small>90`} avatar=${op.avatar} name=${op.name} sub=${String(op.en || 'OPERATOR').toUpperCase()} ok=${victory} />`)}
            </div>
            <div class="cr-btns">
              ${onShare ? html`<button type="button" class="cr-share" onClick=${onShare} title=${t('复制作业码：本局指标、开局种子与 BAN 地图')}>${t('复制作业码')}</button>` : null}
              <button type="button" class="cr-retry" onClick=${onRetry}><i></i>${t('重新挑战')}</button>
              <button type="button" class="cr-done" onClick=${onDone}><i></i>${t('完成')}</button>
            </div>
          </div>
        </div>` : null}
      ${stage < 2 ? html`
        <div class="cr-cut"><i class="cr-veil"></i><div class="cc-stage">
          <i class="cr-pre cr-pre--a"></i><i class="cr-pre cr-pre--b"></i>
          <div class="cr-block"></div>
          <div class="cr-flood"><img src=${CC_UI + 'cr-flood.jpg'} alt="" /></div>
          <i class="cr-flood-edge"></i>
          <div class="cr-arrow"><i></i></div>
        </div></div>` : null}
      ${stage < 3 ? html`
        <div class="cr-top"><div class="cc-stage">
          <div class="cr-band">
            <i class="cr-band__fill"></i>
            <div class="cr-band__left"><img class="cr-band__tear" src=${CC_UI + 'cr-tear.png'} alt="" />
              <span class="cr-band__label">${t('指标总计')}<small>CONTINGENCY<br />TOTAL · CCO</small></span></div>
            <i class="cr-band__solid"></i>
          </div>
          ${mark}
        </div></div>` : null}
    </div>`;
}