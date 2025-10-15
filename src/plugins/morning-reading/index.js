const path = require('path');
const { BrowserWindow, app } = require('electron');

let settingsWin = null;
let pluginApi = null;

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
  init: (api) => { pluginApi = api; },
  functions: {
    openSettings: () => { openSettingsWindow(); return true; },
    // 注册时段（从设置页调用），写入自动化计时器
    setSchedule: (periods) => {
      try {
        if (!pluginApi) return { ok: false, error: 'plugin_api_unavailable' };
        const src = Array.isArray(periods) ? periods : [];
        const mapped = src.map((p, idx) => {
          const soundIn = p?.soundIn !== false;
          const soundOut = p?.soundOut !== false;
          const speakStart = (p?.speakStart === true ? true : false);
          const speakEnd = (p?.speakEnd === true ? true : false);
          const actionsStart = [{
            type: 'pluginEvent', pluginId: 'notify.plugin', event: 'enqueueBatch',
            params: [[{ mode: 'overlay.text', text: String(p?.textStart || '早读开始，请站立朗读'), duration: 5000, animate: 'fade', speak: speakStart, which: (soundIn ? 'in' : 'none') }]]
          }];
          const actionsEnd = [{
            type: 'pluginEvent', pluginId: 'notify.plugin', event: 'enqueueBatch',
            params: [[{ mode: 'toast', title: String(p?.textEnd || '早读结束'), subText: String(p?.subTextEnd || '请坐下休息'), type: 'info', duration: 4000, speak: speakEnd, which: (soundOut ? 'out' : 'none') }]]
          }];
          return {
            id: p?.id || `p_${idx}`,
            name: p?.name || `时段${idx + 1}`,
            enabled: p?.enabled !== false,
            start: p?.start || '',
            end: p?.end || '',
            weekdays: Array.isArray(p?.weekdays) ? p.weekdays : [1,2,3,4,5],
            biweek: ['even','odd','any'].includes(String(p?.biweek)) ? String(p.biweek) : 'any',
            speakStart, speakEnd, soundIn, soundOut,
            textStart: (p?.textStart || ''),
            textEnd: (p?.textEnd || ''),
            subTextEnd: (p?.subTextEnd ?? ''),
            actionsStart, actionsEnd
          };
        });
        return pluginApi.automation.registerTimers(mapped);
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    clearSchedule: () => {
      try { if (!pluginApi) return { ok: false, error: 'plugin_api_unavailable' }; return pluginApi.automation.clearTimers(); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    previewStart: async (period) => {
      try {
        const p = (period && typeof period === 'object') ? period : {};
        const payloads = [];
        payloads.push({ mode: 'overlay.text', text: p.textStart || '站立早读开始', duration: 4000, animate: 'fade', speak: (p.speakStart === true ? true : false), which: (p.soundIn !== false ? 'in' : 'none') });
        if (!pluginApi) return { ok: false, error: 'plugin_api_unavailable' };
        return await pluginApi.call('notify.plugin', 'enqueueBatch', [payloads]);
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    previewEnd: async (period) => {
      try {
        const p = (period && typeof period === 'object') ? period : {};
        const payloads = [];
        payloads.push({ mode: 'toast', title: p.textEnd || '站立早读结束', subText: (p.subTextEnd || '请坐下休息'), type: 'info', duration: 4000, speak: (p.speakEnd === true ? true : false), which: (p.soundOut !== false ? 'out' : 'none') });
        if (!pluginApi) return { ok: false, error: 'plugin_api_unavailable' };
        return await pluginApi.call('notify.plugin', 'enqueueBatch', [payloads]);
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    }
  }
};