import { useEffect } from '../../vendor/hooks.module.js';

/** Native touch panning; desktop vertical wheel browses a horizontal catalogue. */
export function useHorizontalWheel(ref, key = null, mouseDrag = false) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let frame = 0, pending = 0;
    let drag = null;
    const pointerDown = event => {
      if (event.pointerType !== 'mouse' || event.button !== 0 || el.scrollWidth <= el.clientWidth + 1
        || event.target.closest('button,a,input,select,textarea,[role="button"]')) return;
      drag = { id: event.pointerId, x: event.clientX, left: el.scrollLeft };
      el.setPointerCapture(event.pointerId);
      el.classList.add('is-drag-scrolling');
      event.preventDefault();
    };
    const pointerMove = event => {
      if (drag?.id === event.pointerId) el.scrollLeft = drag.left + drag.x - event.clientX;
    };
    const pointerEnd = event => {
      if (event && drag?.id !== event.pointerId) return;
      if (drag && el.hasPointerCapture(drag.id)) el.releasePointerCapture(drag.id);
      drag = null;
      el.classList.remove('is-drag-scrolling');
    };
    const wheel = (event) => {
      if (event.ctrlKey || event.metaKey || el.scrollWidth <= el.clientWidth + 1) return;
      if (event.target.closest('select,textarea,[data-scroll-y]')) return;
      // Trackpad horizontal gestures can stay on the browser's native scroll path.
      if (Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const factor = event.deltaMode === 1 ? 24 : event.deltaMode === 2 ? el.clientWidth : 1;
      pending += event.deltaY * factor;
      if (!frame) frame = requestAnimationFrame(() => {
        el.scrollLeft += pending;
        pending = 0; frame = 0;
      });
      event.preventDefault();
    };
    el.addEventListener('wheel', wheel, { passive: false });
    const handlers = { pointerdown: pointerDown, pointermove: pointerMove, pointerup: pointerEnd,
      pointercancel: pointerEnd, lostpointercapture: pointerEnd };
    if (mouseDrag) for (const [type, handler] of Object.entries(handlers)) el.addEventListener(type, handler);
    return () => {
      el.removeEventListener('wheel', wheel);
      if (mouseDrag) for (const [type, handler] of Object.entries(handlers)) el.removeEventListener(type, handler);
      pointerEnd();
      cancelAnimationFrame(frame);
    };
  }, [ref, key, mouseDrag]);
}
