
// 通用设置：启动页与名言、基础设置
async function initGeneralSettings() {
  // 子夹（子页面）导航切换（限定在通用设置页面内）
  const subItems = document.querySelectorAll('#page-general .sub-item');
  const subpages = {
    splash: document.getElementById('general-splash'),
    basic: document.getElementById('general-basic'),
    time: document.getElementById('general-time'),
    data: document.getElementById('general-data')
  };
  subItems.forEach((btn) => {
    if (btn.dataset.bound === '1') return;
    btn.dataset.bound = '1';
    btn.addEventListener('click', () => {
      subItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.sub;
      for (const key of Object.keys(subpages)) {
        subpages[key].hidden = key !== page;
      }
    });
  });
  // 默认显示“基础”子页
  for (const key of Object.keys(subpages)) subpages[key].hidden = key !== 'basic';
  subItems.forEach((b) => b.classList.toggle('active', b.dataset.sub === 'basic'));

  const defaults = {
    quoteSource: 'hitokoto',
    quoteApiUrl: 'https://v1.hitokoto.cn/',
    localQuotes: [],
    splashEnabled: true,
    splashQuoteEnabled: true,
    splashBgStyle: 'default',
    splashProgramName: 'LessonPlugin',
    splashProgramDesc: '插件化大屏课堂辅助工具',
    autostartEnabled: false,
    autostartHigh: false,
    preciseTimeEnabled: false,
    ntpServer: 'ntp.aliyun.com',
    timeOffset: 0,
    autoOffsetDaily: 0,
    offsetBaseDate: new Date().toISOString().slice(0, 10),
    semesterStart: new Date().toISOString().slice(0, 10),
    biweekOffset: false,
    marketApiBase: 'http://localhost:3030/',
    timeZone: 'Asia/Shanghai'
  };
  await window.settingsAPI?.configEnsureDefaults('system', defaults);
  const cfg = await window.settingsAPI?.configGetAll('system');

  // 启动页与名言相关控件
  const splashEnabled = document.getElementById('splash-enabled');
  const splashQuoteEnabled = document.getElementById('splash-quote-enabled');
  const quoteSourceGroup = document.getElementById('quote-source-group');
  splashEnabled.checked = !!cfg.splashEnabled;
  splashQuoteEnabled.checked = !!cfg.splashQuoteEnabled;
  splashEnabled.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'splashEnabled', !!splashEnabled.checked);
    updateSplashPreview();
  });
  // 初始化来源分组显隐
  if (quoteSourceGroup) quoteSourceGroup.hidden = !cfg.splashQuoteEnabled;
  splashQuoteEnabled.addEventListener('change', async () => {
    const enabled = !!splashQuoteEnabled.checked;
    await window.settingsAPI?.configSet('system', 'splashQuoteEnabled', enabled);
    if (quoteSourceGroup) quoteSourceGroup.hidden = !enabled;
    updateSplashPreview();
  });

  const radios = document.querySelectorAll('input[name="quoteSource"]');
  const fieldApi = document.getElementById('field-api');
  const fieldLocal = document.getElementById('field-local');
  const apiUrl = document.getElementById('api-url');
  const apiTest = document.getElementById('api-test');
  const apiSample = document.getElementById('api-sample');
  const openArrayEditor = document.getElementById('open-array-editor');

  const getSelectedSource = () => document.querySelector('input[name="quoteSource"]:checked')?.value || (cfg.quoteSource || 'hitokoto');

  radios.forEach((r) => { r.checked = r.value === (cfg.quoteSource || 'hitokoto'); });
  apiUrl.value = cfg.quoteApiUrl || 'https://v1.hitokoto.cn/';
  const switchSource = (val) => {
    fieldApi.hidden = val !== 'custom';
    fieldLocal.hidden = val !== 'local';
    apiUrl.disabled = val !== 'custom';
    apiTest.disabled = val !== 'custom';
    apiSample.textContent = '';
  };
  switchSource(cfg.quoteSource || 'hitokoto');

  radios.forEach((r) => {
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      await window.settingsAPI?.configSet('system', 'quoteSource', r.value);
      switchSource(r.value);
      // 预览仅展示基础文案，不实时拉取API
      updateSplashPreview();
    });
  });

  apiUrl.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'quoteApiUrl', apiUrl.value.trim());
  });

  apiTest.addEventListener('click', async () => {
    const source = getSelectedSource();
    if (source !== 'custom') {
      apiSample.textContent = '仅在“自定义地址”模式下可测试。';
      return;
    }
    const url = apiUrl.value.trim() || 'https://v1.hitokoto.cn/';
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      const txt = (data && typeof data === 'object')
        ? (data.hitokoto ? `「${data.hitokoto}」—— ${data.from || ''}`
          : (data.text ? `「${data.text}」—— ${data.from || ''}`
            : JSON.stringify(data)))
        : String(data);
      apiSample.textContent = txt;
    } catch (e) {
      apiSample.textContent = '获取失败，请检查API地址或网络。';
    }
  });

  openArrayEditor.addEventListener('click', async () => {
    const modal = document.getElementById('array-modal');
    const listEl = document.getElementById('array-list');
    const addBtn = document.getElementById('array-add');
    const importInput = document.getElementById('array-import');
    const saveBtn = document.getElementById('array-save');
    const cancelBtn = document.getElementById('array-cancel');

    const renderItems = (items) => {
      listEl.innerHTML = '';
      items.forEach((val, idx) => {
        const row = document.createElement('div');
        row.className = 'array-item';
        // 文本列
        const inputText = document.createElement('input');
        inputText.type = 'text';
        inputText.placeholder = '文本';
        inputText.value = typeof val === 'string' ? val : (val?.text || '');
        inputText.addEventListener('change', () => {
          const current = items[idx];
          items[idx] = typeof current === 'object' ? { ...current, text: inputText.value } : { text: inputText.value, from: '' };
        });
        // 来源列
        const inputFrom = document.createElement('input');
        inputFrom.type = 'text';
        inputFrom.placeholder = '来源';
        inputFrom.value = typeof val === 'object' ? (val?.from || '') : '';
        inputFrom.addEventListener('change', () => {
          const current = items[idx];
          items[idx] = typeof current === 'object' ? { ...current, from: inputFrom.value } : { text: inputText.value, from: inputFrom.value };
        });
        const del = document.createElement('button');
        del.innerHTML = '<i class="ri-delete-bin-line"></i> 删除';
        del.addEventListener('click', () => { items.splice(idx, 1); renderItems(items); });
        row.appendChild(inputText);
        row.appendChild(inputFrom);
        row.appendChild(del);
        listEl.appendChild(row);
      });
    };

    // 每次打开从配置读取最新值，避免保存后无效的问题
    const latest = await window.settingsAPI?.configGet('system', 'localQuotes');
    let items = Array.isArray(latest) ? [...latest] : [];
    renderItems(items);

    addBtn.onclick = () => { items.push({ text: '', from: '' }); renderItems(items); };
    importInput.onchange = () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length);
        items = lines.map((line) => {
          const parts = line.split(/[\|\t]/);
          const t = (parts[0] || '').trim();
          const f = (parts[1] || '').trim();
          return { text: t, from: f };
        });
        renderItems(items);
      };
      reader.readAsText(file, 'utf-8');
    };
    saveBtn.onclick = async () => {
      await window.settingsAPI?.configSet('system', 'localQuotes', items);
      // 更新内存中的cfg以便再次打开时显示最新
      cfg.localQuotes = items;
      modal.hidden = true;
    };
    cancelBtn.onclick = () => { modal.hidden = true; };

    modal.hidden = false;
  });

  // 启动页样式：背景风格（单选按钮组）、程序名称与描述 + 内嵌预览
  const splashBgStyleRadios = Array.from(document.querySelectorAll('input[name="splashBgStyle"]'));
  const splashProgramName = document.getElementById('splash-program-name');
  const splashProgramDesc = document.getElementById('splash-program-desc');
  const splashPreviewFrame = document.getElementById('splash-preview-frame');

  // 初始化背景风格选中状态
  const initStyle = String(cfg.splashBgStyle || 'default');
  if (splashBgStyleRadios && splashBgStyleRadios.length) {
    let matched = false;
    splashBgStyleRadios.forEach(r => {
      if (r.value === initStyle) { r.checked = true; matched = true; }
    });
    if (!matched) {
      const def = splashBgStyleRadios.find(r => r.value === 'default');
      if (def) def.checked = true;
    }
  }
  if (splashProgramName) splashProgramName.value = String(cfg.splashProgramName || 'LessonPlugin');
  if (splashProgramDesc) splashProgramDesc.value = String(cfg.splashProgramDesc || '插件化大屏课堂辅助工具');

  async function updateSplashPreview() {
    try {
      const frame = splashPreviewFrame;
      if (!frame || !frame.contentWindow || !frame.contentWindow.document) return;
      const doc = frame.contentWindow.document;
      const root = doc.documentElement; // <html>
      const body = doc.body;
      const brandTitle = doc.querySelector('.brand h1');
      const brandSub = doc.querySelector('.brand .subtitle');
      const quoteEl = doc.getElementById('quote');

      const name = splashProgramName?.value?.trim() || 'LessonPlugin';
      const desc = splashProgramDesc?.value?.trim() || '插件化大屏课堂辅助工具';
      const quoteEnabled = !!(document.getElementById('splash-quote-enabled')?.checked);
      const style = getSelectedBgStyle();

      if (brandTitle) brandTitle.textContent = name;
      if (brandSub) brandSub.textContent = desc;
      if (quoteEl) {
        quoteEl.style.display = quoteEnabled ? '' : 'none';
      }

      // 根据风格设置CSS变量与背景
      const setVars = (vars) => {
        Object.entries(vars || {}).forEach(([k, v]) => root.style.setProperty(k, v));
      };
      if (style === 'blue') {
        setVars({ '--bg': '#0b1733', '--fg': '#e6f0ff', '--muted': '#a8c0ff', '--accent': '#3b82f6', '--btn-primary': '#1d4ed8', '--btn-secondary': '#1e3a8a' });
        if (body) body.style.background = 'radial-gradient(900px 520px at 50% -200px, #0a1342, var(--bg))';
      } else if (style === 'black') {
        setVars({ '--bg': '#000000', '--fg': '#f0f0f0', '--muted': '#bdbdbd', '--accent': '#22c55e', '--btn-primary': '#374151', '--btn-secondary': '#1f2937' });
        if (body) body.style.background = 'var(--bg)';
      } else {
        // 默认沿用 splash.css 定义
        setVars({ '--bg': '#071a12', '--fg': '#d7f3e5', '--muted': '#9bd6b8', '--accent': '#22c55e', '--btn-primary': '#15803d', '--btn-secondary': '#14532d' });
        if (body) body.style.background = 'radial-gradient(900px 520px at 50% -200px, #0b2a1d, var(--bg))';
      }

      // 预览语句：根据当前来源设置请求并渲染（非阻塞）
      if (quoteEnabled) {
        try { renderPreviewQuoteFromSource(doc, name); } catch {}
      }
    } catch (e) {
      // 静默预览错误
    }
  }

  if (splashPreviewFrame) {
    if (!window.__splashPreviewLoadBound__) {
      splashPreviewFrame.addEventListener('load', () => updateSplashPreview());
      window.__splashPreviewLoadBound__ = true;
    }
    // 如果 iframe 已经加载完成（用户直接进入该子页），也立即应用样式设定
    try {
      const ready = splashPreviewFrame.contentWindow?.document?.readyState;
      if (ready === 'interactive' || ready === 'complete') {
        updateSplashPreview();
      }
    } catch {}
  }

  // 背景风格变更监听（单选按钮组）
  if (splashBgStyleRadios && splashBgStyleRadios.length) {
    splashBgStyleRadios.forEach(radio => {
      radio.addEventListener('change', async () => {
        const val = getSelectedBgStyle();
        await window.settingsAPI?.configSet('system', 'splashBgStyle', val);
        updateSplashPreview();
      });
    });
  }
  if (splashProgramName) {
    splashProgramName.addEventListener('change', async () => {
      await window.settingsAPI?.configSet('system', 'splashProgramName', splashProgramName.value.trim());
      updateSplashPreview();
    });
  }
  if (splashProgramDesc) {
    splashProgramDesc.addEventListener('change', async () => {
      await window.settingsAPI?.configSet('system', 'splashProgramDesc', splashProgramDesc.value.trim());
      updateSplashPreview();
    });
  }

  // 刷新语句按钮：强制重新获取并更新预览
  const splashRefreshBtn = document.getElementById('splash-refresh-quote');
  if (splashRefreshBtn) {
    splashRefreshBtn.addEventListener('click', async () => {
      const frame = splashPreviewFrame;
      if (!frame || !frame.contentWindow || !frame.contentWindow.document) return;
      const doc = frame.contentWindow.document;
      const name = splashProgramName?.value?.trim() || 'LessonPlugin';
      await renderPreviewQuoteFromSource(doc, name, true);
    });
  }

  // 实际获取语句并更新预览中的 quote 元素
  async function renderPreviewQuoteFromSource(doc, programName, force) {
    try {
      const quoteEnabled = !!(document.getElementById('splash-quote-enabled')?.checked);
      if (!quoteEnabled) return;
      const source = getSelectedSource();
      const quoteEl = doc.getElementById('quote');
      if (!quoteEl) return;
      if (source === 'hitokoto') {
        const url = 'https://v1.hitokoto.cn/';
        const resp = await fetch(url, { cache: 'no-store' });
        const data = await resp.json();
        const txt = `「${data.hitokoto}」—— ${data.from || ''}`;
        quoteEl.textContent = txt || `「正在启动…」—— ${programName}`;
      } else if (source === 'engquote') {
        const url = 'https://api.limeasy.cn/engquote/';
        const resp = await fetch(url, { cache: 'no-store' });
        const data = await resp.json();
        const en = String(data?.text || '');
        const cn = String(data?.chinese || '');
        const rawOrigin = String(data?.source || data?.subject || '').trim();
        const originNormalized = rawOrigin && rawOrigin.toLowerCase() !== 'null' ? rawOrigin : '';
        const typeNum = Number(data?.type || 0);
        const aiNote = typeNum === 1 ? '（英文为AI翻译）' : (typeNum === 2 ? '（中文为AI翻译）' : '');
        quoteEl.innerHTML = `
          <div class="quote-en">「${en}」</div>
          ${cn ? `<div class="quote-cn">【译】${cn}</div>` : ''}
          ${aiNote ? `<div class="quote-note">${aiNote}</div>` : ''}
          ${originNormalized ? `<div class="quote-origin">${originNormalized}</div>` : ''}
        `;
      } else if (source === 'custom') {
        const url = (apiUrl?.value?.trim()) || 'https://v1.hitokoto.cn/';
        const resp = await fetch(url, { cache: 'no-store' });
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
        quoteEl.textContent = txt || `「正在启动…」—— ${programName}`;
      } else {
        const list = Array.isArray(cfg.localQuotes) ? cfg.localQuotes : [];
        const pick = list.length ? list[Math.floor(Math.random() * list.length)] : { text: '', from: '' };
        const txt = typeof pick === 'string' ? pick : `「${pick.text || ''}」—— ${pick.from || ''}`;
        quoteEl.textContent = txt || `「正在启动…」—— ${programName}`;
      }
    } catch (e) {
      const quoteEl = doc.getElementById('quote');
      if (quoteEl) quoteEl.textContent = `「正在启动…」—— ${programName}`;
    }
  }

  // 获取当前选中的背景风格（单选按钮组）
  function getSelectedBgStyle() {
    const radios = splashBgStyleRadios || [];
    for (const r of radios) { if (r.checked) return r.value || 'default'; }
    return 'default';
  }

  // 基础设置：自启动、精确时间与偏移
  const autostartEnabled = document.getElementById('autostart-enabled');
  const autostartHigh = document.getElementById('autostart-high');
  const preciseTime = document.getElementById('precise-time');
  const semesterStart = document.getElementById('semester-start');
  const biweekOffset = document.getElementById('biweek-offset');
  const timeOffset = document.getElementById('time-offset');
  const autoOffsetDaily = document.getElementById('auto-offset-daily');
  const currentTimeSummary = document.getElementById('current-time-summary');
  const currentOffsetSummary = document.getElementById('current-offset-summary');
  const currentSemesterSummary = document.getElementById('current-semester-summary');

  autostartEnabled.checked = !!cfg.autostartEnabled;
  autostartHigh.checked = !!cfg.autostartHigh;
  preciseTime.checked = !!cfg.preciseTimeEnabled;
  semesterStart.value = String(cfg.semesterStart || cfg.offsetBaseDate || new Date().toISOString().slice(0, 10));
  if (biweekOffset) biweekOffset.checked = !!cfg.biweekOffset;
  timeOffset.value = Number(cfg.timeOffset || 0);
  autoOffsetDaily.value = Number(cfg.autoOffsetDaily || 0);

  // 时间与日期：实时展示与计算逻辑
  const tzInput = document.getElementById('time-zone');
  if (tzInput) {
    tzInput.value = String(cfg.timeZone || 'Asia/Shanghai');
    tzInput.addEventListener('change', async () => {
      const val = String(tzInput.value || '').trim() || 'Asia/Shanghai';
      await window.settingsAPI?.configSet('system', 'timeZone', val);
      cfg.timeZone = val;
      updateTimeSummaries();
    });
  }

  const formatDateTime = (d) => {
    try {
      const tz = String(cfg.timeZone || 'Asia/Shanghai');
      const parts = new Intl.DateTimeFormat('zh-CN', {
        timeZone: tz,
        hour12: false,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      }).formatToParts(d);
      const get = (t) => parts.find(p => p.type === t)?.value || '';
      const y = get('year');
      const m = get('month');
      const day = get('day');
      const hh = get('hour');
      const mm = get('minute');
      const ss = get('second');
      return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
    } catch {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const hh = String(d.getHours()).padStart(2, '0');
      const mm = String(d.getMinutes()).padStart(2, '0');
      const ss = String(d.getSeconds()).padStart(2, '0');
      return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
    }
  };
  // 使用统一接口从主进程获取当前时间与偏移（preciseTime/NTP/每日偏移均已应用）
  const updateTimeSummaries = async () => {
    try {
      const info = await window.settingsAPI?.getCurrentTime?.(); // { nowMs, iso, offsetSec, daysFromBase }
      const adj = new Date(Number(info?.nowMs || Date.now()));
      const total = Number(info?.offsetSec || 0);
      const days = Number(info?.daysFromBase || 0);
      const weekIndex = Math.floor(days / 7) + 1; // 周序号：从1开始
      let isEven = Math.floor(days / 7) % 2 === 0; // 第0周视为双周
      if (biweekOffset?.checked) isEven = !isEven;
      const parity = isEven ? '双周' : '单周';
      if (currentTimeSummary) currentTimeSummary.textContent = formatDateTime(adj);
      if (currentOffsetSummary) currentOffsetSummary.textContent = `偏移 ${total >= 0 ? '+' : ''}${total}s`;
      if (currentSemesterSummary) currentSemesterSummary.textContent = `第 ${weekIndex} 周（${parity}），已开学 ${days} 天`;
    } catch {
      const now = new Date();
      if (currentTimeSummary) currentTimeSummary.textContent = formatDateTime(now);
      if (currentOffsetSummary) currentOffsetSummary.textContent = '偏移 —';
      if (currentSemesterSummary) currentSemesterSummary.textContent = '—';
    }
  };
  // 初始化与定时刷新（避免重复定时器）
  try { if (window.__timeSummaryTimer__) { clearInterval(window.__timeSummaryTimer__); } } catch {}
  updateTimeSummaries();
  window.__timeSummaryTimer__ = setInterval(updateTimeSummaries, 1000);

  // NTP服务器地址绑定
  const ntpServer = document.getElementById('ntp-server');
  if (ntpServer) {
    ntpServer.value = String(cfg.ntpServer || 'ntp.aliyun.com');
    ntpServer.addEventListener('change', async () => {
      const val = String(ntpServer.value || '').trim() || 'ntp.aliyun.com';
      await window.settingsAPI?.configSet('system', 'ntpServer', val);
    });
  }

  // 在线服务地址绑定与测试
  const marketApiUrl = document.getElementById('market-api-url');
  const marketApiTest = document.getElementById('market-api-test');
  const marketApiSample = document.getElementById('market-api-sample');
  if (marketApiUrl) {
    marketApiUrl.value = String(cfg.serviceBase || cfg.marketApiBase || 'http://localhost:3030/');
    marketApiUrl.addEventListener('change', async () => {
      const val = String(marketApiUrl.value || '').trim() || 'http://localhost:3030/';
      await window.settingsAPI?.configSet('system', 'serviceBase', val);
    });
  }
  if (marketApiTest) {
    marketApiTest.addEventListener('click', async () => {
      const base = String(marketApiUrl?.value || '').trim() || 'http://localhost:3030/';
      try {
        const url = new URL('/api/market/catalog', base).toString();
        const resp = await fetch(url);
        if (!resp.ok) throw new Error('failed');
        const data = await resp.json();
        const count = (Array.isArray(data.plugins) ? data.plugins.length : 0)
          + (Array.isArray(data.automation) ? data.automation.length : 0)
          + (Array.isArray(data.components) ? data.components.length : 0);
        marketApiSample.textContent = `连接成功，可用条目共 ${count} 个`;
      } catch {
        marketApiSample.textContent = '连接失败，请检查地址或服务是否启动。';
      }
    });
  }

  // 清理用户数据：提示确认后调用主进程删除用户数据目录
  const cleanupBtn = document.getElementById('cleanup-user-data');
  if (cleanupBtn) {
    cleanupBtn.addEventListener('click', async () => {
      const confirmed = window.confirm('确认删除所有插件与配置等用户数据？此操作不可恢复。');
      if (!confirmed) return;
      const res = await window.settingsAPI?.cleanupUserData?.();
      if (res?.ok) {
        alert('已清理用户数据。您现在可以从系统中卸载应用。');
      } else {
        alert('清理失败：' + (res?.error || '未知错误'));
      }
    });
  }

  autostartEnabled.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'autostartEnabled', !!autostartEnabled.checked);
    await window.settingsAPI?.setAutostart?.(!!autostartEnabled.checked, !!autostartHigh.checked);
  });
  autostartHigh.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'autostartHigh', !!autostartHigh.checked);
    await window.settingsAPI?.setAutostart?.(!!autostartEnabled.checked, !!autostartHigh.checked);
  });
  preciseTime.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'preciseTimeEnabled', !!preciseTime.checked);
  });
  semesterStart.addEventListener('change', async () => {
    const val = String(semesterStart.value || '').slice(0, 10);
    await window.settingsAPI?.configSet('system', 'semesterStart', val);
    updateTimeSummaries();
  });
  if (biweekOffset) {
    biweekOffset.addEventListener('change', async () => {
      await window.settingsAPI?.configSet('system', 'biweekOffset', !!biweekOffset.checked);
      updateTimeSummaries();
    });
  }
  timeOffset.addEventListener('change', async () => {
    const val = Number(timeOffset.value || 0);
    await window.settingsAPI?.configSet('system', 'timeOffset', val);
    updateTimeSummaries();
  });
  autoOffsetDaily.addEventListener('change', async () => {
    const val = Number(autoOffsetDaily.value || 0);
    await window.settingsAPI?.configSet('system', 'autoOffsetDaily', val);
    updateTimeSummaries();
  });

  // 数据目录：显示当前路径并绑定打开/更改
  const userDataPathEl = document.getElementById('user-data-path');
  const openUserDataBtn = document.getElementById('open-user-data');
  const changeUserDataBtn = document.getElementById('change-user-data');
  const userDataSizeEl = document.getElementById('user-data-size');
  const formatBytes = (num) => {
    const n = Number(num || 0);
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let i = 0; let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
  };
  const refreshUserDataSize = async () => {
    if (!userDataSizeEl) return;
    try {
      const res = await window.settingsAPI?.getUserDataSize?.();
      const bytes = (res && typeof res === 'object') ? Number(res.bytes || 0) : Number(res || 0);
      userDataSizeEl.textContent = formatBytes(bytes);
    } catch { userDataSizeEl.textContent = '—'; }
  };
  if (userDataPathEl && window.settingsAPI?.getUserDataPath) {
    try {
      const p = await window.settingsAPI.getUserDataPath();
      userDataPathEl.textContent = String(p || '');
    } catch {}
  }
  // 初始化数据目录大小（延后到空闲阶段，避免点击卡顿）
  try {
    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(() => { try { refreshUserDataSize(); } catch {} }, { timeout: 1000 });
    } else {
      setTimeout(() => { try { refreshUserDataSize(); } catch {} }, 0);
    }
  } catch { refreshUserDataSize(); }
  if (openUserDataBtn) {
    openUserDataBtn.addEventListener('click', async () => {
      try { await window.settingsAPI?.openUserData?.(); } catch {}
    });
  }
  if (changeUserDataBtn) {
    changeUserDataBtn.addEventListener('click', async () => {
      const res = await window.settingsAPI?.changeUserData?.();
      if (res?.ok) {
        const p = await window.settingsAPI?.getUserDataPath?.();
        if (userDataPathEl) userDataPathEl.textContent = String(p || '');
        await refreshUserDataSize();
        alert('已更改数据目录。重启应用后生效。');
      } else if (res && res.error) {
        alert('更改失败：' + res.error);
      }
    });
  }
  // 清理后刷新占用大小
  if (cleanupBtn) {
    cleanupBtn.addEventListener('click', async () => {
      // 原逻辑在上方，此处仅在成功后追加刷新
      try { await refreshUserDataSize(); } catch {}
    });
  }
}
