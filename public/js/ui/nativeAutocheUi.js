// Original client UI hierarchy: RectTransforms and nine-slice borders, not a stretched composite.
import {h} from '../../vendor/preact.module.js';
import {useEffect,useLayoutEffect,useState,useRef} from '../../vendor/hooks.module.js';
import {t} from '../../../shared/i18n.js';
import {PHASE} from '../../../shared/constants.js';
import {NativeNumber} from './nativeNumber.js';
import {NativeHudFrame} from './nativeHudFrame.js';
import {nativeAnimatedNode,nativeClipDuration} from './nativeUiAnimation.js';
import {playNativeVehicleMotion} from './nativeVehicleMotion.js';

let manifest=null,pending=null;
let clips=null,clipPending=null;
let difficultyManifest=null,difficultyPending=null,difficultyClips=null,difficultyClipPending=null;
// Older imported packs can contain the previous UI schema. Existing workers already bypass X-SP-Download requests.
async function fetchNativeUiDocument(name){
 const url='/assets/ui/native-autochess/'+name+'.json';
 const read=async fresh=>{const r=await fetch(url,fresh?{cache:'no-store',headers:{'X-SP-Download':'1'}}:undefined);if(!r.ok)throw Error('Native autochess UI '+r.status);return r.json();};
 try{return await read(true);}catch{return read(false);}
}
export function preloadNativeAutocheUi(){
 if(!pending)pending=fetchNativeUiDocument('layouts').then(m=>(manifest=m)).catch(error=>{pending=null;throw error;});
 return pending;
}
export function preloadNativeDifficultyUi(){
 if(!difficultyPending)difficultyPending=fetchNativeUiDocument('difficulty-layouts').then(m=>(difficultyManifest=m)).catch(()=>preloadNativeAutocheUi()).catch(error=>{difficultyPending=null;throw error;});
 return difficultyPending;
}
function loadNativeClips(scope='full'){
 if(scope==='difficulty'){
  if(!difficultyClipPending)difficultyClipPending=fetchNativeUiDocument('difficulty-animations').then(v=>(difficultyClips=v)).catch(()=>loadNativeClips()).catch(error=>{difficultyClipPending=null;throw error;});
  return difficultyClipPending;
 }
 if(!clipPending)clipPending=fetchNativeUiDocument('animations').then(v=>(clips=v)).catch(error=>{clipPending=null;throw error;});return clipPending;
}
function useNativeClips(scope='full'){const[value,set]=useState(scope==='difficulty'?difficultyClips:clips);useEffect(()=>{let alive=true;loadNativeClips(scope).then(v=>{if(alive)set(v);}).catch(()=>{});return()=>{alive=false;};},[scope]);return value;}
function useNativeUi(scope='full'){const[m,set]=useState(scope==='difficulty'?difficultyManifest:manifest);useEffect(()=>{let alive=true;(scope==='difficulty'?preloadNativeDifficultyUi():preloadNativeAutocheUi()).then(v=>{if(alive)set(v);}).catch(()=>{});return()=>{alive=false;};},[scope]);return m;}
const viewportListeners=new Set();let viewportFrame=0;
const readNativeViewport=()=>({width:globalThis.innerWidth||1280,height:globalThis.innerHeight||720,touch:!!globalThis.matchMedia?.('(any-pointer: coarse)').matches});
const notifyNativeViewport=()=>{if(viewportFrame)return;viewportFrame=requestAnimationFrame(()=>{viewportFrame=0;const next=readNativeViewport();for(const listener of viewportListeners)listener(next);});};
function useNativeViewport(){const[v,set]=useState(readNativeViewport);useEffect(()=>{if(!viewportListeners.size)globalThis.addEventListener?.('resize',notifyNativeViewport);viewportListeners.add(set);set(readNativeViewport());return()=>{viewportListeners.delete(set);if(!viewportListeners.size){globalThis.removeEventListener?.('resize',notifyNativeViewport);cancelAnimationFrame(viewportFrame);viewportFrame=0;}};},[]);return {...v,portrait:v.touch&&v.width<v.height&&v.width<=820};}
function useNativeScale(){const v=useNativeViewport();return Math.min(v.width/1280,v.height/720);}
const outcomeTransform=scale=>`translate(-50%,-50%) scale(var(--outcome-scale, ${scale}))`;
function useNativeAnimation(key,clipName=null,loop=false,scope='full'){
 const[state,set]=useState({key,clips:scope==='difficulty'?difficultyClips:clips,time:0});
 useEffect(()=>{
  let alive=true,raf=0,start=null,last=0,animationClips=scope==='difficulty'?difficultyClips:clips;
  const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const frame=now=>{if(!alive)return;if(!reduced&&loop&&(globalThis.document?.hidden||now-last<1000/30)){raf=requestAnimationFrame(frame);return;}last=now;if(start==null)start=now;const time=(now-start)/1000,end=clipName?nativeClipDuration(animationClips?.[clipName]):6;set({key,clips:animationClips,time:reduced?Infinity:time});if(!reduced&&(loop||time<end))raf=requestAnimationFrame(frame);};
  loadNativeClips(scope).then(value=>{animationClips=value;if(alive)raf=requestAnimationFrame(frame);}).catch(()=>{});
  return()=>{alive=false;cancelAnimationFrame(raf);};
 },[key,clipName,loop,scope]);return state.key===key?state:{clips:scope==='difficulty'?difficultyClips:clips,time:0};
}
export function nativeFind(node,suffix){if(!node)return null;if(node.path.endsWith(suffix))return node;for(const c of node.children||[]){const found=nativeFind(c,suffix);if(found)return found;}return null;}
const rgba=c=>c?`rgba(${Math.round(c.r*255)},${Math.round(c.g*255)},${Math.round(c.b*255)},${c.a})`:undefined;

export function useNativeEntryStyle(layoutName,suffix,clipName){
 const m=useNativeUi(),scale=useNativeScale(),motion=useNativeAnimation('entry:'+layoutName+suffix,clipName);
 if(!m)return {opacity:0};
 const root=m.layouts[layoutName],base=nativeFind(root,suffix);if(!base)return {};
 const node=nativeAnimatedNode(base,[{clip:motion.clips?.[clipName],time:motion.time,root:root.path}]);
 const a=base.rect?.m_AnchoredPosition,b=node.rect?.m_AnchoredPosition;
 return {opacity:node.alpha??1,transform:a&&b?`translate(${(b.x-a.x)*scale}px,${(a.y-b.y)*scale}px)`:undefined};
}
export function NativeInfoMain({children}){
 const style=useNativeEntryStyle('auto_chess_stage_info_state','/panel_container','anim_auto_chess_stage_info_enter');
 return h('main',{class:'brief__main',style},children);
}
export function NativeRoomMain({class:cls,children}){
 const host=useRef(null),style=useNativeEntryStyle('auto_chess_room_state','/panel_main','room_in');
 useEffect(()=>{
  const el=host.current;if(!el)return;
  const gallery=el.querySelector('.room-card-gallery');if(!gallery)return;
  const fit=()=>{
   if(el.classList.contains('room-body--solo'))return;
   const count=Number(gallery.dataset.seats)||4,cols=count<=8?count:Math.ceil(count/2),rows=count<=8?1:2;
   const box=gallery.getBoundingClientRect(),gap=8;
   const availableW=Math.max(0,box.width-(cols-1)*gap),availableH=Math.max(0,box.height-(rows-1)*12);
   const width=count===20?availableW/cols:Math.min(count<=4?260:230,availableW/cols,availableH/rows*.52);
   const height=count===20?availableH/rows:Math.min(availableH/rows,width/0.52);
   gallery.style.setProperty('--seat-width',Math.max(96,width)+'px');
   gallery.style.setProperty('--seat-height',Math.max(170,height)+'px');
  };
  const resize=new ResizeObserver(fit),mutation=new MutationObserver(fit);resize.observe(gallery);mutation.observe(gallery,{attributes:true,attributeFilter:['data-seats']});fit();
  return()=>{resize.disconnect();mutation.disconnect();};
 },[]);
 return h('div',{ref:host,class:cls,style},children);
}

