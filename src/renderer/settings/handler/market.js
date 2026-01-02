
// 辅助：加载本地 JSON（相对 settings.html 路径）
async function fetchJson(path) {
  const url = new URL(path, location.href).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('加载失败: ' + path);
  return await res.json();
}

const compareVersions = (v1, v2) => {
  const p1 = String(v1 || '0').split('.').map(x => parseInt(x) || 0);
  const p2 = String(v2 || '0').split('.').map(x => parseInt(x) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
};

// 自动安装 NPM 依赖的函数（与 modals/market.js 中的函数保持一致）
async function autoInstallNpmDependencies(dependencies, options = {}) {
  const { silent = false, onProgress = null } = options;
  
  if (!dependencies || typeof dependencies !== 'object' || !Object.keys(dependencies).length) {
    return { ok: true, installed: [], skipped: [], errors: [] };
  }

  const results = {
    ok: true,
    installed: [],
    skipped: [],
    errors: []
  };

  try {
    const installedPkgs = await window.settingsAPI?.npmListInstalled?.();
    const installedList = (installedPkgs?.ok && Array.isArray(installedPkgs.packages)) ? installedPkgs.packages : [];
    const hasPkg = (name) => installedList.some(p => p.name === name && Array.isArray(p.versions) && p.versions.length);

    const missing = Object.keys(dependencies).filter(name => !hasPkg(name));
    
    if (!missing.length) {
      if (!silent) {
        onProgress && onProgress({ stage: 'npm', message: '所有 NPM 依赖已安装' });
      }
      return results;
    }

    if (!silent) {
      onProgress && onProgress({ stage: 'npm', message: `开始自动安装 ${missing.length} 个 NPM 依赖...` });
    }

    for (const name of missing) {
      try {
        if (!silent) {
          onProgress && onProgress({ stage: 'npm', message: `正在获取 ${name} 的版本信息...` });
        }

        const verRes = await window.settingsAPI?.npmGetVersions?.(name);
        const versions = (verRes?.ok && Array.isArray(verRes.versions)) ? verRes.versions : [];
        
        if (!versions.length) {
          results.errors.push({ name, error: '无可用版本' });
          results.ok = false;
          continue;
        }

        const latestVersion = versions[versions.length - 1];
        
        if (!silent) {
          onProgress && onProgress({ stage: 'npm', message: `正在下载 ${name}@${latestVersion}...` });
        }

        const dl = await window.settingsAPI?.npmDownload?.(name, latestVersion);
        
        if (!dl?.ok) {
          results.errors.push({ name, error: dl?.error || '下载失败' });
          results.ok = false;
        } else {
          results.installed.push({ name, version: latestVersion });
          if (!silent) {
            onProgress && onProgress({ stage: 'npm', message: `已安装 ${name}@${latestVersion}` });
          }
        }
      } catch (e) {
        results.errors.push({ name, error: e?.message || '未知错误' });
        results.ok = false;
      }
    }

    if (!silent && results.installed.length) {
      onProgress && onProgress({ 
        stage: 'npm', 
        message: `自动安装完成：${results.installed.length} 个依赖已安装${results.errors.length ? `，${results.errors.length} 个失败` : ''}` 
      });
    }

  } catch (e) {
    results.ok = false;
    results.errors.push({ name: 'system', error: e?.message || '系统错误' });
  }

  return results;
}

function renderStoreCard(item, installedList) {
  const el = document.createElement('div');
  el.className = 'store-card plugin-card';
  const versionText = item.version ? `v${item.version}` : '';
  const authorText = (() => {
    const a = item.author;
    if (!a) return '未知作者';
    if (typeof a === 'string') return a;
    if (typeof a === 'object') return a.name || JSON.stringify(a);
    return String(a);
  })();
  const pkg = item.npm || item.id || item.name;
  el.innerHTML = `
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="display:flex;gap:12px;">
        <i class="${item.icon || 'ri-puzzle-line'}"></i>
        <div>
          <div class="card-title">${item.name} ${versionText ? `<span class="pill small plugin-version">${versionText}</span>` : ''}</div>
          <div class="card-desc">${item.description || ''}</div>
          <div class="muted">作者：${authorText}</div>
        </div>
      </div>
      <div class="card-action" style="flex-shrink:0;">
        <button class="btn primary" data-action="install"><i class="ri-download-2-line"></i> 安装</button>
      </div>
    </div>
  `;
  const btnInstall = el.querySelector('button[data-action="install"]');
  const isPluginType = (item.type || 'plugin') === 'plugin';
  const installed = Array.isArray(installedList) ? installedList.find((p) => (
    (item.id && (p.id === item.id)) ||
    (item.name && (p.name === item.name)) ||
    (item.npm && (p.npm === item.npm))
  )) : null;
  const isInstalled = !!installed;

  if (!isPluginType) {
    btnInstall.disabled = false;
    const hasNpmSource = !!item.npm;
    btnInstall.innerHTML = hasNpmSource ? '<i class="ri-download-2-line"></i> 安装' : '<i class="ri-eye-line"></i> 预览';
    btnInstall.addEventListener('click', () => { try { showStorePluginModal(item); } catch (e) {} });
  }

  const setInstallButton = async () => {
    try {
      if (!isPluginType) return;
      if (!isInstalled) {
        btnInstall.disabled = false;
        btnInstall.innerHTML = '<i class="ri-download-2-line"></i> 安装';
        return;
      }
      
      // 1. 优先检查市场版本更新
      if (item.version && installed.version && compareVersions(item.version, installed.version) > 0) {
        btnInstall.disabled = false;
        btnInstall.innerHTML = `<i class="ri-refresh-line"></i> 更新到 v${item.version}`;
        btnInstall.dataset.latest = item.version;
        return;
      }

      // 2. 检查 NPM 更新
      if (item.npm) {
        const res = await window.settingsAPI?.npmGetVersions?.(item.npm);
        const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
        const latest = versions.length ? versions[versions.length - 1] : null;
        const installedVersion = installed?.version || null;
        if (latest && installedVersion && latest !== installedVersion) {
          btnInstall.disabled = false;
          btnInstall.innerHTML = `<i class="ri-refresh-line"></i> 更新到 v${latest}`;
          btnInstall.dataset.latest = latest;
          return;
        }
      }

      // 3. 已安装且无更新
      btnInstall.disabled = true;
      btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装';
      btnInstall.dataset.latest = '';
    } catch (e) {
      btnInstall.disabled = isInstalled;
      btnInstall.innerHTML = isInstalled ? '<i class="ri-checkbox-circle-line"></i> 已安装' : '<i class="ri-download-2-line"></i> 安装';
    }
  };

  if (isPluginType) {
    setInstallButton();
    btnInstall.addEventListener('click', async () => {
      try {
        const latest = btnInstall.dataset.latest;
        btnInstall.disabled = true; btnInstall.innerHTML = '<i class="ri-loader-4-line"></i> 处理中...';
        if (latest) {
          // 若存在 ZIP 且版本匹配，优先 ZIP 更新
          if (item.zip && compareVersions(item.version, latest) === 0) {
             const base = await getMarketBase();
             const url = new URL(item.zip, base).toString();
             const res = await fetch(url);
             if (!res.ok) throw new Error('ZIP 下载失败');
             const buf = await res.arrayBuffer();
             const name = item.name || item.id || 'plugin';
             
             let inspect = null;
             try { inspect = await window.settingsAPI?.inspectPluginZipData?.(name, new Uint8Array(buf)); } catch (e) {}
             
             const enrichedItem = {
                 ...item,
                 id: inspect?.id || item.id || name,
                 name: name,
                 author: (typeof inspect?.author === 'object') ? (inspect.author?.name || JSON.stringify(inspect.author)) : (inspect?.author || item.author),
                 dependencies: Array.isArray(inspect?.dependencies) ? inspect.dependencies : (Array.isArray(item?.dependencies) ? item.dependencies : []),
                 npmDependencies: (inspect && typeof inspect.npmDependencies === 'object' && !Array.isArray(inspect.npmDependencies) && inspect.npmDependencies) ? inspect.npmDependencies : (typeof item?.npmDependencies === 'object' && !Array.isArray(item.npmDependencies) ? item.npmDependencies : null)
             };
             const success = await window.unifiedPluginInstall({ kind: 'zipData', item: enrichedItem, zipName: name, zipData: new Uint8Array(buf) });
             if (!success) { setInstallButton(); return; }
          } else {
             // NPM 更新
             const dl = await window.settingsAPI?.npmDownload?.(item.npm, latest);
             if (!dl?.ok) throw new Error(dl?.error || '下载失败');
             const sw = await window.settingsAPI?.npmSwitch?.(item.id || item.name, item.npm, latest);
             if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
             await showAlert('已更新到最新版本');
          }
        } else {
          // 安装逻辑
          let success = false;
          if (item.zip) {
              const base = await getMarketBase();
              const url = new URL(item.zip, base).toString();
              const res = await fetch(url);
              if (!res.ok) throw new Error('ZIP 下载失败');
              const buf = await res.arrayBuffer();
              const name = item.name ? item.name : (item.id ? item.id : 'plugin');
              let inspect = null;
              try { inspect = await window.settingsAPI?.inspectPluginZipData?.(name, new Uint8Array(buf)); } catch (e) {}
              const enrichedItem = {
                 ...item,
                 id: inspect?.id || item.id || name,
                 name: name,
                 author: (typeof inspect?.author === 'object') ? (inspect.author?.name || JSON.stringify(inspect.author)) : (inspect?.author || item.author),
                 dependencies: Array.isArray(inspect?.dependencies) ? inspect.dependencies : (Array.isArray(item?.dependencies) ? item.dependencies : []),
                 npmDependencies: (inspect && typeof inspect.npmDependencies === 'object' && !Array.isArray(inspect.npmDependencies) && inspect.npmDependencies) ? inspect.npmDependencies : (typeof item?.npmDependencies === 'object' && !Array.isArray(item.npmDependencies) ? item.npmDependencies : null)
              };
              success = await window.unifiedPluginInstall({ kind: 'zipData', item: enrichedItem, zipName: name, zipData: new Uint8Array(buf) });
          } else {
              success = await window.unifiedPluginInstall({ kind: 'npm', item, pkg: item.npm || item.id || item.name });
          }
          if (!success) { setInstallButton(); return; }
        }
        
        // 刷新逻辑
        const active = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.classList.contains('active'));
        active?.click?.();
        try {
          const container = document.getElementById('plugins');
          const list = await fetchPlugins();
          const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
          container.innerHTML = '';
          filtered.forEach((p) => container.appendChild(renderPlugin(p)));
        } catch (e) {}
      } catch (err) {
        alert(err?.message || '操作失败');
        setInstallButton();
      }
    });
  }

  el.addEventListener('click', (evt) => {
    if (evt.target === btnInstall || btnInstall.contains(evt.target)) return;
    try { showStorePluginModal(item); } catch (e) {}
  });
  return el;
}

