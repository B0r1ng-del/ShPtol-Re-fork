// ui/codex.js — 档案 (codex): 盟约 / 装备 / 敌人 的**数据驱动**图鉴。
//
// 和「玩法说明」(ui/guide.js)不是一回事:那个是 19 张官方教程**图片**的翻页器,内容写死在图里;
// 这个是从 data/*.json 现读现画的,所以数据一改它跟着变。
//
// 交互形态是 owner 定的(「滚动太麻烦了」那一轮):
//   · 盟约 —— **折叠**:所有盟约贴在一起,一行一个,点开就地展开;要完整资料再点「详细」开弹窗。
//   · 装备 —— **两级折叠栏 + 翻页**:1级 → 1费/2费/3费…,2级 → …,一页一级。
//   · 敌人 —— **按类型翻页**(普通/精英/首领/其他首领级/飞行/隐匿/元素/反射·次数·持续)。
//
// 三个标签页都是"翻页"而不是"滚动":分页把内容切成固定大小,玩家不用一路滑到底。
// 分类依据全部来自数据本身,在 ui/codexData.js 里逐条解释过。

import { useState, useMemo, useRef, useEffect } from '../../vendor/hooks.module.js';
import { html, Icon, Button, Modal, MicroLabel, TextField, Spinner } from './components.js';
import { RichText } from './gameComponents.js';
import { data, useData, DATA_FILES } from '../data.js';
import { createStore, useStore } from '../store.js';
import { bondIconUrl, itemIconUrl, enemyIconUrl } from './assetUrls.js';
import { t } from '../../../shared/i18n.js';
import { buildCodex, CATEGORY_NAME } from './codexData.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** Open/closed + which tab. `group` / `page` 由各标签页自己维护,切换标签页时重置。 */
export const codexStore = createStore({ open: false, tab: 'bonds' });

/**
 * 档案要读的文件。
 *
 * `waves` 是关键:敌人那一页的"可能出现在哪些回合"由波次模板的 `slot` 占位符推出(codexData `slotRounds`),
 * 不读它就只能写死一张表 —— 数据一改就错。
 */
const CODEX_FILES = ['bonds', 'items', 'enemies', 'bosses', 'waves', 'assets'];

/** 打开档案。六个文件在这里一起请求 —— 打开就要能切三个标签页,后面再补下载会让标签页先空一下。 */
export function openCodex(tab = 'bonds') {
  for (const n of CODEX_FILES) data.load(n);
  codexStore.set({ open: true, tab });
}
export const closeCodex = () => codexStore.set({ open: false });

/**
 * 折叠箭头。
 *
 * ⚠ `ICONS` 里**没有** `chevronDown`(只有 left/right/chevrons),而全项目画"展开"的惯例是
 * **把 chevronRight 用 CSS 转 90°**(见 ui/voice.js 的 `.lo-fold`)。这里照做 —— 添加一个只会用一次的新图标
 * 不如复用既有做法,而且 `.icon` 在别处也有 rotate 的样式,一致。
 */
const Caret = ({ open }) => html`<${Icon} name="chevronRight" class=${cx('cdx-caret', open && 'is-open')} />`;

const TABS = Object.freeze([
  { id: 'bonds', name: '盟约', micro: 'PACT' },
  { id: 'items', name: '装备', micro: 'EQUIPMENT' },
  { id: 'enemies', name: '敌人', micro: 'ENEMY' },
]);

/** 图标 + 加载失败退回占位符。 */
function Img0({ src, fallback, class: cls }) {
  const [bad, setBad] = useState(false);
  if (!src || bad) return html`<span class=${cx('cdx-ico', cls)}>${fallback || null}</span>`;
  return html`<span class=${cx('cdx-ico', cls)}><img src=${src} alt="" loading="lazy" onError=${() => setBad(true)} /></span>`;
}

// ---- 盟约 --------------------------------------------------------------------------------------------------------

/**
 * 盟约折叠项:收起时只有图标 + 名字 + 阈值(一行),展开后就地给出需求 / 能力 / 成员。
 *
 * owner:「盟约改成折叠 所有盟约贴在一起美观 然后打开后可详细查看」。
 * 「详细」开弹窗(BondDetail)而不是把全部内容塞进列表 —— 列表要的是"一眼扫过去",详情要的是"读一遍"。
 */
