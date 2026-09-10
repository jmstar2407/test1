export const config = {
  firebase: {
    apiKey: 'AIzaSyBRjDso4IPrh9WLvWWMYoPiJxNFD6Vt3RU',
    authDomain: 'arribate-com.firebaseapp.com',
    projectId: 'arribate-com',
    storageBucket: 'arribate-com.firebasestorage.app',
    messagingSenderId: '46945634270',
    appId: '1:46945634270:web:c74fd6781ac1fab5da7f4f',
    measurementId: 'G-Y4J11MBYKQ'
  },
  region: 'us-central1',
  mapboxToken: '', // Token PUBLICO pk..., restringido por dominio.
  googleMapsEmbedKey: '', // Maps Embed API; restringir por HTTP referrer.
  appCheckSiteKey: '', // reCAPTCHA Enterprise. Activar antes de exigir App Check.
  useEmulators: false,
  demo: false, // Muestra datos ficticios; nunca escribe en Firebase.
  pageSize: 30,
  maxZones: 16,
  cacheTTL: 60000,
  maxCacheQueries: 120,
  maxVisible: 180,
  ranking: { distance: 25, featured: 10, quality: 15, recency: 10 },
  socialLinks: [], // Hasta 3 objetos { label: 'Instagram', url: 'https://...' }
  privacyUrl: '',
  termsUrl: '',
  satelliteTiles: '', // Fallback: URL de un proveedor con licencia + atribucion.
  satelliteAttribution: ''
};
