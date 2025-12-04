const path = require('path');
const url = require('url');
const { BrowserWindow, app, screen } = require('electron');

let __dragTracker = { timer: null };
function startDragTracking() {
  try {
    stopDragTracking();
    __dragTracker.timer = setInterval(() => {
      try {
        const pt = screen.getCursorScreenPoint ? screen.getCursorScreenPoint() : { x: 0, y: 0 };
        const nx = Math.floor(pt.x - state.dragOffsetX);
        const ny = Math.floor(pt.y - state.dragOffsetY);
        functions.moveTo(nx, ny);
      } catch {}
    }, 16);
  } catch {}
}
function stopDragTracking() {
  try { if (__dragTracker.timer) clearInterval(__dragTracker.timer); __dragTracker.timer = null; } catch {}
}
function lockWindowSize(w, h) {
  try {
    if (!compassWin || compassWin.isDestroyed()) return;
    const W = Math.max(1, Math.floor(Number(w || 0)));
    const H = Math.max(1, Math.floor(Number(h || 0)));
    try { compassWin.setResizable(false); } catch {}
    try { compassWin.setMinimumSize(W, H); } catch {}
    try { compassWin.setMaximumSize(W, H); } catch {}
    try { compassWin.setContentSize(W, H); } catch {}
  } catch {}
}
function unlockWindowSize() {
  try {
    if (!compassWin || compassWin.isDestroyed()) return;
    try { compassWin.setResizable(true); } catch {}
    try { compassWin.setMinimumSize(1, 1); } catch {}
    try { compassWin.setMaximumSize(9999, 9999); } catch {}
  } catch {}
}
const { spawn } = require('child_process');

let pluginApi = null;
let compassWin = null;

const state = {
  eventChannel: 'screen.compass',
  dragging: false,
  draggingDisplayId: null,
  dragOffsetX: 0,
  dragOffsetY: 0,
  dragStartWinX: 0,
  dragStartWinY: 0,
  dragInputType: 'mouse',
  lockWidth: 0,
  lockHeight: 0,
  sizing: false,
  mode: 'collapsed'
};

