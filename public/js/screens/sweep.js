import {regulationEquipmentCatalog20261110, RegulationEquipmentTiles20261110, RegulationEquipmentPanel20261110, regulationStrategyReportCatalog, regulationBondMemberAvatar20261110, regulationBondReportMembers20261110} from '../ui/regulationReport20261110.js';
import {regulationBossDossiers20261110} from '../ui/regulationBossDossiers20261110.js';
import {isEnhancedVariant} from '../../../shared/enemyVariants.js';
import {columbiaSweepIcon, columbiaSweepMembers, columbiaSweepPreview} from '../ui/columbiaSweepPreview20261114.js';
import {factionBranchGroups} from '../ui/factionBranchSections.js';
import {StrategyBoostInfo} from '../ui/strategyBoostInfo.js';
// S.W.E.E.P.报告: the event's report screen (laid out after the event video 2:17 – 3:03; the backdrop is drawn in CSS,
// every picture is the game's own icon or art), opened from the lobby's top bar. Read-only: it shows the season's data
// and changes nothing. Three tabs —
//   盟约报告 — 核心盟约 / 附加盟约 tiles (bonds.json isCore); the left panel: the glyph, the name, 激活所需人数 and the
//              thresholds, the description, 对应干员 (visibleMembers by tier; 替补 on an operator marked 未持有 in 干员持有);
//   策略报告 — the strategies (bands.json) as tiles; the left: icon, name, 初始生命值, the effect, the modes it is offered
//              in and its bonds;
//   敌方资料 — 领袖 (bosses.json), 规程首领档案 and 战术特训敌人 (factions.json types) tiles; the left: art,
//              name, text and the leader with its escorts / the type's enemies; 查看 opens the enemy codex (全部 / 普通 /
//              精英 / 领袖, a search; per stat the official handbook's letter grade — factions.json handbookLevels, from
//              enemy_handbook_table levelInfoList: E … SS — with the enemy's own number beside it).
// ⓘ opens 玩法说明 at its 进阶图鉴 chapter. The report and the codex are full-screen Modals (focus trap; Esc closes the
// codex first, then the report; the focus returns to the lobby's button). The tab is remembered (sp.pref).
// Styles: css/screens/sweep.css (sw-*).

import { useMemo, useState, useEffect } from '../../vendor/hooks.module.js';
import { audio } from '../audio.js';
import { contractName } from '../../../shared/contracts.js';
// ⚠ 演示版的「音乐试听」面板（ui/sweepMusic.js）依赖 musicLibrary.js → musicPolicy.js →
// factionMusicCatalog.js（88KB 曲库）。game 没有这套曲库，强行搬会带进整个 88KB 目录表
// 且与 game 自己的 audio.js 选曲逻辑冲突。⇒ 这里降级成一个不渲染的占位：
// 面板标题仍在，展开后没有内容 —— 不报错、不影响其余 tab。
function SweepMusic() { return null; }
void SweepMusic;
import { html, Button, Icon, Modal, roman } from '../ui/components.js';
import { Img, RichText, GIcon } from '../ui/gameComponents.js';
import { bondIconUrl, bandIconUrl, bandPortraitClass, enemyIconUrl, factionIconUrl, chessAvatarUrl } from '../ui/assetUrls.js';
import { attackInterval, fmtNum } from '../ui/gameLogic.js';
import { abilityRows } from '../ui/abilityLines.js';
import { data, useData } from '../data.js';
import { useStore, loadPref, savePref } from '../store.js';
import { contentSet, pageVersion, retryContentSet } from '../content.js';
import { DEFAULT_VERSION, shownVersion } from '../versions.js';
import { openGuide, guidePages } from '../ui/guide.js';
import { loadoutStore, openLoadout } from '../ui/loadoutSync.js';
import {skinsStore, SKINS_KEY} from '../ui/skins.js';
import {sanitizeDiyPicks} from '../ui/diyModel.js';
import { t, N_ } from '../../../shared/i18n.js';
import { enemyReportRank } from '../../../shared/enemyRoles.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
const TAB_PREF = 'sweep.tab';
const TABS = [
  { id: 'bonds', name: N_('盟约报告'), icon: () => html`<${Icon} name="link" />` },
  { id: 'bands', name: N_('策略报告'), icon: () => html`<${Icon} name="rook" />` },
  { id: 'enemies', name: N_('敌方资料'), icon: () => html`<${GIcon} name="target" />` },
  { id: 'equipment', name: N_('装备一览'), icon: () => html`<${Icon} name="shield" />` },
];
const MODE_NAME = { SINGLE: N_('独立模拟'), MULTI: N_('同盟模拟') };
const RANK = { NORMAL: N_('普通'), ELITE: N_('精英'), BOSS: N_('领袖') };
const APPLY = { MELEE: N_('近战'), RANGED: N_('远程'), ALL: N_('近战 / 远程'), NONE: N_('不攻击') };
const DMG = { phys: N_('物理'), arts: N_('法术'), heal: N_('治疗') };

// The shell paints before optional report work; inactive tabs never gate its contents.
const REPORT_FILES={bonds:['bonds'],bands:['bands'],enemies:['bosses'],equipment:['items']};
const hasMissing=names=>names.some(n=>data.status(n)==='missing');
function ReportStatus({names,ready=false}){
 const missing=names.filter(n=>data.status(n)==='missing');
 if(!missing.length&&ready)return null;
 return html`<div class="sw-status" role=${missing.length?'alert':'status'} aria-live="polite">
  <p>${missing.length?t('报告资料读取失败，可以重试。'):t('正在读取报告…')}</p>
  ${missing.length?html`<button type="button" onClick=${()=>missing.forEach(n=>data.invalidate(n))}>${t('重试')}</button>`:null}
 </div>`;
}
// Identity follows the actual data/locale/content object, never just a boss or faction id.
const reportLists=new WeakMap();
function cachedList(name,kind,build){const source=data.get(name);if(!source||typeof source!=='object')return [];let values=reportLists.get(source);if(!values){values=new Map();reportLists.set(source,values);}if(!values.has(kind))values.set(kind,build());return values.get(kind);}

