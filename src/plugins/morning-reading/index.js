const path = require('path');
const { BrowserWindow, app } = require('electron');

let settingsWin = null;

function openSettingsWindow() {
  if (settingsWin && !settingsWin.isDestroyed()) {
    settingsWin.focus();
    return settingsWin;
  }
  settingsWin = new BrowserWindow({
    width: 1240,
    height: 640,
    frame: false,
    show: true,
    resizable: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(app.getAppPath(), 'src', 'preload', 'settings.js')
    }
  });
  settingsWin.loadFile(path.join(__dirname, 'index.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
  return settingsWin;
}

module.exports = {
  name: '早读助手',
  version: '1.0.0',
  // 插件无需运行窗口，仅提供设置与自动化计时器注册
  init: (_api) => { /* no-op */ },
  functions: {
    openSettings: () => { openSettingsWindow(); return true; },
    // 注册时段（从设置页调用），写入自动化计时器
    setSchedule: (periods) => {
      try {
        const am = global.__automationManager__;
        if (!am) return { ok: false, error: 'automation_unavailable' };
        return am.registerPluginTimers('morning.reading', Array.isArray(periods) ? periods : []);
      } catch (e) {
        return { ok: false, error: e?.message || String(e) };
      }
    },
    clearSchedule: () => {
      try {
        const am = global.__automationManager__;
        if (!am) return { ok: false, error: 'automation_unavailable' };
        return am.clearPluginTimers('morning.reading');
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    previewStart: async () => {
      try {
        const payloads = [ { mode: 'sound', which: 'in' }, { mode: 'overlay.text', text: '站立早读开始，请站立朗读', duration: 4000, animate: 'fade', speak: true } ];
        return await require(path.join(app.getAppPath(), 'src', 'main', 'pluginManager.js')).callFunction('notify.plugin', 'enqueueBatch', [payloads]);
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    previewEnd: async () => {
      try {
        const payloads = [ { mode: 'toast', title: '站立早读结束', subText: '请坐下休息', type: 'info', duration: 4000, speak: true }, { mode: 'sound', which: 'out' } ];
        return await require(path.join(app.getAppPath(), 'src', 'main', 'pluginManager.js')).callFunction('notify.plugin', 'enqueueBatch', [payloads]);
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    }
  }
};