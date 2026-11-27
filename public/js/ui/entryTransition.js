import { html } from './components.js';
import { portal } from './portalLite.js';
import {createStore,useStore} from '../store.js';

const transition=createStore({active:false});
export function beginEntryTransition(enter){
 if(transition.get().active)return;
 transition.set({active:true});
 const reduced=globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
 setTimeout(enter,reduced?80:150);
 setTimeout(()=>transition.set({active:false}),reduced?200:420);
}
export function EntryTransitionHost(){
 const active=useStore(s=>s.active,Object.is,transition);
 return active?html`<${portal}><div class="entry-fade" aria-hidden="true"></div><//>`:null;
}