// Preserve authored branch membership, but do not construct collapsed branch thumbnails.
function SweepBranch({group,renderEnemy,initialOpen=false,expanded=false}){
 const [open,setOpen]=useState(initialOpen),[count,setCount]=useState(60),shown=expanded||open;
 const labels={branch:'子阵营',subdivision:'子细分',support:'普通支援',other:'其他'};
 return html`<details class="sw-branch" open=${shown} data-branch-kind=${group.kind} data-branch-id=${group.id} onToggle=${e=>setOpen(e.currentTarget.open)}>
  <summary><span class="sw-branch__kind">${t(labels[group.kind])}</span><b>${t(group.name)}</b>${group.minRound?html`<span class="sw-branch__round">${t('{start}—{end}回合出现',{start:group.minRound,end:group.maxRound})}</span>`:null}<small class="num">${group.entries.length}</small></summary>
  ${shown?html`${group.kindExempt?html`<p class="sw-branch__hint">${t('占用敌人总数，不占主体兵种名额')}</p>`:null}<div class="sw-branch__grid">${group.entries.slice(0,count).map(e=>renderEnemy(e))}</div>${count<group.entries.length?html`<button type="button" class="sw-more" onClick=${()=>setCount(count+60)}>${t('显示更多（剩余 {n} 项）',{n:group.entries.length-count})}</button>`:null}`:null}
 </details>`;
}
function SweepBranches({type,list,renderEnemy,expanded=false}){
 const groups=useMemo(()=>factionBranchGroups(type,list),[type,list]);
 return html`<div class="sw-branches">${groups.map((g,i)=>html`<${SweepBranch} key=${g.kind+':'+g.id} group=${g} initialOpen=${i===0} expanded=${expanded} renderEnemy=${renderEnemy}/>` )}</div>`;
}

// Original audio owner/sequence cleanup remains in SweepMusic; closing this disclosure unmounts it.
function SweepMusicPanel(props){
 const [open,setOpen]=useState(false);
 return html`<details class="sw-music-panel" open=${open} onToggle=${e=>setOpen(e.currentTarget.open)}><summary>${t('音乐试听')}</summary>${open?html`<${SweepMusic} ...${props}/>`:null}</details>`;
}

// ---- enemy grades ------------------------------------------------------------------------------------------------------

/**
 * Letter grade of one stat by the official enemy handbook (factions.json `handbookLevels`, generated from
 * enemy_handbook_table `levelInfoList`: ten grades E … SS, each a [min, max) band per stat; `interval` — the attack
 * interval in seconds — grades the other way round). '—' when the enemy has no such value (no attack, no movement) or the
 * value is in no band. [ASSUMED] the bands share their edges: a value on an edge takes the band that starts there.
 * @param {string} key enemies.json stat (maxHp, atk, def, res, moveSpeed, interval, elementRes, elementDmgRes)
 * @param {number|null|undefined} v @param {any[]} [levels] handbookLevels (default: the loaded factions.json)
 * @returns {string}
 */
export function enemyGrade(key, v, levels = data.get('factions')?.handbookLevels) {
  const n = Number(v);
  if (v == null || !Number.isFinite(n) || !Array.isArray(levels)) return '—';
  for (const l of levels) {
    const band = l?.[key];
    if (!Array.isArray(band)) continue;
    const [lo, hi] = band;
    if (n >= lo && (hi == null || n < hi)) return l.level;
  }
  return '—';
}

/**
 * The codex's enemies: every enemy but the summon-only ones, one per 图鉴 number (a hidden boss variant shares its
 * number), by id.
 * @param {any[]} list enemies.json records
 */
export function codexEnemies(list) {
  const seen = new Set();
  const out = [];
  const num = (k) => { const m = /enemy_(\d+)/.exec(k || ''); return m ? Number(m[1]) : 1e9; };
  for (const e of [...(Array.isArray(list) ? list : [])].sort((a, b) => num(a?.key) - num(b?.key) || String(a?.key).localeCompare(String(b?.key)))) {
    if (!e || typeof e.key !== 'string' || e.tokenOnly) continue;
    const id = e.handbookIndex ? `${e.handbookIndex}|${e.name}` : e.key;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(e);
  }
  return out;
}

/** Unique enemy keys of a boss: the leader, then its escorts (every template). @param {any} boss bosses.json record */
export function bossEnemyKeys(boss, preview = null) {
  const keys = [boss?.enemyKey];
  if (preview) return [...new Set([...keys, ...preview.guards].filter(k => typeof k === 'string' && k))];
  for (const list of Object.values(boss?.escortsByTemplate || {})) for (const e of Array.isArray(list) ? list : []) keys.push(e?.key);
  for (const key of boss?.summonGuards || []) keys.push(key);
  return [...new Set(keys.filter((k) => typeof k === 'string' && k))];
}

// ---- small pieces ------------------------------------------------------------------------------------------------------

/** The big square at the top of the left panel (bracket corners, a ring behind a glyph or the art). */
function Hero({ src, glyph = false, art = false, name, sub = null, fallback, bandId = null }) {
  return html`<div class="sw-hero">
    <span class=${cx('sw-hero__box', glyph && 'is-glyph', art && 'is-art')}>
      <i class="sw-hero__c sw-hero__c--tl"></i><i class="sw-hero__c sw-hero__c--br"></i>
      <span class=${cx('sw-hero__img', bandPortraitClass(bandId))}><${Img} src=${src} fallback=${fallback} /></span>
    </span>
    <h3 class="sw-hero__name">${name}</h3>
    ${sub ? html`<span class="sw-hero__sub">${sub}</span>` : null}
  </div>`;
}

/** One tile of the right grid. */
function Tile({ on, onClick, title, kind, children, badge = null }) {
  return html`<button type="button" data-own-click-sound class=${cx('sw-tile', `sw-tile--${kind}`, on && 'is-on')} onClick=${onClick} title=${title} aria-pressed=${on ? 'true' : 'false'}>
    <span class="sw-tile__in">${children}</span>${badge}
  </button>`;
}

/** A section of the right grid: a glyph above `[ name ]`, then its tiles. */
function Section({ name, glyph, children, count = null, kind }) {
  return html`<section class="sw-sec" data-kind=${kind}>
    <header class="sw-sec__head">
      <span class="sw-sec__glyph">${glyph}</span>
      <span class="sw-sec__name"><i>[</i>${name}${count != null ? html`<small class="num">${count}</small>` : null}<i>]</i></span>
    </header>
    <div class="sw-sec__grid">${children}</div>
  </section>`;
}

/** A small enemy thumbnail with its 图鉴 number in the corner. */
function EnemyThumb({ e, m, on = false, onClick = null, size = 'sm' }) {
  const Tag = onClick ? 'button' : 'span';
  return html`<${Tag} type=${onClick ? 'button' : undefined} class=${cx('sw-eth', `sw-eth--${size}`, on && 'is-on', e.rank === 'BOSS' && 'is-boss', e.rank === 'ELITE' && 'is-elite')}
      onClick=${onClick} title=${e.name}>
    <${Img} src=${enemyIconUrl(m, e.key)} fallback=${html`<${GIcon} name="skull" />`} />
    ${e.handbookIndex ? html`<span class="sw-eth__no">${e.handbookIndex}</span>` : null}
  <//>`;
}

