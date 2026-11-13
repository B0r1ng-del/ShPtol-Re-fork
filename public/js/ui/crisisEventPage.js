// public/js/ui/crisisEventPage.js — 危机合约 · 活动入口页
//
// 官方是 ui/crisisEvent.js 的 CrisisEvent 外壳（phase: wipe | page | leaving）+ 两个主页：
//   ArclightPage  弧光作战（图三那张：BATTLEPLAN 背景、作战回顾卡、主入口大卡、结束时间条、右侧排行榜）
//   MainPage      重燃测试作战（活动中心：扫描logo、最高纪录、前往）
// 页面之间靠 cc-nav 的两个 tab 切换 —— 官方 cc-tab--arclight / cc-tab--rekindle。
// 本移植：外壳 + 两套主页 + tab 切换；右侧排行榜（ArcBoard / CrisisLeaderboard）需要服务端排位数据，暂缺。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { store } from '../store.js';
import { audio } from '../audio.js';
import { data, useData } from '../data.js';
import { t, N_ } from '../../../shared/i18n.js';
import { loadPref, savePref } from '../store.js';
import { BADGE_CARDS, namecardSrc } from './namecards.js';

// 两个资源根：lobby.js 的入口卡也要用（单一来源，别在两处各写一遍路径）
export const CC_UI = '/assets/local/sp-crisis-20261021-a94f75cbeb5d/ui/';
export const CC_ART = '/assets/local/cc4-arclight/';
const art = (f) => CC_ART + f;
// 结晶圣所商店素材：从客户端 ui/[uc]crisisv2.ab 解包（shop_v2_back / price_back / currency …），见台账 [261c]。
const SANCTUM_ART = '/assets/local/cc4-arclight/sanctum/';
/** 一件特工工牌的价格（结晶货币）。★ 数值是项目自定的，官方没有对应的商店定价。 */
export const SANCTUM_PRICE = 15;
export const SANCTUM_COIN_PREF = 'sanctum.coin';
export const SANCTUM_OWNED_PREF = 'sanctum.owned';
/** 解锁后写进 sp.pref.sanctum.owned 的工牌 id 列表（`badge:<key>`）。 */
export function isBadgeUnlocked(id) {
  const list = loadPref(SANCTUM_OWNED_PREF, []);
  return Array.isArray(list) && list.includes(id);
}

/**
 * 危机合约里赚到结晶货币时调用（弧光结算页 / 以后的任何危机模式结算）。
 * ★ 官方没有这个机制 —— 这是需求方 2026-11-12 定的：工牌默认全锁，靠危机合约赚的货币解锁。
 * @param {number} n 本次获得的货币数（非正数直接忽略）
 * @returns {number} 加完之后的总数
 */
export function awardSanctumCoin(n) {
  const add = Math.floor(Number(n));
  if (!Number.isFinite(add) || add <= 0) return loadPref(SANCTUM_COIN_PREF, 0);
  const next = loadPref(SANCTUM_COIN_PREF, 0) + add;
  savePref(SANCTUM_COIN_PREF, next);
  return next;
}

// 弧光作战的两首 BGM（官方 crisisMusic.js 的 ARC_MENU / ARC_MATCH，都是整曲循环 whole()）：
//   ARC_MENU  活动页与选择指标页  → battleplan.mp3
//   ARC_MATCH 对局中（买人起）      → leviation.mp3
// 走 audio.setArcBgm（复用 _bgmTrack 的同一条路），不另开 <audio>。
// ★ 两首都在 `data/assets.json` 的 `audio.bgm.arcLobby / arcCombat`（`/assets/audio/bgm/m_*_cc4_*.mp3`）。
//   早先是拿 `/assets/local/...` 直接写死的，但 `test/assets.test.js` 断言清单里「never a local-client
//   path」——清单是下载器的产物，`/assets/local/` 是随仓库走的美术，不该混进来。所以文件移进了 bgm 目录、
//   清单收了两条、这里改成读清单：缺条目时 setArcBgm(null) 会让 audio 回落到官方曲目，而不是请求一个 404。
// 重燃那三首（decree / embers / dilemma）官网本身就没有，这里不接，也不去请求。
export function arcAudio() {
  const bgm = (data.get('assets') || {}).audio?.bgm || {};
  const out = {};
  if (bgm.arcLobby) out.lobby = bgm.arcLobby;
  if (bgm.arcCombat) out.combat = bgm.arcCombat;
  return Object.keys(out).length ? out : null;
}

