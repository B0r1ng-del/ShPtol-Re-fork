// 敌方情报面板 —— 局内顶栏右侧**橙色**放大镜（官方 btn_check_enemy）弹出的浮层。
//
// ★ 来源（用户要求 2026-11-26）：从 ui/enemyDrawer.js 旧版「敌方情报」tab **整段搬出**，渲染逻辑一字未改；
//   绿镜改成整屏「确认本局信息」后不再有 tab，敌方面板改为独立浮层，锚在橙镜正下方。
//
// ★ 与敌方场地（pen）是同一件事的两面（用户原话：「点击橙色放大镜后会来到敌方场地，返回玩家战场时自动隐藏」）：
//   面板的渲染条件直接绑 screens/game.js 的 pen 状态，**不新造状态** —— 这样「返回自动隐藏」和
//   「可反复触发」由既有相机状态机天然保证，不存在两套状态不同步的可能。
//
// ★ 不 import enemyDrawer.js：那个文件现在只剩 MatchInfoScreen（绿镜整屏），敌方面板与它无关。
//   下面用到的 groupEnemies / factionTypes 仍从 ui/gameLogic.js 取（与旧版同一个 re-export 源）。

import { html, MicroLabel } from './components.js';
import { Img, UnitThumb, GIcon } from './gameComponents.js';
import { groupEnemies, factionTypes } from './gameLogic.js';
import { factionIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { t, tParts, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const TAG = { boss: N_('领袖'), bounty: N_('悬赏'), escort: N_('护卫') };

/** 本局参战势力的图标 + 名称。搬自 enemyDrawer.js 旧版 :22-27。 */
function FactionChips({ types }) {
  const f = data.get('factions')?.types || {};
  const m = data.get('assets');
  return html`<div class="fchips">${types.map((t) => html`<span key=${t} class="fchip" title=${f[t]?.desc || ''}>
    <${Img} src=${factionIconUrl(m, f[t]?.icon)} class="fchip__icon" /><span>${f[t]?.name || t}</span></span>`)}</div>`;
}

/**
 * 敌方情报内容体。搬自 enemyDrawer.js 旧版 EnemiesTab（HEAD:28-61），**逻辑一字未改**，
 * 只把外层 .edrawer__body 换成 .ebody 以便挂在新的浮层壳里（.edrawer__sum / .elist / .erow / .etag /
 * .eboss / .fchips 等类名全部沿用 game-panels.css 既有样式，零新配色）。
 *
 * @param {{ pub:any, priv:any, onEnemy:(key:string,count:number)=>void }} props
 *   数据直读 priv.nextEnemies，不缓存、不做快照 ⇒ 面板每次打开拿到的必然是当前局的敌方数据。
 */
function EnemyInfoBody({ pub, priv, onEnemy }) {
  const rows = groupEnemies(priv?.nextEnemies, (k) => data.lookup('enemies', k));
  const types = factionTypes(pub?.factions);
  const f = data.get('factions')?.types || {};
  const total = rows.reduce((s, r) => s + r.count, 0);
  const boss = pub?.bossId ? data.lookup('bosses', pub.bossId) : null;
  return html`<div class="ebody">
    <div class="edrawer__sum">
      <span>${tParts('第 {r} 回合 · 即将迎击 {n} 名敌人', { r: html`<b class="num">${pub?.round ?? '-'}</b>`, n: html`<b class="num t-orange">${total}</b>`, count: total })}</span>
      ${types.length ? html`<${FactionChips} types=${types} />` : null}
    </div>
    ${rows.length ? html`<div class="elist">
      ${rows.map((r) => html`<button key=${r.enemyKey + '|' + r.tag} type="button" class=${cx('erow', r.tag && 'erow--' + r.tag, 'erow--' + r.rank.toLowerCase())}
          onClick=${() => onEnemy(r.enemyKey, r.count)}>
        <${UnitThumb} kind="enemy" id=${r.enemyKey} size="md" />
        <span class="erow__text">
          <b class="erow__name">${r.name}</b>
          <span class="erow__tags">
            ${r.tag ? html`<span class=${'etag etag--' + r.tag}>${t(TAG[r.tag] || r.tag)}</span>` : null}
            ${r.rank === 'ELITE' ? html`<span class="etag etag--elite">${t('精英')}</span>` : null}
            ${r.fly ? html`<span class="etag etag--fly">${t('空中')}</span>` : null}
            ${r.acTypes.map((ty) => html`<span key=${ty} class="etag etag--faction">${(f[ty]?.name || ty).replace(t('特训敌人·'), '')}</span>`)}
          </span>
        </span>
        <b class="erow__count num">×${r.count}</b>
      </button>`)}
    </div>` : html`<p class="edrawer__empty"><${GIcon} name="target" />${t('暂无敌方情报')}</p>`}
    ${boss ? html`<div class="eboss">
      <${UnitThumb} kind="enemy" id=${boss.enemyKey} size="md" />
      <div><${MicroLabel} tone="gold">${t('ENEMY LEADER // 敌方领袖')}</${MicroLabel}><b>${boss.name}</b>
        <span class="t-lo">${t('第 {r} 回合 · 最终攻势', { r: data.get('config')?.modes?.[pub.modeId]?.bossRound ?? pub.lastRound ?? 14 })}</span></div>
    </div>` : null}
  </div>`;
}

/**
 * 橙镜下方的敌方情报浮层。
 *
 * 定位由调用方（screens/game.js）算好 top/left/宽度/可用高度传进来 —— 因为橙镜的 rect 会随相机切换而横移
 * （实测 1256×774：prep 态 right=1025.75，pen 态 right=1424.69，同一次点击内移动 374px），
 * 所以锚点必须在 pen 生效之后重新量，不能缓存。
 *
 * 面板不写死高度，由内容撑开，只受一个上限约束 —— `anchor.maxHeight`（橙镜底边到视口底的真实可用高度）。
 * 于是「加长多少」自动等于「本回合有多少种敌人」：种类少就收短，种类多就一直长到屏幕底边。
 * 上限通过 CSS 变量 --einfo-max 下发（见 css/screens/game-panels.css 的 .einfo）。
 *
 * @param {{ pub:any, priv:any, anchor:{top:number,left:number,width:number,maxHeight?:number}|null, onEnemy:(key:string,count:number)=>void }} props
 *   anchor 为 null 时不渲染（避免首帧闪到 0,0）。
 */
export function EnemyInfoPanel({ pub, priv, anchor = null, onEnemy = () => {} }) {
  if (!anchor) return null;
  const style = { top: anchor.top + 'px', left: anchor.left + 'px', width: anchor.width + 'px' };
  if (Number.isFinite(anchor.maxHeight) && anchor.maxHeight > 0) style['--einfo-max'] = anchor.maxHeight + 'px';
  return html`<div class="einfo brackets" role="dialog" aria-label=${t('敌方情报')} style=${style}>
    <${EnemyInfoBody} pub=${pub} priv=${priv} onEnemy=${onEnemy} />
  </div>`;
}