// ---- 盟约报告 ----------------------------------------------------------------------------------------------------------

function sweepBonds() {
  const rows = (data.list('bonds') || []).filter(bond => bond?.bondId);
  if (!rows.some(bond => bond.bondId === columbiaSweepPreview.bondId)) rows.push(columbiaSweepPreview);
  return rows.sort((a, b) => (a.identifier ?? 99) - (b.identifier ?? 99));
}

function sweepBondIcon(manifest, id) {
  return bondIconUrl(manifest, id) || (id === columbiaSweepPreview.bondId ? columbiaSweepIcon : null);
}

function BondPanel({ bond, m, notOwned, onClose }) {
  const membersReady=useData('chess','backups');
  const skinEntries = useStore(s=>s[SKINS_KEY],Object.is,skinsStore);
  const diy = useStore(s=>s.diy,Object.is,loadoutStore);
  const kitted = useStore(s=>s.diyKitted,Object.is,loadoutStore);
  const chessData = data.get('chess'), backups = data.get('backups');
  const legalDiy = useMemo(()=>sanitizeDiyPicks(diy,{chess:chessData,backups},kitted),[diy,kitted,chessData,backups]);
  const proposed = bond === columbiaSweepPreview;
  const memberView = c=>regulationBondMemberAvatar20261110(m,c,{golden:data.lookup('chess',c.goldenId),skinEntries,diy:legalDiy,notOwned:proposed ? [] : notOwned,chessData,backups});
  const members = (proposed ? columbiaSweepMembers(chessData) : regulationBondReportMembers20261110(bond,chessData,{diy:legalDiy,backups}))
    .slice().sort((a, b) => a.tier - b.tier || (a.shopSortId ?? 0) - (b.shopSortId ?? 0));
  const anyOff = members.some(c => memberView(c).standIn);
  const steps = Array.isArray(bond.thresholds) ? bond.thresholds.filter((n) => Number.isFinite(n)) : [];
  return html`<div class="sw-detail">
    <${Hero} key=${bond.bondId} src=${sweepBondIcon(m, bond.bondId)} glyph=${true} name=${bond.name}
      fallback=${html`<span class="sw-hero__txt">${[...(bond.name || '?')][0]}</span>`} />
    <div class="sw-facts">
      <span class="sw-pill">${t('激活所需人数')}<b class="num">${bond.activeCount ?? steps[0] ?? '—'}</b></span>
      ${proposed ? html`<span class="sw-kind">${t('方案预览')}</span>` : null}
    </div>
    <div class="sw-text"><${RichText} as="p" text=${bond.descRaw || bond.desc || ''} /></div>
    <${ReportStatus} names=${['chess','backups']} ready=${membersReady} />
    ${members.length ? html`<div class="sw-box">
      <div class="sw-box__head">
        <span class="sw-box__k"><${Icon} name="user" />${t('对应干员')}</span>
        <button type="button" class="sw-look sw-look--materials" data-own-click-sound onClick=${() => {
          audio.sfx('tab');
          onClose();
          openLoadout('lobby', null, 'loadout');
        }}>
          <${Icon} name="search" />${t('前往物资调配处查看')}
        </button>
        ${anyOff ? html`<span class="sw-box__note"><span class="sw-box__swap" aria-hidden="true">⇄</span>${t('未持有的干员由替补干员上场')}</span>` : null}
      </div>
      <div class="sw-ops">${members.map((c) => { const member=memberView(c); return html`<span key=${c.chessId} class=${cx('sw-op', `sw-op--t${c.tier}`, member.standIn && 'is-standin')}
          title=${member.record?.name || c.name}>
        <${Img} src=${member.avatar} fallback=${html`<span class="sw-op__txt">${[...(member.record?.name || c.name || '?')][0]}</span>`} />
        <span class="sw-op__tier">${roman(c.tier)}</span>
        ${member.standIn ? html`<span class="sw-op__sub">${t('替补')}</span>` : member.record?.diyFor ? html`<span class="sw-op__sub">${t('自选')}</span>` : null}
      </span>`; })}</div>
    </div>` : null}
  </div>`;
}

