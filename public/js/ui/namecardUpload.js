import { useLayoutEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button } from './components.js';
import { net } from '../net.js';
import { namecardUploads, subscribeNamecardUploads } from '../../../shared/namecardUploads.js';
import { t } from '../../../shared/i18n.js';

export function useNamecardUploads() {
  const [state, setState] = useState(namecardUploads);
  useLayoutEffect(() => { const update = () => setState(namecardUploads()); const unsubscribe = subscribeNamecardUploads(update); update(); return unsubscribe; }, []);
  return state;
}

/** Center-crop to the portrait card; keep the complete JSON request below the existing 64 KiB WS limit. */
export async function resizeNamecard(file) {
  if (!file || file.size > 10 * 1024 * 1024 || !/^image\/(png|jpeg|webp)$/.test(file.type)) {
    throw Error(t('请选择10 MB以内的PNG、JPEG或WebP图片'));
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw Error(t('图片读取失败'));
    const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
    if (!context) throw Error(t('图片读取失败'));
    const width = Math.min(image.naturalWidth, image.naturalHeight * 2 / 3), height = width * 3 / 2;
    for (const target of [400, 320, 256]) {
      canvas.width = target; canvas.height = target * 3 / 2;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, (image.naturalWidth - width) / 2, (image.naturalHeight - height) / 2, width, height, 0, 0, canvas.width, canvas.height);
      const png = canvas.toDataURL('image/png');
      if (png.length < 58 * 1024) return png;
      context.globalCompositeOperation = 'destination-over'; context.fillStyle = '#10211e'; context.fillRect(0, 0, canvas.width, canvas.height); context.globalCompositeOperation = 'source-over';
      for (const quality of [.9, .8, .7, .6, .5]) {
        const jpeg = canvas.toDataURL('image/jpeg', quality);
        if (jpeg.length < 58 * 1024) return jpeg;
      }
    }
    throw Error(t('图片压缩后仍过大，请选择细节较少的图片'));
  } finally { URL.revokeObjectURL(url); }
}

export function NamecardUpload({ onPick }) {
  const { reviews, list } = useNamecardUploads();
  const [busy, setBusy] = useState(false), [note, setNote] = useState(''), input = useRef(null);
  const upload = async event => {
    const images = [...(event.currentTarget.files || [])]; event.currentTarget.value = ''; if (!images.length) return;
    if (images.length > 5) { setNote(t('一次最多选择5张图片')); return; }
    setBusy(true); setNote('');
    let submitted = 0;
    try { for (const image of images) { await net.request('acc.namecard.set', { data: await resizeNamecard(image) }); submitted++; } setNote(t('已提交 {n} 张图片',{n:submitted})); }
    catch (error) { setNote((submitted ? t('已提交 {n} 张图片',{n:submitted}) + ' · ' : '') + (error.detail || error.message || t('上传失败，请重试'))); }
    finally { setBusy(false); }
  };
  const remove = async id => {
    setBusy(true); setNote('');
    try { await net.request('acc.namecard.clear', {id}); setNote(t('已删除上传名片')); }
    catch (error) { setNote(error.detail || error.message); }
    finally { setBusy(false); }
  };
  const labels = { pending: t('待审核，暂不可使用'), approved: t('审核已通过'), rejected: t('审核未通过'), revoked: t('名片使用权已撤销') };
  return html`<section class="pf__upload namecard-upload" data-testid="namecard-upload">
    <h4>${t('自定义上传名片')}</h4><p>${t('图片自动裁切为2:3竖版名片，管理员批准后才能使用')}</p>
    <p>${t('已保存 {n}/20 张',{n:reviews.length})}</p>
    <input ref=${input} hidden type="file" multiple accept="image/png,image/jpeg,image/webp" onChange=${upload}/>
    <div class="pf__upload-row"><${Button} size="sm" disabled=${busy} onClick=${() => input.current?.click()}>${busy ? t('处理中…') : t('上传自定义名片')}<//>
    </div><div class="upload-library">${reviews.map(review=>html`<article key=${review.id} class="upload-entry" data-upload-id=${review.id}>
      <div class="pf__upload-review">${review.preview ? html`<img src=${review.preview} alt=${t('仅自己可见的上传预览')} width="64" height="96"/>` : null}<div><b role="status">${labels[review.status] || ''}</b>${review.reason ? html`<p>${review.reason}</p>` : null}</div></div>
      <div class="pf__upload-row">${list.some(entry=>entry.id===review.namecardId) ? html`<${Button} size="sm" disabled=${busy} onClick=${() => onPick(review.namecardId)}>${t('使用已批准的名片')}<//>` : null}
      <${Button} size="sm" variant="ghost" disabled=${busy} onClick=${()=>remove(review.id)}>${t('删除上传名片')}<//></div>
    </article>`)}</div>
    ${note ? html`<p role="status">${note}</p>` : null}
  </section>`;
}
