const statusEl = document.getElementById('status');
const quoteEl = document.getElementById('quote');
const closeBtn = document.getElementById('close-splash');

function setStatus(stage, message) {
  if (!statusEl) return;
  statusEl.innerHTML = `<span class="stage">[${stage}]</span> ${message}`;
}

async function loadQuote() {
  // 静态预览环境下没有 splashAPI，直接跳过获取逻辑
  if (!window.splashAPI) return;
  // 默认值确保
  await window.splashAPI.configEnsureDefaults('system', {
    quoteSource: 'hitokoto',
    quoteApiUrl: 'https://v1.hitokoto.cn/',
    localQuotes: [],
    splashQuoteEnabled: true
  });
  const showQuote = (await window.splashAPI.configGet('system', 'splashQuoteEnabled')) !== false;
  if (!showQuote && quoteEl) {
    quoteEl.style.display = 'none';
  }
  const source = (await window.splashAPI.configGet('system', 'quoteSource')) || 'hitokoto';
  try {
    if (source === 'hitokoto') {
      const url = (await window.splashAPI.configGet('system', 'quoteApiUrl')) || 'https://v1.hitokoto.cn/';
      const resp = await fetch(url);
      const data = await resp.json();
      const txt = `「${data.hitokoto}」—— ${data.from || ''}`;
      if (showQuote && quoteEl) quoteEl.textContent = txt;
      await window.splashAPI.configSet('system', 'lastQuote', txt);
    } else {
      const list = (await window.splashAPI.configGet('system', 'localQuotes')) || [];
      const pick = Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : { text: '', from: '' };
      const txt = typeof pick === 'string' ? pick : `「${pick.text || ''}」—— ${pick.from || ''}`;
      if (showQuote && quoteEl) quoteEl.textContent = txt;
      await window.splashAPI.configSet('system', 'lastQuote', txt);
    }
  } catch (e) {
    const last = await window.splashAPI.configGet('system', 'lastQuote');
    if (showQuote && quoteEl) quoteEl.textContent = last || '「正在启动…」—— LessonPlugin';
  }
}

// 当通过静态服务器预览时，没有splashAPI，提供模拟状态
if (window.splashAPI) {
  // 始终可手动隐藏窗口
  if (closeBtn) closeBtn.onclick = () => window.splashAPI.windowControl('hide');
  window.splashAPI.onProgress((payload) => {
    const { stage, message } = payload || {};
    console.log('splash progress:', stage, message);
    setStatus(stage || 'info', String(message || ''));
    if (stage === 'done') {
      // 根据名言字数计算延时；无文字或短文字时快速关闭
      const quoteText = (quoteEl?.textContent || '').replace(/\s+/g, '');
      const disabled = quoteEl && quoteEl.style.display === 'none';
      const visible = !disabled;
      const len = visible ? quoteText.length : 0;
      const delayMs = len > 0 ? Math.min(Math.max(len * 120, 600), 4000) : 600;
      setTimeout(() => window.splashAPI.windowControl('close'), delayMs);
    }
  });
}

loadQuote();