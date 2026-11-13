// public/js/ui/crisisArcResult.js — 危机合约 · 弧光作战 的行动结束页
//
// 官方是 crisisArcResult.js 的 CrisisArcResult（三段 take：0 → RESULTS 大字 → 2 终版结算）。
// 结构照抄官方：.car / .car--t0..2 / .car-t1 / .car-t2 / .car-fin 与 .car-* 全部子块，类名一律用官方
// 已有的（css/official/crisis-event.css 915 起整段 .car-* 都在）。
//
// ★ 美术：这条页面要 23 张 settle/ 贴图（bg_main / bg_arrow_halftone / totem_shape_inner / new_record_splat /
//   scanline / bg_light / result_graphic_back / fin_dec_* / score_back_light / rate_frame / text_new_record_small /
//   fin_node_content_frame / fin_scroll_arrow / icon_hp …），本地资产包一张都没有（已逐个 glob 核对）。
//   缺失处一律用官方 CSS 已有的底色/边框撑住版式，不发明替代图；六边形雷达用 cc4-arclight 的
//   diagram-bkg.png + diagram-outline.png（230x200，正好 .car-hex 的尺寸）。
//   有贴图后把 SETTLE 常量指向真实目录即可，结构不用动。
import { awardSanctumCoin } from './crisisEventPage.js';
import { useEffect, useMemo, useState } from '../../vendor/hooks.module.js';
import { html, doctorNo } from './components.js';
import { store } from '../store.js';
import { useData, data } from '../data.js';
import { CrisisGlyph } from './crisisGlyph.js';
import { chessPortraitUrl } from './assetUrls.js';
import { useStageScale } from './crisisResult.js';
import { t, N_ } from '../../../shared/i18n.js';

const CC_ART = '/assets/local/cc4-arclight/';
/** 官方 crisisArcResult.js 的 S()：settle/ 贴图的根。
 *  ★ 上一版这里写 /assets/ui/settle/ 是**错的** —— 官方的 S() 根是 CC_ART + settle/。
 *  33 张贴图已全部入仓（逐个 HTTP 200 核对过），直接用。 */
export const SETTLE = CC_ART + 'settle/';
/** 贴图 URL 助手（官方同名）。注意必须定义在 SETTLE 之后，否则 TDZ 报错。 */
const S = (f) => SETTLE + f + '.png';
const LETTERS = ['R', 'E', 'S', 'U', 'L', 'T', 'S'];
const T1 = 1500, T2 = 3400;   // take 1 → take 2 → 终版（官方常量，不自己调）

/** 官方的六个维度（crisisArcResult.js:27 的 DIMS，顺序即雷达的顺时针顺序）。 */
export const ARC_DIMS = [
  { name: N_('战略'), groups: 'NO' },
  { name: N_('技巧'), groups: 'HIJKLM' },
  { name: N_('调遣'), groups: 'C' },
  { name: N_('应变'), groups: 'BG' },
  { name: N_('洞察'), groups: 'D' },
  { name: N_('筹划'), groups: 'AEF' },
];

/** 官方 dimsOf：每一维的等级和，以及它占该模式下限的比例（决定雷达那条红线的长度）。 */
export function dimsOf(tags) {
  return ARC_DIMS.map((d, i) => {
    // 官方的 tag 记录把分组放在 t.g；本项目的 crisisTag() 放在 t.route.g（它是 { id, route, tier, lv }）
    const g = (x) => x.g ?? x.route?.g ?? '';
    const hit = (tags || []).filter((x) => d.groups.includes(g(x)));
    const v = hit.reduce((n, x) => n + (x.lv || 0), 0);
    // 官方的分母是「该模式这一维能拿到的最高等级和」；没有路由表时用已选中的最高值兜底，只为让红线有长度
    const max = hit.reduce((n, x) => n + Math.max(1, x.lv || 1), 0) || 1;
    return { ...d, i, v, f: v > 0 ? 0.3 + 0.7 * Math.min(1, v / max) : 0 };
  });
}

