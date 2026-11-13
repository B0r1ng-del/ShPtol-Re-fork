// 危机合约 · 局内商店行的合约信息（official crisisTags.js CrisisShopLine）。
//
// 官方那一行还显示 保命/刷新/操作/消耗品/调整 的剩余次数与核心盟约 —— 那些次数系统本项目尚未移植，
// 所以这里只显示**真实有数据支撑**的三项：本回合承压位（U1）、悬赏精英（R4）、开局种子。
// 三项都来自服务端 m.private.crisis，没装合约时该字段不存在，组件返回 null（不占位）。
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { getEnemy } from '../data.js';

/** 敌人 key → 显示名。数据未加载或没有该条时退回 key（绝不显示空白）。 */
// getEnemy 就是 data.lookup('enemies', id)（public/js/data.js:630），内部只有 ?. 与 ??，不会抛 ——
// 原来那两层 try/catch 加 data.get 兜底是多余的，删掉。
function enemyName(key) {
  return (getEnemy(key)?.name) || key;
}

/** 玩家 id → 显示名（本局 players 里找不到就退回「队友」）。 */
function playerName(players, pid) {
  const p = Array.isArray(players) ? players.find((x) => x && x.playerId === pid) : null;
  return (p && p.name) || t('队友');
}

export function CrisisShopLine({ priv, pub, expanded = true, onToggle = null }) {
  const cx = priv && priv.crisis;
  if (!cx) return null;
  const players = (pub && pub.players) || null;
  const pressure = cx.pressure && cx.pressure.playerId ? cx.pressure : null;
  const bounty = cx.bounty && cx.bounty.key ? cx.bounty : null;
  const seed = typeof cx.seed === 'string' && cx.seed ? cx.seed : null;
  if (!pressure && !bounty && !seed) return null;
  return html`<span class=${'cc-shopline' + (expanded ? ' is-expanded' : ' is-minimized')} title=${t('危机合约：本回合的合约状态')}>
    <button type="button" class="cc-shopline__toggle" aria-expanded=${expanded}
        aria-label=${expanded ? t('折叠合约信息') : t('展开合约信息')}
        onClick=${() => { if (onToggle) onToggle(); }}>
      <b>${t('合约')}</b><span aria-hidden="true">${expanded ? t('收起 ▾') : t('展开 ▴')}</span>
    </button>
    ${expanded ? html`<span class="cc-shopline__body">
      ${pressure ? html`<span class=${'cc-shopline__press' + (pressure.me ? ' is-me' : '')}
          title=${t('分线承压：该博士的原战区本回合第20秒追加2名精英位敌人，不提供奖励')}>${t('承压')}<i>${pressure.me ? t('你') : playerName(players, pressure.playerId)}</i></span>` : null}
      ${bounty ? html`<span class="cc-shopline__bounty"
          title=${t('破阵悬赏：本回合被标记的精英，生命增加25%；首次击倒后，在场干员各获得10点技力并回复10%最大生命')}>${t('悬赏')}<i>${enemyName(bounty.key)}</i></span>` : null}
      ${seed ? html`<span class="cc-shopline__seed" title=${t('开局种子：同一种子 + 同一组指标 + 同样的 BAN 地图，开局完全一样')}>${t('种子')}<i>${seed}</i></span>` : null}
    </span>` : null}
  </span>`;
}
