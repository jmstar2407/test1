import { inDominicanRepublic } from './country.js';
export const TYPES = {
  house: { label: 'Casa', color: '#d63c46', icon: '⌂' },
  apartment: { label: 'Apartamento', color: '#2670d9', icon: '▤' },
  land: { label: 'Solar / Terreno', color: '#188449', icon: '▱' },
  villa: { label: 'Villa', color: '#8443bd', icon: '♜' },
  industrial: { label: 'Nave industrial', color: '#374151', icon: '▥' },
  farm: { label: 'Finca', color: '#697b28', icon: '♧' },
  commercial: { label: 'Local comercial', color: '#a67b00', icon: '▣' }
};
export const DR = { west: -72.05, east: -68.25, south: 17.35, north: 20.05 };
export const defaults = () => ({ operation: 'sale', type: '', minPrice: 0, maxPrice: 1e12,
  bedrooms: 0, bathrooms: 0, parkingSpaces: 0, minArea: 0, maxArea: 1e9 });
export const money = p => new Intl.NumberFormat('es-DO', { maximumFractionDigits: 0 }).format(p.price);
export const priceLabel = p => `RD$${money(p)}${p.operation === 'rent' ? '/mes' : ''}`;
export const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
export function matches(p, f) {
  return p.status === 'active' && p.operation === f.operation && (!f.type || p.type === f.type)
    && p.price >= f.minPrice && p.price <= f.maxPrice && p.bedrooms >= f.bedrooms
    && p.bathrooms >= f.bathrooms && p.parkingSpaces >= f.parkingSpaces
    && p.areaM2 >= f.minArea && p.areaM2 <= f.maxArea;
}
export const inside = (p, b) => p.location.longitude >= b.west && p.location.longitude <= b.east
  && p.location.latitude >= b.south && p.location.latitude <= b.north;
export function validateProperty(input) {
  const p = {};
  for (const [key, max, min] of [['title',100,8],['description',6000,30],['province',80,2],['municipality',80,2],['sector',100,0],['reference',200,0]]) {
    const raw = ['province','municipality','sector','reference'].includes(key) ? input.location?.[key] : input[key];
    const value = String(raw ?? '').trim();
    if (value.length < min || value.length > max) throw Error(`Revisa el campo ${key}.`);
    if (['province','municipality','sector','reference'].includes(key)) (p.location ??= {})[key] = value;
    else p[key] = value;
  }
  if (!Object.hasOwn(TYPES,input.type) || !['sale','rent'].includes(input.operation)) throw Error('Selecciona tipo y operación.');
  p.type = input.type; p.operation = input.operation; p.currency = 'DOP';
  for (const [key,max,min] of [['price',1e12,1],['bedrooms',100,0],['bathrooms',100,0],['parkingSpaces',1000,0],['areaM2',1e9,1]]) {
    const n = Number(input[key]);
    if (!Number.isFinite(n) || n < min || n > max || (['bedrooms','bathrooms','parkingSpaces'].includes(key) && !Number.isInteger(n))) throw Error(`Revisa ${key}.`);
    p[key] = n;
  }
  const lat = Number(input.location?.latitude), lng = Number(input.location?.longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < DR.south || lat > DR.north || lng < DR.west || lng > DR.east) throw Error('Selecciona una ubicación en República Dominicana.');
  if (!inDominicanRepublic(lat,lng)) throw Error('La ubicación seleccionada está fuera del territorio dominicano.');
  p.location.latitude = lat; p.location.longitude = lng;
  p.contact = {};
  for (const key of ['phone','whatsapp']) {
    const phone = String(input.contact?.[key] ?? '').replace(/[ ()-]/g, '');
    if (!/^\+[1-9]\d{7,14}$/.test(phone)) throw Error('Incluye el código de país del teléfono.');
    p.contact[key] = phone;
  }
  p.features = (Array.isArray(input.features) ? input.features : []).slice(0,30).map(x => String(x).trim().slice(0,80)).filter(Boolean);
  return p;
}
export function validateFilters(input = {}) {
  const f = defaults();
  if (input.operation && !['sale','rent'].includes(input.operation)) throw Error('Operación inválida.');
  f.operation = input.operation || f.operation;
  f.type = Object.hasOwn(TYPES,input.type) ? input.type : '';
  for (const k of ['minPrice','maxPrice','bedrooms','bathrooms','parkingSpaces','minArea','maxArea']) {
    if (input[k] !== undefined) f[k] = Number(input[k]);
    if (!Number.isFinite(f[k]) || f[k] < 0) throw Error('Filtro inválido.');
  }
  if (f.minPrice > f.maxPrice || f.minArea > f.maxArea) throw Error('El mínimo debe ser menor que el máximo.');
  return f;
}
