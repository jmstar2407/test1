// ui/ui.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const $ = (s, root=document) => root.querySelector(s);
function el(tag,attrs={},text='') {const n=document.createElement(tag);for(const [k,v] of Object.entries(attrs)){if(k==='class')n.className=v;else if(k==='style')n.style.cssText=v;else n.setAttribute(k,v);}if(text)n.textContent=text;return n;}
function toast(message){const n=$('#toast');n.textContent=message;n.hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>n.hidden=true,6000);}
function friendly(error){console.error(error);const code=error?.code||'';
  if(code.includes('unauthenticated'))return 'Inicia sesión para continuar.';
  if(code.includes('permission-denied'))return 'No tienes permiso para realizar esta acción.';
  if(code.includes('resource-exhausted'))return 'Alcanzaste el límite permitido. Revisa tus publicaciones.';
  if(code.includes('unavailable') || !navigator.onLine)return 'Sin conexión. Puedes consultar las zonas guardadas.';
  if(code.includes('popup'))return 'No se completó el inicio de sesión. Permite la ventana de Google e inténtalo otra vez.';
  if(code.includes('failed-precondition'))return 'No se pudo completar la operación. Revisa la configuración o recarga el anuncio.';
  if(!code && error instanceof Error && !/fetch|network|firebase|script|import/i.test(error.message))return error.message;
  return 'No pudimos completar la solicitud. Inténtalo de nuevo en unos momentos.';
}
function debounce(fn,ms=350){let timer;return(...args)=>{clearTimeout(timer);timer=setTimeout(()=>fn(...args),ms);};}
function dialog(id,title){
 const d=el('dialog',{id,class:'sheet'});const header=el('header',{class:'dialog-header'});
 header.append(el('span',{class:'brand-mark','aria-hidden':'true'},'A↑'),el('h2',{},title));
 const close=el('button',{type:'button',class:'icon-button','aria-label':'Cerrar'},'×');close.onclick=()=>d.close();header.append(close);d.append(header);
 d.addEventListener('click',e=>{if(e.target===d){const r=d.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)d.close();}});
 document.body.append(d);return d;
}
function safeURL(url){if(typeof url!=='string'||!url.trim())return '';try{const u=new URL(url,document.baseURI);return ['https:','http:','file:'].includes(u.protocol)?u.href:'';}catch{return '';}}
function image(url,alt,cls=''){const img=el('img',{alt,class:cls,loading:'lazy',decoding:'async'});img.src=(/^data:image\/(?:webp|jpeg|png);base64,/.test(url||'')?url:safeURL(url))||'img/property-placeholder.svg';img.onerror=()=>{img.onerror=null;img.src='img/property-placeholder.svg';};return img;}
function field(label,name,type='text',value='',attrs={}){const wrap=el('label',{class:'field'});wrap.append(el('span',{},label));const input=el('input',{name,type,...attrs});input.value=value;wrap.append(input);return wrap;}
function select(label,name,options,value=''){const wrap=el('label',{class:'field'});wrap.append(el('span',{},label));const s=el('select',{name});for(const [v,t]of options){const o=el('option',{value:v},t);s.append(o);}s.value=value;wrap.append(s);return wrap;}

// `$` se publica explícitamente porque su nombre no puede detectarse con un
// exportador basado únicamente en identificadores alfanuméricos.
window.ArribaTe["ui/ui"] = { $, el, toast, friendly, debounce, dialog, safeURL, image, field, select };
})();


