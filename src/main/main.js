const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const os = require('os');
const https = require('https');

const isDev = process.env.NODE_ENV === 'development';
const pluginManager = require('./pluginManager');
const backendLog = require('./backendLog');
const win32 = require('./win32');
const AutomationManager = require('./automationManager');
const protocol = require('./protocol');
const store = require('./store');
const autoUpdater = require('./autoUpdater');
// 让插件管理器可以访问 ipcMain（用于事件回调注册）
pluginManager._ipcMain = ipcMain;

// 供各处使用的全局路径（在 app.whenReady 后赋值）
  let userPluginsRoot = '';
  let shippedPluginsRoot = '';
  let userComponentsRoot = '';
  let shippedComponentsRoot = '';

// 进程锁：防止重复运行（单实例）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  try { app.quit(); } catch (e) {}
  try { process.exit(0); } catch (e) {}
}

let splashWindow = null;
let settingsWindow = null;
let consoleWindow = null;
let tray = null;
let splashReady = false;
let splashQueue = [];
let automationManager = null;
// 判断是否通过协议参数启动（OrbiBoard://...），用于控制是否创建主窗口
let hasProtocolArgAtBoot = Array.isArray(process.argv) && process.argv.some((s) => /^OrbiBoard:\/\//i.test(String(s || '')));
try {
  const sys = store.getAll('system') || {};
  if (sys.openSettingsOnBootOnce) {
    hasProtocolArgAtBoot = true;
    // 使用一次后清除标记，避免后续正常启动被拦截
    store.set('system', 'openSettingsOnBootOnce', false);
    // 静默处理：不主动打开任何窗口
  }
  // 支持通过 relaunch 参数传递的后置更新标记
  if (process.argv.includes('--post-update')) {
    hasProtocolArgAtBoot = true;
    // 静默处理：不主动打开任何窗口
  }
} catch (e) {}

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
  if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
  if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
  settingsWindow.show();
  settingsWindow.focus();
  const send = () => {
    try {
      settingsWindow.webContents.send('settings:navigate', 'market');
      if (install) settingsWindow.webContents.send('settings:marketInstall', { type, id });
      else settingsWindow.webContents.send('settings:openStoreItem', { type, id });
    } catch (e) {}
  };
  if (settingsWindow.webContents.isLoading()) settingsWindow.webContents.once('did-finish-load', send); else send();
}

function createSplashWindow() {
  // 读取配置以决定窗口尺寸与是否显示名言
  const cfgAll = store.getAll('system') || {};
  const showQuote = cfgAll.splashQuoteEnabled !== false; // 默认显示
  splashWindow = new BrowserWindow({
    width: 640,
    height: showQuote ? 320 : 200,
    useContentSize: true,
    center: true,
    alwaysOnTop: true,
    resizable: false,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'splash.js')
    }
  });
  splashWindow.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
  splashWindow.once('ready-to-show', () => splashWindow.show());
  splashWindow.webContents.once('did-finish-load', () => {
    splashReady = true;
    // 将之前的队列消息发送出去
    try {
      splashQueue.forEach((p) => splashWindow?.webContents?.send('plugin-progress', p));
    } catch (e) {}
    splashQueue = [];
  });
  splashWindow.on('closed', () => { splashWindow = null; });
}

function createSettingsWindow() {
  settingsWindow = new BrowserWindow({
    width: 1344,
    height: 768,
    resizable: true,
    frame: false, // 自定义标题栏
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'settings.js')
    }
  });
  settingsWindow.loadFile(path.join(__dirname, '..', 'renderer', 'settings.html'));
  settingsWindow.on('closed', () => { settingsWindow = null; });
}

function createConsoleWindow() {
  consoleWindow = new BrowserWindow({
    width: 1024,
    height: 640,
    resizable: true,
    frame: false,
    titleBarStyle: 'hidden',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'console.js')
    }
  });
  consoleWindow.loadFile(path.join(__dirname, '..', 'renderer', 'console.html'));
  consoleWindow.on('closed', () => { consoleWindow = null; });
}

