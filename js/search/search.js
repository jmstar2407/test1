import { config } from '../config/config.js';
import { normalize,TYPES } from '../utils/domain.js';
// Approximate navigation centers, editable catalog. They do not validate an address.
export const places=[
 ['Santo Domingo',18.4861,-69.9312],['Santo Domingo Este',18.4885,-69.856],['Distrito Nacional',18.4861,-69.9312],
 ['Santiago',19.4517,-70.697],['Punta Cana',18.582,-68.405],['Bávaro',18.683,-68.45],['La Romana',18.427,-68.973],
 ['Puerto Plata',19.793,-70.688],['San Pedro de Macorís',18.453,-69.308],['La Vega',19.222,-70.529],['San Cristóbal',18.416,-70.109],
 ['Samaná',19.204,-69.336],['Las Terrenas',19.312,-69.542],['Jarabacoa',19.121,-70.643],['Higüey',18.615,-68.708],['Baní',18.279,-70.331],
 ['Naco',18.476,-69.932],['Piantini',18.472,-69.938],['Bella Vista',18.455,-69.949],['Ensanche Ozama',18.484,-69.872]
];
export async function search(text,filters){
 let query=normalize(text),next={...filters};
 const aliases=[['apartamento','apartment'],['casa','house'],['solar','land'],['terreno','land'],['villa','villa'],['finca','farm'],['nave industrial','industrial'],['local comercial','commercial']];
 for(const [label,type]of aliases){const re=new RegExp(`\\b${label}s?\\b`);if(re.test(query)){next.type=type;query=query.replace(re,'').trim();break;}}
 const price=query.match(/(?:hasta|precio|rd\$|rd)\s*([\d,.]+)\s*(millones|millon|mil)?/);
 if(price){next.maxPrice=Number(price[1].replace(/,/g,''))*(price[2]?.startsWith('millon')?1e6:price[2]==='mil'?1000:1);query=query.replace(price[0],'').trim();}
 query=query.replace(/^(en|de)\s+/,'').trim();if(!query)return {filters:next};
 const local=places.find(p=>normalize(p[0])===query);if(local)return {filters:next,center:{lat:local[1],lng:local[2]},label:local[0]};
 if(!config.mapboxToken)throw Error('Ubicación no encontrada en el catálogo local. Selecciona otra zona en el mapa; la búsqueda completa requiere configurar Mapbox.');
 const params=new URLSearchParams({q:query,country:'do',language:'es',limit:'1',autocomplete:'false',access_token:config.mapboxToken});
 const r=await fetch(`https://api.mapbox.com/search/geocode/v6/forward?${params}`,{signal:AbortSignal.timeout(10000)});if(!r.ok)throw Error('No pudimos buscar esa ubicación. Inténtalo de nuevo.');
 const result=(await r.json()).features?.[0];if(!result)throw Error('No encontramos esa ubicación en República Dominicana.');
 // Temporary geocoding results are not persisted, in accordance with the provider terms.
 return {filters:next,center:{lng:result.geometry.coordinates[0],lat:result.geometry.coordinates[1]},label:result.properties.name||text};
}
