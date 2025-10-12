(() => {
  const state = { queue: [], active: false, audio: { info: null, warn: null, error: null }, ttsEnabled: false, ttsVoiceURI: '', ttsPitch: 1, ttsRate: 1, ttsEngine: 'system', ttsEndpoint: '', ttsEdgeVoice: '' };
  const el = {
    toast: document.getElementById('toast'), overlay: document.getElementById('overlay'), ovTitle: document.getElementById('ovTitle'), ovSub: document.getElementById('ovSub'), ovClose: document.getElementById('ovClose'), ovCountdown: document.getElementById('ovCountdown')
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
        const audio = cfg?.audio || {};
        ['info','warn','error'].forEach((k) => { state.audio[k] = audio?.[k] || null; });
      } catch {}
    });
  } catch {}

  // 基础工具
  const playSound = (type) => {
    if (!type || type === 'silent') return;
    const url = state.audio[type];
    if (!url) return; // 默认系统音无法直接调用，若已配置自定义音频则播放
    try {
      const a = new Audio(url);
      a.play().catch(() => {});
    } catch {}
  };

  const speak = async (text) => {
    if (!state.ttsEnabled) return;
    try {
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
    state.queue.push(n);
    if (!state.active) next();
  };

  const next = async () => {
    const n = state.queue.shift();
    if (!n) { state.active = false; return; }
    state.active = true;
    await showNotification(n);
    state.active = false;
    next();
  };

  const showNotification = (n) => new Promise((resolve) => {
    const type = n.type || 'info';
    const title = n.title || n.main || '';
    const sub = n.subText || n.sub || '';
    const speakText = n.speakText || `${title}${sub ? '，' + sub : ''}`;
    const speakEnabled = (n.speak === true) || (n.speak === undefined && state.ttsEnabled);

    // 声音
    playSound(type);
    // TTS
    if (speakEnabled) speak(speakText);

    if (n.mode === 'overlay') {
      showOverlay({ title, sub, autoClose: !!n.autoClose, duration: n.duration || 3000, showClose: !!n.showClose, closeDelay: n.closeDelay || 0 }, resolve);
    } else {
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
      <div class="meta"><i class="ri-notification-3-line"></i> ${type.toUpperCase()}</div>
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
      done();
    };

    el.ovClose.onclick = () => {
      if (el.ovClose.disabled) return;
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