// utils/country.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
// Natural Earth 1:10m, public domain. Generalized geography; not a cadastral boundary.
const polygons = [[[[-71.757436,19.71011],[-71.738271,19.706122],[-71.720326,19.697455],[-71.72411,19.71719],[-71.741851,19.755805],[-71.740793,19.765692],[-71.740793,19.773179],[-71.767649,19.774482],[-71.771067,19.785142],[-71.760243,19.80093],[-71.744496,19.817206],[-71.73998,19.820258],[-71.734853,19.821275],[-71.723704,19.82099],[-71.716908,19.823635],[-71.7058,19.836493],[-71.699818,19.841498],[-71.687896,19.846015],[-71.679026,19.84809],[-71.670277,19.851996],[-71.658803,19.861965],[-71.665639,19.874498],[-71.666737,19.885688],[-71.661448,19.893622],[-71.64859,19.896715],[-71.640859,19.895575],[-71.628896,19.890448],[-71.621246,19.889309],[-71.617909,19.891425],[-71.610951,19.900824],[-71.60733,19.902899],[-71.504628,19.910346],[-71.478505,19.906887],[-71.452707,19.898098],[-71.357249,19.851264],[-71.329213,19.845893],[-71.302602,19.855699],[-71.28246,19.841783],[-71.268056,19.835517],[-71.223744,19.834052],[-71.212066,19.837104],[-71.20934,19.844794],[-71.208811,19.854967],[-71.203521,19.865383],[-71.191762,19.869696],[-71.183339,19.860419],[-71.172231,19.834052],[-71.164418,19.838609],[-71.158518,19.843492],[-71.154408,19.849107],[-71.151723,19.855699],[-71.160227,19.858222],[-71.162017,19.859442],[-71.16218,19.862047],[-71.165395,19.868801],[-71.149729,19.863023],[-71.136586,19.863715],[-71.123199,19.866889],[-71.107045,19.868801],[-71.096791,19.876207],[-71.078277,19.909125],[-71.06607,19.916571],[-71.050852,19.920233],[-71.018422,19.935492],[-71.000885,19.93769],[-70.984731,19.933743],[-70.96935,19.925198],[-70.961049,19.912665],[-70.966176,19.896715],[-70.946889,19.889309],[-70.939443,19.889309],[-70.944447,19.904731],[-70.946889,19.910346],[-70.898508,19.902899],[-70.884267,19.904283],[-70.854726,19.910834],[-70.843251,19.910346],[-70.830963,19.902533],[-70.786977,19.852851],[-70.783315,19.843329],[-70.788645,19.834052],[-70.750966,19.833808],[-70.736562,19.827094],[-70.698476,19.79682],[-70.662221,19.779364],[-70.623687,19.766547],[-70.579091,19.760199],[-70.518707,19.759752],[-70.513661,19.762641],[-70.508534,19.769355],[-70.496449,19.777248],[-70.482777,19.783881],[-70.472727,19.786851],[-70.433705,19.775214],[-70.372711,19.714179],[-70.336171,19.677639],[-70.319569,19.666449],[-70.30134,19.65766],[-70.280832,19.651801],[-70.235219,19.647203],[-70.198557,19.63467],[-70.131418,19.622138],[-70.116444,19.622382],[-70.106435,19.625922],[-70.097524,19.633205],[-70.061025,19.670111],[-70.042104,19.678453],[-69.986684,19.677639],[-69.959543,19.680121],[-69.947255,19.678656],[-69.932037,19.670152],[-69.897939,19.635972],[-69.887196,19.612738],[-69.887766,19.587348],[-69.904164,19.532375],[-69.884145,19.5244],[-69.876536,19.506659],[-69.87682,19.461005],[-69.874379,19.441148],[-69.867991,19.425279],[-69.801381,19.330878],[-69.771474,19.303249],[-69.76769,19.29975],[-69.733469,19.286566],[-69.713206,19.28974],[-69.674387,19.30386],[-69.654368,19.307034],[-69.609364,19.308783],[-69.589426,19.312812],[-69.568959,19.320705],[-69.539418,19.339423],[-69.527984,19.341783],[-69.517649,19.339667],[-69.496449,19.329779],[-69.483306,19.327582],[-69.459096,19.333319],[-69.448598,19.334377],[-69.442779,19.334174],[-69.437367,19.332953],[-69.43342,19.329901],[-69.431793,19.324123],[-69.428619,19.319241],[-69.421702,19.321112],[-69.410715,19.327582],[-69.352691,19.305121],[-69.335601,19.293402],[-69.32429,19.31509],[-69.305898,19.331122],[-69.260487,19.354885],[-69.231272,19.363349],[-69.224355,19.351793],[-69.232086,19.327948],[-69.246816,19.299628],[-69.226877,19.29267],[-69.204335,19.292792],[-69.182444,19.298163],[-69.164296,19.307034],[-69.158355,19.285102],[-69.171376,19.26789],[-69.18932,19.252265],[-69.198394,19.235053],[-69.202707,19.216946],[-69.214345,19.200629],[-69.231801,19.188666],[-69.253651,19.183539],[-69.332143,19.197211],[-69.418121,19.190985],[-69.438385,19.196479],[-69.475453,19.214016],[-69.602935,19.22899],[-69.617299,19.225246],[-69.622792,19.211859],[-69.626047,19.164293],[-69.633534,19.123684],[-69.630442,19.108466],[-69.62088,19.101955],[-69.608469,19.093451],[-69.553293,19.101467],[-69.53425,19.094794],[-69.510487,19.102037],[-69.46345,19.084703],[-69.438629,19.087348],[-69.444732,19.092353],[-69.452748,19.09691],[-69.46231,19.100287],[-69.473378,19.10163],[-69.473378,19.108466],[-69.419993,19.111151],[-69.404449,19.108466],[-69.386708,19.096096],[-69.372955,19.065375],[-69.356068,19.053209],[-69.338979,19.048896],[-69.304596,19.044867],[-69.211741,19.020982],[-69.173248,19.011135],[-69.15746,19.012193],[-69.138661,19.022284],[-69.144887,19.029608],[-69.157338,19.036689],[-69.15746,19.046373],[-69.139516,19.051215],[-69.123891,19.037787],[-69.102854,19.005357],[-69.089263,18.99787],[-69.074127,18.993557],[-69.061187,18.988186],[-69.054433,18.977484],[-69.04247,18.986762],[-69.018056,18.997463],[-69.006581,19.005357],[-69.014231,19.013414],[-69.010569,19.015367],[-69.001576,19.015611],[-68.992991,19.018459],[-68.982533,19.028795],[-68.97936,19.032864],[-68.975413,19.033149],[-68.939565,19.031317],[-68.918609,19.027289],[-68.89981,19.020901],[-68.883127,19.012193],[-68.881215,19.009426],[-68.881174,19.005805],[-68.88036,19.002021],[-68.876291,18.998603],[-68.855824,18.991767],[-68.853993,18.992092],[-68.818227,18.984931],[-68.795888,18.984117],[-68.786855,18.981024],[-68.785146,18.979885],[-68.776967,18.974351],[-68.767812,18.969468],[-68.749989,18.968085],[-68.739735,18.964423],[-68.623525,18.861884],[-68.5808,18.812567],[-68.520497,18.768866],[-68.477284,18.74022],[-68.464996,18.735012],[-68.458567,18.731024],[-68.413401,18.689602],[-68.356191,18.656562],[-68.328603,18.616523],[-68.334055,18.577297],[-68.428049,18.44123],[-68.434682,18.435777],[-68.441274,18.429023],[-68.444325,18.419501],[-68.442494,18.384752],[-68.444325,18.374823],[-68.455678,18.357856],[-68.472157,18.34984],[-68.492828,18.34748],[-68.516591,18.34748],[-68.534901,18.353339],[-68.574534,18.37816],[-68.588938,18.38227],[-68.605458,18.371731],[-68.602854,18.355658],[-68.597524,18.336615],[-68.606028,18.317084],[-68.618316,18.301459],[-68.626088,18.283352],[-68.64151,18.225165],[-68.647084,18.21483],[-68.658437,18.210924],[-68.742991,18.204535],[-68.760243,18.210354],[-68.762522,18.246975],[-68.786855,18.295396],[-68.820139,18.342475],[-68.849599,18.374823],[-68.880971,18.395494],[-68.922515,18.412299],[-68.964345,18.417955],[-69.012563,18.399115],[-69.085439,18.395901],[-69.10436,18.399115],[-69.148183,18.413235],[-69.16804,18.416327],[-69.185292,18.421698],[-69.214223,18.445136],[-69.236318,18.450507],[-69.255605,18.446682],[-69.275217,18.440334],[-69.295033,18.439032],[-69.315094,18.450507],[-69.336008,18.432074],[-69.465932,18.422553],[-69.50475,18.408922],[-69.525258,18.408433],[-69.579986,18.444485],[-69.602122,18.455715],[-69.616811,18.457343],[-69.623158,18.447984],[-69.622629,18.436754],[-69.620839,18.425482],[-69.623606,18.416327],[-69.632558,18.41352],[-69.646596,18.41356],[-69.659495,18.41592],[-69.665151,18.419501],[-69.681956,18.446763],[-69.689931,18.454088],[-69.697377,18.456366],[-69.851471,18.47248],[-69.879384,18.471218],[-69.883656,18.471015],[-69.89981,18.466457],[-69.931223,18.451972],[-69.957102,18.435289],[-69.966908,18.430813],[-69.99352,18.422553],[-70.004018,18.417467],[-70.016591,18.411363],[-70.03893,18.392483],[-70.055776,18.367255],[-70.062408,18.337226],[-70.067698,18.329088],[-70.090688,18.317532],[-70.095937,18.310248],[-70.100006,18.299221],[-70.133778,18.269273],[-70.15807,18.242621],[-70.171783,18.231431],[-70.177887,18.234198],[-70.202138,18.233547],[-70.220774,18.230536],[-70.233144,18.223944],[-70.250803,18.23432],[-70.269602,18.238105],[-70.397572,18.237616],[-70.419057,18.231147],[-70.460194,18.20893],[-70.483551,18.204088],[-70.552846,18.20425],[-70.568918,18.210354],[-70.570302,18.21894],[-70.563059,18.225653],[-70.5537,18.231513],[-70.549062,18.237616],[-70.55191,18.24844],[-70.558705,18.254381],[-70.565745,18.258205],[-70.573313,18.268012],[-70.592437,18.279853],[-70.596791,18.28913],[-70.59435,18.299058],[-70.58845,18.303616],[-70.581654,18.307074],[-70.576405,18.313951],[-70.571767,18.334052],[-70.571156,18.35517],[-70.573883,18.373684],[-70.579457,18.385647],[-70.60143,18.411851],[-70.614654,18.420844],[-70.637807,18.429389],[-70.657541,18.433783],[-70.682485,18.435614],[-70.703847,18.430121],[-70.71288,18.412665],[-70.709462,18.39175],[-70.711985,18.383368],[-70.741689,18.355414],[-70.749867,18.350409],[-70.76065,18.34748],[-70.772328,18.347886],[-70.793121,18.354071],[-70.802317,18.354926],[-70.810048,18.352037],[-70.823964,18.342678],[-70.833323,18.340644],[-70.846018,18.34219],[-70.850453,18.339586],[-70.860341,18.330715],[-70.863108,18.326972],[-70.869374,18.314602],[-70.870595,18.310248],[-70.87328,18.306301],[-70.886708,18.302069],[-70.891672,18.299709],[-70.918284,18.269599],[-70.932485,18.261542],[-70.956207,18.258734],[-70.96581,18.262152],[-70.972035,18.27025],[-70.977284,18.28026],[-70.983795,18.28913],[-70.994252,18.296617],[-71.004872,18.301011],[-71.048248,18.310004],[-71.068349,18.31037],[-71.083974,18.304389],[-71.09024,18.28913],[-71.092356,18.280707],[-71.101226,18.266099],[-71.103342,18.25495],[-71.10143,18.242133],[-71.096547,18.235093],[-71.089915,18.228705],[-71.082834,18.217719],[-71.066518,18.163316],[-71.061269,18.153998],[-71.061106,18.142076],[-71.080556,18.113918],[-71.097157,18.073717],[-71.191803,17.941799],[-71.200103,17.919176],[-71.204254,17.911119],[-71.213735,17.904853],[-71.233632,17.894965],[-71.24592,17.885077],[-71.254709,17.875312],[-71.261545,17.863227],[-71.267812,17.846584],[-71.275217,17.849066],[-71.278066,17.850775],[-71.282094,17.85399],[-71.283599,17.846747],[-71.285146,17.844184],[-71.28893,17.84101],[-71.282094,17.84101],[-71.286122,17.832587],[-71.291331,17.826158],[-71.297719,17.821967],[-71.305653,17.820502],[-71.309316,17.816392],[-71.315826,17.796454],[-71.319651,17.789211],[-71.331858,17.772406],[-71.365549,17.678412],[-71.375885,17.660142],[-71.417226,17.604804],[-71.427235,17.60928],[-71.435862,17.617092],[-71.43635,17.621283],[-71.446116,17.62934],[-71.514882,17.737779],[-71.531606,17.755072],[-71.565256,17.767524],[-71.645131,17.75727],[-71.679311,17.765286],[-71.669667,17.772406],[-71.637766,17.804023],[-71.63093,17.816799],[-71.632395,17.838324],[-71.636586,17.853461],[-71.652008,17.881985],[-71.662831,17.897691],[-71.664947,17.903469],[-71.665639,17.915473],[-71.658803,17.953315],[-71.666249,17.970771],[-71.683827,17.99018],[-71.720326,18.01911],[-71.776235,18.039252],[-71.764271,18.069492],[-71.760654,18.086804],[-71.762876,18.115846],[-71.762204,18.132486],[-71.764581,18.143674],[-71.77533,18.172329],[-71.776829,18.181785],[-71.774038,18.201474],[-71.766132,18.220258],[-71.721709,18.292996],[-71.721112,18.293974],[-71.709339,18.31325],[-71.71151,18.316144],[-71.720708,18.323973],[-71.734971,18.332939],[-71.788714,18.352214],[-71.826438,18.376166],[-71.834551,18.38508],[-71.849744,18.406449],[-71.858167,18.413554],[-71.897183,18.422882],[-71.912169,18.430737],[-71.918164,18.449237],[-71.914391,18.460218],[-71.906898,18.4643],[-71.901575,18.469778],[-71.904056,18.48479],[-71.910516,18.494273],[-72.000949,18.582459],[-72.009838,18.598814],[-71.992629,18.611139],[-71.955474,18.618606],[-71.880285,18.605403],[-71.841579,18.617986],[-71.828557,18.631293],[-71.807989,18.66465],[-71.794347,18.679171],[-71.791779,18.680682],[-71.784898,18.68473],[-71.75807,18.700513],[-71.744066,18.711443],[-71.732077,18.730072],[-71.725255,18.746971],[-71.720346,18.765445],[-71.718848,18.784229],[-71.726909,18.823529],[-71.727943,18.864069],[-71.733472,18.882569],[-71.740913,18.891613],[-71.763806,18.911508],[-71.772953,18.921714],[-71.787112,18.950033],[-71.796259,18.957061],[-71.819668,18.95781],[-71.844525,18.949749],[-71.862456,18.947088],[-71.865402,18.964425],[-71.848142,18.975484],[-71.796827,18.98861],[-71.783702,18.996309],[-71.740345,19.041888],[-71.710424,19.081653],[-71.695283,19.094546],[-71.661383,19.117594],[-71.648774,19.135293],[-71.643658,19.152475],[-71.639111,19.21211],[-71.651733,19.217924],[-71.716522,19.247767],[-71.749517,19.279708],[-71.753729,19.283785],[-71.771558,19.307556],[-71.776519,19.327504],[-71.769956,19.333808],[-71.742981,19.348381],[-71.733472,19.355461],[-71.720811,19.38595],[-71.715282,19.39166],[-71.703861,19.41463],[-71.70319,19.459278],[-71.715127,19.537465],[-71.743084,19.600071],[-71.747683,19.622783],[-71.746041,19.649017],[-71.745048,19.664899],[-71.748613,19.682598],[-71.757436,19.71011]]],[[[-71.524485,17.545559],[-71.541168,17.554633],[-71.541371,17.576158],[-71.532216,17.601304],[-71.521067,17.621283],[-71.506947,17.613674],[-71.492584,17.603664],[-71.467112,17.580268],[-71.482533,17.575629],[-71.507395,17.551256],[-71.524485,17.545559]]],[[[-68.664052,18.169338],[-68.612375,18.170803],[-68.598785,18.166205],[-68.588694,18.153388],[-68.577504,18.133734],[-68.57018,18.115709],[-68.571848,18.107856],[-68.587026,18.11107],[-68.619293,18.125149],[-68.636098,18.128363],[-68.65392,18.126288],[-68.684885,18.116889],[-68.701894,18.114691],[-68.73705,18.123603],[-68.762074,18.145168],[-68.778188,18.172024],[-68.786936,18.196682],[-68.772084,18.200873],[-68.754547,18.197659],[-68.737172,18.189521],[-68.72232,18.179267],[-68.710764,18.17536],[-68.664052,18.169338]]]];
function ringContains(lng,lat,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){
 const [xi,yi]=ring[i],[xj,yj]=ring[j];if((yi>lat)!==(yj>lat)&&lng<(xj-xi)*(lat-yi)/(yj-yi)+xi)inside=!inside;
}return inside;}
function inDominicanRepublic(lat,lng){return polygons.some(rings=>ringContains(lng,lat,rings[0])&&!rings.slice(1).some(r=>ringContains(lng,lat,r)));}

