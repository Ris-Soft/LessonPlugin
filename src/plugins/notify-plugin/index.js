const path = require('path');
const fs = require('fs');
const os = require('os');
const { BrowserWindow, ipcMain, screen, app } = require('electron');
// 读取统一配置存储，用于向运行窗口广播配置更新
const store = require(path.join(app.getAppPath(), 'src', 'main', 'store.js'));
const Module = require('module');

let runtimeWin = null;
let settingsWin = null;
let edgeTts = null;
let pendingQueue = [];
try {
  // 可选依赖：本地 EdgeTTS（若未安装则保持为 null）
  edgeTts = require('edge-tts');
} catch {}

// 可选依赖：系统音量控制（未安装时静默降级）
let volumeLib = null;
let previousVolume = null;
try {
  const cr = Module.createRequire(path.join(app.getAppPath(), 'package.json'));
  volumeLib = cr('loudness');
  log('volume:require:ok', 'loudness', 'via createRequire(app)');
} catch (e) {
  log('volume:require:fail', 'loudness', e?.message || String(e));
}
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
    show: false,
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

  // 提升置顶优先级至最高（macOS 使用最高层级；Windows 忽略 level 但仍为 TOPMOST）
  try {
    runtimeWin.setAlwaysOnTop(true, 'screen-saver');
    // 确保全屏与不同工作区也可见（macOS 有效）
    if (typeof runtimeWin.setVisibleOnAllWorkspaces === 'function') {
      runtimeWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    }
  } catch {}

  // 默认开启穿透
  runtimeWin.setIgnoreMouseEvents(true, { forward: true });

  runtimeWin.loadFile(path.join(__dirname, 'runtime.html'));

  // 运行窗口加载完成后，主动同步一次当前配置，并刷新 pending 队列
  try {
    runtimeWin.webContents.on('did-finish-load', () => {
      try {
        const cfg = store.getAll('notify');
        runtimeWin?.webContents?.send('notify:config:update', cfg);
        log('runtime:broadcast_config');
      } catch {}
      try {
        if (pendingQueue.length) {
          const list = pendingQueue.slice();
          pendingQueue = [];
          log('runtime:flush_pending', list.length);
          runtimeWin?.webContents?.send('notify:enqueue', list);
        }
      } catch {}
    });
  } catch {}

  runtimeWin.on('closed', () => {
    runtimeWin = null;
  });

  return runtimeWin;
}

