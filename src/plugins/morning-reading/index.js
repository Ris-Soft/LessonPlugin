const path = require('path');
const { BrowserWindow, app, screen } = require('electron');
const store = require(path.join(app.getAppPath(), 'src', 'main', 'store.js'));

let settingsWin = null;
let pluginApi = null;
let boardWin = null;
let buttonWin = null;
let activeBoard = null;
// 轻日志开关：跟随 system.debugLog 或 LP_DEBUG
const log = (...args) => { try { const enabled = (store.get('system','debugLog') || process.env.LP_DEBUG); if (enabled) console.log('[MorningReading]', ...args); } catch {} };

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

function computeTimesFromPeriods(periods) {
  const list = Array.isArray(periods) ? periods : [];
  const times = new Set();
  for (const p of list) {
    const start = String(p?.start || '').slice(0,5);
    const end = String(p?.end || '').slice(0,5);
    if (/^\d{2}:\d{2}$/.test(start)) times.add(start);
    if (/^\d{2}:\d{2}$/.test(end)) times.add(end);
  }
  return Array.from(times);
}

function handleMinuteTrigger(curHHMM) {
  try {
    const d = new Date();
    const weekday = d.getDay() === 0 ? 7 : d.getDay(); // 1..7
    const cfg = store.getAll('morning-reading') || {};
    const periods = Array.isArray(cfg.periods) ? cfg.periods : [];
    const boardPeriods = Array.isArray(cfg.boardPeriods) ? cfg.boardPeriods : [];
    log('trigger', curHHMM, { weekday });

    // 读取单双周基准
    const base = store.get('system', 'semesterStart') || store.get('system', 'offsetBaseDate');
    const biweekOff = !!store.get('system', 'biweekOffset');
    let isEvenWeek = null;
    if (base) {
      try {
        const baseDate = new Date(base + 'T00:00:00');
        const diffDays = Math.floor((d - baseDate) / (24 * 3600 * 1000));
        const weekIndex = Math.floor(diffDays / 7);
        isEvenWeek = weekIndex % 2 === 0;
        if (biweekOff) isEvenWeek = !isEvenWeek;
      } catch {}
    }
    const matchBiweek = (rule) => {
      if (rule === 'any' || rule == null) return true;
      if (isEvenWeek == null) return false;
      return rule === 'even' ? isEvenWeek : !isEvenWeek;
    };

    const payloads = [];
    for (const p of periods) {
      if (p?.enabled === false) continue;
      const onWeekday = Array.isArray(p?.weekdays) ? p.weekdays.includes(weekday) : true;
      const biweekOk = matchBiweek(p?.biweek);
      const start = String(p?.start || '').slice(0,5);
      const end = String(p?.end || '').slice(0,5);
      log('consider', p?.name || '', { start, end, weekdays: p?.weekdays, biweek: p?.biweek, onWeekday, biweekOk });
      if (!onWeekday || !biweekOk) continue;
      if (start === curHHMM) {
        const speakStart = (p?.speakStart === true ? true : false);
        const which = (p?.soundIn !== false ? 'in' : 'none');
        const text = String(p?.textStart || '早读开始，请站立朗读');
        log('match:start', p?.name || '', { speakStart, which, text });
        payloads.push({ mode: 'overlay.text', text, duration: 5000, animate: 'fade', speak: speakStart, which });
      }
      if (end === curHHMM) {
        const speakEnd = (p?.speakEnd === true ? true : false);
        const which = (p?.soundOut !== false ? 'out' : 'none');
        const title = String(p?.textEnd || '早读结束');
        const subText = String(p?.subTextEnd || '请坐下休息');
        log('match:end', p?.name || '', { speakEnd, which, title, subText });
        payloads.push({ mode: 'toast', title, subText, type: 'info', duration: 4000, speak: speakEnd, which });
      }
    }
    for (const p of boardPeriods) {
      if (p?.enabled === false) continue;
      const onWeekday = Array.isArray(p?.weekdays) ? p.weekdays.includes(weekday) : true;
      const biweekOk = matchBiweek(p?.biweek);
      const start = String(p?.start || '').slice(0,5);
      const end = String(p?.end || '').slice(0,5);
      if (!onWeekday || !biweekOk) continue;
      if (start === curHHMM) {
        try { openBoardWindow(p); } catch {}
      }
      if (end === curHHMM) {
        try { if (buttonWin && !buttonWin.isDestroyed()) { buttonWin.close(); buttonWin = null; } } catch {}
      }
    }
    log('enqueueBatch:size', payloads.length);
    if (payloads.length && pluginApi) {
      try {
        Promise.resolve(pluginApi.call('notify.plugin', 'enqueueBatch', [payloads]))
          .then((res) => { try { log('notify:result', !!res?.ok, res?.error || null); } catch {} })
          .catch((e) => { try { log('notify:error', e?.message || String(e)); } catch {} });
      } catch (e) { try { log('notify:call:thrown', e?.message || String(e)); } catch {} }
    }
  } catch {}
}