window.ArribaTe["utils/country"] = { inDominicanRepublic };
})();


// utils/domain.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { inDominicanRepublic } = window.ArribaTe["utils/country"];
const TYPES = {
  house: { label: 'Casa', color: '#d63c46', icon: '⌂' },
  apartment: { label: 'Apartamento', color: '#2670d9', icon: '▤' },
  land: { label: 'Solar / Terreno', color: '#188449', icon: '▱' },
  villa: { label: 'Villa', color: '#8443bd', icon: '♜' },
  industrial: { label: 'Nave industrial', color: '#374151', icon: '▥' },
  farm: { label: 'Finca', color: '#697b28', icon: '♧' },
  commercial: { label: 'Local comercial', color: '#a67b00', icon: '▣' }
};
const DR = { west: -72.05, east: -68.25, south: 17.35, north: 20.05 };
const defaults = () => ({ operation: 'sale', type: '', minPrice: 0, maxPrice: 1e12,
  bedrooms: 0, bathrooms: 0, parkingSpaces: 0, minArea: 0, maxArea: 1e9 });
const money = p => new Intl.NumberFormat('es-DO', { maximumFractionDigits: 0 }).format(p.price);
const priceLabel = p => `RD$${money(p)}${p.operation === 'rent' ? '/mes' : ''}`;
const normalize = s => String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase();
function matches(p, f) {
  return p.status === 'active' && p.operation === f.operation && (!f.type || p.type === f.type)
    && p.price >= f.minPrice && p.price <= f.maxPrice && p.bedrooms >= f.bedrooms
    && p.bathrooms >= f.bathrooms && p.parkingSpaces >= f.parkingSpaces
    && p.areaM2 >= f.minArea && p.areaM2 <= f.maxArea;
}
const inside = (p, b) => p.location.longitude >= b.west && p.location.longitude <= b.east
  && p.location.latitude >= b.south && p.location.latitude <= b.north;
