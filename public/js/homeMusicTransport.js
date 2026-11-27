import { homeMusic } from './homeMusic.js';
import { ROOM_MUSIC_DURATIONS } from '../../shared/roomMusicDurations.js';
let manager;
export const homeMusicTransport = {
  configure(audio) { manager = audio; },
  subscribe: fn => homeMusic.subscribe(fn),
  progress() {
    const state = homeMusic.get(), duration = ROOM_MUSIC_DURATIONS[state.id] || 0;
    const p = manager?.homeMusicProgress();
    return { duration, position: Math.min(duration, p?.position || 0), editable: !!manager && duration > 0 };
  },
  seek(position) {
    const duration = ROOM_MUSIC_DURATIONS[homeMusic.get().id];
    if (duration && Number.isFinite(position)) manager?.seekHomeMusic(Math.max(0, Math.min(duration - 0.05, position)));
  },
};
