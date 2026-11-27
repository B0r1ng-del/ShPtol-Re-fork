import {h} from '../../vendor/preact.module.js';
import {RichText} from './gameComponents.js';
import {data} from '../data.js';
import {boostedStrategy} from '../../../shared/strategyBoost.js';
import {t} from '../../../shared/i18n.js';
/** Show the future upgrade before the score threshold as well as the active version. */
export function StrategyBoostInfo({band,active=false,compact=false}){
 if(!band)return null;
 const base=data.lookup('bands',band.bandId)||band,strong=boostedStrategy(base,true),changed=strong!==base;
 return h(compact?'details':'section',{class:'strategy-upgrade'+(active&&changed?' is-active':'')+(compact?' is-compact':''),'data-strategy-upgrade':base.bandId},
  h(compact?'summary':'div',{class:'strategy-upgrade__head'},h('strong',null,t('合约加强（20分起）')),h('span',null,active&&changed?t('已生效'):t('未生效'))),
  changed&&strong.totalHp!==base.totalHp?h('p',null,t('初始生命值：{hp}（基础{base}）',{hp:strong.totalHp,base:base.totalHp})):null,
  changed?h(RichText,{as:'p',text:strong.descRaw||strong.desc}):h('p',null,t('此策略没有额外的合约加强。')),
 );
}