module.exports = {
  name: '通知插件',
  version: '1.0.0',
  description: '前置类通知插件：队列化通知、TTS播报、类型音频与两种窗口样式',
  init: (api) => {
    // 插件初始化逻辑
    log('notify:init');
    
    // 监听插件卸载事件，进行资源清理
    if (api && typeof api.emit === 'function') {
      // 订阅卸载事件
      try {
        const { ipcMain } = require('electron');
        const cleanupHandler = (event, payload) => {
          if (payload && payload.pluginId === 'notify.plugin') {
            log('notify:cleanup:start');
            try {
              // 清理窗口
              if (runtimeWin && !runtimeWin.isDestroyed()) {
                runtimeWin.destroy();
                runtimeWin = null;
              }
              if (settingsWin && !settingsWin.isDestroyed()) {
                settingsWin.destroy();
                settingsWin = null;
              }
              // 清理队列
              pendingQueue = [];
              // 恢复音量
              if (previousVolume != null && volumeLib) {
                try {
                  volumeLib.setVolume(previousVolume);
                  previousVolume = null;
                } catch {}
              }
              log('notify:cleanup:done');
            } catch (e) {
              log('notify:cleanup:error', e?.message || String(e));
            }
          }
        };
        
        // 监听禁用和卸载事件
        ipcMain.on('__plugin_disabled__', cleanupHandler);
        ipcMain.on('__plugin_uninstall__', cleanupHandler);
      } catch (e) {
        log('notify:cleanup:register:error', e?.message || String(e));
      }
    }
    
    // 注册 IPC 处理器（避免重复注册：先移除再注册）
    const { ipcMain } = require('electron');
    function registerIpcHandlers() {
      try {
        try { ipcMain.removeHandler('notify:setClickThrough'); } catch {}
        ipcMain.handle('notify:setClickThrough', (_evt, enable) => {
          if (!runtimeWin || runtimeWin.isDestroyed()) return false;
          runtimeWin.setIgnoreMouseEvents(Boolean(enable), { forward: true });
          return true;
        });

        try { ipcMain.removeHandler('notify:setVisible'); } catch {}
        ipcMain.handle('notify:setVisible', (_evt, visible) => {
          if (!runtimeWin || runtimeWin.isDestroyed()) return false;
          try { if (visible) runtimeWin.show(); else runtimeWin.hide(); return true; } catch { return false; }
        });

        try { ipcMain.removeHandler('notify:setSystemVolume'); } catch {}
        ipcMain.handle('notify:setSystemVolume', async (_evt, level) => {
          try {
            if (!volumeLib || typeof volumeLib.setVolume !== 'function') {
              log('volume:lib_missing');
              return false;
            }
            const target = Math.max(0, Math.min(100, Number(level || 0)));
            if (previousVolume == null && typeof volumeLib.getVolume === 'function') {
              try { previousVolume = await volumeLib.getVolume(); } catch {}
            }
            await volumeLib.setVolume(target);
            log('volume:set', target);
            return true;
          } catch (e) {
            log('volume:set:error', e?.message || String(e));
            return false;
          }
        });

        try { ipcMain.removeHandler('notify:restoreSystemVolume'); } catch {}
        ipcMain.handle('notify:restoreSystemVolume', async () => {
          try {
            if (!volumeLib || typeof volumeLib.setVolume !== 'function') {
              log('volume:lib_missing');
              return false;
            }
            const pv = previousVolume;
            previousVolume = null;
            if (pv == null) return true;
            await volumeLib.setVolume(Math.max(0, Math.min(100, Number(pv))));
            log('volume:restore', pv);
            return true;
          } catch (e) {
            log('volume:restore:error', e?.message || String(e));
            return false;
          }
        });
      } catch (e) {
        log('notify:ipc_register:error', e?.message || String(e));
      }
    }

    if (app.isReady()) {
      createRuntimeWindow();
      registerIpcHandlers();
    } else {
      app.once('ready', () => { createRuntimeWindow(); registerIpcHandlers(); });
    }
    
    return Promise.resolve();
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
      try {
        if (win.webContents.isLoadingMainFrame()) {
          pendingQueue.push(payload);
          log('enqueue:buffer', payload?.mode || 'unknown');
          return true;
        }
        win.webContents.send('notify:enqueue', payload);
        log('enqueue:send', payload?.mode || 'unknown');
        return true;
      } catch { return false; }
    },
    enqueueBatch: (list) => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      try {
        const payloads = Array.isArray(list) ? list : [list];
        if (win.webContents.isLoadingMainFrame()) {
          pendingQueue.push(...payloads);
          log('enqueueBatch:buffer', payloads.length);
          return true;
        }
        win.webContents.send('notify:enqueue', payloads);
        log('enqueueBatch:send', payloads.length);
        return true;
      } catch { return false; }
    },
    // 兼容自动化事件的细分入口：toast（内部调用 enqueue 构造 payload）
    toast: (title, subText, type, duration, speak) => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      const payload = { mode: 'toast', title, subText, type, duration, speak };
      try {
        if (win.webContents.isLoadingMainFrame()) {
          pendingQueue.push(payload);
          return true;
        }
        win.webContents.send('notify:enqueue', payload);
        return true;
      } catch { return false; }
    },
    // 兼容自动化事件的细分入口：overlay（卡片）
    overlay: (title, subText, autoClose, duration, showClose, closeDelay) => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      const payload = { mode: 'overlay', title, subText, autoClose, duration, showClose, closeDelay };
      try {
        if (win.webContents.isLoadingMainFrame()) {
          pendingQueue.push(payload);
          return true;
        }
        win.webContents.send('notify:enqueue', payload);
        return true;
      } catch { return false; }
    },
    // 兼容自动化事件的细分入口：overlay.text（纯文本遮罩）
    ['overlay.text'](text, duration, animate) {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      const payload = { mode: 'overlay.text', text, duration, animate };
      try {
        if (win.webContents.isLoadingMainFrame()) {
          pendingQueue.push(payload);
          return true;
        }
        win.webContents.send('notify:enqueue', payload);
        return true;
      } catch { return false; }
    },
    // 兼容自动化事件的细分入口：sound（别名，内部调用 playSound）
    sound: (which = 'in') => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      const payload = { mode: 'sound', which: (which === 'out' ? 'out' : 'in') };
      try {
        if (win.webContents.isLoadingMainFrame()) {
          pendingQueue.push(payload);
          return true;
        }
        win.webContents.send('notify:enqueue', payload);
        return true;
      } catch { return false; }
    },
    // 自动化/运行窗口调用：本地 EdgeTTS 合成，返回文件 URL（暂时隐藏入口）
    edgeSpeakLocal: async (text, voiceName) => {
      const res = await synthEdgeTtsToFile(text, voiceName);
      return res;
    },
    // 自动化动作/通用：播放内置音效（in 或 out）
    playSound: (which = 'in') => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      const payload = { mode: 'sound', which: (which === 'out' ? 'out' : 'in') };
      try {
        if (win.webContents.isLoadingMainFrame()) {
          pendingQueue.push(payload);
          return true;
        }
        win.webContents.send('notify:enqueue', payload);
        return true;
      } catch { return false; }
    }
  },
  // 自动化事件声明：暴露可调用动作（更全面）
  automationEvents: [
    // 通用入口：直接传递 payload（模式与参数见 README）
    { id: 'notify.enqueue', name: 'enqueue', desc: '通用通知（直接传对象）', params: [ { name: 'payload', type: 'object', hint: '模式与参数见文档' } ] },
    // 细分入口：toast
    { id: 'notify.toast', name: 'toast', desc: '左上角通知', params: [ { name: 'title', type: 'string' }, { name: 'subText', type: 'string' }, { name: 'type', type: 'string', hint: 'info/warn/error' }, { name: 'duration', type: 'number' }, { name: 'speak', type: 'boolean' } ] },
    // 细分入口：遮罩卡片
    { id: 'notify.overlay', name: 'overlay', desc: '全屏遮罩卡片', params: [ { name: 'title', type: 'string' }, { name: 'subText', type: 'string' }, { name: 'autoClose', type: 'boolean' }, { name: 'duration', type: 'number' }, { name: 'showClose', type: 'boolean' }, { name: 'closeDelay', type: 'number' } ] },
    // 细分入口：纯文本遮罩
    { id: 'notify.overlayText', name: 'overlay.text', desc: '全屏纯文本提示', params: [ { name: 'text', type: 'string' }, { name: 'duration', type: 'number' }, { name: 'animate', type: 'string', hint: 'fade/zoom' } ] },
    // 细分入口：音效
    { id: 'notify.sound', name: 'sound', desc: '播放通知音效', params: [ { name: 'which', type: 'string', hint: 'in/out' } ] }
    // EdgeTTS 入口暂时隐藏
  ]
};

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

