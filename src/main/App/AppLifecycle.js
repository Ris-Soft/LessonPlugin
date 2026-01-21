const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const store = require('../Manager/Store/Main');
const backendLog = require('../Debug/backendLog');
const win32 = require('../System/Win32');
const pluginManager = require('../Manager/Plugins/Main');
const AutomationManager = require('../Manager/Automation/Main');
const autoUpdater = require('./autoUpdater');
const protocol = require('../System/Protocol');
const windowManager = require('../Windows/WindowManager');
const trayManager = require('../App/TrayManager');
const userDataService = require('../Services/UserDataService');
const startupService = require('../Services/StartupService');

// IPC Registers
const pluginIpc = require('../Ipc/PluginIpc');
const systemIpc = require('../Ipc/SystemIpc');
const automationIpc = require('../Ipc/AutomationIpc');
const configIpc = require('../Ipc/ConfigIpc');
const consoleIpc = require('../Ipc/ConsoleIpc');
const windowIpc = require('../Ipc/WindowIpc');
const notificationIpc = require('../Ipc/NotificationIpc');
const NotificationWindow = require('../Windows/NotificationWindow');

let automationManager = null;
let hasProtocolArgAtBoot = false;

// Protocol handling helpers
let __lastProtoTask = { text: '', ts: 0 };
let __lastProtoStore = { key: '', ts: 0 };

function __shouldSkipStore(key) {
  const now = Date.now();
  if (__lastProtoStore.key === key && (now - __lastProtoStore.ts) < 1500) return true;
  __lastProtoStore = { key, ts: now };
  return false;
}

function __shouldSkipTask(text) {
  const now = Date.now();
  if (__lastProtoTask.text === text && (now - __lastProtoTask.ts) < 1500) return true;
  __lastProtoTask = { text, ts: now };
  return false;
}

function __openStore(install, type, id) {
  const key = `${install ? '1' : '0'}:${type}:${id}`;
  if (__shouldSkipStore(key)) return;
  const win = windowManager.ensureSettingsWindow();
  const send = () => {
    try {
      win.webContents.send('settings:navigate', 'market');
      if (install) win.webContents.send('settings:marketInstall', { type, id });
      else win.webContents.send('settings:openStoreItem', { type, id });
    } catch (e) {}
  };
  if (win.webContents.isLoading()) win.webContents.once('did-finish-load', send); else send();
}

