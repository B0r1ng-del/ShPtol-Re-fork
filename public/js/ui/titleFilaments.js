import { LoginVitalNetwork } from './loginVitalNetwork20261102.js';
import { html } from './components.js';
import { useEffect, useRef } from '../../vendor/hooks.module.js';

/** Projected ribbon rings inspired by the owner's geometric terminal references. */
export function TitleFilaments({ paused = false, tone = 'dark' } = {}) {
  const canvas = useRef(null);
  const suspended = useRef(paused), syncVisibility = useRef(null);
  suspended.current = paused;
  const pale = tone === 'light';
  useEffect(() => { syncVisibility.current?.(); }, [paused]);
  useEffect(() => {
    const el = canvas.current, ctx = el?.getContext('2d');
    if (!ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 0, height = 0, frame = 0, previous = 0, phase = 0, disposed = false;
    const draw = () => {
      if (disposed) return;
      ctx.clearRect(0, 0, width, height);
      const compact = height < 550;
      const radius = Math.min(width * .21, height * .38);
      for (let band = 0; band < 2; band++) {
        const cx = width * (band ? .88 : .12), cy = height * (band ? .43 : .57);
        const tilt = band ? -.52 : .5;
        const point = (u, edge) => {
          const twist = u * 1.5 + phase * .36 + band * 1.1;
          const r = radius + edge * radius * .31 * Math.cos(twist);
          const x = Math.cos(u) * r, y = Math.sin(u) * r * .7;
          return [cx + x * Math.cos(tilt) - y * Math.sin(tilt),
            cy + x * Math.sin(tilt) + y * Math.cos(tilt) + edge * radius * .34 * Math.sin(twist),
            Math.sin(u + phase * .16)];
        };
        const count = pale ? (compact ? 48 : 72) : (compact ? 80 : 144);
        for (let i = 0; i < count; i++) {
          const u = i / count * Math.PI * 2;
          const a = point(u, -1), b = point(u, 1);
          const light = .13 + (a[2] + 1) * .16;
          ctx.strokeStyle = pale
            ? (band ? `rgba(155,152,132,${light * .92})` : `rgba(152,141,113,${light * 1.26})`)
            : (band ? `rgba(140,184,195,${light * .75})` : `rgba(213,181,116,${light})`);
          ctx.lineWidth = pale ? (compact ? .65 : .85) : (compact ? .55 : .75);
          ctx.beginPath();ctx.moveTo(a[0], a[1]);ctx.lineTo(b[0], b[1]);ctx.stroke();
        }
        for (const edge of [-1, 1]) {
          ctx.beginPath();
          for (let i = 0; i <= count; i++) {
            const p = point(i / count * Math.PI * 2, edge);
            if (i) ctx.lineTo(p[0], p[1]);else ctx.moveTo(p[0], p[1]);
          }
          ctx.strokeStyle = pale ? (band ? '#a8ac9d75' : '#afa17da6') : (band ? '#8bb4c63b' : '#d9ba793f');ctx.lineWidth = .7;ctx.stroke();
        }
        const spark = point((phase * .18 + band * 2) % (Math.PI * 2), 1);
        ctx.fillStyle = pale ? (band ? '#a9af9c' : '#b8ac87') : (band ? '#a5d4df' : '#edd39a');
        ctx.fillRect(spark[0] - 1.5, spark[1] - 1.5, 3, 3);
      }
    };
    const resize = () => {
      if (disposed) return;
      const box = el.getBoundingClientRect();width = box.width;height = box.height;
      const dpr = Math.min(devicePixelRatio || 1, pale ? 1.25 : 1.5);
      el.width = Math.round(width * dpr);el.height = Math.round(height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);draw();
    };
    const tick = now => {
      if (disposed || suspended.current || document.hidden || reduced.matches) { frame = 0; previous = 0; return; }
      if (now - previous >= 1000 / (pale ? 18 : 24)) {
        if (previous) phase += Math.min(now - previous, 100) / 1000;
        previous = now;draw();
      }
      frame = requestAnimationFrame(tick);
    };
    const sync = () => {
      cancelAnimationFrame(frame);previous = 0;draw();
      if (!document.hidden && !reduced.matches && !suspended.current) frame = requestAnimationFrame(tick);
    };
    syncVisibility.current = sync;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(el); else { window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize',resize); }
    resize();sync();
    document.addEventListener('visibilitychange', sync);reduced.addEventListener('change', sync);
    return () => {disposed=true;syncVisibility.current=null;cancelAnimationFrame(frame);observer?.disconnect();window.removeEventListener('resize',resize);window.visualViewport?.removeEventListener('resize',resize);document.removeEventListener('visibilitychange', sync);reduced.removeEventListener('change', sync);};
  }, [pale]);
  return html`<div class="title-filaments" aria-hidden="true">
    ${pale?html`<${LoginVitalNetwork}/>`:null}
    <canvas ref=${canvas}></canvas>
    <svg class="title-circuit" viewBox="0 0 1440 900" preserveAspectRatio="none" focusable="false">
      <g fill="none" stroke="currentColor" stroke-width=".65">
        <path d="M42 125H175L250 200V315L350 415M42 730H190L260 660V550M1398 150H1265L1190 225V360L1100 450M1398 730H1230L1155 655V565"/>
        <path class="title-circuit__pulse" d="M42 125H175L250 200V315L350 415M1398 730H1230L1155 655V565"/>
        <circle cx="350" cy="415" r="4"/><circle cx="260" cy="550" r="3"/><circle cx="1100" cy="450" r="4"/><circle cx="1155" cy="565" r="3"/>
        <path d="M56 450h20m-10-10v20M1365 460h20m-10-10v20"/>
      </g>
    </svg>
    ${!pale?html`<div class="title-coordinate title-coordinate--left"><span>01 / ORIGIN</span><i></i><small>NEURAL LINK<br/>23.59 / 06.12</small></div>
    <div class="title-coordinate title-coordinate--right"><span>02 / ALLIANCE</span><i></i><small>PROTOCOL SYNC<br/>00.00 / 01.00</small></div>`:null}
  </div>`;
}