function createTray() {
  const iconPath = process.platform === 'win32'
    ? path.join(app.getAppPath(), 'icon.ico')
    : path.join(app.getAppPath(), 'logo.png');
  const baseImg = nativeImage.createFromPath(iconPath);
  const trayImg = baseImg && baseImg.resize ? baseImg.resize({ width: 24, height: 24 }) : baseImg;
  tray = new Tray(trayImg);

  const openSettingsTo = (page) => {
    if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
    if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    const sendNav = () => { try { settingsWindow.webContents.send('settings:navigate', page); } catch (e) {} };
    if (settingsWindow.webContents.isLoading()) {
      settingsWindow.webContents.once('did-finish-load', sendNav);
    } else {
      sendNav();
    }
  };

  const openPluginInfo = (pluginKey) => {
    openSettingsTo('plugins');
    const sendInfo = () => { try { settingsWindow.webContents.send('settings:openPluginInfo', pluginKey); } catch (e) {} };
    if (settingsWindow.webContents.isLoading()) {
      settingsWindow.webContents.once('did-finish-load', sendInfo);
    } else {
      sendInfo();
    }
  };

  // 解析 RemixIcon 位图（优先用户数据 renderer/icons，其次应用内置 src/renderer/icons）
  const resolveMenuIcon = (riName) => {
    try {
      const userIconsRoot = path.join(app.getPath('userData'), 'OrbiBoard', 'renderer', 'icons');
      const candidates = [
        path.join(userIconsRoot, `${riName}.png`),
        path.join(userIconsRoot, `${riName}.ico`),
        path.join(userIconsRoot, `${riName}.jpg`),
        path.join(app.getAppPath(), 'src', 'renderer', 'icons', `${riName}.png`),
        path.join(app.getAppPath(), 'src', 'renderer', 'icons', `${riName}.ico`),
        path.join(app.getAppPath(), 'src', 'renderer', 'icons', `${riName}.jpg`),
        path.join(app.getAppPath(), 'src', 'renderer', `${riName}.png`)
      ];
      for (const fp of candidates) {
        if (fs.existsSync(fp)) {
          try {
            const base = nativeImage.createFromPath(fp);
            const scaled = base && base.resize ? base.resize({ width: 24, height: 24 }) : base;
            // 浅色模式下反色菜单项图标（提高可见性），保留 alpha
            if (!nativeTheme.shouldUseDarkColors && scaled && scaled.getBitmap) {
              try {
                const size = scaled.getSize();
                const buf = scaled.getBitmap();
                for (let i = 0; i < buf.length; i += 4) {
                  buf[i] = 255 - buf[i];
                  buf[i + 1] = 255 - buf[i + 1];
                  buf[i + 2] = 255 - buf[i + 2];
                }
                const inv = nativeImage.createFromBitmap(buf, { width: size.width, height: size.height });
                return inv || scaled;
              } catch (e) {}
            }
            return scaled;
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  };

  const buildPluginActionsMenu = () => {
    try {
      const list = pluginManager.getPlugins() || [];
      const items = [];
      for (const p of list) {
        const acts = Array.isArray(p.actions) ? p.actions : [];
        if (!acts.length) continue;
        const sub = [];
        for (const a of acts) {
          const label = a.text || a.label || a.name || a.id || a.target || '动作';
          sub.push({
            label,
            click: async () => {
              try {
                if (a.id === 'installNpm') {
                  await pluginManager.installNpm(p.id || p.name, (status) => sendSplashProgress(status));
                } else if (a.target) {
                  await pluginManager.callFunction(p.id || p.name, a.target, a.args || {});
                }
              } catch (e) {
                try { require('electron').dialog.showErrorBox('执行插件动作失败', e?.message || String(e)); } catch (e) {}
              }
            }
          });
        }
        sub.push({ type: 'separator' });
        sub.push({ label: '插件信息', click: () => { openPluginInfo(p.id || p.name); } });
        items.push({ label: p.name || p.id, submenu: sub });
      }
      if (!items.length) return [{ label: '暂无可用插件动作', enabled: false }];
      return items;
    } catch (e) { return [{ label: '加载失败', enabled: false }]; }
  };

  const buildMenu = () => Menu.buildFromTemplate([
    { label: '通用设置', icon: resolveMenuIcon('ri-settings-3-line'), click: () => openSettingsTo('general') },
    { label: '功能市场', icon: resolveMenuIcon('ri-store-2-line'), click: () => openSettingsTo('market') },
    { label: '插件管理', icon: resolveMenuIcon('ri-puzzle-line'), click: () => openSettingsTo('plugins') },
    { label: '自动化', icon: resolveMenuIcon('ri-robot-line'), click: () => openSettingsTo('automation') },
    { label: '关于', icon: resolveMenuIcon('ri-information-line'), click: () => openSettingsTo('about') },
    { type: 'separator' },
    { label: '插件动作', icon: resolveMenuIcon('ri-play-line'), submenu: buildPluginActionsMenu() },
    { type: 'separator' },
    { label: '退出', icon: resolveMenuIcon('ri-close-circle-line'), click: () => app.quit() }
  ]);

  tray.setToolTip('OrbiBoard');
  tray.setContextMenu(buildMenu());

  // 监听主题变化以刷新菜单项图标
  nativeTheme.on('updated', () => {
    try { tray.setContextMenu(buildMenu()); } catch (e) {}
  });
}

function sendSplashProgress(payload) {
  try {
    if (splashWindow && splashReady) {
      splashWindow.webContents.send('plugin-progress', payload);
    } else {
      splashQueue.push(payload);
    }
  } catch (e) {}
  // 同步推送到设置窗口（用于前端可视化进度显示）
  try {
    if (settingsWindow && !settingsWindow.isDestroyed()) {
      settingsWindow.webContents.send('plugin-progress', payload);
    }
  } catch (e) {}
}

app.whenReady().then(async () => {
  // 初始化统一配置存储
  store.init(app);
  // 确保默认系统设置存在
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
  // 后端日志：始终捕获与保存（不再受开发者模式限制）
  try { backendLog.init({ enabled: true }); } catch (e) {}
  try { win32.init(); } catch (e) {}
  const splashEnabled = store.get('system', 'splashEnabled') !== false;
  if (splashEnabled) {
    createSplashWindow();
  }
  try { autoUpdater.checkAndUpdate((status) => sendSplashProgress(status)); } catch (e) {}

  const userRoot = path.join(app.getPath('userData'), 'OrbiBoard');
  const devPluginsOverride = '';
  userPluginsRoot = path.join(userRoot, 'plugins');
  userComponentsRoot = path.join(userRoot, 'components');
  const userRendererRoot = path.join(userRoot, 'renderer');
  shippedPluginsRoot = path.join(app.getAppPath(), 'src', 'plugins');
  shippedComponentsRoot = path.join(app.getAppPath(), 'src', 'components');
  const shippedRendererRoot = path.join(app.getAppPath(), 'src', 'renderer');
  try { fs.mkdirSync(userPluginsRoot, { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(userComponentsRoot, { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(userRendererRoot, { recursive: true }); } catch (e) {}
  // 可选：强制同步内置插件到用户目录（用于开发或修复用户目录旧版本）
  try {
    const shouldForceSync = true;
    if (shouldForceSync) {
      const shippedEntries = fs.readdirSync(shippedPluginsRoot).filter((n) => {
        const p = path.join(shippedPluginsRoot, n);
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      });
      for (const entry of shippedEntries) {
        const src = path.join(shippedPluginsRoot, entry);
        const dest = path.join(userPluginsRoot, entry);
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        const stack = [{ s: src, d: dest }];
        while (stack.length) {
          const { s, d } = stack.pop();
          const items = fs.readdirSync(s);
          for (const it of items) {
            const sp = path.join(s, it);
            const dp = path.join(d, it);
            const stat = fs.statSync(sp);
            if (stat.isDirectory()) {
              if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
              stack.push({ s: sp, d: dp });
            } else {
              try { fs.copyFileSync(sp, dp); } catch (e) {}
            }
          }
        }
      }
      // 同步内置组件到用户组件目录
      try {
        const shippedCompEntries = fs.existsSync(shippedComponentsRoot) ? fs.readdirSync(shippedComponentsRoot).filter((n) => {
          const p = path.join(shippedComponentsRoot, n);
          return fs.existsSync(p) && fs.statSync(p).isDirectory();
        }) : [];
        for (const entry of shippedCompEntries) {
          const src = path.join(shippedComponentsRoot, entry);
          const dest = path.join(userComponentsRoot, entry);
          if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
          const stack = [{ s: src, d: dest }];
          while (stack.length) {
            const { s, d } = stack.pop();
            const items = fs.readdirSync(s);
            for (const it of items) {
              const sp = path.join(s, it);
              const dp = path.join(d, it);
              const stat = fs.statSync(sp);
              if (stat.isDirectory()) {
                if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
                stack.push({ s: sp, d: dp });
              } else {
                try { fs.copyFileSync(sp, dp); } catch (e) {}
              }
            }
          }
        }
      } catch (e) {}
      // 配置文件也覆盖更新
      const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
      const userCfg = path.join(userPluginsRoot, 'config.json');
      try { if (fs.existsSync(shippedCfg)) fs.copyFileSync(shippedCfg, userCfg); } catch (e) {}
    }
  } catch (e) {}
  // 首次运行填充内置插件与默认配置（仅当用户插件目录为空时）
  try {
    const entries = fs.existsSync(userPluginsRoot) ? fs.readdirSync(userPluginsRoot).filter((n) => {
      const p = path.join(userPluginsRoot, n);
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    }) : [];
    const needSeed = entries.length === 0;
    if (needSeed) {
      // 复制 shipped plugins 下的各插件目录与 config.json 到用户目录
      const shippedEntries = fs.readdirSync(shippedPluginsRoot);
      for (const entry of shippedEntries) {
        const src = path.join(shippedPluginsRoot, entry);
        const dest = path.join(userPluginsRoot, entry);
        if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
        if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
        // 简易递归复制（仅文件与子目录）
        const stack = [ { s: src, d: dest } ];
        while (stack.length) {
          const { s, d } = stack.pop();
          const items = fs.readdirSync(s);
          for (const it of items) {
            const sp = path.join(s, it);
            const dp = path.join(d, it);
            const stat = fs.statSync(sp);
            if (stat.isDirectory()) {
              if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
              stack.push({ s: sp, d: dp });
            } else {
              try { fs.copyFileSync(sp, dp); } catch (e) {}
            }
          }
        }
      }
      // 复制内置组件到用户组件目录（首次运行）
      try {
        const shippedCompEntries = fs.existsSync(shippedComponentsRoot) ? fs.readdirSync(shippedComponentsRoot) : [];
        for (const entry of shippedCompEntries) {
          const src = path.join(shippedComponentsRoot, entry);
          const dest = path.join(userComponentsRoot, entry);
          if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
          if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
          const stack = [ { s: src, d: dest } ];
          while (stack.length) {
            const { s, d } = stack.pop();
            const items = fs.readdirSync(s);
            for (const it of items) {
              const sp = path.join(s, it);
              const dp = path.join(d, it);
              const stat = fs.statSync(sp);
              if (stat.isDirectory()) {
                if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
                stack.push({ s: sp, d: dp });
              } else {
                try { fs.copyFileSync(sp, dp); } catch (e) {}
              }
            }
          }
        }
      } catch (e) {}
      // 复制默认插件配置
      const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
      const userCfg = path.join(userPluginsRoot, 'config.json');
      try { if (fs.existsSync(shippedCfg)) fs.copyFileSync(shippedCfg, userCfg); } catch (e) {}
    }
    // 每次启动进行增量复制：若用户目录缺少内置插件，则补齐，但不覆盖已有插件
    try {
      const shippedEntries = fs.readdirSync(shippedPluginsRoot).filter((n) => {
        const p = path.join(shippedPluginsRoot, n);
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      });
      for (const entry of shippedEntries) {
        const dest = path.join(userPluginsRoot, entry);
        const src = path.join(shippedPluginsRoot, entry);
        if (!fs.existsSync(dest)) {
          fs.mkdirSync(dest, { recursive: true });
          const stack = [ { s: src, d: dest } ];
          while (stack.length) {
            const { s, d } = stack.pop();
            const items = fs.readdirSync(s);
            for (const it of items) {
              const sp = path.join(s, it);
              const dp = path.join(d, it);
              const stat = fs.statSync(sp);
              if (stat.isDirectory()) {
                if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
                stack.push({ s: sp, d: dp });
              } else {
                try { fs.copyFileSync(sp, dp); } catch (e) {}
              }
            }
          }
        }
      }
      // 增量复制内置组件到用户组件目录（缺失时补齐）
      try {
        if (fs.existsSync(shippedComponentsRoot)) {
          const shippedCompEntries = fs.readdirSync(shippedComponentsRoot).filter((n) => {
            const p = path.join(shippedComponentsRoot, n);
            return fs.existsSync(p) && fs.statSync(p).isDirectory();
          });
          for (const entry of shippedCompEntries) {
            const dest = path.join(userComponentsRoot, entry);
            const src = path.join(shippedComponentsRoot, entry);
            if (!fs.existsSync(dest)) {
              fs.mkdirSync(dest, { recursive: true });
              const stack = [ { s: src, d: dest } ];
              while (stack.length) {
                const { s, d } = stack.pop();
                const items = fs.readdirSync(s);
                for (const it of items) {
                  const sp = path.join(s, it);
                  const dp = path.join(d, it);
                  const stat = fs.statSync(sp);
                  if (stat.isDirectory()) {
                    if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
                    stack.push({ s: sp, d: dp });
                  } else {
                    try { fs.copyFileSync(sp, dp); } catch (e) {}
                  }
                }
              }
            }
          }
        }
      } catch (e) {}
      // 若缺少配置文件，复制默认配置；若存在则保持用户选择
      const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
      const userCfg = path.join(userPluginsRoot, 'config.json');
      if (!fs.existsSync(userCfg) && fs.existsSync(shippedCfg)) {
        try { fs.copyFileSync(shippedCfg, userCfg); } catch (e) {}
      }
    } catch (e) {}
  } catch (e) {}

  try {
    const mirror = (src, dst) => {
      try { fs.mkdirSync(dst, { recursive: true }); } catch (e) {}
      const stack = [{ s: src, d: dst }];
      while (stack.length) {
        const { s, d } = stack.pop();
        if (!fs.existsSync(s)) continue;
        const items = fs.readdirSync(s);
        for (const it of items) {
          const sp = path.join(s, it);
          const dp = path.join(d, it);
          const st = fs.statSync(sp);
          if (st.isDirectory()) { try { fs.mkdirSync(dp, { recursive: true }); } catch (e) {} stack.push({ s: sp, d: dp }); }
          else { try { fs.copyFileSync(sp, dp); } catch (e) {} }
        }
      }
    };
    mirror(shippedRendererRoot, userRendererRoot);
  } catch (e) {}

  const manifestPath = path.join(userPluginsRoot, 'plugins.json');
  const configPath = path.join(userPluginsRoot, 'config.json');
  try { if (!fs.existsSync(userPluginsRoot)) fs.mkdirSync(userPluginsRoot, { recursive: true }); } catch (e) {}
  try { if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} }, null, 2), 'utf-8'); } catch (e) {}
  try { if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, JSON.stringify({ plugins: [] }, null, 2), 'utf-8'); } catch (e) {}

  pluginManager.init({ manifestPath, configPath });

  // 设置缺失插件处理逻辑：当调用不存在的插件时，自动打开市场并提示安装
  pluginManager.setMissingPluginHandler((id) => {
    // 延迟执行以避免阻塞当前IPC调用，并给用户反应时间
    setTimeout(() => {
      try { __openStore(true, 'plugin', id); } catch (e) {}
    }, 100);
  });

  sendSplashProgress({ stage: 'init', message: '初始化插件管理器...' });

  // 提前创建自动化管理器并注入到插件管理器，以便插件 init 阶段能注册分钟触发器
  automationManager = new AutomationManager({ app, store, pluginManager });
  try { pluginManager.setAutomationManager(automationManager); } catch (e) {}
  try { global.__automationManager__ = automationManager; } catch (e) {}

  // 之后再加载插件（插件在 init 内可使用 automation.registerMinuteTriggers）
  try {
    const statuses = await pluginManager.loadPlugins((status) => {
      sendSplashProgress(status);
    });
    sendSplashProgress({ stage: 'done', message: '插件加载完成' });
  } catch (err) {
    sendSplashProgress({ stage: 'error', message: `插件加载失败: ${err.message}` });
  }

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

  // 创建“打开用户数据”快捷脚本（每次启动检查，缺失则补齐）
  ensureUserDataShortcut();

  // 最后对齐并启动自动化计时器（此时插件注册已完成）
  automationManager.init();

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
        try {
          if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
          if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
          settingsWindow.show();
          settingsWindow.focus();
        } catch (e) {}
      }
    }
  } catch (e) {}

  // 注册协议处理（OrbiBoard://task/<text>）
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
        try {
          if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
          if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
          settingsWindow.show();
          settingsWindow.focus();
        } catch (e) {}
      }
    }
    // 若为普通重复启动（非协议调用），打开设置页面；协议调用不创建主窗口
    try {
      if (!arg) {
        if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
        if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
        settingsWindow.show();
        settingsWindow.focus();
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
        try {
          if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
          if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
          settingsWindow.show();
          settingsWindow.focus();
        } catch (e) {}
      }
    });
  }

  createTray();
  // 常规启动才创建主设置窗口；通过协议启动时不创建主窗口
  if (!hasProtocolArgAtBoot) {
    createSettingsWindow();
  }
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
          isVisible: (() => { try { return win.isVisible(); } catch (e) { return false; } })(),
          isFocused: (() => { try { return win.isFocused(); } catch (e) { return false; } })(),
          isMinimized: (() => { try { return win.isMinimized(); } catch (e) { return false; } })(),
          isMaximized: (() => { try { return win.isMaximized(); } catch (e) { return false; } })(),
          isFullScreen: (() => { try { return win.isFullScreen(); } catch (e) { return false; } })(),
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

  // 若为快速重启触发，则启动后自动打开设置页（仅一次）
  try {
    const openOnce = store.get('system', 'openSettingsOnBootOnce');
    if (openOnce) {
      store.set('system', 'openSettingsOnBootOnce', false);
      if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
      settingsWindow.show();
      settingsWindow.focus();
    }
  } catch (e) {}

  // 关闭启动页
  // 由渲染进程的逻辑决定关闭时机，这里不强制关闭
});