function validateProperty(input) {
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
function validateFilters(input = {}) {
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

window.ArribaTe["utils/domain"] = { TYPES, DR, defaults, money, priceLabel, normalize, matches, inside, validateProperty, validateFilters };
})();


// utils/geo.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { DR } = window.ArribaTe["utils/domain"];
const BASE = '0123456789bcdefghjkmnpqrstuvwxyz';
function geohash(lat, lng, precision = 8) {
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
function decode(hash) {
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
function cover(bounds, precision=4, cap=16) {
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
const zoneKeys = p => [3,4,5,6].map(n => `${p.operation}_${p.location.geohash.slice(0,n)}`);
const precisionForZoom = z => z < 9 ? 3 : z < 11 ? 4 : z < 14 ? 5 : 6;
function strategy(total) {
  if(total<=50)return 'small';if(total<=200)return 'viewport';if(total<=1000)return 'cluster';
  if(total<=10000)return 'geo';return 'segmented';
}

window.ArribaTe["utils/geo"] = { geohash, decode, cover, zoneKeys, precisionForZoom, strategy };
})();


// storage/imageWorker.js
window.ArribaTe = window.ArribaTe || {};
window.ArribaTe.imageWorkerSource = "self.onmessage=async e=>{\n try{\n  const bitmap=await createImageBitmap(e.data.file,{imageOrientation:'from-image'}),result={};\n  try{if(bitmap.width*bitmap.height>40000000)throw Error('La imagen supera 40 megap\u00edxeles.');for(const [variant,size]of [['thumbnail',400],['medium',1100],['large',2000]]){\n   const ratio=Math.min(1,size/Math.max(bitmap.width,bitmap.height)),w=Math.round(bitmap.width*ratio),h=Math.round(bitmap.height*ratio);\n   const canvas=new OffscreenCanvas(w,h);canvas.getContext('2d').drawImage(bitmap,0,0,w,h);\n   let blob=await canvas.convertToBlob({type:'image/webp',quality:variant==='thumbnail'?.74:.82});\n   if(blob.type!=='image/webp')blob=await canvas.convertToBlob({type:'image/jpeg',quality:.82});\n   result[variant]=blob;\n  }}finally{bitmap.close();}\n  self.postMessage({result});\n }catch(e){self.postMessage({error:e.message});}\n};\n";


// storage/imageProcessor.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
async function processImage(file){
 if(!['image/jpeg','image/png','image/webp'].includes(file.type)||file.size>15*1024*1024)throw Error('Usa JPG, PNG o WebP de hasta 15 MB.');
 if('OffscreenCanvas'in window && 'Worker'in window){
  try{return await new Promise((resolve,reject)=>{const workerURL=URL.createObjectURL(new Blob([window.ArribaTe.imageWorkerSource],{type:'text/javascript'}));const worker=new Worker(workerURL);URL.revokeObjectURL(workerURL);const timer=setTimeout(()=>{worker.terminate();reject(Error('Tiempo de procesamiento agotado.'));},30000);worker.onmessage=e=>{clearTimeout(timer);worker.terminate();e.data.error?reject(Error(e.data.error)):resolve(e.data.result);};worker.onerror=e=>{clearTimeout(timer);worker.terminate();reject(e);};worker.postMessage({file});});}catch{/* Canvas fallback for browsers without worker image decoding. */}
 }
 const bitmap=await createImageBitmap(file,{imageOrientation:'from-image'}),result={};
 try{if(bitmap.width*bitmap.height>40000000)throw Error('La imagen supera 40 megapíxeles.');
 for(const [variant,max]of [['thumbnail',400],['medium',1100],['large',2000]]){
  const ratio=Math.min(1,max/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*ratio);canvas.height=Math.round(bitmap.height*ratio);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);
  result[variant]=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.82));
  if(!result[variant])throw Error('No se pudo procesar esta imagen.');await new Promise(r=>setTimeout(r,0));
 }}finally{bitmap.close();}return result;
}