function BondRow({ m, e, onDetail }) {
  const [open, setOpen] = useState(false);
  return html`<div class=${cx('cdx-acc', open && 'is-open')} data-bond=${e.id}>
    <button type="button" class="cdx-acc__head" aria-expanded=${open ? 'true' : 'false'} onClick=${() => setOpen(!open)}>
      <${Caret} open=${open} />
      <${Img0} src=${bondIconUrl(m, e.id)} fallback=${html`<i class="cdx-ph"></i>`} />
      <b class="cdx-acc__name">${e.name}</b>
      <em class=${cx('cdx-tag', e.core ? 'cdx-tag--core' : 'cdx-tag--sub')}>${e.core ? t('大') : t('小')}</em>
      ${e.season ? html`<em class="cdx-tag">${t('赛季')}</em>` : null}
      <span class="cdx-acc__thr num">${e.thresholds.join(' / ')}</span>
    </button>
    ${open ? html`<div class="cdx-acc__body">
      ${e.need ? html`<p class="cdx-need"><b>${t('激活需求')}</b>${e.need}</p>` : null}
      ${e.effect || e.desc ? html`<div class="cdx-rich">
        ${e.effect ? html`<b class="cdx-lab">${t('激活能力')}</b>` : null}
        ${e.effectRaw ? html`<${RichText} as="p" text=${e.effectRaw} />` : (e.effect ? html`<p>${e.effect}</p>` : null)}
      </div>` : null}
      <div class="cdx-acc__foot">
        <${Button} variant="ghost" size="sm" icon="search" onClick=${() => onDetail(e)}>${t('详细信息')}<//>
        ${e.members.length ? html`<span class="cdx-dim">${t('成员 {n} 名', { n: e.members.length })}</span>` : null}
      </div>
    </div>` : null}
  </div>`;
}

/** 盟约详情弹窗 —— 纯定义,不含对局状态(那需要 priv / entry,图鉴里没有)。 */
function BondDetail({ m, e, onClose }) {
  return html`<${Modal} open=${!!e} onClose=${onClose} width="6.4rem"
    title=${e ? e.name : ''} micro=${e && e.core ? 'CORE PACT' : 'ADD-ON PACT'}
    actions=${html`<${Button} variant="primary" icon="check" onClick=${onClose}>${t('关闭')}<//>`}>
    ${e ? html`<div class="cdx-detail">
      <header class="cdx-detail__head">
        <${Img0} src=${bondIconUrl(m, e.id)} fallback=${html`<i class="cdx-ph"></i>`} class="cdx-ico--lg" />
        <div>
          <div class="cdx-detail__tags">
            <em class=${cx('cdx-tag', e.core ? 'cdx-tag--core' : 'cdx-tag--sub')}>${e.core ? t('大盟约') : t('小盟约')}</em>
            ${e.season ? html`<em class="cdx-tag">${t('赛季')}</em>` : null}
            ${e.noStack ? html`<em class="cdx-tag">${t('层数不显示')}</em>` : null}
            ${e.milestones ? html`<em class="cdx-tag cdx-tag--ms">${t('层数里程碑 {n}', { n: e.milestones })}</em>` : null}
          </div>
          <div class="cdx-detail__thr">
            ${e.thresholds.map((n, i) => html`<span key=${i} class="cdx-thr"><b class="num">${n}</b><small>${e.maxCount != null ? t('名及以下') : t('名')}</small></span>`)}
          </div>
        </div>
      </header>
      ${e.need ? html`<p class="cdx-need"><b>${t('激活需求')}</b>${e.need}</p>` : null}
      ${e.effectRaw || e.effect ? html`<section class="cdx-dsec">
        <h4>${t('激活能力')}<${MicroLabel}>EFFECT<//></h4>
        ${e.effectRaw ? html`<${RichText} as="p" text=${e.effectRaw} />` : html`<p>${e.effect}</p>`}
        ${e.effectName ? html`<p class="cdx-dim">${e.effectName}</p>` : null}
      </section>` : null}
      ${e.descRaw || e.desc ? html`<section class="cdx-dsec">
        <h4>${t('说明')}<${MicroLabel}>NOTE<//></h4>
        ${e.descRaw ? html`<${RichText} as="p" text=${e.descRaw} />` : html`<p>${e.desc}</p>`}
      </section>` : null}
      ${e.members.length ? html`<section class="cdx-dsec">
        <h4>${t('成员')}<${MicroLabel}>MEMBERS<//></h4>
        <div class="cdx-members">${e.members.map((id) => html`<span key=${id}>${data.lookup('chess', id)?.name || id}</span>`)}</div>
      </section>` : null}
    </div>` : null}
  <//>`;
}

