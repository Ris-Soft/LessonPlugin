const path = require('path');
const { app } = require('electron');
const url = require('url');
const store = require(path.join(app.getAppPath(), 'src', 'main', 'store.js'));

let pluginApi = null;

function fileUrl(p) { return url.pathToFileURL(p).href; }
function emitUpdate(channel, target, value) { try { pluginApi.emit(channel, { type: 'update', target, value }); } catch {} }

const EVENT_CHANNEL = 'profiles.seating.channel';
let state = { mode: 'position', paths: {} };

function ensureDefaults() {
  const defaults = {
    rows: [
      { id: 'r1', label: '第1排', type: 'row' },
      { id: 'r2', label: '第2排', type: 'row' },
      { id: 'r3', label: '第3排', type: 'row' },
      { id: 'r4', label: '第4排', type: 'row' }
    ],
    cols: [
      { id: 'c1', label: '第1列', type: 'col' },
      { id: 'c2', label: '第2列', type: 'col' },
      { id: 'c3', label: '第3列', type: 'col' },
      { id: 'c4', label: '第4列', type: 'col' },
      { id: 'c5', label: '第5列', type: 'col' },
      { id: 'c6', label: '第6列', type: 'col' }
    ],
    seats: {},
    backgroundStatus: '默认'
  };
  try { store.ensureDefaults('profiles-seating', defaults); } catch {}
}

const functions = {
  openSeating: async () => {
    state.paths.seating = fileUrl(path.join(__dirname, 'pages', 'seating.html')) + `?channel=${encodeURIComponent(EVENT_CHANNEL)}&caller=${encodeURIComponent('profiles.seating')}`;
    const params = {
      title: '档案-座次表',
      eventChannel: EVENT_CHANNEL,
      subscribeTopics: [EVENT_CHANNEL],
      callerPluginId: 'profiles.seating',
      backgroundUrl: state.paths.seating,
      floatingUrl: null,
      windowMode: 'fullscreen_only',
      leftItems: [
        { id: 'toggle-free-list', text: '无座学生', icon: 'ri-user-unfollow-line' },
        { id: 'save', text: '保存', icon: 'ri-save-3-line' }
      ]
    };
    await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
    return true;
  },
  onLowbarEvent: async (payload = {}) => {
    try {
      if (payload?.type === 'left.click') {
        if (payload.id === 'save') emitUpdate(EVENT_CHANNEL, 'seating.save', true);
        if (payload.id === 'toggle-free-list') emitUpdate(EVENT_CHANNEL, 'freeList.toggle', true);
      }
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getConfig: async () => {
    try { return { ok: true, config: store.getAll('profiles-seating') }; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  saveConfig: async (payload = {}) => {
    try {
      if (Array.isArray(payload.rows)) store.set('profiles-seating', 'rows', payload.rows);
      if (Array.isArray(payload.cols)) store.set('profiles-seating', 'cols', payload.cols);
      if (payload.seats && typeof payload.seats === 'object') store.set('profiles-seating', 'seats', payload.seats);
      if (typeof payload.backgroundStatus === 'string') store.set('profiles-seating', 'backgroundStatus', payload.backgroundStatus);
      emitUpdate(EVENT_CHANNEL, 'refresh', true);
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }
};

const init = async (api) => {
  pluginApi = api;
  api.splash.setStatus('plugin:init', '初始化 档案-座次表');
  ensureDefaults();
  api.splash.progress('plugin:init', '档案-座次表就绪');
};

module.exports = {
  name: 'profiles.seating',
  version: '0.1.0',
  description: '档案-座次表（底栏模板，全屏）',
  init,
  functions: {
    ...functions,
    getVariable: async (name) => { const k=String(name||''); if (k==='timeISO') return new Date().toISOString(); if (k==='pluginName') return '档案-座次表'; return ''; },
    listVariables: () => ['timeISO','pluginName']
  }
}
