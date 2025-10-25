
// 辅助：加载本地 JSON（相对 settings.html 路径）
async function fetchJson(path) {
  const url = new URL(path, location.href).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('加载失败: ' + path);
  return await res.json();
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
          <div class="card-title">${item.name} ${versionText ? `<span class=\"pill small plugin-version\">${versionText}</span>` : ''}</div>
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

  // 非插件类型：允许点击进入详情预览
  if (!isPluginType) {
    btnInstall.disabled = false;
    btnInstall.innerHTML = '<i class="ri-eye-line"></i> 预览';
    btnInstall.addEventListener('click', () => { try { showStorePluginModal(item); } catch {} });
  }

  const setInstallButton = async () => {
    try {
      if (!isPluginType) return;
      // ZIP 安装或 NPM 安装的按钮状态
      if (!isInstalled) {
        btnInstall.disabled = false;
        btnInstall.innerHTML = '<i class="ri-download-2-line"></i> 安装';
        return;
      }
      // 已安装：若无 npm 源，则仅显示“已安装”
      if (!item.npm) {
        btnInstall.disabled = true;
        btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装';
        return;
      }
      const res = await window.settingsAPI?.npmGetVersions?.(item.npm);
      const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
      const latest = versions.length ? versions[versions.length - 1] : null;
      const installedVersion = installed?.version || null;
      if (latest && installedVersion && latest !== installedVersion) {
        btnInstall.disabled = false;
        btnInstall.innerHTML = `<i class=\"ri-refresh-line\"></i> 更新到 v${latest}`;
        btnInstall.dataset.latest = latest;
      } else {
        btnInstall.disabled = true;
        btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装';
        btnInstall.dataset.latest = '';
      }
    } catch {
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
          const dl = await window.settingsAPI?.npmDownload?.(item.npm, latest);
          if (!dl?.ok) throw new Error(dl?.error || '下载失败');
          const sw = await window.settingsAPI?.npmSwitch?.(item.id || item.name, item.npm, latest);
          if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
          await showAlert('已更新到最新版本');
        } else {
          // 若存在 ZIP 字段，走 ZIP 安装
          if (item.zip) {
            try {
              const base = await getMarketBase();
              const url = new URL(item.zip, base).toString();
              const res = await fetch(url);
              if (!res.ok) throw new Error('ZIP 下载失败');
              const buf = await res.arrayBuffer();
              const name = item.id ? `${item.id}.zip` : `${item.name || 'plugin'}.zip`;
              // 安装前检查ZIP显示依赖并确认
              try {
                const inspect = await window.settingsAPI?.inspectPluginZipData?.(name, new Uint8Array(buf));
                if (inspect?.ok) {
                  const author = (typeof inspect.author === 'object') ? (inspect.author?.name || JSON.stringify(inspect.author)) : (inspect.author || '未知作者');
                  const pluginDepends = Array.isArray(inspect.dependencies) ? inspect.dependencies : (Array.isArray(inspect.pluginDepends) ? inspect.pluginDepends : []);
                  const depsObj = (typeof inspect.npmDependencies === 'object' && inspect.npmDependencies) ? inspect.npmDependencies : null;
                  const depNames = depsObj ? Object.keys(depsObj) : [];
                  const permissions = Array.isArray(inspect.permissions) ? inspect.permissions : [];
                  const msg = `将安装：${inspect.name || item.name}\n作者：${author}\n插件依赖：${pluginDepends.length ? pluginDepends.join('，') : '无'}\nNPM依赖：${depNames.length ? depNames.join('，') : '无'}\n权限：${permissions.length ? permissions.join('，') : '无'}\n是否继续？`;
                  const ok = await showConfirm(msg);
                  if (!ok) { btnInstall.disabled = false; btnInstall.innerHTML = '<i class=\"ri-download-2-line\"></i> 安装'; return; }
                }
              } catch {}
              const out = await window.settingsAPI?.installPluginZipData?.(name, new Uint8Array(buf));
              if (!out?.ok) throw new Error(out?.error || '安装失败');
              await showAlert('安装完成');
            } catch (e) {
              throw e;
            }
          } else {
            const pkg = item.npm || item.id || item.name;
            const res = await window.settingsAPI?.installNpm?.(pkg);
            if (!res?.ok) throw new Error(res?.error || '安装失败');
            await showAlert('安装完成');
          }
        }
        const active = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.classList.contains('active'));
        active?.click?.();
        // 安装或更新成功后刷新插件管理页面（仅显示包含动作的插件）
        try {
          const container = document.getElementById('plugins');
          const list = await fetchPlugins();
          const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
          container.innerHTML = '';
          filtered.forEach((p) => container.appendChild(renderPlugin(p)));
        } catch {}
      } catch (err) {
        alert(err?.message || '操作失败');
        setInstallButton();
      }
    });
  }

  el.addEventListener('click', (evt) => {
    if (evt.target === btnInstall || btnInstall.contains(evt.target)) return;
    try { showStorePluginModal(item); } catch {}
  });
  return el;
}

function renderUpdateCard(p) {
  const el = document.createElement('div');
  el.className = 'store-card plugin-card';
  el.style.width = '100%';
  const versionText = p.version ? `v${p.version}` : '';
  const latestText = p.latest ? `v${p.latest}` : '';
  el.innerHTML = `
    <div class=\"card-header\" style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:12px;\">
      <div style=\"display:flex;gap:12px;\">
        <i class=\"${p.icon || 'ri-refresh-line'}\"></i>
        <div>
          <div class=\"card-title\">${p.name} <span class=\\\"pill small\\\">当前 ${versionText}</span> <span class=\\\"pill small primary\\\">最新 ${latestText}</span></div>
          <div class=\"card-desc\">${p.description || ''}</div>
          <div class=\"muted\">提示：该功能可更新</div>
        </div>
      </div>
      <div class=\"card-action\" style=\"flex-shrink:0;\">
        <button class=\"btn primary\"><i class=\"ri-download-2-line\"></i> 更新到 ${latestText}</button>
      </div>
    </div>
  `;
  const btn = el.querySelector('button.btn.primary');
  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true; btn.innerHTML = '<i class=\"ri-loader-4-line\"></i> 更新中...';
      const dl = await window.settingsAPI?.npmDownload?.(p.npm, p.latest);
      if (!dl?.ok) throw new Error(dl?.error || '下载失败');
      const sw = await window.settingsAPI?.npmSwitch?.(p.id || p.name, p.npm, p.latest);
      if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
      await showAlert('已更新到最新版本');
      const btnNav = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.dataset.storeTab === 'updates');
      btnNav?.click?.();
      // 更新成功后刷新插件管理页面
      try {
        const container = document.getElementById('plugins');
        const list = await fetchPlugins();
        const filtered = list.filter((pp) => Array.isArray(pp.actions) && pp.actions.length > 0);
        container.innerHTML = '';
        filtered.forEach((pp) => container.appendChild(renderPlugin(pp)));
      } catch {}
    } catch (e) {
      alert('更新失败：' + (e?.message || '未知错误'));
      btn.disabled = false; btn.innerHTML = `<i class=\"ri-download-2-line\"></i> 更新到 ${latestText}`;
    }
  });
  return el;
}