/* 官方 EventNav：两个赛季 tab。官方是斜排大卡（红斜纹带 + 小勾 + 角标，两颗尺寸不等），
   用户 2026-11-12 要求「并排、等大」⇒ 这里只渲染按钮 + 标题，底色与色条全交给 CSS。
   ★ 底图（banner.png / nav-crisis.png）不能要：banner.png 自带大号「弧光作战」字样，
     塞进 168×53 再叠 13px 标题必然糊成一团。 */
function EventNav({ active, onGo }) {
  const arc = active === 'arclight';
  const tab = (key, on, label) => html`<button type="button" class=${'cc-tab cc-tab--' + key + (on ? ' is-on' : '')}
      onClick=${() => !on && onGo(key)} title=${label} aria-label=${label} aria-current=${on ? 'page' : 'false'}>
      <span class="cc-tab__name">${label}</span>
    </button>`;
  return html`<nav class="cc-nav">
    ${tab('arclight', arc, t('危机合约 弧光作战'))}
    ${tab('main', !arc, t('危机合约 重燃测试作战'))}
  </nav>`;
}

/* 扫描动画层 —— 官方 crisisEvent.js 的 MainScene（活动中心主视觉）。
   全部用游戏自己的精灵图叠出来（tools/art-endfield.py 切图），所以它会像参考片那样动：
   四块碎片绕 logo 漂移、红色火花从台面升起、一道高光扫过、光环与徽记呼吸。
   BLOCKS / SPARKS 的坐标与时长逐条照抄官方常量，不自己调。 */
const BLOCKS = [[4, 652, 292, 35, 56, 'gray', 4, 5, -5, 5.2], [3, 687, 274, 29, 40, 'gray', 3, 4, 6, 4.4],
  [2, 825, 270, 66, 66, 'orange', -3, 5, -4, 6], [1, 887, 268, 60, 75, 'gray', -4, 6, 5, 5.6]];
const SPARKS = [[1, 640, 350, 0, 3.6], [2, 675, 300, 1.4, 4.2], [3, 712, 365, 2.6, 3.4], [4, 744, 250, 0.8, 4.6],
  [1, 760, 330, 3.1, 3.8], [2, 838, 240, 1.9, 4.4], [3, 860, 350, 0.3, 3.2], [4, 905, 300, 2.2, 4],
  [1, 930, 372, 3.6, 3.6], [2, 968, 330, 1.1, 4.8], [3, 700, 410, 2.9, 3.6], [4, 880, 415, 0.6, 4.2]];
const mask = (k) => ({ '--m': 'url(' + CC_UI + 'ef-' + k + '.png)' });

