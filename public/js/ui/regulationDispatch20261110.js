// Dispatch presentation only: callbacks reuse the existing filter/preview state and never rewrite loadout entries.
import {audio} from '../audio.js';
import {memo} from '../../vendor/preact-compat.module.js';
import {html, Icon} from './components.js';
import {Img} from './gameComponents.js';
import {bondIconUrl} from './assetUrls.js';
import {t} from '../../../shared/i18n.js';

export function regulationDispatchBondFilter20261110(filters, bondId) {
  return {...filters,bond:typeof bondId==='string' && bondId ? bondId : null};
}
export function RegulationDispatchVariants20261110({roster, level, onLevel}) {
  const normal = Array.isArray(roster) ? roster.length : 0;
  const elite = Array.isArray(roster) ? roster.filter(row=>!!row.goldenId).length : 0;
  return html`<nav class="regulation-dispatch-variants20261110" aria-label=${t('预览形态')}>
    <span>${t('预览形态')}</span>
    <button type="button" class=${level==='normal'?'is-on':''} aria-pressed=${level==='normal'} onClick=${()=>onLevel('normal')}><span>${t('普通')}</span><b class="num">${normal}</b></button>
    <button type="button" class=${level==='elite'?'is-on':''} aria-pressed=${level==='elite'} onClick=${()=>onLevel('elite')}><span>${t('精锐')}</span><b class="num">${elite}</b></button>
  </nav>`;
}
export const RegulationDispatchBondRail20261110 = memo(function RegulationDispatchBondRail20261110({m,bonds,filters,onFilters}) {
  const select = id => onFilters(regulationDispatchBondFilter20261110(filters,id));
  return html`<nav class="regulation-dispatch-bonds20261110" aria-label=${t('按盟约筛选')}>
    <button type="button" class=${!filters.bond?'is-on':''} aria-pressed=${!filters.bond} title=${t('全部盟约')} onClick=${()=>select(null)}><${Icon} name="list"/><span>${t('全部')}</span></button>
    ${(bonds||[]).map(bond=>html`<button type="button" key=${bond.bondId} class=${filters.bond===bond.bondId?'is-on':''} aria-pressed=${filters.bond===bond.bondId} title=${bond.name} onClick=${()=>select(filters.bond===bond.bondId?null:bond.bondId)}>
      <${Img} src=${bondIconUrl(m,bond.bondId)} fallback=${html`<span class="regulation-dispatch-bond-fallback20261110">${[...(bond.name||'?')][0]}</span>`}/><span>${bond.name}</span>
    </button>`)}
  </nav>`;
});

const FILTER_SPRITES = '/assets/ui/native-dispatch/';
const TIERS = ['I', 'II', 'III', 'IV', 'V', 'VI'];

export function dispatchGroups(roster, bonds, mode) {
  if (mode === 'tier') {
    return TIERS.map((_, index) => ({
      id: 'tier-' + (index + 1), tier: index + 1, list: roster.filter(row => row.tier === index + 1),
    })).filter(group => group.list.length);
  }
  const byId = new Map();
  for (const row of roster) {
    for (const id of row.bonds || []) {
      if (!byId.has(id)) byId.set(id, []);
      byId.get(id).push(row);
    }
  }
  return bonds.filter(bond => byId.has(bond.bondId)).map(bond => ({
    id: bond.bondId, bond: bond.bondId, name: bond.name, list: byId.get(bond.bondId),
  }));
}

export function DispatchFilter({ mode, current, open, onOpen, onChange, m, bonds }) {
  const options = mode === 'tier' ? TIERS.map((name, index) => ({ id: index + 1, name }))
    : bonds.map(bond => ({ id: bond.bondId, name: bond.name, icon: bondIconUrl(m, bond.bondId) }));
  const label = options.find(option => option.id === current)?.name || 'ALL';
  const modes = [['bond', t('按盟约筛选')], ['tier', t('按等阶')]];
  return html`<div class="dispatch-filter" data-mode=${mode}>
    <div class="dispatch-filter__toggle" role="group" aria-label=${t('筛选')}>
      ${modes.map(([value, name])=>html`<button key=${value} type="button" aria-label=${name} aria-pressed=${value===mode} data-own-click-sound
        onClick=${() => { if (value !== mode) onChange(value); }}><img src=${FILTER_SPRITES + 'toggle_' + (value === 'tier' ? 'level' : 'bond') + '.png'} alt="" />
        ${value === mode ? html`<span>${value==='bond' ? t('按盟约') : name}</span>` : null}</button>`)}
    </div>
    <button type="button" class="dispatch-filter__all" aria-expanded=${open} aria-label=${t('筛选') + ' ' + label} data-own-click-sound="true" onClick=${() => {
        if (open) audio.sfx('dispatchFilterClose', {
          nativeUrl: '/assets/ui/native-dispatch/g_ui_tickup.wav', isCurrent: () => true,
        });
        else audio.sfx('click');
        onOpen(!open);
      }}>
      ${label}<img src=${FILTER_SPRITES + 'filter_arrow.png'} alt="" />
    </button>
    ${open ? html`<nav class="dispatch-filter__options" aria-label=${t('筛选')}>
      ${[{id:null,name:'ALL'},...options].map(option=>html`<button key=${option.id??'all'} type="button" aria-pressed=${(current??null)===option.id} data-own-click-sound
        onClick=${() => onChange(mode, option.id)}>
        ${option.icon ? html`<img src=${option.icon} alt="" />` : null}<span>${option.name}</span></button>`)}
    </nav>` : null}
  </div>`;
}
