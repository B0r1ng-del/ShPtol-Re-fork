import { useLayoutEffect, useState } from '../../vendor/hooks.module.js';

let images = null, pending = null;
export function loadoutThumbnail(source, thumbnails) {
  if (!source || thumbnails === null) return null;
  const key = source.replace(/\/~[a-f0-9]{8,64}\//, '/').split(/[?#]/)[0];
  return thumbnails?.[key] || source;
}

export function prepareLoadoutThumbnails() {
  pending ??= fetch('/assets/ui/loadout-thumbs/index.json', { cache: 'no-cache' })
    .then(r => r.ok ? r.json() : null).then(v => (images = v?.images || {})).catch(() => (images = {}));
  return pending;
}

export function useLoadoutThumbnails(enabled = true) {
  const [value, setValue] = useState(images);
  useLayoutEffect(() => {
    if (!enabled || value !== null) return undefined;
    let alive = true;
    prepareLoadoutThumbnails().then(next => { if (alive) setValue(next); });
    return () => { alive = false; };
  }, [enabled, value]);
  return images ?? value;
}
