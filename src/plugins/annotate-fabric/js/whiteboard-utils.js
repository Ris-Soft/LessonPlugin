export async function loadScript(src, type = 'text/javascript') {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.type = type;
    s.onload = () => resolve(true);
    s.onerror = () => reject(new Error('load_failed'));
    document.head.appendChild(s);
  });
}

export function fit(board, canvas) {
  const r = board.getBoundingClientRect();
  const w = Math.floor(r.width);
  const h = Math.floor(r.height);
  if (typeof canvas.setDimensions === 'function') {
    canvas.setDimensions({ width: w, height: h });
  } else {
    const canvasEl = (typeof canvas.getElement === 'function') ? canvas.getElement() : (canvas.lowerCanvasEl || null);
    if (typeof canvas.setWidth === 'function') canvas.setWidth(w);
    else if (canvasEl) canvasEl.width = w;
    if (typeof canvas.setHeight === 'function') canvas.setHeight(h);
    else if (canvasEl) canvasEl.height = h;
  }
  if (typeof canvas.requestRenderAll === 'function') canvas.requestRenderAll();
  else if (typeof canvas.renderAll === 'function') canvas.renderAll();
}

export function getPointerScreen(canvas, opt) {
  try {
    const e = opt && opt.e ? opt.e : opt;
    const rect = canvas.upperCanvasEl.getBoundingClientRect();
    const cx = (e && (e.clientX != null ? e.clientX : (e.touches && e.touches[0] && e.touches[0].clientX))) || 0;
    const cy = (e && (e.clientY != null ? e.clientY : (e.touches && e.touches[0] && e.touches[0].clientY))) || 0;
    const x = cx - rect.left;
    const y = cy - rect.top;
    return { x, y };
  } catch { return { x: 0, y: 0 }; }
}

export function getPointerCanvas(canvas, fabric, opt) {
  try {
    const p = getPointerScreen(canvas, opt);
    if (fabric && fabric.util && fabric.Point && typeof fabric.util.invertTransform === 'function' && typeof fabric.util.transformPoint === 'function') {
      const inv = fabric.util.invertTransform(canvas.viewportTransform || [1,0,0,1,0,0]);
      const tp = fabric.util.transformPoint(new fabric.Point(p.x, p.y), inv);
      return { x: tp.x, y: tp.y };
    }
    return p;
  } catch { return { x: 0, y: 0 }; }
}

export function download(filename, content, mime) {
  const a = document.createElement('a');
  a.download = filename;
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
