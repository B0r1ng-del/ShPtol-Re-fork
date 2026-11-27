import {audio} from '../audio.js';

// These small official UI cues live with the boot shell, before any optional pack.
const files={click:'click.mp3',confirm:'confirm.mp3',start:'start-fusion.mp3',login:'login.mp3'};
const players=new Map();
export function warmStartupSounds(){
 if(typeof Audio==='undefined')return;
 for(const [name,file]of Object.entries(files))if(!players.has(name)){
  const player=new Audio('/startup/'+file);player.preload='auto';players.set(name,player);
 }
}
export function startupCue(name='click'){
 warmStartupSounds();const player=players.get(name)||players.get('click');
 const volume=audio.volumes;if(!player||volume?.muted||volume?.sfx===0)return;
 player.pause();player.currentTime=0;player.volume=Math.min(1,(volume?.sfx??.8)**2);
 void player.play().catch(()=>{});
}
export function startupClick(event){
 const target=event.target?.closest?.('button,input,summary');
 if(!target||target.disabled||target.dataset.startupCue==='login')return;
 startupCue(target.dataset.startupCue||'click');
}
