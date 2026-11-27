// Read-only report pieces. Every displayed item and season badge comes from the currently loaded catalogue.
import { equipmentFusion } from '../../../shared/equipmentFusion.js';
import {html, Icon, roman} from './components.js';
import {Img, RichText} from './gameComponents.js';
import {MorphGrantLine} from './detailPanel.js';
import {itemIconUrl} from './assetUrls.js';
import {t} from '../../../shared/i18n.js';
import {avatarUrl} from '../assets.js';
import {skinHasModel} from './skins.js';
import {skinCharId} from './skinModel.js';
import {diyRecordFor} from './gameLogic/diy.js';
import {standInOf} from './gameLogic/standIn.js';

export function regulationEquipmentCatalog20261110(records) {
  const rows = Array.isArray(records) ? records : Object.values(records || {});
  const base = rows.filter(row => row && typeof row.id === 'string' && row.itemType === 'EQUIP' && (!row.isGolden || row.fusionComponents?.length === 2));
  const replaced = new Set(base.map(row => row.regulationShopReplaces).filter(Boolean));
  const itemById = new Map(rows.filter(row => row?.id).map(row => [row.id, row]));
  const identity = row => row.name && row.trapId ? JSON.stringify([row.name, row.trapId]) : null;
  const regulationFusionParts = new Set();
  for (const row of base) {
    const { nativeItemId, nativeTrapId } = row.regulationSource ?? {};
    const key = identity(row);
    if (key && nativeItemId && nativeTrapId === row.trapId && equipmentFusion(row.id, id => itemById.get(id))) {
      regulationFusionParts.add(key);
    }
  }
  return base.filter(row => !replaced.has(row.id)
    && (row.isGolden || row.regulationSource || !regulationFusionParts.has(identity(row))))
    .slice().sort((a,b) => (a.tier ?? 99)-(b.tier ?? 99) || (a.shopSortId ?? 999)-(b.shopSortId ?? 999) || a.id.localeCompare(b.id));
}
export function regulationEquipmentPair20261110(item, records) {
  const lookup = id => Array.isArray(records) ? records.find(row => row?.id === id) : records?.[id];
  const base = item?.isGolden ? lookup(item.baseId) || item : item;
  const advanced = base?.goldenId ? lookup(base.goldenId) : null;
  return {base:base || null, advanced:advanced?.isGolden ? advanced : null};
}
export function regulationStrategyReportCatalog(bands) {
  const byName = new Map();
  for (const band of bands ?? []) {
    if (!band?.bandId) continue;
    const name = typeof band.name === 'string' ? band.name.normalize('NFKC').trim() : '';
    const key = name || band.bandId;
    const prior = byName.get(key);
    if (!prior || (band.regulationCatalog20261110 === true && prior.regulationCatalog20261110 !== true)) {
      byName.set(key, band);
    }
  }
  return [...byName.values()].sort((a,b) => (a.sortId ?? 99) - (b.sortId ?? 99));
}