function BondsTab({ m, bonds, sel, onSel }) {
  const sections = [
    { id: 'core', name: t('核心盟约'), glyph: html`<${GIcon} name="flag" />`, items: bonds.filter((b) => b.isCore) },
    { id: 'extra', name: t('附加盟约'), glyph: html`<${Icon} name="link" />`, items: bonds.filter((b) => !b.isCore) },
  ];
  return sections.map((s) => s.items.length ? html`<${Section} key=${s.id} name=${s.name} glyph=${s.glyph} kind=${s.id}>
    ${s.items.map((b) => html`<${Tile} key=${b.bondId} kind="bond" on=${sel === b.bondId} onClick=${() => onSel(b.bondId)} title=${b.name}>
      <span class="sw-disc"><${Img} src=${sweepBondIcon(m, b.bondId)} fallback=${html`<span class="sw-disc__txt">${[...(b.name || '?')][0]}</span>`} /></span>
    <//>`)}
  <//>` : null);
}

// ---- 策略报告 ----------------------------------------------------------------------------------------------------------

function BandPanel({ band, m }) {
  const bondsReady=useData('bonds');
  const modes = (Array.isArray(band.modeTypeList) ? band.modeTypeList : []).filter((k) => MODE_NAME[k]);
  const bonds = (Array.isArray(band.bondIds) ? band.bondIds : []).map((id) => data.lookup('bonds', id)).filter(Boolean);
  return html`<div class="sw-detail">
    <${Hero} src=${bandIconUrl(m, band.bandId)} art=${true} name=${band.name} bandId=${band.bandId}
      fallback=${html`<span class="sw-hero__txt">${[...(band.name || '?')][0]}</span>`} />
    <div class="sw-facts">
      <span class="sw-pill">${t('初始生命值')}<b class="num">${band.totalHp ?? '—'}</b></span>
      ${modes.map((k) => html`<span key=${k} class="sw-pill sw-pill--ghost">${t(MODE_NAME[k])}</span>`)}
    </div>
    <div class="sw-text">
      ${band.effectName ? html`<h4 class="sw-text__h">${band.effectName}</h4>` : null}
      <${RichText} as="p" text=${band.descRaw || band.desc || ''} />
      <${StrategyBoostInfo} band=${band}/>
      <${ReportStatus} names=${['bonds']} ready=${bondsReady}/>
      ${bonds.length ? html`<p class="sw-text__bonds">${t('相关盟约')}${bonds.map((b) => html`<span key=${b.bondId} class="sw-chip">
        <${Img} src=${bondIconUrl(m, b.bondId)} />${b.name}</span>`)}</p>` : null}
    </div>
  </div>`;
}

function BandsTab({ m, bands, sel, onSel }) {
  const groups = [
    { kind: 'general-strategy', name: t('泛用型策略'), icon: 'rook', entries: bands.filter(b => !b.bondIds?.length) },
    { kind: 'bond-strategy', name: t('盟约型策略'), icon: 'link', entries: bands.filter(b => b.bondIds?.length) },
  ];
  return groups.map(({ kind, name, icon, entries }) => html`<${Section} key=${kind} kind=${kind} name=${name}
    glyph=${html`<${Icon} name=${icon} />`} count=${entries.length}>
    ${entries.map((b) => html`<${Tile} key=${b.bandId} kind="band" on=${sel === b.bandId} onClick=${() => onSel(b.bandId)} title=${b.name}>
      <span class=${cx('sw-face', bandPortraitClass(b.bandId))}><${Img} src=${bandIconUrl(m, b.bandId)} fallback=${html`<span class="sw-face__txt">${[...(b.name || '?')][0]}</span>`} /></span>
      <span class="sw-tile__cap">${b.name}</span>
      <span class="sw-tile__hp num" title=${t('初始生命值')}>${b.totalHp}</span>
    <//>`)}
  <//>`);
}

// ---- 敌方资料 ----------------------------------------------------------------------------------------------------------

/** The enemies tab's entries: { kind: 'boss'|'dossier'|'type', id }. */
export function sweepBosses(bosses){
 const groups=new Map();
 for(const boss of bosses||[]){
  if(!boss?.bossId)continue;
  if(boss.regulationNativeBoss20261110===true&&!(boss.runtimeReady===true&&boss.selectable===true))continue;
  const key=String(boss.name||boss.enemyKey).replace(/\s+/g,'');
  if(!groups.has(key))groups.set(key,{...boss,variants:[]});
  groups.get(key).variants.push(boss);
 }
 return [...groups.values()].map(b=>({...b,hasHidden:b.variants.some(v=>v.hidden),hasLeader:b.variants.some(v=>!v.hidden)})).sort((a,b)=>(a.sortId??99)-(b.sortId??99));
}
const bossList=()=>cachedList('bosses','leaders',()=>sweepBosses(data.list('bosses')));
export function sweepBossDossiers(bosses, manifest) {
  const active = new Set(bosses.flatMap(group => group.variants.map(variant => variant.enemyKey)));
  return regulationBossDossiers20261110.filter(dossier => !active.has(dossier.enemyKey) && !active.has(dossier.coreEnemyKey)
    && enemyIconUrl(manifest, dossier.enemyKey));
}
const otherBossList=()=>cachedList('enemies','other-leaders',()=> (data.list('enemies')||[]).filter(e=>e.miniBoss&&e.rank==='ELITE').map(e=>({bossId:'other_'+e.key,enemyKey:e.key,name:e.name,bountyOnly:e.bountyOnly,otherBoss:true,abilities:e.abilities?.map(a=>a.text)||[]})));
const typeList = () => Object.values(data.get('factions')?.types || {}).filter((f) => f && f.type).sort((a, b) => (a.sortId ?? 99) - (b.sortId ?? 99));
const typeKeys = (f) => [...new Set([...(f?.reportPool ?? f?.pool ?? []),
  ...(Array.isArray(f?.entries) ? f.entries : []).map(id=>data.get('factions')?.entries?.[id]?.key||id),
  ...(data.list('enemies')||[]).filter(e=>e.contractTrainingTags?.includes(f?.type)).map(e=>e.key)])];

function EnemyPanel({ sel, m, onCodex }) {
  const basicsReady=useData('enemies','config');
  const [showEscorts,setShowEscorts]=useState(false);
  const escortsReady=useData(...(showEscorts?['bossEscorts']:[]));
  const [variantId, setVariantId] = useState(null), [escortId, setEscortId] = useState(null);
  const currentMatch = useStore(s => s.match.public);
  if(!basicsReady||hasMissing(['enemies','config']))return html`<${ReportStatus} names=${['enemies','config']} ready=${basicsReady}/>`;
  if (sel.kind === 'boss') {
    const group = [...bossList(),...otherBossList()].find(b=>b.bossId===sel.id);
    if (!group) return null;
    const boss = { ...group, ...(group.variants?.find(variant => variant.bossId === variantId) || {}) };
    const previews = showEscorts&&escortsReady ? (data.get('bossEscorts')?.bosses?.[boss.bossId] || []) : [];
    const preview = previews.find(row => row.id === escortId)
      || previews.find(row => row.modeId === currentMatch?.modeId && row.round === currentMatch?.round && (!row.pactId || currentMatch?.contracts?.includes(row.pactId)))
      || previews.find(row => row.modeId === 'mode_multi_abyss' && !row.pactId) || previews[0];
    // Never label an unrequested/pending preview as an empty or guessed guard list.
    const keys = showEscorts&&escortsReady&&!hasMissing(['bossEscorts']) ? bossEnemyKeys(boss, preview) : [boss.enemyKey];
    const e = data.lookup('enemies', boss.enemyKey);
    const escorts = keys.slice(1).map((k) => data.lookup('enemies', k)).filter(Boolean);
    return html`<div class="sw-detail">
      <${Hero} src=${enemyIconUrl(m, boss.enemyKey)} art=${true} name=${boss.name} sub=${boss.otherBoss?t('其他首领级 · 按精英规则处理'):boss.hasHidden&&boss.hasLeader?t('首领战／隐秘核心'):boss.hasHidden?t('隐秘核心'):t('首领战')} fallback=${html`<${GIcon} name="skull" />`} />
      <div class="sw-text"><${RichText} as="p" text=${e?.descRaw || e?.desc || ''} /></div>
      ${boss.variants?.length>1?html`<p class="sw-cd__types">${boss.variants.map(v=>html`<button key=${v.bossId} type="button" class="sw-chip" aria-pressed=${v.bossId===boss.bossId} onClick=${()=>{setVariantId(v.bossId);setEscortId(null);}}>${v.hidden?t('隐秘核心'):t('首领战')}</button>`)}<small>${t('同一敌人的首领版与核心版合并展示；实际属性由本局回合和合同决定。')}</small></p>`:null}
      ${e?.contractAdaptation?html`<p class="sw-text">${e.contractAdaptation}</p>`:null}
      <${SweepMusicPanel} key=${boss.bossId+':'+(data.contentId()||'base')} bossId=${boss.otherBoss?null:boss.bossId} enemyKey=${boss.enemyKey} manifest=${m} enemies=${data.get('enemies')}/>
      <div class="sw-box">
        <div class="sw-box__head">
          <span class="sw-box__k"><${GIcon} name="skull" />${t('敌方领袖')}</span>
          <button type="button" class="sw-look" onClick=${() => onCodex({ title: boss.name, keys, key: boss.enemyKey })}><${Icon} name="search" />${t('查看')}</button>
        </div>
        ${!showEscorts&&!boss.otherBoss?html`<button class="sw-load-escorts" type="button" onClick=${()=>setShowEscorts(true)}>${t('读取原生护卫配置')}</button>`:null}
        ${showEscorts?html`<${ReportStatus} names=${['bossEscorts']} ready=${escortsReady}/>`:null}
        ${previews.length ? html`<label class="sw-escort-select">${t('护卫配置')}<select aria-label=${t('护卫配置')} value=${preview.id} onChange=${event=>setEscortId(event.target.value)}>
          ${previews.map(row=>html`<option key=${row.id} value=${row.id}>${data.get('config')?.modes?.[row.modeId]?.name || row.modeId} · ${row.pactId ? t(contractName(row.pactId)) : t('无合同')} · ${t('第 {r} 回合',{r:row.round})}</option>`)}
        </select></label>` : null}
        <div class="sw-ethumbs">
          ${e ? html`<${EnemyThumb} e=${e} m=${m} onClick=${() => onCodex({ title: boss.name, keys, key: e.key })} />` : null}
          ${escorts.length ? html`<span class="sw-ethumbs__sep">${boss.escortMode==='scripted'?t('阶段召唤护卫'):t('护卫')}</span>` : null}
          ${escorts.map((x) => html`<${EnemyThumb} key=${x.key} e=${x} m=${m} onClick=${() => onCodex({ title: boss.name, keys, key: x.key })} />`)}
        </div>
      </div>
    </div>`;
  }
  const f = data.get('factions')?.types?.[sel.id];
  if (!f) return null;
  const list = typeKeys(f).map((k) => data.lookup('enemies', k)).filter(Boolean);
  const keys = codexEnemies(list).map((e) => e.key);
  const shown = keys.map((k) => data.lookup('enemies', k));
  return html`<div class="sw-detail">
    <${Hero} src=${factionIconUrl(m, f.icon)} glyph=${true} name=${f.name} fallback=${html`<${GIcon} name="target" />`} />
    <div class="sw-text"><p class="rt">${f.desc || ''}</p></div>
    <${SweepMusicPanel} key=${f.type+':'+(data.contentId()||'base')} faction=${f.type} manifest=${m} enemies=${data.get('enemies')}/>
    <div class="sw-box">
      <div class="sw-box__head">
        <span class="sw-box__k"><${GIcon} name="target" />${t('敌方情报')}<small class="num">${shown.length}</small></span>
        <button type="button" class="sw-look" onClick=${() => onCodex({ title: f.name, factionType:f.type, keys, key: keys[0] })}><${Icon} name="search" />${t('查看')}</button>
      </div>
      ${f.branches?.length?html`<${SweepBranches} type=${f} list=${shown} renderEnemy=${x=>html`<${EnemyThumb} key=${x.key} e=${x} m=${m} onClick=${() => onCodex({title:f.name,factionType:f.type,keys,key:x.key})} />`} />`:html`<div class="sw-ethumbs sw-ethumbs--grid">
        ${shown.map((x) => html`<${EnemyThumb} key=${x.key} e=${x} m=${m} onClick=${() => onCodex({ title: f.name, factionType:f.type, keys, key: x.key })} />`)}
      </div>`}
    </div>
  </div>`;
}

function BossDossierPanel({dossier, m}) {
  const sections = [[t('首领战'), dossier.leaderAbilities]];
  if (dossier.coreAbilities) sections.push([t('隐秘核心'), dossier.coreAbilities]);
  return html`<article class="sw-detail">
    <${Hero} src=${enemyIconUrl(m, dossier.enemyKey)} art=${true} name=${dossier.name}
      sub=${`${dossier.handbookIndex} · ${t('对局暂未开放')}`} fallback=${html`<${GIcon} name="skull" />`} />
    <div class="sw-text"><${RichText} as="p" text=${dossier.description} /></div>
    ${sections.map(([name, abilities]) => html`<section class="sw-text" key=${name}>
      <h4 class="sw-text__h">${name}</h4>
      ${abilities.map(text => html`<${RichText} key=${text} as="p" text=${text} />`)}
    </section>`)}
  </article>`;
}

function EnemiesTab({ m, sel, onSel, onCodex, dossiers }) {
  const bosses = bossList();
  const others = otherBossList();
  const types = typeList();
  const enemiesReady=useData('enemies'),factionsReady=useData('factions');
  const total = useMemo(()=>codexEnemies(data.list('enemies') || []).length,[data.get('enemies')]);
  return html`
    <${Section} name=${t('领袖')} glyph=${html`<${GIcon} name="skull" />`} count=${bosses.length}>
      ${bosses.map((b) => html`<${Tile} key=${b.bossId} kind="boss" on=${sel.kind === 'boss' && sel.id === b.bossId} onClick=${() => onSel({ kind: 'boss', id: b.bossId })} title=${b.name}>
        <span class="sw-art"><${Img} src=${enemyIconUrl(m, b.enemyKey)} fallback=${html`<${GIcon} name="skull" />`} /></span>
        <span class="sw-tile__cap">${b.name}</span>
      <//>`)}
    <//>
    ${dossiers.length ? html`<${Section} name=${t('规程首领档案')} glyph=${html`<${GIcon} name="skull" />`} count=${dossiers.length}>
      ${dossiers.map(dossier => html`<${Tile} key=${dossier.enemyKey} kind="boss" on=${sel.kind === 'dossier' && sel.id === dossier.enemyKey}
        onClick=${() => onSel({kind: 'dossier', id: dossier.enemyKey})} title=${dossier.name}>
        <span class="sw-art"><${Img} src=${enemyIconUrl(m, dossier.enemyKey)} fallback=${html`<${GIcon} name="skull" />`} /></span>
        <span class="sw-tile__cap">${dossier.name}</span>
      <//>`)}
    <//>` : null}
    <${Section} name=${t('其他首领级（精英）')} glyph=${html`<${GIcon} name="skull" />`} count=${enemiesReady?others.length:null}>
      <${ReportStatus} names=${['enemies']} ready=${enemiesReady}/>
      ${others.map((b) => html`<${Tile} key=${b.bossId} kind="boss" on=${sel.kind === 'boss' && sel.id === b.bossId} onClick=${() => onSel({ kind: 'boss', id: b.bossId })} title=${b.name}>
        <span class="sw-art"><${Img} src=${enemyIconUrl(m, b.enemyKey)} fallback=${html`<${GIcon} name="skull" />`} /></span>
        <span class="sw-tile__cap">${b.name}</span>
      <//>`)}
    <//>
    <${Section} name=${t('战术特训敌人')} glyph=${html`<${GIcon} name="target" />`} count=${factionsReady?types.length:null}>
      <${ReportStatus} names=${['factions']} ready=${factionsReady}/>
      ${[{id:'faction',name:t('阵营特训')},{id:'mechanic',name:t('机制特训')}].map(group=>html`
      <div class="sw-training-kind" style="grid-column:1/-1">${group.name}</div>
      ${types.filter(f=>(f.category||'mechanic')===group.id).map((f) => html`<${Tile} key=${f.type} kind="type" on=${sel.kind === 'type' && sel.id === f.type} onClick=${() => onSel({ kind: 'type', id: f.type })} title=${f.name}>
        <span class="sw-glyph"><${Img} src=${factionIconUrl(m, f.icon)} fallback=${html`<${GIcon} name="target" />`} /></span>
        <span class="sw-tile__cap">${String(f.name || f.type).replace(t('特训敌人·'), '')}</span>
      <//>`)}`)}
    <//>
    <button type="button" class="sw-allcodex" disabled=${!enemiesReady||hasMissing(['enemies'])} onClick=${() => onCodex({ title: null, keys: null, key: null })}>
      <${GIcon} name="skull" /><span><b>${t('敌方图鉴')}</b><small>${t('全部 {n} 种敌人 · 评级与实际数值', { n: total })}</small></span><${Icon} name="chevronRight" />
    </button>`;
}

// ---- the enemy codex ---------------------------------------------------------------------------------------------------

const STAT_ROWS = [
  ['maxHp', N_('生命值'), 'plus'], ['moveSpeed', N_('移动速度'), 'chevrons'],
  ['atk', N_('攻击力'), 'sword'], ['interval', N_('攻击间隔'), 'hourglass'],
  ['def', N_('防御力'), 'shield'], ['elementRes', N_('元素抗性'), 'snow'],
  ['res', N_('法术抗性'), 'bolt'], ['elementDmgRes', N_('损伤抵抗'), 'warn'],
];

function statValue(e, key) {
  const s = e?.stats || {};
  if (key === 'interval' || key === 'atk') {
    if (e?.applyWay === 'NONE' && !(Number(s.atk) > 0)) return null; // never attacks
    return key === 'atk' ? s.atk ?? 0 : attackInterval(s.bat, s.aspd);
  }
  if (key === 'moveSpeed') return Number(s.moveSpeed) > 0 ? s.moveSpeed : null;
  return s[key] ?? 0;
}
function statText(key, v) {
  if (v == null) return '—';
  if (key === 'interval') return `${Math.round(v * 10) / 10}s`;
  if (key === 'moveSpeed') return String(Math.round(v * 100) / 100);
  return fmtNum(v);
}

function CodexDetail({ e, m }) {
  const s = e.stats || {};
  const factions = data.get('factions')?.types || {};
  const types = [...new Set([...(Array.isArray(e.acTypes) ? e.acTypes : e.acType ? [e.acType] : []),...(e.contractTrainingTags||[])])].filter((k) => factions[k]);
  const imm = Object.entries(s.immunities || {}).filter(([, v]) => v).map(([k]) => ({ stun: t('晕眩'), silence: t('沉默'), sleep: t('沉睡'), frozen: t('冻结'), levitate: t('浮空') }[k] || k));
  const abil = abilityRows(e.abilities, false);
  const dmg = (Array.isArray(s.dmgTypes) && s.dmgTypes.length ? s.dmgTypes : [s.dmgType]).filter((k) => DMG[k]).map((k) => t(DMG[k]));
  return html`<div class="sw-cd" key=${e.key} data-enemy-key=${e.key}>
    <div class="sw-cd__head">
      <span class="sw-cd__cat">${t(RANK[enemyReportRank(e,data.list('bosses'))] || RANK.NORMAL)}${isEnhancedVariant(data.getRaw('enemies'),e.key)?' · '+t('强化'):''}${s.motion === 'FLY' ? ` · ${t('空中')}` : ''}</span>
      <h3 class="sw-cd__name">${e.handbookIndex ? html`<span class="sw-cd__no">${e.handbookIndex}</span>` : null}${e.name}</h3>
      <span class="sw-cd__way">${t(APPLY[e.applyWay] || APPLY.MELEE)}${dmg.length ? ` ${dmg.join(' / ')}` : ''}</span>
      <span class="sw-cd__lp" title=${t('漏过时扣除的目标生命值')}><${Icon} name="rook" /><b class="num">${s.lpr ?? 1}</b></span>
      ${types[0] ? html`<span class="sw-cd__mark" aria-hidden="true"><${Img} src=${factionIconUrl(m, factions[types[0]].icon)} /></span>` : null}
    </div>
    <div class="sw-cd__main">
      <div class="sw-cd__art">
        <span class="sw-cd__img"><${Img} src=${enemyIconUrl(m, e.key)} fallback=${html`<${GIcon} name="skull" />`} /></span>
        <span class="sw-cd__mass" title=${t('重量等级：越重越难被推动或拉动')}>${t('重量')}<b class="num">${s.massLevel ?? 0}</b></span>
      </div>
      <div class="sw-cd__stats">${STAT_ROWS.map(([k, label, icon]) => {
        const v = statValue(e, k);
        return html`<span key=${k} class="sw-stat">
          <span class="sw-stat__k"><${GIcon} name=${icon} />${t(label)}</span>
          <small class="sw-stat__v num">${statText(k, v)}</small>
          <b class=${cx('sw-stat__g', `g-${enemyGrade(k, v).replace('+', 'p').replace('—', 'none')}`)}>${enemyGrade(k, v)}</b>
        </span>`;
      })}</div>
    </div>
    ${e.descRaw || e.desc ? html`<${RichText} as="p" text=${e.descRaw || e.desc} class="sw-cd__desc" />` : null}
    ${types.length ? html`<p class="sw-cd__types">${types.map((k) => html`<span key=${k} class="sw-chip"><${Img} src=${factionIconUrl(m, factions[k].icon)} />${factions[k].name}</span>`)}</p>` : null}
    ${e.affiliationNames?.length ? html`<p class="sw-cd__types">${e.affiliationNames.map(name=>html`<span key=${name} class="sw-chip">${t(name)}</span>`)}</p>` : null}
    <h4 class="sw-cd__h">${t('能力')}</h4>
    <ul class="sw-cd__abil">
      ${abil.length ? abil.map((a, i) => html`<li key=${i}><${RichText} text=${a.text} /></li>`) : html`<li class="t-dim">${t('无特殊能力')}</li>`}
      ${imm.length ? html`<li>${t('免疫：{list}', { list: imm.join('、') })}</li>` : null}
    </ul>
  </div>`;
}

const RANK_TABS = [['all', N_('全部')], ['NORMAL', N_('普通')], ['ELITE', N_('精英')], ['BOSS', N_('领袖')]];

/** The enemy codex over the report: a list at the left, the detail at the right. */
function EnemyCodex({ open, m, onClose }) {
  const [rank, setRank] = useState('all');
  const [page,setPage]=useState(0);
  const [variant,setVariant]=useState('all');
  const [q, setQ] = useState('');
  const [scope, setScope] = useState(open.keys);
  const [sel, setSel] = useState(open.key);
  const all = useMemo(() => codexEnemies(data.list('enemies') || []), [data.get('enemies')]);
  const pool = useMemo(()=>scope ? scope.map((k) => data.lookup('enemies', k)).filter(Boolean) : all,[scope,all,data.get('enemies')]);
  const bosses=useMemo(()=>data.list('bosses'),[data.get('bosses')]);
  const ranks=useMemo(()=>new Map(pool.map(e=>[e.key,enemyReportRank(e,bosses)])),[pool,bosses]);
  const needle = q.trim().toLowerCase();
  const list = pool.filter((e) => (rank === 'all' || ranks.get(e.key) === rank)
    && (!['NORMAL','ELITE'].includes(rank)||variant==='all'||isEnhancedVariant(data.getRaw('enemies'),e.key)===(variant==='enhanced'))
    && (!needle || String(e.name || '').toLowerCase().includes(needle) || String(e.handbookIndex || '').toLowerCase().includes(needle)));
  const pageCount=Math.max(1,Math.ceil(list.length/60)),pageIndex=Math.min(page,pageCount-1);
  const visible=list.slice(pageIndex*60,(pageIndex+1)*60);
  const cur = visible.find((e) => e.key === sel) || visible[0] || null;
  const faction=scope&&open.factionType?data.get('factions')?.types?.[open.factionType]:null;
  const showBranches = !!faction?.branches?.length;
  const counts = Object.fromEntries(RANK_TABS.map(([k]) => [k, pool.filter((e) => k === 'all' || ranks.get(e.key) === k).length]));
  return html`<${Modal} open=${true} onClose=${onClose} class="sw-codex sw-codex--progressive" closeOnBackdrop=${false}>
    <div class="sw-codex__top">
      <button type="button" class="sw-back" onClick=${onClose} aria-label=${t('返回')} title=${t('返回 (Esc)')}><${Icon} name="chevronLeft" /></button>
      <span class="sw-codex__title">${t('敌方图鉴')}</span>
      ${scope ? html`<button type="button" class="sw-scope" onClick=${() => {setScope(null);setPage(0);}} title=${t('显示全部敌人')}>${open.title || t('筛选')}<${Icon} name="close" /></button>` : null}
      <label class="sw-search"><${Icon} name="search" /><input type="search" value=${q} placeholder=${t('名称或编号')} onInput=${(ev) => {setQ(ev.currentTarget.value);setPage(0);}} /></label>
    </div>
    <div class="sw-codex__body">
      <div class="sw-codex__catalog"><div class=${cx('sw-codex__list',showBranches&&'sw-codex__list--branches')}>
        ${list.length ? faction?.branches?.length?html`<${SweepBranches} type=${faction} list=${visible} expanded=${!!needle} renderEnemy=${e=>html`<${EnemyThumb} key=${e.key} e=${e} m=${m} size="md" on=${cur?.key===e.key} onClick=${()=>setSel(e.key)} />`} />`:visible.map((e) => html`<${EnemyThumb} key=${e.key} e=${e} m=${m} size="md" on=${cur?.key === e.key} onClick=${() => setSel(e.key)} />`)
          : html`<p class="sw-codex__empty">${t('没有符合条件的敌人')}</p>`}
      </div>
      <nav class="sw-pages" aria-label=${t('图鉴翻页')}>
        <button type="button" disabled=${pageIndex===0} onClick=${()=>setPage(pageIndex-1)}>${t('上一页')}</button>
        <span role="status">${t('第 {page} / {pages} 页 · 共 {n} 项',{page:pageIndex+1,pages:pageCount,n:list.length})}</span>
        <button type="button" disabled=${pageIndex>=pageCount-1} onClick=${()=>setPage(pageIndex+1)}>${t('下一页')}</button>
      </nav></div>
      <div class="sw-codex__side">
        <div class="sw-ranks" role="tablist">
          <span class="sw-ranks__n num" title=${t('当前列表')}>${list.length}</span>
          ${RANK_TABS.map(([k, label]) => html`<button key=${k} type="button" role="tab" aria-selected=${rank === k ? 'true' : 'false'} class=${cx(rank === k && 'is-on')}
            disabled=${k !== 'all' && !counts[k]} onClick=${() => {setRank(k);setPage(0);}}>${t(label)}</button>`)}
        </div>
        ${['NORMAL','ELITE'].includes(rank)?html`<div class="sw-ranks sw-variants" role="group" aria-label=${t('强化分类')}>${[['all',t('全部')],['base',t('基础')],['enhanced',t('强化')]].map(([id,label])=>html`<button key=${id} data-variant=${id} class=${cx(variant===id&&'is-on')} onClick=${()=>{setVariant(id);setPage(0);}}>${label}</button>`)}</div>`:null}
        ${cur ? html`<${CodexDetail} e=${cur} m=${m} />` : null}
      </div>
    </div>
  <//>`;
}

// ---- the screen --------------------------------------------------------------------------------------------------------

/**
 * The report overlay. @param {{ onClose: () => void }} props
 */
export function SweepReport({ onClose, leaving = false }) {

  const m = data.get('assets');
  const notOwned = useStore((s) => s.notOwned, Object.is, loadoutStore);
  const [tab, setTabState] = useState(() => { const v = loadPref(TAB_PREF, 'bonds'); return TABS.some((x) => x.id === v) ? v : 'bonds'; });
  const setTab = (v) => {
    audio.sfx('tab');
    if (v === tab) return;
    setTabState(v);
    savePref(TAB_PREF, v);
  };
  const [painted,setPainted]=useState(false);
  useEffect(()=>{let b=0;const a=requestAnimationFrame(()=>{b=requestAnimationFrame(()=>setPainted(true));});return()=>{cancelAnimationFrame(a);if(b)cancelAnimationFrame(b);};},[]);
  const names=painted?REPORT_FILES[tab]:[];
  const settled=useData(...names);
  useData(...(painted?['assets','local']:[]));
  useData(...(painted&&tab==='enemies'?['enemies','factions','config']:[]));
  // ⚠ 移植自离线演示版（2026-11-16）：演示版用 data.status 的按需加载，game 还有一层
  // 「内容版本」校验（contentSet/pageVersion）—— 换版本时 useData 可能已经拿到了**上一个版本**的数据，
  // 只按 settled 判会把旧版本当成新版本显示。保留 game 这层判定，两者取与。
  const version = useStore(shownVersion);
  const content = useStore((s) => s, Object.is, contentSet);
  const versionReady = pageVersion() === version
    && (version === DEFAULT_VERSION || (content.version === version && content.status === 'ready'));
  const failed = content.kind === 'version' && content.version === version && content.status === 'failed';
  const ready = painted && settled && !hasMissing(names) && versionReady;

  const [bondSel, setBondSel] = useState(null);
  const [bandSel, setBandSel] = useState(null);
  const [equipmentSel, setEquipmentSel] = useState(null);
  const equipment = useMemo(()=>ready && tab==='equipment' ? regulationEquipmentCatalog20261110(data.list('items')) : [],[ready,tab,data.get('items')]);
  const selectedEquipment = equipment.find(row=>row.id===equipmentSel) || equipment[0] || null;
  const [enemySel, setEnemySel] = useState(null);
  const [codex, setCodex] = useState(null);

  // defaults once the data is there: the first tile of each tab
  const bonds = useMemo(()=>ready&&tab==='bonds' ? sweepBonds() : [],[ready,tab,data.get('bonds')]);
  const bands = useMemo(()=>ready&&tab==='bands' ? regulationStrategyReportCatalog(data.list('bands')) : [],[ready,tab,data.get('bands')]);
  const bond = bonds.find(row => row.bondId === bondSel) || bonds[0] || null;
  const band = bands.find(row => row.bandId === bandSel) || bands[0] || null;
  const bosses = ready&&tab==='enemies' ? bossList() : [];
  const dossiers = ready&&tab==='enemies' ? sweepBossDossiers(bosses, m) : [];
  const selectedDossier = enemySel?.kind === 'dossier' ? dossiers.find(dossier => dossier.enemyKey === enemySel.id) : null;
  const validEnemy = ready&&tab==='enemies'&&enemySel&&(enemySel.kind==='boss'
    ? [...bosses,...otherBossList()].some(b=>b.bossId===enemySel.id)
    : enemySel.kind==='type'&&!!data.get('factions')?.types?.[enemySel.id]);
  const eSel = selectedDossier||validEnemy ? enemySel : (bosses.length ? { kind: 'boss', id: bosses[0].bossId } : null);

  let left = null;
  let right;
  if (failed) {
    // game 自己的「版本数据校验失败 + 重试」（content.js 的 retryContentSet）—— 演示版没有这条路径。
    right = html`<div class="sw-loading" role="alert"><p>${t('版本数据校验失败')}</p>
      <${Button} onClick=${retryContentSet}>${t('重试')}<//></div>`;
  } else if (!ready) {
    right = html`<${ReportStatus} names=${names} ready=${false}/>`;
  } else if (tab === 'bonds') {
    left = bond ? html`<${BondPanel} key=${bond.bondId} bond=${bond} m=${m} notOwned=${notOwned} onClose=${onClose} />` : null;
    right = html`<${BondsTab} m=${m} bonds=${bonds} sel=${bond?.bondId} onSel=${setBondSel} />`;
  } else if (tab === 'bands') {
    left = band ? html`<${BandPanel} key=${band.bandId} band=${band} m=${m} />` : null;
    right = html`<${BandsTab} m=${m} bands=${bands} sel=${band?.bandId} onSel=${setBandSel} />`;
  } else if (tab === 'equipment') {
    left = html`<${RegulationEquipmentPanel20261110} item=${selectedEquipment} records=${data.get('items')} m=${m} />`;
    right = html`<${RegulationEquipmentTiles20261110} items=${equipment} selected=${selectedEquipment?.id} onSelect=${setEquipmentSel} m=${m} />`;
  } else {
    left = selectedDossier ? html`<${BossDossierPanel} dossier=${selectedDossier} m=${m} />`
      : eSel ? html`<${EnemyPanel} key=${`${eSel.kind}:${eSel.id}`} sel=${eSel} m=${m} onCodex=${setCodex} />` : null;
    right = html`<${EnemiesTab} m=${m} sel=${eSel || {}} onSel=${setEnemySel} onCodex=${setCodex} dossiers=${dossiers} />`;
  }

  // the codex is the report's sibling, not its child: the report's body lifts its children over the backdrop
  // (position: relative), which would pull a nested Modal out of its fixed layer
  return html`<${Modal} open=${true} onClose=${onClose} leaving=${leaving} class="sweep sw--progressive sw--regulation20261110" closeOnBackdrop=${false}>
    <div class="sw__bg" aria-hidden="true"><i class="sw__mist"></i><i class="sw__lines"></i></div>
    <header class="sw-top">
      <div class="sw-top__left">
        <button type="button" class="sw-back" onClick=${onClose} aria-label=${t('返回')} title=${t('返回 (Esc)')}>
          <${Icon} name="chevronLeft" />
        </button>
      </div>
      <nav class="sw-tabs" role="tablist" aria-label=${t('S.W.E.E.P.报告')}>
        ${TABS.map((x) => html`<button key=${x.id} type="button" role="tab" data-own-click-sound data-tab=${x.id} aria-selected=${tab === x.id ? 'true' : 'false'} class=${cx('sw-tab', tab === x.id && 'is-on')}
          onClick=${() => setTab(x.id)}><span class="sw-tab__icon">${x.icon()}</span><span>${t(x.name)}</span></button>`)}
      </nav>
    </header>
    <main class="sw-body" data-tab=${tab} data-content-ready=${ready?'true':'false'}>
      <aside class="sw-left">${left}</aside>
      <div class="sw-right" key=${tab}>${right}</div>
    </main>
  <//>
  ${codex ? html`<${EnemyCodex} key=${`${codex.title}|${codex.key}`} open=${codex} m=${m} onClose=${() => setCodex(null)} />` : null}`;
}
