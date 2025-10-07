const { BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const { v4: uuidv4 } = require('uuid');

function nowDate() { return new Date(); }

class AutomationManager {
  constructor({ app, store, pluginManager }) {
    this.app = app;
    this.store = store;
    this.pluginManager = pluginManager;
    // 初始化时从存储中读取列表（若不存在则为空数组）
    const initial = this.store.get('automation', 'list');
    this.items = Array.isArray(initial) ? initial : [];
    this.timer = null;
  }

  init() {
    // 确保默认值
    this.store.ensureDefaults('automation', { list: [] });
    const latest = this.store.get('automation', 'list');
    this.items = Array.isArray(latest) ? latest : [];
    // 定时检查“到达某时间”触发器（每30秒）
    this.timer = setInterval(() => this.checkTimeTriggers(), 30 * 1000);
  }

  dispose() { try { if (this.timer) clearInterval(this.timer); } catch {} }

  list() { return this.items; }
  get(id) { return this.items.find((x) => x.id === id) || null; }
  create(payload) {
    const item = { id: uuidv4(), name: payload?.name || '未命名自动化', enabled: true, triggers: [], conditions: { mode: 'and', groups: [] }, actions: [], confirm: { enabled: true, timeout: 60 }, ...payload };
    this.items.push(item);
    this.store.set('automation', 'list', this.items);
    return item;
  }
  update(id, patch) {
    const idx = this.items.findIndex((x) => x.id === id);
    if (idx < 0) return { ok: false, error: 'not_found' };
    this.items[idx] = { ...this.items[idx], ...patch };
    this.store.set('automation', 'list', this.items);
    return { ok: true, item: this.items[idx] };
  }
  remove(id) {
    this.items = this.items.filter((x) => x.id !== id);
    this.store.set('automation', 'list', this.items);
    return { ok: true };
  }
  toggle(id, enabled) {
    const item = this.get(id); if (!item) return { ok: false, error: 'not_found' };
    item.enabled = !!enabled; this.store.set('automation', 'list', this.items); return { ok: true, item };
  }

  checkTimeTriggers() {
    const d = nowDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const cur = `${hh}:${mm}`;
    for (const item of this.items) {
      if (!item.enabled) continue;
      const hit = (item.triggers || []).some((t) => t?.type === 'time' && t?.at === cur);
      if (hit) this.tryExecute(item, { reason: 'time', now: d });
    }
  }

  async invokeProtocol(text) {
    for (const item of this.items) {
      if (!item.enabled) continue;
      const hit = (item.triggers || []).some((t) => t?.type === 'protocol' && String(t?.text || '').trim() === String(text || '').trim());
      if (hit) await this.tryExecute(item, { reason: 'protocol', text });
    }
    return { ok: true };
  }

  evaluateConditions(item) {
    const groups = Array.isArray(item?.conditions?.groups) ? item.conditions.groups : [];
    const topMode = item?.conditions?.mode === 'or' ? 'or' : 'and';
    const d = nowDate();
    const weekday = d.getDay() === 0 ? 7 : d.getDay(); // 1..7（周一..周日）
    const month = d.getMonth() + 1; // 1..12
    const dom = d.getDate(); // 1..31
    // 读取单双周基准（来自 system.offsetBaseDate 或 system.semesterStart）
    const base = this.store.get('system', 'semesterStart') || this.store.get('system', 'offsetBaseDate');
    let isEvenWeek = null;
    if (base) {
      try {
        const baseDate = new Date(base + 'T00:00:00');
        const diffDays = Math.floor((d - baseDate) / (24 * 3600 * 1000));
        const weekIndex = Math.floor(diffDays / 7);
        isEvenWeek = weekIndex % 2 === 0;
      } catch {}
    }

    const evalItem = (c) => {
      const negate = !!c.negate;
      let ok = true;
      switch (c.type) {
        case 'timeEquals': {
          const hh = String(d.getHours()).padStart(2, '0');
          const mm = String(d.getMinutes()).padStart(2, '0');
          ok = `${hh}:${mm}` === String(c.value || '');
          break;
        }
        case 'weekdayIn': ok = Array.isArray(c.value) ? c.value.includes(weekday) : false; break;
        case 'monthIn': ok = Array.isArray(c.value) ? c.value.includes(month) : false; break;
        case 'dayIn': ok = Array.isArray(c.value) ? c.value.includes(dom) : false; break;
        case 'biweek': {
          if (isEvenWeek == null) ok = false; else ok = (c.value === 'even') ? isEvenWeek : !isEvenWeek;
          break;
        }
        case 'selectedWindowName': ok = false; break; // 预留：可通过 pluginManager 或主进程维护当前窗口状态
        case 'selectedProcess': ok = false; break; // 预留
        default: ok = true;
      }
      return negate ? !ok : ok;
    };

    const evalGroup = (g) => {
      const mode = g?.mode === 'or' ? 'or' : 'and';
      const items = Array.isArray(g?.items) ? g.items : [];
      if (!items.length) return true;
      if (mode === 'and') return items.every(evalItem);
      return items.some(evalItem);
    };

    if (!groups.length) return true;
    if (topMode === 'and') return groups.every(evalGroup);
    return groups.some(evalGroup);
  }

  async tryExecute(item, ctx) {
    if (!this.evaluateConditions(item)) return;
    if (item?.confirm?.enabled) {
      await this.showConfirmOverlay(item, ctx);
    } else {
      await this.executeActions(item.actions || [], ctx);
    }
  }

  showConfirmOverlay(item, ctx) {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 800, height: 560, fullscreen: true, frame: false, transparent: true, alwaysOnTop: true,
        webPreferences: { preload: path.join(__dirname, '..', 'preload', 'settings.js') } // 复用API能力
      });
      win.loadFile(path.join(__dirname, '..', 'renderer', 'automation-confirm.html'));
      const timeout = Math.max(5, parseInt(item?.confirm?.timeout || 60, 10));
      let done = false;
      const finish = async (ok) => {
        if (done) return; done = true; try { if (!win.isDestroyed()) win.destroy(); } catch {}
        if (ok) await this.executeActions(item.actions || [], ctx);
        resolve(ok);
      };
      // 监听渲染确认
      try {
        const { ipcMain } = require('electron');
        const onConfirm = (_e, id, approved) => {
          if (id !== item.id) return;
          try { ipcMain.removeListener('automation:confirm:result', onConfirm); } catch {}
          finish(approved);
        };
        ipcMain.on('automation:confirm:result', onConfirm);
      } catch {}
      // 超时自动执行
      setTimeout(() => finish(true), timeout * 1000);
    });
  }

  async executeActions(actions, ctx) {
    for (const act of actions) {
      try {
        if (act.type === 'pluginEvent') {
          await this.pluginManager.callFunction(act.pluginId, act.event, act.params || []);
        } else if (act.type === 'power') {
          if (act.op === 'shutdown') spawn('shutdown', ['/s', '/t', '0'], { shell: true });
          else if (act.op === 'restart') spawn('shutdown', ['/r', '/t', '0'], { shell: true });
          else if (act.op === 'logoff') spawn('shutdown', ['/l'], { shell: true });
        } else if (act.type === 'openApp') {
          if (act.path) shell.openPath(act.path);
        } else if (act.type === 'cmd') {
          if (act.command) spawn(act.command, { shell: true });
        }
      } catch {}
    }
  }
}

module.exports = AutomationManager;