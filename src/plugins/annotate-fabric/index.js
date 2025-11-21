const path = require('path');
const { BrowserWindow, app, screen } = require('electron');

let pluginApi = null;
let whiteboardWin = null;

function openWhiteboardWindow() {
  if (whiteboardWin && !whiteboardWin.isDestroyed()) {
    whiteboardWin.focus();
    return whiteboardWin;
  }
  const d = screen.getPrimaryDisplay();
  const b = d.bounds;
  const win = new BrowserWindow({
    x: b.x,
    y: b.y,
    width: Math.max(960, Math.floor(b.width * 0.8)),
    height: Math.max(600, Math.floor(b.height * 0.8)),
    frame: true,
    show: true,
    resizable: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  whiteboardWin = win;
  win.loadFile(path.join(__dirname, 'whiteboard.html'));
  win.on('closed', () => { whiteboardWin = null; });
  return win;
}

function createOverlay(bounds, options) {
  const d = screen.getPrimaryDisplay();
  const sb = d.bounds;
  const x = Math.max(sb.x, Math.min((bounds?.x ?? sb.x), sb.x + sb.width));
  const y = Math.max(sb.y, Math.min((bounds?.y ?? sb.y), sb.y + sb.height));
  const w = Math.max(100, Math.min((bounds?.width ?? Math.floor(sb.width * 0.5)), sb.width));
  const h = Math.max(80, Math.min((bounds?.height ?? Math.floor(sb.height * 0.4)), sb.height));
  const win = new BrowserWindow({
    x,
    y,
    width: w,
    height: h,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: true,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true }
  });
  win.loadFile(path.join(__dirname, 'whiteboard.html'));
  return { ok: true };
}

module.exports = {
  name: '屏幕批注',
  version: '0.1.0',
  init: (api) => { pluginApi = api; },
  functions: {
    openWhiteboard: () => { try { openWhiteboardWindow(); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
    createOverlay: (bounds, options) => { try { return createOverlay(bounds || {}, options || {}); } catch (e) { return { ok: false, error: e?.message || String(e) }; } }
  }
}