// 移除覆盖式导出，避免清空前面已定义的 functions；IPC 已在 init 中注册

// 辅助：使用本地 EdgeTTS 合成并返回音频文件路径（file:///）
async function synthEdgeTtsToFile(text, voiceName) {
  if (!edgeTts) return { ok: false, error: 'edge-tts_not_installed' };
  try {
    const safeText = String(text || '').trim();
    if (!safeText) return { ok: false, error: 'empty_text' };
    const voice = String(voiceName || 'zh-CN-XiaoxiaoNeural');
    const outDir = path.join(os.tmpdir(), 'lesson_notify_tts');
    try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); } catch {}
    const fileName = `edge_${Date.now()}_${Math.random().toString(36).slice(2)}.mp3`;
    const outPath = path.join(outDir, fileName);
    // 常见 edge-tts 用法：生成可读流并写入文件
    // 不同版本 API 可能差异，这里尽量兼容常见调用方式
    let stream = null;
    if (typeof edgeTts?.Synthesize === 'function') {
      stream = await edgeTts.Synthesize(safeText, { voice });
    } else if (typeof edgeTts?.synthesize === 'function') {
      stream = await edgeTts.synthesize(safeText, { voice });
    } else if (typeof edgeTts?.tts === 'function') {
      stream = await edgeTts.tts({ text: safeText, voice });
    }
    if (!stream) return { ok: false, error: 'edge_tts_api_unavailable' };
    await new Promise((resolve, reject) => {
      try {
        const ws = fs.createWriteStream(outPath);
        stream.pipe(ws);
        ws.on('finish', resolve);
        ws.on('error', reject);
      } catch (e) { reject(e); }
    });
    const fileUrl = 'file:///' + outPath.replace(/\\/g, '/');
    return { ok: true, path: fileUrl };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 在顶部注入轻日志函数（按 system.debugLog 或 LP_DEBUG 开关）
function log(...args) { try { const enabled = (store.get('system','debugLog') || process.env.LP_DEBUG); if (enabled) console.log('[Notify]', ...args); } catch {} }