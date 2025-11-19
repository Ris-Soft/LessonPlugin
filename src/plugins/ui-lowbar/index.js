const path = require('path');
const { BrowserWindow } = require('electron');

// 支持多窗口：使用 Map 跟踪所有窗口
const winMap = new Map(); // electron window id -> BrowserWindow
const namedWinMap = new Map(); // custom name/id -> BrowserWindow（用于调用方防止重复创建）

const WindowModes = {
  FULLSCREEN_ONLY: 'fullscreen_only',
  WINDOWED_ONLY: 'windowed_only',
  FULLSCREEN_WINDOWED: 'fullscreen_windowed',
  FULLSCREEN_MAXIMIZED: 'fullscreen_maximized',
  ALL_MODES: 'all_modes'
};

function applyInitialMode(win, mode) {
  try {
    switch (mode) {
      case WindowModes.FULLSCREEN_ONLY:
        win.setFullScreen(true);
        break;
      case WindowModes.WINDOWED_ONLY:
        // 默认窗口化即可
        break;
      case WindowModes.FULLSCREEN_WINDOWED:
        // 默认窗口化，可由界面切换到全屏
        break;
      case WindowModes.FULLSCREEN_MAXIMIZED:
        // 默认最大化，可切到全屏
        win.maximize();
        break;
      case WindowModes.ALL_MODES:
      default:
        // 默认窗口化，支持全部切换
        break;
    }
  } catch {}
}

