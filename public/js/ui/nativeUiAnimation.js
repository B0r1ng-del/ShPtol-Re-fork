// Unity AnimationCurve interpolation, including step tangents and weighted Bezier handles.
export function nativeCurveAt(keys,time){
 if(!keys?.length)return 0;if(time<=keys[0].time)return keys[0].value;
 let i=1;while(i<keys.length&&time>keys[i].time)i++;if(i===keys.length)return keys.at(-1).value;
 const a=keys[i-1],b=keys[i],dt=b.time-a.time;if(!(dt>0))return b.value;
 if(!Number.isFinite(a.outSlope)||!Number.isFinite(b.inSlope))return time<b.time?a.value:b.value;
 const x=(time-a.time)/dt,wa=(a.weightedMode&2)?a.outWeight:1/3,wb=(b.weightedMode&1)?b.inWeight:1/3;
 let u=x;
 if(wa!==1/3||wb!==1/3){let lo=0,hi=1;for(let j=0;j<28;j++){u=(lo+hi)/2;const v=1-u,tx=3*v*v*u*wa+3*v*u*u*(1-wb)+u*u*u;if(tx<x)lo=u;else hi=u;}}
 const v=1-u;return v*v*v*a.value+3*v*v*u*(a.value+a.outSlope*dt*wa)+3*v*u*u*(b.value-b.inSlope*dt*wb)+u*u*u*b.value;
}

const clipIndexes=new WeakMap();
function clipIndex(clip){let index=clipIndexes.get(clip);if(index)return index;index={duration:0,tracks:new Map()};for(const c of clip.m_FloatCurves||[]){if(!index.tracks.has(c.path))index.tracks.set(c.path,[]);index.tracks.get(c.path).push(c);for(const k of c.curve.m_Curve)index.duration=Math.max(index.duration,k.time);}clipIndexes.set(clip,index);return index;}
export function nativeClipDuration(clip){return clip?clipIndex(clip).duration:0;}

export function nativeAnimatedNode(node,animations){
 let next=node;
 for(const {clip,time,root,loop=false}of animations||[]){
  if(!clip||!(node.path===root||node.path.startsWith(root+'/')))continue;
  const rel=node.path.slice(root.length+1),index=clipIndex(clip),duration=index.duration,at=loop&&duration>0&&Number.isFinite(time)?time%duration:time;
  const tracks=index.tracks.get(rel);if(!tracks?.length)continue;
  if(next===node)next={...node,rect:node.rect?structuredClone(node.rect):null,image:node.image?structuredClone(node.image):null,text:node.text?structuredClone(node.text):null};
  for(const c of tracks){
   const val=nativeCurveAt(c.curve.m_Curve,at),[attr,axis]=c.attribute.split('.');
   if(attr==='m_Alpha')next.alpha=val;
   else if(attr==='m_FillAmount'&&next.image)next.image.fill=val;
   else if(attr==='m_Color'){if(next.image?.color)next.image.color[axis]=val;if(next.text?.color)next.text.color[axis]=val;}
   else if(attr==='m_IsActive')next.active=val>=.5;
   else if(next.rect?.[attr]&&axis)next.rect[attr][axis]=val;
  }
 }
 return next;
}
