import {h} from '../../vendor/preact.module.js';
import {useEffect,useRef} from '../../vendor/hooks.module.js';

/** Unity's sliced sprite, rendered in one canvas so adjacent pieces share one pixel grid. */
export function nativeSliceRects(sw,sh,border,x,y,width,height){
 const [l,b,r,t]=border,fx=width<l+r?width/(l+r):1,fy=height<t+b?height/(t+b):1;
 const sx=[0,l,sw-r,sw],sy=[0,t,sh-b,sh];
 const dx=[x,x+l*fx,x+width-r*fx,x+width],dy=[y,y+t*fy,y+height-b*fy,y+height],out=[];
 for(let j=0;j<3;j++)for(let i=0;i<3;i++)if(sx[i+1]>sx[i]&&sy[j+1]>sy[j]&&dx[i+1]>dx[i]&&dy[j+1]>dy[j])out.push([sx[i],sy[j],sx[i+1]-sx[i],sy[j+1]-sy[j],dx[i],dy[j],dx[i+1]-dx[i],dy[j+1]-dy[j]]);
 return out;
}
export function NativeHudFrame({m,scale=1}){
 const ref=useRef(null);
 useEffect(()=>{
  let alive=true;
  const entries=['frame_left_3393385916229985300','frame_mid_normal_7661096138171696378'].map(k=>m.sprites[k]);
  Promise.all(entries.map(e=>new Promise((resolve,reject)=>{const img=new Image();img.onload=()=>resolve(img);img.onerror=reject;img.src=e.url;}))).then(images=>{
   if(!alive||!ref.current)return;
   const canvas=ref.current,dpr=Math.max(2,Math.ceil(scale*(globalThis.devicePixelRatio||1)));
   canvas.width=482*dpr;canvas.height=56*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);
   const draw=(i,x,y,w,height)=>{for(const rect of nativeSliceRects(...entries[i].size,entries[i].border,x,y,w,height))ctx.drawImage(images[i],...rect);};
   draw(0,0,16.5,149.5,30);draw(1,149.5,2.5,183,51);
   ctx.save();ctx.translate(482,0);ctx.scale(-1,1);draw(0,0,16.5,149.5,30);ctx.restore();
  }).catch(()=>{});
  return()=>{alive=false;};
 },[m,scale]);
 return h('canvas',{ref,class:'native-hud-frame','aria-hidden':'true',style:{display:'block',width:'100%',height:'100%'}});
}
