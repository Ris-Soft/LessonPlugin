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
    // 插件计时器：pluginId -> { periods: Array<Period> }
    this.pluginTimers = new Map();
  }

  init() {
    // 确保默认值
    this.store.ensureDefaults('automation', { list: [] });
    const latest = this.store.get('automation', 'list');
    this.items = Array.isArray(latest) ? latest : [];
    // 按整分钟对齐检查“到达某时间”触发器
    try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch {}
    const scheduleNext = () => {
      const now = Date.now();
      // 距离下一分钟边界的毫秒数（确保在 mm:00 秒准点触发）
      const msToNextMinute = 60000 - (now % 60000);
      this.timer = setTimeout(() => {
        try { this.checkTimeTriggers(); } catch {}
        scheduleNext();
      }, msToNextMinute);
    };
    scheduleNext();

    // 启动补触发：应用启动或初始化后，若当前分钟尚未执行，则立即检查一次
    try { this.checkTimeTriggers(); } catch {}

    // 系统睡眠后恢复时进行补触发，并重新对齐下一分钟
    try {
      const { powerMonitor } = require('electron');
      this._onResume = () => {
        try { this.checkTimeTriggers(); } catch {}
        try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch {}
        scheduleNext();
      };
      powerMonitor.on('resume', this._onResume);
    } catch {}
  }

  dispose() {
    try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch {}
    try {
      const { powerMonitor } = require('electron');
      if (this._onResume) powerMonitor.removeListener('resume', this._onResume);
      this._onResume = null;
    } catch {}
  }

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

    // 检查插件计时器（开始/结束时间点）
    this._checkPluginTimersAt(cur, d);
  }

  // 插件计时器接口：注册/清理/查询
  registerPluginTimers(pluginId, periods) {
    const canonId = String(pluginId || '').trim();
    if (!canonId) return { ok: false, error: 'invalid_plugin_id' };
    const list = Array.isArray(periods) ? periods.map((p, idx) => ({
      id: p?.id || `p_${idx}`,
      name: String(p?.name || `时段${idx + 1}`),
      enabled: p?.enabled !== false,
      start: String(p?.start || '').slice(0,5),
      end: String(p?.end || '').slice(0,5),
      weekdays: Array.isArray(p?.weekdays) ? p.weekdays : [1,2,3,4,5],
      biweek: ['even','odd','any'].includes(String(p?.biweek)) ? String(p.biweek) : 'any',
      speakStart: !!p?.speakStart,
      speakEnd: !!p?.speakEnd,
      soundIn: p?.soundIn !== false, // 默认播放入场
      soundOut: p?.soundOut !== false, // 默认播放退场
      // 插件自带动作：在开始/结束时执行（通用，无需主程序特判）
      actionsStart: Array.isArray(p?.actionsStart) ? p.actionsStart : [],
      actionsEnd: Array.isArray(p?.actionsEnd) ? p.actionsEnd : [],
      // 文案交由插件默认处理，此处不设默认
      textStart: (p?.textStart || ''),
      textEnd: (p?.textEnd || ''),
      subTextEnd: (p?.subTextEnd ?? '')
    })) : [];
    this.pluginTimers.set(canonId, { periods: list });
    return { ok: true, count: list.length };
  }
  clearPluginTimers(pluginId) {
    const canonId = String(pluginId || '').trim();
    this.pluginTimers.delete(canonId);
    return { ok: true };
  }
  listPluginTimers(pluginId) {
    const canonId = String(pluginId || '').trim();
    const entry = this.pluginTimers.get(canonId) || { periods: [] };
    return { ok: true, periods: entry.periods };
  }

  // 为插件创建“动作快捷方式”到桌面：生成协议触发的自动化项 + .url 快捷方式 + ICO 图标
  async createActionShortcut(pluginId, options) {
    try {
      const nameRaw = String(options?.name || '').trim();
      const name = nameRaw || '插件动作';
      const actions = Array.isArray(options?.actions) ? options.actions : [];
      if (!actions.length) return { ok: false, error: 'actions_required' };
      const iconName = String(options?.icon || '').trim() || 'ri-flashlight-fill';
      const bgColor = String(options?.bgColor || '#262626');
      const fgColor = String(options?.fgColor || '#ffffff');
      const iconDataUrl = String(options?.iconDataUrl || '').trim();

      // 1) 创建自动化项：使用协议触发（LessonPlugin://task/<text>）
      const protoText = `plugin:${String(pluginId || '').trim()}:${uuidv4().slice(0, 8)}`;
      const item = this.create({ name, triggers: [{ type: 'protocol', text: protoText }], actions, confirm: { enabled: false, timeout: 0 } });

      // 2) 生成 ICO 图标（深色圆角边框背景 + 白色 Remixicon 图标）
      const iconsDir = path.join(this.app.getPath('userData'), 'icons');
      try { if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true }); } catch {}
      const icoPath = path.join(iconsDir, `${item.id}.ico`);
      let icoOk = false;
      try {
        // 优先使用设置页预览生成的 PNG（避免在无字体环境下渲染失败）
        if (iconDataUrl && iconDataUrl.startsWith('data:image/png;base64,')) {
          const pngBuf = Buffer.from(iconDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
          if (pngBuf?.length) {
            const icoBuf = this._pngToIco(pngBuf, 256);
            fs.writeFileSync(icoPath, icoBuf);
            icoOk = true;
          }
        }
      } catch {}
      if (!icoOk) {
        // 回退到主进程生成（离屏渲染 + 字体）
        icoOk = await this._generateRemixIconIco(iconName, icoPath, bgColor, fgColor);
      }

      // 3) 在桌面创建 .url 快捷方式，指向协议
      const desktop = this.app.getPath('desktop');
      const safeFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.url';
      const shortcutPath = path.join(desktop, safeFile);
      const urlLine = `URL=LessonPlugin://task/${encodeURIComponent(protoText)}`;
      const iconLines = icoOk ? `IconFile=${icoPath}\r\nIconIndex=0` : '';
      const content = `[InternetShortcut]\r\n${urlLine}\r\n${iconLines}\r\n`;
      try { fs.writeFileSync(shortcutPath, content, 'utf8'); } catch (e) { return { ok: false, error: e?.message || String(e) }; }

      return { ok: true, shortcutPath, iconPath: icoOk ? icoPath : null, itemId: item.id, protocolText: protoText };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async _generateRemixIconIco(iconClassName, icoPath, bgColor, fgColor) {
    try {
      const size = 256;
      const rendererDir = path.join(__dirname, '..', 'renderer');
      const remixCssPath = path.join(rendererDir, 'remixicon-local.css');
      let remixCss = '';
      try { remixCss = fs.readFileSync(remixCssPath, 'utf8'); } catch {}
      const woffUrl = `file://${rendererDir.replace(/\\/g, '/')}/remixicon.woff2`;
      if (remixCss) {
        // 重写字体文件为绝对 file://，避免 data: 环境相对路径失效
        remixCss = remixCss.replace(/url\(\s*['\"]?remixicon\.woff2['\"]?\s*\)/g, `url('${woffUrl}')`);
      }
      const cssBlock = remixCss
        ? `<style>${remixCss}\nhtml,body{margin:0;padding:0;background:transparent;}</style>`
        : `<link rel=\"stylesheet\" href=\"file://${rendererDir.replace(/\\/g, '/')}/remixicon-local.css\" />\n<style>@font-face { font-family: 'remixicon'; src: url('${woffUrl}') format('woff2'); font-display: block; } html,body{margin:0;padding:0;background:transparent;}</style>`;
      const html = `<!DOCTYPE html><html><head>
        <meta charset=\"utf-8\" />
        ${cssBlock}
      </head><body></body></html>`;
      const win = new BrowserWindow({ show: false, width: size, height: size, webPreferences: { offscreen: true } });
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const js = `(() => new Promise(async (resolve) => {
        const size = ${size};
        const bg = ${JSON.stringify(bgColor)};
        const fg = ${JSON.stringify(fgColor)};
        const icon = ${JSON.stringify(iconClassName)};
        const i = document.createElement('i');
        i.className = icon;
        i.style.fontFamily = 'remixicon';
        i.style.fontStyle = 'normal';
        i.style.fontWeight = 'normal';
        document.body.appendChild(i);
        try { await document.fonts.ready; } catch {}
        function getCharFromComputed(el) {
          const content = getComputedStyle(el, '::before').content || '';
          const raw = String(content).replace(/^\s*[\"\']|[\"\']\s*$/g, '');
          if (/^\\[0-9a-fA-F]+$/.test(raw)) {
            const hex = raw.replace(/\\+/g, '');
            const code = parseInt(hex || '0', 16);
            return String.fromCharCode(code || 0);
          }
          // 若浏览器直接返回的是字符（而非十六进制转义），直接使用
          return raw;
        }
        let ch = getCharFromComputed(i);
        // 等待样式应用，避免 content 为 'none'
        for (let t = 0; t < 30 && (!ch || ch === 'none' || ch === '""' || ch === "''"); t++) {
          await new Promise(r => setTimeout(r, 50));
          ch = getCharFromComputed(i);
        }
        if (!ch || ch === '""' || ch === "''" || ch === 'none') {
          // 兜底：若指定图标类无效，尝试使用默认图标
          i.className = 'ri-flashlight-fill';
          ch = getCharFromComputed(i) || '';
        }
        const c = document.createElement('canvas'); c.width = size; c.height = size; document.body.appendChild(c);
        const ctx = c.getContext('2d');
        function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
        ctx.fillStyle = bg; roundRect(0,0,size,size, Math.floor(size*0.18)); ctx.fill();
        ctx.fillStyle = fg;
        const fontSize = Math.floor(size*0.56);
        ctx.font = fontSize + 'px remixicon';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(ch || '', size/2, size/2);
        const data = c.toDataURL('image/png');
        resolve(data);
      }))()`;
      const dataUrl = await win.webContents.executeJavaScript(js, true);
      try { if (!win.isDestroyed()) win.destroy(); } catch {}
      const pngBuf = Buffer.from(String(dataUrl || '').replace(/^data:image\/png;base64,/, ''), 'base64');
      if (!pngBuf?.length) return false;
      const icoBuf = this._pngToIco(pngBuf, size);
      fs.writeFileSync(icoPath, icoBuf);
      return true;
    } catch {
      return false;
    }
  }

  _pngToIco(pngBuf, size) {
    // 参考 ICO 结构：Header(6) + Directory(16) + PNG 数据
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(1, 4); // count
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size; // width
    dir[1] = size >= 256 ? 0 : size; // height
    dir[2] = 0; // color count
    dir[3] = 0; // reserved
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bit depth
    dir.writeUInt32LE(pngBuf.length, 8); // size of data
    dir.writeUInt32LE(6 + 16, 12); // offset to data
    return Buffer.concat([header, dir, pngBuf]);
  }

  _checkPluginTimersAt(curHHMM, dateObj) {
    const d = dateObj || nowDate();
    const weekday = d.getDay() === 0 ? 7 : d.getDay(); // 1..7
    // 读取单双周基准
    const base = this.store.get('system', 'semesterStart') || this.store.get('system', 'offsetBaseDate');
    const biweekOff = !!this.store.get('system', 'biweekOffset');
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

    for (const [pid, entry] of this.pluginTimers.entries()) {
      const periods = Array.isArray(entry?.periods) ? entry.periods : [];
      for (const p of periods) {
        if (!p.enabled) continue;
        const onWeekday = Array.isArray(p.weekdays) ? p.weekdays.includes(weekday) : true;
        if (!onWeekday || !matchBiweek(p.biweek)) continue;
        // 触发开始：执行插件注册的 actionsStart（若为空则忽略）
        if (p.start && p.start === curHHMM) {
          if (p._lastStartMinute !== curHHMM) {
            p._lastStartMinute = curHHMM;
            try {
              const acts = Array.isArray(p.actionsStart) ? p.actionsStart : [];
              if (acts.length) this.executeActions(acts, { reason: 'pluginTimer:start', pluginId: pid, now: d, period: p });
            } catch {}
          }
        }
        // 触发结束：执行插件注册的 actionsEnd（若为空则忽略）
        if (p.end && p.end === curHHMM) {
          if (p._lastEndMinute !== curHHMM) {
            p._lastEndMinute = curHHMM;
            try {
              const acts = Array.isArray(p.actionsEnd) ? p.actionsEnd : [];
              if (acts.length) this.executeActions(acts, { reason: 'pluginTimer:end', pluginId: pid, now: d, period: p });
            } catch {}
          }
        }
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
    const biweekOff = !!this.store.get('system', 'biweekOffset');
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
        skipTaskbar: true, focusable: false, hasShadow: false, acceptFirstMouse: true,
        webPreferences: { preload: path.join(__dirname, '..', 'preload', 'settings.js'), backgroundThrottling: false } // 复用API能力
      });
      try { win.setAlwaysOnTop(true, 'screen-saver'); } catch {}
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
        // console.log(act);
        if (act.type === 'pluginEvent') {
          await this.pluginManager.callFunction(act.pluginId, act.event, act.params || []);
          // console.log(act);
          // console.log(`Plugin ${act.pluginId} event ${act.event} called with params ${JSON.stringify(act.params || [])}`);
        } else if (act.type === 'pluginAction') {
          const fn = String(act.target || act.action || '').trim();
          if (fn) {
            await this.pluginManager.callFunction(act.pluginId, fn, act.params || []);
          }
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