function createCompassWindow() {
  try {
    if (compassWin && !compassWin.isDestroyed()) return compassWin;
    const pt = screen.getCursorScreenPoint ? screen.getCursorScreenPoint() : { x: 0, y: 0 };
    const d = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint(pt) : screen.getPrimaryDisplay();
    const b = d.bounds;
    const w = 96, h = 96, mr = 24, mb = 32;
    const isLinux = process.platform === 'linux';
    compassWin = new BrowserWindow({
      x: b.x + b.width - w - mr,
      y: b.y + b.height - h - mb,
      width: w,
      height: h,
      useContentSize: true,
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
      type: isLinux ? 'toolbar' : undefined,
      focusable: isLinux ? false : true,
      hasShadow: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        preload: path.join(__dirname, 'preload.js')
      }
    });
    compassWin.loadFile(path.join(__dirname, 'float', 'compass.html'));
    try { compassWin.on('will-resize', (e) => { try { e.preventDefault(); } catch {} }); } catch {}
    try { const bInit = compassWin.getBounds(); lockWindowSize(bInit.width, bInit.height); } catch {}
    try { const b0 = compassWin.getBounds(); state.lockWidth = b0.width; state.lockHeight = b0.height; } catch {}
    try { compassWin.on('resize', () => { try { const b = compassWin.getBounds(); if (state.lockWidth && state.lockHeight && (b.width !== state.lockWidth || b.height !== state.lockHeight)) { compassWin.setBounds({ x: b.x, y: b.y, width: state.lockWidth, height: state.lockHeight }); } } catch {} }); } catch {}
    try { compassWin.setAlwaysOnTop(true); } catch {}
    try { compassWin.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    try { if (isLinux) compassWin.setAlwaysOnTop(true, 'pop-up-menu'); } catch {}
    try { if (isLinux) compassWin.setAlwaysOnTop(true, 'status'); } catch {}
    try { compassWin.setVisibleOnAllWorkspaces(true); } catch {}
    try { compassWin.setSkipTaskbar(true); } catch {}
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
    const scheduleSnap = () => { try { if (state.dragging) return; if (state.sizing) return; if (snapTimer) clearTimeout(snapTimer); snapTimer = setTimeout(snap, 120); } catch {} };
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
  setExpandedWindow: (on, wOpt, hOpt) => {
    try {
      if (!compassWin || compassWin.isDestroyed()) return false;
      const wb = compassWin.getBounds();
      const cx = wb.x + Math.floor(wb.width / 2);
      const cy = wb.y + Math.floor(wb.height / 2);
      const display = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint({ x: cx, y: cy }) : screen.getPrimaryDisplay();
      const sb = display.bounds;
      const expanded = !!on;
      const dw = Number(wOpt); const dh = Number(hOpt);
      const size = expanded
        ? { width: (Number.isFinite(dw) && dw > 0 ? dw : 240), height: (Number.isFinite(dh) && dh > 0 ? dh : 240) }
        : { width: (Number.isFinite(dw) && dw > 0 ? dw : 60), height: (Number.isFinite(dh) && dh > 0 ? dh : 60) };
      state.mode = expanded ? 'expanded' : 'collapsed';
      state.sizing = true;
      let nx = cx - Math.floor(size.width / 2);
      let ny = cy - Math.floor(size.height / 2);
      if (nx < sb.x) nx = sb.x;
      if (ny < sb.y) ny = sb.y;
      if (nx + size.width > sb.x + sb.width) nx = sb.x + sb.width - size.width;
      if (ny + size.height > sb.y + sb.height) ny = sb.y + sb.height - size.height;
      try { unlockWindowSize(); } catch {}
      try { compassWin.setContentSize(size.width, size.height); } catch {}
      try { compassWin.setBounds({ x: nx, y: ny, width: size.width, height: size.height }); } catch {}
      try { lockWindowSize(size.width, size.height); } catch {}
      try { state.lockWidth = size.width; state.lockHeight = size.height; } catch {}
      try { setTimeout(() => { state.sizing = false; }, 60); } catch {}
      return true;
    } catch { return false; }
  },
  setDragging: (flag, offsetX, offsetY, inputType) => {
    try {
      state.dragging = !!flag;
      if (state.dragging) {
        if (compassWin && !compassWin.isDestroyed()) {
          const wb = compassWin.getBounds();
          try { lockWindowSize(wb.width, wb.height); } catch {}
          try { state.lockWidth = wb.width; state.lockHeight = wb.height; } catch {}
          state.dragStartWinX = wb.x;
          state.dragStartWinY = wb.y;
          const cx = wb.x + Math.floor(wb.width / 2);
          const cy = wb.y + Math.floor(wb.height / 2);
          const display = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint({ x: cx, y: cy }) : screen.getPrimaryDisplay();
          state.draggingDisplayId = display && typeof display.id === 'number' ? display.id : null;
          try {
            const pt = screen.getCursorScreenPoint ? screen.getCursorScreenPoint() : { x: 0, y: 0 };
            const useX = (typeof offsetX === 'number') ? offsetX : Math.max(0, pt.x - wb.x);
            const useY = (typeof offsetY === 'number') ? offsetY : Math.max(0, pt.y - wb.y);
            state.dragOffsetX = useX;
            state.dragOffsetY = useY;
          } catch { state.dragOffsetX = 0; state.dragOffsetY = 0; }
          state.dragInputType = (String(inputType||'').toLowerCase()==='touch') ? 'touch' : 'mouse';
          if (state.dragInputType === 'mouse') {
            try { startDragTracking(); } catch {}
          } else {
            try { stopDragTracking(); } catch {}
          }
        } else {
          state.draggingDisplayId = null;
        }
      } else {
        state.draggingDisplayId = null;
        state.dragInputType = 'mouse';
        try { stopDragTracking(); } catch {}
        try { const b = compassWin && !compassWin.isDestroyed() ? compassWin.getBounds() : null; if (b) { lockWindowSize(b.width, b.height); state.lockWidth = b.width; state.lockHeight = b.height; } } catch {}
      }
      return true;
    } catch { return false; }
  },
  touchDragMove: (dx, dy) => {
    try {
      if (!compassWin || compassWin.isDestroyed()) return false;
      if (!state.dragging || state.dragInputType !== 'touch') return false;
      const nx = Math.floor(state.dragStartWinX + Number(dx||0));
      const ny = Math.floor(state.dragStartWinY + Number(dy||0));
      return functions.moveTo(nx, ny);
    } catch { return false; }
  },
  getBounds: () => { try { if (!compassWin || compassWin.isDestroyed()) return null; return compassWin.getBounds(); } catch { return null; } },
  moveTo: (x, y) => {
    try {
      if (!compassWin || compassWin.isDestroyed()) return false;
      const wb = compassWin.getBounds();
      let sb = null;
      if (state.dragging && state.draggingDisplayId != null) {
        const displays = screen.getAllDisplays ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];
        const d = (displays || []).find(v => v && v.id === state.draggingDisplayId);
        sb = (d && d.bounds) ? d.bounds : null;
      }
      if (!sb) {
        const cx = Math.floor(x + wb.width / 2);
        const cy = Math.floor(y + wb.height / 2);
        const display = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint({ x: cx, y: cy }) : screen.getPrimaryDisplay();
        sb = display.bounds;
      }
      const nx = Math.max(sb.x, Math.min(x, sb.x + sb.width - (state.lockWidth || wb.width)));
      const ny = Math.max(sb.y, Math.min(y, sb.y + sb.height - (state.lockHeight || wb.height)));
      const W = state.lockWidth || wb.width;
      const H = state.lockHeight || wb.height;
      compassWin.setBounds({ x: Math.floor(nx), y: Math.floor(ny), width: W, height: H });
      return true;
    } catch { return false; }
  },
  snap: () => {
    try {
      if (!compassWin || compassWin.isDestroyed()) return false;
      const wb = compassWin.getBounds();
      let b = null;
      if (state.dragging && state.draggingDisplayId != null) {
        const displays = screen.getAllDisplays ? screen.getAllDisplays() : [screen.getPrimaryDisplay()];
        const d = (displays || []).find(v => v && v.id === state.draggingDisplayId);
        b = (d && d.bounds) ? d.bounds : null;
      }
      if (!b) {
        const cx = wb.x + Math.floor(wb.width / 2);
        const cy = wb.y + Math.floor(wb.height / 2);
        const display = screen.getDisplayNearestPoint ? screen.getDisplayNearestPoint({ x: cx, y: cy }) : screen.getPrimaryDisplay();
        b = display.bounds;
      }
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
