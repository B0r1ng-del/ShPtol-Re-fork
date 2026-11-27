// Compile the source curves once, then let the browser animate only transform/opacity layers.
import {nativeCurveAt,nativeClipDuration} from './nativeUiAnimation.js';
const cache=new WeakMap();
const round=n=>Math.round(n*100000)/100000;
function frameSet(node,clip,root){
 const tracks=clip?.m_FloatCurves?.filter(c=>c.path===node.path.slice(root.length+1))||[];
 const rotation=clip?.m_RotationCurves?.find(c=>c.path===node.path.slice(root.length+1))?.curve?.m_Curve,alpha=tracks.some(c=>c.attribute==='m_Alpha'),colorAlpha=!node.image&&tracks.some(c=>c.attribute==='m_Color.a'),fill=!!node.image&&tracks.some(c=>c.attribute==='m_FillAmount'),image=!!node.image&&(fill||tracks.some(c=>c.attribute.startsWith('m_Color.'))),size=tracks.some(c=>c.attribute.startsWith('m_SizeDelta.')),
  position=!!rotation||size||tracks.some(c=>c.attribute.startsWith('m_AnchoredPosition.'));
 if(!alpha&&!colorAlpha&&!image&&!position)return null;
 let previousAngle=null;
 const duration=nativeClipDuration(clip),nodeFrames=[],imageFrames=[],steps=Math.max(1,Math.ceil(duration*30));
 for(let i=0;i<=steps;i++){
  const time=duration*i/steps,values=Object.fromEntries(tracks.map(c=>[c.attribute,nativeCurveAt(c.curve.m_Curve,time)])),offset=i/steps,props={offset};
  if(alpha||colorAlpha)props.opacity=round((values.m_Alpha??node.alpha??1)*(colorAlpha?values['m_Color.a']:1));
  if(position){const r=node.rect,v=r.m_AnchoredPosition,s=r.m_LocalScale;let q=r.m_LocalRotation;
   if(rotation?.length){let j=1;while(j<rotation.length&&time>rotation[j].time)j++;const a=rotation[Math.max(0,j-1)],b=rotation[Math.min(j,rotation.length-1)],f=b.time>a.time?Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time))):0;q={z:a.value.z+(b.value.z-a.value.z)*f,w:a.value.w+(b.value.w-a.value.w)*f};}
   let angle=-2*Math.atan2(q.z,q.w)*180/Math.PI;if(previousAngle!=null){while(angle-previousAngle>180)angle-=360;while(angle-previousAngle< -180)angle+=360;}previousAngle=angle;
   const dx=(values['m_AnchoredPosition.x']??v.x)-v.x,dy=v.y-(values['m_AnchoredPosition.y']??v.y);props.transform=`translate(${round(dx)}px,${round(dy)}px) rotate(${round(angle)}deg) scale(${s.x},${s.y})`;
   if(size){if(values['m_SizeDelta.x']!=null)props.width=values['m_SizeDelta.x']+'px';if(values['m_SizeDelta.y']!=null)props.height=values['m_SizeDelta.y']+'px';}
  }
  if(alpha||colorAlpha||position)nodeFrames.push(props);
  if(image){const c={...node.image.color};for(const axis of ['r','g','b','a'])c[axis]=values['m_Color.'+axis]??c[axis];let opacity=c.a??1;const m=node.image.material;
   if(m?.imageControl)opacity*=(m.color?.a??1)*Math.min(1,Math.max(0,c.b??m.intensity??1))*(m.revert2&&m.dissolve2?Math.max(0,Math.min(1,c.g??1)):1);
   const frame={offset,opacity:round(opacity)};if(fill){const amount=Math.max(0,Math.min(1,values.m_FillAmount));frame.clipPath=node.image.fillMethod===1?(node.image.fillOrigin?`inset(0 0 ${(1-amount)*100}% 0)`:`inset(${(1-amount)*100}% 0 0 0)`):`inset(0 ${(1-amount)*100}% 0 0)`;}imageFrames.push(frame);
  }
 }
 return{duration,nodeFrames,imageFrames};
}
function compiled(source,show,loop,root){
 let result=cache.get(source);if(result?.show===show&&result?.loop===loop)return result;
 const records=[];const walk=node=>{const entry=frameSet(node,show,root),cycle=frameSet(node,loop,root);if(entry||cycle)records.push({path:node.path,entry,cycle});for(const child of node.children||[])walk(child);};walk(source);
 result={show,loop,records};cache.set(source,result);return result;
}
export function playNativeVehicleMotion(stage,source,show,loop,root,{reduced=false}={}){
 const animations=[],elements=new Map([...stage.querySelectorAll('[data-native-path]')].map(el=>[el.dataset.nativePath,el]));
 if(!reduced&&stage.animate){for(const record of compiled(source,show,loop,root).records){const el=elements.get(record.path);if(!el)continue;const image=[...el.children].find(child=>child.classList.contains('native-ui-image'));
  for(const [kind,clip] of [['entry',record.entry],['loop',record.cycle]]){if(!clip)continue;
   for(const [target,frames]of[[el,clip.nodeFrames],[image,clip.imageFrames]]){if(!target||!frames.length)continue;
    const animation=target.animate(frames,{duration:clip.duration*1000,delay:kind==='loop'?nativeClipDuration(show)*1000:0,iterations:kind==='loop'?Infinity:1,fill:kind==='loop'?'none':'forwards',easing:'linear'});animation.id='native-vehicle-'+kind;animations.push(animation);
   }
  }
 }}
 stage.dataset.motionReady='true';
 return{animations,pause(){for(const a of animations)a.pause();},resume(){for(const a of animations)if(a.playState==='paused')a.play();},destroy(){for(const a of animations)a.cancel();delete stage.dataset.motionReady;}};
}
