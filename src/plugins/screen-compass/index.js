const path = require('path');
const url = require('url');
const { BrowserWindow, app, screen } = require('electron');
const { spawn } = require('child_process');

let pluginApi = null;
let compassWin = null;

const state = {
  eventChannel: 'screen.compass'
};

function createCompassWindow() {
  try {
    if (compassWin && !compassWin.isDestroyed()) return compassWin;
    const pt = screen.getCursorScreenPoint ? screen.getCursorScreenPoint() : { x: 0, y: 0 };
    const d = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint(pt) : screen.getPrimaryDisplay();
    const b = d.bounds;
    const w = 96, h = 96, m = 16;
    compassWin = new BrowserWindow({
      x: b.x + b.width - w - m,
      y: b.y + b.height - h - m,
      width: w,
      height: h,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    compassWin.loadFile(path.join(__dirname, 'float', 'compass.html'));
    compassWin.on('closed', () => { compassWin = null; });
    let snapTimer = null;
    const snap = () => {
      try {
        if (!compassWin || compassWin.isDestroyed()) return;
        const d = screen.getPrimaryDisplay();
        const wb = compassWin.getBounds();
        const sb = d.bounds;
        const th = 24;
        let x = wb.x, y = wb.y;
        if (Math.abs(wb.x - sb.x) <= th) x = sb.x;
        if (Math.abs((wb.x + wb.width) - (sb.x + sb.width)) <= th) x = sb.x + sb.width - wb.width;
        if (Math.abs(wb.y - sb.y) <= th) y = sb.y;
        if (Math.abs((wb.y + wb.height) - (sb.y + sb.height)) <= th) y = sb.y + sb.height - wb.height;
        if (x !== wb.x || y !== wb.y) compassWin.setPosition(x, y);
      } catch {}
    };
    const scheduleSnap = () => { try { if (snapTimer) clearTimeout(snapTimer); snapTimer = setTimeout(snap, 120); } catch {} };
    try { compassWin.on('move', scheduleSnap); } catch {}
    try { compassWin.on('moved', scheduleSnap); } catch {}
    return compassWin;
  } catch { return null; }
}

const functions = {
  openCompass: async () => { try { createCompassWindow(); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
  openCompassSettings: async () => {
    try {
      const bgFile = path.join(__dirname, 'background', 'settings.html');
      const backgroundUrl = url.pathToFileURL(bgFile).href;
      const params = {
        title: '屏幕罗盘设置',
        eventChannel: state.eventChannel,
        subscribeTopics: [state.eventChannel],
        callerPluginId: 'screen.compass',
        unique: true,
        id: 'screen.compass.settings',
        backgroundUrl,
        floatingUrl: null,
        centerItems: [],
        leftItems: []
      };
      const res = await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
      if (res && res.ok) return true;
      // fallback: open direct BrowserWindow with lowbar preload
      try {
        const d = screen.getPrimaryDisplay();
        const b = d.bounds;
        const w = 920, h = 640;
        const win = new BrowserWindow({
          x: b.x + Math.floor((b.width - w) / 2),
          y: b.y + Math.floor((b.height - h) / 2),
          width: w,
          height: h,
          frame: true,
          backgroundColor: '#101820',
          show: true,
          resizable: true,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(app.getAppPath(), 'src', 'plugins', 'ui-lowbar', 'preload.js')
          }
        });
        win.loadFile(path.join(__dirname, 'background', 'settings.html'));
      } catch {}
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  performAction: async (button) => {
    try {
      const b = (button && button.result) ? button.result : button;
      if (!b || typeof b !== 'object') return false;
      const type = String(b.actionType || '').trim();
      const payload = b.actionPayload || {};
      if (type === 'plugin') {
        const pid = String(payload.pluginId || '').trim();
        const fn = String(payload.fn || '').trim();
        const args = Array.isArray(payload.args) ? payload.args : [];
        if (!pid || !fn) return false;
        await pluginApi.call(pid, fn, args);
        return true;
      }
      if (type === 'pluginEvent') {
        const pid = String(payload.pluginId || '').trim();
        const evt = String(payload.event || '').trim();
        const args = Array.isArray(payload.args) ? payload.args : [];
        if (!pid || !evt) return false;
        await pluginApi.call(pid, evt, args);
        return true;
      }
      if (type === 'program') {
        const p = String(payload.path || '').trim();
        const args = Array.isArray(payload.args) ? payload.args : [];
        if (!p) return false;
        try {
          const child = spawn(p, args, { detached: true, stdio: 'ignore' });
          child.unref();
          return true;
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      }
      if (type === 'openApp') {
        const p = String(payload.path || '').trim();
        const args = Array.isArray(payload.args) ? payload.args : [];
        if (!p) return false;
        try { const child = spawn(p, args, { detached: true, stdio: 'ignore' }); child.unref(); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
      }
      if (type === 'command') {
        const cmd = String(payload.cmd || '').trim();
        if (!cmd) return false;
        try {
          if (process.platform === 'win32') {
            const child = spawn('cmd', ['/c', cmd], { windowsHide: true, detached: true, stdio: 'ignore' });
            child.unref();
          } else {
            const sh = spawn('bash', ['-lc', cmd], { detached: true, stdio: 'ignore' });
            sh.on('error', () => {
              try { const sh2 = spawn('sh', ['-c', cmd], { detached: true, stdio: 'ignore' }); sh2.unref(); } catch {}
            });
            sh.unref();
          }
          return true;
        } catch (e) {
          return { ok: false, error: e?.message || String(e) };
        }
      }
      if (type === 'cmd') {
        const cmd = String(payload.cmd || '').trim();
        if (!cmd) return false;
        try {
          if (process.platform === 'win32') {
            const child = spawn('cmd', ['/c', cmd], { windowsHide: true, detached: true, stdio: 'ignore' }); child.unref();
          } else {
            const sh = spawn('bash', ['-lc', cmd], { detached: true, stdio: 'ignore' });
            sh.on('error', () => { try { const sh2 = spawn('sh', ['-c', cmd], { detached: true, stdio: 'ignore' }); sh2.unref(); } catch {} });
            sh.unref();
          }
          return true;
        } catch (e) { return { ok: false, error: e?.message || String(e) }; }
      }
      if (type === 'power') {
        const op = String(payload.op || 'shutdown').trim();
        try {
          if (process.platform === 'win32') {
            let c = '';
            if (op === 'shutdown') c = 'shutdown -s -t 0';
            else if (op === 'restart') c = 'shutdown -r -t 0';
            else if (op === 'logoff') c = 'shutdown -l';
            if (!c) return false;
            const child = spawn('cmd', ['/c', c], { windowsHide: true, detached: true, stdio: 'ignore' }); child.unref();
          } else {
            let c = '';
            if (op === 'shutdown') c = 'systemctl poweroff';
            else if (op === 'restart') c = 'systemctl reboot';
            else if (op === 'logoff') c = 'loginctl terminate-user "$USER"';
            if (!c) return false;
            const sh = spawn('bash', ['-lc', c], { detached: true, stdio: 'ignore' });
            sh.on('error', () => { try { const sh2 = spawn('sh', ['-c', c], { detached: true, stdio: 'ignore' }); sh2.unref(); } catch {} });
            sh.unref();
          }
          return true;
        } catch (e) { return { ok: false, error: e?.message || String(e) }; }
      }
      if (type === 'wait') {
        const seconds = Number(payload.seconds || payload.sec || 0);
        await new Promise((r) => setTimeout(r, Math.max(0, Math.floor(seconds * 1000))));
        return true;
      }
      return false;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  listPlugins: () => {
    try {
      const pm = require(path.join(app.getAppPath(), 'src', 'main', 'pluginManager.js'));
      const list = pm.getPlugins();
      return list;
    } catch (e) { return []; }
  },
  listAutomationEvents: (pluginId) => {
    try {
      const pm = require(path.join(app.getAppPath(), 'src', 'main', 'pluginManager.js'));
      const res = pm.listAutomationEvents(pluginId);
      if (res && res.ok && Array.isArray(res.events)) return res.events;
      return [];
    } catch (e) { return []; }
  },
  setExpandedWindow: (on) => {
    try {
      if (!compassWin || compassWin.isDestroyed()) return false;
      const d = screen.getPrimaryDisplay();
      const sb = d.bounds;
      const wb = compassWin.getBounds();
      const cx = wb.x + Math.floor(wb.width / 2);
      const cy = wb.y + Math.floor(wb.height / 2);
      const expanded = !!on;
      const size = expanded ? { width: 220, height: 220 } : { width: 96, height: 96 };
      let nx = cx - Math.floor(size.width / 2);
      let ny = cy - Math.floor(size.height / 2);
      if (nx < sb.x) nx = sb.x;
      if (ny < sb.y) ny = sb.y;
      if (nx + size.width > sb.x + sb.width) nx = sb.x + sb.width - size.width;
      if (ny + size.height > sb.y + sb.height) ny = sb.y + sb.height - size.height;
      compassWin.setBounds({ x: nx, y: ny, width: size.width, height: size.height });
      return true;
    } catch { return false; }
  },
  getBounds: () => { try { if (!compassWin || compassWin.isDestroyed()) return null; return compassWin.getBounds(); } catch { return null; } },
  moveTo: (x, y) => {
    try {
      if (!compassWin || compassWin.isDestroyed()) return false;
      const d = screen.getPrimaryDisplay();
      const sb = d.bounds; const wb = compassWin.getBounds();
      const nx = Math.max(sb.x, Math.min(x, sb.x + sb.width - wb.width));
      const ny = Math.max(sb.y, Math.min(y, sb.y + sb.height - wb.height));
      compassWin.setPosition(Math.floor(nx), Math.floor(ny));
      return true;
    } catch { return false; }
  },
  snap: () => {
    try {
      if (!compassWin || compassWin.isDestroyed()) return false;
      const d = screen.getPrimaryDisplay();
      const wb = compassWin.getBounds();
      const b = d.bounds;
      const th = 24;
      let x = wb.x, y = wb.y;
      if (Math.abs(wb.x - b.x) <= th) x = b.x;
      if (Math.abs((wb.x + wb.width) - (b.x + b.width)) <= th) x = b.x + b.width - wb.width;
      if (Math.abs(wb.y - b.y) <= th) y = b.y;
      if (Math.abs((wb.y + wb.height) - (b.y + b.height)) <= th) y = b.y + b.height - wb.height;
      if (x !== wb.x || y !== wb.y) compassWin.setPosition(x, y);
      return true;
    } catch { return false; }
  }
};

const init = async (api) => {
  pluginApi = api;
  const ready = () => { createCompassWindow(); };
  if (app.isReady()) ready(); else app.once('ready', ready);
};

module.exports = { name: '屏幕罗盘', version: '0.1.0', init, functions };