export function RegulationEquipmentTiles20261110({items, selected, onSelect, m}) {
  const tiers = [...new Set(items.map(row => row.tier))];
  return items.length ? tiers.map(tier => html`<section class="sw-sec regulation-equipment-section20261110" key=${tier}>
    <header class="sw-sec__head"><span class="sw-sec__glyph regulation-equipment-tier20261110" data-tier=${tier}>${roman(tier)}</span><span class="sw-sec__name"><i>[</i>${roman(tier)}<i>]</i></span></header>
    <div class="sw-sec__grid">${items.filter(row => row.tier === tier).map(row => html`<button type="button" data-own-click-sound class=${'sw-tile sw-tile--equipment'+(selected === row.id ? ' is-on' : '')} key=${row.id} aria-pressed=${selected === row.id} title=${row.name} onClick=${() => onSelect(row.id)}>
      <span class="sw-tile__in"><${Img} src=${itemIconUrl(m,row)} fallback=${html`<${Icon} name="shield" />`} /></span>
    </button>`)}</div>
  </section>`) : html`<p class="sw-status">${t('暂无装备资料')}</p>`;
}
export function RegulationEquipmentPanel20261110({item, records, m}) {
  if (!item) return null;
  const {base,advanced} = regulationEquipmentPair20261110(item,records);
  const lookup = id => Array.isArray(records) ? records.find(row => row?.id === id) : records?.[id];
  const recipe = equipmentFusion(item.id, lookup);
  const ingredients = (item.fusionComponents || []).map(lookup).filter(Boolean);
  return html`<article class="sw-detail regulation-equipment-detail20261110">
    <header class="sw-hero"><span class="regulation-equipment-art20261110"><${Img} src=${itemIconUrl(m,item)} fallback=${html`<${Icon} name="shield" />`} /><b>${roman(item.tier)}</b></span><h3 class="sw-hero__name">${item.name}</h3></header>
    <div class="sw-text"><section>${advanced ? html`<h4 class="sw-text__h regulation-effect-basic">${t('基础效果')}</h4>` : null}<${RichText} as="p" text=${base?.descRaw || base?.desc || ''} /></section>
      ${advanced ? html`<section><h4 class="sw-text__h regulation-effect-golden">${t('进阶效果')}</h4><${RichText} as="p" text=${advanced.descRaw || advanced.desc || ''} /></section>` : null}
      ${recipe ? html`<section><h4 class="sw-text__h">${t('可合成')}</h4><p>${item.name} + ${lookup(recipe.partnerId).name} → ${lookup(recipe.resultId).name}</p></section>` : null}
      ${ingredients.length === 2 ? html`<section><h4 class="sw-text__h">${t('可合成')}</h4><p>${ingredients[0].name} + ${ingredients[1].name} → ${item.name}</p></section>` : null}
      ${item.giveBondId ? html`<${MorphGrantLine} item=${item} />` : null}
      ${item.flavor ? html`<p class="regulation-equipment-flavor20261110">${item.flavor}</p>` : null}
    </div>
  </article>`;
}
export function RegulationSocialFacts20261110({profile}) {
  // No friend count is supplied by this project's own profile contract. Do not substitute video sample numbers.
  const votes = Number.isFinite(profile?.votes) ? Math.max(0,Math.round(profile.votes)) : 0;
  return html`<section class="regulation-social-facts20261110" aria-label=${t('社交数据')}><span>${t('收到的赞')}</span><b class="num">${votes}</b></section>`;
}

/** This browser's report identity only. Explicitly validated DIY picks, never another seat's private board/hand. */
export function regulationBondMemberAvatar20261110(m, chess, {golden = null, skinEntries = {}, diy = {}, notOwned = [], chessData = null, backups = null} = {}) {
  if (!chess) return {record:null,charId:null,skinId:null,avatar:null,standIn:false};
  const baseId = chess.baseId || chess.chessId;
  const pick = chess.isDiy ? diy[typeof chess.diyFor === 'string' ? chess.diyFor : baseId] : null;
  const custom = pick ? diyRecordFor(chess,pick,{chess:chessData,backups}) : null;
  const substitute = !chess.isDiy && Array.isArray(notOwned) && notOwned.includes(baseId) ? standInOf(chess,backups) : null;
  const record = custom || substitute || chess;
  const charId = skinCharId(record,custom || substitute ? null : golden);
  const wanted = typeof skinEntries?.[charId] === 'string' ? skinEntries[charId] : null;
  // Same wearability rule used by chosenSkin/availableSkins, scoped to this exact effective identity.
  const selected = wanted && m?.chars?.[charId]?.skins?.[wanted];
  const skinId = selected && skinHasModel(selected) ? wanted : null;
  return {record,charId,skinId,avatar:avatarUrl(m,charId,{e2:true,skin:skinId}),standIn:!!substitute};
}

/** Native fixed members plus this browser's already validated DIY picks, one row per canonical chess/slot. */
export function regulationBondReportMembers20261110(bond, chessData, {diy = {}, backups = null} = {}) {
  const ids = Array.isArray(bond?.visibleMembers) && bond.visibleMembers.length ? bond.visibleMembers : bond?.members || [];
  const seen = new Set(), rows = [];
  for (const id of ids) { const record = chessData?.[id]; if (record && !seen.has(record.chessId)) { seen.add(record.chessId); rows.push(record); } }
  for (const [slotId,pick] of Object.entries(diy)) {
    const slot = chessData?.[slotId]; if (!slot?.isDiy || seen.has(slotId)) continue;
    const record = diyRecordFor(slot,pick,{chess:chessData,backups});
    if (record?.bonds?.includes(bond?.bondId)) { seen.add(slotId); rows.push(slot); }
  }
  return rows.sort((a,b)=>(b.tier-a.tier)||((a.shopSortId ?? 0)-(b.shopSortId ?? 0)));
}
