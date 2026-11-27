import {assistantAllowed,normalizeAssistant} from './assistantPolicy.js';
import { createAssistantPlayback } from './assistantPlayback.js';
import { createAssistantInteraction } from './assistantInteraction.js';
import { lobbyQuality } from './lobbyQuality.js';
import { DynamicAssistant, hasDynamicAssistant } from './dynamicAssistant.js';
import { useSettings } from './settings.js';
import { audio } from '../audio.js';
import { resolveAssistantSpeech, formatAssistantText } from './assistantSpeech.js';
import { identity } from '../net.js';
import {useEffect,useRef,useState} from '../../vendor/hooks.module.js';
import {html,Modal,Button} from './components.js';
import {portal as Portal} from './portalLite.js';
import {loadPref,savePref,useStore} from '../store.js';
import {t} from '../../../shared/i18n.js';

export function LobbyScene({picker,onClose,paused=false,occluded=false}){
 const [editing,setEditing]=useState(null),dragging=useRef(null),effectivePaused=paused&&!editing;
 const pausedRef=useRef(effectivePaused),syncAmbient=useRef(null);pausedRef.current=effectivePaused;
 useEffect(()=>{syncAmbient.current?.();},[effectivePaused]);
 useEffect(()=>{if(!editing)return;const escape=e=>{if(e.key==='Escape'){e.stopPropagation();setEditing(null);}};window.addEventListener('keydown',escape);return()=>window.removeEventListener('keydown',escape);},[!!editing]);
 const playerName=useStore(s=>s.me?.name)||identity.loadName();
 const settings=useSettings();
 const [dialogue,setDialogue]=useState(null);
 const [interacting,setInteracting]=useState(false);
 const interaction=useRef(null);if(!interaction.current)interaction.current=createAssistantInteraction(setInteracting);
 const [actorQuery,setActorQuery]=useState('');
 const speech=useRef(null),talkIndex=useRef(0);if(!speech.current)speech.current=createAssistantPlayback();
 const [catalog,setCatalog]=useState(null);
 const [selected,setSelected]=useState(()=>loadPref('lobby.scene','69_g1_rivercrossing'));
 const [actorId,setActorId]=useState(()=>{const saved=loadPref('lobby.actor','char_1023_ghost2'),migrate=!loadPref('lobby.defaultAssistantV2',false),id=normalizeAssistant(migrate&&saved==='char_1050_chen3'?'char_1023_ghost2':saved);if(id!==saved)savePref('lobby.actor',id);savePref('lobby.defaultAssistantV2',true);return id;});
 const [dynamicReady,setDynamicReady]=useState(false);
 const [category,setCategory]=useState('scene'),[pickerTab,setPickerTab]=useState('assistant');
 const [position,setPosition]=useState(()=>loadPref('lobby.assistantPosition',{x:29,y:2,scale:1}));
 const adjust=(key,value)=>{const next={...position,[key]:Number(value)};setPosition(next);savePref('lobby.assistantPosition',next);};
 const livePosition=editing?.draft||position,scenePose=useRef(livePosition);scenePose.current=livePosition;
 const dragStart=e=>{if(e.button!==0||!editing)return;dragging.current={x:e.clientX,y:e.clientY,position:{...editing.draft}};e.currentTarget.setPointerCapture(e.pointerId);e.preventDefault();};
 const dragMove=e=>{const start=dragging.current;if(!start)return;setEditing(current=>current?{...current,draft:{...current.draft,x:Math.min(100,Math.max(0,start.position.x+(e.clientX-start.x)/innerWidth*100)),y:Math.min(50,Math.max(-40,start.position.y+(e.clientY-start.y)/innerHeight*100))}}:current);};
 const dragEnd=e=>{dragging.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);};
 const confirmPosition=()=>{if(!editing)return;setPosition(editing.draft);savePref('lobby.assistantPosition',editing.draft);setEditing(null);};
 const host=useRef(null),canvas=useRef(null);
 useEffect(()=>{let live=true;fetch('/assets/lobby/catalog.json').then(r=>r.json()).then(j=>{if(live)setCatalog({...j,actors:j.actors.filter(assistantAllowed)});}).catch(()=>{});return()=>{live=false;};},[]);
 const scene=catalog?.backgrounds.find(s=>s.id===selected)||catalog?.backgrounds[0];
 const actor=catalog?.actors.find(a=>a.id===actorId);
 const matchingActors=catalog?.actors.filter(a=>!actorQuery||a.name.toLocaleLowerCase().includes(actorQuery.toLocaleLowerCase()))||[];
 useEffect(()=>{setDialogue(null);talkIndex.current=0;interaction.current.cancel();speech.current?.stop();return()=>{interaction.current.cancel();speech.current?.stop();};},[actorId]);
 const voiceOverridesKey=JSON.stringify(settings.voiceOverrides);
 useEffect(()=>{speech.current?.stop();},[settings.voiceLang,voiceOverridesKey,settings.voiceNative]);
 useEffect(()=>speech.current?.volume(settings),[settings.muted,settings.voice]);
 useEffect(()=>{const stop=()=>{if(document.hidden)speech.current?.stop();};document.addEventListener('visibilitychange',stop);return()=>document.removeEventListener('visibilitychange',stop);},[]);
 const interact=()=>{
  if(!actor)return;
  const turn=interaction.current.begin();if(!turn)return;
  audio.stopVoice?.();
  const motion={started:false,complete:turn.motionDone};
  host.current?.querySelector('.lobby-dynamic-assistant')?.dispatchEvent(new CustomEvent('assistant-interact',{detail:motion}));
  if(!motion.started)turn.motionDone();
  const list=actor.dialogues||[],line=list[talkIndex.current++%Math.max(1,list.length)];
  setDialogue(line||null);
  const url=resolveAssistantSpeech(actor,line,settings,audio.getVoicePrefs?.());
  speech.current.play(url,settings).then(turn.speechDone);
 };

 useEffect(()=>{
  if(!scene||!canvas.current)return;
  const el=host.current,c=canvas.current,ctx=c.getContext('2d'),image=new Image(),texture=new Image(),cg=new Image();
  let id=0,last=0,phase=0,w=1,h=1,px=0,py=0,x=0,y=0,vx=0,vy=0,dead=false;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  const profile=lobbyQuality({low:loadPref('settings',{})?.quality==='low'}),low=profile.lite;
  let drawn=0;
  const drops=Array.from({length:low?24:scene.weather==='rain'?90:55},(_,i)=>({x:(i*.618033)%1,y:(i*.414213)%1,z:.35+(i%7)/10}));
  if(actor)image.src=actor.image;
  if(scene.category==='cg')cg.src=scene.image;
  texture.src='/assets/lobby/'+(scene.weather==='rain'?'rain':'snow')+'.webp';
  const resize=()=>{w=el.clientWidth;h=el.clientHeight;const d=profile.resolution;c.width=w*d;c.height=h*d;ctx.setTransform(d,0,0,d,0,0);ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';};resize();
  const observer=new ResizeObserver(resize);observer.observe(el);
  // ★ 2026-11-21（第 14 轮·跟随重构）：事件驱动自愈。
  //   循环若已停（paused 曾为真、effect 因 dynamicReady 重建、rAF 被取消），指针一动就把它重新拉起来。
  //   这样「跟随恢复」只依赖"用户移动鼠标"这一个必然事件，不再依赖「先进一次干员调配再退出」
  //   那种偶然的整页重新挂载 —— 后者正是旧实现唯一的救命稻草。
  const move=e=>{
   if(profile.mobile)return;
   px=(e.clientX/w-.5);py=(e.clientY/h-.5);
   if(!id&&!pausedRef.current)syncAmbient.current?.();
  };
  const reset=()=>{px=0;py=0;};window.addEventListener('pointermove',move,{passive:true});window.addEventListener('blur',reset);
  const frame=now=>{
   // ★ 2026-11-21（第 14 轮·跟随重构）：回到离线演示版 :78 的语义 ——
   //   「先判断再排队」，paused / hidden 时停排并把 id 清 0，不在 frame 里每帧空转。
   //   旧实现把重排提到判断之前，于是 paused 为真时每帧都写一次 --scene-x:0px；
   //   一旦某个浮层状态卡住（overlayBusy 卡 true），视差被永久钉在 0，
   //   且因循环从不停止，sync() 的「先 cancel 再 restart」也纠正不了它 ——
   //   这就是「必须开一次干员调配（整页重挂）才恢复」的真正机制。
   //   现在：paused → 归零一次 + 停排；恢复由两条独立路径负责，互不依赖 ——
   //     ① sync()（effectivePaused 变化时自动调用）② move()（用户移动鼠标，见上）。
   if(dead||pausedRef.current){id=0;return;}
   id=requestAnimationFrame(frame);
   if(document.hidden){last=now;id=0;return;}
   if(now-drawn<1000/profile.ambientFps-1)return;drawn=now;
   const dt=Math.min(.1,(now-(last||now))/1000);last=now;phase+=dt;
   vx+=(px*32-x)*dt*28;vy+=(py*20-y)*dt*28;vx*=Math.exp(-dt*8);vy*=Math.exp(-dt*8);x+=vx*dt;y+=vy*dt;
   el.style.setProperty('--scene-x',`${reduced?0:x*.5}px`);el.style.setProperty('--scene-y',`${reduced?0:y*.5}px`);
   const home=el.closest('.lobby-home');home?.style.setProperty('--float-x',`${reduced?0:x*.55}px`);home?.style.setProperty('--float-y',`${reduced?0:y*.55}px`);home?.style.setProperty('--float-ry',`${reduced?0:x*.16}deg`);home?.style.setProperty('--float-rx',`${reduced?0:-y*.13}deg`);
   ctx.clearRect(0,0,w,h);
   // Local illustration deformation around the visual centre; no fabricated Live2D rig.
   if(!profile.mobile&&scene.category==='cg'&&cg.complete&&cg.naturalWidth){
    const scale=Math.max(w/cg.naturalWidth,h/cg.naturalHeight),sw=w/scale,sh=h/scale,sx=(cg.naturalWidth-sw)/2,sy=(cg.naturalHeight-sh)/2;
    const cols=low?12:24,rows=low?12:24;
    for(let r=0;r<rows;r++)for(let col=0;col<cols;col++){
     const u=col/cols,v=r/rows,weight=Math.exp(-((u-.43)**2)*20)*Math.sin(v*Math.PI);
     const dx=reduced?0:Math.sin(phase*.9+v*3)*4*weight+x*.2*weight;
     const dy=reduced?0:Math.sin(phase*.8)*2*weight;
     ctx.drawImage(cg,sx+u*sw,sy+v*sh,sw/cols,sh/rows,u*w+dx,v*h+dy,w/cols+1,h/rows+1);
    }
   }
   const position=scenePose.current;
   if(!dynamicReady&&actor&&image.complete&&image.naturalWidth){
    const ah=h*1.04*position.scale,aw=image.naturalWidth/image.naturalHeight*ah,ax=w*position.x/100-aw*.5,ay=h*position.y/100;
    if(profile.mobile){
     const breathe=reduced?0:Math.sin(phase*1.1)*1.5;
     ctx.drawImage(image,ax,ay+breathe,aw,ah);
    }else{
    const rows=64,sh=image.naturalHeight/rows;
    for(let i=0;i<rows;i++){
     const f=i/rows,weight=Math.sin(Math.PI*f)*f;
     const flutter=reduced?0:(Math.sin(phase*1.2+f*5)*3.2+Math.sin(phase*2.1+f*9)*1.1)*weight;
     const shift=reduced?0:x*(.3+f*.7)+flutter+vx*.035*f;
     ctx.drawImage(image,0,i*sh,image.naturalWidth,Math.min(sh+1,image.naturalHeight-i*sh),ax+shift,ay+i*ah/rows+(reduced?0:y*.4+Math.sin(phase*1.1)*1.3),aw,ah/rows+1);
    }
   }
   }
   if(!reduced&&scene.weather!=='none')for(const p of drops){
    p.y+=dt*(scene.weather==='rain'?.6:.07)*p.z;p.x+=dt*(scene.weather==='rain'?-.12:Math.sin(phase*.4+p.z)*.015);if(p.y>1.05){p.y=-.05;}if(p.x<-.05)p.x=1.05;
    ctx.globalAlpha=scene.weather==='rain'?.28:.55;
    if(scene.weather==='rain'){ctx.strokeStyle='#d4e6f3';ctx.lineWidth=.7*p.z;ctx.beginPath();ctx.moveTo(p.x*w,p.y*h);ctx.lineTo(p.x*w-7*p.z,p.y*h+29*p.z);ctx.stroke();}
    else if(texture.complete&&texture.naturalWidth){const size=7*p.z;ctx.drawImage(texture,p.x*w,p.y*h,size,size);}
   }
   if(!reduced&&scene.weather==='none')for(let i=0;i<14;i++){
    const sx=((i*.173+phase*.003)%1)*w,sy=((i*.379-phase*.008+10)%1)*h;
    ctx.globalAlpha=(.08+.1*Math.sin(phase+i)**2);ctx.fillStyle='#f8e9c9';ctx.beginPath();ctx.arc(sx,sy,.7+(i%3)*.45,0,Math.PI*2);ctx.fill();
   }
   ctx.globalAlpha=1;
  };
  // ★ 视差归零（2026-11-17）：暂停 / 页面隐藏时把 --scene-x / --scene-y 与 --float-* 清零。
  //   原因：frame() 在开头 `if(dead||pausedRef.current)return;` 直接返回且不再调度 rAF，
  //   于是这两个变量冻结在最后一次写入的非零值。助理的 transform 是
  //   translate(calc(var(--scene-x)*1.4), calc(var(--scene-y)*1.4))，冻结后就永久带着位移，
  //   再被 .lobby-scene{overflow:hidden} 裁掉 —— 这正是「退出 SWEEP 后助理立绘残缺」的机制。
  //   原来只有 window blur 才 reset，切页面不触发，必须在这里补。
  const neutral=()=>{
   x=0;y=0;vx=0;vy=0;px=0;py=0;
   el.style.setProperty('--scene-x','0px');el.style.setProperty('--scene-y','0px');
   const homeEl=el.closest('.lobby-home');
   if(homeEl){homeEl.style.setProperty('--float-x','0px');homeEl.style.setProperty('--float-y','0px');homeEl.style.setProperty('--float-ry','0deg');homeEl.style.setProperty('--float-rx','0deg');}
  };
  // ★ 2026-11-21（第 14 轮·跟随重构）：sync 是循环唯一的「启动/停止」开关。
  //   暂停 → 归零一次 + 停排；恢复 → 重新排队。与离线演示版 :125 同构，
  //   只多一层 neutral()：暂停那一刻把残留位移清掉，避免立绘冻结在非零偏移上被裁切。
  const sync=()=>{cancelAnimationFrame(id);id=0;last=0;if(dead)return;if(pausedRef.current||document.hidden){neutral();return;}id=requestAnimationFrame(frame);};
  syncAmbient.current=sync;document.addEventListener('visibilitychange',sync);sync();
  return()=>{dead=true;cancelAnimationFrame(id);document.removeEventListener('visibilitychange',sync);if(syncAmbient.current===sync)syncAmbient.current=null;observer.disconnect();window.removeEventListener('pointermove',move);window.removeEventListener('blur',reset);};
 },[scene?.id,actor?.id,dynamicReady]);
 // ★ 2026-11-17（第 4 轮·按钮闪烁）：原来 occluded 直接写 style visibility:hidden。
 //   实测进入全屏浮层时场景在 2ms 内 visible→hidden，退出时同样瞬间回来 ——
 //   中间没有任何过渡，肉眼就是「画面闪一下」；按钮跟着一起跳，就是用户说的按钮闪烁。
 //   改成用 class 交给 CSS 做 opacity 过渡（visibility 仍然保留在 CSS 里，
 //   但只在过渡结束后才真正隐藏，这样它既不参与合成层重建，又不会挡住点击）。
 return html`<div ref=${host} class=${`lobby-scene ${scene?.category==='cg'?'is-cg':''}${occluded?' is-occluded':''}`} aria-hidden="true">
  <div class="lobby-scene__image" style=${scene?`background-image:url("${scene.image}")`:''}></div><div class="lobby-scene__wash"></div><canvas ref=${canvas}></canvas><${DynamicAssistant} paused=${effectivePaused} actor=${actor} position=${livePosition} onReady=${setDynamicReady} />
 </div>${actor?html`<button class="assistant-interact" aria-label=${t('与助理交谈')} style=${`left:${position.x-14}%;top:${Math.max(12,position.y+12)}%`} disabled=${interacting} aria-busy=${interacting} onClick=${interact}></button>`:null}
 ${dialogue?html`<aside class="assistant-dialogue" aria-live="polite"><strong>${actor?.name}</strong><button aria-label=${t('关闭')} onClick=${e=>{e.stopPropagation();setDialogue(null);}}>×</button><p>${formatAssistantText(dialogue.text,playerName)}</p></aside>`:null}<${Modal} open=${picker&&!editing} onClose=${onClose} title=${t('背景替换')} class="background-picker" veilClass="background-picker-veil" closeOnBackdrop=${false} actions=${html`<${Button} onClick=${onClose}>${t('完成')}<//>`}>
  <div class="background-picker__layout">
   <aside class="background-picker__preview">
    <div class="background-picker__art" style=${scene?{backgroundImage:`url("${scene.image||scene.thumb}")`}:undefined}>
     ${actor?html`<img src=${actor.image} alt="" decoding="async" style=${{left:position.x+'%',top:position.y+'%',height:104*position.scale+'%'}}/>`:null}
     <span>${scene?.name}</span>
    </div>
    <div class="background-picker__current"><small>${t('主界面助理')}</small><strong>${actor?.name||t('隐藏角色')}</strong></div>
    <button type="button" class="background-picker__edit" disabled=${!actor} onClick=${()=>setEditing({draft:{...position}})}>${t('在主界面调整')}</button>
    <div class="home-position">${[['x','水平位置',0,100,1],['y','垂直位置',-40,50,1],['scale','助理大小',.5,1.8,.05]].map(([key,label,min,max,step])=>html`<label>${t(label)}<input type="range" min=${min} max=${max} step=${step} value=${position[key]} onInput=${e=>adjust(key,e.currentTarget.value)} /></label>`)}<button onClick=${()=>{setPosition({x:29,y:2,scale:1});savePref('lobby.assistantPosition',{x:29,y:2,scale:1});}}>${t('重置位置')}</button></div>
   </aside>
   <section class="background-picker__choices">
    <nav class="background-picker__tabs" role="tablist">
     <button type="button" role="tab" aria-selected=${pickerTab==='assistant'} onClick=${()=>setPickerTab('assistant')}>${t('主界面助理')}<small>${catalog?.actors.length||0}</small></button>
     <button type="button" role="tab" aria-selected=${pickerTab==='background'} onClick=${()=>setPickerTab('background')}>${t('背景替换')}</button>
    </nav>
    ${pickerTab==='assistant'?html`<input class="assistant-search" type="search" aria-label=${t('搜索助理')} placeholder=${t('搜索助理')} value=${actorQuery} onInput=${e=>setActorQuery(e.currentTarget.value)}/>
     <div class="home-actors background-picker__actors"><button type="button" class=${!actorId?'is-on':''} aria-pressed=${!actorId} data-assistant-id="" onClick=${()=>{setActorId('');savePref('lobby.actor','');}}>${t('隐藏角色')}</button>${matchingActors.map(a=>html`<button type="button" key=${a.id} data-assistant-id=${a.id} aria-pressed=${a.id===actorId} class=${a.id===actorId?'is-on':''} onClick=${()=>{setActorId(a.id);savePref('lobby.actor',a.id);}}><span>${a.name}</span>${hasDynamicAssistant(a)?html`<small>${t('官方动态')}</small>`:null}</button>`)}</div>`:html`
     <div class="background-picker__categories">${[['scene','场景'],['cg','人物CG']].map(([id,label])=>html`<button type="button" class=${category===id?'is-on':''} aria-pressed=${category===id} onClick=${()=>setCategory(id)}>${t(label)}</button>`)}</div>
     <div class="home-backgrounds">${catalog?.backgrounds.filter(s=>(s.category||'scene')===category).map(s=>html`<button type="button" key=${s.id} class=${s.id===scene?.id?'is-on':''} data-scene-id=${s.id} onClick=${()=>{setSelected(s.id);savePref('lobby.scene',s.id);}} aria-pressed=${s.id===scene?.id}><img src=${s.thumb} alt="" loading="lazy" decoding="async"/><span>${s.name}</span>${s.weather!=='none'?html`<small>${s.weather==='rain'?t('雨'):t('雪')}</small>`:null}</button>`)}</div>`}
   </section>
  </div>
 <//>
 ${editing?html`<${Portal}><div class="assistant-editor" role="dialog" aria-modal="true" aria-label=${t('主界面助理')} data-testid="assistant-editor">
  <div class="assistant-editor__stage" onPointerDown=${dragStart} onPointerMove=${dragMove} onPointerUp=${dragEnd} onPointerCancel=${dragEnd}>
   <span class="assistant-editor__hint">${t('拖拽调整位置')}</span>
   <div class="assistant-editor__bounds" style=${{left:`calc(${livePosition.x}% - 14vw)`,top:Math.max(-20,livePosition.y+12)+'%'}}><span>${actor?.name}</span></div>
  </div>
  <aside class="assistant-editor__controls"><small>STRONGHOLD PROTOCOL / ALLIANCE</small><h2>${t('主界面助理')}</h2><p>${actor?.name}</p><label>${t('助理大小')}<strong>${Math.round(livePosition.scale*100)}%</strong><input data-testid="assistant-size" type="range" min="0.5" max="1.8" step="0.01" value=${livePosition.scale} onInput=${e=>setEditing(current=>({...current,draft:{...current.draft,scale:Number(e.currentTarget.value)}}))}/></label><div class="assistant-editor__actions"><button type="button" data-testid="assistant-cancel" onClick=${()=>setEditing(null)}>${t('取消')}</button><button type="button" data-testid="assistant-confirm" onClick=${confirmPosition}>${t('确定')}</button></div></aside>
 </div><//>`:null}`;
}