const functions = {
  openTemplate: async (params = {}) => {
    const width = parseInt(params.width, 10) || 1200;
    const height = parseInt(params.height, 10) || 800;
    const title = params.title || 'UI模板-低栏应用';
    const windowMode = params.windowMode || WindowModes.ALL_MODES;
    const unique = params.unique !== false;
    const customKey = unique ? String(params.id || params.windowId || params.callerPluginId || '').trim() : '';

    // 若启用防重复且存在窗口标识，则尝试复用现有窗口（避免重复创建同类窗口）
    if (customKey) {
      const existing = namedWinMap.get(customKey);
      if (existing && !existing.isDestroyed()) {
        try {
          existing.setTitle(title);
          existing.webContents.send('lowbar:init', {
            title,
            windowMode,
            icon: params.icon || 'ri-layout-bottom-line',
            backgroundUrl: params.backgroundUrl || null,
            floatingUrl: params.floatingUrl || null,
            floatingBounds: params.floatingBounds || null,
            floatingWidth: (typeof params.floatingWidth === 'number') ? params.floatingWidth : undefined,
            floatingHeight: (typeof params.floatingHeight === 'number') ? params.floatingHeight : undefined,
            floatingSizePercent: (typeof params.floatingSizePercent === 'number') ? params.floatingSizePercent : undefined,
            backgroundTargets: (typeof params.backgroundTargets === 'object') ? params.backgroundTargets : undefined,
            callerPluginId: params.callerPluginId || null,
            eventChannel: params.eventChannel || null,
            subscribeTopics: Array.isArray(params.subscribeTopics) ? params.subscribeTopics : (params.eventChannel ? [params.eventChannel] : []),
            leftItems: Array.isArray(params.leftItems) ? params.leftItems : [],
            centerItems: Array.isArray(params.centerItems) ? params.centerItems : [],
            capabilities: {
              maximizable: typeof existing.isMaximizable === 'function' ? !!existing.isMaximizable() : true,
              fullscreenable: typeof existing.isFullScreenable === 'function' ? !!existing.isFullScreenable() : true
            },
          windowId: existing.id
          });
          applyInitialMode(existing, windowMode);
          existing.show();
          existing.focus();
          return true;
        } catch {}
      } else {
        try { namedWinMap.delete(customKey); } catch {}
      }
    }
    const bw = new BrowserWindow({
      width,
      height,
      title,
      frame: false,
      titleBarStyle: 'hidden',
      show: false,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        nodeIntegration: false,
        contextIsolation: true,
        webviewTag: true
      }
    });
    try { bw.setTitle(title); } catch {}
    bw.loadFile(path.join(__dirname, 'index.html'));

    bw.webContents.once('did-finish-load', () => {
      try {
        bw.setTitle(title);
        bw.webContents.send('lowbar:init', {
          title,
          windowMode,
          icon: params.icon || 'ri-layout-bottom-line',
          backgroundUrl: params.backgroundUrl || null,
          floatingUrl: params.floatingUrl || null,
          floatingBounds: params.floatingBounds || null,
          // 允许绝对宽高（像素值），若不提供则按相对尺寸计算
          floatingWidth: (typeof params.floatingWidth === 'number') ? params.floatingWidth : undefined,
          floatingHeight: (typeof params.floatingHeight === 'number') ? params.floatingHeight : undefined,
          // 新增：悬浮窗口相对尺寸（1-100），用于控制相对宽高
          floatingSizePercent: (typeof params.floatingSizePercent === 'number') ? params.floatingSizePercent : undefined,
          backgroundTargets: (typeof params.backgroundTargets === 'object') ? params.backgroundTargets : undefined,
          // 新增：调用方插件ID，便于模板将事件直接回调到后端
          callerPluginId: params.callerPluginId || null,
          // 新增：事件通道（用于调用方插件与模板双向通讯）
          eventChannel: params.eventChannel || null,
          // 可选：模板在启动时主动订阅的事件主题（通常与 eventChannel 相同）
          subscribeTopics: Array.isArray(params.subscribeTopics) ? params.subscribeTopics : (params.eventChannel ? [params.eventChannel] : []),
          leftItems: Array.isArray(params.leftItems) ? params.leftItems : [],
          centerItems: Array.isArray(params.centerItems) ? params.centerItems : [],
          capabilities: {
            maximizable: typeof bw.isMaximizable === 'function' ? !!bw.isMaximizable() : true,
            fullscreenable: typeof bw.isFullScreenable === 'function' ? !!bw.isFullScreenable() : true
          },
          // 传递当前窗口ID供前端回调时识别目标窗口
          windowId: bw.id
        });
      } catch {}
    });

    applyInitialMode(bw, windowMode);
    bw.once('ready-to-show', () => { try { bw.show(); } catch {} });
    bw.on('closed', () => {
      try { winMap.delete(bw.id); } catch {}
      try {
        if (customKey) namedWinMap.delete(customKey);
        else namedWinMap.delete(String(bw.id));
      } catch {}
    });
    winMap.set(bw.id, bw);
    try {
      if (customKey) namedWinMap.set(customKey, bw);
      else namedWinMap.set(String(bw.id), bw);
    } catch {}
    return true;
  },
  toggleFullscreen: async (targetWindowId) => {
    try {
      const target = (targetWindowId && winMap.get(targetWindowId)) || Array.from(winMap.values()).slice(-1)[0];
      if (!target || target.isDestroyed()) return false;
      target.setFullScreen(!target.isFullScreen());
      return true;
    } catch { return false; }
  },
  toggleAlwaysOnTop: async (targetWindowId) => {
    try {
      const target = (targetWindowId && winMap.get(targetWindowId)) || Array.from(winMap.values()).slice(-1)[0];
      if (!target || target.isDestroyed()) return false;
      const next = !target.isAlwaysOnTop();
      target.setAlwaysOnTop(next);
      return next;
    } catch { return false; }
  },
  setWindowMode: async (mode, targetWindowId) => {
    try {
      const target = (targetWindowId && winMap.get(targetWindowId)) || Array.from(winMap.values()).slice(-1)[0];
      if (!target || target.isDestroyed()) return false;
      switch (mode) {
        case WindowModes.FULLSCREEN_ONLY:
          target.setFullScreen(true);
          break;
        case WindowModes.WINDOWED_ONLY:
          if (target.isFullScreen()) target.setFullScreen(false);
          if (target.isMaximized()) target.unmaximize();
          break;
        case WindowModes.FULLSCREEN_WINDOWED:
          // 仅切换到窗口化，其他由界面触发
          if (target.isFullScreen()) target.setFullScreen(false);
          if (target.isMaximized()) target.unmaximize();
          break;
        case WindowModes.FULLSCREEN_MAXIMIZED:
          if (target.isFullScreen()) target.setFullScreen(false);
          if (!target.isMaximized()) target.maximize();
          break;
        case WindowModes.ALL_MODES:
        default:
          if (target.isFullScreen()) target.setFullScreen(false);
          if (target.isMaximized()) target.unmaximize();
          break;
      }
      return true;
    } catch { return false; }
  }
};

const init = async (api) => {
  // 可在启动期间更新启动页文本，并声明通用 UI 工具已内置
  api.splash.setStatus('plugin:init', '初始化 UI模板-低栏应用');
  api.splash.setStatus('plugin:init', '内置通用 UI 工具（WebView iframe 适配、窗口控制）');
  api.splash.setStatus('plugin:init', 'UI模板-低栏应用加载完成');
};

module.exports = {
  name: 'UI模板-低栏应用',
  version: '0.1.0',
  init,
  functions: {
    ...functions,
    getVariable: async (name) => { const k=String(name||''); if (k==='timeISO') return new Date().toISOString(); if (k==='windowsCount') return String(winMap.size || 0); return ''; },
    listVariables: () => ['timeISO','windowsCount']
  }
};