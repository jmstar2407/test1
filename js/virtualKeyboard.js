/**
 * virtualKeyboard.js
 * Teclado Touch Virtual para miColmApp
 * Módulo autónomo — se inicializa automáticamente al cargarse.
 *
 * Expone globalmente:
 *   vkbClose()          — cierra el teclado
 *   attachVkbToInput(id) — conecta el teclado a un <input> por su id
 *   initVkb()           — inicializa el teclado (se llama automáticamente)
 */

(function () {

  // ══════════════════════════════════════════════
  //  HTML del teclado — se inyecta en el <body>
  // ══════════════════════════════════════════════
  function injectHTML() {
    // Estilos para la nueva estructura main+numpad
    const style = document.createElement('style');
    style.id = 'vkb-layout-styles';
    style.textContent = `
      /* ── Wrapper principal: letras izq | numpad der ── */
      .vkb-body-wrap {
        display: flex;
        flex-direction: row;
        gap: clamp(5px, 0.8vw, 10px);
        width: 100%;
        flex: 1;
        min-height: 0;
      }

      /* ── Bloque letras: crece, columna de filas ── */
      .vkb-main-cols {
        display: flex;
        flex-direction: column;
        flex: 1;
        min-width: 0;
        gap: clamp(3px, 0.6vh, 7px);
      }

      /* Separador visual entre letras y numpad */
      .vkb-numpad-col::before {
        content: '';
        display: block;
        position: absolute;
        left: 0;
        top: 0;
        bottom: 0;
        width: 1px;
        background: rgba(148,163,184,0.18);
        border-radius: 1px;
      }

      /* ── Bloque numpad: ancho fijo para 3 teclas cuadradas ── */
.vkb-numpad-col {
    display: flex;
    flex-direction: column;
    flex: 0.22 0 auto;
    /* width: clamp(100px, 13vw, 292px); */
    gap: clamp(3px, 0.6vh, 7px);
    position: relative;
    padding-left: clamp(5px, 0.8vw, 10px);
}

      /* ── Fila del numpad ── */
      .vkb-numpad-row {
        display: flex;
        flex: 1;
        gap: clamp(3px, 0.5vw, 6px);
        min-height: 0;
      }

      /* ── Tecla individual del numpad ── */


      .vkb-numpad-key:active,
      .vkb-numpad-key.vkb-pressed {
        background: var(--vkb-key-pressed) !important;
        transform: scale(0.93) !important;
        box-shadow: none !important;
      }
    `;
    if (!document.getElementById('vkb-layout-styles')) {
      document.head.appendChild(style);
    }
    // Panel principal
    const panel = document.createElement('div');
    panel.id = 'vkb-panel';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'Teclado virtual');
    panel.innerHTML = `
      <div id="vkb-drag-handle" title="Arrastrar para mover">
        <div id="vkb-drag-dots"><span></span><span></span></div>
        <button id="vkb-x-close" title="Cerrar teclado"
          style="background:none;border:none;cursor:pointer;color:#94a3b8;font-size:1.2rem;line-height:1;padding:2px 6px;border-radius:6px;margin-left:auto;-webkit-tap-highlight-color:transparent;"
          onmouseover="this.style.color='#e03131'"
          onmouseout="this.style.color='#94a3b8'">✕</button>
      </div>
      <div id="vkb-field-label">Escribiendo en campo</div>
      <div class="vkb-rows" id="vkb-rows"></div>
      <div id="vkb-resize-handle" title="Redimensionar">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
          <path d="M11 1L1 11M11 6L6 11M11 11L11 11" stroke="#94a3b8" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </div>
    `;
    document.body.appendChild(panel);
  }

  // ══════════════════════════════════════════════
  //  State
  // ══════════════════════════════════════════════
  let vkbTarget      = null;
  let vkbShift       = false;
  let vkbCaps        = false;
  let vkbNumMode     = false;
  let vkbSymMode     = false;
  let vkbDarkTheme   = false;
  let vkbCursorPos   = 0;
  let vkbLastShiftTap = 0;
  let vkbPendingAccent = false;

  // ══════════════════════════════════════════════
  //  Layouts
  // ══════════════════════════════════════════════
  const LAYOUT_ES = [
    // Fila 1: qwerty (sin backspace) | numpad: 7 8 9
    {
      main: [{ l: 'q' }, { l: 'w' }, { l: 'e' }, { l: 'r' }, { l: 't' }, { l: 'y' }, { l: 'u' }, { l: 'i' }, { l: 'o' }, { l: 'p' }],
      num:  [{ l: '7' }, { l: '8' }, { l: '9' }]
    },
    // Fila 2: asdfg + ñ | numpad: 4 5 6
    {
      main: [{ l: 'a' }, { l: 's' }, { l: 'd' }, { l: 'f' }, { l: 'g' }, { l: 'h' }, { l: 'j' }, { l: 'k' }, { l: 'l' },
             { l: 'ñ', cls: 'vkb-eñe' }],
      num:  [{ l: '4' }, { l: '5' }, { l: '6' }]
    },
    // Fila 3: shift + zxcvbnm (sin , y .) | numpad: 1 2 3
    {
      main: [{ action: 'shift', label: '⇧', cls: 'vkb-shift', id: 'vkb-shift-btn' },
             { l: 'z' }, { l: 'x' }, { l: 'c' }, { l: 'v' }, { l: 'b' }, { l: 'n' }, { l: 'm' },
             { action: 'backspace', label: '⌫', cls: 'vkb-backspace' }],
      num:  [{ l: '1' }, { l: '2' }, { l: '3' }]
    },
    // Fila 4: controles + espacio + , + . + backspace + OK | numpad: # 0 -
    {
      main: [{ action: 'symToggle', label: '#+=', cls: 'vkb-num-toggle' },
             { action: 'themeToggle', label: '🌙', cls: 'vkb-theme-toggle' },
             { action: 'space', label: 'Espacio', cls: 'vkb-space' },
             { l: ',' },
             { l: '.' }],
      num:  [{ l: '#', cls: 'number_j1' }, { l: '0' }, { l: '-' }]
    }
  ];

  const LAYOUT_SYM = [
    // Fila 1 símbolos
    [{ l: '!' }, { l: '"' }, { l: '#' }, { l: '$' }, { l: '%' }, { l: '&' }, { l: '/' }, { l: '(' }, { l: ')' }, { l: '=' },
      { action: 'backspace', label: '⌫', cls: 'vkb-backspace' }],
    // Fila 2 símbolos
    [{ l: '@' }, { l: '_' }, { l: '-' }, { l: '+' }, { l: '*' }, { l: '/' }, { l: '\\' }, { l: '|' }, { l: '<' }, { l: '>' }],
    // Fila 3 símbolos
    [{ l: '[' }, { l: ']' }, { l: '{' }, { l: '}' }, { l: '^' }, { l: '~' }, { l: '`' }, { l: '\'' }, { l: '"' }, { l: ';' }],
    // Fila 4 símbolos
    [{ l: ',' }, { l: '.' }, { l: ':' }, { l: '?' }, { l: '¿' }, { l: '¡' }, { l: '°' }, { l: '©' }, { l: '®' }, { l: '€' }],
    // Fila 5 símbolos
    [{ action: 'symToggle', label: 'ABC', cls: 'vkb-num-toggle' },
      { action: 'themeToggle', label: '🌙', cls: 'vkb-theme-toggle' },
      { action: 'space', label: 'Espacio', cls: 'vkb-space' },
      { action: 'enter', label: '↵ OK', cls: 'vkb-enter' }]
  ];

  const LAYOUT_NUM = [
    [{ l: '1' }, { l: '2' }, { l: '3' }, { action: 'backspace', label: '⌫', cls: 'vkb-backspace' }],
    [{ l: '4' }, { l: '5' }, { l: '6' }, { l: '.', s: ',' }],
    [{ l: '7' }, { l: '8' }, { l: '9' }, { l: '-' }],
    [{ l: '0' }, { l: ',' }, { l: '@' }, { action: 'enter', label: '↵ OK', cls: 'vkb-enter' }],
    [{ action: 'numToggle', label: 'ABC', cls: 'vkb-num-toggle', id: 'vkb-num-toggle-btn' },
      { action: 'themeToggle', label: '🌙', cls: 'vkb-theme-toggle' },
      { action: 'space', label: 'Espacio', cls: 'vkb-space' }]
  ];

  // ══════════════════════════════════════════════
  //  Render teclado
  // ══════════════════════════════════════════════
  function renderKeyboard() {
    const rows = document.getElementById('vkb-rows');
    rows.innerHTML = '';
    let layout;
    if (vkbNumMode)       layout = LAYOUT_NUM;
    else if (vkbSymMode)  layout = LAYOUT_SYM;
    else                  layout = LAYOUT_ES;

    // Detectar si es el nuevo formato {main, num} o el antiguo array plano
    const isNewFormat = layout.length > 0 && !Array.isArray(layout[0]);

    if (isNewFormat) {
      // ── Nuevo formato: teclado letras (izquierda) + numpad (derecha) ──
      // Estructura: vkb-body-wrap > vkb-main-cols + vkb-numpad-col
      const bodyWrap = document.createElement('div');
      bodyWrap.className = 'vkb-body-wrap';

      const mainCols = document.createElement('div');
      mainCols.className = 'vkb-main-cols';

      const numpadCol = document.createElement('div');
      numpadCol.className = 'vkb-numpad-col';

      layout.forEach(rowDef => {
        // Fila de letras
        const row = document.createElement('div');
        row.className = 'vkb-row';
        rowDef.main.forEach(k => {
          row.appendChild(_makeKey(k));
        });
        mainCols.appendChild(row);

        // Fila del numpad (3 teclas por fila)
        const numRow = document.createElement('div');
        numRow.className = 'vkb-row vkb-numpad-row';
        rowDef.num.forEach(k => {
          const btn = _makeKey(k);
          btn.classList.add('vkb-numpad-key');
          numRow.appendChild(btn);
        });
        numpadCol.appendChild(numRow);
      });

      bodyWrap.appendChild(mainCols);
      bodyWrap.appendChild(numpadCol);
      rows.appendChild(bodyWrap);

    } else {
      // ── Formato antiguo: filas planas (LAYOUT_SYM, LAYOUT_NUM) ──
      layout.forEach(rowKeys => {
        const row = document.createElement('div');
        row.className = 'vkb-row';
        rowKeys.forEach(k => row.appendChild(_makeKey(k)));
        rows.appendChild(row);
      });
    }
  }

  // Construye un botón de tecla a partir de su definición
  function _makeKey(k) {
    const btn = document.createElement('button');
    btn.className = 'vkb-key ' + (k.cls || '');
    if (k.id) btn.id = k.id;

    let label = k.label || k.l || '';

    if (k.action === 'themeToggle') {
      label = vkbDarkTheme ? '☀️' : '🌙';
    }

    if (!k.action && !k.numRow && (vkbShift || vkbCaps) && k.l) {
      if (k.s && (vkbShift || vkbCaps)) label = k.s;
      else label = k.l.toUpperCase();
    }

    btn.textContent = label;
    if (k.action === 'shift' && (vkbShift || vkbCaps)) btn.classList.add('active');

    btn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      btn.classList.add('vkb-pressed');
      handleKey(k);
      setTimeout(() => btn.classList.remove('vkb-pressed'), 120);
    });

    return btn;
  }

  // ══════════════════════════════════════════════
  //  Manejar tecla
  // ══════════════════════════════════════════════
  function handleKey(k) {
    if (!vkbTarget) return;

    if (k.action === 'backspace') {
      if (document.activeElement !== vkbTarget) {
        vkbTarget.focus({ preventScroll: true });
      }
      syncCursor();
      if (vkbCursorPos > 0) {
        const val = vkbTarget.value;
        vkbTarget.value = val.slice(0, vkbCursorPos - 1) + val.slice(vkbCursorPos);
        vkbCursorPos--;
        vkbTarget.setSelectionRange(vkbCursorPos, vkbCursorPos);
        triggerInput(vkbTarget);
        // Auto-mayúscula si el campo queda vacío
        if (vkbTarget.value.length === 0 && !vkbCaps) {
          vkbShift = true;
          renderKeyboard();
        }
      }
      return;
    }

    if (k.action === 'enter')  { vkbClose(); return; }

    if (k.action === 'space')  { insertChar(' '); return; }

    if (k.action === 'shift') {
      const now = Date.now();
      if (now - vkbLastShiftTap < 350) {
        vkbCaps  = !vkbCaps;
        vkbShift = false;
      } else {
        vkbShift = !vkbShift;
        vkbCaps  = false;
      }
      vkbLastShiftTap = now;
      renderKeyboard();
      return;
    }

    if (k.action === 'numToggle') {
      vkbNumMode = !vkbNumMode;
      vkbSymMode = false;
      renderKeyboard();
      return;
    }

    if (k.action === 'symToggle') {
      vkbSymMode = !vkbSymMode;
      vkbNumMode = false;
      renderKeyboard();
      return;
    }

    if (k.action === 'themeToggle') {
      vkbDarkTheme = !vkbDarkTheme;
      const panel = document.getElementById('vkb-panel');
      panel.classList.toggle('vkb-dark', vkbDarkTheme);
      renderKeyboard();
      return;
    }

    if (k.action === 'accent') {
      vkbPendingAccent = true;
      return;
    }

    // Teclas normales — fila numérica siempre inserta el carácter base
    let char;
    if (k.numRow) {
      char = k.l || '';
    } else {
      if ((vkbShift || vkbCaps) && k.s) char = k.s;
      else char = (vkbShift || vkbCaps) ? (k.l || '').toUpperCase() : (k.l || '');
    }

    // Acento pendiente
    if (vkbPendingAccent) {
      const acentos = { a: 'á', e: 'é', i: 'í', o: 'ó', u: 'ú', A: 'Á', E: 'É', I: 'Í', O: 'Ó', U: 'Ú' };
      char = acentos[char] || char;
      vkbPendingAccent = false;
    }

    insertChar(char);

    if (vkbShift && !vkbCaps) {
      vkbShift = false;
      renderKeyboard();
    }
  }

  // ══════════════════════════════════════════════
  //  Helpers de texto
  // ══════════════════════════════════════════════
  // Sincroniza vkbCursorPos con la posición real del cursor en el input.
  // Fuente de verdad: selectionStart del input (refleja teclado físico, clicks, etc.)
  function syncCursor() {
    if (!vkbTarget) return;
    const pos = vkbTarget.selectionStart;
    if (typeof pos !== 'number') return;
    // Solo sobreescribir vkbCursorPos si el input tiene foco activo,
    // o si pos > 0 (un 0 con el input sin foco es unreliable).
    // Evita que selectionStart=0 (reset del browser al perder foco) corrompa la posición.
    if (document.activeElement === vkbTarget || pos > 0) {
      vkbCursorPos = pos;
    }
  }

  function insertChar(char) {
    if (!vkbTarget) return;
    // Asegurar que el input tenga foco antes de manipular cursor
    // (si el usuario tocó fuera y volvió, el input puede no tenerlo)
    if (document.activeElement !== vkbTarget) {
      vkbTarget.focus({ preventScroll: true });
    }
    syncCursor();
    const val = vkbTarget.value;
    vkbTarget.value = val.slice(0, vkbCursorPos) + char + val.slice(vkbCursorPos);
    vkbCursorPos++;
    vkbTarget.setSelectionRange(vkbCursorPos, vkbCursorPos);
    triggerInput(vkbTarget);
  }

  function triggerInput(el) {
    // El evento input activa el listener de _syncClearBtn automáticamente
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }

  function updatePreview() { /* preview bar removed — text updates directly in the input */ }

  // ══════════════════════════════════════════════
  //  DRAG & RESIZE + PERSISTENCIA
  // ══════════════════════════════════════════════
  const STORAGE_KEY = 'vkb_layout';

  function saveLayout() {
    const p    = document.getElementById('vkb-panel');
    const rect = p.getBoundingClientRect();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        left: rect.left, top: rect.top,
        width: rect.width, height: rect.height
      }));
    } catch (e) { /* silencioso */ }
  }

  function applyLayout(panel, layout) {
    const vw = window.innerWidth, vh = window.innerHeight;
    const w  = Math.max(400, Math.min(layout.width  || 1020, Math.min(vw - 10, 1280)));
    const h  = Math.max(240, Math.min(layout.height || 320, 650));
    const left = Math.max(0, Math.min(layout.left, vw - w));
    const top  = Math.max(0, Math.min(layout.top,  vh - 80));

    panel.style.left      = left + 'px';
    panel.style.top       = top  + 'px';
    panel.style.bottom    = 'auto';
    panel.style.width     = w    + 'px';
    if (layout.height) panel.style.height = h + 'px';
    panel.style.transform  = 'none';
    panel.style.transition = ''; // ← limpiar para que el CSS tome el control
  }

  function loadLayout(panel) {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const layout = JSON.parse(raw);
      if (typeof layout.left === 'number') {
        applyLayout(panel, layout);
        return true;
      }
    } catch (e) { /* silencioso */ }
    return false;
  }

  function initDragAndResize() {
    const panel        = document.getElementById('vkb-panel');
    const dragHandle   = document.getElementById('vkb-drag-handle');
    const resizeHandle = document.getElementById('vkb-resize-handle');

    // ── Botón X cerrar — funciona en touch y mouse ──
    const xClose = document.getElementById('vkb-x-close');
    if (xClose) {
      xClose.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        vkbClose();
      });
    }

    // ── DRAG ──
    let dragging = false, dStartX, dStartY, dOrigLeft, dOrigTop;

    function onDragStart(e) {
      dragging = true;
      panel.classList.add('vkb-dragging');
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = panel.getBoundingClientRect();
      panel.style.left       = rect.left + 'px';
      panel.style.top        = rect.top  + 'px';
      panel.style.bottom     = 'auto';
      panel.style.transform  = 'none';
      panel.style.transition = 'none';
      dStartX  = clientX;
      dStartY  = clientY;
      dOrigLeft = rect.left;
      dOrigTop  = rect.top;
      e.preventDefault();
    }

    function onDragMove(e) {
      if (!dragging) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - dStartX;
      const dy = clientY - dStartY;
      const vw = window.innerWidth, vh = window.innerHeight;
      const w  = panel.offsetWidth,  h  = panel.offsetHeight;
      panel.style.left = Math.max(0, Math.min(dOrigLeft + dx, vw - w)) + 'px';
      panel.style.top  = Math.max(0, Math.min(dOrigTop  + dy, vh - 60)) + 'px';
    }

    function onDragEnd() {
      if (!dragging) return;
      dragging = false;
      panel.classList.remove('vkb-dragging');
      panel.style.transition = ''; // restaurar transición CSS
      saveLayout();
    }

    dragHandle.addEventListener('mousedown',  onDragStart);
    document.addEventListener('mousemove',    (e) => { if (dragging)  onDragMove(e); });
    document.addEventListener('mouseup',      onDragEnd);
    dragHandle.addEventListener('touchstart', onDragStart, { passive: false });
    document.addEventListener('touchmove',    (e) => { if (dragging)  onDragMove(e); }, { passive: false });
    document.addEventListener('touchend',     onDragEnd);

    // ── RESIZE ──
    let resizing = false, rStartX, rStartY, rOrigW, rOrigH;

    function onResizeStart(e) {
      resizing = true;
      panel.classList.add('vkb-dragging');
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const rect = panel.getBoundingClientRect();
      panel.style.left       = rect.left + 'px';
      panel.style.top        = rect.top  + 'px';
      panel.style.bottom     = 'auto';
      panel.style.transform  = 'none';
      panel.style.transition = 'none';
      rStartX = clientX;
      rStartY = clientY;
      rOrigW  = rect.width;
      rOrigH  = rect.height;
      e.preventDefault();
      e.stopPropagation();
    }

    function onResizeMove(e) {
      if (!resizing) return;
      const clientX = e.touches ? e.touches[0].clientX : e.clientX;
      const clientY = e.touches ? e.touches[0].clientY : e.clientY;
      const dx = clientX - rStartX;
      const dy = clientY - rStartY;
      panel.style.width  = Math.max(420, Math.min(rOrigW + dx, Math.min(window.innerWidth  - 10, 1280))) + 'px';
      panel.style.height = Math.max(240, Math.min(rOrigH + dy, Math.min(window.innerHeight - 20, 650)))  + 'px';
    }

    function onResizeEnd() {
      if (!resizing) return;
      resizing = false;
      panel.classList.remove('vkb-dragging');
      panel.style.transition = ''; // restaurar transición CSS
      saveLayout();
    }

    resizeHandle.addEventListener('mousedown',  onResizeStart);
    document.addEventListener('mousemove',      (e) => { if (resizing) onResizeMove(e); });
    document.addEventListener('mouseup',        onResizeEnd);
    resizeHandle.addEventListener('touchstart', onResizeStart, { passive: false });
    document.addEventListener('touchmove',      (e) => { if (resizing) onResizeMove(e); }, { passive: false });
    document.addEventListener('touchend',       onResizeEnd);
  }

  // ══════════════════════════════════════════════
  //  Cerrar al tocar/hacer click fuera
  //  Estrategia: ocultar el panel momentáneamente,
  //  encontrar el elemento real debajo del toque
  //  con elementFromPoint, y dispararle un click.
  // ══════════════════════════════════════════════
  // IDs de elementos que NO deben cerrar el teclado al tocarse
  // (botones de limpiar input u otros controles asociados al campo activo)
  const VKB_NO_CLOSE_IDS = new Set(['pos-buscar-clear', 'pos-dir-clear']);

  function _isProtectedTarget(el) {
    if (!el) return false;
    // Verificar el elemento y sus ancestros inmediatos
    let node = el;
    for (let i = 0; i < 4; i++) {
      if (!node) break;
      if (node.id && VKB_NO_CLOSE_IDS.has(node.id)) return true;
      node = node.parentElement;
    }
    return false;
  }

  function initOutsideClick() {
    // Usamos 'pointerdown' en fase de captura para detectar el toque antes
    // de que el navegador lo entregue al elemento destino.
    document.addEventListener('pointerdown', (e) => {
      const panel = document.getElementById('vkb-panel');
      if (!panel || !panel.classList.contains('vkb-open')) return;
      // Toque dentro del panel del teclado → ignorar
      if (panel.contains(e.target)) return;
      // Toque en el input activo → ignorar
      if (vkbTarget && vkbTarget.contains(e.target)) return;
      // Toque en elemento protegido (ej: botón limpiar) → no cerrar
      if (_isProtectedTarget(e.target)) return;

      // Cierre del teclado: simplemente lo ocultamos y dejamos que el evento
      // nativo (pointerdown → click) llegue al elemento real por sí solo.
      // NO disparamos .click() manualmente para evitar el doble disparo.
      vkbClose();
    }, true);
  }

  // Permite registrar IDs adicionales como protegidos desde fuera del módulo
  window.vkbProtectElement = (id) => VKB_NO_CLOSE_IDS.add(id);

  // ══════════════════════════════════════════════
  //  Abrir / Cerrar
  // ══════════════════════════════════════════════
  function vkbOpen(inputEl, forcedPos) {
    // Respetar el toggle de teclado virtual
    if (window._vkEnabled === false) return;
    vkbTarget        = inputEl;
    // forcedPos: posición guardada ANTES del trick readonly (evita que el browser la resetee a 0)
    // Si no se pasa, leer selectionStart; si aun así es 0 con texto, ir al final
    let realPos;
    if (typeof forcedPos === 'number') {
      realPos = forcedPos;
    } else {
      const raw = (typeof inputEl.selectionStart === 'number') ? inputEl.selectionStart : inputEl.value.length;
      // Si el browser devolvió 0 pero hay texto, el cursor probablemente fue reseteado → ir al final
      realPos = (raw === 0 && inputEl.value.length > 0) ? inputEl.value.length : raw;
    }
    vkbCursorPos     = realPos;
    inputEl.setSelectionRange(realPos, realPos);
    vkbShift         = inputEl.value.length === 0; // mayúscula automática si vacío
    vkbCaps          = false;
    vkbNumMode       = false;
    vkbSymMode       = false;
    vkbPendingAccent = false;

    const label = document.getElementById('vkb-field-label');
    if (inputEl.id === 'pos-buscar') {
      label.textContent  = '🔍 Buscar productos';
      label.style.display = 'block';
    } else if (inputEl.id === 'pos-direccion-cliente') {
      label.textContent  = '📍 Dirección del cliente';
      label.style.display = 'block';
    } else {
      label.style.display = 'none';
    }

    renderKeyboard();
    updatePreview();

    const panel = document.getElementById('vkb-panel');
    const hadLayout = loadLayout(panel);

    if (!hadLayout) {
      // Posición por defecto: centrado, cerca del borde inferior
      panel.style.transform  = '';
      panel.style.left       = '50%';
      panel.style.top        = '';
      panel.style.bottom     = '20px';
      panel.style.width      = '1020px';
      panel.style.height     = '';
    }

    // Cancelar cualquier cierre en curso
    if (panel._closeTimer) {
      clearTimeout(panel._closeTimer);
      panel._closeTimer = null;
    }

    panel.classList.add('vkb-open');
  }
  window.vkbClose = function () {
    const panel   = document.getElementById('vkb-panel');
    panel.classList.remove('vkb-open');
    vkbTarget = null;
  };

  // Exponer cursor reset para uso externo (ej: botón limpiar input)
  Object.defineProperty(window, 'vkbCursorPos', {
    get: () => vkbCursorPos,
    set: (v) => { vkbCursorPos = v; },
    configurable: true
  });

  // ══════════════════════════════════════════════
  //  Conectar el teclado a un <input> por su id
  // ══════════════════════════════════════════════
  function attachVkbToInput(inputId) {
    const el = document.getElementById(inputId);
    if (!el) return;

    el.addEventListener('focus', (e) => {
      e.preventDefault();
      // Si el teclado ya está abierto para este input (ej: insertChar hizo .focus())
      // no re-abrir: solo causaría un reset de vkbCursorPos innecesario
      const panel = document.getElementById('vkb-panel');
      if (panel.classList.contains('vkb-open') && vkbTarget === el) return;
      // Guardar posición ANTES de poner readonly (el browser la resetea después)
      const savedPos = (typeof el.selectionStart === 'number') ? el.selectionStart : el.value.length;
      el.setAttribute('readonly', 'readonly');
      requestAnimationFrame(() => {
        el.removeAttribute('readonly');
        vkbOpen(el, savedPos);
      });
    });

    el.addEventListener('touchstart', (e) => {
      const panel = document.getElementById('vkb-panel');
      if (panel.classList.contains('vkb-open') && vkbTarget === el) return;
      e.preventDefault();
      // Guardar posición ANTES de poner readonly (el browser la resetea después)
      const savedPos = (typeof el.selectionStart === 'number') ? el.selectionStart : el.value.length;
      el.setAttribute('readonly', 'readonly');
      requestAnimationFrame(() => {
        el.removeAttribute('readonly');
        vkbOpen(el, savedPos);
      });
    }, { passive: false });

    // ── Sincronización bidireccional del cursor ──────────────────────────
    // Cuando el usuario escribe con teclado físico, vkbCursorPos debe seguir
    // la posición real del cursor para que la próxima tecla virtual inserte
    // exactamente donde está la rayita.
    const syncIfActive = () => {
      if (vkbTarget === el && typeof el.selectionStart === 'number') {
        vkbCursorPos = el.selectionStart;
      }
    };

    // keyup: después de cada tecla física el cursor ya está en la nueva posición
    el.addEventListener('keyup', syncIfActive);
    // click/pointerup: el usuario reposicionó el cursor con el dedo/mouse
    el.addEventListener('pointerup', syncIfActive);
    // selectionchange (algunos browsers): cubre flechas del teclado, home/end, etc.
    el.addEventListener('selectionchange', syncIfActive);
  }

  // Exponer para uso externo (agregar inputs adicionales desde el HTML)
  window.attachVkbToInput = attachVkbToInput;

  // ══════════════════════════════════════════════
  //  Init
  // ══════════════════════════════════════════════
  function initVkb() {
    // Inyectar HTML si no existe ya
    if (!document.getElementById('vkb-panel')) {
      injectHTML();
    }
    attachVkbToInput('pos-buscar');
    attachVkbToInput('pos-direccion-cliente');
    initDragAndResize();
    initOutsideClick();

    // Sincronizar cursor cuando el foco está en el input activo y el usuario
    // mueve la rayita con las teclas de flecha del teclado físico
    document.addEventListener('selectionchange', () => {
      if (!vkbTarget) return;
      const active = document.activeElement;
      if (active === vkbTarget && typeof vkbTarget.selectionStart === 'number') {
        vkbCursorPos = vkbTarget.selectionStart;
      }
    });
  }

  window.initVkb = initVkb;

  // Auto-inicializar
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initVkb);
  } else {
    initVkb();
  }
  // Segundo intento diferido por si el DOM aún no tuvo tiempo de renderizar
  setTimeout(initVkb, 1500);

})();