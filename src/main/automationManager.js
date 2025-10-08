const { BrowserWindow, shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');
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

  async test(id) {
    const item = this.get(id);
    if (!item) throw new Error('not_found');
    // 测试执行：忽略触发条件，仅按当前配置的执行条件与确认流程运行
    const canRun = this.evaluateConditions(item);
    if (!canRun) return { ok: true, executed: false, reason: 'conditions_not_met' };
    if (item?.confirm?.enabled) {
      const approved = await this.showConfirmOverlay(item, { reason: 'manual_test' });
      // 注意：showConfirmOverlay 内部已在批准时执行动作，这里不重复执行
      return { ok: true, executed: !!approved, reason: approved ? null : 'cancelled' };
    }
    await this.executeActions(item.actions || [], { reason: 'manual_test' });
    return { ok: true, executed: true };
  }

  checkTimeTriggers() {
    const d = nowDate();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const cur = `${hh}:${mm}`;
    for (const item of this.items) {
      if (!item.enabled) continue;
      const hit = (item.triggers || []).some((t) => t?.type === 'time' && t?.at === cur);
      // 避免同一分钟内重复触发（定时器每30秒检查一次，会命中两次）
      if (hit) {
        if (item._lastTimeMinute === cur) continue;
        item._lastTimeMinute = cur;
        this.tryExecute(item, { reason: 'time', now: d });
      }
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
        case 'alwaysTrue': {
          ok = true;
          break;
        }
        case 'alwaysFalse': {
          ok = false;
          break;
        }
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
      // 将自动化条目基本信息传递给渲染页
      try {
        win.webContents.once('did-finish-load', () => {
          try { win.webContents.send('automation:confirm:init', { id: item.id, name: item.name, timeout }); } catch {}
        });
      } catch {}
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
        console.log(act);
        if (act.type === 'pluginEvent') {
          await this.pluginManager.callFunction(act.pluginId, act.event, act.params || []);
          // console.log(act);
          // console.log(`Plugin ${act.pluginId} event ${act.event} called with params ${JSON.stringify(act.params || [])}`);
        } else if (act.type === 'power') {
          const platform = process.platform;
          if (platform === 'win32') {
            // Windows: 显式定位 shutdown.exe，兼容 32/64 位
            const sysRoot = process.env.SystemRoot || 'C\\Windows';
            const p1 = path.join(sysRoot, 'System32', 'shutdown.exe');
            const p2 = path.join(sysRoot, 'Sysnative', 'shutdown.exe');
            const exe = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : 'shutdown');
            const args = (act.op === 'restart') ? ['/r', '/t', '0'] : (act.op === 'logoff') ? ['/l'] : ['/s', '/t', '0'];
            spawn(exe, args, { windowsHide: true });
          } else if (platform === 'darwin') {
            // macOS: 使用 AppleScript 调用系统事件
            const action = (act.op === 'restart') ? 'restart' : (act.op === 'logoff') ? 'log out' : 'shut down';
            try {
              spawn('osascript', ['-e', `tell application "System Events" to ${action}`], { windowsHide: true });
            } catch {}
          } else {
            // Linux: 优先使用 systemctl，其次回退到 shutdown
            const trySpawn = (cmd, args) => { try { spawn(cmd, args, { windowsHide: true }); return true; } catch { return false; } };
            if (act.op === 'restart') {
              if (!trySpawn('systemctl', ['reboot'])) {
                trySpawn('shutdown', ['-r', 'now']);
              }
            } else if (act.op === 'logoff') {
              // 退出会话依赖桌面环境，尝试常见命令
              if (!trySpawn('gnome-session-quit', ['--logout', '--no-prompt'])) {
                const user = process.env.USER || process.env.LOGNAME || '';
                if (user) {
                  // loginctl 需要 systemd 支持；可能需权限
                  trySpawn('loginctl', ['terminate-user', user]);
                }
              }
            } else {
              if (!trySpawn('systemctl', ['poweroff'])) {
                trySpawn('shutdown', ['-h', 'now']);
              }
            }
          }
        } else if (act.type === 'openApp') {
          if (act.path) shell.openPath(act.path);
        } else if (act.type === 'cmd') {
          const cmdStr = String(act.command || '').trim();
          if (cmdStr) {
            const platform = process.platform;
            if (platform === 'win32') {
              // Windows: 使用 cmd.exe /d /s /c
              const comspec = process.env.ComSpec || path.join(process.env.SystemRoot || 'C\\Windows', 'System32', 'cmd.exe');
              try {
                spawn(comspec, ['/d', '/s', '/c', cmdStr], { windowsHide: true });
              } catch (e) {
                try { spawn(cmdStr, { shell: true, windowsHide: true }); } catch {}
              }
            } else {
              // macOS/Linux: 使用登录 Shell 执行命令，支持别名与 PATH
              const shellPath = process.env.SHELL || '/bin/sh';
              try {
                spawn(shellPath, ['-lc', cmdStr], { windowsHide: true });
              } catch (e) {
                try { spawn(cmdStr, { shell: true, windowsHide: true }); } catch {}
              }
            }
          }
        } else if (act.type === 'wait') {
          let secVal = 0;
          if (act.seconds != null) secVal = Number(act.seconds);
          else if (act.sec != null) secVal = Number(act.sec);
          else if (act.ms != null) secVal = Number(act.ms) / 1000;
          const sec = Math.max(0, isNaN(secVal) ? 0 : secVal);
          await new Promise((resolve) => setTimeout(resolve, Math.round(sec * 1000)));
        }
      } catch {}
    }
  }
}

module.exports = AutomationManager;