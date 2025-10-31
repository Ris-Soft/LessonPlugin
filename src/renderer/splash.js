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
  const clean = String(text || '').replace(/\s+/g, '');
  let english = 0, chinese = 0, other = 0;
  for (const ch of clean) {
    if (/[A-Za-z]/.test(ch)) english++;
    else if (/[\u4e00-\u9fff]/.test(ch)) chinese++;
    else other++;
  }
  const durationMs = Math.max(0, english * 120 + chinese * 200 + other * 200);
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
    splashQuoteEnabled: true,
    splashBgStyle: 'default',
    splashProgramName: 'LessonPlugin',
    splashProgramDesc: '插件化大屏课堂辅助工具'
  });
  // 应用程序名称与描述、背景样式
  try {
    const name = (await window.splashAPI.configGet('system', 'splashProgramName')) || 'LessonPlugin';
    const desc = (await window.splashAPI.configGet('system', 'splashProgramDesc')) || '插件化大屏课堂辅助工具';
    const style = (await window.splashAPI.configGet('system', 'splashBgStyle')) || 'default';
    const brandTitle = document.querySelector('.brand h1');
    const brandSub = document.querySelector('.brand .subtitle');
    if (brandTitle) brandTitle.textContent = String(name || 'LessonPlugin');
    if (brandSub) brandSub.textContent = String(desc || '插件化大屏课堂辅助工具');
    const root = document.documentElement;
    const body = document.body;
    const setVars = (vars) => { Object.entries(vars || {}).forEach(([k, v]) => root.style.setProperty(k, v)); };
    if (style === 'blue') {
      setVars({ '--bg': '#0b1733', '--fg': '#e6f0ff', '--muted': '#a8c0ff', '--accent': '#3b82f6', '--btn-primary': '#1d4ed8', '--btn-secondary': '#1e3a8a' });
      if (body) body.style.background = 'radial-gradient(900px 520px at 50% -200px, #0a1342, var(--bg))';
    } else if (style === 'black') {
      setVars({ '--bg': '#000000', '--fg': '#f0f0f0', '--muted': '#bdbdbd', '--accent': '#22c55e', '--btn-primary': '#374151', '--btn-secondary': '#1f2937' });
      if (body) body.style.background = 'var(--bg)';
    } else {
      setVars({ '--bg': '#071a12', '--fg': '#d7f3e5', '--muted': '#9bd6b8', '--accent': '#22c55e', '--btn-primary': '#15803d', '--btn-secondary': '#14532d' });
      if (body) body.style.background = 'radial-gradient(900px 520px at 50% -200px, #0b2a1d, var(--bg))';
    }
  } catch {}
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
    } else if (source === 'engquote') {
      const url = 'https://api.limeasy.cn/engquote/';
      const resp = await fetch(url);
      const data = await resp.json();
      const en = String(data?.text || '');
      const cn = String(data?.chinese || '');
      const rawOrigin = String(data?.source || data?.subject || '').trim();
      const originNormalized = rawOrigin && rawOrigin.toLowerCase() !== 'null' ? rawOrigin : '';
      const typeNum = Number(data?.type || 0);
      const aiNote = typeNum === 1 ? '（英文为AI翻译）' : (typeNum === 2 ? '（中文为AI翻译）' : '');
      const plain = `「${en}」${cn ? `\n【译】${cn}` : ''}${aiNote ? `\n${aiNote}` : ''}${originNormalized ? `\n${originNormalized}` : ''}`;
      if (showQuote && quoteEl) {
        quoteEl.innerHTML = `
          <div class="quote-en">「${en}」</div>
          ${cn ? `<div class=\"quote-cn\">【译】${cn}</div>` : ''}
          ${aiNote ? `<div class=\"quote-note\">${aiNote}</div>` : ''}
          ${originNormalized ? `<div class=\"quote-origin\">${originNormalized}</div>` : ''}
        `;
      }
      await window.splashAPI.configSet('system', 'lastQuote', plain);
      if (showQuote) startQuoteCountdownFromText(`${en} ${cn}`);
    } else if (source === 'custom') {
      const url = (await window.splashAPI.configGet('system', 'quoteApiUrl')) || 'https://v1.hitokoto.cn/';
      const resp = await fetch(url);
      let txt = '';
      try {
        const data = await resp.json();
        if (data && typeof data === 'object') {
          if (data.hitokoto) txt = `「${data.hitokoto}」—— ${data.from || ''}`;
          else if (data.text) txt = `「${data.text}」—— ${data.from || ''}`;
          else txt = JSON.stringify(data);
        } else {
          txt = String(data);
        }
      } catch {
        txt = await resp.text();
      }
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