// public/js/ui/growth.js — 潜能 / 练度 panel (培养 · GROWTH), the 6th tab of the 干员调配 detail card.
//
// WHY IT LIVES HERE. Both settings are PER OPERATOR and belong to the same family as 技能 / 模组 / 换装: the player opens a
// card for one operator and configures everything about them there. A tab of its own keeps that habit — an operator's
// 潜能 is found where their skill is, not in a second screen.
//
// 潜能 (potential, 1–6) and 练度 (cultivate, 0–3) are the official 干员养成 axes:
//   * 潜能 1–6   — 6 = 满潜 (the default; the data's own numbers). 1–5 compose the record at that rank
//                  (shared/potential.js atPotential: stats / talents / module talent changes).
//   * 练度 0–3   — 0 未精英化 / 1 精英1 / 2 精英2 / 3 精英2 Lv.60 (the default). ATK / DEF / max HP come from
//                  data/effects.json `char_attribute_mul` (shared/potential.js cultivateMul): ×1 / 攻防×1.05 /
//                  攻×1.1 防血×1.05 / ×1.1.
//
// ⚠ WHAT THE PLAYER SEES vs WHAT THE DATA SUPPORTS. 练度 is fully backed by data/effects.json and always changes the
// numbers. 潜能 needs a `potBelow` / `potMin` chain on the record, and data/chess.json in THIS build carries none
// (`hasPotentialData` is false for every record) — so lowering 潜能 stores the setting and the server composes the record
// at that rank, but the numbers stay the same until the data is regenerated. The panel SAYS SO (`potentialSupported`)
// instead of pretending: a control that silently does nothing is worse than one that explains itself.
//
// Both values ride C2S `room.loadout { entries, ops }` (ui/loadoutSync.js, ops = `{ [charId]: { potential, cultivate } }`)
// and reach the unit through the battle input (`potential` → getChess's loadout, `cultivate` → the unit's cultMul).

import { html, MicroLabel, Button } from './components.js';
import { t, N_ } from '../../../shared/i18n.js';
import {
  POTENTIAL_MIN, POTENTIAL_MAX, POTENTIAL_DEFAULT, isPotential,
  CULTIVATE_DEFAULT, cultivateMul, hasPotentialData,
} from '../../../shared/potential.js';
import { loadoutStore, setOpSetting, opSettingOf } from './loadoutSync.js';
import { useStore } from '../store.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 潜能 rank names: 潜能 1…6. The official wording is just the number. */
export const POTENTIAL_RANKS = Object.freeze(
  Array.from({ length: POTENTIAL_MAX - POTENTIAL_MIN + 1 }, (_, i) => POTENTIAL_MIN + i),
);

/**
 * 练度 tiers with what each does, read STRAIGHT from the data (no hard-coded numbers): the panel cannot drift from what
 * the sim applies. `mul === null` (no effects.json) disables the whole row.
 */
export function cultivateTiers(effects) {
  const out = [];
  for (let v = 0; v <= 3; v++) out.push({ value: v, mul: cultivateMul(effects, v) });
  return out;
}

/**
 * The 练度 row's description: the multipliers as percentages, e.g. 「攻击力+10%，防御力和最大生命值+5%」.
 * Built from `mul` so it matches the sim to the digit.
 */
export function cultivateHint(mul) {
  if (!mul) return '';
  const pct = (x) => Math.round((x - 1) * 1000) / 10;
  const parts = [];
  if (pct(mul.atk)) parts.push(t('攻击力 +{n}%', { n: pct(mul.atk) }));
  if (pct(mul.def)) parts.push(t('防御力 +{n}%', { n: pct(mul.def) }));
  if (pct(mul.hp)) parts.push(t('最大生命值 +{n}%', { n: pct(mul.hp) }));
  return parts.length ? parts.join('，') : t('无加成');
}

/** 练度 tier label (the official 精英阶段 wording). */
export const cultivateLabel = (v) => (v === 0 ? N_('未精英化')
  : v === 1 ? N_('精英 1')
    : v === 2 ? N_('精英 2')
      : N_('精英 2 Lv.60'));

/**
 * Does ANY loaded record carry a 潜能 chain? When none does (this build), the 潜能 row is shown but marked as having no
 * effect yet — see the header. Cheap: it stops at the first hit and the caller memoises per data load.
 * @param {Record<string, any>} chess data/chess.json
 */
export function anyPotentialData(chess) {
  for (const c of Object.values(chess && typeof chess === 'object' ? chess : {})) {
    if (hasPotentialData(c)) return true;
  }
  return false;
}

/** One row of the panel: a label, the current value, and a strip of choices. */
function Row({ micro, title, value, hint, children, warn = null }) {
  return html`<section class="lo-sec gr-row">
    <header class="lo-sec__head">
      <h3>${title}<${MicroLabel}>${micro}<//></h3>
      <span class="gr-row__val num">${value}</span>
    </header>
    ${hint ? html`<p class="gr-row__hint">${hint}</p>` : null}
    ${warn ? html`<p class="gr-row__warn">${warn}</p>` : null}
    <div class="lo-seg gr-row__seg" role="tablist" aria-label=${title}>${children}</div>
  </section>`;
}

