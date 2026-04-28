# 📦 miColmApp — Arquitectura Modular

> Sistema POS para colmados de República Dominicana.  
> Refactorizado de un único archivo monolítico (~7,500 líneas) a **11 módulos independientes**.

---

## 🗂️ Estructura de archivos

```
miColmApp/
│
├── index.html                   ← Punto de entrada principal
│
├── css/
│   ├── styles.css               ← Estilos globales (layout, auth, componentes)
│   └── virtualKeyboard.css      ← Estilos del teclado numérico POS
│
└── js/
    └── modules/
        ├── firebase-init.js     ← [Base] Inicialización de Firebase
        ├── app-state.js         ← [Base] Estado global centralizado
        ├── utils.js             ← [Base] Utilidades transversales
        ├── offline.js           ← [Base] Soporte offline + cola de imágenes
        │
        ├── auth.js              ← [Módulo 1] Autenticación y negocios
        ├── pos.js               ← [Módulo 2] Punto de Venta y carrito
        ├── caja.js              ← [Módulo 3] Caja y movimientos
        ├── inventario.js        ← [Módulo 4] Inventario y catálogo
        ├── estadisticas.js      ← [Módulo 5] Estadísticas y reportes
        │
        ├── config.js            ← Configuración del negocio y empleados
        ├── whatsapp.js          ← Envío de facturas por WhatsApp
        ├── barcode-scanner.js   ← Escáner de códigos de barras
        └── virtual-keyboard.js  ← Teclado numérico virtual
```

---

## 🔁 Diagrama de dependencias

```
Firebase CDN
    └── firebase-init.js
            ├── app-state.js
            ├── utils.js
            └── offline.js
                    ├── auth.js           → emite 'micolmapp:negocio-listo'
                    ├── pos.js            ← escucha 'micolmapp:negocio-listo'
                    ├── caja.js           ← escucha 'micolmapp:negocio-listo'
                    ├── inventario.js     ← escucha 'micolmapp:negocio-listo'
                    ├── estadisticas.js   ← escucha 'micolmapp:negocio-listo'
                    ├── config.js         ← escucha 'micolmapp:negocio-listo'
                    ├── whatsapp.js
                    ├── barcode-scanner.js
                    └── virtual-keyboard.js
```

---

## 📡 Sistema de eventos

Los módulos se comunican entre sí mediante **Custom Events** en `window`, sin importarse directamente entre ellos.

| Evento | Emitido por | Escuchado por |
|--------|-------------|---------------|
| `micolmapp:negocio-listo` | `auth.js` | `pos.js`, `caja.js`, `inventario.js`, `estadisticas.js`, `config.js`, `offline.js`, `barcode-scanner.js` |
| `micolmapp:page-change` | `utils.js → showPage()` | `caja.js`, `inventario.js`, `estadisticas.js`, `config.js` |

---

## 🧩 Descripción de cada módulo

### 🔷 Módulos Base (sin dependencias de negocio)

#### `firebase-init.js`
Inicializa la app de Firebase con persistencia offline multi-pestaña.  
**Expone:** `window._auth`, `window._db`, `window._storage`  
**Cambiar de proyecto:** solo modifica `firebaseConfig` aquí.

#### `app-state.js`
Estado global centralizado usando `Object.defineProperty` para que todos los módulos accedan via `window.*`.  
**Contiene:** `negocioId`, `negocioData`, `currentUser`, `categorias`, `productos`, `cajaActual`, `config`, `modoPrueba`.

#### `utils.js`
Funciones puras reutilizables:
- `fmt(val)` → formateo de moneda
- `toast(msg, type)` → notificaciones
- `abrirModal(id)` / `cerrarModal(id)` → con soporte de historial del navegador
- `showScreen(name)` / `showPage(name)` → navegación
- `PAISES_TEL`, `initPaisSelects()` → detección de país en teléfonos

#### `offline.js`
- **Cola de imágenes:** si el usuario sube una imagen sin conexión, se encola en `localStorage` y se sincroniza automáticamente al volver.
- `_fsOp(fn)` → envuelve operaciones Firestore con timeout offline para evitar spinners colgados.
- `subirImagenBase64()` → sube imagen o la encola.
- `comprimirImagen()` → redimensiona y comprime antes de subir.

---

### 🔶 Módulos de Negocio

#### `auth.js` — Módulo 1: Autenticación
**Funciones clave:** `login()`, `registrar()`, `mostrarSelectorNegocios()`, `entrarAlNegocio(id)`, `logoutTotal()`  
**Emite:** `micolmapp:negocio-listo` cuando el negocio está cargado.  
**Ventaja:** Puedes agregar Google Login o biometría aquí sin tocar POS.

