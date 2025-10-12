const path = require('path');
const { BrowserWindow, ipcMain, screen, app } = require('electron');
// 读取统一配置存储，用于向运行窗口广播配置更新
const store = require(path.join(app.getAppPath(), 'src', 'main', 'store.js'));

let runtimeWin = null;
let settingsWin = null;

function createRuntimeWindow() {
  if (runtimeWin && !runtimeWin.isDestroyed()) {
    return runtimeWin;
  }

  const { bounds } = screen.getPrimaryDisplay();

  runtimeWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    show: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // 默认开启穿透
  runtimeWin.setIgnoreMouseEvents(true, { forward: true });

  runtimeWin.loadFile(path.join(__dirname, 'runtime.html'));

  // 运行窗口加载完成后，主动同步一次当前配置
  try {
    runtimeWin.webContents.on('did-finish-load', () => {
      try {
        const cfg = store.getAll('notify');
        runtimeWin?.webContents?.send('notify:config:update', cfg);
      } catch {}
    });
  } catch {}

  runtimeWin.on('closed', () => {
    runtimeWin = null;
  });

  return runtimeWin;
}

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return settingsWin;
  }

  settingsWin = new BrowserWindow({
    width: 800,
    height: 600,
    frame: false,
    show: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      // 复用主应用的设置页预加载，获得 windowControl 与配置存取等能力
      preload: path.join(app.getAppPath(), 'src', 'preload', 'settings.js')
    },
  });
  settingsWin.loadFile(path.join(__dirname, 'index.html'));

  settingsWin.on('closed', () => {
    settingsWin = null;
  });

  return settingsWin;
}

// IPC: 由渲染进程控制穿透开关
ipcMain.handle('notify:setClickThrough', (_evt, enable) => {
  if (!runtimeWin || runtimeWin.isDestroyed()) return false;
  runtimeWin.setIgnoreMouseEvents(Boolean(enable), { forward: true });
  return true;
});

module.exports = {
  name: '通知插件',
  version: '1.0.0',
  // 插件初始化：创建运行窗口
  init: () => {
    if (app.isReady()) {
      createRuntimeWindow();
    } else {
      app.once('ready', () => createRuntimeWindow());
    }
  },
  // 可供 actions 调用的函数
  functions: {
    openSettings: () => { openSettingsWindow(); return true; },
    reopenRuntime: () => { createRuntimeWindow(); return true; },
    // 主动广播当前配置到运行窗口（供设置页调用实现实时生效）
    broadcastConfig: () => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      try {
        const cfg = store.getAll('notify');
        win.webContents.send('notify:config:update', cfg);
        return true;
      } catch {
        return false;
      }
    },
    enqueue: (payload) => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      try { win.webContents.send('notify:enqueue', payload); return true; } catch { return false; }
    },
    enqueueBatch: (list) => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      try { win.webContents.send('notify:enqueue', Array.isArray(list) ? list : [list]); return true; } catch { return false; }
    }
  },
};