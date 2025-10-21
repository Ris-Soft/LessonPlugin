function showStorePluginModal(item) {
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const box = document.createElement('div'); box.className = 'modal-box market-plugin';
  const title = document.createElement('div'); title.className = 'modal-title';
  const body = document.createElement('div'); body.className = 'modal-body';

  const versionText = item.version ? `v${item.version}` : '未知版本';
  const authorText = (() => {
    const a = item.author;
    if (!a) return '未知作者';
    if (typeof a === 'string') return a;
    if (typeof a === 'object') return a.name || JSON.stringify(a);
    return String(a);
  })();

  title.style.display = 'flex';
  title.style.justifyContent = 'space-between';
  title.style.alignItems = 'center';
  title.innerHTML = `<span><i class="${item.icon || 'ri-puzzle-line'}"></i> 插件详情 — ${item.name} <span class=\"pill small plugin-version\">${versionText}</span></span>`;
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn secondary'; closeBtn.innerHTML = '<i class="ri-close-line"></i>';
  closeBtn.addEventListener('click', () => { try { overlay.remove(); } catch {} });
  title.appendChild(closeBtn);

  const depsObj = (item && typeof item.dependencies === 'object' && item.dependencies) ? item.dependencies : null;
  const depsKeys = depsObj ? Object.keys(depsObj) : [];
  const depsHtml = depsKeys.length
    ? depsKeys.slice(0, 6).map(k => `<span class=\"pill small\">${k}</span>`).join(' ') + (depsKeys.length > 6 ? ` <span class=\"pill small muted\">+${depsKeys.length - 6}</span>` : '')
    : '<span class=\"muted\">无依赖</span>';

  const readmeBox = document.createElement('div'); readmeBox.className = 'modal-readme';
  readmeBox.style.overflowX = 'hidden';
  readmeBox.style.wordBreak = 'break-word';
  readmeBox.style.whiteSpace = 'normal';
  readmeBox.innerHTML = '<div class=\"muted\">加载说明文档...</div>';

  body.innerHTML = `
    <div class=\"setting-item\">
      <div class=\"setting-icon\"><i class=\"${item.icon || 'ri-puzzle-line'}\"></i></div>
      <div class=\"setting-main\">
        <div class=\"setting-title\">${item.name}</div>
        <div class=\"setting-desc\">作者：${authorText}</div>
      </div>
      <div class=\"setting-action\"></div>
    </div>
    <br>
    <div class=\"section-title\"><i class=\"ri-git-repository-line\"></i> 依赖</div>
    <div>${depsHtml}</div>
    <div class=\"section-title\" style=\"margin-top:12px;\"><i class=\"ri-file-text-line\"></i> 插件说明</div>
  `;
  body.appendChild(readmeBox);

  // 组合按钮（安装/已安装/更新） + 卸载：放在信息卡右侧操作区
  const actionBox = body.querySelector('.setting-action');
  const actionBtn = document.createElement('button'); actionBtn.className = 'btn primary'; actionBtn.innerHTML = '<i class=\"ri-download-2-line\"></i> 安装';
  const uninstallBtn = document.createElement('button'); uninstallBtn.className = 'btn danger'; uninstallBtn.innerHTML = '<i class=\"ri-delete-bin-line\"></i> 卸载';
  const isInstalled = !!item.local || !!item.version;
  if (isInstalled) actionBox.appendChild(uninstallBtn);
  actionBox.appendChild(actionBtn);

  const setActionButton = async () => {
    if (!isInstalled) { actionBtn.disabled = false; actionBtn.innerHTML = '<i class=\"ri-download-2-line\"></i> 安装'; actionBtn.dataset.action = 'install'; return; }
    if (!item.npm) { actionBtn.disabled = true; actionBtn.innerHTML = '<i class=\"ri-checkbox-circle-line\"></i> 已安装'; actionBtn.dataset.action = 'installed'; return; }
    try {
      const res = await window.settingsAPI?.npmGetVersions?.(item.npm);
      const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
      const latest = versions.length ? versions[versions.length - 1] : null;
      if (latest && item.version && latest !== item.version) {
        actionBtn.disabled = false; actionBtn.innerHTML = `<i class=\"ri-refresh-line\"></i> 更新到 v${latest}`; actionBtn.dataset.action = 'update'; actionBtn.dataset.latest = latest;
      } else {
        actionBtn.disabled = true; actionBtn.innerHTML = '<i class=\"ri-checkbox-circle-line\"></i> 已安装'; actionBtn.dataset.action = 'installed';
      }
    } catch {
      actionBtn.disabled = true; actionBtn.innerHTML = '<i class=\"ri-checkbox-circle-line\"></i> 已安装'; actionBtn.dataset.action = 'installed';
    }
  };
  setActionButton();

  actionBtn.addEventListener('click', async () => {
    const action = actionBtn.dataset.action;
    try {
      actionBtn.disabled = true; actionBtn.innerHTML = '<i class=\"ri-loader-4-line\"></i> 处理中...';
      if (action === 'install') {
        const key = item.id || item.name;
        const res = await window.settingsAPI?.installNpm?.(key);
        if (!res?.ok) throw new Error(res?.error || '安装失败');
        await showAlert('安装完成');
      } else if (action === 'update') {
        const latest = actionBtn.dataset.latest;
        const dl = await window.settingsAPI?.npmDownload?.(item.npm, latest);
        if (!dl?.ok) throw new Error(dl?.error || '下载失败');
        const sw = await window.settingsAPI?.npmSwitch?.(item.id || item.name, item.npm, latest);
        if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
        await showAlert('已更新到最新版本');
      }
      try { overlay.remove(); } catch {}
      const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.dataset.page === 'plugins');
      btn?.click?.();
    } catch (e) {
      await showAlert('操作失败：' + (e?.message || '未知错误'));
      setActionButton();
    }
  });

  uninstallBtn.addEventListener('click', async () => {
    try {
      const res = await showModal({ title: '卸载插件', message: `确认卸载插件：${item.name}？\n这将删除其目录与相关文件。`, confirmText: '卸载', cancelText: '取消' });
      if (!res) return;
      uninstallBtn.disabled = true; uninstallBtn.innerHTML = '<i class=\"ri-loader-4-line\"></i> 卸载中...';
      const key = item.id || item.name;
      const out = await window.settingsAPI?.uninstallPlugin?.(key);
      if (!out?.ok) throw new Error(out?.error || '卸载失败');
      await showAlert('已卸载');
      try { overlay.remove(); } catch {}
      const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.dataset.page === 'plugins');
      btn?.click?.();
    } catch (e) {
      await showAlert('卸载失败：' + (e?.message || '未知错误'));
      uninstallBtn.disabled = false; uninstallBtn.innerHTML = '<i class=\"ri-delete-bin-line\"></i> 卸载';
    }
  });

  overlay.appendChild(box);
  box.appendChild(title);
  box.appendChild(body);
  document.body.appendChild(overlay);

  (async () => {
    try {
      const key = item.id || item.name;
      const md = await window.settingsAPI?.getPluginReadme?.(key);
      const html = md ? renderMarkdown(md) : renderMarkdown(item.description || '暂无说明');
      readmeBox.innerHTML = html;
    } catch {
      readmeBox.innerHTML = renderMarkdown(item.description || '暂无说明');
    }
  })();
}