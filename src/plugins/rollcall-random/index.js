const path = require('path');
const url = require('url');
  

let pluginApi = null;
const state = {
  eventChannel: 'rollcall.random',
  students: [],
  picked: new Set(),
  currentName: '',
  noRepeat: true,
  recent: [],
  recentLimit: 20,
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
  const unique = Array.from(new Set(names));
  const exclude = state.noRepeat ? new Set(state.recent) : new Set();
  let pool = state.noRepeat ? unique.filter((n) => !exclude.has(n)) : unique;
  if (!pool.length) pool = unique;
  const idx = Math.floor(Math.random() * pool.length);
  const name = pool[idx] || '';
  if (name) {
    state.currentName = name;
    if (state.noRepeat) {
      state.recent.push(name);
      if (state.recent.length > state.recentLimit) state.recent.shift();
    }
  }
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
          const unique = Array.from(new Set(names));
          const finalName = pickOne();
          const seq = [];
          const exclude = state.noRepeat ? new Set(state.recent) : new Set();
          const pool = state.noRepeat ? unique.filter((n) => !exclude.has(n)) : unique;
          const basePool = pool.length ? pool : unique;
          const steps = basePool.length ? Math.min(5, basePool.length) : 0;
          for (let i = 0; i < steps; i++) { const j = Math.floor(Math.random() * basePool.length); seq.push(basePool[j] || finalName || ''); }
          let seat = null;
          try { seat = await functions._getSeatingContext(finalName); } catch { seat = null; }
          try { pluginApi.emit(state.eventChannel, { type: 'animate.pick', names: seq, final: finalName, stepMs: 40, seat }); } catch {}
        }
      } else if (payload.type === 'left.click') {
        if (payload.id === 'openSettings') {
          emitUpdate('floatingBounds', 'left');
          emitUpdate('floatingBounds', { width: 520, height: 360 });
          const u = new URL(state.floatSettingsBase);
          u.searchParams.set('channel', state.eventChannel);
          u.searchParams.set('caller', 'rollcall.random');
          u.searchParams.set('noRepeat', state.noRepeat ? '1' : '0');
          u.searchParams.set('recentLimit', String(state.recentLimit || 20));
          emitUpdate('floatingUrl', u.href);
        }
      } else if (payload.type === 'float.settings') {
        const v = String(payload.noRepeat || '').trim();
        if (v === '1' || v === '0') state.noRepeat = (v === '1');
        const rl = Number(payload.recentLimit);
        if (Number.isFinite(rl)) {
          const k = Math.max(1, Math.min(100, Math.floor(rl)));
          state.recentLimit = k;
          if (state.recent.length > state.recentLimit) state.recent = state.recent.slice(-state.recentLimit);
        }
        if (payload.resetPicked) { state.recent = []; state.picked.clear(); state.currentName = ''; }
      }
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  _getSeatingContext: async (finalName) => {
    try {
      let res = await pluginApi.call('profiles.seating', 'getConfig');
      res = res?.result || res;
      const cfg = res?.config || {};
      const rows = Array.isArray(cfg.rows) ? cfg.rows : [];
      const cols = Array.isArray(cfg.cols) ? cfg.cols : [];
      const seats = (cfg && typeof cfg.seats === 'object') ? cfg.seats : {};
      const name = String(finalName || '').trim();
      if (!name) return { found: false };
      let foundKey = '';
      for (const k of Object.keys(seats || {})) { const v = seats[k]; if (v && String(v.name||'').trim() === name) { foundKey = k; break; } }
      if (!foundKey) return { found: false };
      const parts = foundKey.split('-');
      if (parts.length !== 2) return { found: false };
      const rowId = parts[0]; const colId = parts[1];
      const ri = rows.findIndex(r => String(r?.id||'') === rowId);
      const ci = cols.findIndex(c => String(c?.id||'') === colId);
      if (ri < 0 || ci < 0) return { found: false };
      const isAisleRow = (i) => (rows[i]?.type || 'row') === 'aisle';
      const isAisleCol = (i) => (cols[i]?.type || 'col') === 'aisle';
      const seatKey = (rIdx, cIdx) => { const r = rows[rIdx]?.id; const c = cols[cIdx]?.id; return (r && c) ? `${r}-${c}` : ''; };
      const occupantAt = (rIdx, cIdx) => { const key = seatKey(rIdx, cIdx); const o = key ? seats[key] : null; return o && typeof o === 'object' ? String(o.name || '') : ''; };
      let rowNumber = 0; for (let i = 0; i <= ri; i++) { if (!isAisleRow(i)) rowNumber++; }
      let colNumber = 0; for (let j = 0; j <= ci; j++) { if (!isAisleCol(j)) colNumber++; }
      const collectLeft = () => { const arr = []; let c = ci - 1; while (c >= 0 && arr.length < 2) { if (!isAisleCol(c)) { const nm = occupantAt(ri, c); if (nm) arr.push(nm); } c--; } return arr; };
      const collectRight = () => { const arr = []; let c = ci + 1; while (c < cols.length && arr.length < 2) { if (!isAisleCol(c)) { const nm = occupantAt(ri, c); if (nm) arr.push(nm); } c++; } return arr; };
      const collectFront = () => { const arr = []; let r = ri - 1; while (r >= 0 && arr.length < 2) { if (!isAisleRow(r)) { const nm = occupantAt(r, ci); if (nm) arr.push(nm); } r--; } return arr; };
      const collectBack = () => { const arr = []; let r = ri + 1; while (r < rows.length && arr.length < 2) { if (!isAisleRow(r)) { const nm = occupantAt(r, ci); if (nm) arr.push(nm); } r++; } return arr; };
      return { found: true, pos: { row: rowNumber, col: colNumber }, neighbors: { left: collectLeft(), right: collectRight(), front: collectFront(), back: collectBack() } };
    } catch { return { found: false }; }
  }
  
};

// 供预加载 quickAPI 调用的窗口控制函数

const init = async (api) => { pluginApi = api; };

module.exports = { name: '随机点名', version: '0.1.0', init, functions: { ...functions, getVariable: async (name) => { const k=String(name||''); if (k==='currentName') return String(state.currentName||''); return ''; }, listVariables: () => ['currentName'] } };
