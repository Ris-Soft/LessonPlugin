const path = require('path');
const { app } = require('electron');
const url = require('url');
const store = require(path.join(app.getAppPath(), 'src', 'main', 'store.js'));

let pluginApi = null;

function fileUrl(p) { return url.pathToFileURL(p).href; }

function emitUpdate(channel, target, value) { try { pluginApi.emit(channel, { type: 'update', target, value }); } catch {} }

const EVENT_CHANNEL = 'duty.easy.channel';
let state = { mode: 'preview', paths: {} };

function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function dow(date) { const d = new Date(date); return d.getDay(); }

function ensureDefaults() {
  const defaults = {
    roles: ['清洁', '黑板', '值日生'],
    groups: [
      { name: '一组', roles: { '清洁': [], '黑板': [], '值日生': [] } },
      { name: '二组', roles: { '清洁': [], '黑板': [], '值日生': [] } }
    ],
    rule: {
      mode: 'list',
      currentGroupIndex: 0,
      weekdayMap: { 0: 0, 1: 0, 2: 1, 3: 1, 4: 2, 5: 2, 6: 0 },
      mainMode: 'group',
      singleRoleIndices: {}
    },
    singleRoles: ['清洁', '黑板', '值日生'],
    singleRoleLists: {},
    singleRoleConditions: {},
    lastStartupDate: ''
  };
  try { store.ensureDefaults('duty-easy', defaults); } catch {}
}

function advanceOnStartup() {
  ensureDefaults();
  const cfg = store.getAll('duty-easy');
  const today = todayISO();
  const last = cfg.lastStartupDate || '';
  if (last !== today) {
    const groups = Array.isArray(cfg.groups) ? cfg.groups : [];
    const rule = cfg.rule || {};
    let nextRule = { ...rule };
    let gi = Number.isFinite(rule.currentGroupIndex) ? rule.currentGroupIndex : 0;
    if ((rule.mode || 'list') === 'list') {
      gi = groups.length ? (gi + 1) % groups.length : 0;
    } else {
      const map = rule.weekdayMap || {};
      const idx = map[dow(today)];
      gi = Number.isFinite(idx) ? idx : 0;
    }
    const roles = Array.isArray(cfg.singleRoles) ? cfg.singleRoles : (Array.isArray(cfg.roles) ? cfg.roles : []);
    const indices = typeof rule.singleRoleIndices === 'object' && rule.singleRoleIndices ? { ...rule.singleRoleIndices } : {};
    roles.forEach(r => {
      const arr = Array.isArray(cfg.singleRoleLists?.[r]) ? cfg.singleRoleLists[r] : [];
      const cur = Number.isFinite(indices[r]) ? indices[r] : 0;
      indices[r] = arr.length ? (cur + 1) % arr.length : 0;
    });
    nextRule = { ...nextRule, currentGroupIndex: gi, singleRoleIndices: indices };
    store.set('duty.easy', 'rule', nextRule);
    store.set('duty.easy', 'lastStartupDate', today);
  }
}

function predict(nextDays) {
  ensureDefaults();
  const cfg = store.getAll('duty-easy');
  const groups = Array.isArray(cfg.groups) ? cfg.groups : [];
  const rolesAll = Array.isArray(cfg.roles) ? cfg.roles : [];
  const singleRoles = Array.isArray(cfg.singleRoles) ? cfg.singleRoles : rolesAll;
  const rule = cfg.rule || {};
  const baseDate = new Date(todayISO());
  const out = [];
  function weekNumberISO(dateStr){ const d=new Date(dateStr); const dd=new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const day=(dd.getUTCDay()+6)%7; dd.setUTCDate(dd.getUTCDate()-day+3); const firstThursday=new Date(Date.UTC(dd.getUTCFullYear(),0,4)); const diff=dd-firstThursday; return 1+Math.round(diff/604800000); }
  function matchCond(dateStr, cond){ if(!cond||typeof cond!=='object') return true; const wk=weekNumberISO(dateStr); const isOdd=(wk%2)===1; if(cond.mode==='odd' && !isOdd) return false; if(cond.mode==='even' && isOdd) return false; const d=new Date(dateStr).getDay(); const d17=d===0?7:d; const arr=Array.isArray(cond.weekdays)?cond.weekdays:[]; if(arr.length){ return arr.includes(d17); } return true; }
  for (let i = 0; i < nextDays; i++) {
    const d = new Date(baseDate.getTime() + i * 24 * 60 * 60 * 1000);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const dateISO = `${yyyy}-${mm}-${dd}`;
    let gi = Number.isFinite(rule.currentGroupIndex) ? rule.currentGroupIndex : 0;
    if ((rule.mode || 'list') === 'list') {
      gi = groups.length ? (gi + i) % groups.length : 0;
    } else {
      const map = rule.weekdayMap || {};
      const idx = map[d.getDay()];
      gi = Number.isFinite(idx) ? idx : 0;
    }
    const group = groups[gi] || { name: '', roles: {} };
    const groupMembers = {};
    rolesAll.forEach((r) => { groupMembers[r] = Array.isArray(group.roles?.[r]) ? group.roles[r] : []; });
    const lists = typeof cfg.singleRoleLists === 'object' && cfg.singleRoleLists ? cfg.singleRoleLists : {};
    const indices = typeof rule.singleRoleIndices === 'object' && rule.singleRoleIndices ? rule.singleRoleIndices : {};
    const conds = typeof cfg.singleRoleConditions === 'object' && cfg.singleRoleConditions ? cfg.singleRoleConditions : {};
    const singleMembers = {};
    singleRoles.forEach((r) => {
      const arr = Array.isArray(lists[r]) ? lists[r] : [];
      const base = Number.isFinite(indices[r]) ? indices[r] : 0;
      const cond = conds[r] || null;
      const canShow = matchCond(dateISO, cond);
      const pick = arr.length && canShow ? arr[(base + i) % arr.length] : undefined;
      singleMembers[r] = pick ? [pick] : [];
    });
    out.push({ dateISO, groupIndex: gi, groupName: group.name || '', rolesGroup: rolesAll, groupMembers, rolesSingle: singleRoles, singleMembers });
  }
  return out;
}