// ---- 装备 --------------------------------------------------------------------------------------------------------

/** 一条装备:普通版描述 + (有精锐时)「精锐后变为」。 */
function ItemRow({ m, e }) {
  const up = e.upgradeId ? data.lookup('items', e.upgradeId) : null;
  return html`<article class="cdx-item" data-item=${e.id}>
    <${Img0} src=${itemIconUrl(m, e)} fallback=${html`<i class="cdx-ph"></i>`} />
    <div class="cdx-item__main">
      <div class="cdx-item__top">
        <b>${e.name}</b>
        ${e.category ? html`<em class="cdx-tag">${t(CATEGORY_NAME[e.category] || e.category)}</em>` : null}
        ${!e.hasPlain ? html`<em class="cdx-tag cdx-tag--gold">${t('仅精锐')}</em>` : null}
        <span class="cdx-item__price num" title=${t('费用')}>${e.price}</span>
      </div>
      ${e.descRaw || e.desc ? html`<div class="cdx-rich cdx-item__desc">
        ${e.descRaw ? html`<${RichText} as="p" text=${e.descRaw} />` : html`<p>${e.desc}</p>`}
      </div>` : null}
      ${/*
         * 「精锐后变为」—— owner 的原话是「直接增加 精锐后xxx变为 增加xxx就行了」。
         * 数据里两版描述逐字相同、只有数值不同,所以把精锐那版整条并列出来就是最准确的写法,
         * 不需要我去 diff 数字(那会在描述结构变化时静默出错)。
         */ null}
      ${e.golden ? html`<div class="cdx-item__gold">
        <b class="cdx-lab cdx-lab--gold">${t('精锐后变为')}</b>
        <div class="cdx-rich">
          ${e.golden.descRaw ? html`<${RichText} as="p" text=${e.golden.descRaw} />` : html`<p>${e.golden.desc}</p>`}
        </div>
      </div>` : null}
      <div class="cdx-item__foot">
        ${up ? html`<span class="cdx-up">${t('合成')} → <b>${up.name}</b></span>` : null}
        ${!up && e.mergeable ? html`<span class="cdx-dim">${t('可合成')}</span>` : null}
        ${e.giveBondId ? html`<span class="cdx-give">${t('给予盟约')} <b>${data.lookup('bonds', e.giveBondId)?.name || e.giveBondId}</b></span>` : null}
        ${e.requiresBondId ? html`<span class="cdx-req">${t('需要盟约')} <b>${data.lookup('bonds', e.requiresBondId)?.name || e.requiresBondId}</b></span>` : null}
      </div>
    </div>
  </article>`;
}

// ---- 敌人 --------------------------------------------------------------------------------------------------------

/** 一条敌人:名字 + 标记 + 描述 + 数值。 */
function EnemyRow({ m, e }) {
  const s = e.stats || {};
  const nums = [
    ['生命', s.maxHp], ['攻击', s.atk], ['防御', s.def], ['法抗', s.res],
    ['重量', s.massLevel], ['阻挡', s.blockCnt], ['移速', s.moveSpeed],
  ].filter(([, v]) => Number.isFinite(v));
  return html`<article class="cdx-enemy" data-enemy=${e.key}>
    <${Img0} src=${enemyIconUrl(m, e.key)} fallback=${html`<i class="cdx-ph"></i>`} />
    <div class="cdx-enemy__main">
      <div class="cdx-enemy__top">
        <b>${e.name}</b>
        ${e.pool ? html`<em class="cdx-tag cdx-tag--boss">${t('首领')}</em>` : null}
        ${/*
           * ⚠ 这里**不画**「飞行」标记。
           *
           * 分类已经由上面的类型栏表达了,而画标记会指向**另一个字段**:`isFlyEnemy`(移动方式,`waves.js` 用它
           * 决定走空中还是地面路线)不等于 `acType === 'FLY'`(填波次的飞行占位符)。
           * 全库有 **12 个** `isFlyEnemy: true` 但 `acType: null` 的敌人(冲击式施术单元、刺胄之弹、防护背心、
           * 暴鸰、枯朽之种…),它们在"普通"档里却顶着「飞行」标签 —— owner 看到的就是这个,读起来像重复归类。
           * 它们**确实**会飞(游戏里也这么走),但按 owner 的分类表它们该在「普通」,所以只留分类、不画标记。
           */ null}
        ${e.hidden ? html`<em class="cdx-tag cdx-tag--hidden">${t('隐秘核心')}</em>` : null}
      </div>
      ${e.descRaw || e.desc ? html`<div class="cdx-rich cdx-enemy__desc">
        ${e.descRaw ? html`<${RichText} as="p" text=${e.descRaw} />` : html`<p>${e.desc}</p>`}
      </div>` : null}
      ${nums.length ? html`<div class="cdx-enemy__nums">
        ${nums.map(([k, v]) => html`<span key=${k}><i>${t(k)}</i><b class="num">${v}</b></span>`)}
      </div>` : null}
    </div>
  </article>`;
}

