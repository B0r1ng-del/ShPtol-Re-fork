import {FACTION_MUSIC,FACTION_PLAYLISTS,BOUNTY_PLAYLISTS,ENEMY_PLAYLISTS,MUSIC_GROUPS} from './factionMusicCatalog.js';
export {MUSIC_GROUPS,BOUNTY_PLAYLISTS,ENEMY_PLAYLISTS};
// The radio contains the supplied catalogue; the S2 contract theme reuses the official regulation song.
export const MUSIC_LIBRARY=FACTION_MUSIC;
export const IMPORTED_MUSIC=Object.freeze([]);
export const musicById=id=>MUSIC_LIBRARY.find(t=>t.id===id)||null;
const song=id=>{const t=musicById(id);return t?{intro:null,loop:t.url}:null;};
const legacy=name=>({intro:null,loop:`/assets/audio/bgm/owner_${name}.ogg`});
export const OWNER_BGM=Object.freeze({
 lobby:song(MUSIC_LIBRARY.find(t=>t.home)?.id),
 crisis:song('faction_80a1030cdfe24c72e451'),'crisis:settle':song('faction_80a1030cdfe24c72e451'),
 // The supplied folders have no replacement for these stages; these fallbacks belong only to their boss.
 'boss:boss_7':legacy('sami_sovereign'),'bossPrep:boss_7':legacy('sami_sovereign'),
 'bossPrep:boss_pursuer':{intro:null,loop:'/assets/audio/bgm/faction_6cdd912092842c3ee4c5.ogg'},
 ...Object.fromEntries(Object.entries(FACTION_PLAYLISTS).filter(([id])=>id.startsWith('boss')).flatMap(([id,p])=>[
  ...(p.prep.length?[[`bossPrep:${id}`,song(p.prep[0])]]:[]),
  ...(p.loop.length?[[`boss:${id}`,song(p.loop[0])]]:[]),
 ])),
});

/** Replacement means no old faction song or boss escort-faction song is appended. */
export function factionMusicOptions(key) {
 let group,slot,table=FACTION_PLAYLISTS;
 if(key?.startsWith('theme:')){[group,slot='loop']=key.slice(6).split('@');if(group==='yan:dust')group='yan';}
 else if(/^boss(?:Prep|Phase2)?:/.test(key||'')){group=key.split(':')[1];slot=key.startsWith('bossPrep:')?'prep':key.startsWith('bossPhase2:')?'phase2':'loop';}
 else if(/^bounty(?:Prep)?:/.test(key||'')){group=key.split(':')[1];slot=key.startsWith('bountyPrep:')?'prep':'loop';table=BOUNTY_PLAYLISTS;}
 else if(/^enemy(?:Prep)?:/.test(key||'')){group=key.split(':')[1];slot=key.startsWith('enemyPrep:')?'prep':'loop';table=ENEMY_PLAYLISTS;}
 else return [];
 return (table[group]?.[slot]||[]).map(song).filter(Boolean);
}
export function selectMusic(ids,seed='') {
 if(!ids?.length)return null;
 let hash=2166136261;for(const c of String(seed))hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
 const t=musicById(ids[hash%ids.length]);return t?`playlist:${encodeURIComponent(t.url)}`:null;
}
export function selectFactionMusic(key,manifest,round,seed) {
 if(!seed)return key;
 const options=factionMusicOptions(key);if(!options.length)return key;
 let hash=2166136261;for(const c of `${seed}:${round||0}:${key}`)hash=Math.imul(hash^c.charCodeAt(0),16777619)>>>0;
 return `playlist:${encodeURIComponent(options[hash%options.length].loop)}`;
}
export function yanMusicKey(){return 'theme:yan';}

export function battleMusicOverride({route,pub,priv,units=[],result,theme,bossId,bossPhase=1,seed=''}) {
 const phase=pub?.wavePrelude?.targetPhase||pub?.phase;
 if((route==='game'&&phase==='RESULT')||route==='result'||route==='settle'){
  if(result)return selectMusic(FACTION_PLAYLISTS[result.victory?'result_win':'result_lose']?.loop,'result');
 }
 if(route!=='game'||!['PREP','ROUND_START','SP_DRAFT','COMBAT','UNITE','FINAL_ASSAULT','HIDDEN_CORE','SETTLE'].includes(phase))return undefined;
 const prep=['PREP','ROUND_START','SP_DRAFT'].includes(phase),slot=prep?'prep':'loop';
 if(bossId){
  const stage2=!prep&&bossId==='boss_patriot'&&bossPhase===2;
  const key=`${prep?'bossPrep':stage2?'bossPhase2':'boss'}:${bossId}`;
  return selectFactionMusic(key,null,pub.round,seed);
 }
 const keys=new Set((prep?priv?.nextEnemies||[]:units).map(u=>u.enemyKey||u.key||u.def||u.defId||u.spine).filter(Boolean));
 const candidates=[...keys].filter(k=>BOUNTY_PLAYLISTS[k]?.[slot]?.length).sort();
 if(candidates.length)return selectMusic(BOUNTY_PLAYLISTS[candidates[0]][slot],`${seed}:${pub.round}:${slot}`);
 // Ordinary special-enemy music sits below every bounty and above faction training.
 const special=[...keys].filter(k=>ENEMY_PLAYLISTS[k]?.[slot]?.length).sort();
 if(special.length)return selectMusic(ENEMY_PLAYLISTS[special[0]][slot],`${seed}:${pub.round}:${slot}`);
 const ids=FACTION_PLAYLISTS[theme]?.[slot];
 if(ids?.length)return selectFactionMusic(`theme:${theme}${prep?'@prep':''}`,null,pub.round,seed);
 return undefined;
}
