import {audio} from '../audio.js';
// Delegation covers native buttons and later-mounted dialogs, without intercepting their actions.
export function installInteractionFeedback(doc=globalThis.document){
 if(!doc||doc.__spInteractionFeedback)return;doc.__spInteractionFeedback=true;let last=0;
 doc.addEventListener('click',e=>{const target=e.target?.closest?.('button,[role="button"],a[href]');if(!target||target.hasAttribute('data-own-click-sound')||target.disabled||target.getAttribute('aria-disabled')==='true')return;
  const now=performance.now();if(now-last<70)return;last=now;audio.sfx('click');
 },{capture:true,passive:true});
}
