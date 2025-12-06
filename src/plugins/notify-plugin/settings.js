(() => {
  const el = {
    enableNotify: document.getElementById('enableNotify'),
    enableTTS: document.getElementById('enableTTS'),
    ttsEngine: document.getElementById('ttsEngine'),
    ttsVoice: document.getElementById('ttsVoice'),
    ttsPitch: document.getElementById('ttsPitch'),
    ttsRate: document.getElementById('ttsRate'),
    ttsEndpoint: document.getElementById('ttsEndpoint'),
    ttsEdgeVoice: document.getElementById('ttsEdgeVoice'),
    ttsVolume: document.getElementById('ttsVolume'),
    systemSoundVolume: document.getElementById('systemSoundVolume'),
    btnPlayIn: document.getElementById('btnPlayIn'),
    btnPlayOut: document.getElementById('btnPlayOut'),
    btnTestOverlayText: document.getElementById('btnTestOverlayText'),
  };

  // 初始化：从统一配置存储读取
  (async () => {
    try {
      const cfg = await window.settingsAPI?.configPluginGetAll?.('notify.plugin');
      if (el.enableNotify) el.enableNotify.checked = (cfg?.enabled ?? true);
      if (el.enableTTS) el.enableTTS.checked = !!cfg?.tts;
      if (el.ttsEngine) el.ttsEngine.value = (cfg?.ttsEngine ?? 'system');
      if (el.ttsPitch) el.ttsPitch.value = (cfg?.ttsPitch ?? 1);
      if (el.ttsRate) el.ttsRate.value = (cfg?.ttsRate ?? 1);
      if (el.ttsEndpoint) el.ttsEndpoint.value = (cfg?.ttsEndpoint ?? '');
      if (el.ttsEdgeVoice) el.ttsEdgeVoice.value = (cfg?.ttsEdgeVoice ?? '');
      if (el.ttsVolume) el.ttsVolume.value = Math.round((cfg?.ttsVolume ?? 100));
      if (el.systemSoundVolume) el.systemSoundVolume.value = Math.round((cfg?.systemSoundVolume ?? 80));
      initVoices(cfg?.ttsVoiceURI);
      initEdgeVoices(cfg?.ttsEdgeVoice);
    } catch {}
  })();

  // 语音列表加载
  const initVoices = (currentURI) => {
    try {
      if (!el.ttsVoice || !window.speechSynthesis) return;
      const build = () => {
        const voices = window.speechSynthesis.getVoices();
        el.ttsVoice.innerHTML = '';
        // 添加一个“系统默认”占位（空值）
        const def = document.createElement('option');
        def.value = '';
        def.textContent = '系统默认';
        el.ttsVoice.appendChild(def);
        voices.forEach((v) => {
          const opt = document.createElement('option');
          opt.value = v.voiceURI || `${v.name}|${v.lang}`;
          opt.textContent = `${v.name} (${v.lang})${v.default ? ' · 默认' : ''}`;
          el.ttsVoice.appendChild(opt);
        });
        // 选中当前配置的 voiceURI
        if (currentURI) {
          el.ttsVoice.value = currentURI;
          if (el.ttsVoice.value !== currentURI) {
            // 兼容 name|lang 存储的旧值
            el.ttsVoice.value = '';
          }
        }
      };
      const existing = window.speechSynthesis.getVoices();
      if (existing && existing.length) {
        build();
      } else {
        window.speechSynthesis.onvoiceschanged = () => build();
      }
    } catch {}
  };

  // 试听入场与退场音效
  if (el.btnPlayIn) {
    el.btnPlayIn.addEventListener('click', () => {
      try { window.settingsAPI?.pluginCall?.('notify.plugin', 'playSound', ['in']); } catch {}
    });
  }
  if (el.btnPlayOut) {
    el.btnPlayOut.addEventListener('click', () => {
      try { window.settingsAPI?.pluginCall?.('notify.plugin', 'playSound', ['out']); } catch {}
    });
  }
  // 测试纯文本提示（全屏）
  if (el.btnTestOverlayText) {
    el.btnTestOverlayText.addEventListener('click', () => {
      try {
        const payload = { mode: 'overlay.text', text: '这是一条纯文本提示', animate: 'fade', duration: 2500 };
        window.settingsAPI?.pluginCall?.('notify.plugin', 'enqueue', [payload]);
      } catch {}
    });
  }

  if (el.enableNotify) {
    el.enableNotify.addEventListener('change', () => {
      const enabled = !!el.enableNotify.checked;
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'enabled', enabled);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    });
  }

  if (el.enableTTS) {
    el.enableTTS.addEventListener('change', () => {
      const enabled = !!el.enableTTS.checked;
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'tts', enabled);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    });
  }

  // 引擎选择（支持 system 与 edge.local）
  if (el.ttsEngine) {
    el.ttsEngine.addEventListener('change', () => {
      const val = el.ttsEngine.value || 'system';
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'ttsEngine', val);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    });
  }

  const initEdgeVoices = (current) => {
    try {
      if (!el.ttsEdgeVoice) return;
      const voices = [
        'zh-CN-XiaoxiaoNeural',
        'zh-CN-XiaoyiNeural',
        'zh-CN-YunjianNeural',
        'zh-CN-YunxiNeural',
        'zh-CN-YunyangNeural',
        'zh-HK-HiuMaanNeural',
        'zh-HK-WanLungNeural',
        'zh-TW-HsiaoChenNeural',
        'zh-TW-HsiaoYuNeural',
        'en-US-AriaNeural',
        'en-US-GuyNeural'
      ];
      el.ttsEdgeVoice.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = '默认';
      el.ttsEdgeVoice.appendChild(def);
      voices.forEach((v) => {
        const opt = document.createElement('option');
        opt.value = v;
        opt.textContent = v;
        el.ttsEdgeVoice.appendChild(opt);
      });
      if (current != null) {
        el.ttsEdgeVoice.value = current;
        if (el.ttsEdgeVoice.value !== current) el.ttsEdgeVoice.value = '';
      }
    } catch {}
  };

  // 音色设置：voice, pitch, rate
  if (el.ttsVoice) {
    el.ttsVoice.addEventListener('change', () => {
      const val = el.ttsVoice.value || '';
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'ttsVoiceURI', val);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    });
  }

  if (el.ttsPitch) {
    const handler = () => {
      const v = Number(el.ttsPitch.value || 1);
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'ttsPitch', v);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    };
    el.ttsPitch.addEventListener('change', handler);
    el.ttsPitch.addEventListener('input', handler);
  }

  if (el.ttsRate) {
    const handler = () => {
      const v = Number(el.ttsRate.value || 1);
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'ttsRate', v);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    };
    el.ttsRate.addEventListener('change', handler);
    el.ttsRate.addEventListener('input', handler);
  }

  // 系统音量滑块：设置播放通知音效时的系统主音量（0–100）
  if (el.systemSoundVolume) {
    const handler = () => {
      const v = Math.max(0, Math.min(100, Number(el.systemSoundVolume.value || 80)));
      const norm = Math.round(v);
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'systemSoundVolume', norm);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    };
    el.systemSoundVolume.addEventListener('input', handler);
    el.systemSoundVolume.addEventListener('change', handler);
  }

  // 标题栏窗口控件绑定（复用主程序 settings preload 的 windowControl）
  try {
    document.querySelectorAll('.win-btn').forEach((b) => {
      b.addEventListener('click', () => window.settingsAPI?.windowControl(b.dataset.act));
    });
  } catch {}
  if (el.ttsEdgeVoice) {
    const handler = () => {
      const val = (el.ttsEdgeVoice.value || '').trim();
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'ttsEdgeVoice', val);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    };
    el.ttsEdgeVoice.addEventListener('change', handler);
  }

  if (el.ttsVolume) {
    const handler = () => {
      const v = Math.max(0, Math.min(100, Number(el.ttsVolume.value || 100)));
      const norm = Math.round(v);
      (async () => {
        try {
          await window.settingsAPI?.configPluginSet?.('notify.plugin', 'ttsVolume', norm);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    };
    el.ttsVolume.addEventListener('input', handler);
    el.ttsVolume.addEventListener('change', handler);
  }
})();