function MainScene() {
  return html`<div class="cc-plate cc-scene" aria-hidden="true">
    <img class="cc-sc-base" src=${CC_UI + 'ef-base.jpg'} alt="" />
    <i class="cc-sc-glow"></i>
    <i class="cc-sc-sheen" style=${{ '--m': 'url(' + CC_UI + 'ef-base.jpg)' }}></i>
    <img class="cc-sc-title2" src=${CC_UI + 'ef-title2.png'} alt="" />
    <img class="cc-sc-title1" src=${CC_UI + 'ef-title1.png'} alt="" />
    ${BLOCKS.map(([k, x, y, w, h, tone, dx, dy, r, tm]) => html`<span class="cc-sc-block" key=${'b' + k}
      style=${{ left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px',
        '--dx': dx + 'px', '--dy': dy + 'px', '--r': r + 'deg', '--t': tm + 's' }}>
      <i class=${'is-' + tone} style=${mask('block' + k)}></i></span>`)}
    <img class="cc-sc-halo" src=${CC_UI + 'ef-halo.png'} alt="" />
    <img class="cc-sc-logo" src=${CC_UI + 'ef-logo.png'} alt="" />
    <span class="cc-sc-drop"><i></i></span>
    ${SPARKS.map(([k, x, y, d, tm]) => html`<span class="cc-sc-spark" key=${'s' + k + x + y}
      style=${{ left: x + 'px', top: y + 'px', '--d': d + 's', '--t': tm + 's' }}>
      <i style=${mask('spark' + k)}></i></span>`)}
  </div>`;
}
/* 弧光作战主页 —— 官方 ArclightPage（entry_state.prefab 的布局）。 */
function ArclightPage({ onGo, onClose }) {
  // 作战回顾（官方 crisisArcBoard.js 的 ArcReview）：点 ca-archive 开它，不是活动说明。
  const [review, setReview] = useState(false);
  // 结晶圣所商店（用户 2026-11-12：先留白，样式等他确认）。默认关闭。
  const [shop, setShop] = useState(false);
  return html`<div class="cc-page cc-main ca-main is-fresh">
    <div class="ca-fill"></div>
    <div class="cc-stage">
      <img class="ca-bg" src=${art('bg.png')} alt="" />
      <i class="ca-olive ca-olive--l"></i><i class="ca-olive ca-olive--r"></i>
      <i class="ca-line ca-line--l" style=${{ borderImageSource: 'url(' + art('line-left.png') + ')' }}></i>
      <i class="ca-line ca-line--r" style=${{ borderImageSource: 'url(' + art('line-right.png') + ')' }}></i>
      <i class="ca-corner"></i>

      <button type="button" class="ca-back" onClick=${onClose} aria-label=${t('返回大厅')} title=${t('返回大厅')}><img src=${art('btn-backbutton.png')} alt="" /></button>
      ${/* 用户图一：弧光入口页不要 i 按钮（只留返回键）。官方 crisisEvent.js:227 附近也没有 ca-guide。 */''}

      ${/* 用户 2026-11-12：「给结晶圣所添加按钮功能，进去后会到一个商店样式的界面，具体样式等我确认，先留白」。
           ⇒ 由 <section> 改成 <button>，整块可点（含赏金条），进 ca-shop 留白页。 */''}
      <button type="button" class="ca-crystal" data-testid="ca-crystal" onClick=${() => setShop(true)}
        aria-label=${t('结晶圣所')} title=${t('结晶圣所')}>
        <div class="ca-crystal__head"><h3>${t('结晶圣所')}</h3><i class="ca-crystal__mark"></i></div>
        <div class="ca-crystal__bounty">
          <span class="ca-crystal__label">${t('晶体合约赏金')}</span>
          ${/* 用户 2026-11-12：外面的数量要跟着真实货币走（原来写死 125 永远不变）。
                 ArclightPage 在开关商店时会重渲染，所以这里直接读 pref 就能拿到最新值。 */''}
          <b class="num">${loadPref(SANCTUM_COIN_PREF, 0)}</b>
          <img class="ca-crystal__coin" src=${SANCTUM_ART + 'currency.png'} alt="" />
        </div>
      </button>
      <button type="button" class="ca-archive" onClick=${() => setReview(true)} data-testid="ca-archive">
        <img class="ca-archive__bg" src=${art('archive.png')} alt="" />
        <span class="ca-archive__name">${t('作战回顾')}</span>
        <img class="ca-archive__medal" src=${art('medal.png')} alt="" />
      </button>

      <button type="button" class="ca-entry" onClick=${() => onGo('select')} aria-label=${t('进入危机合约 弧光作战')}>
        <span class="ca-entry__art" style=${{ backgroundImage: 'url(' + art('entry-main.jpg') + ')' }}></span>
        <span class="ca-entry__loc">
          <img class="ca-entry__locbg" src=${art('location-bg.png')} alt="" />
          <img class="ca-entry__pin" src=${art('location-icon.png')} alt="" />
          <small>${t('危机合约')}</small><b>${t('弧光作战')}</b>
        </span>
        <span class="ca-entry__bar" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="ca-entry__word">Arclight</span>
        <span class="ca-entry__diagram"><img src=${art('diagram-bkg.png')} alt="" /><img src=${art('diagram-outline.png')} alt="" /></span>
        <span class="ca-entry__best"><small>${t('历史最高')}</small><b class="num">0</b></span>
      </button>

      <div class="ca-time">
        <i class="ca-time__icon" style=${{ '--m': 'url(' + art('time-icon.png') + ')' }}></i>
        <span class="ca-time__label">${t('本期作战结束时间')}</span>
        <span class="ca-time__value"><span class="cc-planned-time">${t('排行榜开放中 · 结束时间另行公告')}</span></span>
      </div>
      <img class="ca-title" src=${art('banner.png')} alt=${t('危机合约 弧光作战')} />
      ${/* ★ 赛季 tab 是进重燃的唯一通道（大厅 lobby.js 只 filter crisisArc，不再渲染重燃入口），不能删。
           用户 2026-11-12：从官方图的右上角挪到顶部黑框位置，两颗并排、等大；重燃页共用同一套。 */''}
      <div class="ca-nav"><${EventNav} active="arclight" onGo=${onGo} /></div>
      ${review ? html`<${ArcReview} onClose=${() => setReview(false)} />` : null}
      ${shop ? html`<${SanctumShop} onClose=${() => setShop(false)} />` : null}
    </div>
  </div>`;
}