async function init(appInstance) {
  // Protocol arg check
  hasProtocolArgAtBoot = Array.isArray(process.argv) && process.argv.some((s) => /^OrbiBoard:\/\//i.test(String(s || '')));
  try {
    const sys = store.getAll('system') || {};
    if (sys.openSettingsOnBootOnce) {
      hasProtocolArgAtBoot = true;
      store.set('system', 'openSettingsOnBootOnce', false);
    }
    if (process.argv.includes('--post-update')) {
      hasProtocolArgAtBoot = true;
    }
  } catch (e) {}

  app.whenReady().then(async () => {
    store.init(app);

    // 检查主程序版本更新
    try {
      const currentVersion = app.getVersion();
      const lastRunVersion = store.get('system', 'lastRunVersion');
      if (currentVersion !== lastRunVersion) {
        store.set('system', 'lastRunVersion', currentVersion);
        // 如果不是初次安装（即存在上一版本记录），则标记为刚刚更新
        if (lastRunVersion) {
          store.set('system', 'justUpdated', true);
          store.set('system', 'previousVersion', lastRunVersion);
        }
      }
    } catch(e) {}

    store.ensureDefaults('system', {
      splashEnabled: true,
      splashQuoteEnabled: false,
      quoteSource: 'engquote',
      quoteApiUrl: 'https://v1.hitokoto.cn/',
      localQuotes: [],
      autostartEnabled: false,
      autostartHigh: false,
      preciseTimeEnabled: false,
      timeOffset: 0,
      autoOffsetDaily: 0,
      offsetBaseDate: new Date().toISOString().slice(0, 10),
      developerMode: false,
      timeZone: 'Asia/Shanghai',
      autoUpdateEnabled: true,
      updateServerUrl: 'https://orbiboard.3r60.top'
    });

    try { backendLog.init({ enabled: true }); } catch (e) {}
    try { win32.init(); } catch (e) {}

    const splashEnabled = store.get('system', 'splashEnabled') !== false;
    if (splashEnabled) {
      windowManager.createSplashWindow();
    }

    try { autoUpdater.checkAndUpdate((status) => windowManager.sendSplashProgress(status)); } catch (e) {}

    const { manifestPath, configPath } = startupService.syncPluginsAndComponents();

    // Allow plugin manager to access ipcMain (for event callback registration)
    pluginManager._ipcMain = ipcMain;

    pluginManager.init({ manifestPath, configPath });
    pluginManager.setMissingPluginHandler((id) => {
      setTimeout(() => {
        try { __openStore(true, 'plugin', id); } catch (e) {}
      }, 100);
    });

    windowManager.sendSplashProgress({ stage: 'init', message: '初始化插件管理器...' });

    automationManager = new AutomationManager({ app, store, pluginManager });
    try { pluginManager.setAutomationManager(automationManager); } catch (e) {}
    try { global.__automationManager__ = automationManager; } catch (e) {}

    // Register IPCs
    pluginIpc.register(); // pluginIpc uses global.__automationManager__ or we can pass it
    systemIpc.register();
    automationIpc.register(automationManager);
    configIpc.register();
    consoleIpc.register();
    windowIpc.register();
    notificationIpc.register();

    // 启动时检查是否有“刚刚更新”标记，若有则弹出通知
    try {
      const justUpdated = store.get('system', 'justUpdated');
      const showNotif = store.get('system', 'showUpdateNotification') !== false;
      
      if (justUpdated && showNotif) {
         const prevVer = store.get('system', 'previousVersion') || 'old';
         const currentVer = app.getVersion();
         // Reset flag
         store.set('system', 'justUpdated', false);
         
         // Show notification
         setTimeout(() => {
           NotificationWindow.show(
             '主程序已更新', 
             `版本：v${prevVer} → v${currentVer}<br>点击查看详细更新日志`, 
             true // hasDetails -> open settings
           );
         }, 3000); // Wait for app to settle
      }
    } catch (e) { console.error('Notification check error:', e); }

    try {
      const statuses = await pluginManager.loadPlugins((status) => {
        windowManager.sendSplashProgress(status);
      });
      windowManager.sendSplashProgress({ stage: 'done', message: '插件加载完成' });
    } catch (err) {
      windowManager.sendSplashProgress({ stage: 'error', message: `插件加载失败: ${err.message}` });
    }

    // Dev watch logic
    try {
      const wantWatch = String(process.env.LP_DEV_PLUGINS_WATCH || '0') !== '0';
      if (wantWatch) {
        const debounce = new Map();
        const list = await pluginManager.getPlugins();
        for (const p of (list || [])) {
          const baseDir = p.local ? path.join(path.dirname(manifestPath), p.local) : null;
          if (!baseDir || !fs.existsSync(baseDir)) continue;
          try {
            const watcher = fs.watch(baseDir, { recursive: true }, () => {
              const key = p.id || p.name;
              const last = debounce.get(key) || 0;
              const now = Date.now();
              if (now - last < 300) return;
              debounce.set(key, now);
              (async () => { try { await pluginManager.toggle(key, false); await pluginManager.toggle(key, true); } catch (e) {} })();
            });
            watcher.on('error', () => {});
          } catch (e) {}
        }
      }
    } catch (e) {}

    userDataService.ensureUserDataShortcut();
    automationManager.init();

    // Protocol handling on startup
    try {
      const arg = (Array.isArray(process.argv) ? process.argv.find((s) => /^OrbiBoard:\/\//i.test(String(s || ''))) : null);
      if (arg) {
        const info = protocol.parse(String(arg));
        if (info.kind === 'task') {
          const text = info.taskText;
          if (!__shouldSkipTask(text)) { try { await automationManager.invokeProtocol(text, info.params || {}); } catch (e) {} }
        } else if (info.kind === 'market') {
          __openStore(!!info.install, info.type, info.id);
        } else if (info.kind === 'open' && info.target === 'settings') {
          windowManager.ensureSettingsWindow();
        }
      }
    } catch (e) {}

    registerProtocolHandlers(app);

    trayManager.createTray();

    if (!hasProtocolArgAtBoot) {
      windowManager.createSettingsWindow();
    }

    // Monitor windows
    try {
      app.on('browser-window-created', (_e, win) => {
        try {
          const wc = win?.webContents;
          const info = {
            id: win.id,
            title: (() => { try { return win.getTitle(); } catch (e) { return ''; } })(),
            url: (() => { try { return wc?.getURL?.() || ''; } catch (e) { return ''; } })(),
            bounds: (() => { try { return win.getBounds(); } catch (e) { return null; } })(),
            webContentsId: (() => { try { return wc?.id || null; } catch (e) { return null; } })(),
            pluginId: (() => {
              try {
                const webId = wc?.id;
                return pluginManager.getPluginIdByWebContentsId(webId);
              } catch (e) { return null; }
            })()
          };
          console.info('window:created', info);
        } catch (e) {}
        try {
          win.on('closed', () => { try { console.info('window:closed', { id: win.id }); } catch (e) {} });
        } catch (e) {}
      });
    } catch (e) {}

    // Open settings once if requested
    try {
      const openOnce = store.get('system', 'openSettingsOnBootOnce');
      if (openOnce) {
        store.set('system', 'openSettingsOnBootOnce', false);
        windowManager.ensureSettingsWindow();
      }
    } catch (e) {}

  }); // end whenReady

  app.on('window-all-closed', () => {
    // Keep tray
  });

  app.on('before-quit', () => {
    try { pluginManager.closeAllWindows(); } catch (e) {}
    windowManager.closeAllWindows();
  });

  app.on('second-instance', (_e, argv) => {
    const arg = argv.find((s) => /^OrbiBoard:\/\//i.test(s));
    if (arg) {
      const info = protocol.parse(String(arg));
      if (info.kind === 'task') {
        const text = info.taskText;
        if (!__shouldSkipTask(text)) automationManager?.invokeProtocol(text, info.params || {});
      } else if (info.kind === 'market') {
        __openStore(!!info.install, info.type, info.id);
      } else if (info.kind === 'open' && info.target === 'settings') {
        windowManager.ensureSettingsWindow();
      }
    }
    try {
      if (!arg) {
        windowManager.ensureSettingsWindow();
      }
    } catch (e) {}
  });

  if (process.platform === 'darwin') {
    app.on('open-url', (_e, url) => {
      const info = protocol.parse(String(url || ''));
      if (info.kind === 'task') {
        const text = info.taskText;
        if (!__shouldSkipTask(text)) automationManager?.invokeProtocol(text, info.params || {});
      } else if (info.kind === 'market') {
        __openStore(!!info.install, info.type, info.id);
      } else if (info.kind === 'open' && info.target === 'settings') {
        windowManager.ensureSettingsWindow();
      }
    });
  }
}

function registerProtocolHandlers(app) {
  try {
    if (process.defaultApp) {
      if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('OrbiBoard', process.execPath, [path.resolve(process.argv[1])]);
        try { if (process.platform === 'linux') app.setAsDefaultProtocolClient('orbiboard', process.execPath, [path.resolve(process.argv[1])]); } catch (e) {}
      } else {
        app.setAsDefaultProtocolClient('OrbiBoard', process.execPath, [app.getAppPath()]);
        try { if (process.platform === 'linux') app.setAsDefaultProtocolClient('orbiboard', process.execPath, [app.getAppPath()]); } catch (e) {}
      }
    } else {
      app.setAsDefaultProtocolClient('OrbiBoard');
      try { if (process.platform === 'linux') app.setAsDefaultProtocolClient('orbiboard'); } catch (e) {}
    }
  } catch (e) {}
  try { ensureLinuxProtocolRegistration(); } catch (e) {}
}

function ensureLinuxProtocolRegistration() {
  try {
    if (process.platform !== 'linux') return;
    const appsDir = path.join(require('os').homedir(), '.local', 'share', 'applications');
    try { fs.mkdirSync(appsDir, { recursive: true }); } catch (e) {}
    const execPath = process.env.APPIMAGE || process.execPath;
    const iconPng = path.join(app.getAppPath(), 'logo.png');
    const desktopName = 'orbiboard.desktop';
    const filePath = path.join(appsDir, desktopName);
    const lines = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=OrbiBoard',
      `Exec=${execPath} %u`,
      fs.existsSync(iconPng) ? `Icon=${iconPng}` : '',
      'Terminal=false',
      'Categories=Utility;',
      'MimeType=x-scheme-handler/orbiboard;x-scheme-handler/OrbiBoard;'
    ].filter(Boolean).join('\n');
    fs.writeFileSync(filePath, lines, 'utf-8');
    try {
      const spawn = require('child_process').spawn;
      spawn('xdg-mime', ['default', desktopName, 'x-scheme-handler/orbiboard'], { shell: true });
      spawn('xdg-mime', ['default', desktopName, 'x-scheme-handler/OrbiBoard'], { shell: true });
      try { spawn('update-desktop-database', [appsDir], { shell: true }); } catch (e) {}
    } catch (e) {}
  } catch (e) {}
}

module.exports = { init };
