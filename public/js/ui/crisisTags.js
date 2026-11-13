// 危机合约 · 本局词条的三个展示组件（官方 crisisTags.js 的 CrisisTagRows / CrisisTagStrip / CrisisTagButton）。
//
// 从 screens/room.js 抽出来的原因：局内顶栏（ui/hud.js TopBar）也要开同一个弹窗，
// 若由 ui 层反过来 import screens 层，就形成了分层反向依赖。这里放在 ui 层，房间页与局内都 import 它。
import { html } from './components.js';
import { alertDialog } from './components.js';
import { t } from '../../../shared/i18n.js';
import { crisisTag, crisisFxText, isArcCrisis } from '../../../shared/crisis.js';
import { arcTag } from '../../../shared/crisisArc.js';
import { seedCode } from '../../../shared/crisisSeed.js';
import { CrisisGlyph } from './crisisGlyph.js';
import { copyText } from './clipboard.js';

/**
 * 一个 selection 里的 tag id → tag 记录。
 * ★★ 必须按赛季分流：弧光作战的 id 是 **两字母前缀**（`XA1-2`，ARC_TAG_RE = /^(X[A-O][1-9])-([1-3])$/），
 * 而主表危机合约是 `A1-1` 形状（TAG_RE = /^([A-U][1-9])-([1-3])$/）。
 * room.js 原来两个组件都只调 crisisTag() ⇒ 弧光 id 一条都匹配不上、返回 null 被 filter 掉，
 * 于是「本局词条 · N」标题有、弹窗里 **一行内容都没有**（用户 2026-11-08「弧光作战看不了」的根因）。
 */
const tagOfSel = (crisis, id) => (isArcCrisis(crisis) ? arcTag(crisis.mode, id) : crisisTag(crisis.mode, id));

/**
 * 本局词条的列表（官方 crisisTags.js:383 的 CrisisTagRows）：每行一个指标图标 + 名称 + 效果文本。
 * 类名全部官方：.cc-tagrows / .cc-tagrows__row / .is-long / .is-full（crisis-event.css 645-649、710-711）。
 */
export function CrisisTagRows({ crisis, full = false }) {
  if (!crisis || !Array.isArray(crisis.tags)) return null;
  const mode = crisis.mode === 'quad' ? 'quad' : 'solo';
  const tags = crisis.tags.map((id) => tagOfSel(crisis, id)).filter(Boolean);
  // 超过 12 个就两列排、并且不写效果文本（官方的 is-long）
  const long = !full && tags.length > 12;
  return html`<div class=${'cc-tagrows' + (long ? ' is-long' : '') + (full ? ' is-full' : '')}>
    ${tags.map((tg) => {
      const fx = crisisFxText(tg.route.id, mode, tg.tier);
      return html`<div key=${tg.id} class="cc-tagrows__row">
        <${CrisisGlyph} tag=${tg} />
        <b>${t(tg.route.name)}</b>
        ${long || !fx ? null : html`<span>${fx.text}</span>`}
      </div>`;
    })}
  </div>`;
}


/**
 * 房间顶栏的合约条（官方 crisisTags.js:297 的 CrisisTagStrip）：模式与风险、本局词条按钮、每个指标的图标。
 * 类名官方：.cc-tagstrip / __head / __list / __tag（crisis-event.css 634-644）。
 * ★ 开局种子（官方的 __seed 按钮 + cc-seedpanel）没有移植：那要 crisis.preview 服务端预览，不在本次范围。
 */
export function CrisisTagStrip({ crisis }) {
  if (!crisis || !Array.isArray(crisis.tags)) return null;
  const mode = crisis.mode === 'quad' ? 'quad' : 'solo';
  const tags = crisis.tags.map((id) => tagOfSel(crisis, id)).filter(Boolean);
  return html`<div class="cc-tagstrip" aria-label=${t('危机合约指标')} data-testid="cc-tagstrip">
    <span class="cc-tagstrip__head">
      <b>${t('危机合约')}</b>
      <em>${mode === 'quad' ? t('四人合约') : t('单人合约')} · ${t('风险')} <i class="num">${crisis.total}</i></em>
    </span>
    <${CrisisTagButton} crisis=${crisis} />
    <span class="cc-tagstrip__list">${tags.map((tg) => html`<span key=${tg.id} class="cc-tagstrip__tag"
      title=${t(tg.route.name) + '：' + (crisisFxText(tg.route.id, mode, tg.tier)?.text || '')}>
      <${CrisisGlyph} tag=${tg} /></span>`)}</span>
  </div>`;
}

/**
 * 「本局词条 · N」（官方 crisisTags.js:455 的 CrisisTagButton）：点开弹窗列出本局签下的指标。
 * 官方的弹窗是 alertDialog，这里用项目自己的 dialog（components.js 的 alertDialog），结构对齐官方：
 * 标题「本局词条」+ micro（模式 · 指标总计）。
 */
export function CrisisTagButton({ crisis, compact = false }) {
  if (!crisis || !Array.isArray(crisis.tags)) return null;
  const mode = crisis.mode === 'quad' ? 'quad' : 'solo';
  const season = isArcCrisis(crisis) ? t('弧光作战') : t('重燃作战');
  // 开局种子（图一「复制开局种子 2YH2-1EAB」）：seed 是 32 位整数，展示用 seedCode 编成 XXXX-XXXX。
  const seed = Number.isInteger(crisis.seed) && crisis.seed > 0 ? crisis.seed : null;
  const code = seed ? seedCode(seed) : '';
  const show = () => alertDialog({
    title: t('本局词条'),
    micro: [mode === 'quad' ? t('四人合约') : t('单人合约'), t('指标总计') + ' ' + crisis.total, seed ? t('开局种子') + ' ' + code : null]
      .filter(Boolean).join(' · '),
    okText: t('关闭'),
    text: html`<div data-testid="cc-tags-dialog">
      ${seed ? html`<button type="button" class="cc-tags-dialog__copy" data-testid="cc-tags-copy-seed"
        onClick=${() => { copyText(code); }}>${t('复制开局种子')} ${code}</button>` : null}
      <${CrisisTagRows} crisis=${crisis} full=${true} />
    </div>`,
  });
  // compact：局内顶栏用的小按钮，只有数字，不带「本局词条」四字（顶栏宽度紧张）。
  return html`<button type="button" class=${'cc-tags-button' + (compact ? ' is-compact' : '')}
    data-testid="cc-tags-button" onClick=${show}
    title=${t('查看本局签下的指标') + (seed ? ' · ' + t('开局种子') + ' ' + code : '')}>${compact ? null : t('本局词条') + ' · '}${crisis.tags.length}</button>`;
}
