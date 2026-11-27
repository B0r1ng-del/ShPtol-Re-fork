import {chooseHomeTrack} from './homeMusicChoice.js';
import { MUSIC_LIBRARY, musicById } from './musicLibrary.js';
// This preference stays independent of match audio and never changes a room's music selection.
const load = () => { try { return JSON.parse(globalThis.localStorage?.getItem('sp.pref.homeMusic') || '{}'); } catch { return {}; } };
const saved = load();
const auto = MUSIC_LIBRARY.filter(t => t.home);
const choose = chooseHomeTrack;
let state = { id: choose(auto), shuffle: saved.shuffle !== false, repeatOne: saved.repeatOne === true, paused: saved.paused === true };
const listeners = new Set();
function update(patch) {
  state = { ...state, ...patch };
  try { globalThis.localStorage?.setItem('sp.pref.homeMusic', JSON.stringify({ id: state.id, shuffle: state.shuffle, repeatOne: state.repeatOne, paused: state.paused })); } catch { /* private browser */ }
  for (const fn of listeners) fn(state);
}
export const homeMusic = {
  get: () => state,
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  enterLobby() { update({id:choose(auto.filter(t=>t.id!==state.id))}); },
  select(id) { if (musicById(id)) update({ id, paused: false }); },
  togglePause() { update({ paused: !state.paused }); },
  toggleShuffle() { update({ shuffle: !state.shuffle }); },
  toggleRepeat() { update({repeatOne:!state.repeatOne}); },
  cycleMode() { update(state.repeatOne?{repeatOne:false,shuffle:false}:state.shuffle?{repeatOne:true}:{shuffle:true}); },
  next(direction = 1, ended = false) {
    if (ended && state.paused) return;
    if (ended && state.repeatOne) { update({paused:false}); return; }
    const tracks = ended && state.shuffle ? auto : MUSIC_LIBRARY;
    const others = tracks.filter(t => t.id !== state.id);
    const index = tracks.findIndex(t => t.id === state.id);
    const id = state.shuffle && others.length ? choose(others) : tracks[(index + direction + tracks.length) % tracks.length].id;
    update({ id, paused: ended ? false : state.paused });
  },
};