const mmss = (s) => `${String(Math.floor(s / 60) % 100).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const pad = (n) => String(n).padStart(2, '0');
const stamp = (ms) => { const d = new Date(ms); return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };

/** 官方 Hex(dims, big)：diagram_atlas 的底图 + 描边 + 六条红线，big 时外圈再标维度名与数值。 */
function Hex({ dims, big = false }) {
  return html`<div class=${'car-hex' + (big ? ' is-big' : '')}>
    <img class="car-hex__bkg" src=${S('bkg')} alt="" />
    ${dims.map((d) => html`<i class="car-hex__way" key=${d.i} style=${{ '--a': `${d.i * 60 - 90}deg`, '--f': d.f, '--d': `${d.i * 70}ms` }}></i>`)}
    <i class="car-hex__ol" style=${{ '--m': `url(${S('outline_normal')})` }}></i>
    <img class="car-hex__mid" src=${S('center_decor')} alt="" />
    ${big ? dims.map((d) => {
      const a = (d.i * 60 - 90) * Math.PI / 180;
      return html`<span class="car-hex__lbl" key=${d.i} style=${{ left: `${50 + Math.cos(a) * 74}%`, top: `${50 + Math.sin(a) * 86}%`, '--d': `${300 + d.i * 90}ms` }}>
        <img src=${S(`diagram_icon_battle_settle_${d.i}`)} alt="" /><b class="num">${d.v}</b><small>${t(d.name)}</small></span>`;
    }) : null}
  </div>`;
}

/**
 * 弧光作战的行动结束页（官方 CrisisArcResult）。
 * @param {{ run: any, onRetry?: Function, onDone: Function }} props
 *   run: { mode, tags, total, best, seconds, victory, seed, teamLp, players, endedAt }
 */
export function CrisisArcResult({ run, onRetry, onDone }) {
  const [take, setTake] = useState(0);
  // 结晶货币（需求方 2026-11-13，第三版规则）：「完整通关一整把游戏才会发放货币，中途退出或失败不发放」。
  // ⇒ 只有 run.victory 为真才发，且发的数量是「每打 1 指标一枚」(run.total)。
  // ★ 官方没有这个经济；这一版把发放条件收紧到「通关」，失败/中断一枚都不给。
  // ★ 只发一次：依赖 run.endedAt（同一局结算页重渲染不会重复发）。
  useEffect(() => {
    if (!run?.victory) return;
    awardSanctumCoin(Number(run?.total) || 0);
  }, [run?.endedAt, run?.victory]);
  useEffect(() => {
    const a = setTimeout(() => setTake((x) => Math.max(x, 1)), T1);
    const b = setTimeout(() => setTake(2), T2);
    return () => { clearTimeout(a); clearTimeout(b); };
  }, []);
  const next = () => setTake((x) => Math.min(2, x + 1));
  const ccS = useStageScale();
  const ready = useData('assets', 'bonds', 'bands');
  // 干员立绘要 assets 清单；没就绪时 art 为 null，卡片仍按官方「无信息」底图渲染。
  const m = ready ? data.get('assets') : null;
  const me = store.get().me || {};
  const solo = run.mode === 'solo';
  const dims = useMemo(() => dimsOf(run.tags), [run]);
  // 官方存档里 run.tags 是 tag 记录（带 g/lv）；本项目传进来的是 crisisTag() 的结果，结构一致
  const tags = run.tags || [];
  const record = run.victory && run.total > (run.best || 0);
  const lp = solo ? (run.players?.find((p) => p.playerId === me.playerId)?.lp ?? run.teamLp) : run.teamLp;
  const myName = me.name || t('博士');
  return html`<div class=${'car car--t' + take + (run.victory ? ' is-win' : ' is-lose') + (solo ? ' is-solo' : '')}
      style=${{ '--cc-s': ccS }}
      onClick=${take < 2 ? next : undefined} data-testid="ca-result" data-take=${take}>
    <div class="car-back" style=${{ backgroundImage: `url(${S("bg_main")})` }}></div>
    <div class="cc-stage car-stage">
      <div class="car-t1">
        <div class="car-letters">${LETTERS.map((l, k) => html`<b key=${k} style=${{ '--d': `${200 + k * 70}ms` }}>${l}</b>`)}</div>
        <div class="car-t1__verdict">${run.victory ? t('行动成功') : t('行动失败')}</div>
      </div>
      <div class="car-t2">
        ${/* 图二左侧那条 635×720 的红色斜带（官方 .car-arrow 在 crisis-event.css:926 早已定义，
              此前 JSX 从没渲染过 ⇒ 结算页缺了整条斜带与 RESU 大字底）。 */''}
        <div class="car-arrow"><i class="car-arrow__fill"></i><img class="car-arrow__tone" src=${S("bg_arrow_halftone")} alt="" /></div>
        <i class="car-horizon"></i>
        <div class="car-band">${[0,1,2,3,4,5].map((k) => html`<img class="car-band__in" key=${k} src=${S("totem_shape_inner")} alt="" style=${{ "--r": (30 + k * 60) + "deg" }} />`)}</div>
        <div class="car-letters is-faint">${LETTERS.map((l, k) => html`<b key=${k}>${l}</b>`)}</div>
        <div class="car-t2__hex"><img class="car-t2__splat" src=${S("new_record_splat")} alt="" /><${Hex} dims=${dims} big=${true} /></div>
        <i class="car-scan" style=${{ backgroundImage: `url(${S("scanline")})` }}></i>
        <img class="car-light" src=${S("bg_light")} alt="" />
      </div>

      <div class="car-fin">
        <div class="car-left">
          <div class="car-crumb">// ${t('行动结束')} · <b class=${run.victory ? 'is-win' : 'is-lose'}>${run.victory ? t('行动成功') : t('行动失败')}</b>
            <span>${solo ? t('单人') : t('四人')}</span>
            <span>${t('行动时长')} <b class="num">${mmss(run.seconds || 0)}</b></span></div>
          <div class=${'car-cols' + (solo ? ' is-solo' : '')}>
            ${(run.players || []).slice(0, 4).map((p, i) => {
              // 图二：每张卡是「干员立绘 + 底部渐变 + LP 等级框 + 红色未通过条」。
              // lineup 的元素是 {id, golden, tier, ...}，id 就是 chess.json 的键 ⇒ data.lookup 取记录再要立绘。
              const rec = m && Array.isArray(p.lineup) && p.lineup.length ? data.lookup('chess', p.lineup[0].id) : null;
              const art = rec ? chessPortraitUrl(m, rec) : null;
              const dead = p.alive === false && p.left !== true;
              return html`<div key=${p.playerId ?? i} class=${`car-col${p.playerId === me.playerId ? ' is-self' : ''}`} style=${{ '--i': i }}>
                <div class="car-card" style=${{ borderImageSource: `url(${S("char_boarder")})` }}><div class="car-card__panel">
                  <img class="car-card__none" src=${S("fin_char_no_info")} alt="" />
                  ${art ? html`<img class="car-card__art" src=${art} alt="" />` : null}
                  ${art ? html`<i class="car-card__grad" style=${{ '--m': `url(${S("card_gradient")})` }}></i>` : null}
                  ${dead ? html`<span class="car-card__out">${t('未通过')}</span>` : null}
                  <span class="car-card__seat">P${i + 1}</span>
                  <span class="car-card__lv"><small>LP</small><b class="num">${p.lp ?? '--'}</b></span>
                  ${rec ? html`<i class="car-card__skill"><img src=${S("skill")} alt="" /></i>` : null}
                </div></div>
                <div class="car-col__name">${p.name || '—'}</div>
                ${rec ? html`<div class="car-col__band">${t(rec.name)}</div>` : null}
              </div>`; })}
          </div>
          ${/* 图二左侧「阵营契约」：官方 .car-bond 一行一个（crisis-event.css:1012）。
                 数据在 players[].bonds（bondsMeta.bondList：{bondId, count, active, tier, layers}）。
                 自己的那一份优先；一个人都没激活就照官方写「未激活阵营契约」。 */''}
          ${(() => {
            const mine = (run.players || []).find((x) => x.playerId === me.playerId) || (run.players || [])[0];
            const list = Array.isArray(mine?.bonds) ? mine.bonds : [];
            const shown = list.filter((b) => b.active).slice(0, 4);
            // ★ 官方 .car-bond 是 static（只有 .car-right > * 才被强制 absolute），
            //   直接放进 .car-left 会落到文档流顶部压住面包屑 —— 这里套一层绝对定位容器，
            //   落在角色卡下方（单人卡位 x=24，卡高 196 + 名字 26 ⇒ y≈300）。
            if (!shown.length) return html`<div class="car-bonds"><div class="car-bond is-none">${t('未激活阵营契约')}</div></div>`;
            return html`<div class="car-bonds">${shown.map((b) => {
              const rec = data.lookup('bonds', b.bondId);
              return html`<div class="car-bond" key=${b.bondId}>
                ${/* 官方 .car-bond__ic 是 26×25 的贴图槽；本地资产包没有 bond 图标，
                       不发明替代图 —— 缺就整格不画，名字与层数照官方照排。 */''}
                <span class="car-bond__name">${rec ? t(rec.name) : b.bondId}</span><b class="num">${b.layers || b.count || 0}</b>
              </div>`;
            })}</div>`;
          })()}
        </div>
        <div class="car-right">
          <img class="car-r__gback" src=${S("result_graphic_back")} alt="" />
          <img class="car-r__dec car-r__dec--graph" src=${S("fin_dec_graph")} alt="" />
          <div class="car-r__hex"><${Hex} dims=${dims} /></div>
          <div class="car-score">
            <img class="car-score__light" src=${S("score_back_light")} alt="" />
            <img class="car-r__dec car-score__dec" src=${S("fin_dec_source")} alt="" />
            <img class="car-r__dec car-score__decr" src=${S("fin_dec_rate")} alt="" />
            <b class="car-score__num num">${run.total}</b>
            ${record ? html`<img class="car-score__new" src=${S("text_new_record_small")} alt=${t('新纪录')} />` : null}
            ${/* 图二 123 右边那组：两个红刻条 + 中间的方框徽章（官方 .car-score__rate，crisis-event.css:1042）。
                 数值是「本局评价 / 满评价」，官方用 rate_frame.png 做徽章、两条 mask 做刻度。 */''}
            <div class="car-score__rate" title=${t('本局评价')}>
              <i style=${{ '--m': `url(${S("rate_frame")})` }}></i>
              <img src=${S("rate_frame")} alt="" />
              <i style=${{ '--m': `url(${S("rate_frame")})` }}></i>
            </div>
          </div>
          <div class="car-nodes">
            <img class="car-nodes__fl" src=${S("fin_node_content_frame")} alt="" />
            <img class="car-nodes__fr" src=${S("fin_node_content_frame")} alt="" />
            <div class="car-nodes__grid">${tags.map((tg, k) => html`<span class="car-node" key=${tg.id} style=${{ '--k': k }} data-testid="ca-node">
              <${CrisisGlyph} tag=${tg} /><em><i></i><b class="num">${tg.lv}</b></em></span>`)}</div>
          </div>
          <div class="car-hp"><span class="car-hp__l">${t('剩余生命值')}</span><span class="car-hp__r"><img src=${S("icon_hp")} alt="" /><b class="num">${lp ?? '--'}</b></span></div>
          <div class="car-info">
            <img class="car-r__dec car-info__ddate" src=${S("fin_dec_date")} alt="" />
            <div class="car-info__date num">${stamp(run.endedAt || Date.now())}</div>
            <img class="car-r__dec car-info__dname" src=${S("fin_dec_name")} alt="" />
            <div class="car-info__name">Dr.${myName}#${doctorNo(me.playerId)}</div>
            <i class="car-info__line"></i>
            <div class="car-info__nation">${t('哥伦比亚')}</div>
            <div class="car-info__loc">${t('滞空焦点')}</div>
          </div>
        </div>
        <div class="car-btns" onClick=${(e) => e.stopPropagation()}>
          ${onRetry ? html`<button type="button" class="car-btn" onClick=${onRetry}>${t('重新挑战')}</button>` : null}
          <button type="button" class="car-btn is-main" onClick=${onDone}>${t('完成')}</button>
        </div>
      </div>
      ${take < 2 ? html`<div class="car-skip">${t('点击继续')}</div>` : null}
    </div>
  </div>`;
}