/**
 * 类型栏(敌人档下的第二维):固定列出五型,**空格子显示成不可点**。
 *
 * 固定五格而不是"只画有内容的" —— 玩家一眼看出"这一档没有飞行敌人",而不是以为少画了一个。
 * 首领 / 其他首领级两档本来就只有"普通",所以它们那一行是三格灰的 + 一格实心的,这本身就是有用的信息
 * (首领不填波次的特殊位)。
 */
function SubBar({ subs, value, onPick }) {
  return html`<div class="cdx-subs" role="tablist" aria-label=${t('类型')}>
    ${subs.map((s) => html`<button key=${s.id} type="button" role="tab" data-sub=${s.id}
      aria-selected=${value === s.id ? 'true' : 'false'} disabled=${s.count === 0}
      class=${cx('cdx-sub', value === s.id && 'is-on', s.count === 0 && 'is-empty')}
      title=${s.count === 0 ? t('这一档没有{name}类敌人', { name: t(s.name) }) : t('{name} {n} 个', { name: t(s.name), n: s.count })}
      onClick=${() => onPick(s.id)}>
      <span>${t(s.name)}</span><b class="num">${s.count}</b>
    </button>`)}
  </div>`;
}

// ---- 翻页条 ------------------------------------------------------------------------------------------------------

