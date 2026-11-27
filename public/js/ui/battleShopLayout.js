// Preserve the authored desktop composition; only constrain controls that leave the viewport.
const setPx=(style,key,value)=>style.setProperty(key,`${Math.round(value*100)/100}px`);

export function battleViewportBox(hud,viewport) {
  const left=Math.max(hud.left,viewport.left),top=Math.max(hud.top,viewport.top);
  const right=Math.min(hud.right,viewport.right),bottom=Math.min(hud.bottom,viewport.bottom);
  return{left:left+8,top:top+8,right:right-8,bottom:bottom-8,width:Math.max(1,right-left-16),height:Math.max(1,bottom-top-16)};
}
const viewportBox=field=>{
  const hud=field.querySelector('.gm__hud')||field,v=globalThis.visualViewport;
  return battleViewportBox(hud.getBoundingClientRect(),{left:v?.offsetLeft||0,top:v?.offsetTop||0,right:(v?.offsetLeft||0)+(v?.width||innerWidth),bottom:(v?.offsetTop||0)+(v?.height||innerHeight)});
};
export function nativeShopFit(natural,available) {return Math.min(1,Math.max(0,available)/Math.max(1,natural));}

export function observeBattleShop(root,{collapsed=false,onFit}={}) {
  const field=root?.closest('.gm');if(!field)return()=>{};
  let alive=true,frame=0;
  const update=()=>{
    frame=0;if(!alive||!root.isConnected)return;
    // Measure unchanged CSS at natural size on finite viewport/font events, never the row we scale.
    root.style.removeProperty('--shop-unit');root.style.removeProperty('right');root.style.removeProperty('bottom');
    if(!collapsed)root.style.setProperty('--shop-fit','1');
    const box=viewportBox(field),row=root.querySelector('.shopbar__row'),card=root.querySelector('.scard,.lvcard,.shopbar-tab__card');
    if(card){
      const baseUnit=card.getBoundingClientRect().height/175;
      if(!collapsed&&row){
        const r=row.getBoundingClientRect(),children=[...row.children].map(e=>e.getBoundingClientRect());
        const natural=Math.max(r.right,...children.map(b=>b.right))-Math.min(r.left,...children.map(b=>b.left));
        const fieldBox=field.getBoundingClientRect(),corner=field.querySelector('.gm__corner')?.getBoundingClientRect();
        const left=Math.max(box.left,fieldBox.left+12,(corner?.right||0)+16);
        const widthFraction=parseFloat(getComputedStyle(root).getPropertyValue('--shop-width-fraction'))||.72;
        const available=Math.min(box.width,field.clientWidth*widthFraction,root.getBoundingClientRect().right-left);
        const fit=nativeShopFit(natural,available);
        if(fit<1)root.style.setProperty('--shop-unit',`${baseUnit*fit}px`);
        onFit?.(fit);
      }
    }
    const r=root.getBoundingClientRect(),parent=root.offsetParent?.getBoundingClientRect();
    // The 8px fitting margin is a fallback for actual overflow, not a reason to move a valid desktop dock.
    if(parent){if(r.right>box.right+8+.1)setPx(root.style,'right',parent.right-box.right);if(r.bottom>box.bottom+8+.1)setPx(root.style,'bottom',parent.bottom-box.bottom);}
    root.dataset.shopResponsive='native';
  };
  const schedule=()=>{if(alive&&!frame)frame=requestAnimationFrame(update);};
  const observer = new ResizeObserver(schedule);
  observer.observe(field);
  const viewport = globalThis.visualViewport;
  viewport?.addEventListener('resize',schedule);
  viewport?.addEventListener('scroll',schedule);
  schedule();
  document.fonts?.ready.then(()=>{if(alive)schedule();});
  return()=>{alive=false;if(frame)cancelAnimationFrame(frame);observer.disconnect();viewport?.removeEventListener('resize',schedule);viewport?.removeEventListener('scroll',schedule);};
}
