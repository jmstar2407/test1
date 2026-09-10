import { TYPES, validateFilters } from '../utils/domain.js';
// Fixed order => one composite index for every supported numeric filter combination.
export function queryPlan(zone, filters, cursor=null, pageSize=30) {
  const f=validateFilters(filters);
  return { zone, filters:f, types:f.type?[f.type]:Object.keys(TYPES),
    order:['price','bedrooms','bathrooms','parkingSpaces','areaM2','__name__'],
    cursor, limit:Math.min(50,Math.max(1,pageSize)) };
}
export function cursorOf(p){return [p.price,p.bedrooms,p.bathrooms,p.parkingSpaces,p.areaM2,p.id];}
export function compare(a,b){for(const k of ['price','bedrooms','bathrooms','parkingSpaces','areaM2'])if(a[k]!==b[k])return a[k]-b[k];return a.id.localeCompare(b.id);}
export function afterCursor(p,c){if(!c)return true;const v=cursorOf(p);for(let i=0;i<v.length;i++){if(v[i]>c[i])return true;if(v[i]<c[i])return false;}return false;}
