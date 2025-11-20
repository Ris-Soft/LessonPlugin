const path = require('path');
const url = require('url');
  

let pluginApi = null;
const state = {
  eventChannel: 'rollcall.random',
  students: [],
  picked: new Set(),
  currentName: '',
  noRepeat: true,
  backgroundBase: '',
  floatSettingsBase: ''
};

function emitUpdate(target, value) {
  try { pluginApi.emit(state.eventChannel, { type: 'update', target, value }); } catch {}
}

async function ensureStudents() {
  try {
    let res = await pluginApi.call('profiles.students', 'getStudents');
    res = res?.result || res;
    const list = Array.isArray(res?.students) ? res.students : [];
    state.students = list.filter((s) => String((s && s.name) || '').trim() !== '');
  } catch { state.students = []; }
}

function pickOne() {
  const names = state.students.map((s) => String(s.name || '').trim()).filter((n) => !!n);
  let pool = names;
  if (state.noRepeat && state.picked.size < names.length) pool = names.filter((n) => !state.picked.has(n));
  if (!pool.length && names.length) { state.picked.clear(); pool = names.slice(); }
  if (!pool.length) return '';
  const idx = Math.floor(Math.random() * pool.length);
  const name = pool[idx] || '';
  if (name) { state.currentName = name; if (state.noRepeat) state.picked.add(name); }
  return name;
}


const functions = {
  openRollcallTemplate: async () => {
    try {
      await ensureStudents();
      const bgFile = path.join(__dirname, 'background', 'rollcall.html');
      const floatFile = path.join(__dirname, 'float', 'settings.html');
      state.backgroundBase = url.pathToFileURL(bgFile).href;
      state.floatSettingsBase = url.pathToFileURL(floatFile).href;
      const initBg = state.backgroundBase + '?channel=' + encodeURIComponent(state.eventChannel) + '&caller=rollcall.random&name=';
      const params = {
        title: '随机点名',
        eventChannel: state.eventChannel,
        subscribeTopics: [state.eventChannel],
        callerPluginId: 'rollcall.random',
        floatingSizePercent: 48,
        floatingWidth: 520,
        floatingHeight: 360,
        centerItems: [ { id: 'start-roll', text: '开始抽选', icon: 'ri-shuffle-line' } ],
        leftItems: [ { id: 'openSettings', text: '抽选设置', icon: 'ri-settings-3-line' } ],
        backgroundUrl: initBg,
        floatingUrl: null,
        backgroundTargets: { rollcall: state.backgroundBase },
        floatingBounds: 'left'
      };
      await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  onLowbarEvent: async (payload = {}) => {
    try {
      if (!payload || typeof payload !== 'object') return true;
      if (payload.type === 'click') {
        if (payload.id === 'start-roll') {
          await ensureStudents();
          const names = state.students.map((s) => String(s.name || '').trim()).filter((n) => !!n);
          const finalName = pickOne();
          const seq = [];
          const steps = names.length ? 5 : 0;
          for (let i = 0; i < steps; i++) { const j = Math.floor(Math.random() * names.length); seq.push(names[j] || finalName || ''); }
          try { pluginApi.emit(state.eventChannel, { type: 'animate.pick', names: seq, final: finalName, stepMs: 40 }); } catch {}
        }
      } else if (payload.type === 'left.click') {
        if (payload.id === 'openSettings') {
          emitUpdate('floatingBounds', 'left');
          emitUpdate('floatingBounds', { width: 520, height: 360 });
          const u = new URL(state.floatSettingsBase);
          u.searchParams.set('channel', state.eventChannel);
          u.searchParams.set('caller', 'rollcall.random');
          u.searchParams.set('noRepeat', state.noRepeat ? '1' : '0');
          emitUpdate('floatingUrl', u.href);
        }
      } else if (payload.type === 'float.settings') {
        const v = String(payload.noRepeat || '').trim();
        if (v === '1' || v === '0') state.noRepeat = (v === '1');
        if (payload.resetPicked) state.picked.clear();
      }
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  
};

// 供预加载 quickAPI 调用的窗口控制函数

const init = async (api) => { pluginApi = api; };

module.exports = { name: '随机点名', version: '0.1.0', init, functions: { ...functions, getVariable: async (name) => { const k=String(name||''); if (k==='currentName') return String(state.currentName||''); return ''; }, listVariables: () => ['currentName'] } };