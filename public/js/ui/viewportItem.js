import { useLayoutEffect, useState } from '../../vendor/hooks.module.js';

// One observer per scroll container; empty grid cells retain their layout while their expensive contents rest.
const lists = new WeakMap();
export function useViewportItem(ref, rootRef, margin = '0px 400px') {
  const [visible, setVisible] = useState(() => typeof globalThis.IntersectionObserver !== 'function');
  useLayoutEffect(() => {
    const root = rootRef.current, element = ref.current;
    if (!root || !element || typeof globalThis.IntersectionObserver !== 'function') { setVisible(true); return undefined; }
    let list = lists.get(root);
    if (!list) {
      const callbacks = new Map();
      const observer = new IntersectionObserver(entries => {
        for (const entry of entries) callbacks.get(entry.target)?.(entry.isIntersecting);
      }, { root, rootMargin: margin });
      list = { callbacks, observer };
      lists.set(root, list);
    }
    list.callbacks.set(element, setVisible);
    list.observer.observe(element);
    return () => {
      list.observer.unobserve(element);
      list.callbacks.delete(element);
      if (!list.callbacks.size) { list.observer.disconnect(); lists.delete(root); }
    };
  }, [ref, rootRef, margin]);
  return visible;
}
