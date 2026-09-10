import { DR } from './domain.js';
const BASE = '0123456789bcdefghjkmnpqrstuvwxyz';
export function geohash(lat, lng, precision = 8) {
  let a=-90,b=90,c=-180,d=180,result='',value=0,bit=0,even=true;
  while (result.length < precision) {
    const mid = even ? (c+d)/2 : (a+b)/2;
    const high = (even ? lng : lat) >= mid;
    value = (value << 1) + Number(high);
    if(even) { if(high)c=mid;else d=mid; } else { if(high)a=mid;else b=mid; }
    even=!even;
    if(++bit===5) {result+=BASE[value];value=0;bit=0;}
  }
  return result;
}
export function decode(hash) {
  let west=-180,east=180,south=-90,north=90,even=true;
  for(const char of hash) {
    const value=BASE.indexOf(char); if(value<0)throw Error('Geohash inválido');
    for(let bit=4;bit>=0;bit--) {
      const hi=(value>>bit)&1;
      if(even){const mid=(west+east)/2;if(hi)west=mid;else east=mid;}
      else {const mid=(south+north)/2;if(hi)south=mid;else north=mid;}
      even=!even;
    }
  }
  return {west,east,south,north};
}
const intersects = (a,b) => a.west < b.east && a.east > b.west && a.south < b.north && a.north > b.south;
export function cover(bounds, precision=4, cap=16) {
  const b = {west:Math.max(DR.west,bounds.west),east:Math.min(DR.east,bounds.east),south:Math.max(DR.south,bounds.south),north:Math.min(DR.north,bounds.north)};
  if(b.west>=b.east || b.south>=b.north) return [];
  for(let p=Math.max(3,Math.min(6,precision));p>=3;p--) {
    const result=[];
    function walk(prefix) {
      if(result.length>cap)return;
      if(!intersects(decode(prefix),b))return;
      if(prefix.length===p){result.push(prefix);return;}
      for(const char of BASE)walk(prefix+char);
    }
    walk(''); if(result.length<=cap)return result;
  }
  throw Error('Viewport demasiado extenso.');
}
export const zoneKeys = p => [3,4,5,6].map(n => `${p.operation}_${p.location.geohash.slice(0,n)}`);
export const precisionForZoom = z => z < 9 ? 3 : z < 11 ? 4 : z < 14 ? 5 : 6;
export function strategy(total) {
  if(total<=50)return 'small';if(total<=200)return 'viewport';if(total<=1000)return 'cluster';
  if(total<=10000)return 'geo';return 'segmented';
}
