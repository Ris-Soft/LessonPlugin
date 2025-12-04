export function createHistory(canvas, state, undoBtn, redoBtn, setMode, fitFn, board, updateEraseCursorVis) {
  function getCurrentHistory() {
    if (!state.pageHistories[state.pageIndex]) state.pageHistories[state.pageIndex] = [];
    if (typeof state.pageHistoryIndex[state.pageIndex] !== 'number') state.pageHistoryIndex[state.pageIndex] = -1;
    return { arr: state.pageHistories[state.pageIndex], idxRef: state.pageHistoryIndex, i: state.pageIndex };
  }
  function getCanvasJSON() {
    try {
      const base = canvas.toJSON();
      const bg = canvas.backgroundColor || state.bgColor || '#121212';
      const pack = {
        data: base,
        backgroundColor: bg,
        viewportTransform: Array.isArray(canvas.viewportTransform) ? canvas.viewportTransform.slice() : null,
        width: typeof canvas.getWidth === 'function' ? canvas.getWidth() : null,
        height: typeof canvas.getHeight === 'function' ? canvas.getHeight() : null,
      };
      return JSON.stringify(pack);
    } catch { return null; }
  }
  function updateUndoRedoUI() {
    const { arr, idxRef, i } = getCurrentHistory();
    const canUndo = (idxRef[i] > 0);
    const canRedo = (idxRef[i] >= 0 && idxRef[i] < arr.length - 1);
    undoBtn.classList.toggle('disabled', !canUndo);
    redoBtn.classList.toggle('disabled', !canRedo);
  }
  function recordHistory() {
    try {
      const { arr, idxRef, i } = getCurrentHistory();
      const snap = getCanvasJSON();
      if (!snap) return;
      if (idxRef[i] >= 0 && idxRef[i] < arr.length - 1) arr.splice(idxRef[i] + 1);
      if (arr.length > 0) {
        const last = arr[arr.length - 1];
        if (typeof last === 'string' && last === snap) { updateUndoRedoUI(); return; }
      }
      arr.push(snap);
      idxRef[i] = arr.length - 1;
      if (arr.length > 50) { arr.splice(0, arr.length - 50); idxRef[i] = arr.length - 1; }
      updateUndoRedoUI();
    } catch {}
  }
  let restoring = false;
  async function restoreFromHistory(toIndex) {
    try {
      const { arr, idxRef, i } = getCurrentHistory();
      const json = arr[toIndex];
      if (!json) return;
      restoring = true;
      canvas.clear();
      let parsed = null;
      try { parsed = JSON.parse(json); } catch { parsed = null; }
      const dataForCanvas = parsed && parsed.data && parsed.data.objects ? parsed.data : parsed;
      if (!dataForCanvas) { restoring = false; return; }
      canvas.loadFromJSON(dataForCanvas, () => {
        try { canvas.getObjects().forEach(o => { if (o && o.isEraser === true) { o.globalCompositeOperation = 'destination-out'; o.selectable = false; o.evented = false; } }); } catch {}
        try { setMode(state.mode); } catch {}
        try {
          if (state.mode === 'erase') {
            if (typeof fabric !== 'undefined' && fabric.EraserBrush) {
              if (!(canvas.freeDrawingBrush instanceof fabric.EraserBrush)) {
                const eb = new fabric.EraserBrush(canvas);
                eb.width = Number(state.eraseSize) || 80;
                eb.strokeLineCap = 'round';
                eb.strokeLineJoin = 'round';
                eb.inverted = false;
                eb.shadow = null;
                canvas.freeDrawingBrush = eb;
              }
            }
            canvas.isDrawingMode = true;
            canvas.selection = false;
            canvas.skipTargetFind = true;
            try { if (typeof updateEraseCursorVis === 'function') updateEraseCursorVis(); } catch {}
          }
        } catch {}
        try {
          const defaultBg = state.bgColor || canvas.backgroundColor || '#121212';
          const toBg = (parsed && parsed.backgroundColor) ? parsed.backgroundColor : defaultBg;
          const applyBg = (!toBg || toBg === 'transparent') ? defaultBg : toBg;
          try { canvas.setBackgroundColor(applyBg, () => {}); }
          catch { canvas.backgroundColor = applyBg; }
        } catch {}
        try {
          if (parsed && parsed.viewportTransform && typeof canvas.setViewportTransform === 'function') {
            canvas.setViewportTransform(parsed.viewportTransform);
          }
        } catch {}
        try { fitFn(board, canvas); } catch {}
        if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll();
        try {
          const pi = i;
          state.pages[pi] = canvas.toJSON();
          try { const url = canvas.toDataURL({ format: 'png', multiplier: 0.2 }); state.pageThumbs[pi] = url; } catch {}
        } catch {}
        restoring = false;
        idxRef[i] = toIndex;
        updateUndoRedoUI();
      });
    } catch { restoring = false; }
  }
  function undo() { const { idxRef, i } = getCurrentHistory(); if (idxRef[i] > 0) restoreFromHistory(idxRef[i] - 1); }
  function redo() { const { arr, idxRef, i } = getCurrentHistory(); if (idxRef[i] >= 0 && idxRef[i] < arr.length - 1) restoreFromHistory(idxRef[i] + 1); }
  return { getCurrentHistory, getCanvasJSON, updateUndoRedoUI, recordHistory, restoreFromHistory, undo, redo, get restoring() { return restoring; } };
}
