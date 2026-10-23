// 公告 (DESIGN §34.14). A button on the title screen and the lobby, only when the server's catalogue has at least
// one notice. Opening the popup marks every notice on screen as seen (sp.pref.notices-seen). The body is text,
// never HTML. With no notices the button is not rendered.

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Modal, Button } from './components.js';
import { useStore } from '../store.js';
import { catalog, loadCatalog, installedCount, pluginName } from '../content.js';
import { useLang } from './lang.js';
import { t } from '../../../shared/i18n.js';
import { noticeView, readSeen, markSeen } from '../../../shared/plugins/notices.js';

/** Title and lobby entry. Renders nothing when this server has no notice. */
export function NoticesButton() {
  const installed = useStore((s) => installedCount(s) > 0 || s.installedNotices === true);
  const cat = useStore((s) => s, Object.is, catalog);
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(() => readSeen());
  useEffect(() => { if (installed) loadCatalog(); }, [installed]);
  if (!installed) return null;
  const view = noticeView(cat.plugins, lang, seen, pluginName);
  if (!view.notices.length) return null;
  const openPopup = () => {
    setSeen(markSeen(view.notices.map((n) => n.key)));
    setOpen(true);
  };
  return html`<span class="notice-slot">
    <button type="button" class="notice-entry tapx" data-testid="notices-open" aria-label=${t('公告')} onClick=${openPopup}>
      ${t('公告')}
      ${view.unread ? html`<span class="notice-entry__dot" aria-label=${t('有未读公告')}></span>` : null}
    </button>
    <${Modal} open=${open} title=${t('公告')} micro="NOTICES" onClose=${() => setOpen(false)}
      actions=${html`<${Button} variant="primary" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <div class="notice-list">
        ${view.notices.map((n) => html`<article key=${n.key} class="notice-card" data-notice=${n.key}>
          <p class="notice-card__meta">${n.pluginName}${n.date ? ` · ${n.date}` : ''}</p>
          <h3 class="notice-card__title">${n.title}</h3>
          <p class="notice-card__body">${n.body}</p>
        </article>`)}
      </div>
    <//>
  </span>`;
}

// ----------------------------------------------------------------------------------------------------------------
// 公告 / 鸣谢面板的**纯逻辑层**（fork 原有，DESIGN §28.15 的客户端那一半；test/modNoticesPanel.test.js 直接跑它）。
// 正文来自 /data/notices.json；客户端是第二个读者，形状不对的条目在这里复判一次。
// 最要紧的一条是链接：只认 https://，一个包写 javascript: 或 http: 不该变成页面上一个可点链接。
// 与上面那个插件目录驱动的 NoticesButton 是两层，互不影响。

/** 与服务端 `server/notices.js NOTICE_LIMITS` 同形的展示上限（面板不该画一个包塞进来的 10 万条）。 */
export const NOTICE_LIMITS = Object.freeze({ announcements: 8, credits: 40, sections: 12, items: 40, chars: 200 });

const noticeText = (v, max = NOTICE_LIMITS.chars) => {
  if (typeof v !== 'string') return '';
  const s = v.replace(/\s+/g, ' ').trim();
  return s.length > max ? '' : s;
};
const httpsUrl = (v) => {
  const s = typeof v === 'string' ? v.trim() : '';
  return /^https:\/\/[^\s]+$/.test(s) ? s : '';
};

/**
 * 把 /data/notices.json 的合并体整理成面板要画的东西（**纯函数**）。
 * @param {any} body 解析结果（还没到就是 undefined）
 * @returns {{ announcements: Array<{ pack: string|null, version: string, date: string, summary: string, sections: Array<{ name: string, items: string[] }> }>, credits: Array<{ name: string, note: string, url: string }> }}
 */
export function noticesView(body) {
  const src = body && typeof body === 'object' ? body : {};
  const announcements = [];
  for (const raw of Array.isArray(src.announcements) ? src.announcements : []) {
    if (announcements.length >= NOTICE_LIMITS.announcements) break;
    if (!raw || typeof raw !== 'object') continue;
    const version = noticeText(raw.version, 32);
    const date = noticeText(raw.date, 32);
    const summary = noticeText(raw.summary, 600);
    if (!version || !summary) continue;
    const sections = [];
    for (const section of Array.isArray(raw.sections) ? raw.sections : []) {
      if (sections.length >= NOTICE_LIMITS.sections) break;
      if (!section || typeof section !== 'object') continue;
      const name = noticeText(section.name, 80);
      const items = (Array.isArray(section.items) ? section.items : [])
        .map((i) => noticeText(i)).filter(Boolean).slice(0, NOTICE_LIMITS.items);
      if (name && items.length) sections.push({ name, items });
    }
    announcements.push({ pack: noticeText(raw.pack, 64) || null, version, date, summary, sections });
  }
  const credits = [];
  const seen = new Set();
  for (const raw of Array.isArray(src.credits) ? src.credits : []) {
    if (credits.length >= NOTICE_LIMITS.credits) break;
    if (!raw || typeof raw !== 'object') continue;
    const name = noticeText(raw.name, 80);
    if (!name) continue;
    const url = httpsUrl(raw.url);
    const key = `${name}|${url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    credits.push({ name, note: noticeText(raw.note, 200), url });
  }
  return { announcements, credits };
}
