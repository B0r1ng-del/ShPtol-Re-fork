import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { useViewportItem } from '../ui/viewportItem.js';
import { useHorizontalWheel } from '../ui/useHorizontalWheel.js';
import { html, Icon, TierChip, Modal, Button } from '../ui/components.js';
import { Img, RichText } from '../ui/gameComponents.js';
import { itemIconUrl } from '../ui/assetUrls.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';

function CatalogueItem({ item, m, golden, rootRef, onSelect }) {
  const ref = useRef(null);
  const visible = useViewportItem(ref, rootRef);
  return html`<div class="material-item-slot" ref=${ref}>
    ${visible ? html`<button type="button" class=${'material-item' + (golden ? ' is-golden' : '')} onClick=${() => onSelect(item)}>
      <${Img} src=${itemIconUrl(m, item)} fallback=${html`<${Icon} name="box" />`} />
      <div class="material-item__body"><h3><${TierChip} tier=${item.tier} size="sm" />${item.name}</h3>
      <${RichText} class="material-item__desc" text=${item.descRaw || item.desc} /></div><${Icon} name="search" />
    </button>` : null}
  </div>`;
}

/** Read-only supply catalogue. Descriptions use the same generated item records as the battle shop. */
export function MaterialItems({ m }) {
  useData('items');
  const [golden, setGolden] = useState(false);
  const [selected, setSelected] = useState(null);
  const scrollRef = useRef(null);
  useHorizontalWheel(scrollRef);
  const records = data.get('items');
  const items = useMemo(() => data.list('items').filter(x => !!x.isGolden === golden && !x.hideInShop && !x.shopExcluded)
    .sort((a, b) => a.tier - b.tier || a.shopSortId - b.shopSortId), [records, golden]);
  const tiers = [...new Set(items.map(x=>x.tier))];
  const neighbor=delta=>{const index=items.findIndex(x=>x.id===selected?.id);if(items.length)setSelected(items[(index+delta+items.length)%items.length]);};
  useEffect(()=>{if(!selected)return undefined;const key=e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();neighbor(e.key==='ArrowLeft'?-1:1);}};globalThis.addEventListener('keydown',key);return()=>globalThis.removeEventListener('keydown',key);},[selected?.id,golden]);
  const basic=selected?data.lookup('items',selected.baseId)||selected:null,advanced=basic?.goldenId?data.lookup('items',basic.goldenId):null;

  return html`<section class="material-items">
    <nav class="material-quick"><span>${t('道具')}</span><button type="button" aria-pressed=${!golden} onClick=${()=>{setGolden(false);setSelected(null);}}>${t('普通')}</button><button type="button" aria-pressed=${golden} onClick=${()=>{setGolden(true);setSelected(null);}}>${t('精锐')}</button></nav>
    <div class="material-items__scroll" ref=${scrollRef}>${tiers.map(tier=>html`<section class="material-tier" key=${tier}>
      <div class="material-tier__rail"><b>${['','I','II','III','IV','V','VI'][tier]||tier}</b><small>MATERIAL ALLOCATION</small></div>
      <div class="material-items__grid">${items.filter(x => x.tier === tier).map(item => html`<${CatalogueItem} key=${item.id} item=${item} golden=${golden} rootRef=${scrollRef} m=${m} onSelect=${setSelected} />`)}</div></section>`)}</div>
    <${Modal} open=${!!selected} class="native-item-comparison" title=${selected?.name||''} onClose=${()=>setSelected(null)} actions=${html`<${Button} onClick=${()=>setSelected(null)}>${t('关闭')}<//>`}>
      ${selected?html`<button type="button" class="native-item-close" onClick=${()=>setSelected(null)} aria-label=${t('关闭')}><${Icon} name="close"/></button><button type="button" class="native-item-prev" aria-label=${t('上一页')} onClick=${()=>neighbor(-1)}><${Icon} name="chevronLeft"/></button><article class="native-item-copy" key=${selected.id}><div class="native-item-art"><${TierChip} tier=${selected.tier}/><${Img} src=${itemIconUrl(m,selected)}/></div><div class="native-item-effects"><section><h4>${t('基础效果')}</h4><${RichText} text=${basic?.descRaw||basic?.desc||''}/></section>${advanced?html`<section><h4 class="is-advanced">${t('进阶效果')}</h4><${RichText} text=${advanced.descRaw||advanced.desc||''}/></section>`:null}${selected.flavor?html`<p class="native-item-flavor">${selected.flavor}</p>`:null}</div></article><button type="button" class="native-item-next" aria-label=${t('下一页')} onClick=${()=>neighbor(1)}><${Icon} name="chevronRight"/></button>`:null}
    <//>
  </section>`;
}
