import { packReady } from '../resourcePacks.js';
import {useEffect,useRef} from '../../vendor/hooks.module.js';
import {html} from './components.js';
import { ensurePixi as runtime } from '../render/app/pixi.js';
import { createAssistantSpine, loadAssistantSpine } from './assistantSpine.js';
import { AssistantEffects } from './assistantEffects.js';
import { loadPref } from '../store.js';
import { lobbyQuality } from './lobbyQuality.js';
export const hasDynamicAssistant = actor => !!actor?.dynamic && packReady('dynamic');
export function DynamicAssistant({actor,position,onReady,paused=false}){
 const pausedRef=useRef(paused),syncVisibility=useRef(null);pausedRef.current=paused;
 useEffect(()=>{syncVisibility.current?.();},[paused]);
 const host=useRef(null),pose=useRef(position);pose.current=position;
 const available=hasDynamicAssistant(actor);
 useEffect(()=>{
  const el=host.current;
  let alive=true,app=null,observer=null,effects=null,stopVisibility=null,stopInteract=null;
  const dispose=()=>{
   observer?.disconnect();observer=null;stopVisibility?.();stopVisibility=null;stopInteract?.();stopInteract=null;
   effects?.destroy();effects=null;app?.destroy(true,{children:true,texture:false,baseTexture:false});app=null;
   delete el._app;delete el._spine;delete el._effects;
  };
  onReady(false);
  delete el.dataset.loaded;delete el.dataset.error;delete el.dataset.animation;delete el.dataset.effects;delete el.dataset.effectsError;
  // Atlas alpha and path-chain rotation are corrected by the exporter/vendor patch.
  if(!available)return;
  runtime().then(async P=>{
   const data=await loadAssistantSpine(P,actor.dynamic,()=>alive);if(!alive)return;
   const quality=lobbyQuality({low:loadPref('settings',{}).quality==='low'});
   app=new P.Application({width:el.clientWidth,height:el.clientHeight,backgroundAlpha:0,antialias:true,resolution:quality.resolution,autoDensity:true});el.appendChild(app.view);el._app=app;
   el.dataset.mobile=String(quality.mobile);
   const sp=createAssistantSpine(P,data.spineData||data);app.stage.addChild(sp);el._spine=sp;
   const clips=sp.spineData.animations,idle=clips.find(a=>/^idle$/i.test(a.name))||clips.find(a=>/idle|loop/i.test(a.name))||clips[0];
   if(idle)sp.state.setAnimation(0,idle.name,true);sp.update(0);const bounds=sp.getLocalBounds();
   const place=()=>{const w=el.clientWidth,h=el.clientHeight,p=pose.current;const scale=h*1.04*p.scale/Math.max(1,bounds.height);sp.scale.set(scale,-scale);sp.position.set(w*p.x/100-(bounds.x+bounds.width/2)*scale,h*p.y/100+(bounds.y+bounds.height)*scale);};
   observer=new ResizeObserver(()=>{app.renderer.resize(el.clientWidth,el.clientHeight);place();});observer.observe(el);
   const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;sp.autoUpdate=false;
   app.ticker.add(()=>{if(!reduced)sp.update(Math.min(.05,app.ticker.deltaMS/1000));place();});place();app.ticker.maxFPS=30;
   // ★ 2026-11-17（第 4 轮·立绘卡顿）：stop()/start() 必须幂等。
   //   原来这个函数每次调用都无条件 app.stop() 或 sp.lastTime=0+app.start()。
   //   实测一次「进出干员调配」就让 stops/starts 各涨 5 次（5 次 WebGL ticker 停机重启 +
   //   5 次合成层切换）—— 这才是返回主页时立绘卡一下的来源。
   //   已实测 trackTime 在暂停前后连续无跳变（179.84 → 180.01 → 180.79），所以不是动画时间问题。
   //   sp.lastTime=0 只在「从暂停真正恢复」那一次做；重复清零会让每帧都被当首帧，反而丢掉步进。
   const wantRun=()=>!(document.hidden||pausedRef.current);
   let running=wantRun(); // 先按当下状态定好，避免首次 visibility() 白跑一次
   const visibility=()=>{
    const w=wantRun();
    if(w===running)return; // 状态没变就什么都不做 —— 本次修复的核心
    running=w;
    if(w){sp.lastTime=0;app.start();}else app.stop();
   };
   document.addEventListener('visibilitychange',visibility);syncVisibility.current=visibility;stopVisibility=()=>{document.removeEventListener('visibilitychange',visibility);if(syncVisibility.current===visibility)syncVisibility.current=null;};visibility();
   if(matchMedia('(prefers-reduced-motion: reduce)').matches){sp.autoUpdate=false;}
   let interacting=false,finishMotion=null,effectTimer=null;
   const complete=()=>{interacting=false;delete el.dataset.interacting;const done=finishMotion;finishMotion=null;clearTimeout(effectTimer);effectTimer=null;done?.();};
   const interact=event=>{
    if(interacting||reduced)return;
    const clip=clips.find(a=>/^interact$/i.test(a.name));
    if(!clip&&!effects)return;
    interacting=true;el.dataset.interacting='true';
    if(event.detail){event.detail.started=true;finishMotion=event.detail.complete;}
    effects?.play(3);
    if(clip){
     const entry=sp.state.setAnimation(0,clip.name,false);
     entry.listener={complete};
     if(idle)sp.state.addAnimation(0,idle.name,true,0);
    }else effectTimer=setTimeout(complete,3000);
   };
   el.addEventListener('assistant-interact',interact);
   stopInteract=()=>{el.removeEventListener('assistant-interact',interact);complete();};
   if(actor.nativeFx&&!matchMedia('(prefers-reduced-motion: reduce)').matches){
    effects=new AssistantEffects(P,app,sp,actor.nativeFx,{lite:quality.lite,particleBudget:quality.particleBudget});el._effects=effects;
    effects.init().then(ok=>{if(alive)el.dataset.effects=ok?'ready':'unavailable';}).catch(error=>{if(alive)el.dataset.effectsError=error.message;});
   }
   el.dataset.loaded=actor.id;el.dataset.animation=idle?.name||'';onReady(true);
  }).catch(e=>{if(alive){dispose();el.dataset.error=e.message;onReady(false);}});
  return()=>{alive=false;dispose();};
 },[actor?.id,actor?.dynamic,actor?.nativeFx,available]);
 return html`<div class="lobby-dynamic-assistant" ref=${host}></div>`;
}