/* 重燃测试作战主页 —— 官方 MainPage（活动中心）。 */
function MainPage({ onGo, onClose }) {
  return html`<div class="cc-page cc-main is-fresh">
    <div class="cc-bleed" style=${{ backgroundImage: 'url(' + CC_UI + 'ef-base.jpg)' }}></div>
    <div class="cc-stage">
      <${MainScene} />
      <div class="cc-crumb">// ${t('活动中心')}</div>
      <div class="cc-rail" aria-hidden="true"><b></b><i class="c1"></i><i class="c2"></i><i class="c3"></i></div>
      <div class="ca-nav"><${EventNav} active="main" onGo=${onGo} /></div>
      ${/* 用户第九次纠正「我要求你新增的两个返回按钮呢」—— 两个指【弧光入口页】与【重燃入口页】各一个。
          重燃这边官方只有 CloseBtn（crisisEvent.js:302），但用户明确要返回键，补 .ca-back；
          .cc-x 会与它重叠，所以重燃这边只留 .ca-back。 */''}
      <button type="button" class="ca-back" onClick=${onClose} aria-label=${t('返回大厅')} title=${t('返回大厅')}>
        <img src=${art('btn-backbutton.png')} alt="" /></button>


      <section class="cc-info">
        <button type="button" class="cc-info__help"><span>?</span>${t('活动说明')}</button>
        <h1 class="cc-info__title">${t('危机合约 重燃测试作战')}</h1>
        <div class="cc-info__time"><span class="cc-planned-time">${t('活动开放中')}</span></div>
        <span class="cc-info__pill">${t('挑战活动')}</span>
        <div class="cc-info__hard">${t('此活动为高难挑战活动')}</div>
        <p class="cc-info__desc">${t('古老的合约理应延续，过去的合作尚需恢复。管理员，一份礼物已经送达。')}</p>
      </section>

      <section class="cc-record">
        <div class="cc-record__bar">${t('最高纪录')}<i aria-hidden="true"></i></div>
        <div class="cc-record__n num">0</div><img class="cc-record__glyph" src=${CC_UI + 'glyph-record.png'} alt="" />
        <button type="button" class="cc-go" onClick=${() => onGo('select')}><i class="cc-go__line"></i><span>${t('前往')}</span><i class="cc-go__icon"></i></button>
      </section>
    </div>
  </div>`;
}


/* 结晶圣所 · 商店页 —— 用户 2026-11-12：「进去后会到一个商店样式的界面，具体样式等我确认，先留白」。
   ★ 这一版只搭**骨架**：整页底板 + 返回键 + 标题行，内容区明确留空（.ca-shop__body 里什么都不渲染），
     等用户给样式再往里填。不预先编造货架/商品卡片 —— 那是等确认的东西。
   ★ 返回键复用同一套 .ca-back（自动继承顶部高度统一与阴影），所以「补齐返回按钮」不用另写 CSS。
   ★ 层级：与 ArcReview 一样挂在 .cc-stage 里，但 inset:0 盖住整页；z-index 高于主页各卡（主页最高 6）。 */