/** 通用翻页条:一页一个分类,左右箭头 + 页码。owner 要的「滑动改成翻页」。 */
function Pager({ items, index, onIndex, extra = null }) {
  const cur = items[index] || null;
  return html`<div class="cdx-pager">
    <button type="button" class="cdx-pager__arrow" disabled=${index <= 0} aria-label=${t('上一页')}
      onClick=${() => onIndex(index - 1)}><${Icon} name="chevronLeft" /></button>
    <div class="cdx-pager__mid">
      <span class="cdx-pager__page num">${index + 1}<small>/${items.length}</small></span>
      <span class="cdx-pager__name">${cur ? t(cur.name) : ''}</span>
      ${cur?.micro ? html`<${MicroLabel}>${cur.micro}<//>` : null}
      ${extra}
    </div>
    <button type="button" class="cdx-pager__arrow" disabled=${index >= items.length - 1} aria-label=${t('下一页')}
      onClick=${() => onIndex(index + 1)}><${Icon} name="chevronRight" /></button>
    <div class="cdx-pager__dots">
      ${items.map((g, i) => html`<button key=${g.id} type="button" class=${cx('cdx-dot', i === index && 'is-on')}
        aria-label=${t(g.name)} title=${t(g.name)} onClick=${() => onIndex(i)}>${i + 1}</button>`)}
    </div>
  </div>`;
}

/**
 * 敌人面板:**两层导航**。
 *
 * 第一层是档次(普通敌人 / 精英敌人 / 其他首领级 / 首领)—— 用翻页条,一页一档。
 * 第二层是类型(普通 / 飞行 / 元素 / 隐秘 / 反射)—— 用固定的类型栏,空格子不可点。
 *
 * owner 的原文是「普通敌人 普通 飞行 元素 隐秘 反射;精英敌人 …」。
 * 两层而不是一层平铺 20 格:档次是人**先**要确定的(它决定"这一局要不要认真打"),
 * 类型是确定档次之后再细分的。而且首领那两档本来就只有一个类型,平铺会多出 8 个永远空的格子。
 */
function EnemyPane({ tree, m, ql }) {
  const [rank, setRank] = useState(0);
  const [sub, setSub] = useState('plain');
  const bodyRef = useRef(null);

  const ranks = tree.enemies;
  const r = ranks[Math.min(rank, Math.max(0, ranks.length - 1))] || null;
  // 换档时回到"普通"(而不是沿用上一档的类型,那会落在空格子上)
  useEffect(() => { setSub('plain'); }, [rank]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [rank, sub]);

  if (!r) return html`<p class="cdx__empty t-dim">${t('没有敌人数据')}</p>`;

  // 搜索:跨**全部**档次和类型 —— 这是搜索存在的意义
  if (ql) {
    const hit = ranks.flatMap((x) => x.subs.flatMap((s) => s.entries))
      .filter((e) => `${e.name} ${e.desc || ''}`.toLowerCase().includes(ql));
    return html`<div class="cdx__body" ref=${bodyRef}>
      <div class="cdx__hits">
        <p class="cdx__hitn t-dim">${t('命中 {n} 条', { n: hit.length })}</p>
        ${hit.length ? hit.map((e) => html`<${EnemyRow} key=${e.key} m=${m} e=${e} />`)
          : html`<p class="cdx__empty t-dim">${t('没有匹配的条目')}</p>`}
      </div>
    </div>`;
  }

  const active = r.subs.find((s) => s.id === sub && s.count > 0) || r.subs.find((s) => s.count > 0) || null;

  return html`
    <${Pager} items=${ranks} index=${Math.min(rank, ranks.length - 1)} onIndex=${setRank}
      extra=${r.roundText ? html`<span class="cdx-pager__rounds num">${t('回合 {r}', { r: r.roundText })}</span>` : null} />
    <${SubBar} subs=${r.subs} value=${active?.id || null} onPick=${setSub} />
    <div class="cdx__body cdx__body--sub" ref=${bodyRef}>
      <div class="cdx__acc-list">
        ${(active?.entries || []).map((e) => html`<${EnemyRow} key=${e.key} m=${m} e=${e} />`)}
      </div>
    </div>`;
}

// ---- 主面板 ------------------------------------------------------------------------------------------------------

/** 档案面板。挂在根上(main.js),由 `openCodex()` 打开 —— 和 `GuideHost` 同一个模式。 */
export function CodexHost() {
  const st = useStore((s) => s, Object.is, codexStore);
  const ready = useData(...CODEX_FILES.filter((n) => DATA_FILES[n]));
  const [q, setQ] = useState('');
  const [page, setPage] = useState(0);
  const [openCost, setOpenCost] = useState(null);   // 装备:展开哪个费用分组
  const [bondDetail, setBondDetail] = useState(null);
  const bodyRef = useRef(null);

  const tree = useMemo(() => buildCodex({
    bonds: data.get('bonds'), items: data.get('items'),
    enemies: data.get('enemies'), bosses: data.get('bosses'), waves: data.get('waves'),
  }), [ready]);

  // 换标签页 / 换页 → 回第一页、清搜索与展开(否则会停在上一个标签页的分组上,显示空列表)
  useEffect(() => { setPage(0); setQ(''); setOpenCost(null); }, [st.tab]);
  useEffect(() => { setPage(0); setQ(''); setOpenCost(null); }, [st.open]);
  useEffect(() => { if (bodyRef.current) bodyRef.current.scrollTop = 0; }, [st.tab, page, q]);

  const m = data.get('assets');
  const ql = q.trim().toLowerCase();
  const searching = !!ql;

  const groups = st.tab === 'bonds' ? tree.bonds : tree.items;
  const total = tree.counts[st.tab] || 0;
  const cur = groups[Math.min(page, Math.max(0, groups.length - 1))] || null;
  const loading = !ready || (!groups.length && total === 0);

  /**
   * 搜索命中:跨全部分类 + 跨两级折叠,否则"搜一件 3 费的装备"要先猜对级别和费用。
   * (敌人那一栏有自己的搜索,因为它要跨两层;见 EnemyPane。)
   */
  const hits = useMemo(() => {
    if (!searching) return null;
    const match = (e) => `${e.name} ${e.desc || ''}`.toLowerCase().includes(ql);
    if (st.tab === 'items') return tree.items.flatMap((g) => g.costs.flatMap((c) => c.entries)).filter(match);
    return tree.bonds.flatMap((g) => g.entries).filter(match);
  }, [searching, ql, tree, st.tab]);

  return html`<${Modal} open=${st.open} onClose=${closeCodex} width="11rem" class="cdx-modal"
    title=${t('档案')} micro="CODEX"
    actions=${html`<${Button} variant="primary" icon="check" onClick=${closeCodex}>${t('关闭')}<//>`}>
    <div class="cdx">
      <div class="cdx__tabs" role="tablist" aria-label=${t('档案分类')}>
        ${TABS.map((x) => html`<button key=${x.id} type="button" role="tab" data-tab=${x.id}
          aria-selected=${st.tab === x.id ? 'true' : 'false'} class=${cx('cdx__tab', st.tab === x.id && 'is-on')}
          onClick=${() => codexStore.set({ tab: x.id })}>
          <span>${t(x.name)}</span><${MicroLabel}>${x.micro}<//>
        </button>`)}
        <span class="cdx__total num" title=${t('本类条目数')}>${total}</span>
        <div class="cdx__search">
          <${TextField} value=${q} onInput=${setQ} placeholder=${t('搜索名称 / 说明')} maxLength=${24} />
        </div>
      </div>

      ${loading ? html`<div class="cdx__loading"><${Spinner} size="md" label=${t('正在读取数据…')} /></div>`
        /*
         * 敌人有自己的**两层**导航(档次翻页 + 类型栏),整块交给 EnemyPane —— 它自带搜索分支,
         * 所以不用外面这套单层分页 + 搜索的模板。
         */
        : st.tab === 'enemies' ? html`<${EnemyPane} tree=${tree} m=${m} ql=${ql} />`
          : html`
        ${/* 搜索时不分页:命中项可能散在所有分类里,分页反而让人找不到 */ null}
        ${searching ? null : html`<${Pager} items=${groups} index=${Math.min(page, groups.length - 1)} onIndex=${setPage} />`}

        <div class="cdx__body" ref=${bodyRef}>
          ${searching ? html`
            <div class="cdx__hits">
              <p class="cdx__hitn t-dim">${t('命中 {n} 条', { n: hits.length })}</p>
              ${hits.length ? (st.tab === 'items'
                ? hits.map((e) => html`<${ItemRow} key=${e.id} m=${m} e=${e} />`)
                : hits.map((e) => html`<${BondRow} key=${e.id} m=${m} e=${e} onDetail=${setBondDetail} />`))
                : html`<p class="cdx__empty t-dim">${t('没有匹配的条目')}</p>`}
            </div>`
            : st.tab === 'bonds' ? html`
              <div class="cdx__acc-list">
                ${(cur?.entries || []).map((e) => html`<${BondRow} key=${e.id} m=${m} e=${e} onDetail=${setBondDetail} />`)}
              </div>`
              : html`
                <div class="cdx__fold">
                  ${/*
                     * 两级折叠:一页一级,级下面是费用。默认全收起(owner:「折叠栏 1级 1费装备 2费装备 3费装备」)。
                     * 收起的头一行就写清"这一级有几件、哪几个费用",所以收起时也不是一无所知。
                     */ null}
                  ${(cur?.costs || []).map((c) => {
                    const open = openCost === c.id;
                    return html`<section key=${c.id} class=${cx('cdx-fold', open && 'is-open')}>
                      <button type="button" class="cdx-fold__head" aria-expanded=${open ? 'true' : 'false'}
                        onClick=${() => setOpenCost(open ? null : c.id)}>
                        <${Caret} open=${open} />
                        <b>${t(c.name)}</b><${MicroLabel}>${c.micro}<//>
                        <span class="cdx-fold__n num">${c.entries.length}</span>
                      </button>
                      ${open ? html`<div class="cdx-fold__body">
                        ${c.entries.map((e) => html`<${ItemRow} key=${e.id} m=${m} e=${e} />`)}
                      </div>` : null}
                    </section>`;
                  })}
                </div>`}
        </div>`}
    </div>
    <${BondDetail} m=${m} e=${bondDetail} onClose=${() => setBondDetail(null)} />
  <//>`;
}

/** 入口按钮(干员调配的标签行用它)。画成 `<button>` 而不是 `<Button>`,因为要和大厅那个「预设」标签长得一样。 */
export function CodexButton({ class: cls, icon = 'book' }) {
  return html`<button type="button" class=${cx('lo-tab lo-tab--codex', cls)} data-testid="codex-open"
    title=${t('档案：按分类查看盟约、装备与敌人')} onClick=${() => openCodex('bonds')}>
    <${Icon} name=${icon} class="lo-top__icon" />${t('档案')}</button>`;
}
