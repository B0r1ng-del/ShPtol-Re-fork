import {html} from './components.js';
import {t,N_} from '../../../shared/i18n.js';
const KIND_LABELS={branch:N_('子阵营'),subdivision:N_('子细分'),support:N_('普通支援'),other:N_('其他')};
export function factionBranchGroups(type,list){
 const byKey=new Map((list||[]).map(e=>[e.key,e])),seen=new Set();
 const groups=[...(type?.branches||[]).map(b=>({...b,kind:'branch'})),...(type?.eliteBranches||[]).map(b=>({...b,kind:'subdivision'})),...(type?.regularSupport?[{...type.regularSupport,kind:'support'}]:[])].map(b=>{const entries=[...new Set(b.members||[])].map(k=>byKey.get(k)).filter(Boolean);for(const e of entries)seen.add(e.key);return {...b,entries};}).filter(b=>b.entries.length);
 const other=[...byKey.values()].filter(e=>!seen.has(e.key));if(other.length)groups.push({id:'other',name:N_('其他阵营成员'),kind:'other',entries:other});return groups;
}
export function FactionBranchSections({type,list,renderEnemy,expanded=false}){
 const groups=factionBranchGroups(type,list);
 return html`<div class="sw-branches">${groups.map((g,i)=>html`<details key=${g.kind+':'+g.id} class="sw-branch" open=${expanded||i===0} data-branch-kind=${g.kind} data-branch-id=${g.id}>
  <summary><span class="sw-branch__kind">${t(KIND_LABELS[g.kind])}</span><b>${t(g.name)}</b>${g.minRound?html`<span class="sw-branch__round">${t('{start}—{end}回合出现',{start:g.minRound,end:g.maxRound})}</span>`:null}<small class="num">${g.entries.length}</small></summary>
  ${g.kindExempt?html`<p class="sw-branch__hint">${t('占用敌人总数，不占主体兵种名额')}</p>`:null}
  <div class="sw-branch__grid">${g.entries.map(e=>renderEnemy(e))}</div>
 </details>`)}</div>`;
}
