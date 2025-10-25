
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
    autostartEnabled: false,
    autostartHigh: false,
    preciseTimeEnabled: false,
    ntpServer: 'ntp.aliyun.com',
    timeOffset: 0,
    autoOffsetDaily: 0,
    offsetBaseDate: new Date().toISOString().slice(0, 10),
    semesterStart: new Date().toISOString().slice(0, 10),
    biweekOffset: false,
    marketApiBase: 'http://localhost:3030/'
  };
  await window.settingsAPI?.configEnsureDefaults('system', defaults);
  const cfg = await window.settingsAPI?.configGetAll('system');

  // 启动页与名言相关控件
  const splashEnabled = document.getElementById('splash-enabled');
  const splashQuoteEnabled = document.getElementById('splash-quote-enabled');
  splashEnabled.checked = !!cfg.splashEnabled;
  splashQuoteEnabled.checked = !!cfg.splashQuoteEnabled;
  splashEnabled.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'splashEnabled', !!splashEnabled.checked);
  });
  splashQuoteEnabled.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'splashQuoteEnabled', !!splashQuoteEnabled.checked);
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

  // 基础设置：自启动、精确时间与偏移
  const autostartEnabled = document.getElementById('autostart-enabled');
  const autostartHigh = document.getElementById('autostart-high');
  const preciseTime = document.getElementById('precise-time');
  const semesterStart = document.getElementById('semester-start');
  const biweekOffset = document.getElementById('biweek-offset');
  const timeOffset = document.getElementById('time-offset');
  const autoOffsetDaily = document.getElementById('auto-offset-daily');

  autostartEnabled.checked = !!cfg.autostartEnabled;
  autostartHigh.checked = !!cfg.autostartHigh;
  preciseTime.checked = !!cfg.preciseTimeEnabled;
  semesterStart.value = String(cfg.semesterStart || cfg.offsetBaseDate || new Date().toISOString().slice(0, 10));
  if (biweekOffset) biweekOffset.checked = !!cfg.biweekOffset;
  timeOffset.value = Number(cfg.timeOffset || 0);
  autoOffsetDaily.value = Number(cfg.autoOffsetDaily || 0);

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
  });
  if (biweekOffset) {
    biweekOffset.addEventListener('change', async () => {
      await window.settingsAPI?.configSet('system', 'biweekOffset', !!biweekOffset.checked);
    });
  }
  timeOffset.addEventListener('change', async () => {
    const val = Number(timeOffset.value || 0);
    await window.settingsAPI?.configSet('system', 'timeOffset', val);
  });
  autoOffsetDaily.addEventListener('change', async () => {
    const val = Number(autoOffsetDaily.value || 0);
    await window.settingsAPI?.configSet('system', 'autoOffsetDaily', val);
  });

  // 数据目录：显示当前路径并绑定打开/更改
  const userDataPathEl = document.getElementById('user-data-path');
  const openUserDataBtn = document.getElementById('open-user-data');
  const changeUserDataBtn = document.getElementById('change-user-data');
  if (userDataPathEl && window.settingsAPI?.getUserDataPath) {
    try {
      const p = await window.settingsAPI.getUserDataPath();
      userDataPathEl.textContent = String(p || '');
    } catch {}
  }
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
        alert('已更改数据目录。重启应用后生效。');
      } else if (res && res.error) {
        alert('更改失败：' + res.error);
      }
    });
  }
}