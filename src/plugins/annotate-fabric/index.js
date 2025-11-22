const path = require('path');
const { BrowserWindow, app, screen, ipcMain } = require('electron');

let pluginApi = null;
let whiteboardWin = null;
let ipcInited = false;

function initIPC() {
  if (ipcInited) return;
  ipcInited = true;
  ipcMain.on('annotate:minimize', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) win.minimize();
    } catch {}
  });
  ipcMain.on('annotate:close', (event) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) win.close();
    } catch {}
  });
}

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
    width: b.width,
    height: b.height,
    frame: true,
    show: true,
    resizable: true,
    fullscreen: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  whiteboardWin = win;
  try { win.setFullScreen(true); } catch {}
  win.loadFile(path.join(__dirname, 'whiteboard.html'), { query: { showClose: '1', showMinimize: '1', variant: 'window' } });
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
    webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
  });
  const showClose = options && options.showClose ? String(options.showClose) : '0';
  const showMinimize = options && options.showMinimize ? String(options.showMinimize) : '0';
  const showSave = options && options.showSave ? String(options.showSave) : '1';
  win.loadFile(path.join(__dirname, 'whiteboard.html'), { query: { showClose, showMinimize, showSave, variant: 'overlay' } });
  return { ok: true };
}

module.exports = {
  name: '屏幕批注',
  version: '0.1.0',
  init: (api) => { pluginApi = api; initIPC(); },
  functions: {
    openWhiteboard: () => { try { openWhiteboardWindow(); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
    createOverlay: (bounds, options) => { try { return createOverlay(bounds || {}, options || {}); } catch (e) { return { ok: false, error: e?.message || String(e) }; } }
  }
}
