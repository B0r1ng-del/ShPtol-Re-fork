import {h} from '../../vendor/preact.module.js';
import {useEffect,useRef} from '../../vendor/hooks.module.js';

// Unity AlignByGeometry centers the numeral bodies, not the font's line box / leading.
export function NativeNumber({parts,width=35,height=18,size=20,color='#cecece'}){
 const ref=useRef(null),text=parts.map(p=>typeof p==='string'?p:p.text).join('');
 useEffect(()=>{
  let alive=true;
  const draw=()=>{
   if(!alive||!ref.current)return;
   const c=ref.current,dpr=Math.max(2,Math.ceil(globalThis.devicePixelRatio||1));
   c.width=Math.ceil(width*dpr);c.height=Math.ceil(height*dpr);const ctx=c.getContext('2d');ctx.scale(dpr,dpr);
   ctx.font=`500 ${size}px "Novecentowide-Medium"`;ctx.textBaseline='alphabetic';
   const body=ctx.measureText('0123456789'),baseline=height/2+(body.actualBoundingBoxAscent-body.actualBoundingBoxDescent)/2;
   let x=(width-ctx.measureText(text).width)/2;
   for(const p of parts){const str=typeof p==='string'?p:p.text;ctx.fillStyle=typeof p==='string'?color:p.color||color;ctx.fillText(str,x,baseline);x+=ctx.measureText(str).width;}
  };
  draw();document.fonts?.load(`500 ${size}px "Novecentowide-Medium"`).then(draw).catch(()=>{});
  return()=>{alive=false;};
 },[text,width,height,size,color,JSON.stringify(parts)]);
 return h('canvas',{ref,class:'native-number',role:'img','aria-label':text,style:{display:'block',width:width+'px',height:height+'px',flex:'none'}});
}