#### `pos.js` — Módulo 2: Punto de Venta
**Funciones clave:** `agregarAlCarrito()`, `cambiarQty()`, `renderCarrito()`, `confirmarFactura()`, `nuevaVenta()`  
**Sistema multi-factura:** tabs persistentes en `localStorage`.  
**Soporte:** unidades detallables (libras, kg, litros), combos, notas dibujadas (SignaturePad).

#### `caja.js` — Módulo 3: Caja
**Funciones clave:** `abrirCaja()`, `cerrarCaja()`, `confirmarCerrarCaja()`, `registrarGasto()`, `registrarIngreso()`  
**Ventaja:** Puedes escalar a sistema contable sin afectar el POS.

#### `inventario.js` — Módulo 4: Inventario
**Funciones clave:** `renderProductosInventario()`, `guardarProducto()`, `eliminarCategoria()`, `exportarInventarioCompleto()`, `importarInventario()`  
**Ventaja:** Puedes conectar proveedores externos o sincronizar con tienda online vía API.

#### `estadisticas.js` — Módulo 5: Reportes
**Funciones clave:** `calcularEstadisticas(rango)`, `exportarReporteVentas()`, `verDetalleFactura(id)`, `buscarFacturasPorTermino()`  
**Gráficos:** ventas por día (barras), métodos de pago (doughnut), distribución por hora (línea), top 10 productos.  
**Ventaja:** Reportes pesados no bloquean el POS al estar separados.

#### `config.js` — Configuración
**Gestiona:** ITBIS, NCF, logo del negocio, empleados, WhatsApp, impresora térmica, modo prueba.

#### `whatsapp.js` — WhatsApp
Genera mensajes de factura en formato rico con emojis y los envía via `wa.me/`.

#### `barcode-scanner.js` — Escáner
- **Lector USB/BT:** intercepta globalmente el input rápido de teclado (HID).
- **Cámara:** usa `BarcodeDetector API` (Chrome) con fallback a `jsQR`.

#### `virtual-keyboard.js` — Teclado Virtual
Teclado numérico flotante para inputs `.vk-input` en el POS. Evita que el teclado del sistema tape la pantalla en tablets.

---

## 🚀 Cómo agregar un nuevo módulo

1. Crea `js/modules/mi-modulo.js`
2. Escucha `micolmapp:negocio-listo` si necesitas datos del negocio:
   ```js
   import { AppState } from './app-state.js';
   window.addEventListener('micolmapp:negocio-listo', () => {
     // Tu código aquí
   });
   ```
3. Agrega el `<script type="module">` en `index.html` **después** de `config.js`.
4. Expón funciones en `window.*` si el HTML necesita llamarlas directamente.

---

## 🔒 Seguridad en Firestore

Las reglas recomendadas en `firestore.rules`:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Solo autenticados pueden leer/escribir su negocio
    match /negocios/{negocioId}/{document=**} {
      allow read, write: if request.auth != null &&
        (request.auth.uid == negocioId ||
         exists(/databases/$(database)/documents/negocios/$(negocioId)/empleados/$(request.auth.uid)));
    }
    // Datos de usuario
    match /usuarios/{userId} {
      allow read, write: if request.auth.uid == userId;
    }
  }
}
```

---

## 📋 Checklist de migración del archivo monolítico

- [x] `firebase-init.js` → configuración de Firebase
- [x] `app-state.js` → todas las variables `let` globales del script original
- [x] `utils.js` → `fmt()`, `toast()`, modales, `showScreen()`, `showPage()`, reloj, países
- [x] `offline.js` → cola de imágenes, `_fsOp()`, `comprimirImagen()`
- [x] `auth.js` → `login()`, `registrar()`, `mostrarSelectorNegocios()`, `entrarAlNegocio()`
- [x] `pos.js` → carrito, tabs, facturación, ticket, render de productos
- [x] `caja.js` → `abrirCaja()`, `cerrarCaja()`, gastos, ingresos, movimientos
- [x] `inventario.js` → categorías, productos, import/export, drag & drop
- [x] `estadisticas.js` → cálculos, gráficos Chart.js, historial, exportar CSV
- [x] `config.js` → datos del negocio, ITBIS, empleados, impresora
- [x] `whatsapp.js` → generación y envío de facturas
- [x] `barcode-scanner.js` → USB/BT y cámara
- [x] `virtual-keyboard.js` → teclado numérico flotante

---

*miColmApp — Hecho con ❤️ para los colmados de República Dominicana 🇩🇴*
