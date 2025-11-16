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
  edgeTts = require('edge-tts-nodejs');
  log('edge-tts-nodejs:require');
} catch {
  try {
    edgeTts = require('edge-tts-node');
    log('edge-tts-node:require');
  } catch {
    try {
      edgeTts = require('msedge-tts');
      log('msedge-tts:require');
    } catch {}
  }
}

async function ensureEdgeTts() {
  if (edgeTts) return edgeTts;
  try {
    const m1 = await import('edge-tts-nodejs');
    edgeTts = m1?.default || m1;
    log('edge-tts-nodejs:esm');
    return edgeTts;
  } catch (e1) {
    log('edge-tts-nodejs:error', e1?.message || String(e1));
  }
  try {
    const m2 = await import('edge-tts-node');
    edgeTts = m2?.default || m2;
    log('edge-tts-node:esm');
    return edgeTts;
  } catch (e2) {
    log('edge-tts-node:error', e2?.message || String(e2));
  }
  try {
    const m3 = await import('msedge-tts');
    edgeTts = m3?.default || m3;
    log('msedge-tts:esm');
    return edgeTts;
  } catch (e3) {
    log('msedge-tts:error', e3?.message || String(e3));
    return null;
  }
}

// 可选依赖：系统音量控制（未安装时静默降级）
let volumeLib = null;
let previousVolume = null;
try {
  volumeLib = require('loudness');
  log('volume:require:ok', 'loudness');
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

// 统一的 IPC 注册函数：在初始化或重新启用时调用
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

// 统一的清理函数：禁用或卸载时调用，确保资源一致释放
function cleanup(payload) {
  log('notify:cleanup:start', payload);
  try {
    // 清理窗口
    if (runtimeWin && !runtimeWin.isDestroyed()) {
      try { runtimeWin.webContents?.destroy(); } catch {}
      try { runtimeWin.destroy(); } catch {}
      runtimeWin = null;
    }
    if (settingsWin && !settingsWin.isDestroyed()) {
      try { settingsWin.webContents?.destroy(); } catch {}
      try { settingsWin.destroy(); } catch {}
      settingsWin = null;
    }
    // 清理队列
    pendingQueue = [];
    // 恢复音量
    if (previousVolume != null && volumeLib) {
      try { volumeLib.setVolume(previousVolume); } catch {}
      previousVolume = null;
    }
    // 移除 IPC 处理器
    try {
      ipcMain.removeHandler('notify:setClickThrough');
      ipcMain.removeHandler('notify:setVisible');
      ipcMain.removeHandler('notify:setSystemVolume');
      ipcMain.removeHandler('notify:restoreSystemVolume');
    } catch {}
    log('notify:cleanup:done');
    return true;
  } catch (e) {
    log('notify:cleanup:error', e?.message || String(e));
    return false;
  }
}

module.exports = {
  name: '通知插件',
  version: '1.0.0',
  description: '前置类通知插件：队列化通知、TTS播报、类型音频与两种窗口样式',
  init: (api) => {
    // 插件初始化逻辑
    log('notify:init');
    // 注册 IPC 处理器（避免重复注册：先移除再注册）
    registerIpcHandlers();

    if (app.isReady()) {
      createRuntimeWindow();
    } else {
      app.once('ready', () => { createRuntimeWindow(); registerIpcHandlers(); });
    }
    
    return Promise.resolve();
  },
  // 可供 actions 调用的函数
  functions: {
    openSettings: () => { openSettingsWindow(); return true; },
    reopenRuntime: () => { createRuntimeWindow(); return true; },
    // 统一结构：提供 __plugin_init__，与顶层 init 行为一致（供需要时调用）
    __plugin_init__: () => {
      try {
        if (app.isReady()) {
          createRuntimeWindow();
        } else {
          app.once('ready', () => { createRuntimeWindow(); });
        }
        registerIpcHandlers();
        return true;
      } catch (e) {
        log('notify:init:function:error', e?.message || String(e));
        return false;
      }
    },
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
    // 新增：组件化遮罩入口（统一遮罩通知，按组件渲染）
    overlayComponent: (group, componentId, props, duration, showClose, closeDelay) => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      const payload = { mode: 'overlay.component', group, componentId, props, duration, showClose, closeDelay };
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
    },

    getVariable: async (name) => {
      const key = String(name || '').trim();
      if (key === 'timeISO') return new Date().toISOString();
      if (key === 'queueSize') return String(pendingQueue.length || 0);
      if (key === 'systemVolume') {
        try { if (volumeLib && typeof volumeLib.getVolume === 'function') { const v = await volumeLib.getVolume(); return String(v); } } catch {}
        return '';
      }
      return '';
    },
    listVariables: () => ['timeISO', 'queueSize', 'systemVolume'],

    // 插件生命周期函数：禁用时清理（统一结构）
    disabled: (payload) => cleanup(payload),

    // 插件生命周期函数：卸载时清理（统一结构）
    uninstall: (payload) => cleanup(payload)
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
    // 统一遮罩：组件化遮罩
    { id: 'notify.overlayComponent', name: 'overlayComponent', desc: '组件化全屏遮罩', params: [ { name: 'group', type: 'string' }, { name: 'componentId', type: 'string' }, { name: 'props', type: 'object' }, { name: 'duration', type: 'number' }, { name: 'showClose', type: 'boolean' }, { name: 'closeDelay', type: 'number' } ] },
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
  const lib = await ensureEdgeTts();
  if (!lib) return { ok: false, error: 'edge-tts_node_not_installed' };
  try {
    const safeText = String(text || '').trim();
    if (!safeText) return { ok: false, error: 'empty_text' };
    const voice = String(voiceName || 'zh-CN-XiaoxiaoNeural');
  const MsEdgeTTS = lib?.MsEdgeTTS || lib?.default?.MsEdgeTTS || lib?.MsEdgeTTS || lib;
  const OUTPUT_FORMAT = lib?.OUTPUT_FORMAT || lib?.default?.OUTPUT_FORMAT;
  if (!MsEdgeTTS) return { ok: false, error: 'MsEdgeTTS_unavailable' };

  const tts = new MsEdgeTTS();
    // 优先 MP3，兼容枚举或原始字符串
    let format = 'audio-24khz-48kbitrate-mono-mp3';
    try {
      if (OUTPUT_FORMAT?.AUDIO_24KHZ_48KBITRATE_MONO_MP3) format = OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3;
      await tts.setMetadata(voice, format);
    } catch (eMp3) {
      log('edge-tts-node:setMetadata:mp3:error', eMp3?.message || String(eMp3));
      try {
        const alt = OUTPUT_FORMAT?.WEBM_24KHZ_16BIT_MONO_OPUS || 'WEBM_24KHZ_16BIT_MONO_OPUS';
        format = alt;
        await tts.setMetadata(voice, alt);
      } catch (eWebm) {
        log('edge-tts-node:setMetadata:webm:error', eWebm?.message || String(eWebm));
      }
    }

    const outDir = path.join(os.tmpdir(), 'lesson_notify_tts');
    try { if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true }); } catch {}
    const ext = (String(format).includes('webm') ? 'webm' : 'mp3');
    const fileName = `edge_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
    const outPath = path.join(outDir, fileName);

    try {
      if (typeof tts.toFile === 'function') {
        // 尝试直接写入指定文件路径
        try {
          const res = await tts.toFile(outPath, safeText);
          const fileUrl = 'file:///' + outPath.replace(/\\/g, '/');
          log('edge-tts-node:toFile:ok', outPath);
          return { ok: true, path: fileUrl };
        } catch (eDirect) {
          log('edge-tts-node:toFile:direct:error', eDirect?.message || String(eDirect));
          // 某些库（msedge-tts）要求传入目录，返回 audioFilePath
          const res2 = await tts.toFile(outDir, safeText);
          const finalPath = (res2?.audioFilePath || res2?.filePath || res2?.path || null);
          const pick = finalPath || outPath;
          const fileUrl = 'file:///' + pick.replace(/\\/g, '/');
          log('edge-tts-node:toFile:dir:ok', pick);
          return { ok: true, path: fileUrl };
        }
      }
    } catch (e) {
      log('edge-tts-node:toFile:error', e?.message || String(e));
    }

    // 回退到流写入
    try {
      const readable = await tts.toStream(safeText);
      await new Promise((resolve, reject) => {
        try {
          const ws = fs.createWriteStream(outPath);
          readable.on('error', reject);
          ws.on('error', reject);
          ws.on('finish', resolve);
          readable.pipe(ws);
        } catch (e) { reject(e); }
      });
      const fileUrl = 'file:///' + outPath.replace(/\\/g, '/');
      return { ok: true, path: fileUrl };
    } catch (e) {
      log('edge-tts-node:toStream:error', e?.message || String(e));
      return { ok: false, error: e?.message || String(e) };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

// 在顶部注入轻日志函数（按 system.debugLog 或 LP_DEBUG 开关）
function log(...args) { try { const enabled = (store.get('system','debugLog') || process.env.LP_DEBUG); if (enabled) console.log('[Notify]', ...args); } catch {} }