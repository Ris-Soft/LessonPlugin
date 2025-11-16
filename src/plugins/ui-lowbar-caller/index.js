// 调用者插件：通过动作调用 UI模板-低栏应用 打开窗口
const path = require('path');
const url = require('url');
let pluginApi = null;
// 运行态状态由调用方掌控
const state = {
  eventChannel: 'example.lowbar',
  currentMode: 'clock',
  clockOpts: { date: 0, seconds: 0, blink: 0 },
  backgroundTargets: {},
  floatBase: '',
  floatCountdownBase: '',
  countdownMins: 10,
  countdownUntil: null,
  countdownPaused: false,
  countdownRemain: 0,
  calendarOffset: 0
};

function emitUpdate(target, value) {
  console.log('[CALLER] emitUpdate called:', target, value);
  console.log('[CALLER] Using eventChannel:', state.eventChannel);
  try {
    const updateData = { type: 'update', target, value };
    console.log('[CALLER] Emitting update data:', updateData);
    pluginApi.emit(state.eventChannel, updateData);
    console.log('[CALLER] Update emitted successfully');
  } catch (e) {
    console.error('[CALLER] Error emitting update:', e);
  }
}
function buildClockUrl() {
  const base = state.backgroundTargets.clock || '';
  if (!base) return '';
  const u = new URL(base);
  u.searchParams.set('date', String(state.clockOpts.date));
  u.searchParams.set('seconds', String(state.clockOpts.seconds));
  u.searchParams.set('blink', String(state.clockOpts.blink));
  return u.href;
}
function leftItemsForMode(mode) {
  // 左侧仅保留功能选择入口；倒计时设置改到中间
  return [ { id: 'openControls', text: '功能选择', icon: 'ri-tools-line' } ];
}

function centerItemsForMode(mode) {
  if (mode === 'clock') {
    return [
      { id: 'clock-date', text: '显示日期', icon: 'ri-calendar-line', active: !!state.clockOpts.date },
      { id: 'clock-seconds', text: '显示秒数', icon: 'ri-time-line', active: !!state.clockOpts.seconds },
      { id: 'clock-blink', text: '冒号闪烁', icon: 'ri-flashlight-line', active: !!state.clockOpts.blink }
    ];
  }
  if (mode === 'countdown') {
    return [
      { id: 'countdown-set', text: '设置时长', icon: 'ri-time-line' },
      { id: 'countdown-reset', text: '重置', icon: 'ri-restart-line' },
      { id: 'countdown-pause', text: '暂停', icon: 'ri-pause-line' },
      { id: 'countdown-start', text: '开始', icon: 'ri-play-line' }
    ];
  }
  if (mode === 'stopwatch') {
    return [
      { id: 'stopwatch-start', text: '开始', icon: 'ri-play-line' },
      { id: 'stopwatch-stop', text: '停止', icon: 'ri-stop-line' },
      { id: 'stopwatch-reset', text: '重置', icon: 'ri-restart-line' }
    ];
  }
  if (mode === 'calendar') {
    return [
      { id: 'cal-prev', text: '上月', icon: 'ri-arrow-left-s-line' },
      { id: 'cal-today', text: '本月', icon: 'ri-calendar-2-line' },
      { id: 'cal-next', text: '下月', icon: 'ri-arrow-right-s-line' }
    ];
  }
  return [];
}

function buildCountdownUrl(mins){
  const base = state.backgroundTargets.countdown || '';
  if (!base) return '';
  const u = new URL(base);
  u.searchParams.set('mins', String(Math.max(1, Math.floor(mins || 10))));
  return u.href;
}

function buildCountdownUrlFromState(){
  const base = state.backgroundTargets.countdown || '';
  if (!base) return '';
  const u = new URL(base);
  if (state.countdownPaused) {
    u.searchParams.set('paused', '1');
    u.searchParams.set('remain', String(Math.max(0, Math.floor(state.countdownRemain || state.countdownMins*60))));
  } else if (state.countdownUntil && Number.isFinite(state.countdownUntil)) {
    u.searchParams.set('until', String(state.countdownUntil));
  } else {
    u.searchParams.set('mins', String(Math.max(1, Math.floor(state.countdownMins || 10))));
  }
  return u.href;
}

function buildStopwatchUrl(action){
  const base = state.backgroundTargets.stopwatch || '';
  if (!base) return '';
  const u = new URL(base);
  if (action) u.searchParams.set('action', action);
  return u.href;
}

