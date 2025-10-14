(() => {
  const el = {
    enableTTS: document.getElementById('enableTTS'),
    ttsEngine: document.getElementById('ttsEngine'),
    ttsVoice: document.getElementById('ttsVoice'),
    ttsPitch: document.getElementById('ttsPitch'),
    ttsRate: document.getElementById('ttsRate'),
    ttsEndpoint: document.getElementById('ttsEndpoint'),
    ttsEdgeVoice: document.getElementById('ttsEdgeVoice'),
    btnPlayIn: document.getElementById('btnPlayIn'),
    btnPlayOut: document.getElementById('btnPlayOut'),
    btnTestOverlayText: document.getElementById('btnTestOverlayText'),
  };

  // 初始化：从统一配置存储读取
  (async () => {
    try {
      const cfg = await window.settingsAPI?.configGetAll?.('notify');
      if (el.enableTTS) el.enableTTS.checked = !!cfg?.tts;
      if (el.ttsEngine) el.ttsEngine.value = (cfg?.ttsEngine ?? 'system');
      if (el.ttsPitch) el.ttsPitch.value = (cfg?.ttsPitch ?? 1);
      if (el.ttsRate) el.ttsRate.value = (cfg?.ttsRate ?? 1);
      if (el.ttsEndpoint) el.ttsEndpoint.value = (cfg?.ttsEndpoint ?? '');
      if (el.ttsEdgeVoice) el.ttsEdgeVoice.value = (cfg?.ttsEdgeVoice ?? '');
      // 加载语音列表
      initVoices(cfg?.ttsVoiceURI);
      // 音频存在性无需展示，运行窗口会直接使用配置中的 dataURL
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
      try { window.settingsAPI?.pluginCall?.('notify.plugin', 'overlayText', ['这是一条纯文本提示', 'fade', 2500]); } catch {}
    });
  }

  if (el.enableTTS) {
    el.enableTTS.addEventListener('change', () => {
      const enabled = !!el.enableTTS.checked;
      (async () => {
        try {
          await window.settingsAPI?.configSet?.('notify', 'tts', enabled);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    });
  }

  // 引擎选择（暂时仅 system）
  if (el.ttsEngine) {
    el.ttsEngine.value = 'system';
    el.ttsEngine.addEventListener('change', () => {
      const val = 'system';
      (async () => {
        try {
          await window.settingsAPI?.configSet?.('notify', 'ttsEngine', val);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    });
  }

  // 暂时隐藏 EdgeTTS 服务地址（无需绑定）

  // 暂时隐藏 EdgeTTS 音色名称（无需绑定）

  // 音色设置：voice, pitch, rate
  if (el.ttsVoice) {
    el.ttsVoice.addEventListener('change', () => {
      const val = el.ttsVoice.value || '';
      (async () => {
        try {
          await window.settingsAPI?.configSet?.('notify', 'ttsVoiceURI', val);
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
          await window.settingsAPI?.configSet?.('notify', 'ttsPitch', v);
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
          await window.settingsAPI?.configSet?.('notify', 'ttsRate', v);
          await window.settingsAPI?.pluginCall?.('notify.plugin', 'broadcastConfig', []);
        } catch {}
      })();
    };
    el.ttsRate.addEventListener('change', handler);
    el.ttsRate.addEventListener('input', handler);
  }

  // 标题栏窗口控件绑定（复用主程序 settings preload 的 windowControl）
  try {
    document.querySelectorAll('.win-btn').forEach((b) => {
      b.addEventListener('click', () => window.settingsAPI?.windowControl(b.dataset.act));
    });
  } catch {}
})();