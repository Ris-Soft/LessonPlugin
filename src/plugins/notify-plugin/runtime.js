(() => {
  const state = { queue: [], active: false, enabled: true, audio: { info: null, warn: null, error: null }, systemSoundVolume: 80, ttsEnabled: false, ttsVoiceURI: '', ttsPitch: 1, ttsRate: 1, ttsEngine: 'system', ttsEndpoint: '', ttsEdgeVoice: '', ttsVolume: 100 };
  const el = {
    toast: document.getElementById('toast'), overlay: document.getElementById('overlay'), ovTitle: document.getElementById('ovTitle'), ovSub: document.getElementById('ovSub'), ovClose: document.getElementById('ovClose'), ovCountdown: document.getElementById('ovCountdown'),
    overlayText: document.getElementById('overlayText'), overlayTextContent: document.getElementById('overlayTextContent'),
    overlayComponent: document.getElementById('overlayComponent'), ovCompFrame: document.getElementById('ovCompFrame'), ovCompClose: document.getElementById('ovCompClose'), ovCompCountdown: document.getElementById('ovCompCountdown')
  };

  // 初始启用穿透（左上角通知与空闲时）
  try { window.notifyAPI?.setClickThrough(true); } catch {}

  // 订阅配置更新：由主进程广播，实现设置实时生效
  try {
    window.notifyAPI?.onConfigUpdate((cfg) => {
      try {
        state.ttsEnabled = !!cfg?.tts;
        state.ttsEngine = cfg?.ttsEngine || 'system';
        state.ttsVoiceURI = cfg?.ttsVoiceURI || '';
        state.ttsPitch = Number(cfg?.ttsPitch ?? 1);
        state.ttsRate = Number(cfg?.ttsRate ?? 1);
        state.ttsEndpoint = cfg?.ttsEndpoint || '';
        state.ttsEdgeVoice = cfg?.ttsEdgeVoice || '';
        state.enabled = (cfg?.enabled ?? true);
        state.systemSoundVolume = Math.max(0, Math.min(100, Number(cfg?.systemSoundVolume ?? state.systemSoundVolume)));
        state.ttsVolume = Math.max(0, Math.min(100, Number(cfg?.ttsVolume ?? state.ttsVolume)));
        const audio = cfg?.audio || {};
        ['info','warn','error'].forEach((k) => { state.audio[k] = audio?.[k] || null; });
      } catch {}
    });
  } catch {}

  // 基础工具
  const playSoundBuiltin = (which = 'in', after) => {
    try {
      const file = which === 'out' ? 'out.mp3' : 'in.mp3';
      const a = new Audio(`./sounds/${file}`);
      // 程序内音量保持 100%，改为系统音量暂调
      a.volume = 1.0;
      try {
        const target = Math.max(0, Math.min(100, Number(state.systemSoundVolume || 80)));
        window.notifyAPI?.setSystemVolume?.(target);
      } catch {}
      a.addEventListener('ended', () => {
        try { window.notifyAPI?.restoreSystemVolume?.(); } catch {}
        try { if (typeof after === 'function') after(); } catch {}
      });
      a.play().catch(() => {
        // 播放失败也尝试恢复
        try { window.notifyAPI?.restoreSystemVolume?.(); } catch {}
        try { if (typeof after === 'function') after(); } catch {}
      });
    } catch {}
  };

  const speak = async (text) => {
    if (!state.ttsEnabled) return;
    try {
      const vol = Math.max(0, Math.min(1, Number(state.ttsVolume || 100) / 100));
      // 优先尝试本地 EdgeTTS（除非明确选择远程 edge）
      if (state.ttsEngine !== 'edge') {
        try {
          const voice = state.ttsEdgeVoice || 'zh-CN-XiaoxiaoNeural';
          const res = await window.notifyAPI?.pluginCall?.('notify.plugin', 'edgeSpeakLocal', [text, voice]);
          if (res?.ok && res?.path) {
            const a = new Audio(res.path);
            a.volume = vol;
            a.play().catch(() => {});
            return;
          }
        } catch {}
      }
      if (state.ttsEngine === 'edge' && state.ttsEndpoint) {
        try {
          const u = new URL(state.ttsEndpoint);
          u.searchParams.set('text', text);
          if (state.ttsEdgeVoice) u.searchParams.set('voice', state.ttsEdgeVoice);
          u.searchParams.set('rate', String(state.ttsRate));
          u.searchParams.set('pitch', String(state.ttsPitch));
          const res = await fetch(u.toString());
          if (res.ok) {
            const blob = await res.blob();
            const objUrl = URL.createObjectURL(blob);
            const a = new Audio(objUrl);
            a.volume = vol;
            a.play().catch(() => {});
            setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
            return;
          }
        } catch {}
      }
      // 回退到系统语音
      const utter = new SpeechSynthesisUtterance(text);
      const clamp = (v, min, max) => Math.max(min, Math.min(max, Number(v || 0)));
      utter.pitch = clamp(state.ttsPitch, 0.5, 2);
      utter.rate = clamp(state.ttsRate, 0.5, 2);
      utter.volume = vol;
      if (state.ttsVoiceURI && window.speechSynthesis) {
        const voices = window.speechSynthesis.getVoices();
        const found = voices.find((v) => (v.voiceURI === state.ttsVoiceURI));
        if (found) utter.voice = found;
      }
      window.speechSynthesis?.speak(utter);
    } catch {}
  };

  // 队列控制
  const enqueue = (n) => {
    // 全局关闭通知时直接忽略
    if (!state.enabled) return;
    state.queue.push(n);
    try { window.notifyAPI?.setVisible(true); } catch {}
    if (!state.active) next();
  };

  const next = async () => {
    const n = state.queue.shift();
    if (!n) { state.active = false; try { window.notifyAPI?.destroyRuntime?.(); } catch {}; return; }
    state.active = true;
    await showNotification(n);
    state.active = false;
    next();
  };

  const showNotification = (n) => new Promise((resolve) => {
    const type = n.type || 'info';
    const title = n.title || n.main || '';
    const sub = n.subText || n.sub || '';
    const speakText = n.speakText || n.text || `${title}${sub ? '，' + sub : ''}`;
    const speakEnabled = (n.speak === true) || (n.speak === undefined && state.ttsEnabled);

    // 声音：按模式控制避免重叠；TTS 按 speak 开关播报
    const sound = (n.which === 'out') ? 'out' : (n.which === 'none' ? null : 'in');
    const afterSoundSpeak = () => { if (speakEnabled) speak(speakText); };

    if (n.mode === 'sound') {
      // 仅播放音效，不显示任何 UI
      if (sound) playSoundBuiltin(sound);
      resolve();
      return;
    } else if (n.mode === 'overlay') {
      if (sound) playSoundBuiltin(sound, afterSoundSpeak); else afterSoundSpeak();
      showOverlay({ title, sub, autoClose: !!n.autoClose, duration: n.duration || 3000, showClose: !!n.showClose, closeDelay: n.closeDelay || 0 }, resolve);
    } else if (n.mode === 'overlay.text') {
      const text = n.text || speakText;
      const animate = n.animate || 'fade';
      const duration = n.duration || 3000;
      if (sound) playSoundBuiltin(sound, afterSoundSpeak); else afterSoundSpeak();
      showOverlayText({ text, animate, duration }, resolve);
    } else if (n.mode === 'overlay.component') {
      if (sound) playSoundBuiltin(sound, afterSoundSpeak); else afterSoundSpeak();
      const group = n.group || '';
      const compId = n.componentId || n.component || '';
      const props = (typeof n.props === 'object' && n.props) ? n.props : {};
      const duration = n.duration || 3000;
      const showClose = !!n.showClose;
      const closeDelay = n.closeDelay || 0;
      showOverlayComponent({ group, compId, props, duration, showClose, closeDelay }, resolve);
    } else {
      if (sound) playSoundBuiltin(sound, afterSoundSpeak); else afterSoundSpeak();
      showToast({ title, sub, type, duration: n.duration || 3000 }, resolve);
    }
  });

  const typeColor = (type) => {
    if (type === 'warn') return 'rgba(255,190,11,0.20)';
    if (type === 'error') return 'rgba(239,35,60,0.22)';
    return 'rgba(58,134,255,0.20)';
  };

  const showToast = ({ title, sub, type, duration }, done) => {
    el.toast.className = `toast ${type}`;
    el.toast.innerHTML = `
      <div class="title">${title}</div>
      ${sub ? `<div class="sub">${sub}</div>` : ''}
    `;
    // 初始进度背景（倒计时：默认 100%，左侧为突出色，右侧为背景）
    const color = typeColor(type);
    el.toast.style.backgroundImage = `linear-gradient(to right, ${color} 100%, transparent 100%)`;
    el.toast.style.display = 'block';
    // 确保过渡触发：移除后强制回流再添加
    el.toast.classList.remove('show');
    void el.toast.offsetWidth;
    el.toast.classList.add('show');

    let elapsed = 0;
    const step = 50;
    const maxDur = Math.max(800, duration);
    const timer = setInterval(() => {
      elapsed += step;
      const remaining = Math.max(0, maxDur - elapsed);
      const remPct = Math.min(100, Math.round((remaining / maxDur) * 100));
      // 剩余进度在左侧显示突出色，右侧为背景
      el.toast.style.backgroundImage = `linear-gradient(to right, ${color} ${remPct}%, transparent ${remPct}%)`;
      if (elapsed >= maxDur) {
        clearInterval(timer);
        el.toast.classList.remove('show');
        // 等滑出动画结束再隐藏
        setTimeout(() => {
          el.toast.style.display = 'none';
          el.toast.style.backgroundImage = 'none';
          done();
        }, 240);
      }
    }, step);
  };

  const showOverlay = ({ title, sub, autoClose, duration, showClose, closeDelay }, done) => {
    // 进入遮罩时关闭穿透
    try { window.notifyAPI?.setClickThrough(false); } catch {}
    el.ovTitle.innerHTML = title;
    el.ovSub.innerHTML = sub || '';
    el.overlay.style.display = 'block';

    let closable = !showClose;
    let countdown = closeDelay || 0;
    let timerId = null;
    let autoId = null;

    const updateCountdown = () => {
      if (countdown > 0) {
        el.ovCountdown.style.display = 'inline';
        el.ovCountdown.textContent = `按钮将在 ${Math.ceil(countdown/1000)}s 后可用`;
      } else {
        el.ovCountdown.style.display = 'none';
      }
    };

    const enableCloseButton = () => {
      el.ovClose.disabled = true;
      el.ovClose.style.display = showClose ? 'inline-block' : 'none';
      updateCountdown();
      if (countdown > 0) {
        timerId = setInterval(() => {
          countdown -= 250;
          if (countdown <= 0) {
            clearInterval(timerId);
            el.ovClose.disabled = false;
            updateCountdown();
          } else {
            updateCountdown();
          }
        }, 250);
      } else {
        el.ovClose.disabled = false;
      }
    };

    if (showClose) enableCloseButton();
    if (autoClose) {
      autoId = setTimeout(() => {
        close();
      }, Math.max(800, duration));
    }

    const close = () => {
      if (timerId) clearInterval(timerId);
      if (autoId) clearTimeout(autoId);
      el.overlay.style.display = 'none';
      el.ovClose.onclick = null;
      // 退出遮罩恢复穿透
      try { window.notifyAPI?.setClickThrough(true); } catch {}
      // 遮罩关闭时不强制播放退场音效（按通知入场已播放一次）
      done();
    };

    el.ovClose.onclick = () => {
      if (el.ovClose.disabled) return;
      close();
    };
  };

  const showOverlayText = ({ text, animate, duration }, done) => {
    // 进入遮罩时关闭穿透
    try { window.notifyAPI?.setClickThrough(false); } catch {}
    el.overlayTextContent.textContent = String(text || '').trim();
    el.overlayText.style.display = 'flex';
    // 动画控制
    const inCls = (animate === 'zoom') ? 'anim-zoom-in' : 'anim-fade-in';
    const outCls = (animate === 'zoom') ? 'anim-zoom-out' : 'anim-fade-out';
    el.overlayText.classList.add(inCls);
    const dur = Math.max(800, Number(duration) || 3000);
    setTimeout(() => {
      el.overlayText.classList.remove(inCls);
      el.overlayText.classList.add(outCls);
      setTimeout(() => {
        el.overlayText.classList.remove(outCls);
        el.overlayText.style.display = 'none';
        // 退出遮罩恢复穿透（纯文本遮罩不播放退场音效）
        try { window.notifyAPI?.setClickThrough(true); } catch {}
        done();
      }, 260);
    }, dur);
  };

  const showOverlayComponent = async ({ group, compId, props, duration, showClose, closeDelay }, done) => {
    try { window.notifyAPI?.setClickThrough(false); } catch {}
    // 解析组件入口URL：优先指定ID，其次取组内首个
    let entryUrl = null;
    try {
      if (compId) {
        entryUrl = await window.notifyAPI?.componentsGetEntryUrl?.(compId);
      }
      if (!entryUrl) {
        const res = await window.notifyAPI?.componentsList?.(group);
        const list = (res?.ok && Array.isArray(res.components)) ? res.components : [];
        entryUrl = list[0]?.url || null;
      }
    } catch {}
    // 构造带查询参数的URL以传递属性（可选）
    try {
      if (entryUrl) {
        const u = new URL(entryUrl);
        Object.keys(props || {}).forEach((k) => {
          const v = props[k];
          if (v === undefined || v === null) return;
          u.searchParams.set(k, String(v));
        });
        el.ovCompFrame.src = u.toString();
      } else {
        // 无组件时显示占位
        const html = '<html><body style="margin:0;padding:0;display:flex;align-items:center;justify-content:center;font-family:sans-serif;">未找到组件</body></html>';
        const blob = new Blob([html], { type: 'text/html' });
        const objUrl = URL.createObjectURL(blob);
        el.ovCompFrame.src = objUrl;
        setTimeout(() => URL.revokeObjectURL(objUrl), 15000);
      }
    } catch {}

    el.overlayComponent.style.display = 'block';
    let closable = !showClose;
    let countdown = closeDelay || 0;
    let timerId = null;
    let autoId = null;

    const updateCountdown = () => {
      if (countdown > 0) {
        el.ovCompCountdown.style.display = 'inline';
        el.ovCompCountdown.textContent = `按钮将在 ${Math.ceil(countdown/1000)}s 后可用`;
      } else {
        el.ovCompCountdown.style.display = 'none';
      }
    };
    const enableCloseButton = () => {
      el.ovCompClose.disabled = true;
      el.ovCompClose.style.display = showClose ? 'inline-block' : 'none';
      updateCountdown();
      if (countdown > 0) {
        timerId = setInterval(() => {
          countdown -= 250;
          if (countdown <= 0) {
            clearInterval(timerId);
            el.ovCompClose.disabled = false;
            updateCountdown();
          } else {
            updateCountdown();
          }
        }, 250);
      } else {
        el.ovCompClose.disabled = false;
      }
    };
    if (showClose) enableCloseButton();
    if (duration && duration > 0) {
      autoId = setTimeout(() => close(), Math.max(800, duration));
    }
    const close = () => {
      if (timerId) clearInterval(timerId);
      if (autoId) clearTimeout(autoId);
      el.overlayComponent.style.display = 'none';
      el.ovCompFrame.src = 'about:blank';
      try { window.notifyAPI?.setClickThrough(true); } catch {}
      done();
    };
    el.ovCompClose.onclick = () => {
      if (el.ovCompClose.disabled) return;
      close();
    };
  };

  // 跨窗口消息 API
  window.addEventListener('message', (e) => {
    const data = e.data;
    if (!data || typeof data !== 'object') return;
    if (data.type === 'notify' && data.payload) {
      enqueue(data.payload);
    } else if (data.type === 'notify.batch' && Array.isArray(data.payload)) {
      data.payload.forEach(enqueue);
    }
  });

  // 也在当前窗口暴露一个简易 API（供 Electron 侧/同窗口调试）
  window.NotifyAPI = { enqueue };

  // Electron 环境：通过 preload 订阅主进程转发的通知
  try {
    window.notifyAPI?.onEnqueue((payloadOrList) => {
      const list = Array.isArray(payloadOrList) ? payloadOrList : [payloadOrList];
      list.forEach(enqueue);
    });
  } catch {}
})();
