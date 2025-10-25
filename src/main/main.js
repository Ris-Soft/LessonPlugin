const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');
const os = require('os');
const https = require('https');

const isDev = process.env.NODE_ENV === 'development';
const pluginManager = require('./pluginManager');
const AutomationManager = require('./automationManager');
const store = require('./store');
// 让插件管理器可以访问 ipcMain（用于事件回调注册）
pluginManager._ipcMain = ipcMain;

// 供各处使用的全局路径（在 app.whenReady 后赋值）
let userPluginsRoot = '';
let shippedPluginsRoot = '';

// 进程锁：防止重复运行（单实例）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  try { app.quit(); } catch {}
  try { process.exit(0); } catch {}
}

let splashWindow = null;
let settingsWindow = null;
let tray = null;
let splashReady = false;
let splashQueue = [];
let automationManager = null;

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
    } catch {}
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

function createTray() {
  const iconPath = path.join(app.getAppPath(), 'icon.ico');
  // 托盘主图标保持原样，不做反色
  tray = new Tray(nativeImage.createFromPath(iconPath));

  const openSettingsTo = (page) => {
    if (!settingsWindow) createSettingsWindow();
    if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
    settingsWindow.show();
    settingsWindow.focus();
    const sendNav = () => { try { settingsWindow.webContents.send('settings:navigate', page); } catch {} };
    if (settingsWindow.webContents.isLoading()) {
      settingsWindow.webContents.once('did-finish-load', sendNav);
    } else {
      sendNav();
    }
  };

  const openPluginInfo = (pluginKey) => {
    openSettingsTo('plugins');
    const sendInfo = () => { try { settingsWindow.webContents.send('settings:openPluginInfo', pluginKey); } catch {} };
    if (settingsWindow.webContents.isLoading()) {
      settingsWindow.webContents.once('did-finish-load', sendInfo);
    } else {
      sendInfo();
    }
  };

  // 解析 RemixIcon 位图（优先用户数据 renderer/icons，其次应用内置 src/renderer/icons）
  const resolveMenuIcon = (riName) => {
    try {
      const userIconsRoot = path.join(app.getPath('userData'), 'LessonPlugin', 'renderer', 'icons');
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
              } catch {}
            }
            return scaled;
          } catch {}
        }
      }
    } catch {}
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
                try { require('electron').dialog.showErrorBox('执行插件动作失败', e?.message || String(e)); } catch {}
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
    } catch { return [{ label: '加载失败', enabled: false }]; }
  };

  const buildMenu = () => Menu.buildFromTemplate([
    { label: '通用设置', icon: resolveMenuIcon('ri-settings-3-line'), click: () => openSettingsTo('general') },
    { label: '功能市场', icon: resolveMenuIcon('ri-store-2-line'), click: () => openSettingsTo('market') },
    { label: '插件管理', icon: resolveMenuIcon('ri-puzzle-line'), click: () => openSettingsTo('plugins') },
    { label: '自动化', icon: resolveMenuIcon('ri-robot-line'), click: () => openSettingsTo('automation') },
    { label: '档案', icon: resolveMenuIcon('ri-file-user-line'), click: () => openSettingsTo('profiles') },
    { label: '关于', icon: resolveMenuIcon('ri-information-line'), click: () => openSettingsTo('about') },
    { type: 'separator' },
    { label: '插件动作', icon: resolveMenuIcon('ri-play-line'), submenu: buildPluginActionsMenu() },
    { type: 'separator' },
    { label: '退出', icon: resolveMenuIcon('ri-close-circle-line'), click: () => app.quit() }
  ]);

  tray.setToolTip('LessonPlugin');
  tray.setContextMenu(buildMenu());

  // 监听主题变化以刷新菜单项图标
  nativeTheme.on('updated', () => {
    try { tray.setContextMenu(buildMenu()); } catch {}
  });
}

function sendSplashProgress(payload) {
  if (splashWindow && splashReady) {
    splashWindow.webContents.send('plugin-progress', payload);
  } else {
    splashQueue.push(payload);
  }
}

