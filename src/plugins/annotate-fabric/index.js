const path = require('path');
const { BrowserWindow, app, screen, ipcMain } = require('electron');
const fs = require('fs');

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
  ipcMain.on('annotate:saveJSON', (event, payload) => {
    try {
      const { filePath, json } = payload || {};
      if (!filePath || typeof json !== 'string') return;
      const dir = path.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(filePath, json, 'utf8');
    } catch {}
  });
  ipcMain.handle('annotate:loadJSON', async (event, payload) => {
    try {
      const { filePath } = payload || {};
      if (!filePath) return null;
      if (!fs.existsSync(filePath)) return null;
      return fs.readFileSync(filePath, 'utf8');
    } catch { return null; }
  });
  ipcMain.on('annotate:minimizeWithSave', (event, payload) => {
    try {
      const { filePath, json } = payload || {};
      const win = BrowserWindow.fromWebContents(event.sender);
      if (filePath && typeof json === 'string') {
        const dir = path.dirname(filePath);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(filePath, json, 'utf8');
      }
      if (win && !win.isDestroyed()) win.minimize();
    } catch {}
  });
}

function openWhiteboardWindow() {
  if (whiteboardWin && !whiteboardWin.isDestroyed()) {
    whiteboardWin.focus();
    return whiteboardWin;
  }
  const disp = screen.getPrimaryDisplay();
  const b = disp.bounds;
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
  const today = new Date();
  const year = today.getFullYear();
  const monthStr = String(today.getMonth() + 1).padStart(2, '0');
  const dayStr = String(today.getDate()).padStart(2, '0');
  const persistDir = path.join(app.getPath('userData'), 'annotate-fabric');
  const persistFile = path.join(persistDir, `whiteboard-${year}${monthStr}${dayStr}.wbjson`);
  win.loadFile(path.join(__dirname, 'whiteboard.html'), { query: { showClose: '0', showMinimize: '1', showSave: '1', variant: 'window', persistFile } });
  win.on('closed', () => { whiteboardWin = null; });
  return win;
}

function createOverlay(bounds, options) {
  const disp = screen.getPrimaryDisplay();
  const sb = disp.bounds;
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
  const showClose = '0';
  const showMinimize = '1';
  const showSave = '0';
  const today = new Date();
  const year = today.getFullYear();
  const monthStr = String(today.getMonth() + 1).padStart(2, '0');
  const dayStr = String(today.getDate()).padStart(2, '0');
  const persistDir = path.join(app.getPath('userData'), 'annotate-fabric');
  const persistFile = path.join(persistDir, `whiteboard-${year}${monthStr}${dayStr}.wbjson`);
  win.loadFile(path.join(__dirname, 'whiteboard.html'), { query: { showClose, showMinimize, showSave: '1', variant: 'overlay', persistFile } });
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
