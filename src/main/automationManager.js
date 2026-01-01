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
    // 新增：插件“分钟触发器”注册表（仅 HH:MM + 回调）
    this.pluginMinuteTriggers = new Map();
    // 轻日志：按系统配置或环境变量启用
    this.log = (...a) => { try { if (this.store.get('system','debugLog') || process.env.LP_DEBUG) console.log('[Automation]', ...a); } catch {} };
  }

  init() {
    // 确保默认值
    this.store.ensureDefaults('automation', { list: [] });
    const latest = this.store.get('automation', 'list');
    this.items = Array.isArray(latest) ? latest : [];

    // 根据规范对齐分钟触发：插件 init 完成后按当前秒数决定补触发与定时器创建
    try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch {}
    const align = () => {
      try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch {}
      const d = nowDate();
      const sec = d.getSeconds();
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const cur = `${hh}:${mm}`;
      const msToNextMinute = (60 - sec) * 1000;
      this.log('align:start', { cur, sec, msToNextMinute });
    
      const startAlignedInterval = () => {
        try { if (this.timer) { clearInterval(this.timer); clearTimeout(this.timer); } } catch {}
        // 在 00 秒边界执行一次，然后进入每 60s 的对齐循环
        try { this.checkTimeTriggers(); this.log('aligned:boundary_tick'); } catch {}
        this.timer = setInterval(() => { this.log('tick:minute'); try { this.checkTimeTriggers(); } catch {} }, 60000);
      };
    
      // 启动时立即检查一次当前分钟（补触发），随后在下一分钟 00 秒对齐并进入每 60s 检查
      try { this.checkTimeTriggers(); this.log('startup:immediate_check', cur); } catch {}
      this.log('align:schedule_next_minute', msToNextMinute);
      this.timer = setTimeout(startAlignedInterval, msToNextMinute);
    };
    align();

    // 系统睡眠后恢复：重新对齐
    try {
      const { powerMonitor } = require('electron');
      this._onResume = () => { align(); };
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
      const approved = await this.showConfirmOverlay(item, { reason: 'manual_test', itemId: item.id });
      // 注意：showConfirmOverlay 内部已在批准时执行动作，这里不重复执行
      return { ok: true, executed: !!approved, reason: approved ? null : 'cancelled' };
    }
    await this.executeActions(item.actions || [], { reason: 'manual_test', itemId: item.id });
    return { ok: true, executed: true };
  }

  checkMinuteAlignmentStartup() {
    // deprecated: 启动对齐与补触发逻辑已迁移到 init()
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
    // 新增：检查插件分钟触发器（HH:MM + 回调）
    this._checkPluginMinuteTriggersAt(cur, d);
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

      // 1) 创建自动化项：使用协议触发（OrbiBoard://task/<text>）
      const protoText = `plugin:${String(pluginId || '').trim()}:${uuidv4().slice(0, 8)}`;
      const item = this.create({ name, source: 'shortcut', triggers: [{ type: 'protocol', text: protoText }], actions, confirm: { enabled: false, timeout: 0 } });

      // 2) 生成 ICO 图标（深色圆角边框背景 + 白色 Remixicon 图标）
      const iconsDir = path.join(this.app.getPath('userData'), 'icons');
      try { if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true }); } catch {}
      const icoPath = path.join(iconsDir, `${item.id}.ico`);
      const pngPath = path.join(iconsDir, `${item.id}.png`);
      let icoOk = false;
      let pngOk = false;
      try {
        // 优先使用设置页预览生成的 PNG（避免在无字体环境下渲染失败）
        if (iconDataUrl && iconDataUrl.startsWith('data:image/png;base64,')) {
          const pngBuf = Buffer.from(iconDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
          if (pngBuf?.length) {
            fs.writeFileSync(pngPath, pngBuf);
            pngOk = true;
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
      if (!pngOk) {
        pngOk = await this._generateRemixIconPng(iconName, pngPath, bgColor, fgColor);
      }

      const desktop = this.app.getPath('desktop');
      let shortcutPath = '';
      if (process.platform === 'win32') {
        const safeFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.lnk';
        shortcutPath = path.join(desktop, safeFile);
        const execPath = process.execPath;
        const args = `OrbiBoard://task/${encodeURIComponent(protoText)}`;
        let created = false;
        try {
          const ps = [
            `$ws = New-Object -ComObject WScript.Shell;`,
            `$s = $ws.CreateShortcut(\"${shortcutPath.replace(/\\/g,'\\\\')}\");`,
            `$s.TargetPath = \"${execPath.replace(/\\/g,'\\\\')}\";`,
            `$s.Arguments = \"${args}\";`,
            icoOk ? `$s.IconLocation = \"${icoPath.replace(/\\/g,'\\\\')},0\";` : ``,
            `$s.WorkingDirectory = \"${path.dirname(execPath).replace(/\\/g,'\\\\')}\";`,
            `$s.Save()`
          ].filter(Boolean).join(' ');
          await new Promise((resolve, reject) => {
            const p = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', ps], { windowsHide: true });
            p.on('error', reject);
            p.on('exit', (code) => { if (code === 0 && fs.existsSync(shortcutPath)) resolve(); else reject(new Error('powershell_failed')); });
          });
          created = true;
        } catch {}
        if (!created) {
          const fallbackFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.url';
          shortcutPath = path.join(desktop, fallbackFile);
          const urlLine = `URL=OrbiBoard://task/${encodeURIComponent(protoText)}`;
          const iconLines = icoOk ? `IconFile=${icoPath}\r\nIconIndex=0` : '';
          const content = `[InternetShortcut]\r\n${urlLine}\r\n${iconLines}\r\n`;
          try { fs.writeFileSync(shortcutPath, content, 'utf8'); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
        }
      } else if (process.platform === 'darwin') {
        const safeFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.command';
        shortcutPath = path.join(desktop, safeFile);
        const content = `#!/bin/bash\nopen \"OrbiBoard://task/${encodeURIComponent(protoText)}\"\n`;
        try { fs.writeFileSync(shortcutPath, content, 'utf8'); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
        try { fs.chmodSync(shortcutPath, 0o755); } catch {}
      } else {
        const safeFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.desktop';
        shortcutPath = path.join(desktop, safeFile);
        const execPath = process.env.APPIMAGE || process.execPath;
        const execLine = `Exec="${execPath}" "OrbiBoard://task/${encodeURIComponent(protoText)}"`;
        const tryExecLine = `TryExec=${execPath}`;
        const iconLine = pngOk ? `Icon=${pngPath}` : '';
        const content = `[Desktop Entry]\nType=Application\nName=${name}\n${execLine}\n${tryExecLine}\n${iconLine}\nTerminal=false\nCategories=Utility;\n`;
        try { fs.writeFileSync(shortcutPath, content, 'utf8'); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
        try { fs.chmodSync(shortcutPath, 0o755); } catch {}
      }

      return { ok: true, shortcutPath, iconPath: (process.platform === 'win32' ? (icoOk ? icoPath : null) : (pngOk ? pngPath : null)), itemId: item.id, protocolText: protoText };
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

  async _generateRemixIconPng(iconClassName, pngPath, bgColor, fgColor) {
    try {
      const size = 256;
      const rendererDir = path.join(__dirname, '..', 'renderer');
      const remixCssPath = path.join(rendererDir, 'remixicon-local.css');
      let remixCss = '';
      try { remixCss = fs.readFileSync(remixCssPath, 'utf8'); } catch {}
      const woffUrl = `file://${rendererDir.replace(/\\/g, '/')}/remixicon.woff2`;
      if (remixCss) {
        remixCss = remixCss.replace(/url\(\s*['"]?remixicon\.woff2['"]?\s*\)/g, `url('${woffUrl}')`);
      }
      const cssBlock = remixCss
        ? `<style>${remixCss}\nhtml,body{margin:0;padding:0;background:transparent;}</style>`
        : `<link rel=\"stylesheet\" href=\"file://${rendererDir.replace(/\\/g, '/')}/remixicon-local.css\" />\n<style>@font-face { font-family: 'remixicon'; src: url('${woffUrl}') format('woff2'); font-display: block; } html,body{margin:0;padding:0;background:transparent;}</style>`;
      const html = `<!DOCTYPE html><html><head><meta charset=\"utf-8\" />${cssBlock}</head><body></body></html>`;
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
          const raw = String(content).replace(/^\s*[^\w\\]*|[^\w\\]*\s*$/g, '');
          if (/^\\[0-9a-fA-F]+$/.test(raw)) {
            const hex = raw.replace(/\\+/g, '');
            const code = parseInt(hex || '0', 16);
            return String.fromCharCode(code || 0);
          }
          return raw;
        }
        let ch = getCharFromComputed(i);
        for (let t = 0; t < 30 && (!ch || ch === 'none' || ch === '""' || ch === "''"); t++) {
          await new Promise(r => setTimeout(r, 50));
          ch = getCharFromComputed(i);
        }
        if (!ch || ch === '""' || ch === "''" || ch === 'none') {
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
      fs.writeFileSync(pngPath, pngBuf);
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
            this.log('period:start', pid, p.id, p.name);
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
            this.log('period:end', pid, p.id, p.name);
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
      await this.showConfirmOverlay(item, { ...ctx, itemId: item.id });
    } else {
      try { console.info('automation:execute', { id: item.id, name: item.name, reason: ctx?.reason || '' }); } catch {}
      await this.executeActions(item.actions || [], { ...ctx, itemId: item.id });
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
        if (ok) await this.executeActions(item.actions || [], { ...ctx, itemId: item.id });
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
    // 变量展开：支持字符串中的 ${插件:变量}
    const expandString = async (s) => {
      try {
        const str = String(s ?? '');
        const re = /\$\{([^}]+)\}/g;
        let out = str;
        let m;
        const seen = new Set();
        while ((m = re.exec(str)) != null) {
          const token = String(m[1] || '').trim();
          if (!token) continue;
          if (seen.has(m.index)) continue;
          seen.add(m.index);
          const parts = token.split(':');
          const pluginKey = String(parts[0] || '').trim();
          const varName = String(parts.slice(1).join(':') || '').trim();
          if (!pluginKey || !varName) continue;
          try {
            const res = await this.pluginManager.getVariable(pluginKey, varName);
            const val = (res && res.ok) ? (res.result ?? '') : '';
            out = out.replace(m[0], String(val ?? ''));
          } catch {}
        }
        return out;
      } catch { return String(s ?? ''); }
    };
    const expandValue = async (v) => {
      try {
        if (typeof v === 'string') return expandString(v);
        if (Array.isArray(v)) {
          const arr = [];
          for (const it of v) arr.push(await expandValue(it));
          return arr;
        }
        if (v && typeof v === 'object') {
          const obj = {};
          for (const [k, val] of Object.entries(v)) obj[k] = await expandValue(val);
          return obj;
        }
        return v;
      } catch { return v; }
    };
    for (const act of actions) {
      try {
        const manual = String(ctx?.reason || '') === 'manual_test';
        // 修复：不再限制仅 manual 模式下执行插件动作
        // if ((act && (act.type === 'pluginEvent' || act.type === 'pluginAction')) && !manual) {
        //   continue;
        // }
        try { console.info('automation:action:start', { type: act.type, pluginId: act.pluginId || '', target: act.event || act.target || act.action || '' }); } catch {}
        this.log('executeAction:start', act.type, act.pluginId || '', act.event || act.target || act.action || '');
        if (act.type === 'pluginEvent') {
          const params = Array.isArray(act.params) ? await Promise.all(act.params.map((x) => expandValue(x))) : [];
          await this.pluginManager.callFunction(act.pluginId, act.event, params);
        } else if (act.type === 'pluginAction') {
          const fn = String(act.target || act.action || '').trim();
          if (fn) {
            const params = Array.isArray(act.params) ? await Promise.all(act.params.map((x) => expandValue(x))) : [];
            await this.pluginManager.callFunction(act.pluginId, fn, params);
          }
        } else if (act.type === 'power') {
          const platform = process.platform;
          if (platform === 'win32') {
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
          if (act.path) {
            try { const p = await expandString(act.path); shell.openPath(p); } catch { shell.openPath(act.path); }
          }
        } else if (act.type === 'cmd') {
          const cmdStr = String(act.command || '').trim();
          if (cmdStr) {
            let expanded = cmdStr;
            try { expanded = await expandString(cmdStr); } catch {}
            const platform = process.platform;
            if (platform === 'win32') {
              // Windows: 使用 cmd.exe /d /s /c
              const comspec = process.env.ComSpec || path.join(process.env.SystemRoot || 'C\\Windows', 'System32', 'cmd.exe');
              try {
                spawn(comspec, ['/d', '/s', '/c', expanded], { windowsHide: true });
              } catch (e) {
                try { spawn(expanded, { shell: true, windowsHide: true }); } catch {}
              }
            } else {
              // macOS/Linux: 使用登录 Shell 执行命令，支持别名与 PATH
              const shellPath = process.env.SHELL || '/bin/sh';
              try {
                spawn(shellPath, ['-lc', expanded], { windowsHide: true });
              } catch (e) {
                try { spawn(expanded, { shell: true, windowsHide: true }); } catch {}
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
        try { console.info('automation:action:success', { type: act.type }); } catch {}
        this.log('executeAction:success', act.type);
      } catch (e) {
        try { console.info('automation:action:error', { type: act.type, error: e?.message || String(e) }); } catch {}
        this.log('executeAction:error', act.type, e?.message || String(e));
      }
    }
    // 记录上次成功执行时间
    try {
      const itemId = ctx?.itemId;
      if (itemId) {
        const item = this.get(itemId);
        if (item) {
          item.lastSuccessAt = nowDate().toISOString();
          this.store.set('automation', 'list', this.items);
        }
      }
    } catch {}
  }

  // 新增：插件分钟触发器接口（仅 HH:MM 列表与回调）
  registerPluginMinuteTriggers(pluginId, hhmmList, callback) {
    const canonId = String(pluginId || '').trim();
    if (!canonId) return { ok: false, error: 'invalid_plugin_id' };
    const times = Array.isArray(hhmmList) ? hhmmList.map((t) => String(t || '').slice(0,5)).filter((t) => /^(\d{2}:\d{2})$/.test(t)) : [];
    if (typeof callback !== 'function') return { ok: false, error: 'callback_required' };
    this.log('pluginMinute:register', canonId, times);
    this.pluginMinuteTriggers.set(canonId, { times: Array.from(new Set(times)), cb: callback });
    return { ok: true, count: times.length };
  }
  clearPluginMinuteTriggers(pluginId) {
    const canonId = String(pluginId || '').trim();
    this.pluginMinuteTriggers.delete(canonId);
    return { ok: true };
  }
  listPluginMinuteTriggers(pluginId) {
    const canonId = String(pluginId || '').trim();
    const entry = this.pluginMinuteTriggers.get(canonId) || { times: [], cb: null };
    return { ok: true, times: entry.times || [] };
  }

  _checkPluginMinuteTriggersAt(curHHMM, dateObj) {
    const d = dateObj || nowDate();
    for (const [pid, entry] of this.pluginMinuteTriggers.entries()) {
      const times = Array.isArray(entry?.times) ? entry.times : [];
      const cb = entry?.cb;
      if (!times.length || typeof cb !== 'function') continue;
      if (times.includes(curHHMM)) {
        if (entry._lastMinute === curHHMM) continue;
        entry._lastMinute = curHHMM;
        this.log('pluginMinute:fire', pid, curHHMM);
        try { cb(curHHMM, d); } catch {}
      }
    }
  }
}

module.exports = AutomationManager;