export function NativeRoomSkin({empty=false,ready=false}){
 const m=useNativeUi(),host=useRef(null),[scale,setScale]=useState({x:1,y:1});
 useEffect(()=>{const el=host.current;if(!el)return;const measure=()=>setScale({x:el.clientWidth/234,y:el.clientHeight/486});const observer=new ResizeObserver(measure);observer.observe(el);measure();return()=>observer.disconnect();},[]);
 if(!m)return h('div',{ref:host,class:'native-room-skin'});
 const source=nativeFind(m.layouts.player_solt_item_room,empty?'/panel_empty':'/panel_player/group_bg');
 const bind=n=>{
  if(n.name==='card_empty'||n.name==='host_toggle'||n.name==='noinfo')return {show:false};
  if(n.name==='top_normal')return {show:!ready};if(n.name==='top_ready')return {show:ready,palette:'mint'};if(n.name==='grad_top')return {show:ready};
  return null;
 };
 return h('div',{ref:host,class:'native-room-skin','aria-hidden':true},h('div',{style:{position:'absolute',width:'234px',height:'486px',left:0,top:0,transform:`scale(${scale.x},${scale.y})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})));
}

export function nativeRectStyle(rect){
 if(!rect)return {display:'none'};
 const a=rect.m_AnchorMin,b=rect.m_AnchorMax,p=rect.m_Pivot,d=rect.m_SizeDelta,v=rect.m_AnchoredPosition,s=rect.m_LocalScale,q=rect.m_LocalRotation;
 return {position:'absolute',left:`calc(${a.x*100}% + ${v.x-p.x*d.x}px)`,top:`calc(${(1-b.y)*100}% + ${-v.y-(1-p.y)*d.y}px)`,width:`calc(${(b.x-a.x)*100}% + ${d.x}px)`,height:`calc(${(b.y-a.y)*100}% + ${d.y}px)`,transformOrigin:`${p.x*100}% ${(1-p.y)*100}%`,transform:`rotate(${-2*Math.atan2(q.z,q.w)*180/Math.PI}deg) scale(${s.x},${s.y})`};
}
/** Overrides bind live state to original node paths; all other geometry comes from the prefab. */
export function NativeNode({node:original,m,bind=()=>null,root=false,animations}){
 if(!original)return null;
 const node=nativeAnimatedNode(original,animations);
 const o=bind(node)||{};if(o.show===false||o.show!==true&&!node.active)return null;
 const st=root?{position:'relative',width:'100%',height:'100%'}:nativeRectStyle(node.rect);
 if(node.alpha!=null)st.opacity=node.alpha;if(node.mask)st.overflow='hidden';
 const image=node.image,sp=image&&m.sprites[image.key];
 let visual=null;
 if(sp&&node.maskGraphic!==false&&!o.hideImage){const color=image.color,material=image.material;const imgStyle={position:'absolute',inset:0,opacity:color?.a??1,pointerEvents:'none'};
  if(material?.imageControl){
   // [ASSUMED] The source UI-FX vertexR/G control dissolve and B carries intensity; matched against source curves
   // and the stable reference frames. Reverse second-dissolve uses scalar coverage rather than the native noise.
   const intensity=Math.max(0,color?.b??material.intensity??1);imgStyle.opacity*=(material.color?.a??1)*Math.min(1,intensity)*(material.revert2&&material.dissolve2?Math.max(0,Math.min(1,color?.g??1)):1);
   if(intensity>1)imgStyle.filter=`brightness(${intensity})`;
  }
  if(material?.dst===1)st.mixBlendMode='plus-lighter';
  // This postprocess material carries literal animated RGB. Dissolve shaders use those channels as control data.
  if(material?.name==='color_mosaic'&&color&&original.image?.color){const base=original.image.color.r;if(base>0)imgStyle.filter=`brightness(${Math.max(0,color.r/base)})`;}
  if(image.type===3){const f=Math.max(0,Math.min(1,image.fill??1)),o=image.fillOrigin||0;
   if(image.fillMethod===0)imgStyle.clipPath=o?`inset(0 0 0 ${(1-f)*100}%)`:`inset(0 ${(1-f)*100}% 0 0)`;
   else if(image.fillMethod===1)imgStyle.clipPath=o?`inset(0 0 ${(1-f)*100}% 0)`:`inset(${(1-f)*100}% 0 0 0)`;
   else if(image.fillMethod===4){const start=[180,90,0,270][o]||0,span=f*360;imgStyle.maskImage=`conic-gradient(from ${image.fillClockwise===false?start-span:start}deg,#000 0deg ${span}deg,transparent ${span}deg)`;}
  }
  const url=image.palette?.[o.palette]||image.url||sp.url;
  if((image.type===1||image.type===2)&&sp.border.some(Boolean)){
   const[l,b,r,top]=sp.border;Object.assign(imgStyle,{borderStyle:'solid',borderColor:'transparent',borderWidth:`${top}px ${r}px ${b}px ${l}px`,borderImageSource:`url("${url}")`,borderImageSlice:`${top} ${r} ${b} ${l} fill`,borderImageRepeat:image.type===2?'repeat':'stretch',boxSizing:'border-box'});
  }else Object.assign(imgStyle,{backgroundImage:`url("${url}")`,backgroundSize:image.type===2?`${sp.size[0]}px ${sp.size[1]}px`:'100% 100%',backgroundRepeat:image.type===2?'repeat':'no-repeat'});
  if(o.tint){delete imgStyle.backgroundImage;Object.assign(imgStyle,{backgroundColor:o.tint,maskImage:`url("${sp.url}")`,maskSize:'100% 100%',maskRepeat:'no-repeat'});}
  visual=h('span',{class:'native-ui-image',style:imgStyle,'aria-hidden':'true'});
 }
 if(node.maskGraphic===false&&sp){st.maskImage=`url("${sp.url}")`;st.maskSize='100% 100%';st.maskRepeat='no-repeat';}
 const text=o.text??node.text?.value;
 if(node.text){const f=node.text.font||{},align=f.m_Alignment??4;Object.assign(st,{display:'flex',alignItems:align<3?'flex-start':align<6?'center':'flex-end',justifyContent:align%3===0?'flex-start':align%3===1?'center':'flex-end',fontSize:(f.m_FontSize||f.m_MaxSize||18)+'px',fontFamily:node.fontName?`"${node.fontName}",sans-serif`:undefined,fontWeight:node.fontName?.includes('Heavy')?900:node.fontName?.includes('Medium')?500:400,lineHeight:1.1,color:rgba(node.text.color),whiteSpace:'nowrap'});}
 Object.assign(st,o.style);
 const Tag=o.onClick?'button':'div';
 return h(Tag,{ref:o.ref,class:'native-ui-node '+(o.class||''),style:st,'data-native-path':node.path,'data-testid':o.testid,onClick:o.onClick,type:o.onClick?'button':undefined,'aria-label':o.label,role:o.role,'aria-selected':o.selected==null?undefined:String(o.selected),disabled:o.disabled},visual,o.content??text,...(o.content===undefined?node.children.map(c=>h(NativeNode,{key:c.path,node:c,m,bind,animations})):[]));
}

const liveNativeText=(n,text)=>({text:String(text),...(n.rect?.m_SizeDelta.x===0?{style:{width:'max-content',translate:`${-100*n.rect.m_Pivot.x}% 0`}}:{})});

/** Personal report slots stay in the original outer-client RectTransforms; portrait uses the vertical flow. */
export function NativePersonalResult({stage,win,rounds}){
 const clipName=win?'auto_chess_settle_game_personal_in_success':'auto_chess_settle_game_personal_in_fail',motion=useNativeAnimation('settle-personal:'+win,clipName);
 const m=useNativeUi(),v=useNativeViewport();if(!m||!motion.clips||v.portrait)return stage;
 const source=nativeFind(m.layouts.auto_chess_settle_game_state,'/personal_view_holder/auto_chess_settle_game_personal_view');if(!source)return stage;
 const parts=[stage.props.children].flat(Infinity).filter(x=>x&&typeof x==='object'),slot=cls=>parts.find(x=>String(x.props?.class||'').split(' ').includes(cls));
 const ops=slot('sops'),cards=[ops?.props.children].flat(Infinity).flatMap(row=>[row?.props?.children].flat(Infinity)).filter(Boolean),level=parts.find(x=>x.type?.name==='LevelStrip'),next=slot('settle__next');
 const clip=motion.clips?.[clipName];
 const bind=n=>{
  const p=n.path;
  if(n.path===source.path)return{show:true};
  if(n.name==='group_fail')return{show:!win};if(n.name==='group_success')return{show:win};
  if(n.name==='blocker')return{show:false};
  if(n.name==='logo_season'&&p.includes('/group_logo_left/'))return{content:parts.find(x=>x.type?.name==='Logo')};
  if(n.name==='part_quit')return{show:false};if(n.name==='part_fail')return{show:!win};if(n.name==='part_success')return{show:win};
  if(p.includes('/container_round/')&&n.name==='text_round')return liveNativeText(n,rounds);
  if(p.includes('/container_round/')&&n.name==='text_title')return{text:t('通过回合')};
  if(n.name==='text_success')return{show:win,text:t('模拟完成')};if(n.name==='text_fail')return{show:!win,text:t('模拟中断')};
  if(n.name==='part_team_logo')return{content:slot('sself__band')};if(n.name==='part_mode')return{content:slot('sself__mode')};
  if(n.name==='container_id_info')return{content:slot('splate')};
  const match=/^auto_chess_settle_game_char_item_(\d+)$/.exec(n.name);if(match)return{content:cards[Number(match[1])-1]||null};
  if(n.name==='container_band')return{content:parts.find(x=>x.type?.name==='BondBar')};
  if(n.name==='group_boss')return{content:slot('sself__medals')};
  if(n.name==='container_left'&&level)return{content:h(level.type,{...level.props,native:true})};
  if(n.name==='btn_next')return{show:true,onClick:next?.props.onClick,ref:next?.ref,label:t('下一步'),class:'native-settle-next'};
  if(n.name==='text_next')return{text:t('下一步')};
  return null;
 };
 const scale=Math.min(v.width/1280,v.height/720);
 // The existing radar intro consumed the first1.5s. The source clip targets the container, not the view holder.
 return h('div',{class:'native-settle-canvas',style:{position:'absolute',left:'50%',top:'50%',width:'1280px',height:'720px',transform:outcomeTransform(scale)}},h(NativeNode,{node:source,m,bind,root:true,animations:clip?[{clip,time:motion.time+1.5,root:source.path+'/container'}]:[]}));
}

/** Original reward→daily→LV ordering and masks, filled by the existing account-progression counters. */
export function NativeSettlementRewards({gain,lv,lv0,daily,bonus,counted,test}){
 const m=useNativeUi();if(!m)return null;
 const source=nativeFind(m.layouts.auto_chess_settle_game_state,'/panel_down/container_left');if(!source)return null;
 const bind=n=>{
  const p=n.path;
  if(n.name==='part_warning')return{show:!counted};
  if(p.includes('/part_warning/')&&n.text)return{text:test?t('测试对局不计入等级'):t('非官方对局不计入等级')};
  if(n.name==='part_reward')return{show:counted};if(n.name==='part_daily')return{show:counted&&!!daily};
  if(p.includes('/part_reward/')&&n.name==='text_num')return liveNativeText(n,gain);
  if(p.includes('/part_reward/')&&n.name==='text_title')return{text:t('获得卫戍认证！')};
  if(n.name==='text_normal_reward')return{text:t('常规获得')};
  if(p.includes('/part_daily/')){
   if(n.name==='daily_task')return{show:bonus>0};if(n.name==='daily_progress')return{show:!(bonus>0)};
   if(n.name==='text_num')return liveNativeText(n,'+'+bonus);
   if(n.name==='text_title'||n.name==='text_daily')return{text:t('每日防卫目标')};
   if(n.name==='text_mun')return{...liveNativeText(n,`${daily?.today||0}/${daily?.need||0}`),content:`${daily?.today||0}/${daily?.need||0}`};
   if(n.name==='fill')return{style:{width:`${Math.min(1,(daily?.today||0)/Math.max(1,daily?.need||1))*100}%`}};
  }
  if(p.includes('/part_progress/')){
   if(n.name==='text_lv')return liveNativeText(n,lv.lv);
   if(n.name==='levelup')return{show:lv.lv>lv0.lv};if(n.name==='max')return{show:lv.max};
   if(n.name==='text_limit')return{...liveNativeText(n,`${lv.into}/${lv.need}`),show:!lv.max,content:`${lv.into}/${lv.need}`};
   if(n.name==='fill')return{style:{width:`${lv.max?100:100*lv.into/Math.max(1,lv.need)}%`}};
  }
  return null;
 };
 return h(NativeNode,{node:source,m,bind,root:true});
}

/** Six-card decision screen; retain the remake's parallel-squad state and the original 307x271 grid. */
export function NativeChoiceLayout({children,count=6,banner=null}){
 const m=useNativeUi(),v=useNativeViewport(),parts=[children].flat(Infinity).filter(x=>x&&typeof x==='object');
 const scale=Math.min(v.width/1280,v.height/720);
 const fallback=()=>h('div',{class:'spov__inner',style:{'--choice-banner-scale':scale}},children,banner);
 if(!m||v.portrait)return fallback();
 const source=m.layouts.autochess_battle_effect_choose_panel;if(!source)return fallback();
 const has=cls=>parts.find(x=>String(x.props?.class||'').split(' ').includes(cls)),header=has('spov__head'),grid=has('spov__grid'),extra=parts.filter(x=>x!==header&&x!==grid);
 const bind=n=>{
  if(n.name==='group_card_big'||n.name==='panel_player_select')return{show:false};
  if(n.name==='group_card_small')return{show:true,content:grid,style:count<=3?{top:'calc(50% - 136px)',height:'271px'}:undefined};
  if(n.name==='group_title')return{content:header};
  if(n.name==='group_tip')return{show:extra.length>0,content:extra,class:'native-choice-groups',style:{left:'16px',top:'130px',width:'156px',height:'540px',overflow:'auto'}};
  return null;
 };
 return h('div',{class:'spov__native-canvas',style:{position:'absolute',left:'50%',top:'50%',width:v.width/scale+'px',height:'720px',transform:`translate(-50%,-50%) scale(${scale})`}},h(NativeNode,{node:source,m,bind,root:true}),banner);
}

export function NativeChoiceCard({children,armed=false,taken=false,busy=false}){
 const m=useNativeUi(),v=useNativeViewport();
 const legacy=[children].flat(Infinity).find(x=>x&&typeof x==='object');
 if(!m||v.portrait)return legacy;
 const source=m.layouts.card_small_item;if(!source)return legacy;
 const parts=[legacy?.props.children].flat(Infinity).filter(x=>x&&typeof x==='object'),has=cls=>parts.find(x=>String(x.props?.class||'').split(' ').includes(cls));
 const bind=n=>{
  if(n.name==='btn_main')return{onClick:legacy?.props.onClick,disabled:legacy?.props.disabled,label:legacy?.props['aria-label']};
  if(n.name==='bg_glow')return{show:armed};if(n.name==='bg_normal')return{show:!taken};if(n.name==='bg_grey'||n.name==='grey_repeat_line')return{show:taken};
  if(n.name==='frame_select')return{show:armed};if(n.name==='group_cost')return{show:false};
  if(n.name==='group_layout')return{content:h('div',{class:'native-choice-copy'},has('spcard__head'),has('spcard__desc'))};
  if(n.name==='group_avatar')return{content:has('spcard__taker')||null};
  if(n.name==='btn_certain')return{show:armed&&!busy,onClick:legacy?.props.onClick,disabled:legacy?.props.disabled,label:t('确认选择'),class:'native-choice-confirm',style:{opacity:1}};
  if(n.name==='text'&&n.path.includes('/btn_certain/'))return liveNativeText(n,t('确认选择'));
  return null;
 };
 return h('div',{class:legacy?.props.class,role:'group','aria-label':legacy?.props['aria-label'],'aria-busy':legacy?.props['aria-busy'],'aria-pressed':legacy?.props['aria-pressed']},h('div',{class:'native-choice-card'},h(NativeNode,{node:source,m,bind,root:true}),busy?has('spcard__busy'):null));
}

export function NativeResultLikeGraphic({on=false}){
 const m=useNativeUi(),motion=useNativeAnimation('result-like:'+on,'auto_chess_settle_game_btn_like_on');if(!m)return null;
 const source=nativeFind(m.layouts.auto_chess_settle_game_player_item,'/container_like/btn_like');if(!source)return null;
 const bind=n=>n.name==='image_off'?{show:!on}:n.name==='image_on'?{show:on,style:!motion.clips?{opacity:1}:undefined}:n.name==='ui_particle'?{show:false}:null;
 return h('span',{class:'native-result-like-graphic'},h(NativeNode,{node:source,m,bind,root:true,animations:on&&motion.clips?[{clip:motion.clips.auto_chess_settle_game_btn_like_on,time:motion.time,root:source.path}]:[]}));
}

export function NativeTeamPlayer({body,player,self,title,onDetail}){
 const m=useNativeUi(),v=useNativeViewport(),motion=useNativeAnimation('team-player:'+player.playerId,'auto_chess_settle_game_player_item_show');
 if(!m||v.portrait)return body;const source=m.layouts.auto_chess_settle_game_player_item;if(!source)return body;
 const parts=[body.props.children].flat(Infinity).filter(x=>x&&typeof x==='object'),slot=cls=>parts.find(x=>String(x.props?.class||'').split(' ').includes(cls)),art=slot('tcard__art');
 const image=[art?.props.children].flat(Infinity).find(x=>String(x?.props?.class||'').includes('tcard__img'));
 const titleNode=[art?.props.children].flat(Infinity).find(x=>String(x?.props?.class||'').includes('tcard__title')),titleIcon=[titleNode?.props.children].flat(Infinity).find(Boolean);
 const like=[slot('tcard__chips')?.props.children].flat(Infinity).find(x=>x?.type?.name==='ResultEndorseButton');
 const bind=n=>{
  const p=n.path;
  if(n.name==='group_char')return{show:true};
  if(n.name==='root'&&p.includes('/group_char/'))return{content:h('div',{class:'native-team-art'},image),style:{position:'absolute',inset:0,left:0,top:0,width:'100%',height:'100%',transform:'none'}};
  if(n.name==='group_normal')return{show:!!player.left};if(n.name==='group_complete')return{show:!player.left};
  if(n.name==='panel_complete')return{show:!player.left};if(n.name==='panel_fail')return{show:false};if(n.name==='panel_quit')return{show:!!player.left};if(n.name==='panel_battle')return{show:false};
  if(p.includes('/group_round/')&&n.text)return liveNativeText(n,/num|round/.test(n.name)?player.roundsPassed:player.left?t('连接中断'):t('通过回合'));
  if(n.name==='group_title')return{show:!!title};if(n.name==='group_title_checking'||n.name==='group_report'||n.name==='panel_self_like')return{show:false};
  if(n.name==='panel_title'&&p.includes('/group_title/'))return{style:{display:'flex',alignItems:'center',justifyContent:'center',gap:'4px',width:'max-content',translate:'-50% 0'}};
  if(n.name==='title_icon')return{content:titleIcon,style:{position:'relative',left:'auto',top:'auto',width:'36px',height:'36px',transform:'none'}};
  if(n.name==='text_title'&&p.includes('/group_title/'))return{text:title?.name||'',style:{position:'relative',left:'auto',top:'auto',width:'max-content',fontSize:'28px',transform:'none'}};
  if(n.name==='root_card')return{content:slot('tcard__plate')};if(n.name==='bg_self'||n.name==='self_icon')return{show:self};if(n.name==='bg_back')return{show:!self};
  if(n.name==='container_like')return{show:!self&&!!like,content:like};
  if(n.name==='panel_others')return{show:true};
  if(n.name==='btn_add'||n.name==='btn_send')return{show:false};if(n.name==='btn_friend')return{show:true,onClick:onDetail,label:t('数据详情')};
  return null;
 };
 return h('article',{class:body.props.class+' native-team-player',style:body.props.style},h(NativeNode,{node:source,m,bind,root:true,animations:motion.clips?[{clip:motion.clips.auto_chess_settle_game_player_item_show,time:motion.time,root:source.path}]:[]}));
}

export function NativeTeamResult({stage,r,rounds,backLabel}){
 const m=useNativeUi(),v=useNativeViewport(),motion=useNativeAnimation('team-results','auto_chess_settle_game_teamshow_in');
 if(!m||v.portrait)return stage;
 const source=nativeFind(m.layouts.auto_chess_settle_game_state,'/team_view_holder/auto_chess_settle_game_team_view');if(!source)return stage;
 const parts=[stage.props.children].flat(Infinity).filter(x=>x&&typeof x==='object'),slot=cls=>parts.find(x=>String(x.props?.class||'').split(' ').includes(cls)),outcome=slot('steam__outcome'),tags=[outcome?.props.children].flat(Infinity).find(x=>String(x?.props?.class||'').includes('steam__tags'));
 const back=slot('settle__back'),detail=slot('steam__detail'),rows=[slot('steam__when')?.props.children].flat(Infinity).filter(Boolean),backNode=String(backLabel).includes('同盟')?'btn_r_back_room':'btn_r_back_home';
 const bind=n=>{
  const p=n.path;if(n.path===source.path)return{show:true};
  if(n.name==='panel_success')return{show:r.victory};if(n.name==='panel_fail')return{show:!r.victory};if(n.name==='panel_quit')return{show:false};
  if(n.name==='goup_main')return{content:slot('steam__cards')};
  if(n.name==='logo_season')return{content:parts.find(x=>x.type?.name==='Logo')};
  if(n.name==='group_report'||n.name==='container_round_quit')return{show:false};
  if(n.name==='container_round')return{show:true};
  if(n.name==='text_success')return{show:r.victory,text:t('模拟完成')};if(n.name==='text_fail')return{show:!r.victory,text:t('模拟中断')};if(n.name==='text_quit')return{show:false};
  if(n.name==='round_success_sp')return{show:r.victory&&r.hiddenCleared};if(n.name==='round_success')return{show:r.victory&&!r.hiddenCleared};if(n.name==='round_fail')return{show:!r.victory};
  if(p.includes('/container_round/')&&n.name==='text_num')return liveNativeText(n,rounds);
  if(p.includes('/container_round/')&&n.name==='text_info')return{text:t('同盟通过回合')};
  if(n.name==='container_time')return{content:rows[0]};if(n.name==='container_date')return{content:rows[1]};
  if(/^btn_r_/.test(n.name))return{show:n.name===backNode,onClick:back?.props.onClick,ref:back?.ref,label:backLabel,class:'native-team-back'};
  if(n.name==='btn_l_home')return{show:true,onClick:detail?.props.onClick,label:t('数据详情'),class:'native-team-report-full'};
  if(p.includes('/panel_btn/')&&n.name==='text_info')return liveNativeText(n,p.includes('/btn_l_home/')?t('数据详情'):backLabel);
  return null;
 };
 const scale=Math.min(v.width/1280,v.height/720);
 return h('div',{class:'native-settle-canvas native-team-canvas',style:{position:'absolute',left:'50%',top:'50%',width:'1280px',height:'720px',transform:outcomeTransform(scale)}},h(NativeNode,{node:source,m,bind,root:true,animations:motion.clips?[{clip:motion.clips.auto_chess_settle_game_teamshow_in,time:motion.time,root:source.path+'/container'}]:[]}),h('div',{class:'native-team-mode'},tags),slot('steam__slot'));
}

/** Original final-assault/core/end panels. The owner keeps the field usable during these presentation clips. */
export function NativeBossPlate({children,kind,rows=[],total=0,bossIcon,hiddenIcon,myId}){
 const m=useNativeUi(),v=useNativeViewport();
 const multi=kind==='final'&&rows.length>1,clipName=kind==='final'?(multi?'panel_team_boss_start_in_02':'panel_single_boss_start_in'):kind==='core'?'panel_boss_sp_start_in':kind==='allClear'?'battle_win_all_boss':kind==='coreFail'?'battle_lose_break_one_boss':'battle_lose_all_out';
 const motion=useNativeAnimation('boss-plate:'+kind);
 // Larger fan rooms keep the existing variable-row presentation; the original has only 2/3/4-player branches.
 if(!m||!motion.clips||v.portrait||rows.length>4)return children;
 const source=m.layouts[kind==='final'?(multi?'multi_boss_prepare_dialog':'single_boss_prepare_dialog'):kind==='core'?'hidden_boss_prepare_dialog':kind==='allClear'?'panel_win_all_boss':kind==='coreFail'?'panel_lose_break_one_boss':'panel_lose_all_out'];
 if(!source)return children;
 const branch=rows.length===2?'group_team_02':rows.length===3?'group_team_03':'group_team';
 const bind=n=>{
  const p=n.path;
  if(kind==='final'&&n.name==='icon_boss_large')return{tint:'#ff7b22'};
  if(/^group_team(?:_0[23])?$/.test(n.name))return{show:multi&&n.name===branch};
  const slot=/^panel_mumber_0([1-4])$/.exec(n.name);
  if(slot){const row=rows[Number(slot[1])-1];return{show:!!row,content:row?h(NativeBossPlayer,{m,row,self:row.player?.playerId===myId}):null};}
  if(n.name==='text_blood')return liveNativeText(n,total);
  if(n.name==='bg'&&(p.includes('/boss_info/')||p.includes('/boss_info_sp/'))){const icon=p.includes('/boss_info_sp/')?(hiddenIcon||bossIcon):bossIcon;return{content:icon?h('img',{src:icon,alt:'',class:'native-boss-portrait',draggable:false}):null};}
  if(n.name==='text_desc')return{...liveNativeText(n,kind==='final'?t('合力击败敌方领袖！'):kind==='core'?t('隐秘核心已解锁'):kind==='coreFail'?t('未能击破隐秘核心'):t('模拟中断')),class:'native-boss-title'};
  if(n.name==='text_title')return{...liveNativeText(n,kind==='core'?t('挑战失败不影响最终结算'):t('最终攻势')),class:'native-boss-subtitle'};
  return null;
 };
 // [ASSUMED] Start the second source clip when the first completes; the Unity controller's transition is unavailable.
 const first=motion.clips.panel_team_boss_start_in_01,secondAt=nativeClipDuration(first);
 const animations=multi?[{clip:first,time:motion.time,root:source.path},...(motion.time>=secondAt?[{clip:motion.clips[clipName],time:motion.time-secondAt,root:source.path}]:[])]:[{clip:motion.clips[clipName],time:motion.time,root:source.path}];
 const legacy=[children].flat(Infinity).find(x=>x&&typeof x==='object'),scale=Math.min(v.width/1280,v.height/720);
 return h('div',{...legacy?.props,class:(legacy?.props.class||'')+' bpl--native',children:undefined},h('div',{class:'native-boss-canvas',style:{width:'1280px',height:'720px',transform:outcomeTransform(scale)}},h(NativeNode,{node:source,m,bind,root:true,animations})));
}

function NativeBossPlayer({m,row,self}){
 const source=m.layouts.boss_prepare_player_item;if(!source)return null;
 const bind=n=>n.name==='avatar_container'?{content:row.avatar}:n.name==='mine'?{show:self}:n.name==='text_blood'?liveNativeText(n,row.lp):null;
 return h('div',{class:'native-boss-player'},h(NativeNode,{node:source,m,bind,root:true}));
}

/** Original difficulty-vehicle hierarchy: all parts share the source perspective and animation clock. */
export function NativeSimulationHologram({difficulty,solo=false,fallback}){
 const m=useNativeUi('difficulty'),mode=({FUNNY:'funny',NORMAL:'normal',HARD:'hard',ABYSS:'abyss'})[difficulty]||'normal';
 const vehicleClips=useNativeClips('difficulty'),host=useRef(null),[size,setSize]=useState({width:660,height:440});
 useEffect(()=>{
  const el=host.current;if(!el)return;
  const observer=new ResizeObserver(()=>{const width=el.clientWidth,height=el.clientHeight;setSize(old=>old.width===width&&old.height===height?old:{width,height});});
  observer.observe(el);return()=>observer.disconnect();
 },[m]);
 const page=m?.layouts?.auto_chess_mode_choice_state,parent=page&&nativeFind(page,'/auto_chess_mode_choice_bg_left'),source=parent?.children.find(n=>n.name===mode);
 const show=vehicleClips?.['auto_chess_mode_choice_'+mode+'_show'],cycle=vehicleClips?.['auto_chess_mode_choice_'+mode+'_loop'];
 useEffect(()=>{
  const stage=host.current?.querySelector('.native-vehicle-stage');if(!stage||!source||!show||!cycle)return;
  const motion=playNativeVehicleMotion(stage,source,show,cycle,parent.path,{reduced:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});
  const sync=()=>{if(document.hidden)motion.pause();else motion.resume();};document.addEventListener('visibilitychange',sync);sync();
  return()=>{document.removeEventListener('visibilitychange',sync);motion.destroy();};
 },[source,show,cycle,solo]);
 if(!source)return fallback;
 const scale=Math.min(size.width/880,size.height/600),animations=show?[{clip:show,time:Infinity,root:parent.path}]:undefined;
 const beam=m.sprites.com_link_line_white_7763798395937189241?.url;
 const bind=n=>{
  if(n.path===source.path)return{show:true};
  // The source grid/flow use Unity-only shaders. Keep their source geometry; approximate flow with the original mask.
  if(n.name==='ui_particle'&&n.path.includes('/group_id_card/'))return{show:true,content:h('span',{class:'native-vehicle-avatar',style:{backgroundImage:`url("/assets/ui/native-autochess/vehicle-avatar-${mode}.png")`}})};
  if(n.name==='back_grid'||n.name==='img_desc_text'||n.name==='ui_particle'||n.name==='line_black'||n.name==='line_color')return{show:false};
  if(n.name==='line_main')return{content:h('span',{class:'native-vehicle-uplink',style:{maskImage:`url("${beam}")`}})};
  if(n.name==='img_light')return{class:'native-vehicle-uplink-glow'};
  if(solo&&(n.name==='root_left'||n.name==='root_right'))return{show:false};
  if(solo&&/^chess_\d+$/.test(n.name)&&n.name!==(n.path.includes('/bottom_01/')?'chess_01':mode==='funny'?'chess_05':'chess_07'))return{show:false};
  return null;
 };
 return h('div',{ref:host,class:'ship-scene native-vehicle-scene','data-vehicle-mode':mode,role:'img','aria-label':'RHODES ISLAND'},
  h('div',{class:'native-vehicle-grid','aria-hidden':true}),
  h('div',{class:'native-vehicle-stage',style:{transform:`translate(${-440*scale}px,${-300*scale}px) scale(${scale})`}},h(NativeNode,{node:source,m,bind,root:true,animations})));
}

/** The source difficulty drawer, keeping real room/create callbacks and the remake's optional test switch. */
export function NativeDifficultyDrawer({children,title,options,actions,onClose,transparent=false}){
 const m=useNativeUi('difficulty'),v=useNativeViewport(),motion=useNativeAnimation('mode-drawer','auto_chess_mode_select_in',false,'difficulty');
 const source=m?.layouts?.auto_chess_mode_choice_pop_view;
 if(!source||v.portrait)return h('div',{class:'difficulty-drawer-fallback'},h('header',null,h('button',{type:'button',onClick:onClose},t('返回')),h('h2',null,title)),options,actions);
 const optionParts=[options?.props?.children].flat(Infinity),pool=v.width>=1000?optionParts.find(n=>n?.props?.class==='native-difficulty-pool'):null;
 const nativeOptions=pool?h(options.type,{...options.props,children:optionParts.filter(n=>n!==pool)}):options;
 const bind=n=>{
  if(n.name==='blank_hotspot'||transparent&&n.name==='bg_black')return{show:false};
  if(n.name==='text_title'&&n.path.endsWith('/container/text_title'))return{text:title};
  if(n.name==='scroll_mode')return{content:nativeOptions,style:{overflow:'auto',touchAction:'pan-y'}};
  if(n.name==='btn_range_switch'||n.name==='btn_range_switch_team_root')return{show:false};
  if(n.name==='btn_matching')return{content:h('div',{class:'native-difficulty-action'},h(NativeNode,{node:n.children.find(c=>c.name==='bg'),m,root:true}),actions)};
  return null;
 };
 const scale=Math.min(v.width/1280,v.height/720);
 return h('div',{class:'native-difficulty-canvas',style:{width:'1280px',height:'720px',transform:`translate(-50%,-50%) scale(${scale})`}},children,h(NativeNode,{node:source,m,bind,root:true,animations:motion.clips?[{clip:motion.clips.auto_chess_mode_select_in,time:motion.time,root:source.path+'/container'}]:[]}),pool,h('button',{class:'native-difficulty-back',type:'button',onClick:onClose,'aria-label':t('返回')},'‹'));
}

export function NativeDifficultyCard({children,selected=false,name,info,icon}){
 const m=useNativeUi('difficulty'),v=useNativeViewport(),motion=useNativeAnimation('difficulty-card:'+selected,selected?'auto_chess_mode_select_btn_select_on':'auto_chess_mode_select_btn_select_off',false,'difficulty');
 if(!m||v.portrait)return children;
 const source=m.layouts.auto_chess_mode_choice_item_view;if(!source)return children;
 const bind=n=>{
  const p=n.path;
  if(n.name==='group_lock')return{show:false};if(n.name==='select_glow'||n.name==='select_icon')return{show:selected};
  if(n.name==='icon'&&p.includes('/grou_title/'))return{content:icon};
  if(n.name==='text_title')return{text:p.includes('/select_icon/')?t('已选定'):name};
  if(n.name==='text_tips')return{text:info.desc,style:v.width>=1000||v.touch&&v.width<=1000?{fontSize:'20px'}:undefined};
  if(n.name==='text_info')return{text:info.effects.map(e=>'· '+e).join('\n'),style:{whiteSpace:'pre-line',alignItems:'flex-start',fontSize:v.width>=1000?'20px':v.touch&&v.width<=1000?'22px':'16px'}};
  if(n.name==='hotspot')return{onClick:children.props.onClick,disabled:children.props.disabled,label:name};
  return null;
 };
 return h('div',{class:children.props.class+' native-difficulty-card',role:'radio','aria-checked':selected?'true':'false','data-difficulty':children.props['data-difficulty'],title:[info.desc,...info.effects,info.stageNote].filter(Boolean).join('\n')},h(NativeNode,{node:source,m,bind,root:true,animations:motion.clips?[{clip:motion.clips[selected?'auto_chess_mode_select_btn_select_on':'auto_chess_mode_select_btn_select_off'],time:motion.time,root:source.path+'/container'}]:[]}));
}

/** Original card texture/decorations beneath the live portrait and labels. */
export function NativeShopCardBackground({item=false}){
 const m=useNativeUi(),host=useRef(null),[scale,setScale]=useState(1);
 useLayoutEffect(()=>{const el=host.current;if(!el)return;const update=()=>setScale(el.clientHeight/175);const observer=new ResizeObserver(update);observer.observe(el);update();return()=>observer.disconnect();},[]);
 const source=m&&nativeFind(m.layouts.autochess_shop_card_item,item?'/group_equip':'/group_char');
 const bind=n=>n===source||item&&n.name==='root_name'?null:{show:['bg','bg_deco','repeat_line',...(item?['icon']:[])].includes(n.name)};
 return h('span',{ref:host,class:'scard__native-background','aria-hidden':true},source?h('span',{style:{position:'absolute',left:0,top:0,width:'158px',height:'175px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})):null);
}

/** Full unfolded 111x175 card. Keep the complete normal hierarchy visible even when funds are insufficient. */
export function NativeShopUpgrade({level,max=false,armed=false}){
 const m=useNativeUi(),host=useRef(null),[scale,setScale]=useState(1);
 useLayoutEffect(()=>{const el=host.current;if(!el)return;const update=()=>setScale(el.clientHeight/175);const observer=new ResizeObserver(update);observer.observe(el);update();return()=>observer.disconnect();},[]);
 const source=m&&nativeFind(m.layouts.autochess_shop,'/group_upgrade/group_normal');
 const label=max?t('已满级'):armed?t('确认升级'):t('升级');
 const bind=n=>{
  if(['root_fx','hotspot_normal','text_num_after','icon'].includes(n.name))return{show:false};
  if(n.name==='root_double_check')return{show:armed&&!max};
  if(n.name==='text_num_before')return{text:String(level)};
  if(n.name==='text_tip')return{show:!armed||max,text:label};
  if(n.name==='text_double_check')return{show:armed&&!max,text:label};
  return null;
 };
 return h('span',{ref:host,class:'lvcard__native','aria-hidden':true},source?
  h('span',{style:{position:'absolute',inset:0,width:'111px',height:'175px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})):
  h('span',{class:'lvcard__fallback'},h('small',null,'LEVEL'),h('b',null,level),h('span',null,label)));
}

/** Centre the numeral ink inside the original money capsule, independently of CSS font leading. */
export function NativeShopFunds({value}){
 const host=useRef(null),[scale,setScale]=useState(1),text=String(value);
 useLayoutEffect(()=>{const el=host.current;if(!el)return;const update=()=>setScale(el.clientWidth/58);const observer=new ResizeObserver(update);observer.observe(el);update();return()=>observer.disconnect();},[]);
 return h('span',{ref:host,class:'native-shop-funds'},
  h('span',{class:'native-shop-funds__text','aria-hidden':true},text),
  h('span',{style:{position:'absolute',inset:0,width:'58px',height:'28px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNumber,{parts:[text],width:58,height:28,size:Math.max(10,Math.min(28,78/text.length)),color:'#f8c62b'})));
}

export function NativeShopPrice({value,poor=false,tone='gold',class:cls='',title}){
 const m=useNativeUi(),fallbackScale=useNativeScale(),host=useRef(null),[scale,setScale]=useState(fallbackScale),source=m&&nativeFind(m.layouts.autochess_shop_cost_item,poor?'/root_grey':'/root_normal');
 useLayoutEffect(()=>{
  const el=host.current,shop=el?.closest('.shopbar');
  const update=()=>{const card=el?.closest('.scard')||shop?.querySelector('.scard');const size=card?parseFloat(getComputedStyle(card).height)/175:fallbackScale;if(size>0)setScale(size);};
  const observer=new ResizeObserver(update),card=el?.closest('.scard');
  if(shop)observer.observe(shop);if(card)observer.observe(card);update();
  return()=>observer.disconnect();
 },[fallbackScale]);
 if(!source)return h('span',{ref:host,class:cls,title},value);
 const bind=n=>n.path===source.path?{show:true}:n.name==='text_num'?{style:{translate:'0 4px'},content:h(NativeNumber,{parts:[String(value)],width:22,height:26,size:Math.min(22,36/String(value).length),color:!poor&&tone==='discount'?'#52dfb7':!poor&&tone==='premium'?'#ff8768':rgba(n.text?.color)})}:null;
 return h('span',{ref:host,class:'native-shop-price '+cls,title,style:{width:44*scale+'px',height:35*scale+'px'}},h('span',{style:{position:'absolute',inset:0,width:'44px',height:'35px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})));
}

/** Presentation follows the real room.matchNow request; the source's unsupported region/cancel controls stay hidden. */
export function NativeMatchingBanner({state='pending'}){
 const m=useNativeUi(),v=useNativeViewport(),name=state==='success'?'banner_success_view_in':state==='failed'?'banner_fail_view_in':'banner_matching_in',motion=useNativeAnimation('matching:'+state,name);
 const title=state==='success'?t('匹配成功'):state==='failed'?t('匹配失败，请重试'):t('正在匹配…');
 const source=m?.layouts?.auto_chess_matching;if(!source)return h('div',{class:'matching-status-fallback',role:'status'},title);
 const group=state==='pending'?'banner_matching':state==='success'?'banner_success_view':'banner_fail_view';
 const bind=n=>{
  if(['banner_matching','banner_success_view','banner_fail_view'].includes(n.name))return{show:n.name===group};
  if(['btn_stop','matching_type','text_time'].includes(n.name))return{show:false};
  if(n.name==='text_title'||n.name==='text_info')return liveNativeText(n,title);
  if(n.name==='text_tips')return{text:state==='success'?t('正在进入同盟'):state==='failed'?t('请重新选择房间后重试'):t('正在寻找可加入的同盟')};
  return null;
 };
 const scale=Math.min(v.width/1280,v.height/720);
 return h('div',{class:'native-match-canvas',role:'status','aria-label':title,style:{width:'1280px',height:'720px',transform:`translate(-50%,-50%) scale(${scale})`}},h(NativeNode,{node:source,m,bind,root:true,animations:motion.clips?[{clip:motion.clips[name],time:motion.time,root:source.path+'/'+group}]:[]}));
}

export function NativeShopEmpty(){
 const m=useNativeUi(),fallbackScale=useNativeScale(),host=useRef(null),[scale,setScale]=useState(fallbackScale);
 useLayoutEffect(()=>{const card=host.current?.closest('.scard');if(!card)return;const update=()=>setScale(parseFloat(getComputedStyle(card).height)/175);const observer=new ResizeObserver(update);observer.observe(card);update();return()=>observer.disconnect();},[m]);
 if(!m?.layouts?.autochess_shop_card_item)return null;
 const bind=n=>n.name==='state_empty'?{show:true}:n.name==='panel_main'?{show:false}:null;
 return h('span',{ref:host,class:'native-shop-empty','aria-hidden':true},h('span',{style:{position:'absolute',left:0,top:0,width:'158px',height:'175px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:m.layouts.autochess_shop_card_item,m,bind,root:true})));
}

export function NativeTopCenter({pub,hud,lp,pending:loss=0,miss=null,btn,pen,onLeft,onRight,drawer,transition}){
 const m=useNativeUi(),scale=useNativeScale(),motion=useNativeAnimation('hud:'+(pub?.wavePrelude?.targetPhase||pub?.phase));if(!m)return null;
 const shownPhase=pub?.wavePrelude?.targetPhase||pub?.phase;
 const root=nativeFind(m.layouts.autochess_hud_panel,'/player_info_view'),combat=[PHASE.COMBAT,PHASE.UNITE,PHASE.SETTLE].includes(shownPhase),boss=[PHASE.FINAL_ASSAULT,PHASE.HIDDEN_CORE].includes(shownPhase),coop=shownPhase===PHASE.UNITE;
 const hp=h('div',{class:'native-hud-row native-hud-hp'},h('img',{src:'/assets/ui/hudPanel/icon_hp.png',alt:'',width:12,height:19}),h(NativeNumber,{parts:[String(lp)],width:Math.max(24,String(lp).length*15),height:20}),loss>0?h('b',{class:'native-hud-loss'},'−'+loss):null);
 const round=h('div',{class:'native-hud-row native-hud-round'},h('span',null,t('回合')),h('b',{class:'native-hud-roundnum'},h(NativeNumber,{parts:[String(pub?.round??1)],color:'#141a17'})));
 const killed=h(NativeNumber,{parts:[{text:String(hud?.resolved??hud?.killed??0),color:'#ff7633'},'/'+String(hud?.total??'--')],width:110.76,height:34.45});
 const bind=n=>{
  const p=n.path;
  if(p.endsWith('/root_frame/group_normal'))return {show:!boss,style:{width:'482px',height:'56px',left:'calc(50% - 241px)',top:'calc(50% - 28px)'},content:h(NativeHudFrame,{m,scale})};if(p.endsWith('/root_frame/group_boss'))return {show:boss};
  if(p.endsWith('/group_mid_screen/group_rest'))return {show:!combat&&!boss};
  if(p.endsWith('/group_mid_screen/group_battle'))return {show:combat&&!coop&&!boss};
  if(p.endsWith('/group_mid_screen/group_coop'))return {show:coop&&!boss};
  if(p.endsWith('/group_mid_screen/group_boss'))return {show:boss};
  if(p.endsWith('/pc_key_holder'))return {show:false};
  if(!motion.clips&&['group_trans','fx_trans','bg_trans'].includes(n.name))return {show:false};
  if(p.endsWith('/group_hud/root_round'))return {show:!boss,content:round};if(p.endsWith('/group_hud/root_hp'))return {content:hp};
  if(p.endsWith('/group_rest/root_mask/group_normal/text'))return {text:pub?.phase===PHASE.PREP?t('休息一下'):t('准备阶段')};
  if(p.endsWith('/group_normal/text_num'))return {content:killed,style:{top:'calc(50% - 14.235px)'}};
  if(n.name==='tag_miss')return {show:Number.isFinite(miss)};if(p.endsWith('/tag_miss/text_num'))return {text:miss};
  if(p.endsWith('/group_boss/group_normal/root_num/text_num'))return {text:`${hud?.resolved??0}/${hud?.total??'--'}`};
  if(p.endsWith('/root_bar/bar_fill')){const b=hud?.boss||pub?.bossHp;return {style:{width:`${187*Math.max(0,Math.min(1,b?.max?b.hp/b.max:1))}px`}};}
  if(p.endsWith('/btn_check_player'))return {onClick:onLeft,label:btn.left.label,testid:'check-player'};
  if(p.endsWith('/btn_check_enemy'))return {onClick:onRight,label:btn.right.label,testid:'check-enemy',disabled:btn.right.grey&&!pen};
  if(p.includes('/btn_check_player/')){if(n.name==='img_normal')return {show:!pen&&!drawer};if(n.name==='img_back')return {show:pen};if(n.name==='img_grey')return {show:!pen&&!!drawer};}
  if(p.includes('/btn_check_enemy/')){if(n.name==='img_normal')return {show:!btn.right.grey};if(n.name==='img_grey')return {show:btn.right.grey};}
  return null;
 };
 const clip=boss?'trans_boss':coop?'trans_coop':combat?'trans_battle':'trans_rest';
 const animations=[{clip:motion.clips?.[clip],time:transition?.kind?motion.time:Infinity,root:root.path+'/group_hud'}];
 return h('div',{class:'native-hud-center','data-testid':'native-top-center',style:{transform:`translateX(-50%) scale(${scale})`}},h(NativeNode,{node:root,m,bind,root:true,animations}));
}

export function NativePhasePlate({kind='help',title,sub,loss=0}){
 const m=useNativeUi(),scale=useNativeScale(),motion=useNativeAnimation(kind);if(!m)return null;
 const source=kind==='help'?nativeFind(m.layouts.help_battle_dialog,'/container'):nativeFind(m.layouts.round_result_dialog,kind==='perfect'?'/panel_perfect':'/panel_miss');
 const bind=n=>{
  if(n.name==='panel_back'||n.name==='ui_particle'||n.name==='ui_particle_02')return {show:false};
  if(n.name==='panel_perfect')return {show:kind==='perfect'};if(n.name==='panel_miss')return {show:kind==='miss'};
  if(n.name==='text_title')return {text:title};if(n.name==='text_desc')return {text:sub||'',style:{width:'max-content'}};
  if(n.name==='text_blood')return {text:loss};if(n.name==='blood_icon')return {show:loss>0};
  if(n.name==='mask_tile')return {show:false};
  return null;
 };
 const clip=kind==='help'?'help_battle_dialog':'round_result_dialog_'+kind,loop=kind==='help'?'help_battle_dialog_emoji_loop':'round_result_dialog_'+kind+'_emoji_loop';
 const animations=[{clip:motion.clips?.[clip],time:motion.time,root:source.path},{clip:motion.clips?.[loop],time:motion.time,root:source.path+'/panel_left/emoji',loop:true}];
 return h('div',{class:'native-phase-canvas native-phase-result',style:{transform:outcomeTransform(scale)}},h(NativeNode,{node:source,m,bind,root:true,animations}));
}

export function NativeLayersDisabled(){
 const m=useNativeUi(),scale=useNativeScale();if(!m)return null;
 const node=nativeFind(m.layouts.autochess_hud_panel,'/root_pause');
 return h('div',{class:'native-layers-disabled',role:'status',style:{transform:`translateX(-50%) scale(${scale})`}},h(NativeNode,{node,m,root:true,bind:n=>n.name==='text_pause'?{text:t('层数叠加已禁用')}:null}));
}

/** The briefing has its own full glow disc, without the battle stack counter or segmented progress ring. */
export function NativeInfoBond({name='',icon,disabled=false,density=1}){
 const m=useNativeUi(),viewport=useNativeViewport(),scale=(viewport.portrait ? .68 : Math.min(1.36,viewport.width/1440,viewport.height/810))*density;if(!m)return null;
 const source=m.layouts.prefab_auto_chess_stage_info_bond_item;
 const bind=n=>{
  if(n.name==='panel_tutorial'||n.name==='panel_bkg')return {show:false};
  if(n.name==='panel_normal')return {show:!disabled};
  if(n.name==='panel_banned')return {show:disabled};
  if(n.name==='text_name')return {text:name,style:{fontSize:'22px'}};
  if(n.name==='img_icon')return {style:{width:'82px',height:'82px',left:'calc(50% - 41px)',top:'calc(50% - 56px)'},content:icon?h('i',{style:{display:'block',width:'100%',height:'100%',maskImage:`url("${icon}")`,maskPosition:'center',maskSize:'contain',maskRepeat:'no-repeat',background:disabled?'#b5b8b7':'#031b16'}}):null};
  return null;
 };
 return h('div',{class:'native-info-bond',style:{width:110*scale+'px',height:160*scale+'px'}},h('div',{style:{position:'absolute',inset:0,width:'110px',height:'160px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})));
}

/** Reuse the original stage-info heading strip; layout-controlled text gets its live preferred width. */
export function NativeInfoTitle({kind='enemy',title}){
 const m=useNativeUi(),viewport=useNativeViewport(),scale=viewport.portrait ? .7 : Math.min(viewport.width/1280,viewport.height/720);
 const key=kind==='core'?'temp_bond':kind==='addon'?'perm_bond':kind==='banned'?'chess_banned':'enemy';
 const measured=useRef(null),[availableWidth,setAvailableWidth]=useState(viewport.width);
 useEffect(()=>{const el=measured.current;if(!el)return;const observer=new ResizeObserver(()=>setAvailableWidth(el.clientWidth));observer.observe(el);setAvailableWidth(el.clientWidth);return()=>observer.disconnect();},[m]);
 const source=m?.layouts['prefab_auto_chess_stage_info_'+key+'_title'];if(!source)return null;
 const bind=n=>{
  if(n.name==='img_bkg')return {style:{left:'37px',width:'calc(100% - 74px)'}};
  if(n.name==='img_bkg_2')return {style:{left:0,width:'100%'}};
  if(n.name==='img_icon')return {style:{left:'50px'}};
  if(n.name==='panel_title')return {content:title,style:{left:'98px',width:'calc(100% - 150px)',fontSize:'24px',lineHeight:'30px',fontWeight:500,color:'#eee'}};
  if(n.name==='text_title')return {text:title,style:{width:'max-content'}};
  if(n.name==='panel_tip'||n.name==='panel_tutorial')return {show:false};
  return null;
 };
 return h('div',{ref:measured,class:'native-info-title',role:'heading','aria-level':3,'aria-label':title,style:{height:(source.rect?.m_SizeDelta.y||72)*scale+'px'}},h('div',{style:{position:'absolute',left:viewport.portrait?0:'50%',top:0,width:availableWidth/scale+'px',height:(source.rect?.m_SizeDelta.y||72)+'px',transform:viewport.portrait?`scale(${scale})`:`translateX(-50%) scale(${scale})`,transformOrigin:viewport.portrait?'0 0':'50% 0'}},h(NativeNode,{node:source,m,bind,root:true})));
}

/** Original prepare-page decorations and screen-line texture shared by information and strategy screens. */
export function NativeOuterBackground() {
 const m = useNativeUi();
 const scale = useNativeScale();
 const clips = useNativeClips();
 const host = useRef(null);
 const source = m?.layouts.prefab_auto_chess_prepare_page_bkg;
 const group = source && nativeFind(source, '/group_bkg');
 const loop = clips?.autochess_com_bkg_anim_loop;
 useEffect(() => {
  if (!host.current || !source || !group || !loop) return;
  const playback = playNativeVehicleMotion(host.current, source, null, loop, group.path,
   { reduced: globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches });
  const sync = () => document.hidden ? playback.pause() : playback.resume();
  document.addEventListener('visibilitychange', sync);
  sync();
  return () => { document.removeEventListener('visibilitychange', sync); playback.destroy(); };
 }, [source, group, loop]);
 if (!source) return null;
 const bind = node => ['ui_particle','screen_line_flow_light'].includes(node.name) ? {show:false} : null;
 return h('div',{ref:host,class:'native-outer-background','aria-hidden':true},
  h('div',{style:{position:'absolute',left:'50%',top:'50%',width:'1280px',height:'720px',
   transform:`translate(-50%,-50%) scale(${scale})`}},h(NativeNode,{node:source,m,bind,root:true})));
}

/** Original hourglass outline, two sand reservoirs and the original two-second flip/fill clip. */
export function NativeDecisionHourglass({label=true}){
 const m=useNativeUi(),motionClips=useNativeClips(),host=useRef(null),source=m&&nativeFind(m.layouts.prefab_auto_chess_band_choose_player_card_item,'/group_player_condition/selecting'),clip=motionClips?.band_choose_player_selecting;
 useEffect(()=>{if(!host.current||!source||!clip)return;const play=playNativeVehicleMotion(host.current,source,null,clip,source.path,{reduced:globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches});const sync=()=>document.hidden?play.pause():play.resume();document.addEventListener('visibilitychange',sync);sync();return()=>{document.removeEventListener('visibilitychange',sync);play.destroy();};},[source,clip]);
 if(!source)return h('span',{class:'native-decision-clock'});
 const bind=n=>n.path===source.path?{show:true}:n.name==='selecting_back'?{show:label}:n.name==='text_selecting'?{show:label,content:t('决策中'),style:{fontSize:'14px',display:'flex',justifyContent:'center',alignItems:'center',color:'#eee'}}:n.name==='sand_drop'?{content:h('i',{class:'decision-sand-grains'})}:null;
 return h('span',{ref:host,class:'native-decision-clock'+(label?'':' is-compact'),'aria-hidden':!label},h('div',{class:'native-decision-clock__source'},h(NativeNode,{node:source,m,bind,root:true})));
}

export function NativeStrategyTile({icon,selected=false,taken=false,ownerName='',native=false}){
 const m=useNativeUi(),viewport=useNativeViewport(),screenScale=Math.min(viewport.width/1280,viewport.height/720),scale=viewport.portrait ? .72 : native?1:screenScale;if(!m)return null;
 const bind=n=>{
  if(n.name==='team_icon')return {content:icon?h('img',{src:icon,alt:'',style:{width:'100%',height:'100%',objectFit:'contain'}}):null};
  if(n.name==='selected_self')return {show:selected&&!taken};
  if(n.name==='selected_teammate')return {show:taken};
  if(n.name==='text_selected_teammate')return {text:ownerName||t('队友已选')};
  if(n.name==='victor_mark'||n.name==='panel_new')return {show:false};
  return null;
 };
 return h('span',{class:'native-strategy-tile',style:native?{width:'100%',height:'100%'}:{width:128*scale+'px',height:128*scale+'px'}},h('div',{style:{position:'absolute',inset:0,width:'128px',height:'128px',transform:native?undefined:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:m.layouts.prefab_auto_chess_band_item,m,bind,root:true})));
}

/** Original anchors and the 2/3-second stretch clip move the four-column grid and resize the player cards together. */
export function NativeStrategyLayout({detailOpen,picked=false,selected=null,children}){
 const m=useNativeUi(),viewport=useNativeViewport(),scale=Math.min(viewport.width/1280,viewport.height/720),entry=useNativeAnimation('strategy-entry','band_choose_entry'),motion=useNativeAnimation('strategy-detail:'+detailOpen,'band_choose_main_stretch_switch'),selection=useNativeAnimation('strategy-picked:'+picked,'band_choose_main_selected_revert');
 const opened=useRef(false);if(detailOpen)opened.current=true;
 const root=m?.layouts?.auto_chess_band_choose_state,slots=(Array.isArray(children)?children:[children]).filter(v=>v&&typeof v==='object');
 const slot=name=>slots.find(v=>String(v.props?.class||'').includes(name));
 const order=slot('draft-order'),cards=slot('draft-grid'),detail=slot('draft-detail');
 if(!m||!root)return h('main',{class:'native-strategy-portrait'},order,cards,detailOpen?detail:null);
 if(viewport.portrait)return h('main',{class:'native-strategy-portrait'},order,picked?h('section',{class:'native-confirmed-strategy native-confirmed-portrait'},h('div',{class:'native-confirmed-art'},selected?.portrait),h('h2',{class:'native-confirmed-title'},t('已选定策略')),h('h3',null,selected?.name),h('p',null,t('初始生命值'),' ',selected?.hp),selected?.description,selected?.boost):cards,detailOpen?detail:null);
 const animations=[{clip:entry.clips?.band_choose_entry,time:entry.time,root:root.path},picked?{clip:selection.clips?.band_choose_main_selected_revert,time:selection.time,root:root.path}:{clip:motion.clips?.band_choose_main_stretch_switch,time:detailOpen?motion.time:opened.current?Math.max(0,2/3-motion.time):0,root:root.path}];
 const canvasWidth=viewport.width/scale;
 const card=nativeAnimatedNode({...m.layouts.prefab_auto_chess_band_choose_player_card_item,path:root.path+'/panel_player/player_list/player_card_item'},animations);
 const bind=n=>{
  if(n.name==='panel_bkg_container'||n.name==='panel_choose_topbar'||n.name==='btn_emoji')return {show:false};
  if(n.name==='panel_team_list'){
   const r=n.rect,progress=Math.max(0,Math.min(1,(288-r.m_AnchoredPosition.x)/264)),extra=48*(1-progress),width=canvasWidth+r.m_SizeDelta.x+extra,tile=Math.min(192,Math.max(90,Math.floor((width-54)/5)));
   return {show:!picked,style:{left:r.m_AnchoredPosition.x-r.m_Pivot.x*r.m_SizeDelta.x-extra+'px',width:width+'px','--decision-tile':tile+'px','--decision-scale':tile/128}};
  }
  if(n.name==='panel_team_selected')return {show:picked,class:'native-confirmed-pane'};
  if(n.path.includes('/panel_team_selected/')){
   if(n.name==='team_icon')return {content:selected?.portrait,class:'native-confirmed-art'};
   if(n.name==='text_team_selected')return {text:t('已选定策略'),class:'native-confirmed-title'};
   if(n.name==='text_team_name')return {text:selected?.name||'',class:'native-confirmed-name'};
   if(n.name==='group_hp')return {content:h('span',{class:'native-confirmed-hp'},h('span',null,t('初始生命值')),h('b',null,selected?.hp??''))};
   if(n.name==='panel_team_detail')return {content:h('div',{class:'native-confirmed-description'},selected?.description,selected?.boost),class:'native-confirmed-strategy'};
   if(n.name==='group_win_times')return {show:false}; // No verified per-strategy clear count is supplied by this match.
  }
  if(n.name==='player_list')return {content:order,style:{width:card.rect.m_SizeDelta.x+'px',overflow:'visible'}};
  if(n.name==='team_item_list')return {content:cards,style:{overflow:'hidden'}};
  if(n.name==='panel_team_info_selecting')return {show:!picked&&detailOpen,content:h('div',{class:'native-strategy-detail-slot'},h(NativeNode,{node:n.children.find(c=>c.name==='back'),m}),detail?h(detail.type,{...detail.props,hidden:false}):null)};
  return null;
 };
 return h('main',{class:'native-strategy-layout'},h('div',{class:'native-strategy-canvas',style:{'--strategy-scale':scale,position:'absolute',left:'50%',top:'50%',width:canvasWidth+'px',height:'720px',transform:`translate(-50%,-50%) scale(${scale})`}},h(NativeNode,{node:root,m,bind,root:true,animations})));
}

export function NativeCountdown({seconds,total,label='COUNTDOWN',gauge=true,warn=false}){
 const m=useNativeUi(),scale=useNativeScale();if(!m)return null;
 const source=m.layouts.auto_chess_countdown_view,color=warn?'#ef5510':'#00ffc4';
 const text=String(Math.min(999,Math.max(0,seconds))).padStart(2,'0');
 const glyphs=h('span',{class:'native-countdown-digits',style:{color}},...Array.from(text,(c,i)=>h('i',{key:i,style:{maskImage:`url('/assets/ui/native-autochess/fonts/auto_chess_num_font-${c.charCodeAt(0)}.png')`}})));
 const bind=n=>{
  if(n.name==='light_green'||n.name==='light_orange')return {show:false};
  if(n.name==='text_count_down')return {content:glyphs,style:{justifyContent:'flex-end'}};
  if(n.name==='desc'&&label!=='COUNTDOWN')return {content:label,style:{color,fontSize:'8px',textAlign:'center'}};
  if(n.name==='countdown_slider')return {show:gauge};
  if(n.name==='Fill Area')return {style:{width:'24px',height:'73px',left:0,top:0,overflow:'hidden'}};
  if(n.name==='Fill'){const frac=Number.isFinite(total)&&total>0?Math.min(1,Math.max(0,seconds/total)):1;return {palette:warn?'orange':'green',style:{width:'24px',height:'73px',left:0,top:0,clipPath:`inset(${(1-frac)*100}% 0 0)`}};}
  return null;
 };
 return h('div',{class:'native-countdown',style:{width:179.89*scale+'px',height:80*scale+'px','--native-clock-color':color}},h('div',{style:{width:'179.89px',height:'100px',transform:`translateY(${-20*scale}px) scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})));
}

export function NativeBondDisc({name='',icon,layers,maxTier=3,active=false,disabled=false,onClick,title,selected=false,members=0,required=1}){
 const m=useNativeUi(),nativeScale=useNativeScale(),scale=nativeScale*.85;if(!m)return null;
 const source=m.layouts.autochess_hud_bond_item,n=Math.max(1,Math.min(4,maxTier)),need=Math.max(1,Math.min(4,required)),partial=Math.max(0,Math.min(need-1,members)),board=active?`${n}_${n}`:partial?`${need}_${partial}`:'1_0';
 const bind=node=>{
  if(node.name==='group_fx'||node.name==='root_mask'||node.name==='fx_glow1')return {show:false};
  if(node.name==='group_select')return {show:selected};
  if(node.path.endsWith('/root_icon/bg'))return {content:h('span',{class:'native-bond-disc__theme-art',
   'data-state':active?'active':'inactive',style:{'--bond-fill':active?'100%':need>1?`${partial/need*100}%`:'0%'}},
   h('img',{src:`/assets/ui/native-autochess/bond_${board}.png`,alt:''}))};
  if(node.path.endsWith('/root_icon/icon'))return {content:icon?h('i',{style:{display:'block',width:'100%',height:'100%',maskImage:`url("${icon}")`,maskSize:'contain',maskPosition:'center',maskRepeat:'no-repeat',background:active?'#031712':'rgba(184,184,184,.8)'}}):null};
  if(node.name==='stack_grp')return {show:layers!=null&&!disabled};
  if(node.name==='text_num')return {text:layers??0,style:{color:active?'#fff':'#b2b2b2'}};
  if(node.name==='text_name')return {text:name,style:{color:active?'#f4f4f4':'#f4f4f4b2'}};
  return null;
 };
 return h('button',{type:'button',class:'native-bond-disc',onClick,title:title||name,'aria-label':name,style:{width:83*scale+'px',height:104*scale+'px'}},h('div',{style:{position:'absolute',left:0,top:7*scale+'px',width:'83px',height:'84px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})));
}

export function NativeRoundStartPlate({round,gain,left,watching=false,outAt=1.666}){
 const m=useNativeUi(),scale=useNativeScale(),motion=useNativeAnimation('round:'+round);if(!m)return null;
 const source=nativeFind(m.layouts.round_start_dialog,'/container');
 const bind=n=>{
  if(n.path.endsWith('/stencil_emoji/book_mask'))return {class:'native-round-book-mask'};
  if(n.path.endsWith('/stencil_emoji/hand'))return {class:'native-round-report-hand',style:{'--report-hand-mask':`url("${m.sprites[n.image.key].url}")`}};
  if(n.name==='panel_sources')return {show:!watching};
  if(n.path.endsWith('/panel_round/text_title'))return {text:t('回合')};
  if(n.name==='text_round_before')return {show:true,content:h(NativeNumber,{parts:[String(Math.max(0,round-1)).padStart(2,'0')],width:100,height:49.19,size:40,color:rgba(n.text?.color)})};
  if(n.path.endsWith('/panel_round/text_round'))return {content:h(NativeNumber,{parts:[String(round).padStart(2,'0')],width:100,height:49.19,size:40,color:rgba(n.text?.color)})};
  if(n.path.endsWith('/panel_sources/text_title'))return {text:t('获得')};
  if(n.name==='group_sources')return {style:{width:'50px',left:'calc(50% + 2px)'}};
  if(n.path.endsWith('/group_sources/plus'))return {show:gain>0};
  if(n.path.endsWith('/group_sources/text_num'))return {content:h(NativeNumber,{parts:[String(gain)],width:50,height:32.6,size:28,color:rgba(n.text?.color)}),style:{width:'50px',height:'32.6px',left:0,top:'-1.85px'}};
  if(n.name==='round_countdown')return {show:left>0};
  if(n.path.endsWith('/round_countdown/mask/text_round'))return {text:t('剩余 {n} 回合',{n:left})};
  if(n.name==='panel_back'||n.name==='mask_tile')return {show:false};
  return null;
 };
 const outgoing=motion.time>=outAt,animations=[{clip:motion.clips?.[outgoing?'round_start_dialog_out':'round_start_dialog_in'],time:outgoing?motion.time-outAt:motion.time,root:source.path},{clip:motion.clips?.round_start_dialog_emoji_loop,time:motion.time,root:source.path+'/panel_left/emoji',loop:true}];
 return h('div',{class:'native-phase-canvas native-round-start',style:{transform:`translate(-50%,-50%) scale(${scale})`}},h(NativeNode,{node:source,m,bind,root:true,animations}));
}


/** Original act2autochess character status prefab; values remain owned by the live detail model. */
export function NativeOperatorStatus({name,profession,tier,tierBadge,phase=0,level,hp,range,bonds,values}){
 const m=useNativeUi(),v=useNativeViewport(),host=useRef(null),[scale,setScale]=useState(.7);
 useEffect(()=>{const el=host.current;if(!el)return;const resize=new ResizeObserver(()=>setScale(el.clientWidth/735));resize.observe(el);setScale(el.clientWidth/735);return()=>resize.disconnect();},[]);
 const source=m?.layouts.act2autochess_character_info_subpanel_status;
 if(!source)return null;
 const labels={text_atk:t('攻击'),text_def:t('防御'),text_magic_resistance:t('法抗'),text_block:t('阻挡'),text_cost:t('费用')};
 const names=Object.keys(labels);
 const height=v.height*.50/scale,header=height*.51,rowStep=Math.min(22,height*.042);
 const evolve=phase>0?'/assets/ui/native-operator/icon_evolve_'+phase+'.png':null;
 const hpText=Math.round(hp.hp)+'/'+Math.round(hp.max),hpSize=Math.min(27,155/(hpText.length*.62));
 const hpRatio=Math.max(0,Math.min(1,hp.hp/Math.max(1,hp.max))),hpLineHeight=Math.max(5,2/scale);
 // The imported thumb has a 7px left inset and a sloping top. Overlap that tip with the fill's visible pixels.
 const hpHandle=Math.max(-6,580*hpRatio-14),hpPrefixLeft=hpHandle<58?155:-58;
 const bind=n=>{
  const path=n.path;
  if(n===source||path===source.path)return {style:{position:'absolute',left:0,top:0,width:'735px',height:height+'px'}};
  if(['slider_sp','text_name_en','image_uniequip_type','lvl_group'].includes(n.name))return {show:false};
  if(n.name==='image_profession')return {hideImage:true,class:'native-operator-profession',style:{left:'24px',top:height*.28+'px',width:'128px',height:'128px'},content:h('img',{src:profession,alt:'',style:{width:'100%',height:'100%',objectFit:'contain'}})};
  if(n.name==='group_char_header')return {style:{left:0,top:header+'px',width:'735px',height:'175px'}};
  if(n.name==='text_name_cn')return {text:name,style:{left:'24px',top:0,width:'670px',height:'46px',fontSize:'32px',justifyContent:'flex-start',fontWeight:500}};
  if(n.name==='chess_lvl_group')return {class:'native-operator-rank',content:[h('span',{class:'native-operator-tier'},tierBadge||['I','II','III','IV','V','VI'][Math.max(0,Math.min(5,(tier|0)-1))]),h('i',{class:'native-operator-rank__divider'}),evolve?h('img',{class:'native-operator-rank__elite',src:evolve,alt:''}):null,h('span',{class:'native-operator-level'},h('small',null,'LV'),h('b',null,level??'—'))],style:{left:'24px',top:'42px',width:'310px',height:'64px'}};
  if(names.includes(n.name))return {content:h('div',{class:'native-operator-statrow'},h('span',null,labels[n.name]),h('b',{style:{color:values[n.name]?.tone==='up'?'#81f0a7':values[n.name]?.tone==='down'?'#ed8166':'#ddd'}},String(values[n.name]?.v??'—'))),style:{left:'24px',top:(height*.695-header+names.indexOf(n.name)*rowStep)+'px',width:'150px',height:rowStep+'px',display:'block'}};
  if(n.name.endsWith('_prefix')&&names.includes(n.path.split('/').at(-2)))return {text:labels[n.path.split('/').at(-2)],style:{left:'-56px',top:0,width:'53px',height:'24px',fontSize:'22px',justifyContent:'flex-start'}};
  if(n.name==='panel_atk_range')return {style:{left:'176px',top:height*.695+'px',width:'128px',height:'110px'}};
  if(n.name==='panel_atk_range_grid')return {content:range,style:{left:'2px',top:0,width:'124px',height:'78px',display:'grid',placeItems:'center'}};
  if(n.name==='text_atk_range')return {text:t('攻击范围'),style:{fontSize:'20px'}};
  if(n.name==='panel_camp_tag')return {hideImage:true,class:'native-operator-bond-info',content:bonds,style:{left:'316px',top:height*.695+'px',width:'max-content',height:'110px'}};
  if(n.name==='slider_hp')return {style:{left:0,top:height*.915+'px',width:'580px',height:'11px'}};
  if(path.endsWith('/slider_hp/fill_area'))return {style:{left:0,top:0,width:'580px',height:'11px',zIndex:1}};
  if(path.endsWith('/slider_hp/fill_area/fill'))return {hideImage:true,style:{left:0,top:'3px',width:'100%',height:hpLineHeight+'px',background:'#009fff',clipPath:`inset(0 ${100-hpRatio*100}% 0 0)`}};
  if(path.endsWith('/slider_hp/handle_area'))return {class:'native-operator-hp-handle',style:{left:hpHandle+'px',top:'-2px',width:'154px',height:'56px'}};
  if(n.name==='image_thumb')return {style:{left:0,top:0,width:'154px',height:'56px'}};
  if(n.name==='text_hp')return {text:hpText,style:{left:'6px',top:'14px',width:'142px',height:'34px',fontSize:hpSize+'px'}};
  if(n.name==='text_hp_prefix')return {text:t('生命'),style:{left:hpPrefixLeft+'px',top:'14px',width:'54px',height:'34px',fontSize:'24px'}};
  return null;
 };
 return h('div',{ref:host,class:'native-operator-status',style:{position:'relative',width:'100%',height:v.height*.50+'px'}},h('div',{style:{position:'absolute',left:0,top:0,width:'735px',height:height+'px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})));
}
export function NativeOperatorTabs({active,onChange}){
 const m=useNativeUi(),host=useRef(null),[scale,setScale]=useState(.7),source=m?.layouts.act2autochess_character_info_subpanel_tabgroup;
 useEffect(()=>{const el=host.current;if(!el)return;const observer=new ResizeObserver(()=>setScale(el.clientWidth/735));observer.observe(el);setScale(el.clientWidth/735);return()=>observer.disconnect();},[]);
 if(!source)return null;
 const items=[['trait','garrison',t('特质')],['skill','skill',t('技能')],['subprofession_trait','trait',t('特性')],['talent','talents',t('天赋')]],widths=[183.75,183.75,183.75,183.75],tabHeight=38;
 const bind=n=>{
  const frame={position:'absolute',left:0,top:0,width:'735px',height:tabHeight+'px'};
  if(n.path===source.path||n.name==='root')return {style:frame};
  if(n.name==='tabs')return {style:frame,content:items.map(([key])=>h(NativeNode,{key,node:n.children.find(c=>c.name==='tab_button_'+key),m,bind}))};
  if(n.name==='detailedPanels'||n.name==='protect_raycast'||n.name==='tab_button_autochess_equip')return {show:false};
  const item=items.find(([native])=>n.path.includes('/tab_button_'+native+'/')||n.name==='tab_button_'+native);if(!item)return null;
  const index=items.indexOf(item),selected=active===item[1],width=widths[index]+'px';
  if(n.name.startsWith('tab_button_'))return {show:true,hideImage:true,class:'native-operator-tab'+(selected?' is-on':''),style:{left:widths.slice(0,index).reduce((a,b)=>a+b,0)+'px',top:0,width,height:tabHeight+'px',background:selected?'#11151bbd':'#77777769'}};
  if(n.name==='highlight'||n.name==='triangle')return {show:false};
  if(n.name==='Text')return {text:item[2],style:{left:0,top:0,width,height:tabHeight+'px',fontSize:'24px',color:selected?'#fff':'#bdbdbd'}};
  if(n.name==='hotspot')return {onClick:()=>onChange(item[1]),label:item[2],role:'tab',selected,style:{left:0,top:0,width,height:tabHeight+'px'}};
  if(n.image)return {hideImage:true};
  return null;
 };
 return h('nav',{ref:host,class:'operator-detail__tabs native-operator-tabs',role:'tablist','aria-label':t('详情'),style:{height:tabHeight*scale+'px'}},h('div',{style:{position:'absolute',left:0,top:0,width:'735px',height:tabHeight+'px',transform:`scale(${scale})`,transformOrigin:'0 0'}},h(NativeNode,{node:source,m,bind,root:true})));
}