window.publishResource = async (type, item) => {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const box = document.createElement('div'); box.className = 'modal-box'; box.style.width = '400px';
  const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = '发布资源到市场';
  const body = document.createElement('div'); body.className = 'modal-body';
  body.innerHTML = `
    <div style="margin-bottom:16px;">
      <div class="muted" style="margin-bottom:8px;">资源：${item.name || item.id} (${type})</div>
      <div class="muted" style="margin-bottom:8px;">ID：${item.id}</div>
      <div class="muted" style="margin-bottom:16px;">版本：${item.version || '1.0.0'}</div>
      <input type="password" id="pub-pass" placeholder="管理员密码" style="width:100%; padding:8px; border:1px solid var(--border); background:var(--bg); color:var(--fg); border-radius:4px; box-sizing:border-box;">
    </div>
    <div style="display:flex; justify-content:flex-end; gap:8px;">
      <button class="btn secondary" id="pub-cancel">取消</button>
      <button class="btn primary" id="pub-confirm">发布</button>
    </div>
  `;
  box.appendChild(title); box.appendChild(body); overlay.appendChild(box); document.body.appendChild(overlay);
  return new Promise((resolve) => {
    const close = () => { try { overlay.remove(); } catch (e) {} resolve(false); };
    overlay.querySelector('#pub-cancel').onclick = close;
    overlay.querySelector('#pub-confirm').onclick = async () => {
      const pass = overlay.querySelector('#pub-pass').value;
      const btn = overlay.querySelector('#pub-confirm');
      btn.disabled = true; btn.textContent = '发布中...';
      try {
        let zipBuf = null;
        let metadata = { ...item };
        metadata.type = type;
        if (!metadata.id) metadata.id = item.name;
        if (!metadata.version) metadata.version = '1.0.0';
        if (type === 'automation') {
          const res = await window.settingsAPI?.packAutomation?.(item.id);
          if (!res?.ok || !res.zipData) throw new Error(res?.error || '打包失败');
          zipBuf = res.zipData;
        } else {
          const res = await window.settingsAPI?.packPlugin?.(item.id || item.name);
          if (!res?.ok || !res.zipData) throw new Error(res?.error || '打包失败');
          zipBuf = res.zipData;
        }
        const formData = new FormData();
        const blob = new Blob([zipBuf], { type: 'application/zip' });
        formData.append('file', blob, 'resource.zip');
        formData.append('metadata', JSON.stringify(metadata));
        formData.append('adminPassword', pass);
        const base = await getMarketBase();
        const url = new URL('/api/dev/publish', base).toString();
        const res = await fetch(url, { method: 'POST', body: formData });
        const json = await res.json();
        if (!res.ok || !json.ok) throw new Error(json.error || '发布失败');
        await showAlert('发布成功！');
        close();
      } catch (e) {
        await showAlert('错误：' + e.message);
        btn.disabled = false; btn.textContent = '发布';
      }
    };
  });
};

