const statusEl = document.getElementById('status');
const quoteEl = document.getElementById('quote');
const closeBtn = document.getElementById('close-splash');
const timerEl = document.getElementById('timer');
const timerRemainEl = document.getElementById('timer-remaining');

// 同步关闭控制：必须“程序加载完成”与“名言倒计时结束”同时满足才关闭
let loadFinished = false;
let quoteCountdownDone = false;
let countdownStarted = false;
let countdownEndAt = null;
let countdownInterval = null;

function maybeClose() {
  if (!window.splashAPI) return; // 静态预览下不执行关闭
  if (loadFinished && quoteCountdownDone) {
    window.splashAPI.windowControl('close');
  }
}

function startQuoteCountdownFromText(text) {
  if (countdownStarted) return;
  countdownStarted = true;
  const len = String(text || '').replace(/\s+/g, '').length;
  const durationMs = Math.max(0, len * 200); // 每字0.2秒
  // 启动倒计时（加载期间也在跑）
  countdownEndAt = Date.now() + durationMs;
  const update = () => {
    if (!countdownEndAt) return;
    const remainMs = Math.max(0, countdownEndAt - Date.now());
    const remainSec = Math.ceil(remainMs / 1000);
    if (timerRemainEl) timerRemainEl.textContent = String(remainSec);
    if (remainMs <= 0) {
      try { clearInterval(countdownInterval); } catch {}
      countdownInterval = null;
    }
  };
  if (durationMs > 0) {
    update();
    countdownInterval = setInterval(update, 250);
  }
  // 如果加载已完成，此时开始倒计时应立即显示倒计时UI
  if (loadFinished && timerEl) {
    timerEl.style.display = 'inline-flex';
  }
  if (durationMs === 0) {
    quoteCountdownDone = true;
    maybeClose();
  } else {
    setTimeout(() => {
      quoteCountdownDone = true;
      maybeClose();
    }, durationMs);
  }
}

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
    // 不显示名言时，不进行倒计时，视为立即完成
    quoteCountdownDone = true;
    maybeClose();
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
      if (showQuote) startQuoteCountdownFromText(txt);
    } else {
      const list = (await window.splashAPI.configGet('system', 'localQuotes')) || [];
      const pick = Array.isArray(list) && list.length ? list[Math.floor(Math.random() * list.length)] : { text: '', from: '' };
      const txt = typeof pick === 'string' ? pick : `「${pick.text || ''}」—— ${pick.from || ''}`;
      if (showQuote && quoteEl) quoteEl.textContent = txt;
      await window.splashAPI.configSet('system', 'lastQuote', txt);
      if (showQuote) startQuoteCountdownFromText(txt);
    }
  } catch (e) {
    const last = await window.splashAPI.configGet('system', 'lastQuote');
    if (showQuote && quoteEl) quoteEl.textContent = last || '「正在启动…」—— LessonPlugin';
    if (showQuote) startQuoteCountdownFromText(quoteEl?.textContent || '');
  }
}

// 当通过静态服务器预览时，没有splashAPI，提供模拟状态
if (window.splashAPI) {
  // 始终可手动隐藏窗口
  if (closeBtn) {
    closeBtn.onclick = () => window.splashAPI.windowControl('hide');
    // 加载完成前不显示关闭按钮
    closeBtn.style.display = 'none';
  }
  window.splashAPI.onProgress((payload) => {
    const { stage, message } = payload || {};
    console.log('splash progress:', stage, message);
    setStatus(stage || 'info', String(message || ''));
    if (stage === 'done') {
      // 程序加载完成，等待名言倒计时结束后关闭
      loadFinished = true;
      // 加载完成后显示关闭按钮
      if (closeBtn) closeBtn.style.display = 'inline-flex';
      // 在加载完成时显示已在进行的倒计时（如果有）
      if (timerEl && countdownStarted) {
        timerEl.style.display = 'inline-flex';
      }
      maybeClose();
    }
  });
}

loadQuote();