function buildCalendarUrl(){
  const base = state.backgroundTargets.calendar || '';
  if (!base) return '';
  const u = new URL(base);
  u.searchParams.set('offset', String(state.calendarOffset || 0));
  return u.href;
}

const functions = {
  openLowbarTemplate: async (_params = {}) => {
    try {
      // 计算本插件内置页面的 file:// URL
      const clockFile = path.join(__dirname, 'background', 'clock.html');
      const calendarFile = path.join(__dirname, 'background', 'calendar.html');
      const countdownFile = path.join(__dirname, 'background', 'countdown.html');
      const stopwatchFile = path.join(__dirname, 'background', 'stopwatch.html');
      const floatFile = path.join(__dirname, 'float', 'control.html');
      const floatCdFile = path.join(__dirname, 'float', 'countdown.html');
      const bgUrl = url.pathToFileURL(clockFile).href + '?date=0&seconds=0&blink=0';

      const params = {
        title: 'UI模板-低栏应用',
        // 事件通道用于双向通讯，示例使用 example.lowbar
        eventChannel: 'example.lowbar',
        subscribeTopics: ['example.lowbar'],
        callerPluginId: 'ui.lowbar.caller',
        // 缩小浮窗相对宽度（及高度），示例设为 48%
        floatingSizePercent: 48,
        // 使用绝对尺寸示例：宽 720px，高 420px（优先生效）
        floatingWidth: 720,
        floatingHeight: 420,
        // 初始布局按钮由调用方提供
        centerItems: centerItemsForMode('clock'),
        leftItems: leftItemsForMode('clock'),
        // 页面内容 URL 由调用方提供
        backgroundUrl: bgUrl,
        // 初次打开不显示浮窗，由用户点击后再打开
        floatingUrl: null,
        backgroundTargets: {
          clock: url.pathToFileURL(clockFile).href,
          calendar: url.pathToFileURL(calendarFile).href,
          countdown: url.pathToFileURL(countdownFile).href,
          stopwatch: url.pathToFileURL(stopwatchFile).href
        },
        floatingBounds: 'center'
      };
      // 保存态供事件处理使用
      state.eventChannel = params.eventChannel;
      state.backgroundTargets = params.backgroundTargets;
      state.currentMode = 'clock';
      state.clockOpts = { date: 0, seconds: 0, blink: 0 };
      state.countdownMins = 10; state.countdownUntil = null; state.countdownPaused = false; state.countdownRemain = 0; state.calendarOffset = 0;
      state.floatBase = url.pathToFileURL(floatFile).href;
      state.floatCountdownBase = url.pathToFileURL(floatCdFile).href;
      await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  // 由模板回调的事件处理（点击/模式变化）
  onLowbarEvent: async (payload = {}) => {
    try {
      if (!payload || typeof payload !== 'object') {
        return true;
      }
      if (payload.type === 'click') {
        // 中部常用功能按钮
        if (payload.id === 'clock-date') { state.clockOpts.date = state.clockOpts.date ? 0 : 1; emitUpdate('centerItems', centerItemsForMode('clock')); emitUpdate('backgroundUrl', buildClockUrl()); }
        else if (payload.id === 'clock-seconds') { state.clockOpts.seconds = state.clockOpts.seconds ? 0 : 1; emitUpdate('centerItems', centerItemsForMode('clock')); emitUpdate('backgroundUrl', buildClockUrl()); }
        else if (payload.id === 'clock-blink') { state.clockOpts.blink = state.clockOpts.blink ? 0 : 1; emitUpdate('centerItems', centerItemsForMode('clock')); emitUpdate('backgroundUrl', buildClockUrl()); }
        else if (payload.id === 'countdown-set') {
          // 中间弹出较小的倒计时设置浮窗（居中且小尺寸）
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 380, height: 240 });
          const u = new URL(state.floatCountdownBase);
          u.searchParams.set('mode', 'countdown');
          emitUpdate('floatingUrl', u.href);
        }
        else if (payload.id === 'countdown-reset') { state.countdownPaused = false; state.countdownRemain = 0; state.countdownUntil = Date.now() + (state.countdownMins*60*1000); emitUpdate('backgroundUrl', buildCountdownUrlFromState()); }
        else if (payload.id === 'countdown-pause') { if (state.countdownUntil) { const rem = Math.max(0, Math.ceil((state.countdownUntil - Date.now())/1000)); state.countdownPaused = true; state.countdownRemain = rem; state.countdownUntil = null; emitUpdate('backgroundUrl', buildCountdownUrlFromState()); } }
        else if (payload.id === 'countdown-start') { if (state.countdownPaused && state.countdownRemain>0) { state.countdownUntil = Date.now() + (state.countdownRemain*1000); state.countdownPaused=false; state.countdownRemain=0; } else { state.countdownUntil = Date.now() + (state.countdownMins*60*1000); state.countdownPaused=false; } emitUpdate('backgroundUrl', buildCountdownUrlFromState()); }
        else if (payload.id === 'stopwatch-start') { emitUpdate('backgroundUrl', buildStopwatchUrl('start')); }
        else if (payload.id === 'stopwatch-stop') { emitUpdate('backgroundUrl', buildStopwatchUrl('stop')); }
        else if (payload.id === 'stopwatch-reset') { emitUpdate('backgroundUrl', buildStopwatchUrl('reset')); }
        // 日历导航
        else if (payload.id === 'cal-prev') { state.calendarOffset = (state.calendarOffset || 0) - 1; emitUpdate('backgroundUrl', buildCalendarUrl()); }
        else if (payload.id === 'cal-next') { state.calendarOffset = (state.calendarOffset || 0) + 1; emitUpdate('backgroundUrl', buildCalendarUrl()); }
        else if (payload.id === 'cal-today') { state.calendarOffset = 0; emitUpdate('backgroundUrl', buildCalendarUrl()); }
      } else if (payload.type === 'left.click') {
        // 左侧按钮（仅功能选择），打开左侧位置的悬浮窗口
        if (payload.id === 'openControls') {
          emitUpdate('floatingBounds', 'left');
          emitUpdate('floatingBounds', { width: 720, height: 420 });
          const u = new URL(state.floatBase);
          u.searchParams.set('mode', state.currentMode);
          emitUpdate('floatingUrl', u.href);
        }
      } else if (payload.type === 'float.mode') {
        // 浮层页面模式选择
        const m = payload.mode;
        if (m === 'clock') { state.currentMode = 'clock'; emitUpdate('leftItems', leftItemsForMode('clock')); emitUpdate('centerItems', centerItemsForMode('clock')); emitUpdate('backgroundUrl', buildClockUrl()); emitUpdate('floatingUrl', null); }
        else if (m === 'calendar') { state.currentMode = 'calendar'; emitUpdate('leftItems', leftItemsForMode('calendar')); emitUpdate('centerItems', centerItemsForMode('calendar')); emitUpdate('backgroundUrl', buildCalendarUrl()); emitUpdate('floatingUrl', null); }
        else if (m === 'countdown') { state.currentMode = 'countdown'; if (payload.mins && Number.isFinite(payload.mins)) { state.countdownMins = Math.max(1, Math.floor(payload.mins)); } state.countdownPaused=false; state.countdownRemain=0; state.countdownUntil = Date.now() + (state.countdownMins*60*1000); emitUpdate('leftItems', leftItemsForMode('countdown')); emitUpdate('centerItems', centerItemsForMode('countdown')); emitUpdate('backgroundUrl', buildCountdownUrlFromState()); emitUpdate('floatingUrl', null); }
        else if (m === 'stopwatch') { state.currentMode = 'stopwatch'; emitUpdate('leftItems', leftItemsForMode('stopwatch')); emitUpdate('centerItems', centerItemsForMode('stopwatch')); emitUpdate('backgroundUrl', buildStopwatchUrl()); emitUpdate('floatingUrl', null); }
      }
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
};

const init = async (api) => {
  pluginApi = api;
  api.splash.setStatus('plugin:init', '初始化 低栏模板调用示例');
  api.splash.setStatus('plugin:init', '可通过动作打开 UI模板-低栏应用');
  api.splash.setStatus('plugin:init', '低栏模板调用示例加载完成');
};

module.exports = {
  name: '低栏模板调用示例',
  version: '0.1.0',
  init,
  functions: {
    ...functions,
    getVariable: async (name) => { const k=String(name||''); if (k==='timeISO') return new Date().toISOString(); if (k==='currentMode') return String(state.currentMode || 'clock'); return ''; },
    listVariables: () => ['timeISO','currentMode']
  }
};