function renderUpdateCard(p) {
  const el = document.createElement('div');
  el.className = 'store-card plugin-card';
  el.style.width = '100%';
  const versionText = p.version ? `v${p.version}` : '';
  const latestText = p.latest ? `v${p.latest}` : '';
  el.innerHTML = `
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="display:flex;gap:12px;">
        <i class="${p.icon || 'ri-refresh-line'}"></i>
        <div>
          <div class="card-title">${p.name} <span class="pill small">当前 ${versionText}</span> <span class="pill small primary">最新 ${latestText}</span></div>
          <div class="card-desc">${p.description || ''}</div>
          <div class="muted">提示：该功能可更新</div>
        </div>
      </div>
      <div class="card-action" style="flex-shrink:0;">
        <button class="btn primary"><i class="ri-download-2-line"></i> 更新到 ${latestText}</button>
      </div>
    </div>
  `;
  const btn = el.querySelector('button.btn.primary');
  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true; btn.innerHTML = '<i class="ri-loader-4-line"></i> 更新中...';
      
      // 优先使用 ZIP 更新（若存在）
      if (p.zip) {
        const base = await getMarketBase();
        const url = new URL(p.zip, base).toString();
        const res = await fetch(url);
        if (!res.ok) throw new Error('ZIP 下载失败');
        const buf = await res.arrayBuffer();
        const name = p.name || p.id;
        // 复用统一安装逻辑
        const success = await window.unifiedPluginInstall({ kind: 'zipData', item: p, zipName: name, zipData: new Uint8Array(buf) });
        if (!success) {
          btn.disabled = false; btn.innerHTML = `<i class="ri-download-2-line"></i> 更新到 ${latestText}`;
          return;
        }
      } else if (p.npm) {
        // NPM 更新逻辑
        const dl = await window.settingsAPI?.npmDownload?.(p.npm, p.latest);
        if (!dl?.ok) throw new Error(dl?.error || '下载失败');
        const sw = await window.settingsAPI?.npmSwitch?.(p.id || p.name, p.npm, p.latest);
        if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
        await showAlert('已更新到最新版本');
      } else {
        throw new Error('未找到更新源');
      }

      const btnNav = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.dataset.storeTab === 'updates');
      btnNav?.click?.();
      // 更新成功后刷新插件管理页面
      try {
        const container = document.getElementById('plugins');
        const list = await fetchPlugins();
        const filtered = list.filter((pp) => Array.isArray(pp.actions) && pp.actions.length > 0);
        container.innerHTML = '';
        filtered.forEach((pp) => container.appendChild(renderPlugin(pp)));
      } catch (e) {}
    } catch (e) {
      alert('更新失败：' + (e?.message || '未知错误'));
      btn.disabled = false; btn.innerHTML = `<i class="ri-download-2-line"></i> 更新到 ${latestText}`;
    }
  });
  return el;
}