const functions = {
  openDuty: async () => {
    state.paths.preview = fileUrl(path.join(__dirname, 'pages', 'preview.html')) + `?channel=${encodeURIComponent(EVENT_CHANNEL)}&caller=${encodeURIComponent('duty.easy')}`;
    state.paths.roles = fileUrl(path.join(__dirname, 'pages', 'roles-list.html')) + `?channel=${encodeURIComponent(EVENT_CHANNEL)}&caller=${encodeURIComponent('duty.easy')}`;
    state.paths.groups = fileUrl(path.join(__dirname, 'pages', 'groups-list.html')) + `?channel=${encodeURIComponent(EVENT_CHANNEL)}&caller=${encodeURIComponent('duty.easy')}`;
    state.paths.rules = fileUrl(path.join(__dirname, 'pages', 'rules.html')) + `?channel=${encodeURIComponent(EVENT_CHANNEL)}&caller=${encodeURIComponent('duty.easy')}`;
    state.paths.grid = fileUrl(path.join(__dirname, 'pages', 'grid.html')) + `?channel=${encodeURIComponent(EVENT_CHANNEL)}&caller=${encodeURIComponent('duty.easy')}`;
    state.paths.rotation = fileUrl(path.join(__dirname, 'pages', 'rotation.html')) + `?channel=${encodeURIComponent(EVENT_CHANNEL)}&caller=${encodeURIComponent('duty.easy')}`;
    const bg = state.paths.preview;
    const params = {
      title: '轻松值日',
      eventChannel: EVENT_CHANNEL,
      subscribeTopics: [EVENT_CHANNEL],
      callerPluginId: 'duty.easy',
      backgroundUrl: bg,
      floatingUrl: null,
      leftItems: [
        { id: 'save', text: '保存设置', icon: 'ri-save-3-line' }
      ],
      centerItems: [
        { id: 'view-preview', text: '预览', icon: 'ri-calendar-check-line', active: true },
        { id: 'view-grid', text: '组别分工', icon: 'ri-team-line', active: false },
        { id: 'view-rotation', text: '轮值', icon: 'ri-user-star-line', active: false }
      ]
    };
    await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
    return true;
  },
  showDutyOverlay: async () => {
    ensureDefaults();
    const list = predict(1);
    const today = Array.isArray(list) && list.length ? list[0] : null;
    if (!today) return false;
    const members = [];
    const rs = Array.isArray(today.rolesSingle) ? today.rolesSingle : [];
    const membersSingle = [];
    rs.forEach((r) => {
      const arr = Array.isArray(today.singleMembers && today.singleMembers[r]) ? today.singleMembers[r] : [];
      if (arr.length) { membersSingle.push({ role: r, names: arr }); members.push({ role: r, names: arr }); }
    });
    const rg = Array.isArray(today.rolesGroup) ? today.rolesGroup : [];
    const membersGroup = [];
    rg.forEach((r) => {
      const arr = Array.isArray(today.groupMembers && today.groupMembers[r]) ? today.groupMembers[r] : [];
      if (arr.length) { membersGroup.push({ role: r, names: arr }); members.push({ role: r, names: arr }); }
    });
    const props = { title: '今日值日生提醒', date: today.dateISO, group: today.groupName, members: JSON.stringify(members), columns: JSON.stringify(rg), membersGroup: JSON.stringify(membersGroup), membersSingle: JSON.stringify(membersSingle) };
    await pluginApi.call('notify.plugin', 'overlayComponent', ['notify.overlay', 'component.duty.reminder', props, 120000, true, 3000]);
    return true;
  },
  onLowbarEvent: async (payload = {}) => {
    try {
      if (payload?.type === 'left.click') {
        if (payload.id === 'save') emitUpdate(EVENT_CHANNEL, 'duty.save', true);
      } else if (payload?.type === 'click') {
        if (payload.id === 'view-preview') { state.mode = 'preview'; emitUpdate(EVENT_CHANNEL, 'centerItems', [
          { id: 'view-preview', text: '预览', icon: 'ri-calendar-check-line', active: true },
          { id: 'view-grid', text: '组别分工', icon: 'ri-team-line', active: false },
          { id: 'view-rotation', text: '轮值', icon: 'ri-user-star-line', active: false }
        ]); emitUpdate(EVENT_CHANNEL, 'backgroundUrl', state.paths.preview); }
        if (payload.id === 'view-rules') { state.mode = 'rules'; emitUpdate(EVENT_CHANNEL, 'centerItems', [
          { id: 'view-preview', text: '预览', icon: 'ri-calendar-check-line', active: false },
          { id: 'view-rules', text: '分工规则', icon: 'ri-settings-3-line', active: true },
          { id: 'view-grid', text: '组别分工', icon: 'ri-team-line', active: false }
        ]); emitUpdate(EVENT_CHANNEL, 'backgroundUrl', state.paths.rules); }
        if (payload.id === 'view-grid') { state.mode = 'grid'; emitUpdate(EVENT_CHANNEL, 'centerItems', [
          { id: 'view-preview', text: '预览', icon: 'ri-calendar-check-line', active: false },
          { id: 'view-grid', text: '组别分工', icon: 'ri-team-line', active: true },
          { id: 'view-rotation', text: '轮值', icon: 'ri-user-star-line', active: false }
        ]); emitUpdate(EVENT_CHANNEL, 'backgroundUrl', state.paths.grid); }
        if (payload.id === 'view-rotation') { state.mode = 'rotation'; emitUpdate(EVENT_CHANNEL, 'centerItems', [
          { id: 'view-preview', text: '预览', icon: 'ri-calendar-check-line', active: false },
          { id: 'view-grid', text: '组别分工', icon: 'ri-team-line', active: false },
          { id: 'view-rotation', text: '轮值', icon: 'ri-user-star-line', active: true }
        ]); emitUpdate(EVENT_CHANNEL, 'backgroundUrl', state.paths.rotation); }
      }
      return true;
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getConfig: async () => {
    try { ensureDefaults(); return { ok: true, config: store.getAll('duty-easy') }; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  saveConfig: async (payload = {}) => {
    try {
      ensureDefaults();
      if (Array.isArray(payload.roles)) store.set('duty-easy', 'roles', payload.roles);
      if (Array.isArray(payload.groups)) store.set('duty-easy', 'groups', payload.groups);
      if (payload.rule && typeof payload.rule === 'object') store.set('duty-easy', 'rule', payload.rule);
      if (payload.singleRoleLists && typeof payload.singleRoleLists === 'object') store.set('duty-easy', 'singleRoleLists', payload.singleRoleLists);
      if (Array.isArray(payload.singleRoles)) store.set('duty-easy', 'singleRoles', payload.singleRoles);
      if (payload.singleRoleConditions && typeof payload.singleRoleConditions === 'object') store.set('duty-easy', 'singleRoleConditions', payload.singleRoleConditions);
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getPreview: async () => {
    try { return { ok: true, list: predict(3) }; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }
};

const init = async (api) => {
  pluginApi = api;
  api.splash.setStatus('plugin:init', '初始化 轻松值日');
  ensureDefaults();
  advanceOnStartup();
  api.splash.progress('plugin:init', '轻松值日就绪');
};

module.exports = {
  name: 'duty.easy',
  version: '1.0.0',
  description: '轻松值日（底栏模板）',
  init,
  functions: {
    ...functions,
    getVariable: async (name) => { const k=String(name||''); if (k==='timeISO') return new Date().toISOString(); if (k==='pluginName') return '轻松值日'; return ''; },
    listVariables: () => ['timeISO','pluginName']
  }
}
