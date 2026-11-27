import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { homeMusicTransport } from '../homeMusicTransport.js';
const time = s => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
export function HomeMusicProgress() {
  const [p, set] = useState(homeMusicTransport.progress()), [drag, setDrag] = useState(null);
  useEffect(() => {
    const update = () => set(homeMusicTransport.progress()), off = homeMusicTransport.subscribe(update), timer = setInterval(update, 500);
    return () => { off(); clearInterval(timer); };
  }, []);
  return html`<label class="home-music__progress"><span>${t('播放进度')} <small>${time(drag ?? p.position)} / ${time(p.duration)}</small></span>
    <input type="range" min="0" max=${p.duration || 1} step="0.1" aria-label=${t('播放进度')} title=${t('拖动调整播放进度')} disabled=${!p.editable}
      value=${drag ?? p.position} onInput=${e => setDrag(Number(e.currentTarget.value))}
      onChange=${e => { homeMusicTransport.seek(Number(e.currentTarget.value)); setDrag(null); set(homeMusicTransport.progress()); }} /></label>`;
}
