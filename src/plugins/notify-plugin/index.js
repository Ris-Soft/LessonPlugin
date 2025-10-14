const path = require('path');
const fs = require('fs');
const os = require('os');
const { BrowserWindow, ipcMain, screen, app } = require('electron');
// 读取统一配置存储，用于向运行窗口广播配置更新
const store = require(path.join(app.getAppPath(), 'src', 'main', 'store.js'));

let runtimeWin = null;
let settingsWin = null;
let edgeTts = null;
try {
  // 可选依赖：本地 EdgeTTS（若未安装则保持为 null）
  edgeTts = require('edge-tts');
} catch {}

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
    },
    // 自动化/运行窗口调用：本地 EdgeTTS 合成，返回文件 URL
    edgeSpeakLocal: async (text, voiceName) => {
      const res = await synthEdgeTtsToFile(text, voiceName);
      return res;
    },
    // 自动化动作：纯文本全屏提示（无卡片），支持载入/载出动画
    overlayText: (text, duration = 3000, animate = 'fade') => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      const payload = { mode: 'overlay.text', text: String(text || ''), duration: Number(duration) || 3000, animate: String(animate || 'fade') };
      try { win.webContents.send('notify:enqueue', payload); return true; } catch { return false; }
    },
    // 自动化动作/通用：播放内置音效（in 或 out）
    playSound: (which = 'in') => {
      const win = createRuntimeWindow();
      if (!win || win.isDestroyed()) return false;
      const payload = { mode: 'sound', which: (which === 'out' ? 'out' : 'in') };
      try { win.webContents.send('notify:enqueue', payload); return true; } catch { return false; }
    }
  },
  // 自动化事件声明：暴露可调用动作
  automationEvents: [
    { id: 'notify.overlayText', name: 'overlayText', desc: '全屏纯文本提示', params: [ { name: 'text', type: 'string' }, { name: 'duration', type: 'number' }, { name: 'animate', type: 'string', hint: 'fade/zoom' } ] },
    { id: 'notify.playSound', name: 'playSound', desc: '播放通知音效', params: [ { name: 'which', type: 'string', hint: 'in/out' } ] },
    { id: 'notify.edgeSpeak', name: 'edgeSpeakLocal', desc: '本地 EdgeTTS 合成并播放', params: [ { name: 'text', type: 'string' }, { name: 'voice', type: 'string' } ] }
  ]
};