app.whenReady().then(async () => {
  // 初始化统一配置存储
  store.init(app);
  // 确保默认系统设置存在
  store.ensureDefaults('system', {
    splashEnabled: true,
    splashQuoteEnabled: true,
    quoteSource: 'hitokoto',
    quoteApiUrl: 'https://v1.hitokoto.cn/',
    localQuotes: [],
    autostartEnabled: false,
    autostartHigh: false,
    preciseTimeEnabled: false,
    timeOffset: 0,
    autoOffsetDaily: 0,
    offsetBaseDate: new Date().toISOString().slice(0, 10)
  });
  const splashEnabled = store.get('system', 'splashEnabled') !== false;
  if (splashEnabled) {
    createSplashWindow();
  }

  // 将插件根目录迁移到用户数据目录，避免升级或安装覆盖应用资源导致用户插件与配置丢失
  const userRoot = path.join(app.getPath('userData'), 'LessonPlugin');
  userPluginsRoot = path.join(userRoot, 'plugins');
  const userRendererRoot = path.join(userRoot, 'renderer');
  shippedPluginsRoot = path.join(app.getAppPath(), 'src', 'plugins');
  const shippedRendererRoot = path.join(app.getAppPath(), 'src', 'renderer');
  try { fs.mkdirSync(userPluginsRoot, { recursive: true }); } catch {}
  try { fs.mkdirSync(userRendererRoot, { recursive: true }); } catch {}
  // 可选：强制同步内置插件到用户目录（用于开发或修复用户目录旧版本）
  try {
    const forceSyncEnv = String(process.env.LP_FORCE_PLUGIN_SYNC || '').toLowerCase();
    const shouldForceSync = forceSyncEnv === '1' || forceSyncEnv === 'true';
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
              try { fs.copyFileSync(sp, dp); } catch {}
            }
          }
        }
      }
      // 配置文件也覆盖更新
      const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
      const userCfg = path.join(userPluginsRoot, 'config.json');
      try { if (fs.existsSync(shippedCfg)) fs.copyFileSync(shippedCfg, userCfg); } catch {}
    }
  } catch {}
  // 首次运行填充内置插件与默认配置（仅当用户插件目录为空时）
  try {
    const entries = fs.readdirSync(userPluginsRoot).filter((n) => {
      const p = path.join(userPluginsRoot, n);
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    });
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
              try { fs.copyFileSync(sp, dp); } catch {}
            }
          }
        }
      }
      // 复制默认插件配置
      const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
      const userCfg = path.join(userPluginsRoot, 'config.json');
      try { if (fs.existsSync(shippedCfg)) fs.copyFileSync(shippedCfg, userCfg); } catch {}
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
                try { fs.copyFileSync(sp, dp); } catch {}
              }
            }
          }
        }
      }
      // 若缺少配置文件，复制默认配置；若存在则保持用户选择
      const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
      const userCfg = path.join(userPluginsRoot, 'config.json');
      if (!fs.existsSync(userCfg) && fs.existsSync(shippedCfg)) {
        try { fs.copyFileSync(shippedCfg, userCfg); } catch {}
      }
    } catch {}
  } catch {}

  // 镜像公共资源到用户数据目录（供插件通过 ../../renderer 引用）
  try {
    const copyIfDifferent = (src, dest) => {
      try {
        const sStat = fs.statSync(src);
        const dStat = fs.existsSync(dest) ? fs.statSync(dest) : null;
        if (!dStat || sStat.size !== dStat.size || sStat.mtimeMs > dStat.mtimeMs) {
          fs.copyFileSync(src, dest);
        }
      } catch {}
    };
    // 需要的文件：标题栏样式、Remixicon 字体与样式
    const filesToMirror = [
      'titlebar.css',
      'settings.css',
      'remixicon-local.css',
      'remixicon.woff2'
    ];
    for (const f of filesToMirror) {
      const src = path.join(shippedRendererRoot, f);
      const dest = path.join(userRendererRoot, f);
      if (fs.existsSync(src)) copyIfDifferent(src, dest);
    }
  } catch {}

  const manifestPath = path.join(userPluginsRoot, 'plugins.json');
  const configPath = path.join(userPluginsRoot, 'config.json');

  pluginManager.init({ manifestPath, configPath });

  sendSplashProgress({ stage: 'init', message: '初始化插件管理器...' });

  // 提前创建自动化管理器并注入到插件管理器，以便插件 init 阶段能注册分钟触发器
  automationManager = new AutomationManager({ app, store, pluginManager });
  try { pluginManager.setAutomationManager(automationManager); } catch {}
  try { global.__automationManager__ = automationManager; } catch {}

  // 之后再加载插件（插件在 init 内可使用 automation.registerMinuteTriggers）
  try {
    const statuses = await pluginManager.loadPlugins((status) => {
      sendSplashProgress(status);
    });
    sendSplashProgress({ stage: 'done', message: '插件加载完成' });
  } catch (err) {
    sendSplashProgress({ stage: 'error', message: `插件加载失败: ${err.message}` });
  }

  // 创建“打开用户数据”快捷脚本（每次启动检查，缺失则补齐）
  ensureUserDataShortcut();

  // 最后对齐并启动自动化计时器（此时插件注册已完成）
  automationManager.init();

  // 注册协议处理（LessonPlugin://task/<text>）
  try { app.setAsDefaultProtocolClient('LessonPlugin'); } catch {}
  app.on('second-instance', (_e, argv) => {
    // 处理自定义协议（LessonPlugin://task/<text>）
    const arg = argv.find((s) => /^LessonPlugin:\/\//i.test(s));
    if (arg) {
      const m = arg.match(/^LessonPlugin:\/\/task\/(.+)$/i);
      if (m) automationManager?.invokeProtocol(decodeURIComponent(m[1]));
    }
    // 重复启动时打开设置页面（创建并置顶显示）
    try {
      if (!settingsWindow) createSettingsWindow();
      if (settingsWindow?.isMinimized?.()) settingsWindow.restore();
      settingsWindow.show();
      settingsWindow.focus();
    } catch {}
  });
  app.on('open-url', (_e, url) => {
    const m = String(url || '').match(/^LessonPlugin:\/\/task\/(.+)$/i);
    if (m) automationManager?.invokeProtocol(decodeURIComponent(m[1]));
  });

  createTray();
  createSettingsWindow();

  // 关闭启动页
  // 由渲染进程的逻辑决定关闭时机，这里不强制关闭
});