app.on('window-all-closed', () => {
  // 保留托盘，避免应用退出
});

app.on('before-quit', () => {
  try {
    pluginManager.closeAllWindows();
  } catch (e) {}
  try { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy(); } catch (e) {}
  try { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy(); } catch (e) {}
});

// IPC for Settings
ipcMain.handle('plugin:list', async () => {
  return pluginManager.getPlugins();
});

ipcMain.handle('plugin:toggle', async (event, name, enabled) => {
  return pluginManager.toggle(name, enabled);
});

ipcMain.handle('plugin:install', async (event, name) => {
  return pluginManager.installNpm(name, (status) => sendSplashProgress(status));
});
ipcMain.handle('plugin:installZip', async (_e, zipPath) => {
  return pluginManager.installFromZip(zipPath);
});
ipcMain.handle('plugin:uninstall', async (_e, name) => {
  return pluginManager.uninstall(name);
});
// 新增：安装前ZIP检查（路径）
ipcMain.handle('plugin:inspectZip', async (_e, zipPath) => {
  return pluginManager.inspectZip(zipPath);
});
ipcMain.handle('plugin:installZipData', async (_e, fileName, data) => {
  try {
    const tmpDir = path.join(app.getPath('temp'), 'OrbiBoard');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const safeName = String(fileName || 'plugin.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
    const buf = Buffer.from(data);
    fs.writeFileSync(tmpPath, buf);
    const res = await pluginManager.installFromZip(tmpPath);
    try { fs.unlinkSync(tmpPath); } catch (e) {}
    return res;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('win32:msgbox', async (_e, text, title) => {
  try {
    win32.messageBox(text, title || 'OrbiBoard');
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
// 新增：安装前ZIP检查（二进制数据）
ipcMain.handle('plugin:inspectZipData', async (_e, fileName, data) => {
  try {
    const tmpDir = path.join(app.getPath('temp'), 'OrbiBoard');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const safeName = String(fileName || 'plugin.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
    const buf = Buffer.from(data);
    fs.writeFileSync(tmpPath, buf);
    const res = await pluginManager.inspectZip(tmpPath);
    try { fs.unlinkSync(tmpPath); } catch (e) {}
    return res;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 开发环境重载指定插件（卸载 -> 从开发目录复制 -> 重新加载）
ipcMain.handle('plugin:reload', async (_e, key) => {
  try {
    const isDev = !app.isPackaged;
    if (!isDev) return { ok: false, error: 'only_dev' };
    const all = await pluginManager.getPlugins();
    const p = (all || []).find(x => (x.id === key) || (x.name === key));
    if (!p) return { ok: false, error: 'not_found' };
    if (!p.local) return { ok: false, error: 'not_local_plugin' };
    const dirName = String(p.local).split(/[\\\/]/).filter(Boolean).pop();
    const srcDir = path.join(shippedPluginsRoot, dirName);
    const dstDir = path.join(userPluginsRoot, dirName);
    if (!fs.existsSync(srcDir)) return { ok: false, error: 'dev_source_missing' };
    // 卸载并清理旧目录
    try { await pluginManager.uninstall(key); } catch (e) {}
    try { if (fs.existsSync(dstDir)) fs.rmSync(dstDir, { recursive: true, force: true }); } catch (e) {}
    // 复制开发目录到用户目录
    try { fs.mkdirSync(dstDir, { recursive: true }); } catch (e) {}
    const stack = [ { s: srcDir, d: dstDir } ];
    while (stack.length) {
      const { s, d } = stack.pop();
      const items = fs.readdirSync(s);
      for (const it of items) {
        const sp = path.join(s, it);
        const dp = path.join(d, it);
        const stat = fs.statSync(sp);
        if (stat.isDirectory()) {
          if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
          stack.push({ s: sp, d: dp });
        } else {
          try { fs.copyFileSync(sp, dp); } catch (e) {}
        }
      }
    }
    // 重新扫描并加载插件
    const manifestPath = path.join(userPluginsRoot, 'plugins.json');
    const configPath = path.join(userPluginsRoot, 'config.json');
    pluginManager.init({ manifestPath, configPath });
    try { await pluginManager.loadPlugins((status) => sendSplashProgress(status)); } catch (e) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 新增：读取插件 README 文本（本地）
ipcMain.handle('plugin:readme', async (_e, key) => {
  try { return pluginManager.getPluginReadme(key); } catch (e) { return null; }
});
// 新增：在线读取插件 README（优先 npm registry）
ipcMain.handle('plugin:readmeOnline', async (_e, key) => {
  try {
    const all = await pluginManager.getPlugins();
    const p = (all || []).find(x => (x.id === key) || (x.name === key));
    const pkgName = p?.npm || p?.name;
    if (!pkgName) return null;
    const url = `https://registry.npmmirror.com/${encodeURIComponent(pkgName)}`;
    const content = await new Promise((resolve) => {
      try {
        https.get(url, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            try {
              const json = JSON.parse(data);
              const md = json?.readme || '';
              resolve(md || null);
            } catch (e) {
              resolve(null);
            }
          });
        }).on('error', () => resolve(null));
      } catch (e) { resolve(null); }
    });
    if (content) return content;
    // 回退到本地读取
    try { return pluginManager.getPluginReadme(key); } catch (e) { return null; }
  } catch (e) { return null; }
});
ipcMain.handle('plugin:uninstallAll', async () => {
  try {
    const list = await pluginManager.getPlugins();
    const items = Array.isArray(list) ? list : [];
    const removed = [];
    for (const p of items) {
      const key = p.id || p.name;
      try {
        await pluginManager.uninstall(key);
        removed.push(key);
      } catch (e) {}
    }
    return { ok: true, removed };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 窗口控制（用于自定义标题栏按钮）
ipcMain.handle('window:control', async (event, action) => {
  // 基于调用方的 webContents 定位所属窗口，避免误关当前聚焦的其他窗口
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (!win) return { ok: false };
  switch (action) {
    case 'minimize':
      win.minimize();
      break;
    case 'maximize':
      win.isMaximized() ? win.unmaximize() : win.maximize();
      break;
    case 'fullscreen':
      try { win.setFullScreen(!win.isFullScreen()); } catch (e) {}
      break;
    case 'hide':
      win.hide();
      break;
    case 'blur':
      try {
        try { win.setFocusable(false); } catch (e) {}
        try { win.blur(); } catch (e) {}
        try { setTimeout(() => { try { win.setFocusable(true); } catch (e) {} }, 500); } catch (e) {}
      } catch (e) {}
      break;
    case 'close':
      win.close();
      break;
    default:
      break;
  }
  return { ok: true };
});

ipcMain.handle('settings:showMenu', async (event, coords) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  const menu = Menu.buildFromTemplate([
    { label: '打开控制台', click: () => {
      try {
        if (!consoleWindow || consoleWindow.isDestroyed()) createConsoleWindow();
        if (consoleWindow?.isMinimized?.()) consoleWindow.restore();
        consoleWindow.show();
        consoleWindow.focus();
      } catch (e) {}
    } },
    { label: '刷新设置页', click: () => { try { win?.webContents?.reload(); } catch (e) {} } },
    { type: 'separator' },
    { label: '快速重启程序', click: () => { try { store.set('system', 'openSettingsOnBootOnce', true); } catch (e) {} app.relaunch(); app.exit(0); } },
    { label: '打开数据目录', click: async () => { try { const root = path.join(app.getPath('userData'), 'OrbiBoard'); try { fs.mkdirSync(root, { recursive: true }); } catch (e) {} await require('electron').shell.openPath(root); } catch (e) {} } },
    { label: '打开安装目录', click: async () => { try { const dir = path.dirname(process.execPath); await require('electron').shell.openPath(dir); } catch (e) {} } },
    { type: 'separator' },
    { label: '退出程序', click: () => app.quit() }
  ]);
  try { menu.popup({ window: win }); } catch (e) {}
  return { ok: true };
});

ipcMain.handle('system:openSettings', async () => {
  try {
    if (!settingsWindow || settingsWindow.isDestroyed()) createSettingsWindow();
    if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('system:update:check', async () => {
  try {
    return await autoUpdater.checkAndUpdate((status) => sendSplashProgress(status));
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// NPM 管理 IPC
ipcMain.handle('npm:versions', async (_e, name) => {
  return pluginManager.getPackageVersions(name);
});
ipcMain.handle('npm:download', async (_e, name, version) => {
  return pluginManager.downloadPackageVersion(name, version, (status) => sendSplashProgress(status));
});
ipcMain.handle('npm:switch', async (_e, pluginName, name, version) => {
  return pluginManager.switchPluginVersion(pluginName, { name, version });
});
ipcMain.handle('npm:installed', async () => {
  return pluginManager.listInstalledPackages();
});
ipcMain.handle('npm:moduleUsers', async (_e, name) => {
  return pluginManager.listPackageUsers(name);
});
ipcMain.handle('npm:remove', async (_e, name, versions) => {
  return pluginManager.removePackageVersions(name, versions);
});
// 插件依赖状态查询（用于设置页/市场页显示）
ipcMain.handle('plugin:deps:status', async (_e, idOrName) => {
  return pluginManager.getPluginDependencyStatus(idOrName);
});
ipcMain.handle('plugin:deps:ensure', async (_e, idOrName) => {
  return pluginManager.ensureDeps(idOrName);
});

// 档案管理：学生列定义（从插件清单聚合）
ipcMain.handle('profiles:columnDefs', async () => {
  return pluginManager.getStudentColumnDefs();
});

// 插件 API / 事件总线 IPC
ipcMain.on('plugin:register', (event, pluginId, functions) => {
  pluginManager.registerFunctions(pluginId, functions, event.sender);
});
ipcMain.handle('plugin:call', async (event, targetPluginId, fnName, args) => {
  try {
    const callerId = pluginManager.getPluginIdByWebContentsId(event.sender.id);
    return pluginManager.callFunction(targetPluginId, fnName, args, callerId || null);
  } catch (e) {
    return pluginManager.callFunction(targetPluginId, fnName, args, null);
  }
});
ipcMain.on('plugin:event:subscribe', (event, evName) => {
  pluginManager.subscribeEvent(evName, event.sender);
});
ipcMain.handle('plugin:event:emit', async (_event, evName, payload) => {
  return pluginManager.emitEvent(evName, payload);
});

// 动作名：聚合、默认映射与调用
ipcMain.handle('actions:list', async () => {
  return pluginManager.listActions();
});
ipcMain.handle('actions:getDefaults', async () => {
  try { return store.getAll('system')?.defaultActions || {}; } catch (e) { return {}; }
});
ipcMain.handle('actions:setDefault', async (_e, actionId, pluginId) => {
  return pluginManager.setDefaultAction(actionId, pluginId);
});
ipcMain.handle('actions:call', async (_e, actionId, args, preferredPluginId) => {
  return pluginManager.callAction(actionId, args, preferredPluginId);
});

// 行为（behavior）接口：与 actions 区分
ipcMain.handle('behaviors:list', async () => {
  return pluginManager.listBehaviors();
});
ipcMain.handle('behaviors:getDefaults', async () => {
  try { return store.getAll('system')?.defaultBehaviors || {}; } catch (e) { return {}; }
});
ipcMain.handle('behaviors:setDefault', async (_e, behaviorId, pluginId) => {
  return pluginManager.setDefaultBehavior(behaviorId, pluginId);
});
ipcMain.handle('behaviors:call', async (_e, behaviorId, args, preferredPluginId) => {
  return pluginManager.callBehavior(behaviorId, args, preferredPluginId);
});

// 插件变量：列表与取值
ipcMain.handle('plugin:variables:list', async (_e, pluginId) => {
  return pluginManager.listVariables(pluginId);
});
ipcMain.handle('plugin:variables:get', async (_e, pluginId, varName) => {
  return pluginManager.getVariable(pluginId, varName);
});

// 组件：列表与入口URL
ipcMain.handle('components:list', async (_e, group) => {
  return pluginManager.listComponents(group);
});
ipcMain.handle('components:entryUrl', async (_e, idOrName) => {
  return pluginManager.getComponentEntryUrl(idOrName);
});

// 插件自动化事件注册与查询 IPC
ipcMain.on('plugin:automation:register', (event, pluginId, events) => {
  pluginManager.registerAutomationEvents(pluginId, events);
});
ipcMain.handle('plugin:automation:listEvents', async (_e, pluginId) => {
  return pluginManager.listAutomationEvents(pluginId);
});

// 窗口状态查询：是否全屏
ipcMain.handle('window:isFullscreen', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (!win) return false;
  try { return !!win.isFullScreen(); } catch (e) { return false; }
});

// 窗口位置与大小：用于拖动区域触发恢复
ipcMain.handle('window:getBounds', async (event) => {
  const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
  if (!win) return null;
  try { return win.getBounds(); } catch (e) { return null; }
});
  // 从设置页直接请求为插件动作创建桌面快捷方式
  ipcMain.handle('plugin:automation:createShortcut', async (_e, pluginId, options) => {
    try {
      return await automationManager.createActionShortcut(pluginId, options || {});
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

// 统一配置存储 IPC
ipcMain.handle('config:getAll', async (_e, scope) => {
  return store.getAll(scope);
});
ipcMain.handle('config:get', async (_e, scope, key) => {
  return store.get(scope, key);
});
ipcMain.handle('config:set', async (_e, scope, key, value) => {
  const r = store.set(scope, key, value);
  try {
    if (scope === 'system' && key === 'developerMode') {
      // 不再根据 developerMode 开关日志；保持始终启用
      backendLog.enableLogging(true);
    }
  } catch (e) {}
  return r;
});
ipcMain.handle('config:deleteScope', async (_e, scope) => {
  return store.deleteScope(scope);
});
ipcMain.handle('config:ensureDefaults', async (_e, scope, defaults) => {
  return store.ensureDefaults(scope, defaults);
});
ipcMain.handle('config:listScopes', async () => {
  try { return store.listPluginScopes(); } catch (e) { return []; }
});
// 规范插件配置读写（按插件规范ID，兼容旧点号ID回退）
ipcMain.handle('config:plugin:getAll', async (_e, pluginKey) => {
  try {
    const canon = pluginManager.canonicalizePluginId(pluginKey);
    const primary = store.getAll(canon);
    if (primary && Object.keys(primary).length) return primary;
    const raw = store.getAll(pluginKey);
    if (raw && Object.keys(raw).length) return raw;
    const dot = store.getAll(String(canon).replace(/-/g, '.'));
    return dot || {};
  } catch (e) { return {}; }
});
ipcMain.handle('config:plugin:get', async (_e, pluginKey, key) => {
  try {
    const canon = pluginManager.canonicalizePluginId(pluginKey);
    let val = store.get(canon, key);
    if (val === undefined) val = store.get(pluginKey, key);
    if (val === undefined) val = store.get(String(canon).replace(/-/g, '.'), key);
    return val;
  } catch (e) { return undefined; }
});
ipcMain.handle('config:plugin:set', async (_e, pluginKey, key, value) => {
  try {
    const canon = pluginManager.canonicalizePluginId(pluginKey);
    return store.set(canon, key, value);
  } catch (e) { return { ok: false, error: e?.message || String(e) }; }
});
// 迁移未知作用域到指定插件（覆盖写入，默认删除源）
ipcMain.handle('config:plugin:migrateScope', async (_e, sourceScope, targetPluginKey, deleteSource = true) => {
  try {
    const data = store.getAll(sourceScope);
    const scope = pluginManager.canonicalizePluginId(targetPluginKey);
    store.setAll(scope, data);
    if (deleteSource) store.deleteScope(sourceScope);
    return { ok: true, targetScope: scope };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 自动化 IPC
ipcMain.handle('automation:list', async () => automationManager.list());
ipcMain.handle('automation:get', async (_e, id) => automationManager.get(id));
ipcMain.handle('automation:create', async (_e, payload) => {
  try {
    const item = await automationManager.create(payload);
    return { ok: true, item };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('automation:update', async (_e, id, patch) => automationManager.update(id, patch));
ipcMain.handle('automation:remove', async (_e, id) => automationManager.remove(id));
ipcMain.handle('automation:toggle', async (_e, id, enabled) => automationManager.toggle(id, enabled));
  ipcMain.handle('automation:invokeProtocol', async (_e, text, params) => automationManager.invokeProtocol(text, params || {}));
ipcMain.handle('automation:test', async (_e, id) => {
  try {
    const res = await automationManager.test(id);
    return res;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
// 检查与更新 IPC
// const autoUpdater = require('./autoUpdater');
ipcMain.handle('system:checkUpdate', async (_e, checkOnly = false) => {
  return require('./autoUpdater').checkAndUpdate((payload) => sendSplashProgress(payload), checkOnly);
});
// 执行更新（之前 checkOnly 返回有更新后，用户确认执行）
ipcMain.handle('system:performUpdate', async (_e) => {
  // 传入 checkOnly=false 以执行更新，复用下载与替换逻辑
  return require('./autoUpdater').checkAndUpdate((payload) => sendSplashProgress(payload), false);
});

// 打包 API (adm-zip)
const AdmZip = require('adm-zip');
ipcMain.handle('plugin:pack', async (_e, pluginId) => {
  try {
    const dir = pluginManager.getPluginDir(pluginId);
    if (!dir) return { ok: false, error: 'plugin_not_found_or_no_local_path' };
    
    if (!fs.existsSync(dir)) return { ok: false, error: 'dir_not_found' };

    const zip = new AdmZip();
    // 添加整个目录内容到 zip 根
    zip.addLocalFolder(dir);
    
    const buffer = zip.toBuffer();
    // 返回 buffer (Uint8Array)
    return { ok: true, zipData: buffer };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

ipcMain.handle('automation:pack', async (_e, id) => {
  try {
    const item = await automationManager.get(id);
    if (!item) return { ok: false, error: 'automation_not_found' };
    
    const zip = new AdmZip();
    // 创建 automation.json
    const content = JSON.stringify(item, null, 2);
    zip.addFile('automation.json', Buffer.from(content, 'utf-8'));
    
    const buffer = zip.toBuffer();
    return { ok: true, zipData: buffer };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 系统与时间相关 IPC
// 简易NTP查询（UDP），失败时返回null
async function queryNtpTime(server, timeoutMs = 1500) {
  return new Promise((resolve) => {
    try {
      const socket = dgram.createSocket('udp4');
      const packet = Buffer.alloc(48);
      packet[0] = 0x1B; // LI=0, VN=3, Mode=3 (client)
      let done = false;
      const finish = (value) => { if (!done) { done = true; try { socket.close(); } catch (_) {} resolve(value); } };
      const timer = setTimeout(() => finish(null), timeoutMs);
      socket.once('error', () => { clearTimeout(timer); finish(null); });
      socket.on('message', (msg) => {
        clearTimeout(timer);
        try {
          const secs = msg.readUInt32BE(40);
          const frac = msg.readUInt32BE(44);
          const NTP_UNIX_OFFSET = 2208988800; // seconds between 1900-01-01 and 1970-01-01
          const unixSecs = secs - NTP_UNIX_OFFSET;
          const ms = unixSecs * 1000 + Math.floor(frac * 1000 / 0x100000000);
          finish(ms);
        } catch (e) {
          finish(null);
        }
      });
      socket.send(packet, 0, packet.length, 123, server, (err) => {
        if (err) { clearTimeout(timer); finish(null); }
      });
    } catch (e) {
      resolve(null);
    }
  });
}

ipcMain.handle('system:getTime', async () => {
  const cfg = store.getAll('system') || {};
  let baseMs = Date.now();
  if (cfg.preciseTimeEnabled) {
    const server = String(cfg.ntpServer || 'ntp.aliyun.com').trim();
    const ntpMs = await queryNtpTime(server).catch(() => null);
    if (typeof ntpMs === 'number' && Number.isFinite(ntpMs)) baseMs = ntpMs;
  }
  // 计算天数差
  const baseDateStr = cfg.semesterStart || cfg.offsetBaseDate || new Date().toISOString().slice(0, 10);
  const todayStr = new Date().toISOString().slice(0, 10);
  // 将日期转为UTC日开始，计算差值
  const baseMsDay = Date.parse(baseDateStr + 'T00:00:00Z');
  const todayMsDay = Date.parse(todayStr + 'T00:00:00Z');
  const days = Math.max(0, Math.floor((todayMsDay - baseMsDay) / (24 * 3600 * 1000)));
  const effectiveOffsetSec = Number(cfg.timeOffset || 0) + days * Number(cfg.autoOffsetDaily || 0);
  const adjMs = baseMs + effectiveOffsetSec * 1000;
  return { nowMs: adjMs, iso: new Date(adjMs).toISOString(), offsetSec: effectiveOffsetSec, daysFromBase: days };
});
// 数据目录相关操作
ipcMain.handle('system:getUserDataPath', async () => {
  try { return app.getPath('userData'); } catch (e) { return ''; }
});
  // 获取数据目录大小（递归计算 %USER_DATA%/OrbiBoard）
ipcMain.handle('system:getUserDataSize', async () => {
  try {
    const root = path.join(app.getPath('userData'), 'OrbiBoard');
    const dirSize = (p) => {
      try {
        if (!fs.existsSync(p)) return 0;
        const entries = fs.readdirSync(p);
        let total = 0;
        for (const name of entries) {
          const sub = path.join(p, name);
          let st;
          try { st = fs.statSync(sub); } catch (e) { continue; }
          if (st.isDirectory()) total += dirSize(sub);
          else total += Number(st.size || 0);
        }
        return total;
      } catch (e) { return 0; }
    };
    const bytes = dirSize(root);
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, bytes: 0, error: e?.message || String(e) };
  }
});
ipcMain.handle('system:openUserData', async () => {
  try {
    const root = path.join(app.getPath('userData'), 'OrbiBoard');
    try { fs.mkdirSync(root, { recursive: true }); } catch (e) {}
    const res = await require('electron').shell.openPath(root);
    return { ok: !res, error: res || null };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('system:changeUserData', async () => {
  try {
    const sel = await require('electron').dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (sel.canceled || !sel.filePaths || !sel.filePaths[0]) return { ok: false, error: '未选择目录' };
    const targetBase = sel.filePaths[0];
    if (path.resolve(targetBase) === path.resolve(app.getPath('userData'))) {
      return { ok: false, error: '选择的目录与当前目录相同' };
    }
    const currentBase = app.getPath('userData');
    const currentRoot = path.join(currentBase, 'OrbiBoard');
    const nextRoot = path.join(targetBase, 'OrbiBoard');
    try { fs.mkdirSync(nextRoot, { recursive: true }); } catch (e) {}
    const copyDir = (src, dst) => {
      if (!fs.existsSync(src)) return;
      const entries = fs.readdirSync(src);
      for (const name of entries) {
        const s = path.join(src, name);
        const d = path.join(dst, name);
        const stat = fs.statSync(s);
        if (stat.isDirectory()) {
          try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
          copyDir(s, d);
        } else {
          try { fs.copyFileSync(s, d); } catch (e) {}
        }
      }
    };
    copyDir(currentRoot, nextRoot);
    const programDir = path.dirname(process.execPath);
    const markerPath = path.join(programDir, 'user-data.json');
    let writeOk = false;
    try { fs.writeFileSync(markerPath, JSON.stringify({ overrideDir: targetBase }, null, 2), 'utf-8'); writeOk = true; } catch (e) {}
    let verifyOk = false;
    try {
      const text = fs.readFileSync(markerPath, 'utf-8');
      const cfg = JSON.parse(text);
      verifyOk = String(cfg?.overrideDir || '') === targetBase;
    } catch (e) {}
    if (!writeOk || !verifyOk) {
      return { ok: false, error: '无法写入应用目录标记文件，请检查权限后重试' };
    }
    return { ok: true, nextPath: targetBase };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
// 卸载前清理用户数据（删除 %APPDATA%/OrbiBoard）
ipcMain.handle('system:cleanupUserData', async () => {
  try {
    const root = path.join(app.getPath('userData'), 'OrbiBoard');
    if (fs.existsSync(root)) {
      // 关闭可能打开的窗口以释放文件句柄
      try { module.exports?.closeAllWindows?.(); } catch (e) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('system:getAppInfo', async () => {
  let platformText = '';
  try {
    const ver = (typeof os.version === 'function') ? os.version() : '';
    const release = os.release();
    const plat = process.platform;
    const name = plat === 'win32' ? 'Windows' : (plat === 'darwin' ? 'macOS' : (plat === 'linux' ? 'Linux' : plat));
    if (ver && typeof ver === 'string' && ver.trim()) {
      platformText = plat === 'win32' ? `${ver} ${release}` : ver; // Windows: 追加构建号
    } else {
      platformText = `${name} ${release}`;
    }
  } catch (e) {
    const release = require('os').release();
    const plat = process.platform;
    const name = plat === 'win32' ? 'Windows' : (plat === 'darwin' ? 'macOS' : (plat === 'linux' ? 'Linux' : plat));
    platformText = `${name} ${release}`;
  }
  const archRaw = process.arch;
  const archLabel = archRaw === 'ia32' ? 'x86' : archRaw;
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    chromeVersion: process.versions.chrome,
    platform: `${platformText} (${archLabel})`,
    isDev: !app.isPackaged
  };
});
ipcMain.handle('system:getAutostart', async () => {
  try {
    if (process.platform === 'linux') {
      const configDir = process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config');
      const autoDir = path.join(configDir, 'autostart');
      const filePath = path.join(autoDir, 'OrbiBoard.desktop');
      let enabled = false;
      if (fs.existsSync(filePath)) {
        try {
          const text = fs.readFileSync(filePath, 'utf-8');
          const m = text.match(/X-GNOME-Autostart-enabled\s*=\s*(true|false)/i);
          if (m) enabled = String(m[1]).toLowerCase() === 'true'; else enabled = true;
        } catch (e) { enabled = true; }
      }
      return { ok: true, openAtLogin: enabled };
    }
    const settings = app.getLoginItemSettings();
    return { ok: true, openAtLogin: !!settings.openAtLogin };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('system:setAutostart', async (_e, enabled, highPriority) => {
  try {
    if (process.platform === 'linux') {
      const configDir = process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config');
      const autoDir = path.join(configDir, 'autostart');
      try { fs.mkdirSync(autoDir, { recursive: true }); } catch (e) {}
      const filePath = path.join(autoDir, 'OrbiBoard.desktop');
      if (enabled) {
        const execPath = process.env.APPIMAGE || process.execPath;
        const iconPng = path.join(app.getAppPath(), 'logo.png');
  const lines = [
          '[Desktop Entry]',
          'Type=Application',
          'Name=OrbiBoard',
          `Exec=${execPath}`,
          fs.existsSync(iconPng) ? `Icon=${iconPng}` : '',
          'Terminal=false',
          'Categories=Utility;',
          'X-GNOME-Autostart-enabled=true',
          'OnlyShowIn=Deepin;GNOME;KDE;',
          'Hidden=false'
        ].filter(Boolean).join('\n');
        fs.writeFileSync(filePath, lines, 'utf-8');
        try { fs.chmodSync(filePath, 0o644); } catch (e) {}
      } else {
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
      }
      store.set('system', 'autostartEnabled', !!enabled);
      store.set('system', 'autostartHigh', !!highPriority);
      return { ok: true };
    }
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    store.set('system', 'autostartEnabled', !!enabled);
    store.set('system', 'autostartHigh', !!highPriority);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
// 在程序目录创建“打开用户数据”快捷脚本（跨平台）
function ensureUserDataShortcut() {
  try {
    const programDir = path.dirname(process.execPath);
    const userRoot = path.join(app.getPath('userData'), 'OrbiBoard');
    let fileName = '';
    let content = '';
    if (process.platform === 'win32') {
      fileName = 'Open User Data.bat';
      content = `@echo off\r\nstart "" "${userRoot.replace(/\\/g,'\\\\')}"\r\n`;
    } else if (process.platform === 'darwin') {
      fileName = 'Open User Data.command';
      content = `#!/bin/bash\nopen "${userRoot}"\n`;
    } else {
      // linux
      fileName = 'Open User Data.sh';
      content = `#!/bin/sh\nxdg-open "${userRoot}" 2>/dev/null || xdg-open "${userRoot}"\n`;
    }
    const fullPath = path.join(programDir, fileName);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, content, 'utf-8');
      try { fs.chmodSync(fullPath, 0o755); } catch (e) {}
    }
  } catch (e) {}
}
  // 应用启动前尝试应用数据目录重定向（从程序目录标记文件读取）
function applyUserDataOverride() {
  try {
    const programDir = path.dirname(process.execPath);
    const markerPath = path.join(programDir, 'user-data.json');
    if (fs.existsSync(markerPath)) {
      const text = fs.readFileSync(markerPath, 'utf-8');
      const cfg = JSON.parse(text);
      const overrideDir = String(cfg?.overrideDir || '').trim();
      if (overrideDir) {
        const target = path.isAbsolute(overrideDir) ? overrideDir : path.join(programDir, overrideDir);
        try { fs.mkdirSync(target, { recursive: true }); } catch (e) {}
        app.setPath('userData', target);
      }
    }
  } catch (e) {}
}

applyUserDataOverride();

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

// 图标目录与释放（将Canvas生成的PNG写入用户数据 renderer/icons）
ipcMain.handle('icons:dir', async () => {
  try {
    const dir = path.join(app.getPath('userData'), 'OrbiBoard', 'renderer', 'icons');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    return dir;
  } catch (e) {
    return '';
  }
});
ipcMain.handle('icons:write', async (_e, fileName, dataUrl) => {
  try {
    const dir = path.join(app.getPath('userData'), 'OrbiBoard', 'renderer', 'icons');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
    const safe = String(fileName || 'icon.png').replace(/[^a-zA-Z0-9._-]/g, '_');
    const target = path.join(dir, safe);
    const m = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/i);
    if (!m) return { ok: false, error: '无效PNG数据' };
    const buf = Buffer.from(m[1], 'base64');
    fs.writeFileSync(target, buf);
    return { ok: true, path: target };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 资源路径解析：为插件窗口提供统一的资源URL（优先用户数据镜像，其次应用内置）
ipcMain.handle('asset:url', async (_e, relPath) => {
  try {
    const userRoot = path.join(app.getPath('userData'), 'OrbiBoard', 'renderer');
    const shippedRoot = path.join(app.getAppPath(), 'src', 'renderer');
    const candidates = [path.join(userRoot, relPath), path.join(shippedRoot, relPath)];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) return null;
    const url = 'file://' + found.replace(/\\/g, '/');
    return url;
  } catch (e) {
    return null;
  }
});
ipcMain.handle('plugin:dependents', async (_e, idOrName) => {
  return pluginManager.listDependents(idOrName);
});
// 重启应用（开发者模式工具）
ipcMain.handle('system:restart', async () => {
  try {
    // 下次启动仅一次地自动打开设置页
    try { store.set('system', 'openSettingsOnBootOnce', true); } catch (e) {}
    app.relaunch();
    app.exit(0);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('system:openInstallDir', async () => {
  try {
    const dir = path.dirname(process.execPath);
    const res = await require('electron').shell.openPath(dir);
    return { ok: !res, error: res || null };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('system:quit', async () => {
  try { app.quit(); return { ok: true }; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
});
// 调试日志：最近记录查询与订阅实时流
ipcMain.handle('debug:logs:get', async () => {
  try { return backendLog.getLast(20); } catch (e) { return []; }
});
ipcMain.on('debug:logs:subscribe', (event) => {
  try { backendLog.subscribe(event.sender); } catch (e) {}
});
ipcMain.handle('debug:logs:getEntries', async (_e, count = 500) => {
  try { return backendLog.getLastEntries(count); } catch (e) { return []; }
});
ipcMain.handle('debug:log:write', async (_e, level, ...args) => {
  try { backendLog.write(level, ...(Array.isArray(args) ? args : [args])); return { ok: true }; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
});
ipcMain.handle('console:open', async () => {
  try {
    if (!consoleWindow || consoleWindow.isDestroyed()) createConsoleWindow();
    if (consoleWindow?.isMinimized?.()) consoleWindow.restore();
    consoleWindow.show();
    consoleWindow.focus();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('console:metrics', async () => {
  try {
    const info = {};
    try {
      info.process = {
        memory: (() => {
          try {
            const m = process.memoryUsage();
            return { rss: m.rss, heapTotal: m.heapTotal, heapUsed: m.heapUsed, external: m.external };
          } catch (e) { return {}; }
        })(),
        cpu: (() => {
          try {
            const c = process.cpuUsage();
            return { user: c.user, system: c.system };
          } catch (e) { return {}; }
        })(),
        uptimeSec: (() => { try { return process.uptime(); } catch (e) { return 0; } })()
      };
    } catch (e) {}
    try {
      info.appMetrics = (typeof require('electron').app.getAppMetrics === 'function') ? require('electron').app.getAppMetrics() : [];
    } catch (e) { info.appMetrics = []; }
    try {
      const list = await pluginManager.getPlugins();
      info.plugins = { total: Array.isArray(list) ? list.length : 0, enabled: (Array.isArray(list) ? list.filter(p => p.enabled).length : 0) };
    } catch (e) { info.plugins = { total: 0, enabled: 0 }; }
    return { ok: true, info };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('console:listWindows', async () => {
  try {
    const { BrowserWindow } = require('electron');
    const wins = BrowserWindow.getAllWindows();
    const data = wins.map((w) => {
      let url = '';
      try { url = w.webContents.getURL(); } catch (e) {}
      let title = '';
      try { title = w.getTitle(); } catch (e) {}
      let bounds = null;
      try { bounds = w.getBounds(); } catch (e) {}
      let webContentsId = null;
      try { webContentsId = w.webContents.id; } catch (e) {}
      let pluginId = null;
      try { pluginId = pluginManager.getPluginIdByWebContentsId(webContentsId); } catch (e) {}
      return {
        id: w.id,
        title,
        url,
        isVisible: (() => { try { return w.isVisible(); } catch (e) { return false; } })(),
        isFocused: (() => { try { return w.isFocused(); } catch (e) { return false; } })(),
        isMinimized: (() => { try { return w.isMinimized(); } catch (e) { return false; } })(),
        isMaximized: (() => { try { return w.isMaximized(); } catch (e) { return false; } })(),
        isFullScreen: (() => { try { return w.isFullScreen(); } catch (e) { return false; } })(),
        webContentsId,
        bounds,
        pluginId
      };
    });
    return { ok: true, windows: data };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('console:openDevTools', async (_e, windowId) => {
  try {
    const { webContents } = require('electron');
    const wc = webContents.fromId(Number(windowId));
    if (!wc) return { ok: false, error: 'window_not_found' };
    try { wc.openDevTools({ mode: 'detach' }); } catch (e) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('console:focusWindow', async (_e, windowId) => {
  try {
    const { BrowserWindow } = require('electron');
    const wins = BrowserWindow.getAllWindows();
    const target = wins.find(w => w.id === Number(windowId));
    if (!target) return { ok: false, error: 'window_not_found' };
    try { target.show(); target.focus(); } catch (e) {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('console:controlWindow', async (_e, windowId, action) => {
  try {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.getAllWindows().find(w => w.id === Number(windowId));
    if (!win) return { ok: false, error: 'window_not_found' };
    switch (String(action)) {
      case 'minimize': try { win.minimize(); } catch (e) {} break;
      case 'maximize': try { win.isMaximized() ? win.unmaximize() : win.maximize(); } catch (e) {} break;
      case 'reload': try { win.webContents?.reload(); } catch (e) {} break;
      case 'close': try { win.close(); } catch (e) {} break;
      case 'fullscreen': try { win.setFullScreen(!win.isFullScreen()); } catch (e) {} break;
      case 'hide': try { win.hide(); } catch (e) {} break;
      default: break;
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('console:exportText', async (_e, text, defaultName = 'backend.log') => {
  try {
    const { dialog } = require('electron');
    const { filePath, canceled } = await dialog.showSaveDialog({
      title: '保存日志',
      defaultPath: defaultName,
      filters: [{ name: '日志', extensions: ['log', 'txt'] }]
    });
    if (canceled || !filePath) return { ok: false, error: 'cancelled' };
    require('fs').writeFileSync(filePath, String(text || ''), 'utf-8');
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
