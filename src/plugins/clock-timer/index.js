const path = require('path');
const url = require('url');
const { BrowserWindow, app, screen } = require('electron');

let pluginApi = null;
let win = null;

const state = {
  mode: 'clock',
  normalSize: { width: 920, height: 640 },
  compactSize: { width: 600, height: 180 }
};

function createWindow(initMode) {
  try {
    if (win && !win.isDestroyed()) {
      try { win.focus(); } catch {}
      return win;
    }
    const d = screen.getPrimaryDisplay();
    const b = d.bounds;
    const w = state.normalSize.width, h = state.normalSize.height;
    win = new BrowserWindow({
      x: b.x + Math.floor((b.width - w) / 2),
      y: b.y + Math.floor((b.height - h) / 2),
      width: w,
      height: h,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#000000',
      resizable: true,
      fullscreenable: true,
      alwaysOnTop: true,
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false, contextIsolation: true }
    });
    const file = path.join(__dirname, 'index.html');
    const href = url.pathToFileURL(file).href + `?mode=${encodeURIComponent(initMode || state.mode)}`;
    win.loadURL(href);
    try { win.setAlwaysOnTop(true); } catch {}
    try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    win.on('closed', () => { win = null; });
    win.show();
    return win;
  } catch { return null; }
}

const functions = {
  openWindow: async (mode) => { try { state.mode = typeof mode === 'string' ? mode : 'clock'; createWindow(state.mode); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
  openClock: async () => { try { state.mode = 'clock'; createWindow('clock'); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
  openStopwatch: async () => { try { state.mode = 'stopwatch'; createWindow('stopwatch'); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
  openCountdown: async (args) => { try { state.mode = 'countdown'; createWindow('countdown'); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
  setWindowMode: async (mode) => {
    try {
      if (!win || win.isDestroyed()) return false;
      const m = String(mode || '').trim();
      const d = screen.getPrimaryDisplay();
      const sb = d.bounds;
      const wb = win.getBounds();
      const cx = wb.x + Math.floor(wb.width / 2);
      const cy = wb.y + Math.floor(wb.height / 2);
      const size = (m === 'compact') ? state.compactSize : state.normalSize;
      let nx = cx - Math.floor(size.width / 2);
      let ny = cy - Math.floor(size.height / 2);
      if (nx < sb.x) nx = sb.x;
      if (ny < sb.y) ny = sb.y;
      if (nx + size.width > sb.x + sb.width) nx = sb.x + sb.width - size.width;
      if (ny + size.height > sb.y + sb.height) ny = sb.y + sb.height - size.height;
      win.setBounds({ x: nx, y: ny, width: size.width, height: size.height });
      return true;
    } catch { return false; }
  },
  toggleFullscreen: async () => {
    try { if (!win || win.isDestroyed()) return false; win.setFullScreen(!win.isFullScreen()); return true; } catch { return false; }
  }
};

const init = async (api) => { pluginApi = api; };

module.exports = { name: '时钟/秒表/倒计时', version: '1.0.0', init, functions };