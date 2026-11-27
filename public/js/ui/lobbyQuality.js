/** Keep portrait edges sharp without allocating an unbounded high-DPI framebuffer. */
export function lobbyQuality({width=innerWidth,height=innerHeight,dpr=devicePixelRatio||1,
  touch=matchMedia('(pointer: coarse)').matches,low=false}={}) {
  const mobile=touch && Math.min(width,height)<=900;
  return {mobile,lite:low||mobile,fps:30,ambientFps:mobile?20:30,
    resolution:Math.max(1,Math.min(dpr,2,Math.sqrt(2400000/Math.max(1,width*height)))),
    particleBudget:mobile?400:Infinity};
}
