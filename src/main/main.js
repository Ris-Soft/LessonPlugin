const { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const fs = require('fs');
const dgram = require('dgram');

const isDev = process.env.NODE_ENV === 'development';
const pluginManager = require('./pluginManager');
const AutomationManager = require('./automationManager');
const store = require('./store');
// 让插件管理器可以访问 ipcMain（用于事件回调注册）
pluginManager._ipcMain = ipcMain;

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
  const image = nativeImage.createFromPath(iconPath);
  tray = new Tray(image);
  const menu = Menu.buildFromTemplate([
    {
      label: '打开设置',
      click: () => {
        if (!settingsWindow) createSettingsWindow();
        settingsWindow.show();
        settingsWindow.focus();
      }
    },
    { type: 'separator' },
    { label: '退出', click: () => app.quit() }
  ]);
  tray.setToolTip('LessonPlugin');
  tray.setContextMenu(menu);
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
  const userPluginsRoot = path.join(userRoot, 'plugins');
  const userRendererRoot = path.join(userRoot, 'renderer');
  const shippedPluginsRoot = path.join(app.getAppPath(), 'src', 'plugins');
  const shippedRendererRoot = path.join(app.getAppPath(), 'src', 'renderer');
  try { fs.mkdirSync(userPluginsRoot, { recursive: true }); } catch {}
  try { fs.mkdirSync(userRendererRoot, { recursive: true }); } catch {}
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

  // 初始化自动化管理器（在 store.init 之后）
  automationManager = new AutomationManager({ app, store, pluginManager });
  automationManager.init();

  // 注册协议处理（LessonPlugin://task/<text>）
  try { app.setAsDefaultProtocolClient('LessonPlugin'); } catch {}
  app.on('second-instance', (_e, argv) => {
    const arg = argv.find((s) => /^LessonPlugin:\/\//i.test(s));
    if (arg) {
      const m = arg.match(/^LessonPlugin:\/\/task\/(.+)$/i);
      if (m) automationManager?.invokeProtocol(decodeURIComponent(m[1]));
    }
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
ipcMain.handle('automation:create', async (_e, payload) => automationManager.create(payload));
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
  return { appVersion: app.getVersion(), electronVersion: process.versions.electron };
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