function SanctumShop({ onClose }) {
  // 结晶货币（危机合约里赚的）：解锁工牌要花它。存本地，和其余 sp.pref.* 同一套。
  const [coin, setCoin] = useState(() => loadPref(SANCTUM_COIN_PREF, 0));
  const [owned, setOwned] = useState(() => loadPref(SANCTUM_OWNED_PREF, []));
  const ownedSet = new Set(Array.isArray(owned) ? owned : []);
  const buy = (card) => {
    if (ownedSet.has(card.id) || coin < SANCTUM_PRICE) return;
    const nextOwned = [...(Array.isArray(owned) ? owned : []), card.id];
    const nextCoin = coin - SANCTUM_PRICE;
    setOwned(nextOwned); setCoin(nextCoin);
    savePref(SANCTUM_OWNED_PREF, nextOwned);
    savePref(SANCTUM_COIN_PREF, nextCoin);
  };
  return html`<div class="ca-shop" role="dialog" aria-modal="true" aria-label=${t('结晶圣所')} data-testid="ca-shop">
    <div class="ca-shop__plate">
      <div class="ca-shop__bar">
        <h2 class="ca-shop__title">${t('结晶圣所')}</h2>
        <span class="ca-shop__coin" data-testid="ca-shop-coin">
          <img src=${SANCTUM_ART + 'currency.png'} alt="" /><b class="num">${coin}</b></span>
      </div>
      <div class="ca-shop__body" data-testid="ca-shop-body">
        <div class="ca-shop__grid">
          ${BADGE_CARDS.map((card) => {
            const has = ownedSet.has(card.id);
            const src = namecardSrc(card);
            const afford = coin >= SANCTUM_PRICE;
            return html`<div class="ca-shop__cell" key=${card.id} data-testid=${'ca-shop-cell-' + card.id}>
              <div class="ca-shop__thumb">
                ${src ? html`<img src=${src} alt=${t(card.name)} />` : null}
                ${has ? null : html`<span class="ca-shop__lock" aria-hidden="true"><img src=${SANCTUM_ART + 'item_detail_round_back.png'} alt="" /></span>`}
              </div>
              <div class="ca-shop__name">${t(card.name)}</div>
              ${has
                ? html`<span class="ca-shop__owned">${t('已拥有')}</span>`
                : html`<button type="button" class=${'ca-shop__buy' + (afford ? '' : ' is-off')}
                    onClick=${() => buy(card)} aria-label=${t('解锁')} title=${t('解锁')}>
                    ${/* ★ 用户 2026-11-12 图二：「价格标签全部有问题」。
                           ① 我原来买不起时换 `cannot_buy_current.png`（240×168 方形警示框），
                              压进 224×36 长条里被拉成淡灰药丸 + 挤扁的红点 ⇒ 换成永远用 price_back。
                           ② 标签里缺"货币图标 + 数量"的语义：官方价格条左边是币种图标，右边才是数字。
                              这里补上 currency.png + 数字，和主页赏金条保持一致。 */''}
                    <img class="ca-shop__pricebg" src=${SANCTUM_ART + 'price_back.png'} alt="" />
                    <img class="ca-shop__pricecoin" src=${SANCTUM_ART + 'currency.png'} alt="" />
                    <b class="num">${SANCTUM_PRICE}</b>
                  </button>`}
            </div>`;
          })}
        </div>
      </div>
    </div>
    <button type="button" class="ca-back" onClick=${onClose} aria-label=${t('返回')} title=${t('返回')}>
      <img src=${art('btn-backbutton.png')} alt="" /></button>
  </div>`;
}

/* 作战回顾 —— 官方 crisisArcBoard.js 的 ArcReview（危机合约成就历史页 crisis_v2_achievement_history_state）。
   结构照抄官方，类名全部是官方已有的 .car-rv__* / .car-hex__*（crisis-event.css 1124 起），不新造类。
   ★ 纪录数据：官方的 readArcReview / readBest 读本机 crisisRecords；本项目没有那份记录，也不显示全服排行榜
     （需求方已明确不要），所以四个数一律 0 / —。
   ★ 两张背景贴图（官方 assets 的 img_subtitle_bg / img_score_bg / border_bg / fin_dec_graph / settle/*）
     本地资产包没有，对应的 h3 / best 底纹 / 装饰留空 —— 官方 CSS 给了底色与尺寸，不缺版式。 */
const ARC_DIMS = [
  { name: N_('战略'), groups: 'NO' },       // 终局与联防
  { name: N_('技巧'), groups: 'HIJKLM' },   // 赛季敌人
  { name: N_('调遣'), groups: 'C' },
  { name: N_('应变'), groups: 'BG' },
  { name: N_('洞察'), groups: 'D' },
  { name: N_('筹划'), groups: 'AEF' },      // 源石环境 / 重力调控 / 场地管制
];
// dimsOf 的空表结果：没有任何已完成指标 ⇒ 每一维 v = 0、f = 0（红色的「way」缩到 0，只剩底图与描边）
const ZERO_DIMS = ARC_DIMS.map((d, i) => ({ ...d, i, v: 0, f: 0 }));

