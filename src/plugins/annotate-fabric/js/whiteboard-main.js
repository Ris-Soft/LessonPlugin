import { loadScript, fit, getPointerScreen, getPointerCanvas, download } from './whiteboard-utils.js';
import { createHistory } from './whiteboard-history.js';

(async () => {
  let fabric = window.fabric || null;
  const params = new URLSearchParams(location.search || '');
  const showCloseParam = params.get('showClose');
  const showMinParam = params.get('showMinimize');
  const showSaveParam = params.get('showSave');
  const persistKey = params.get('persistKey');
  const persistFile = params.get('persistFile');
  if (!fabric || typeof fabric.Canvas !== 'function') {
    const candidates = ['./fabric.min.js'];
    let ok = false;
    for (const p of candidates) { try { await loadScript(p); ok = true; break; } catch {} }
    fabric = ok ? window.fabric : null;
  }
  if (!fabric || typeof fabric.Canvas !== 'function') { alert('Fabric.js 加载失败，请安装依赖或检查路径'); return; }
  let erase2d = null;
  try {
    const mod = await import('../erase2d/erase2d-brush.js');
    erase2d = mod;
    if (mod && mod.EraserBrush && !fabric.EraserBrush) { fabric.EraserBrush = mod.EraserBrush; }
  } catch {}
  if (!fabric.EraserBrush) {
    class EraserBrush extends fabric.PencilBrush {
      constructor(canvas) { super(canvas); this.inverted = false; }
      _setBrushStyles(ctx = this.canvas.contextTop) { super._setBrushStyles(ctx); ctx.strokeStyle = 'black'; }
      createPath(pathData) {
        const path = super.createPath(pathData);
        const alpha = new fabric.Color(this.color).getAlpha();
        path.set({ globalCompositeOperation: 'destination-out', stroke: 'black', opacity: alpha, shadow: null, strokeUniform: true });
        return path;
      }
    }
    fabric.EraserBrush = EraserBrush;
  }
  const board = document.getElementById('board');
  board.style.position = 'relative';
  const el = document.createElement('canvas');
  el.style.position = 'absolute'; el.style.inset = '0';
  board.appendChild(el);
  const canvas = new fabric.Canvas(el, { isDrawingMode: true, selection: false, backgroundColor: 'transparent', preserveObjectStacking: true });
  try { canvas.setBackgroundColor('#121212', () => { if (canvas.requestRenderAll) canvas.requestRenderAll(); }); } catch {}
  window.addEventListener('resize', () => fit(board, canvas));
  window.addEventListener('load', () => fit(board, canvas));
  setTimeout(() => fit(board, canvas), 0);

  const state = { mode: 'draw', twoFingerPan: false, eraseSize: 80, pages: [], pageIndex: 0, bgColor: '#121212', pageThumbs: [], pageHistories: [], pageHistoryIndex: [] };

  const popup = document.getElementById('popup');
  const penSettings = document.getElementById('penSettings');
  const eraserSettings = document.getElementById('eraserSettings');
  const savePanel = document.getElementById('savePanel');
  const boardSettingsPanel = document.getElementById('boardSettingsPanel');
  const btnClose = document.getElementById('btnClose');
  const btnMin = document.getElementById('btnMin');
  const btnSave = document.getElementById('btnSave');
  const btnDraw = document.getElementById('modeDraw');
  const btnErase = document.getElementById('modeErase');
  const btnPan = document.getElementById('modePan');
  const penColor = document.getElementById('penColor');
  const penWidths = document.getElementById('penWidths');
  const eraseSizes = document.getElementById('eraseSizes');
  const invertEraseBtn = document.getElementById('invertErase');
  const penPalette = document.getElementById('penPalette');
  const paletteBtns = penPalette ? penPalette.querySelectorAll('button[data-color]') : [];
  const undoBtn = document.getElementById('undoBtn');
  const redoBtn = document.getElementById('redoBtn');

  function showPopup(which, anchorEl) {
    penSettings.style.display = which === 'pen' ? 'flex' : 'none';
    eraserSettings.style.display = which === 'eraser' ? 'flex' : 'none';
    boardSettingsPanel.style.display = which === 'board' ? 'flex' : 'none';
    savePanel.style.display = which === 'save' ? 'flex' : 'none';
    popup.style.display = 'flex';
    try {
      const defaultId = which === 'pen' ? 'modeDraw' : (which === 'eraser' ? 'modeErase' : (which === 'board' ? 'boardSettings' : 'btnSave'));
      const rect = anchorEl ? anchorEl.getBoundingClientRect() : document.getElementById(defaultId).getBoundingClientRect();
      const px = Math.max(12, rect.left);
      const ph = popup.offsetHeight || 48;
      const py = Math.max(12, rect.top - ph - 20);
      popup.style.left = px + 'px';
      popup.style.top = py + 'px';
    } catch {}
  }
  function hidePopup() { popup.style.display = 'none'; }
  document.addEventListener('mousedown', (e) => {
    try {
      if (popup.style.display === 'flex') {
        const within = popup.contains(e.target) || document.getElementById('modeDraw').contains(e.target) || document.getElementById('modeErase').contains(e.target);
        if (!within) hidePopup();
      }
    } catch {}
  });

  let currentBrush = null;
  let eraseInverted = false;
  function setMode(m) {
    state.mode = m;
    document.getElementById('modeDraw').classList.toggle('active', m==='draw');
    document.getElementById('modeSelect').classList.toggle('active', m==='select');
    document.getElementById('modePan').classList.toggle('active', m==='pan');
    document.getElementById('modeErase').classList.toggle('active', m==='erase');
  if (m === 'draw') {
    canvas.isDrawingMode = true;
    canvas.selection = false;
    canvas.getObjects().forEach(o => o.selectable = false);
    if (!(currentBrush instanceof fabric.PencilBrush)) {
      try { currentBrush = new fabric.PencilBrush(canvas); } catch { try { currentBrush = new fabric.PencilBrush({ canvas }); } catch {} }
      if (!currentBrush) currentBrush = new fabric.PencilBrush(canvas);
      currentBrush.decimate = 2;
    }
    currentBrush.color = penColor.value;
    currentBrush.width = currentPenWidth;
    canvas.freeDrawingBrush = currentBrush;
    hidePopup();
  } else if (m === 'select') {
      canvas.isDrawingMode = false;
      canvas.selection = true;
      canvas.skipTargetFind = false;
      canvas.getObjects().forEach(o => {
        const isEraser = (o.isEraser === true) || (o.globalCompositeOperation === 'destination-out');
        o.selectable = !isEraser;
        o.evented = !isEraser;
        o.lockMovementX = false;
        o.lockMovementY = false;
      });
      hidePopup();
    } else if (m === 'pan') {
      canvas.isDrawingMode = false;
      canvas.selection = false;
      canvas.getObjects().forEach(o => o.selectable = false);
      canvas.skipTargetFind = true;
      hidePopup();
    } else if (m === 'erase') {
      canvas.selection = false;
      canvas.skipTargetFind = true;
      canvas.getObjects().forEach(o => { o.selectable = false; o.erasable = true; });
      try { canvas.discardActiveObject(); } catch {}
      let eBrush = null;
      try { if (fabric && fabric.EraserBrush) eBrush = new fabric.EraserBrush(canvas); } catch {}
      if (eBrush) {
        eBrush.width = Number(state.eraseSize) || 80;
        eBrush.strokeLineCap = 'round';
        eBrush.strokeLineJoin = 'round';
        eBrush.inverted = eraseInverted;
        eBrush.shadow = null;
        canvas.freeDrawingBrush = eBrush;
        canvas.isDrawingMode = true;
      } else {
        canvas.isDrawingMode = false;
      }
      if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll();
      showPopup('eraser');
    }
  }

  let brush = null;
  try { brush = new fabric.PencilBrush(canvas); } catch { try { brush = new fabric.PencilBrush({ canvas }); } catch {} }
  if (!brush) brush = new fabric.PencilBrush(canvas);
  brush.color = '#ffffff';
  brush.width = 6;
  brush.decimate = 2;
  canvas.freeDrawingBrush = brush;

  function updatePenPaletteSelection() {
    try {
      const cur = String(penColor.value || '').toLowerCase();
      paletteBtns.forEach((b) => {
        const c = String(b.getAttribute('data-color') || '').toLowerCase();
        b.style.outline = c === cur ? '2px solid #fff' : 'none';
      });
    } catch {}
  }
  penColor.addEventListener('input', () => { canvas.freeDrawingBrush.color = penColor.value; });
  penColor.addEventListener('input', () => { updatePenPaletteSelection(); });
  paletteBtns.forEach((b) => {
    b.addEventListener('click', () => {
      const c = b.getAttribute('data-color');
      if (!c) return;
      penColor.value = c;
      try { if (canvas.freeDrawingBrush) canvas.freeDrawingBrush.color = c; } catch {}
      updatePenPaletteSelection();
    });
  });

  let currentPenWidth = 6;
  const penWidthButtons = penWidths ? penWidths.querySelectorAll('button[data-penw]') : [];
  penWidthButtons.forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.getAttribute('data-penw'));
      currentPenWidth = v;
      penWidthButtons.forEach(x => x.classList.toggle('active', x === b));
      try { if (state.mode === 'draw' && canvas.freeDrawingBrush) canvas.freeDrawingBrush.width = v; } catch {}
    });
  });
  const eraseSizeButtons = eraseSizes ? eraseSizes.querySelectorAll('button[data-erasesz]') : [];
  eraseSizeButtons.forEach((b) => {
    b.addEventListener('click', () => {
      const v = Number(b.getAttribute('data-erasesz'));
      state.eraseSize = v;
      eraseSizeButtons.forEach(x => x.classList.toggle('active', x === b));
      resizeEraseCursor(state.eraseSize);
      try {
        if (state.mode === 'erase' && fabric && fabric.EraserBrush && canvas.freeDrawingBrush && (canvas.freeDrawingBrush instanceof fabric.EraserBrush)) {
          canvas.freeDrawingBrush.width = state.eraseSize;
        }
      } catch {}
    });
  });
  if (invertEraseBtn) invertEraseBtn.addEventListener('click', () => {
    eraseInverted = !eraseInverted;
    invertEraseBtn.classList.toggle('active', eraseInverted);
    try {
      if (state.mode === 'erase' && canvas.freeDrawingBrush && (canvas.freeDrawingBrush instanceof fabric.EraserBrush)) {
        canvas.freeDrawingBrush.inverted = eraseInverted;
      }
    } catch {}
  });

  if (btnClose) btnClose.style.display = (showCloseParam === '0') ? 'none' : 'inline-flex';
  if (btnMin) btnMin.style.display = (showMinParam === '0') ? 'none' : 'inline-flex';
  if (btnSave) btnSave.style.display = (showSaveParam === '0') ? 'none' : 'inline-flex';
  if (btnClose) btnClose.addEventListener('click', () => { try { if (window.annotateAPI && typeof window.annotateAPI.close === 'function') { window.annotateAPI.close(); } else { window.close(); } } catch {} });
  if (btnMin) btnMin.addEventListener('click', () => {
    try {
      savePageSnapshot(); savePackIfNeeded();
      const raw = JSON.stringify({ pages: state.pages, bg: state.bgColor });
      if (window.annotateAPI && typeof window.annotateAPI.saveJSON === 'function') {
        window.annotateAPI.saveJSON(persistFile, raw);
      }
      if (window.annotateAPI && typeof window.annotateAPI.close === 'function') { window.annotateAPI.close(); } else { window.close(); }
    } catch {}
  });
  if (btnSave) btnSave.addEventListener('click', () => { if (popup.style.display === 'flex' && savePanel.style.display === 'flex') { hidePopup(); } else { showPopup('save', btnSave); } });

  btnDraw.addEventListener('click', (ev) => { if (state.mode !== 'draw') { setMode('draw'); hidePopup(); } else { if (popup.style.display === 'flex') hidePopup(); else showPopup('pen', btnDraw); } updateEraseCursorVis(); });
  document.getElementById('modeSelect').addEventListener('click', () => { hidePopup(); setMode('select'); updateEraseCursorVis(); });
  document.getElementById('modeErase').addEventListener('click', (ev) => { if (state.mode !== 'erase') { setMode('erase'); hidePopup(); } else { if (popup.style.display === 'flex') hidePopup(); else showPopup('eraser', btnErase); } updateEraseCursorVis(); });
  btnPan.addEventListener('click', () => { setMode('pan'); hidePopup(); updateEraseCursorVis(); });
  const boardSettingsBtn = document.getElementById('boardSettings');
  if (boardSettingsBtn) boardSettingsBtn.addEventListener('click', (ev) => { if (popup.style.display === 'flex' && boardSettingsPanel.style.display === 'flex') { hidePopup(); } else { showPopup('board', boardSettingsBtn); } });
  const toggleTwoFingerBtn = document.getElementById('toggleTwoFinger');
  if (toggleTwoFingerBtn) toggleTwoFingerBtn.addEventListener('click', () => { state.twoFingerPan = !state.twoFingerPan; toggleTwoFingerBtn.classList.toggle('active', state.twoFingerPan); });

  const eraseCursor = document.createElement('div');
  eraseCursor.id = 'eraseCursor';
  eraseCursor.style.position = 'absolute';
  eraseCursor.style.left = '0px';
  eraseCursor.style.top = '0px';
  eraseCursor.style.pointerEvents = 'none';
  board.appendChild(eraseCursor);
  function resizeEraseCursor(size) {
    const s = Math.max(10, Math.floor(Number(size) || 80));
    const bw = 2;
    eraseCursor.style.width = Math.max(2, s - bw * 2) + 'px';
    eraseCursor.style.height = Math.max(2, s - bw * 2) + 'px';
    eraseCursor.style.borderRadius = '50%';
    eraseCursor.style.border = bw + 'px solid #ffffff';
    eraseCursor.style.boxShadow = 'none';
    eraseCursor.style.mixBlendMode = 'normal';
    eraseCursor.style.background = 'transparent';
    eraseCursor.style.zIndex = '1000';
  }
  resizeEraseCursor(state.eraseSize);
  eraseCursor.style.display = 'none';
  const updateEraseCursorVis = () => { eraseCursor.style.display = (state.mode === 'erase') ? 'block' : 'none'; };

  canvas.on('path:created', (e) => {
    try {
      const p = e.path;
      if (!p) return;
      if (state.mode === 'draw') { p.erasable = true; }
      else if (state.mode === 'erase' && fabric && fabric.EraserBrush) { p.selectable = false; p.evented = false; p.isEraser = true; }
      try { if (state.mode === 'erase' && !history.restoring) history.recordHistory(); } catch {}
    } catch {}
  });

  function savePageSnapshot() {
    try {
      state.pages[state.pageIndex] = canvas.toJSON();
      try { const url = canvas.toDataURL({ format: 'png', multiplier: 0.2 }); state.pageThumbs[state.pageIndex] = url; } catch {}
    } catch {}
  }
  function getTotalPages() { return Math.max(state.pages.length, state.pageIndex + 1); }
  function updatePageLabel() { document.getElementById('pageLabel').textContent = `${state.pageIndex + 1}/${getTotalPages()}`; }
  function savePackIfNeeded() {
    try {
      const pack = { pages: state.pages, bg: state.bgColor };
      if (persistFile && window.annotateAPI && typeof window.annotateAPI.saveJSON === 'function') { window.annotateAPI.saveJSON(persistFile, JSON.stringify(pack)); }
      else if (persistKey) { localStorage.setItem('wb.persist.' + persistKey, JSON.stringify(pack)); }
    } catch {}
  }
  async function loadPackIfAny() {
    try {
      let raw = null;
      if (persistFile && window.annotateAPI && typeof window.annotateAPI.loadJSON === 'function') { raw = await window.annotateAPI.loadJSON(persistFile); }
      else if (persistKey) { raw = localStorage.getItem('wb.persist.' + persistKey); }
      if (!raw) return false;
      const obj = JSON.parse(raw);
      if (!obj || !Array.isArray(obj.pages)) return false;
      state.pages = obj.pages;
      state.pageThumbs = new Array(state.pages.length).fill(null);
      if (obj.bg) state.bgColor = obj.bg;
      return true;
    } catch { return false; }
  }
  function loadPageSnapshot(i) {
    const data = state.pages[i];
    canvas.clear();
  if (data) {
    canvas.loadFromJSON(data, () => {
      try { setBackgroundColor(state.bgColor, true); } catch {}
      canvas.renderAll();
      setMode(state.mode);
      updateEraseCursorVis();
      try { canvas.getObjects().forEach(o => { if (o && o.isEraser === true) { o.globalCompositeOperation = 'destination-out'; o.selectable = false; o.evented = false; } }); } catch {}
      if (state.mode === 'erase') {
          try {
            canvas.getObjects().forEach(o => { o.erasable = true; o.selectable = false; });
            let eBrush = null;
            try { eBrush = new fabric.EraserBrush(canvas); } catch {}
            if (eBrush) {
              eBrush.width = Number(state.eraseSize) || 80;
              eBrush.strokeLineCap = 'round';
              eBrush.strokeLineJoin = 'round';
              eBrush.inverted = eraseInverted;
              eBrush.shadow = null;
              canvas.freeDrawingBrush = eBrush;
              canvas.isDrawingMode = true;
              canvas.selection = false;
              canvas.skipTargetFind = true;
            }
            updateEraseCursorVis();
          } catch {}
        }
        setTimeout(() => { fit(board, canvas); if (canvas.requestRenderAll) canvas.requestRenderAll(); }, 0);
        const h = history.getCurrentHistory();
        if (h.arr.length === 0) { const snap = history.getCanvasJSON(); if (snap) { h.arr.push(snap); const pi = state.pageIndex; h.idxRef[pi] = h.arr.length - 1; } }
        history.updateUndoRedoUI();
      });
    } else {
      try { setBackgroundColor(state.bgColor, true); } catch {}
      if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll();
      if (state.mode === 'erase') {
        try {
          canvas.selection = false;
          canvas.skipTargetFind = true;
          let eBrush = null;
          try { eBrush = new fabric.EraserBrush(canvas); } catch {}
          if (eBrush) {
            eBrush.width = Number(state.eraseSize) || 80;
            eBrush.strokeLineCap = 'round';
            eBrush.strokeLineJoin = 'round';
            eBrush.inverted = eraseInverted;
            eBrush.shadow = null;
            canvas.freeDrawingBrush = eBrush;
            canvas.isDrawingMode = true;
          }
          updateEraseCursorVis();
        } catch {}
      }
      const h = history.getCurrentHistory(); if (h.arr.length === 0) { const snap = history.getCanvasJSON(); if (snap) { h.arr.push(snap); const pi = state.pageIndex; h.idxRef[pi] = h.arr.length - 1; } } history.updateUndoRedoUI();
    }
    updatePageLabel();
    try { if (!state.pageThumbs[i]) { const url = canvas.toDataURL({ format: 'png', multiplier: 0.2 }); state.pageThumbs[i] = url; } } catch {}
    savePackIfNeeded();
  }

  document.getElementById('prevPage').addEventListener('click', () => { savePageSnapshot(); if (state.pageIndex > 0) state.pageIndex--; loadPageSnapshot(state.pageIndex); });
  document.getElementById('nextPage').addEventListener('click', () => { savePageSnapshot(); if (state.pageIndex >= state.pages.length - 1) state.pages.push(null); state.pageIndex++; loadPageSnapshot(state.pageIndex); });
  if (!(await loadPackIfAny())) { state.pages.push(null); state.pageThumbs.push(null); }
  loadPageSnapshot(0);
  setInterval(() => { try { savePageSnapshot(); savePackIfNeeded(); } catch {} }, 3000);

  document.getElementById('exportPNG').addEventListener('click', () => { const url = canvas.toDataURL({ format: 'png', multiplier: 1 }); const a = document.createElement('a'); a.download = `annotation-page-${state.pageIndex+1}.png`; a.href = url; a.click(); });
  document.getElementById('exportJSON').addEventListener('click', () => { const json = JSON.stringify(canvas.toJSON()); download(`annotation-page-${state.pageIndex+1}.wbjson`, json, 'application/json'); });
  document.getElementById('importJSON').addEventListener('click', () => { document.getElementById('importFile').value = ''; document.getElementById('importFile').click(); });
  document.getElementById('importFile').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; if (!f) return; const reader = new FileReader(); reader.onload = () => { try { const data = JSON.parse(String(reader.result || '{}')); canvas.clear(); canvas.loadFromJSON(data, () => { canvas.renderAll(); setMode(state.mode); }); } catch {} }; reader.readAsText(f); });

  const history = createHistory(canvas, state, undoBtn, redoBtn, setMode, fit, board, updateEraseCursorVis);
  undoBtn.addEventListener('click', () => { history.undo(); });
  redoBtn.addEventListener('click', () => { history.redo(); });
  try {
    const dbg = new URLSearchParams(location.search || '').get('debugUndo');
    if (dbg === '1') {
      setTimeout(() => {
        try {
          const r = new fabric.Rect({ left: 100, top: 100, width: 40, height: 40, fill: '#ff0000', selectable: true });
          canvas.add(r);
          if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll();
          try { history.recordHistory(); } catch {}
          r.left = 200; r.top = 140; r.setCoords();
          try { canvas.fire('object:modified', { target: r }); } catch {}
          if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll();
          try { history.undo(); } catch {}
          setTimeout(() => { try { history.redo(); } catch {} }, 100);
        } catch {}
      }, 1000);
    }
  } catch {}

  let draggingErase = false; let draggingPan = false; let lastScreenX = 0; let lastScreenY = 0;
  canvas.on('mouse:down', (opt) => {
    const e = opt.e;
    if (state.mode === 'erase' && e.button === 0) { if (!(fabric && fabric.EraserBrush)) { const p = getPointerCanvas(canvas, fabric, opt); const size = Number(state.eraseSize) || 80; const r = new fabric.Rect({ left: p.x - size/2, top: p.y - size/2, width: size, height: size, fill: 'rgba(0,0,0,1)', selectable: false, evented: false }); r.globalCompositeOperation = 'destination-out'; r.isEraser = true; canvas.add(r); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); draggingErase = true; e.preventDefault(); e.stopPropagation(); } }
    if ((state.mode === 'pan' && e.button === 0) || (state.twoFingerPan && e.button === 1)) { draggingPan = true; const sp = getPointerScreen(canvas, opt); lastScreenX = sp.x; lastScreenY = sp.y; }
  });
  canvas.on('mouse:move', (opt) => {
    const e = opt.e;
    const sp = getPointerScreen(canvas, opt);
    resizeEraseCursor(state.eraseSize);
    const half = (Number(state.eraseSize) || 80) / 2;
    eraseCursor.style.left = `${sp.x - half}px`;
    eraseCursor.style.top = `${sp.y - half}px`;
    if (draggingErase && !(fabric && fabric.EraserBrush)) { const p = getPointerCanvas(canvas, fabric, opt); const size = Number(state.eraseSize) || 80; const r = new fabric.Rect({ left: p.x - size/2, top: p.y - size/2, width: size, height: size, fill: 'rgba(0,0,0,1)', selectable: false, evented: false }); r.globalCompositeOperation = 'destination-out'; r.isEraser = true; canvas.add(r); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); e.preventDefault(); e.stopPropagation(); }
    if (draggingPan) {
      const dx = (typeof e.movementX === 'number') ? e.movementX : (sp.x - lastScreenX);
      const dy = (typeof e.movementY === 'number') ? e.movementY : (sp.y - lastScreenY);
      lastScreenX = sp.x; lastScreenY = sp.y;
      if (fabric && fabric.Point && typeof canvas.relativePan === 'function') { canvas.relativePan(new fabric.Point(dx, dy)); }
      else { const vt = canvas.viewportTransform; vt[4] += dx; vt[5] += dy; canvas.setViewportTransform(vt); }
    }
  });
  canvas.on('mouse:up', () => { if ((state.mode === 'erase' || state.mode === 'draw' || draggingPan) && !history.restoring) { try { history.recordHistory(); } catch {} } draggingErase = false; draggingPan = false; history.updateUndoRedoUI(); });
  canvas.on('mouse:wheel', (opt) => { const e = opt.e; let delta = e.deltaY; let zoom = canvas.getZoom(); zoom *= 0.999 ** delta; zoom = Math.max(0.2, Math.min(3, zoom)); const p = typeof canvas.getPointer === 'function' ? canvas.getPointer(e) : { x: e.offsetX, y: e.offsetY }; canvas.zoomToPoint(new fabric.Point(p.x, p.y), zoom); resizeEraseCursor(state.eraseSize); try { if (!history.restoring) history.recordHistory(); } catch {} history.updateUndoRedoUI(); opt.e.preventDefault(); opt.e.stopPropagation(); });
  canvas.upperCanvasEl.addEventListener('touchstart', (e) => { if (state.mode === 'pan' && e.touches.length === 1) { draggingPan = true; const sp = getPointerScreen(canvas, { e }); lastScreenX = sp.x; lastScreenY = sp.y; e.preventDefault(); } else if (state.twoFingerPan && e.touches.length >= 2) { draggingPan = true; const sp = getPointerScreen(canvas, { e }); lastScreenX = sp.x; lastScreenY = sp.y; e.preventDefault(); } else if (state.mode === 'erase' && e.touches.length >= 1) { if (!(fabric && fabric.EraserBrush)) { const tp = e.touches[0]; const rect = canvas.upperCanvasEl.getBoundingClientRect(); const cx = tp.clientX - rect.left; const cy = tp.clientY - rect.top; const inv = fabric.util.invertTransform(canvas.viewportTransform || [1,0,0,1,0,0]); const pt = fabric.util.transformPoint(new fabric.Point(cx, cy), inv); const size = Number(state.eraseSize) || 80; const r = new fabric.Rect({ left: pt.x - size/2, top: pt.y - size/2, width: size, height: size, fill: 'rgba(0,0,0,1)', selectable: false, evented: false }); r.globalCompositeOperation = 'destination-out'; r.isEraser = true; canvas.add(r); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); e.preventDefault(); } } }, { passive: false });
  canvas.upperCanvasEl.addEventListener('touchstart', (e) => { if (state.mode === 'pan' && e.touches.length === 1) { draggingPan = true; const sp = getPointerScreen(canvas, { e }); lastScreenX = sp.x; lastScreenY = sp.y; e.preventDefault(); } else if (state.twoFingerPan && e.touches.length >= 2) { draggingPan = true; const sp = getPointerScreen(canvas, { e }); lastScreenX = sp.x; lastScreenY = sp.y; e.preventDefault(); } else if (state.mode === 'erase' && e.touches.length >= 1) { const sp = getPointerScreen(canvas, { e }); resizeEraseCursor(state.eraseSize); const half = (Number(state.eraseSize) || 80) / 2; eraseCursor.style.left = `${sp.x - half}px`; eraseCursor.style.top = `${sp.y - half}px`; if (!(fabric && fabric.EraserBrush)) { const tp = e.touches[0]; const rect = canvas.upperCanvasEl.getBoundingClientRect(); const cx = tp.clientX - rect.left; const cy = tp.clientY - rect.top; const inv = fabric.util.invertTransform(canvas.viewportTransform || [1,0,0,1,0,0]); const pt = fabric.util.transformPoint(new fabric.Point(cx, cy), inv); const size = Number(state.eraseSize) || 80; const r = new fabric.Rect({ left: pt.x - size/2, top: pt.y - size/2, width: size, height: size, fill: 'rgba(0,0,0,1)', selectable: false, evented: false }); r.globalCompositeOperation = 'destination-out'; r.isEraser = true; canvas.add(r); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); e.preventDefault(); } } }, { passive: false });
  canvas.upperCanvasEl.addEventListener('touchmove', (e) => { if ((state.mode === 'pan' && e.touches.length === 1 && draggingPan) || (state.twoFingerPan && e.touches.length === 2 && draggingPan)) { const sp = getPointerScreen(canvas, { e }); const dx = sp.x - lastScreenX; const dy = sp.y - lastScreenY; lastScreenX = sp.x; lastScreenY = sp.y; if (fabric && fabric.Point && typeof canvas.relativePan === 'function') { canvas.relativePan(new fabric.Point(dx, dy)); } else { const vt = canvas.viewportTransform; vt[4] += dx; vt[5] += dy; canvas.setViewportTransform(vt); } e.preventDefault(); } else if (state.mode === 'erase' && e.touches.length >= 1) { const sp = getPointerScreen(canvas, { e }); resizeEraseCursor(state.eraseSize); const half = (Number(state.eraseSize) || 80) / 2; eraseCursor.style.left = `${sp.x - half}px`; eraseCursor.style.top = `${sp.y - half}px`; if (state.twoFingerPan && e.touches.length >= 2) { e.preventDefault(); } else if (!(fabric && fabric.EraserBrush)) { const tp = e.touches[0]; const rect = canvas.upperCanvasEl.getBoundingClientRect(); const cx = tp.clientX - rect.left; const cy = tp.clientY - rect.top; const inv = fabric.util.invertTransform(canvas.viewportTransform || [1,0,0,1,0,0]); const pt = fabric.util.transformPoint(new fabric.Point(cx, cy), inv); const size = Number(state.eraseSize) || 80; const r = new fabric.Rect({ left: pt.x - size/2, top: pt.y - size/2, width: size, height: size, fill: 'rgba(0,0,0,1)', selectable: false, evented: false }); r.globalCompositeOperation = 'destination-out'; r.isEraser = true; canvas.add(r); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); e.preventDefault(); } } }, { passive: false });
  canvas.upperCanvasEl.addEventListener('touchend', (e) => { draggingPan = false; if ((state.mode === 'draw' || state.mode === 'erase') && !history.restoring) { try { history.recordHistory(); } catch {} } history.updateUndoRedoUI(); }, { passive: false });

  const bgWhite = document.getElementById('bgWhite');
  const bgDark = document.getElementById('bgDark');
  const bgDeepGreen = document.getElementById('bgDeepGreen');
  function updateBgButtonsActive() {
    const c = state.bgColor || canvas.backgroundColor || 'transparent';
    bgWhite.classList.toggle('active', c === '#ffffff');
    bgDark.classList.toggle('active', c === '#121212');
    bgDeepGreen.classList.toggle('active', c === '#0b3d2e');
  }
  function setBackgroundColor(color, skipHistory = false) {
    state.bgColor = color;
    try { canvas.setBackgroundColor(color, () => { updateBgButtonsActive(); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); if (!skipHistory) { try { history.recordHistory(); } catch {} } }); }
    catch { canvas.backgroundColor = color; updateBgButtonsActive(); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); if (!skipHistory) { try { history.recordHistory(); } catch {} } }
  }
  bgWhite.addEventListener('click', () => setBackgroundColor('#ffffff'));
  bgDark.addEventListener('click', () => setBackgroundColor('#121212'));
  bgDeepGreen.addEventListener('click', () => setBackgroundColor('#0b3d2e'));

  document.getElementById('pageLabel').addEventListener('click', () => { const pv = document.getElementById('pagePreview'); if (pv.style.display === 'flex') pv.style.display = 'none'; else { buildPagePreview(); pv.style.display = 'flex'; } });
  document.addEventListener('mousedown', (e) => { const pv = document.getElementById('pagePreview'); const vis = pv.style.display === 'flex'; if (vis) { const within = pv.contains(e.target) || document.getElementById('pageLabel').contains(e.target); if (!within) pv.style.display = 'none'; } });
  function deletePage(i) { try { if (state.pages.length <= 1) { state.pages = [null]; state.pageThumbs = [null]; state.pageIndex = 0; loadPageSnapshot(0); return; } state.pages.splice(i, 1); state.pageThumbs.splice(i, 1); if (state.pageIndex >= state.pages.length) state.pageIndex = state.pages.length - 1; loadPageSnapshot(state.pageIndex); buildPagePreview(); } catch {} }
  async function genThumbForPage(i, imgEl) {
    try {
      if (state.pageThumbs[i]) { if (imgEl) imgEl.src = state.pageThumbs[i]; return; }
      const raw = state.pages[i]; if (!raw) { state.pageThumbs[i] = ''; if (imgEl) imgEl.src = ''; return; }
      const parsed = (typeof raw === 'object') ? raw : null;
      const dataForCanvas = parsed && parsed.data && parsed.data.objects ? parsed.data : raw;
      const bgColor = (parsed && parsed.backgroundColor) ? parsed.backgroundColor : (state.bgColor || '#121212');
      const el = document.createElement('canvas');
      let sc = null; try { sc = new fabric.StaticCanvas(el); } catch { sc = null; }
      if (!sc) { state.pageThumbs[i] = ''; if (imgEl) imgEl.src = ''; return; }
      const w = Math.max(64, (typeof canvas.getWidth === 'function' ? canvas.getWidth() : 800));
      const h = Math.max(64, (typeof canvas.getHeight === 'function' ? canvas.getHeight() : 600));
      try { if (typeof sc.setDimensions === 'function') sc.setDimensions({ width: w, height: h }); else { if (typeof sc.setWidth === 'function') sc.setWidth(w); if (typeof sc.setHeight === 'function') sc.setHeight(h); } } catch {}
      try { sc.setBackgroundColor(bgColor, () => {}); } catch { sc.backgroundColor = bgColor; }
      await new Promise((resolve) => { try { sc.loadFromJSON(dataForCanvas, () => resolve()); } catch { resolve(); } });
      try { sc.renderAll(); } catch {}
      let url = '';
      try { url = sc.toDataURL({ format: 'png', multiplier: 0.2 }); } catch { url = ''; }
      state.pageThumbs[i] = url; if (imgEl) imgEl.src = url;
      try { if (typeof sc.dispose === 'function') sc.dispose(); } catch {}
    } catch {}
  }
  function buildPagePreview() { try { const pagePreview = document.getElementById('pagePreview'); pagePreview.innerHTML = ''; const list = document.createElement('div'); list.className = 'list'; const count = Math.max(state.pages.length, state.pageIndex + 1); for (let i = 0; i < count; i++) { const d = document.createElement('div'); d.className = 'thumb'; const img = document.createElement('img'); img.src = state.pageThumbs[i] || ''; genThumbForPage(i, img); const lab = document.createElement('span'); lab.className = 'label'; lab.textContent = String(i + 1); const del = document.createElement('button'); del.className = 'del'; del.innerHTML = '<i class="ri-delete-bin-6-line"></i>'; del.addEventListener('click', (ev) => { ev.stopPropagation(); deletePage(i); }); d.appendChild(img); d.appendChild(lab); d.appendChild(del); d.addEventListener('click', () => { savePageSnapshot(); state.pageIndex = i; loadPageSnapshot(i); pagePreview.style.display = 'none'; }); list.appendChild(d); } pagePreview.appendChild(list); const f = document.createElement('div'); f.className = 'footer'; const btn = document.createElement('button'); btn.innerHTML = '<i class="ri-arrow-down-s-line"></i> 收起'; btn.addEventListener('click', () => { pagePreview.style.display = 'none'; }); f.appendChild(btn); pagePreview.appendChild(f); } catch {} }

  const selTools = document.createElement('div'); selTools.id = 'selTools'; selTools.innerHTML = '<button id="toolClone"><i class="ri-file-copy-2-line"></i> 克隆</button><button id="toolDelete"><i class="ri-delete-bin-6-line"></i> 删除</button><button id="toolCloneNew"><i class="ri-pages-line"></i> 克隆到新页面</button>'; board.appendChild(selTools);
  function positionSelTools(obj) { try { const br = obj.getBoundingRect(false, true); const vt = canvas.viewportTransform || [1,0,0,1,0,0]; const tl = fabric.util.transformPoint(new fabric.Point(br.left, br.top), vt); const brp = fabric.util.transformPoint(new fabric.Point(br.left + br.width, br.top + br.height), vt); const left = Math.max(8, Math.min(tl.x, brp.x)); const top = Math.min(board.getBoundingClientRect().height - 40, Math.max(tl.y, brp.y) + 6); selTools.style.left = left + 'px'; selTools.style.top = top + 'px'; } catch {} }
  function hideSelTools() { selTools.style.display = 'none'; }
  function showSelTools(obj) { positionSelTools(obj); selTools.style.display = 'flex'; }
  canvas.on('selection:created', (e) => { const o = e.selected && e.selected[0]; if (o) showSelTools(o); });
  canvas.on('selection:updated', (e) => { const o = e.selected && e.selected[0]; if (o) showSelTools(o); });
  canvas.on('selection:cleared', () => hideSelTools());
  canvas.on('object:moving', (e) => { const o = e.target; if (o && selTools.style.display === 'flex') positionSelTools(o); });
  canvas.on('object:scaling', (e) => { const o = e.target; if (o && selTools.style.display === 'flex') positionSelTools(o); });
  canvas.on('object:rotating', (e) => { const o = e.target; if (o && selTools.style.display === 'flex') positionSelTools(o); });
  canvas.on('after:render', () => { const o = canvas.getActiveObject(); if (o && selTools.style.display === 'flex') positionSelTools(o); });
  canvas.on('object:modified', () => { if (!history.restoring) { try { history.recordHistory(); } catch {} } history.updateUndoRedoUI(); });
  async function cloneObject(o) { try { if (!o) return null; let target = o; if (target.type === 'activeSelection' && typeof target.toGroup === 'function') { try { target = target.toGroup(); } catch {} } if (typeof target.clone !== 'function') return null; if (target.clone.length > 0) { return await new Promise((resolve) => { try { target.clone((cl) => resolve(cl)); } catch { resolve(null); } }); } else { const res = target.clone(); if (res && typeof res.then === 'function') { return await res; } return res || null; } } catch { return null; } }
  selTools.querySelector('#toolClone').addEventListener('click', async () => { const o = canvas.getActiveObject(); if (!o) return; const cl = await cloneObject(o); if (!cl) return; cl.left = (o.left||0) + 10; cl.top = (o.top||0) + 10; canvas.add(cl); canvas.setActiveObject(cl); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); try { history.recordHistory(); } catch {} });
  selTools.querySelector('#toolDelete').addEventListener('click', () => { const o = canvas.getActiveObject(); if (!o) return; canvas.remove(o); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); hideSelTools(); try { history.recordHistory(); } catch {} });
  selTools.querySelector('#toolCloneNew').addEventListener('click', async () => { const o = canvas.getActiveObject(); if (!o) return; const cl = await cloneObject(o); if (!cl) return; savePageSnapshot(); if (state.pageIndex >= state.pages.length - 1) state.pages.push(null); state.pageIndex++; loadPageSnapshot(state.pageIndex); cl.left = 40; cl.top = 40; canvas.add(cl); canvas.setActiveObject(cl); if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); hideSelTools(); try { history.recordHistory(); } catch {} });

  

  const clearPageBtn = document.getElementById('clearPage');
  clearPageBtn.addEventListener('click', () => { const bg = canvas.backgroundColor; canvas.clear(); if (bg) setBackgroundColor(bg); setMode('draw'); state.pages[state.pageIndex] = null; if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll(); try { hideSelTools(); } catch {} try { hidePopup(); } catch {} try { updateEraseCursorVis(); } catch {} try { history.recordHistory(); } catch {} });
})();