window.ArribaTe["storage/imageProcessor"] = { processImage };
})();


// properties/queryPlan.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
const { TYPES, validateFilters } = window.ArribaTe["utils/domain"];
// Fixed order => one composite index for every supported numeric filter combination.
function queryPlan(zone, filters, cursor=null, pageSize=30) {
  const f=validateFilters(filters);
  return { zone, filters:f, types:f.type?[f.type]:Object.keys(TYPES),
    order:['price','bedrooms','bathrooms','parkingSpaces','areaM2','__name__'],
    cursor, limit:Math.min(50,Math.max(1,pageSize)) };
}
function cursorOf(p){return [p.price,p.bedrooms,p.bathrooms,p.parkingSpaces,p.areaM2,p.id];}
function compare(a,b){for(const k of ['price','bedrooms','bathrooms','parkingSpaces','areaM2'])if(a[k]!==b[k])return a[k]-b[k];return a.id.localeCompare(b.id);}
function afterCursor(p,c){if(!c)return true;const v=cursorOf(p);for(let i=0;i<v.length;i++){if(v[i]>c[i])return true;if(v[i]<c[i])return false;}return false;}

window.ArribaTe["properties/queryPlan"] = { queryPlan, cursorOf, compare, afterCursor };
})();


// properties/propertyStore.js
(function () {
'use strict';
window.ArribaTe = window.ArribaTe || {};
class PropertyStore {
  constructor(){this.items=new Map();this.visible=[];this.selected=null;}
  merge(items){for(const p of items){const old=this.items.get(p.id);if(!old || p.version>=old.version)this.items.set(p.id,p);}while(this.items.size>1200)this.items.delete(this.items.keys().next().value);}
  remove(id){this.items.delete(id);this.visible=this.visible.filter(p=>p.id!==id);}
}
const propertyStore = new PropertyStore();

window.ArribaTe["properties/propertyStore"] = { PropertyStore, propertyStore };
})();