app.on('window-all-closed', () => {
  // 保留托盘，避免应用退出
});

app.on('before-quit', () => {
  try {
    pluginManager.closeAllWindows();
  } catch {}
  try { if (settingsWindow && !settingsWindow.isDestroyed()) settingsWindow.destroy(); } catch {}
  try { if (splashWindow && !splashWindow.isDestroyed()) splashWindow.destroy(); } catch {}
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
    const tmpDir = path.join(app.getPath('temp'), 'LessonPlugin');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const safeName = String(fileName || 'plugin.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
    const buf = Buffer.from(data);
    fs.writeFileSync(tmpPath, buf);
    const res = await pluginManager.installFromZip(tmpPath);
    try { fs.unlinkSync(tmpPath); } catch {}
    return res;
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
// 新增：安装前ZIP检查（二进制数据）
ipcMain.handle('plugin:inspectZipData', async (_e, fileName, data) => {
  try {
    const tmpDir = path.join(app.getPath('temp'), 'LessonPlugin');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    const safeName = String(fileName || 'plugin.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
    const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
    const buf = Buffer.from(data);
    fs.writeFileSync(tmpPath, buf);
    const res = await pluginManager.inspectZip(tmpPath);
    try { fs.unlinkSync(tmpPath); } catch {}
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
    try { await pluginManager.uninstall(key); } catch {}
    try { if (fs.existsSync(dstDir)) fs.rmSync(dstDir, { recursive: true, force: true }); } catch {}
    // 复制开发目录到用户目录
    try { fs.mkdirSync(dstDir, { recursive: true }); } catch {}
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
          try { fs.copyFileSync(sp, dp); } catch {}
        }
      }
    }
    // 重新扫描并加载插件
    const manifestPath = path.join(userPluginsRoot, 'plugins.json');
    const configPath = path.join(userPluginsRoot, 'config.json');
    pluginManager.init({ manifestPath, configPath });
    try { await pluginManager.loadPlugins((status) => sendSplashProgress(status)); } catch {}
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});

// 新增：读取插件 README 文本（本地）
ipcMain.handle('plugin:readme', async (_e, key) => {
  try { return pluginManager.getPluginReadme(key); } catch { return null; }
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
            } catch {
              resolve(null);
            }
          });
        }).on('error', () => resolve(null));
      } catch { resolve(null); }
    });
    if (content) return content;
    // 回退到本地读取
    try { return pluginManager.getPluginReadme(key); } catch { return null; }
  } catch { return null; }
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
    case 'hide':
      win.hide();
      break;
    case 'close':
      win.close();
      break;
    default:
      break;
  }
  return { ok: true };
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

