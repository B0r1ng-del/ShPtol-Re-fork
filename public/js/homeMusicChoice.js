// Weighted lobby radio only; match faction and boss playlists keep their deterministic policy.
export function chooseHomeTrack(tracks,random=Math.random){
 if(!tracks?.length)return null;
 const weights=tracks.map(t=>Number.isFinite(t.weight)&&t.weight>0?t.weight:1),total=weights.reduce((n,w)=>n+w,0);
 let pick=Math.max(0,Math.min(1,random()))*total;
 for(let i=0;i<tracks.length;i++){pick-=weights[i];if(pick<0)return tracks[i].id;}
 return tracks.at(-1).id;
}