function openBoardWindow(period) {
  try {
    const p = (period && typeof period === 'object') ? period : null;
    activeBoard = p;
    if (boardWin && !boardWin.isDestroyed()) { boardWin.focus(); return boardWin; }
    const d = screen.getPrimaryDisplay();
    const b = d.bounds;
    const win = new BrowserWindow({
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      frame: false,
      backgroundColor: '#0b1520',
      show: true,
      resizable: true,
      fullscreen: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    boardWin = win;
    win.loadFile(path.join(__dirname, 'board.html'));
    win.on('closed', () => { boardWin = null; try { if (isBoardPeriodActive()) openOpenButton(); } catch {} });
    return win;
  } catch { return null; }
}

function openOpenButton() {
  try {
    if (buttonWin && !buttonWin.isDestroyed()) return buttonWin;
    const d = screen.getPrimaryDisplay();
    const b = d.bounds;
    const w = 140, h = 56;
    const win = new BrowserWindow({
      x: b.x + Math.floor((b.width - w) / 2),
      y: b.y + b.height - h - 56,
      width: w,
      height: h,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      show: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      webPreferences: { nodeIntegration: false, contextIsolation: true, preload: path.join(__dirname, 'preload.js') }
    });
    buttonWin = win;
    win.loadFile(path.join(__dirname, 'open-button.html'));
    win.on('closed', () => { buttonWin = null; });
    return win;
  } catch { return null; }
}

function isBoardPeriodActive() {
  try {
    const now = new Date();
    const weekday = now.getDay() === 0 ? 7 : now.getDay();
    const cfg = store.getAll('morning-reading') || {};
    const boardPeriods = Array.isArray(cfg.boardPeriods) ? cfg.boardPeriods : [];
    const base = store.get('system', 'semesterStart') || store.get('system', 'offsetBaseDate');
    const biweekOff = !!store.get('system', 'biweekOffset');
    let isEvenWeek = null;
    if (base) {
      try {
        const baseDate = new Date(base + 'T00:00:00');
        const diffDays = Math.floor((now - baseDate) / (24 * 3600 * 1000));
        const weekIndex = Math.floor(diffDays / 7);
        isEvenWeek = weekIndex % 2 === 0;
        if (biweekOff) isEvenWeek = !isEvenWeek;
      } catch {}
    }
    const matchBiweek = (rule) => { if (rule === 'any' || rule == null) return true; if (isEvenWeek == null) return false; return rule === 'even' ? isEvenWeek : !isEvenWeek; };
    const hh = now.getHours().toString().padStart(2, '0');
    const mm = now.getMinutes().toString().padStart(2, '0');
    const cur = `${hh}:${mm}`;
    for (const p of boardPeriods) {
      if (p?.enabled === false) continue;
      const onWeekday = Array.isArray(p?.weekdays) ? p.weekdays.includes(weekday) : true;
      const biweekOk = matchBiweek(p?.biweek);
      const start = String(p?.start || '').slice(0,5);
      const end = String(p?.end || '').slice(0,5);
      if (!onWeekday || !biweekOk) continue;
      if (/^\d{2}:\d{2}$/.test(start) && /^\d{2}:\d{2}$/.test(end)) {
        if (start <= cur && cur < end) return true;
      }
    }
    return false;
  } catch { return false; }
}

module.exports = {
  name: '早读助手',
  version: '1.0.0',
  // 插件无需运行窗口，仅提供设置与自动化计时器注册（在 init 内完成注册）
  init: (api) => {
    pluginApi = api;
    try {
      store.ensureDefaults('morning-reading', { periods: [], boardPeriods: [] });
      const cfg = store.getAll('morning-reading') || {};
      const times = Array.from(new Set([
        ...computeTimesFromPeriods(cfg.periods || []),
        ...computeTimesFromPeriods(cfg.boardPeriods || [])
      ]));
      pluginApi.automation.registerMinuteTriggers(times, handleMinuteTrigger);
      if (isBoardPeriodActive()) openBoardWindow(null);
    } catch {}
  },
  functions: {
    openSettings: () => { openSettingsWindow(); return true; },
    // 由设置页保存时调用：根据传入的时段重新注册分钟触发器
    setSchedule: (periods) => {
      try {
        if (!pluginApi) return { ok: false, error: 'plugin_api_unavailable' };
        const cfg = store.getAll('morning-reading') || {};
        const times = Array.from(new Set([
          ...computeTimesFromPeriods(Array.isArray(periods) ? periods : []),
          ...computeTimesFromPeriods(cfg.boardPeriods || [])
        ]));
        return pluginApi.automation.registerMinuteTriggers(times, handleMinuteTrigger);
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    setBoardSchedule: (periods) => {
      try {
        if (!pluginApi) return { ok: false, error: 'plugin_api_unavailable' };
        const cfg = store.getAll('morning-reading') || {};
        const times = Array.from(new Set([
          ...computeTimesFromPeriods(cfg.periods || []),
          ...computeTimesFromPeriods(Array.isArray(periods) ? periods : [])
        ]));
        return pluginApi.automation.registerMinuteTriggers(times, handleMinuteTrigger);
      } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    clearSchedule: () => {
      try { if (!pluginApi) return { ok: false, error: 'plugin_api_unavailable' }; return pluginApi.automation.clearMinuteTriggers(); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    // 调试：查看当前注册的分钟触发器列表
    listScheduleTimes: () => {
      try { if (!pluginApi) return { ok: true, times: [] }; return pluginApi.automation.listMinuteTriggers(); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
    },
    openBoard: () => { try { openBoardWindow(null); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
    closeBoard: () => { try { if (boardWin && !boardWin.isDestroyed()) boardWin.close(); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
    ensureOpenButton: () => { try { if (isBoardPeriodActive()) openOpenButton(); return true; } catch (e) { return { ok: false, error: e?.message || String(e) }; } },
    setOpenButtonDragging: (flag) => { try { return !!flag; } catch { return false; } },
    getOpenButtonBounds: () => { try { if (!buttonWin || buttonWin.isDestroyed()) return null; return buttonWin.getBounds(); } catch { return null; } },
    moveOpenButtonTo: (x, y) => {
      try {
        if (!buttonWin || buttonWin.isDestroyed()) return false;
        const d = screen.getPrimaryDisplay();
        const sb = d.bounds; const wb = buttonWin.getBounds();
        const nx = Math.max(sb.x, Math.min(x, sb.x + sb.width - wb.width));
        const ny = Math.max(sb.y, Math.min(y, sb.y + sb.height - wb.height));
        buttonWin.setPosition(Math.floor(nx), Math.floor(ny));
        return true;
      } catch { return false; }
    },
    snapOpenButton: () => {
      try {
        if (!buttonWin || buttonWin.isDestroyed()) return false;
        const d = screen.getPrimaryDisplay();
        const wb = buttonWin.getBounds();
        const b = d.bounds;
        const th = 24;
        let x = wb.x, y = wb.y;
        if (Math.abs(wb.x - b.x) <= th) x = b.x;
        if (Math.abs((wb.x + wb.width) - (b.x + b.width)) <= th) x = b.x + b.width - wb.width;
        if (Math.abs(wb.y - b.y) <= th) y = b.y;
        if (Math.abs((wb.y + wb.height) - (b.y + b.height)) <= th) y = b.y + b.height - wb.height;
        if (x !== wb.x || y !== wb.y) buttonWin.setPosition(x, y);
        return true;
      } catch { return false; }
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
    },
    getVariable: async (name) => { const k=String(name||''); if (k==='timeISO') return new Date().toISOString(); if (k==='pluginName') return '早读助手'; return ''; },
    listVariables: () => ['timeISO','pluginName']
  }
};