/**
 * The 潜能 / 练度 panel of one operator.
 *
 * TWO PLACES USE IT, on purpose (the owner's call): the 干员调配 detail card (the 培养 tab — 普通 / 精锐) and the 自选编队
 * picker, where a 6★ pick is filled in by hand. Both read and write the SAME setting, because it is keyed by `charId`:
 * an operator the player owns is one operator whether it is fielded as itself or as a 自选 pick.
 *
 * @param {{ m?: any, chess: any, effects?: any, locked?: boolean, potentialSupported?: boolean,
 *           proto?: boolean, title?: string }} props
 *   `chess` = a record carrying `charId` (the base chess record, or the 自选 slot's record — only `charId` is read);
 *   `effects` = data/effects.json (null/absent ⇒ the 练度 controls render disabled rather than showing numbers they
 *   cannot back); `proto` = a PROTOTYPE 自选 pick — it takes neither setting (an operator the player does not own; the
 *   official 「未持有的特许按1潜」 and +0 %), so the panel says that instead of offering dead controls.
 */
export function GrowthSection({ chess, effects = null, locked = false, potentialSupported = null, proto = false, title = null }) {
  /*
   * ⚠ 所有 hook 必须在任何 early return **之前** —— loadout.js 的注释专门警告过这一点(详情面板在列表刷新时会
   * 短暂拿到 undefined 的 chess,条件 return 会让 hook 顺序在两次渲染之间变化)。
   */
  useStore((s) => s.ops, Object.is, loadoutStore);
  const charId = chess && typeof chess.charId === 'string' ? chess.charId : null;
  if (proto || !charId) {
    return html`<section class="lo-sec gr" data-testid="growth-panel" data-char=${charId || ''}>
      ${title ? html`<header class="lo-sec__head"><h3>${title}<${MicroLabel}>GROWTH<//></h3></header>` : null}
      <p class="gr-row__warn">${proto
        ? t('原型干员不设置潜能与练度：它不是玩家持有的干员。')
        : t('这名干员没有可设置的养成项。')}</p>
    </section>`;
  }
  const cur = opSettingOf(charId);
  const tiers = cultivateTiers(effects);
  const supported = potentialSupported == null
    ? anyPotentialData(chess ? { _: chess } : {})
    : potentialSupported;
  const isDefault = cur.potential === POTENTIAL_DEFAULT && cur.cultivate === CULTIVATE_DEFAULT;

  return html`<div class="gr" data-testid="growth-panel" data-char=${charId}>
    ${title ? html`<header class="lo-sec__head"><h3>${title}<${MicroLabel}>GROWTH<//></h3></header>` : null}
    <${Row} micro="POTENTIAL" title=${t('潜能')}
      value=${t('潜能 {n}', { n: cur.potential })}
      hint=${t('满潜为 {max}。潜能越低，属性与天赋按该阶段结算。', { max: POTENTIAL_MAX })}
      warn=${supported ? null : t('当前数据没有潜能阶段信息，设置会保存并在下次数据更新后生效。')}>
      ${POTENTIAL_RANKS.map((n) => html`<button key=${n} type="button" role="tab"
        aria-selected=${cur.potential === n ? 'true' : 'false'}
        class=${cx('gr-chip', cur.potential === n && 'is-on', cur.potential === n && n < POTENTIAL_DEFAULT && 'is-low')}
        disabled=${locked}
        title=${t('潜能 {n}', { n })}
        onClick=${() => setOpSetting(charId, { potential: n })}>${n}</button>`)}
    <//>

    <${Row} micro="CULTIVATE" title=${t('练度')}
      value=${t(cultivateLabel(cur.cultivate))}
      hint=${cultivateHint(tiers[cur.cultivate] && tiers[cur.cultivate].mul)}>
      ${tiers.map((x) => html`<button key=${x.value} type="button" role="tab"
        aria-selected=${cur.cultivate === x.value ? 'true' : 'false'}
        class=${cx('gr-chip gr-chip--wide', cur.cultivate === x.value && 'is-on')}
        disabled=${locked || !x.mul}
        title=${cultivateHint(x.mul) || t('数据缺失')}
        onClick=${() => setOpSetting(charId, { cultivate: x.value })}>${t(cultivateLabel(x.value))}</button>`)}
    <//>

    <div class="gr-foot">
      <${MicroLabel} tone="mint">GROWTH<//>
      ${isDefault
        ? html`<span class="gr-foot__note">${t('默认：满潜、精英 2 Lv.60。')}</span>`
        : html`<${Button} variant="ghost" size="sm" icon="refresh" disabled=${locked}
            onClick=${() => setOpSetting(charId, null)}>${t('恢复默认')}<//>`}
    </div>
  </div>`;
}

export { POTENTIAL_DEFAULT, CULTIVATE_DEFAULT, isPotential };
