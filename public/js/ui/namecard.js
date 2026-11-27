import { useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button, Icon } from './components.js';
import { Img } from './gameComponents.js';
import { data, useData } from '../data.js';
import { normalizeNamecard } from '../../../shared/namecard.js';
import { t } from '../../../shared/i18n.js';
import { customNamecardUrl } from '../../../shared/namecardUploads.js';
import { NamecardUpload, useNamecardUploads } from './namecardUpload.js';
export const useNamecardImages = useNamecardUploads;

/**
 * 名片用图。owner 2026-10-19 的两条要求：
 *
 *   ① 「名片可以使用干员精二立绘」—— 优先级改成 **精二立绘(portraitE2) 优先**：
 *      选了皮肤就用皮肤自己的图（皮肤有 illust/portraitE2/portrait 三级），
 *      没选皮肤就用这位干员的精二立绘，其次才回落到档案立绘 / 精一立绘。
 *   ② 「如果没有设置名片不会使用头像代替」—— **没名片就返回 null**，
 *      由调用方画占位（`NamecardPreview` 是 rook 图标，结算卡是首字母），
 *      不再拿玩家头像 / 干员头像顶上。
 *
 * ⚠ `fallbackAvatar` 参数保留只为兼容既有调用点，**不再参与取图**。
 */
export function namecardArt(value, manifest, fallbackAvatar=null) {
  void fallbackAvatar;
  const card=normalizeNamecard(value);
  if (card?.uploadId) return customNamecardUrl(card.uploadId);
  const char=card&&manifest?.chars?.[card.charId];
  if(!char) return null;                      // ② 没设名片 → 不顶替
  const skin=card.skinId&&char.skins?.[card.skinId];
  /*
   * owner 2026-10-19:名片要**全身立绘**,并且可用**精二**立绘 —— 像皮肤立绘那样。
   *
   * 全身立绘在 assets.json 里是 `illust`(精一) / `illustE2`(精二),
   * 半身是 `portrait` / `portraitE2`。优先级:
   *   皮肤全身 → 干员全身精一(默认立绘) → 干员全身精二 → 皮肤半身 → 干员半身精二 → 干员半身精一
   * ★ owner 2026-10-19:「默认立绘就是指没精二的全身立绘」—— 所以默认优先 illust(精一全身),
   * 这样默认就是全身图;精二素材在的时候优先用精二。
   */
  /* 「精二」用哨兵 skinId(<charId>@e2)表达 —— normalizeNamecard 只保留 charId/skinId/theme/zoom，
     没有独立字段可用，而它要求 skinId 以 <charId>@ 开头，所以 @e2 天然合法。 */
  if (card.skinId === card.charId + '@e2') {
    return char.illustE2 || char.illust || char.portraitE2 || char.portrait || null;
  }
  return skin?.illust
    || char.illust || char.illustE2
    || skin?.portraitE2 || skin?.portrait
    || char.portraitE2 || char.portrait
    || null;
}
export function NamecardPreview({value,name='',avatar=null}) {
  useNamecardImages();
  useData('assets');const card=normalizeNamecard(value),src=namecardArt(card,data.get('assets'),avatar);
  return html`<div class=${'namecard-preview theme-'+(card?.theme||'mint')}><small>STRONGHOLD PROTOCOL</small><div class="namecard-preview__art"><${Img} src=${src} style=${`transform:scale(${card?.zoom||1})`} fallback=${html`<${Icon} name="rook"/>`}/></div><strong>${name||t('博士')}</strong></div>`;
}
export function NamecardEditor({value,name,avatar,onChange}) {
  const uploads = useNamecardImages();
  const [open,setOpen]=useState(false),[draft,setDraft]=useState(value),[query,setQuery]=useState('');
  useData('assets','chess','backups');const m=data.get('assets');
  const names=new Map(Object.values(data.get('backups')?.units||{}).map(x=>[x.charId,x.name]));for(const c of data.list('chess'))if(c.charId)names.set(c.charId,c.name);
  const chars=Object.entries(m?.chars||{}).filter(([id,c])=>/^char_[0-9]+_[A-Za-z0-9_]+$/.test(id)&&(c.portrait||c.illust||c.avatar)&&(!query||(names.get(id)||id).toLowerCase().includes(query.toLowerCase())));
  const card=normalizeNamecard(draft),skins=card?.charId?Object.entries(m?.chars?.[card.charId]?.skins||{}):[];
  const canApply = !!card && (!card.uploadId || uploads.list.some(entry => entry.id === card.uploadId));
  const patch=x=>setDraft(normalizeNamecard({...card,...x}));
  return html`<section class="profile-namecard"><div><h3>${t('个人名片')}</h3><p>${t('用于房间、玩家档案和结算展示')}</p><${Button} onClick=${()=>{setDraft(value);setOpen(true);}}>${t('编辑个人名片')}<//></div><${NamecardPreview} value=${value} name=${name} avatar=${avatar}/></section>
    <${Modal} open=${open} onClose=${()=>setOpen(false)} title=${t('个人名片')} class="namecard-editor" width="min(1040px,94vw)" actions=${html`<${Button} variant="ghost" onClick=${()=>{onChange(null);setOpen(false);}}>${t('恢复默认')}<//><${Button} variant="primary" disabled=${!canApply} onClick=${()=>{onChange(card);setOpen(false);}}>${t('应用名片')}<//>`}>
      <div class="namecard-editor__body"><aside><${NamecardPreview} value=${draft} name=${name} avatar=${avatar}/>
      <label>${t('名片色调')}<select value=${card?.theme||'mint'} disabled=${!card} onChange=${e=>patch({theme:e.target.value})}><option value="mint">${t('青绿')}</option><option value="amber">${t('琥珀')}</option><option value="red">${t('赤红')}</option></select></label>
      <label>${t('立绘缩放')}<input type="range" min="1" max="2" step="0.05" value=${card?.zoom||1} disabled=${!card} onInput=${e=>patch({zoom:Number(e.target.value)})}/></label>
      ${card?.charId?html`<label>${t('皮肤')}<select data-testid="namecard-skin" value=${card.skinId||''} onChange=${e=>patch({skinId:e.target.value||null})}><option value="">${t('默认（精一全身）')}</option><option value=${card.charId+'@e2'}>${t('精二全身')}</option>${skins.map(([id,s])=>html`<option key=${id} value=${id}>${s.name||id}</option>`)}</select></label>`:null}</aside>
      <section><${NamecardUpload} onPick=${uploadId=>patch({uploadId})}/><input type="search" aria-label=${t('搜索干员')} placeholder=${t('搜索干员')} value=${query} onInput=${e=>setQuery(e.target.value)}/><div class="namecard-roster">${chars.map(([id,c])=>html`<button type="button" data-namecard-char=${id} class=${card?.charId===id?'is-on':''} onClick=${()=>patch({charId:id,skinId:null,uploadId:null})}><${Img} src=${c.portraitE2||c.portrait||c.avatar}/><span>${names.get(id)||id}</span></button>`)}</div></section></div>
    <//>`;
}