// 档案管理：学生列定义（从插件清单聚合）
ipcMain.handle('profiles:columnDefs', async () => {
  return pluginManager.getStudentColumnDefs();
});

// 插件 API / 事件总线 IPC
ipcMain.on('plugin:register', (event, pluginId, functions) => {
  pluginManager.registerFunctions(pluginId, functions, event.sender);
});
ipcMain.handle('plugin:call', async (event, targetPluginId, fnName, args) => {
  return pluginManager.callFunction(targetPluginId, fnName, args);
});
ipcMain.on('plugin:event:subscribe', (event, evName) => {
  pluginManager.subscribeEvent(evName, event.sender);
});
ipcMain.handle('plugin:event:emit', async (_event, evName, payload) => {
  return pluginManager.emitEvent(evName, payload);
});

// 插件自动化事件注册与查询 IPC
ipcMain.on('plugin:automation:register', (event, pluginId, events) => {
  pluginManager.registerAutomationEvents(pluginId, events);
});
  ipcMain.handle('plugin:automation:listEvents', async (_e, pluginId) => {
    return pluginManager.listAutomationEvents(pluginId);
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
  return store.set(scope, key, value);
});
ipcMain.handle('config:ensureDefaults', async (_e, scope, defaults) => {
  return store.ensureDefaults(scope, defaults);
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
ipcMain.handle('automation:invokeProtocol', async (_e, text) => automationManager.invokeProtocol(text));
ipcMain.handle('automation:test', async (_e, id) => {
  try {
    const res = await automationManager.test(id);
    return res;
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
ipcMain.handle('system:openUserData', async () => {
  try {
    const root = path.join(app.getPath('userData'), 'LessonPlugin');
    try { fs.mkdirSync(root, { recursive: true }); } catch {}
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
    const currentBase = app.getPath('userData');
    const currentRoot = path.join(currentBase, 'LessonPlugin');
    const nextRoot = path.join(targetBase, 'LessonPlugin');
    try { fs.mkdirSync(nextRoot, { recursive: true }); } catch {}
    const copyDir = (src, dst) => {
      if (!fs.existsSync(src)) return;
      const entries = fs.readdirSync(src);
      for (const name of entries) {
        const s = path.join(src, name);
        const d = path.join(dst, name);
        const stat = fs.statSync(s);
        if (stat.isDirectory()) {
          try { fs.mkdirSync(d, { recursive: true }); } catch {}
          copyDir(s, d);
        } else {
          try { fs.copyFileSync(s, d); } catch {}
        }
      }
    };
    copyDir(currentRoot, nextRoot);
    const programDir = path.dirname(process.execPath);
    const markerPath = path.join(programDir, 'user-data.json');
    try { fs.writeFileSync(markerPath, JSON.stringify({ overrideDir: targetBase }, null, 2), 'utf-8'); } catch {}
    return { ok: true, nextPath: targetBase };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
// 卸载前清理用户数据（删除 %APPDATA%/LessonPlugin）
ipcMain.handle('system:cleanupUserData', async () => {
  try {
    const root = path.join(app.getPath('userData'), 'LessonPlugin');
    if (fs.existsSync(root)) {
      // 关闭可能打开的窗口以释放文件句柄
      try { module.exports?.closeAllWindows?.(); } catch {}
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
  } catch {
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
    const settings = app.getLoginItemSettings();
    return { ok: true, openAtLogin: !!settings.openAtLogin };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
});
ipcMain.handle('system:setAutostart', async (_e, enabled, highPriority) => {
  try {
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
    const userRoot = path.join(app.getPath('userData'), 'LessonPlugin');
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
      try { fs.chmodSync(fullPath, 0o755); } catch {}
    }
  } catch {}
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
        try { fs.mkdirSync(target, { recursive: true }); } catch {}
        app.setPath('userData', target);
      }
    }
  } catch {}
}

applyUserDataOverride();

// 图标目录与释放（将Canvas生成的PNG写入用户数据 renderer/icons）
ipcMain.handle('icons:dir', async () => {
  try {
    const dir = path.join(app.getPath('userData'), 'LessonPlugin', 'renderer', 'icons');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    return dir;
  } catch (e) {
    return '';
  }
});
ipcMain.handle('icons:write', async (_e, fileName, dataUrl) => {
  try {
    const dir = path.join(app.getPath('userData'), 'LessonPlugin', 'renderer', 'icons');
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
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
    const userRoot = path.join(app.getPath('userData'), 'LessonPlugin', 'renderer');
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