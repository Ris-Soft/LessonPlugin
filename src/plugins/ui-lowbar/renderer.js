(function(){
  // 开发预览环境 polyfill：当不存在 window.lowbarAPI 时，提供最小可用实现
  (function ensureLowbarApi(){
    if (window.lowbarAPI) return;
    const makeUrl = (rel) => new URL(rel, window.location.href).href;
    const query = new URLSearchParams(window.location.search || '');
    const previewWindowMode = query.get('windowMode') || query.get('wm') || 'all_modes';
    const previewPayload = {
      title: 'UI模板-低栏应用',
      windowMode: previewWindowMode,
      icon: 'ri-layout-bottom-line',
      backgroundUrl: makeUrl('../ui-lowbar-caller/background/clock.html?date=0&seconds=0&blink=0'),
      floatingUrl: null,
      floatingBounds: 'center',
      floatingSizePercent: 48,
      eventChannel: 'example.lowbar',
      subscribeTopics: ['example.lowbar'],
      capabilities: { maximizable: true, fullscreenable: true },
      centerItems: [ { id:'openControls', text:'功能选择', icon:'ri-tools-line' } ],
      leftItems: [
        { id:'clock-date', text:'显示日期', icon:'ri-calendar-line', active: false },
        { id:'clock-seconds', text:'显示秒数', icon:'ri-time-line', active: false },
        { id:'clock-blink', text:'冒号闪烁', icon:'ri-flashlight-line', active: false }
      ],
      backgroundTargets: {
        clock: makeUrl('../ui-lowbar-caller/background/clock.html'),
        calendar: makeUrl('../ui-lowbar-caller/background/calendar.html'),
        countdown: makeUrl('../ui-lowbar-caller/background/countdown.html'),
        stopwatch: makeUrl('../ui-lowbar-caller/background/stopwatch.html')
      },
      callerPluginId: 'ui.lowbar.caller'
    };
    let onEventHandler = null;
    // 预览态：在浏览器内模拟调用方后端的状态与处理
    const state = {
      currentMode: 'clock',
      clockOpts: { date: 0, seconds: 0, blink: 0 },
      bgTargets: previewPayload.backgroundTargets,
      floatBase: makeUrl('../ui-lowbar-caller/float/control.html')
    };
    // 事件队列，用于在 onEventHandler 设置之前缓存事件
    const eventQueue = [];
    const dispatchUpdate = (target, value) => {
      const event = { name: 'example.lowbar', data: { type: 'update', target, value } };
      if (onEventHandler) {
        try { onEventHandler(event.name, event.data); } catch (e) { console.error('[LOWBAR POLYFILL] Error in dispatchUpdate:', e); }
      } else {
        eventQueue.push(event);
      }
    };
    const buildClockUrl = () => {
      const base = state.bgTargets.clock;
      const u = new URL(base);
      u.searchParams.set('date', String(state.clockOpts.date));
      u.searchParams.set('seconds', String(state.clockOpts.seconds));
      u.searchParams.set('blink', String(state.clockOpts.blink));
      return u.href;
    };
    window.lowbarAPI = {
      onInit: (handler) => { try { handler(previewPayload); } catch {} },
      windowControl: () => ({ ok: true }),
      toggleFullscreen: () => ({ ok: true }),
      toggleAlwaysOnTop: () => ({ result: false }),
      emitEvent: () => ({ ok: true }),
      subscribe: () => {},
      onEvent: (handler) => { 
        onEventHandler = handler; 
        
        // 处理队列中的事件
        while (eventQueue.length > 0) {
          const event = eventQueue.shift();
          try {
            
            handler(event.name, event.data);
          } catch (e) {
            console.error('[LOWBAR POLYFILL] Error processing queued event:', e);
          }
        }
      },
      // 预览态直接处理模板回调，模拟调用方后端
      pluginCall: (_targetPluginId, fnName, args) => {
        
        try {
          if (fnName !== 'onLowbarEvent') return { ok: true };
          const payload = Array.isArray(args) ? args[0] : null;
          
          if (!payload || typeof payload !== 'object') return { ok: true };
          if (payload.type === 'click') {
            if (payload.id === 'openControls') {
              const u = new URL(state.floatBase);
              u.searchParams.set('mode', state.currentMode);
              dispatchUpdate('floatingUrl', u.href);
            }
          } else if (payload.type === 'left.click') {
            if (payload.id === 'clock-date') { state.clockOpts.date = state.clockOpts.date ? 0 : 1; dispatchUpdate('leftItems', [
              { id:'clock-date', text:'显示日期', icon:'ri-calendar-line', active: !!state.clockOpts.date },
              { id:'clock-seconds', text:'显示秒数', icon:'ri-time-line', active: !!state.clockOpts.seconds },
              { id:'clock-blink', text:'冒号闪烁', icon:'ri-flashlight-line', active: !!state.clockOpts.blink }
            ]); dispatchUpdate('backgroundUrl', buildClockUrl()); }
            else if (payload.id === 'clock-seconds') { state.clockOpts.seconds = state.clockOpts.seconds ? 0 : 1; dispatchUpdate('leftItems', [
              { id:'clock-date', text:'显示日期', icon:'ri-calendar-line', active: !!state.clockOpts.date },
              { id:'clock-seconds', text:'显示秒数', icon:'ri-time-line', active: !!state.clockOpts.seconds },
              { id:'clock-blink', text:'冒号闪烁', icon:'ri-flashlight-line', active: !!state.clockOpts.blink }
            ]); dispatchUpdate('backgroundUrl', buildClockUrl()); }
            else if (payload.id === 'clock-blink') { state.clockOpts.blink = state.clockOpts.blink ? 0 : 1; dispatchUpdate('leftItems', [
              { id:'clock-date', text:'显示日期', icon:'ri-calendar-line', active: !!state.clockOpts.date },
              { id:'clock-seconds', text:'显示秒数', icon:'ri-time-line', active: !!state.clockOpts.seconds },
              { id:'clock-blink', text:'冒号闪烁', icon:'ri-flashlight-line', active: !!state.clockOpts.blink }
            ]); dispatchUpdate('backgroundUrl', buildClockUrl()); }
            else if (payload.id === 'mode-countdown') { state.currentMode = 'countdown'; dispatchUpdate('leftItems', [
              { id:'mode-countdown', text:'倒计时', icon:'ri-timer-line', active: true },
              { id:'mode-stopwatch', text:'秒表', icon:'ri-time-line', active: false }
            ]); dispatchUpdate('backgroundUrl', state.bgTargets.countdown); }
            else if (payload.id === 'mode-stopwatch') { state.currentMode = 'stopwatch'; dispatchUpdate('leftItems', [
              { id:'mode-countdown', text:'倒计时', icon:'ri-timer-line', active: false },
              { id:'mode-stopwatch', text:'秒表', icon:'ri-time-line', active: true }
            ]); dispatchUpdate('backgroundUrl', state.bgTargets.stopwatch); }
          } else if (payload.type === 'float.mode') {
            const m = payload.mode;
            if (m === 'clock') { state.currentMode = 'clock'; dispatchUpdate('leftItems', [
              { id:'clock-date', text:'显示日期', icon:'ri-calendar-line', active: !!state.clockOpts.date },
              { id:'clock-seconds', text:'显示秒数', icon:'ri-time-line', active: !!state.clockOpts.seconds },
              { id:'clock-blink', text:'冒号闪烁', icon:'ri-flashlight-line', active: !!state.clockOpts.blink }
            ]); dispatchUpdate('backgroundUrl', buildClockUrl()); }
            else if (m === 'calendar') { state.currentMode = 'calendar'; dispatchUpdate('leftItems', [
              { id:'mode-countdown', text:'倒计时', icon:'ri-timer-line', active: false },
              { id:'mode-stopwatch', text:'秒表', icon:'ri-time-line', active: true }
            ]); dispatchUpdate('backgroundUrl', state.bgTargets.calendar); }
            else if (m === 'countdown') { state.currentMode = 'countdown'; dispatchUpdate('leftItems', [
              { id:'mode-countdown', text:'倒计时', icon:'ri-timer-line', active: true },
              { id:'mode-stopwatch', text:'秒表', icon:'ri-time-line', active: false }
            ]); dispatchUpdate('backgroundUrl', state.bgTargets.countdown); }
            else if (m === 'stopwatch') { state.currentMode = 'stopwatch'; dispatchUpdate('leftItems', [
              { id:'mode-countdown', text:'倒计时', icon:'ri-timer-line', active: false },
              { id:'mode-stopwatch', text:'秒表', icon:'ri-time-line', active: true }
            ]); dispatchUpdate('backgroundUrl', state.bgTargets.stopwatch); }
          }
          return { ok: true };
        } catch { return { ok: true }; }
      }
    };
  })();
  const $ = (sel) => document.querySelector(sel);
  const body = document.body;
  // 事件通道（由调用方传参下发）
  let gEventChannel = null;
  // 调用方插件ID（用于模板直接回调后端处理事件）
  let gCallerPluginId = null;
  // 初始模式标记（用于在 onInit 后保持与窗口模式一致的样式与按钮状态）
  let gInitialFull = false;
  let gInitialMax = false;
  // 悬浮窗口边界预设（'left' | 'center' | null），用于每次打开时重算位置
  let gFloatingBoundsPreset = null;
  // 悬浮窗口刚打开时间戳（用于遮罩点击防抖，避免“闪一下”）
  let gFloatJustOpenedAt = 0;
  // 悬浮窗口相对尺寸（百分比 1-100），用于控制相对宽高
  let gFloatSizePercent = 60;
  // 悬浮窗口绝对尺寸（像素），优先于相对尺寸
  let gFloatWidthPx = null;
  let gFloatHeightPx = null;
  // 悬浮窗最大化模式：取消 90% 与 1200px 的限制，尽可能充满可见区域
  let gFloatMaximize = false;

  function setModeClass(isFull, isMax) {
    body.classList.remove('mode-windowed','mode-maximized','mode-fullscreen');
    if (isFull) body.classList.add('mode-fullscreen');
    else if (isMax) body.classList.add('mode-maximized');
    else body.classList.add('mode-windowed');
  }

  function buildItems(container, items) {
    container.innerHTML = '';
    if (!Array.isArray(items)) return;
    for (const it of items) {
      const btn = document.createElement('button');
      btn.className = 'rect-btn';
      btn.dataset.id = it.id || '';
      btn.dataset.type = it.type || '';
      const icon = document.createElement('i');
      icon.className = it.icon || 'ri-function-line';
      const text = document.createElement('span');
      text.textContent = it.text || it.id || '';
      btn.appendChild(icon);
      btn.appendChild(text);
      if (it.active) btn.classList.add('active');
      btn.addEventListener('click', () => {
        const payload = { type: (container.id === 'center-items' ? 'click' : 'left.click'), id: it.id, kind: it.type };
        try {
          if (gCallerPluginId) {
            window.lowbarAPI.pluginCall(gCallerPluginId, 'onLowbarEvent', [payload]);
          }
        } catch {}
      });
      container.appendChild(btn);
    }
  }

  function applyInit(payload) {
    $('#top-title').textContent = payload.title || 'UI模板-低栏应用';
    $('#bottom-title').textContent = payload.title || 'UI模板-低栏应用';
    document.title = payload.title || 'UI模板-低栏应用';
    $('#top-icon').className = payload.icon || 'ri-layout-bottom-line';
    $('#bottom-icon').className = payload.icon || 'ri-layout-bottom-line';

    // 事件通道与订阅（支持外部后端与模板双向通讯）
    gEventChannel = payload.eventChannel || null;
    gCallerPluginId = payload.callerPluginId || null;
    // 相对尺寸参数（1-100），默认 60
    if (payload && payload.floatingSizePercent != null) {
      const p = parseInt(payload.floatingSizePercent, 10);
      if (!Number.isNaN(p)) {
        gFloatSizePercent = Math.min(100, Math.max(1, p));
      }
    }
    // 绝对尺寸（像素），若提供则优先生效
    if (payload && payload.floatingWidth != null) {
      const w = parseInt(payload.floatingWidth, 10);
      if (!Number.isNaN(w) && w > 0) gFloatWidthPx = w;
    }
    if (payload && payload.floatingHeight != null) {
      const h = parseInt(payload.floatingHeight, 10);
      if (!Number.isNaN(h) && h > 0) gFloatHeightPx = h;
    }
    const topics = Array.isArray(payload.subscribeTopics) ? payload.subscribeTopics : (gEventChannel ? [gEventChannel] : []);
    try { topics.forEach((t) => window.lowbarAPI.subscribe(t)); } catch {}
    try {
      window.lowbarAPI.onEvent((name, data) => {
        if (!gEventChannel || name !== gEventChannel || !data || typeof data !== 'object') {
          return;
        }
        if (data.type === 'update') {
          switch (data.target) {
            case 'backgroundUrl': {
              const bgv = document.getElementById('bgView');
              if (bgv && data.value) { bgv.src = data.value; bgv.style.display = 'block'; }
              break;
            }
            case 'floatingUrl': {
              const fv2 = document.getElementById('floatView');
              const fw2 = document.getElementById('floatWin');
              if (fv2 && fw2 && data.value) { 
                fv2.src = data.value; 
                // 每次打开根据预设重算位置
                fw2.style.display = 'block';
                // 开场动画：淡入并上移回位
                fw2.style.opacity = '0';
                fw2.style.transform = 'translateY(8px)';
                requestAnimationFrame(() => { fw2.style.opacity = '1'; fw2.style.transform = 'translateY(0)'; });
                try { if (gFloatingBoundsPreset) positionFloatWin(gFloatingBoundsPreset); } catch {}
                const mask2 = document.getElementById('floatMask');
                if (mask2 && !pinned) mask2.style.display = 'block';
                gFloatJustOpenedAt = Date.now();
              } else {
                if (fv2 && fw2 && !data.value) {
                  // 淡出动画后隐藏
                  fw2.style.opacity = '0';
                  fw2.style.transform = 'translateY(8px)';
                  setTimeout(() => {
                    fw2.style.display = 'none';
                    const mask2 = document.getElementById('floatMask');
                    if (mask2) mask2.style.display = 'none';
                  }, 160);
                }
              }
              break;
            }
            case 'floatingBounds': {
              const fw2 = document.getElementById('floatWin');
              if (!fw2) break;
              const v = data.value;
              if (typeof v === 'string') {
                if (v === 'max') {
                  gFloatMaximize = true;
                  const preset = 'center';
                  gFloatingBoundsPreset = preset;
                  positionFloatWin(preset);
                } else {
                  gFloatMaximize = false;
                  const preset = v === 'left' ? 'left' : 'center';
                  gFloatingBoundsPreset = preset;
                  positionFloatWin(preset);
                }
              } else if (v && typeof v === 'object') {
                const { x, y, width, height } = v;
                if (Number.isFinite(width) && width > 0) gFloatWidthPx = Math.floor(width);
                if (Number.isFinite(height) && height > 0) gFloatHeightPx = Math.floor(height);
                if (Number.isFinite(x) && Number.isFinite(y)) {
                  fw2.style.left = Math.floor(x) + 'px';
                  fw2.style.top = Math.floor(y) + 'px';
                  if (Number.isFinite(width) && width > 0) fw2.style.width = Math.floor(width) + 'px';
                  if (Number.isFinite(height) && height > 0) fw2.style.height = Math.floor(height) + 'px';
                } else {
                  gFloatMaximize = false;
                  const preset = gFloatingBoundsPreset || 'center';
                  positionFloatWin(preset);
                }
              }
              break;
            }
            case 'floatingMaximize': {
              const v = !!data.value;
              gFloatMaximize = v;
              const preset = gFloatingBoundsPreset || 'center';
              positionFloatWin(preset);
              break;
            }
            case 'floatingSizePercent': {
              const p = parseInt(data.value, 10);
              if (!Number.isNaN(p)) {
                gFloatSizePercent = Math.min(100, Math.max(1, p));
                const preset = gFloatingBoundsPreset || 'center';
                positionFloatWin(preset);
              }
              break;
            }
            case 'floatingWidth': {
              const w = parseInt(data.value, 10);
              if (!Number.isNaN(w) && w > 0) gFloatWidthPx = w;
              const preset = gFloatingBoundsPreset || 'center';
              positionFloatWin(preset);
              break;
            }
            case 'floatingHeight': {
              const h = parseInt(data.value, 10);
              if (!Number.isNaN(h) && h > 0) gFloatHeightPx = h;
              const preset = gFloatingBoundsPreset || 'center';
              positionFloatWin(preset);
              break;
            }
            case 'centerItems': {
              const centerEl = document.getElementById('center-items');
              document.querySelector('.center.area')?.classList.add('has-content');
              if (centerEl && Array.isArray(data.value)) buildItems(centerEl, data.value);
              break;
            }
            case 'leftItems': {
              const leftEl = document.getElementById('left-items');
              if (leftEl && Array.isArray(data.value)) buildItems(leftEl, data.value);
              break;
            }
            default:
              break;
          }
        }
      });
    } catch {}

    // 背景与悬浮
    const bg = $('#bgView');
    const fw = $('#floatWin');
    const fv = $('#floatView');

    // 计算并设置悬浮窗口位置（按预设）
    const positionFloatWin = (preset) => {
      const vw = window.innerWidth || 1200;
      const vh = window.innerHeight || 800;
      const scale = Math.min(100, Math.max(1, gFloatSizePercent)) / 100;
      let wDesired = (gFloatWidthPx && gFloatWidthPx > 0) ? gFloatWidthPx : Math.floor(vw * scale);
      let hDesired = (gFloatHeightPx && gFloatHeightPx > 0) ? gFloatHeightPx : Math.floor(vh * scale);
      const isCenter = preset === 'center';
      // 贴近底栏定位：根据底栏高度与小间距计算
      const bb = document.getElementById('bottombar');
      const bottomH = bb ? bb.offsetHeight : (document.body.classList.contains('mode-fullscreen') ? 80 : 68);
      const gap = 6;
      // 最大化模式：尽可能占满宽高（保留左右与顶部少量边距）
      if (gFloatMaximize) {
        wDesired = vw; hDesired = vh;
      }
      const maxW = gFloatMaximize ? Math.max(200, vw - 48) : Math.min(1200, Math.floor(vw * 0.9));
      const w = Math.min(wDesired, maxW);
      const maxH = gFloatMaximize ? Math.max(160, Math.floor(vh - bottomH - gap - 12)) : Math.floor(vh * 0.9);
      const h = Math.min(hDesired, maxH);
      const left = isCenter ? Math.max(24, Math.round((vw - w) / 2)) : 24;
      const top = Math.max(12, vh - bottomH - gap - h);
      fw.style.left = left + 'px';
      fw.style.top = top + 'px';
      fw.style.width = w + 'px';
      fw.style.height = h + 'px';
    };

    // 在 WebView 中注入 iframe 满高样式（适配第三方页面）
  const iframeCSS = `
      html, body { height: 100% !important; }
      iframe { width: 100% !important; height: 100% !important; border: 0 !important; display: block !important; }
    `;
    const hookInsertCSS = (wv) => {
      if (!wv) return;
      const inject = () => { try { wv.insertCSS(iframeCSS); } catch {} };
      // 仅在 dom-ready 注入，避免导航过程中调用导致 ERR_ABORTED (-3)
      wv.addEventListener('dom-ready', inject);
    };
    hookInsertCSS(bg);
    hookInsertCSS(fv);

    const mapLevel = (lvl) => {
      if (typeof lvl === 'number') { if (lvl >= 2) return 'error'; if (lvl === 1) return 'warn'; return 'log'; }
      if (lvl === 'error' || lvl === 'warn' || lvl === 'info' || lvl === 'debug') return lvl;
      return 'log';
    };
    const joinArgs = (args) => {
      try {
        return (Array.isArray(args) ? args : [args]).map((a) => {
          if (a == null) return 'null';
          if (typeof a === 'string') return a;
          if (typeof a === 'object') { if (a.stack) return String(a.stack); try { return JSON.stringify(a); } catch { return String(a); } }
          return String(a);
        }).join(' ');
      } catch { return String(args); }
    };
    const attachWebviewConsole = (wv, tag) => {
      if (!wv) return;
      try {
        wv.addEventListener('console-message', (e) => {
          const level = mapLevel(e.level);
          const fn = console[level] || console.log;
          fn('[' + tag + ']', e.message);
        });
      } catch {}
      try {
        wv.addEventListener('ipc-message', (e) => {
          if (e && e.channel === 'webview-console') {
            const p = e.args && e.args[0];
            const level = mapLevel(p && p.level);
            const fn = console[level] || console.log;
            fn('[' + tag + ']', joinArgs(p && p.args));
          }
        });
      } catch {}
    };
    attachWebviewConsole(bg, 'bgView');
    attachWebviewConsole(fv, 'floatView');

    // 直接操作 WebView 的 Shadow DOM，将内部 iframe 设为满高
    const forceIframeFullSize = (wv) => {
      if (!wv) return;
      const apply = () => {
        try {
          const sr = wv.shadowRoot;
          const inner = sr && sr.querySelector('iframe');
          if (inner) {
            inner.style.height = '100%';
            inner.style.width = '100%';
            inner.style.flex = '1 1 auto';
            inner.style.border = '0';
            // 确保宿主为 flex，避免高度塌陷
            const s = sr.querySelector('style');
            if (s && !/display:\s*flex/.test(s.textContent)) {
              s.textContent = (s.textContent || '') + '\n:host { display: flex; }';
            }
          }
        } catch {}
      };
      apply();
      wv.addEventListener('dom-ready', apply);
      wv.addEventListener('did-finish-load', apply);
      wv.addEventListener('did-navigate', apply);
      wv.addEventListener('did-navigate-in-page', apply);
      // 监听结构变化，确保样式在重建时仍然生效
      try {
        const mo = new MutationObserver(apply);
        mo.observe(wv, { childList: true, subtree: true });
      } catch {}
    };
    forceIframeFullSize(bg);
    forceIframeFullSize(fv);
    if (payload.backgroundUrl) {
      bg.src = payload.backgroundUrl; bg.style.display = 'block';
    } else {
      // 模板默认不加载内置页面，由调用者提供 URL
      bg.src = 'about:blank'; bg.style.display = 'none';
    }
    if (payload.floatingUrl) {
      fv.src = payload.floatingUrl; fw.style.display = 'block';
      // 开场动画
      fw.style.opacity = '0';
      fw.style.transform = 'translateY(8px)';
      requestAnimationFrame(() => { fw.style.opacity = '1'; fw.style.transform = 'translateY(0)'; });
      const mask = document.getElementById('floatMask');
      if (mask && !pinned) mask.style.display = 'block';
      gFloatJustOpenedAt = Date.now();
    } else {
      // 无浮层内容时隐藏浮层窗口（淡出）
      fv.src = 'about:blank';
      fw.style.opacity = '0';
      fw.style.transform = 'translateY(8px)';
      setTimeout(() => { fw.style.display = 'none'; }, 160);
      const mask = document.getElementById('floatMask');
      if (mask) mask.style.display = 'none';
    }
    if (payload.floatingBounds && typeof payload.floatingBounds === 'object') {
      const { x, y, width, height } = payload.floatingBounds;
      // 允许仅提供宽/高，保留当前位置计算；若同时提供 x/y 则按绝对坐标设置
      if (Number.isFinite(width) && width > 0) gFloatWidthPx = Math.floor(width);
      if (Number.isFinite(height) && height > 0) gFloatHeightPx = Math.floor(height);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        fw.style.left = Math.floor(x) + 'px';
        fw.style.top = Math.floor(y) + 'px';
        if (Number.isFinite(width) && width > 0) fw.style.width = Math.floor(width) + 'px';
        if (Number.isFinite(height) && height > 0) fw.style.height = Math.floor(height) + 'px';
      } else {
        const preset = gFloatingBoundsPreset || 'center';
        positionFloatWin(preset);
      }
    } else if (typeof payload.floatingBounds === 'string') {
      const preset = payload.floatingBounds === 'left' ? 'left' : 'center';
      gFloatingBoundsPreset = preset;
      positionFloatWin(preset);
    } else {
      gFloatingBoundsPreset = 'center';
      positionFloatWin('center');
    }
    // 初始渲染交由调用者提供的按钮集合
    const centerEl = $('#center-items');
    const leftEl = $('#left-items');
    if (Array.isArray(payload.centerItems)) {
      document.querySelector('.center.area')?.classList.add('has-content');
      buildItems(centerEl, payload.centerItems);
    }
    if (Array.isArray(payload.leftItems)) {
      buildItems(leftEl, payload.leftItems);
    }

    // 浮层页面导航驱动模式切换（由调用方浮层控制页面改变 ?mode=）
    const syncModeFromFloat = () => {
      try {
        const u = new URL(fv.src, window.location.href);
        const mode = u.searchParams.get('mode');
        const minsStr = u.searchParams.get('mins');
        const mins = minsStr != null ? parseInt(minsStr, 10) : null;
        // 刚打开浮层时抑制首次模式事件，避免调用方立刻关闭导致“闪一下”
        if (gFloatJustOpenedAt && (Date.now() - gFloatJustOpenedAt) < 300) {
          return;
        }
        if (mode === 'calendar' || mode === 'clock' || mode === 'countdown' || mode === 'stopwatch') {
          const evt = { type: 'float.mode', mode };
          if (mode === 'countdown' && mins != null && !Number.isNaN(mins) && mins > 0) {
            evt.mins = mins;
          }
          try {
            if (gEventChannel) {
              window.lowbarAPI.emitEvent(gEventChannel, evt);
            } else {
              window.lowbarAPI.emitEvent('lowbar:click', evt);
            }
          } catch (e) {
            console.error('[LOWBAR] Error emitting float mode event:', e);
          }
          // 直接回调调用方插件后端
          try {
            if (gCallerPluginId) {
              window.lowbarAPI.pluginCall(gCallerPluginId, 'onLowbarEvent', [evt]);
            }
          } catch (e) {
            console.error('[LOWBAR] Error calling plugin for float mode:', e);
          }
        }
      } catch (e) {
        console.error('[LOWBAR] Error in syncModeFromFloat:', e);
      }
    };
    try {
      fv.addEventListener('did-navigate', syncModeFromFloat);
      fv.addEventListener('did-navigate-in-page', syncModeFromFloat);
      fv.addEventListener('dom-ready', syncModeFromFloat);
    } catch {}

    // 控制按钮显示策略：
    // 顶栏右侧：若支持最大化则显示最大化；否则若支持全屏显示全屏；否则隐藏
    // 底栏右侧：若支持全屏始终显示全屏；否则若支持最大化显示最大化；否则隐藏
    const caps = payload.capabilities || { maximizable: true, fullscreenable: true };
    const mode = payload.windowMode || 'all_modes';
    const topMax = $('#btn-max');
    const topFull = $('#btn-full');
    const bottomMax = $('#bottom-max');
    const bottomFull = $('#bottom-full');

    // 顶栏控制区：
    if (caps.maximizable) {
      topMax.style.display = 'inline-flex';
      topFull.style.display = 'none';
    } else if (caps.fullscreenable) {
      topMax.style.display = 'none';
      topFull.style.display = 'inline-flex';
    } else {
      topMax.style.display = 'none';
      topFull.style.display = 'none';
    }

    // 底栏控制区：
    if (mode === 'fullscreen_only') {
      // 仅全屏，不显示退出全屏按钮
      bottomFull.style.display = 'none';
      bottomMax.style.display = 'none';
    } else if (caps.fullscreenable) {
      bottomFull.style.display = 'inline-flex';
      bottomMax.style.display = 'none';
    } else if (caps.maximizable) {
      bottomFull.style.display = 'none';
      bottomMax.style.display = 'inline-flex';
    } else {
      bottomFull.style.display = 'none';
      bottomMax.style.display = 'none';
    }

    // 标记左右分区有内容（用于全屏分区背景）
    document.querySelector('.left').classList.add('has-content');
    document.querySelector('.right').classList.add('has-content');

    // 初始模式：根据调用方下发的 windowMode 设置样式，避免默认窗口化导致顶栏显示
    const initMode = (payload && payload.windowMode) ? String(payload.windowMode) : 'all_modes';
    if (initMode === 'fullscreen_only') {
      gInitialFull = true; gInitialMax = false;
    } else if (initMode === 'fullscreen_maximized') {
      gInitialFull = false; gInitialMax = true;
    } else {
      gInitialFull = false; gInitialMax = false;
    }
    setModeClass(gInitialFull, gInitialMax);
  }

  // 顶栏按钮
  $('#btn-min').addEventListener('click', () => window.lowbarAPI.windowControl('minimize'));
  $('#btn-max').addEventListener('click', () => window.lowbarAPI.windowControl('maximize'));
  $('#btn-close').addEventListener('click', () => window.lowbarAPI.windowControl('close'));
  // 根据初始模式同步折叠按钮与文档类名状态
  let isFull = gInitialFull;
  let isCollapsed = false;
  $('#btn-full').addEventListener('click', () => {
    window.lowbarAPI.toggleFullscreen();
    isFull = !isFull;
    setModeClass(isFull, false);
    const label = $('#bottom-full').querySelector('span');
    if (label) label.textContent = isFull ? '退出全屏' : '全屏';
    if (!isFull && isCollapsed) { isCollapsed = false; document.body.classList.remove('collapsed'); }
    updateCollapseButtons();
    // 全屏切换后重算悬浮窗位置
    const fw = document.getElementById('floatWin');
    if (fw && fw.style.display !== 'none' && !pinned) { try { if (gFloatingBoundsPreset) positionFloatWin(gFloatingBoundsPreset); } catch {} }
  });

  // 底栏按钮（复刻顶栏控制）
  $('#bottom-min').addEventListener('click', () => window.lowbarAPI.windowControl('minimize'));
  $('#bottom-max').addEventListener('click', () => window.lowbarAPI.windowControl('maximize'));
  $('#bottom-close').addEventListener('click', () => window.lowbarAPI.windowControl('close'));
  $('#bottom-full').addEventListener('click', () => {
    window.lowbarAPI.toggleFullscreen();
    isFull = !isFull;
    setModeClass(isFull, false);
    const label = $('#bottom-full').querySelector('span');
    if (label) label.textContent = isFull ? '退出全屏' : '全屏';
    if (!isFull && isCollapsed) { isCollapsed = false; document.body.classList.remove('collapsed'); }
    updateCollapseButtons();
    // 全屏切换后重算悬浮窗位置
    const fw = document.getElementById('floatWin');
    if (fw && fw.style.display !== 'none' && !pinned) { try { if (gFloatingBoundsPreset) positionFloatWin(gFloatingBoundsPreset); } catch {} }
  });

  // 收起/展开按钮
  const collapseBtn = document.getElementById('bottom-collapse');
  const expandRightBtn = document.getElementById('bottom-expand-right');
  const expandCenterBtn = document.getElementById('bottom-expand-center');

  function updateCollapseButtons() {
    if (!isFull) {
      if (collapseBtn) collapseBtn.style.display = 'none';
      if (expandRightBtn) expandRightBtn.style.display = 'none';
      if (expandCenterBtn) expandCenterBtn.style.display = 'none';
      return;
    }
    if (isCollapsed) {
      if (collapseBtn) collapseBtn.style.display = 'none';
      if (expandRightBtn) expandRightBtn.style.display = 'inline-flex';
      // 移除中央展开按钮显示
      if (expandCenterBtn) expandCenterBtn.style.display = 'none';
    } else {
      if (collapseBtn) collapseBtn.style.display = 'inline-flex';
      if (expandRightBtn) expandRightBtn.style.display = 'none';
      if (expandCenterBtn) expandCenterBtn.style.display = 'none';
    }
  }
  if (collapseBtn) collapseBtn.addEventListener('click', () => { if (!isFull) return; isCollapsed = true; document.body.classList.add('collapsed'); updateCollapseButtons(); });
  if (expandRightBtn) expandRightBtn.addEventListener('click', () => { isCollapsed = false; document.body.classList.remove('collapsed'); updateCollapseButtons(); });
  if (expandCenterBtn) expandCenterBtn.addEventListener('click', () => { isCollapsed = false; document.body.classList.remove('collapsed'); updateCollapseButtons(); });

  // 置顶按钮
  const pinBtn = document.getElementById('btn-pin');
  if (pinBtn) {
    pinBtn.addEventListener('click', async () => {
      try {
        const res = await window.lowbarAPI.toggleAlwaysOnTop();
        const pinned = (res && typeof res === 'object') ? !!res.result : !!res;
        pinBtn.classList.toggle('active', pinned);
      } catch {}
    });
  }

  // 悬浮窗口控制
  $('#float-close').addEventListener('click', () => { 
    const fw = $('#floatWin');
    const mask = document.getElementById('floatMask');
    fw.style.opacity = '0';
    fw.style.transform = 'translateY(8px)';
    setTimeout(() => { fw.style.display = 'none'; if (mask) mask.style.display = 'none'; }, 160);
  });
  let pinned = false;
  $('#float-pin').addEventListener('click', () => {
    pinned = !pinned;
    $('#float-pin').classList.toggle('active', pinned);
    const mask = document.getElementById('floatMask');
    const fw = document.getElementById('floatWin');
    if (mask) mask.style.display = (!pinned && fw && fw.style.display !== 'none') ? 'block' : 'none';
  });

  // 使用遮罩捕获点击关闭（避免 webview 事件不冒泡的问题）
  const floatMask = document.getElementById('floatMask');
  if (floatMask) {
    floatMask.addEventListener('mousedown', () => {
      const fw = document.getElementById('floatWin');
      if (!fw) return;
      const visible = fw.style.display !== 'none';
      if (!visible || pinned) return;
      // 避免打开瞬间的同一次点击被遮罩捕获导致立即关闭
      if (gFloatJustOpenedAt && (Date.now() - gFloatJustOpenedAt) < 200) return;
      fw.style.opacity = '0';
      fw.style.transform = 'translateY(8px)';
      setTimeout(() => { fw.style.display = 'none'; floatMask.style.display = 'none'; }, 160);
      gFloatJustOpenedAt = 0;
    });
  }

  // 窗口尺寸变化时重算悬浮窗位置
  window.addEventListener('resize', () => {
    const fw = document.getElementById('floatWin');
    if (!fw || fw.style.display === 'none' || pinned) return;
    try { if (gFloatingBoundsPreset) positionFloatWin(gFloatingBoundsPreset); } catch {}
  });

  // 拖拽悬浮窗口（仅在容器内拖动）
  (function enableFloatDrag(){
    const fw = $('#floatWin');
    const bar = fw.querySelector('.float-titlebar');
    let dragging = false; let sx=0, sy=0, ox=0, oy=0;
    if (window.PointerEvent) {
      if (bar && bar.style) bar.style.touchAction = 'none';
      let rafScheduled=false; let dxLatest=0; let dyLatest=0;
      const applyMove = ()=>{ rafScheduled=false; fw.style.left=(ox+dxLatest)+'px'; fw.style.top=(oy+dyLatest)+'px'; };
      const onDown = (e) => { if (e.pointerType==='mouse' && e.button!==0) return; dragging=true; sx=e.clientX; sy=e.clientY; const r=fw.getBoundingClientRect(); ox=r.left; oy=r.top; e.preventDefault(); try{ window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp, { once:true }); }catch{} };
      const onMove = (e) => { if (!dragging) return; dxLatest=e.clientX-sx; dyLatest=e.clientY-sy; if (!rafScheduled) { rafScheduled=true; requestAnimationFrame(applyMove); } };
      const onUp = () => { dragging=false; rafScheduled=false; try{ window.removeEventListener('pointermove', onMove); }catch{} };
      bar.addEventListener('pointerdown', onDown);
      fw.addEventListener('pointerdown', (e) => { if (e.pointerType==='mouse' && e.button!==0) return; if (e.target!==fw) return; dragging=true; sx=e.clientX; sy=e.clientY; const r=fw.getBoundingClientRect(); ox=r.left; oy=r.top; e.preventDefault(); try{ window.addEventListener('pointermove', onMove); window.addEventListener('pointerup', onUp, { once:true }); }catch{} });
    } else {
      let rafScheduled=false; let dxLatest=0; let dyLatest=0;
      const applyMove = ()=>{ rafScheduled=false; fw.style.left=(ox+dxLatest)+'px'; fw.style.top=(oy+dyLatest)+'px'; };
      const onDownMouse = (e) => { if (e.button!==0) return; dragging=true; sx=e.clientX; sy=e.clientY; const r=fw.getBoundingClientRect(); ox=r.left; oy=r.top; try{ window.addEventListener('mousemove', onMoveMouse); window.addEventListener('mouseup', onUpMouse, { once:true }); }catch{} };
      const onMoveMouse = (e) => { if (!dragging) return; dxLatest=e.clientX-sx; dyLatest=e.clientY-sy; if (!rafScheduled) { rafScheduled=true; requestAnimationFrame(applyMove); } };
      const onUpMouse = () => { dragging=false; rafScheduled=false; try{ window.removeEventListener('mousemove', onMoveMouse); }catch{} };
      bar.addEventListener('mousedown', onDownMouse);
      fw.addEventListener('mousedown', (e) => { if (e.button!==0) return; if (e.target !== fw) return; dragging = true; sx = e.clientX; sy = e.clientY; const r = fw.getBoundingClientRect(); ox=r.left; oy=r.top; try{ window.addEventListener('mousemove', onMoveMouse); window.addEventListener('mouseup', onUpMouse, { once:true }); }catch{} });
    }
  })();

  // 标题栏缩放按钮已移除（保留拖拽与固定/关闭）。

  // 快捷键：Esc 关闭浮窗
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const fw = document.getElementById('floatWin');
      const mask = document.getElementById('floatMask');
      if (fw && fw.style.display !== 'none') {
        fw.style.opacity = '0';
        fw.style.transform = 'translateY(8px)';
        setTimeout(() => { fw.style.display = 'none'; if (mask) mask.style.display = 'none'; }, 160);
      }
    }
  });

  // 初始化事件
  window.lowbarAPI.onInit(applyInit);
  updateCollapseButtons();
})();
