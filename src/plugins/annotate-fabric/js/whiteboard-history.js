export function createHistory(canvas, state, undoBtn, redoBtn, setMode, fitFn, board) {
  function getCurrentHistory() {
    if (!state.pageHistories[state.pageIndex]) state.pageHistories[state.pageIndex] = [];
    if (typeof state.pageHistoryIndex[state.pageIndex] !== 'number') state.pageHistoryIndex[state.pageIndex] = -1;
    return { arr: state.pageHistories[state.pageIndex], idxRef: state.pageHistoryIndex, i: state.pageIndex };
  }
  function getCanvasJSON() { try { return JSON.stringify(canvas.toJSON()); } catch { return null; } }
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
      canvas.loadFromJSON(JSON.parse(json), () => {
        try { canvas.getObjects().forEach(o => { if (o && o.isEraser === true) { o.globalCompositeOperation = 'destination-out'; o.selectable = false; o.evented = false; } }); } catch {}
        try { setMode(state.mode); } catch {}
        try { if (state.mode === 'erase') { canvas.isDrawingMode = true; canvas.selection = false; canvas.skipTargetFind = true; } } catch {}
        try { fitFn(board, canvas); } catch {}
        if (canvas.requestRenderAll) canvas.requestRenderAll(); else canvas.renderAll();
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