/* 作战回顾面板的自适应缩放（用户：整块太大，没做大小自适应）。
   .car-rv 是官方 1140×628 绝对像素，靠祖先 .cc-stage 的 --cc-s 缩放。
   实测 --cc-s = min(vw/1280, vh/720) 时面板占比：1920×1080 → 宽 133.6% / 高 130.8%（整块溢出），
   1911×910 → 高 110.2%。所以要在 --cc-s 之上再压一次：让 1140×628 等比后最多 86vw / 86vh。
   ★ 系数必须在这里算成**数字**；写进 CSS 的 calc(var(--rv-s)/var(--cc-s)) 会因除数是 min() 表达式
     被浏览器静默丢弃，transform 回落 none（实测过）。 */
function reviewZoom() {
  const ccS = Math.min(window.innerWidth / 1280, window.innerHeight / 720);
  const wK = (window.innerWidth * 0.86) / (1140 * ccS);
  const hK = (window.innerHeight * 0.86) / (628 * ccS);
  return Math.min(1, wK, hK);
}

function ArcReview({ onClose }) {
  const me = store.get().me || {};
  const [zoom, setZoom] = useState(reviewZoom);
  useEffect(() => {
    const fit = () => setZoom(reviewZoom());
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  return html`<div class="cc-modal car-rv-modal">
    <div class="cc-modal__dim" onClick=${onClose}></div>
    <div class="cc-modal__stage" style=${{ '--rv-k': zoom }}>
      <section class="car-rv" role="dialog" aria-modal="true" aria-label=${t('作战回顾')} data-testid="ca-review">
        <button type="button" class="cc-x" onClick=${onClose} aria-label=${t('关闭')}>
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        <div class="car-rv__banner">
          <img class="car-rv__logo" src=${art('banner.png')} alt=${t('危机合约 弧光作战')} />
          <img class="car-rv__medal" src=${art('medal.png')} alt="" />
          <div class="car-rv__counts"><span>${t('出击')}<b class="num">0</b></span><span>${t('成功')}<b class="num">0</b></span></div>
          <i class="car-rv__bar"></i>
        </div>
        <div class="car-rv__loc">
          <div class="car-rv__place">
            <img src=${art('location-icon.png')} alt="" />
            <span><small>${t('哥伦比亚')}</small><b>${t('滞空焦点')}</b></span>
          </div>
          <div class="car-rv__season"><small>Battleplan</small><b>#4</b><span>${t('弧光作战')}</span><em>Arclight</em></div>
          <div class="car-rv__best"><span>${t('历史最高总分')}<small>${t('单人')} — · ${t('四人')} —</small></span><b class="num">—</b></div>
        </div>
        <div class="car-rv__who"><b>Dr.${me.name || t('博士')}</b><span>${t('本机记录 · 换设备或清除浏览器数据后不保留')}</span></div>
        <div class="car-rv__bonds">
          <h3>${t('盟约挑战次数')}</h3>
          <p class="car-rv__none">${t('完成一次弧光作战后，这里会记下每局用到的盟约。')}</p>
        </div>
        <div class="car-rv__done">
          <h3>${t('已完成指标')}</h3><b class="car-rv__dn num">0</b>
        </div>
        <div class="car-rv__graph">
          <div class="car-rv__hex car--t1"><${HexDiagram} dims=${ZERO_DIMS} /></div>
        </div>
      </section>
    </div>
  </div>`;
}

/* 官方 crisisArcResult.js 的 Hex(dims, big)：diagram_atlas 的 bkg + outline + 六条红 way + 中心装饰，
   big 时再在外圈画六个维度名与数值。本地资产包只有 bkg / outline 两张（cc4-arclight/diagram-bkg.png 与
   diagram-outline.png，正好 230x200 = .car-hex 的尺寸），中心装饰与六个图标缺失，省掉。 */
function HexDiagram({ dims }) {
  return html`<div class="car-hex is-big">
    <img class="car-hex__bkg" src=${art('diagram-bkg.png')} alt="" />
    ${dims.map((d) => html`<i class="car-hex__way" key=${d.i} style=${{ '--a': `${d.i * 60 - 90}deg`, '--f': d.f, '--d': `${d.i * 70}ms` }}></i>`)}
    <i class="car-hex__ol" style=${{ '--m': `url(${art('diagram-outline.png')})` }}></i>
    ${dims.map((d) => {
      const a = (d.i * 60 - 90) * Math.PI / 180;
      return html`<span class="car-hex__lbl" key=${d.i} style=${{ left: `${50 + Math.cos(a) * 74}%`, top: `${50 + Math.sin(a) * 86}%`, '--d': `${300 + d.i * 90}ms` }}>
        <b class="num">${d.v}</b><small>${t(d.name)}</small></span>`;
    })}
  </div>`;
}

/* 外壳 —— 官方 CrisisEvent 的 page 分支。onSelect 带上皮肤（弧光 / 重燃），供选择指标页使用。 */
export function CrisisEventPage({ initial = 'arclight', onClose, onSelect, noWipe = false }) {
  // ★ arcAudio() 读 data/assets.json 的 audio.bgm，所以入口页自己也要把 `assets` 拉起来 —— 早先只有
  //   crisisSelect 调 useData('…','assets')，从大厅直接进入口页时清单还没加载，两首弧光曲就会静默缺席。
  useData('assets');
  const [page, setPage] = useState(initial);
  // 入场：官方 CrisisEvent 的 phase（crisisEvent.js:110）—— 'wipe' 先放三条斜带扫过（.cc-root.is-wipe 触发
  // .cc-wipe i 的 cc-wipe-in），520ms 后切 'page' 才挂 cc-pages。官方那 520ms 与动画时长为同一值（crisisEvent.js:118）。
  // ★ noWipe：从选择指标页按返回回来时不能再放 wipe —— 那 520ms 里 phase!=='page' ⇒ 整个
  //   cc-pages 渲染成 null（第 281 行），底下就是大厅，用户看到「闪一下主页」。
  const [phase, setPhase] = useState(noWipe ? 'page' : 'wipe');
  // --cc-s 是官方 1280x720 舞台的缩放因子：.cc-stage 是绝对像素舞台，靠它适配视口。
  const [ccScale, setCcScale] = useState(1);
  useEffect(() => {
    const fit = () => setCcScale(Math.min(window.innerWidth / 1280, window.innerHeight / 720));
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, []);
  useEffect(() => {
    if (noWipe) return undefined;
    const id = setTimeout(() => setPhase('page'), 520);
    return () => clearTimeout(id);
  }, [noWipe]);
  // 弧光作战的 BGM：进门装上，离开卸下（回到大厅的 lobby 曲）。重燃那三个文件官方没有，不接。
  useEffect(() => {
    audio.setArcBgm(arcAudio());
    return () => audio.setArcBgm(null);
  }, []);
  /* ★ 退场动画：官方 crisisEvent.js 的 phase 是三态 `wipe | page | leaving`，
     对应 CSS `.cc-root.is-leaving .cc-pages{animation:cc-pages-out 560ms}`（crisis-event.css:62）。
     项目原来 onClose 直接调父级 setCrisisEntry(null) 卸载组件 ⇒ **退场动画从来不放**，按返回是硬切。
     这里补上：先 setPhase('leaving')，560ms 后再真的关闭。 */
  const leave = () => {
    if (phase === 'leaving') return;
    setPhase('leaving');
    setTimeout(() => onClose && onClose(), 560);
  };
  const go = (p) => {
    if (p === 'select') { onSelect(page === 'arclight' ? 'arclight' : 'rekindle'); return; }
    setPage(p);
  };
  return html`<div class="cc-host"><div class=${`cc-root is-${phase}`} style=${{ '--cc-s': ccScale }} data-phase=${phase}>
    ${phase !== 'wipe' ? html`<div class="cc-pages" key=${page}>
      ${page === 'arclight'
        ? html`<${ArclightPage} onClose=${leave} onGo=${go} />`
        : html`<${MainPage} onGo=${go} onClose=${leave} />`}
    </div>` : null}
    <div class="cc-wipe" aria-hidden="true"><i></i><i></i><i></i></div>
  </div></div>`;
}