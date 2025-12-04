async function showComponentAboutModal(componentItem) {
  const old = document.querySelector('.modal-overlay'); if (old) old.remove();
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const box = document.createElement('div'); box.className = 'modal-box component-about';
  const title = document.createElement('div'); title.className = 'modal-title';
  title.innerHTML = `<i class="ri-layout-3-line"></i> 关于组件 - ${componentItem.name || componentItem.id}`;
  const body = document.createElement('div'); body.className = 'modal-body';

  const infoGroup = document.createElement('div'); infoGroup.className = 'section';
  const infoHeader = document.createElement('div'); infoHeader.className = 'section-title';
  infoHeader.innerHTML = `<i class="ri-information-line"></i> 基本信息`;
  const metaGrid = document.createElement('div');
  metaGrid.style.display = 'grid';
  metaGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
  metaGrid.style.gap = '10px';
  const groupText = componentItem.group || '未分组';
  const entryText = componentItem.entry || 'index.html';
  let entryUrl = componentItem.url;
  try { if (!entryUrl) { const res = await window.settingsAPI?.componentEntryUrl?.(componentItem.id); entryUrl = res; } } catch {}
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  let pluginMeta = null;
  try {
    const all = await window.settingsAPI?.getPlugins?.();
    const idKey = componentItem.id || componentItem.name;
    if (Array.isArray(all)) {
      const compKey = norm(idKey);
      pluginMeta = all.find(p => norm(p.id || p.name) === compKey) || null;
    }
  } catch {}
  const versionText = (pluginMeta?.version || componentItem.version || componentItem.detectedVersion || '') || '未知版本';
  const authorText = (() => {
    const a = pluginMeta?.author || componentItem.author;
    if (a === null || a === undefined) return '未知';
    if (typeof a === 'string') return a;
    if (typeof a === 'object') {
      const name = a.name || a.username || a.id || '';
      const link = a.url || a.link || a.homepage || a.repo || '';
      const join = link ? `<a href="${link}" target="_blank" rel="noreferrer">${name}</a>` : name;
      if (a.email) return `${join} (${a.email})`;
      return join || '未知';
    }
    return String(a);
  })();
  const homepage = pluginMeta?.homepage || pluginMeta?.url || pluginMeta?.link || pluginMeta?.repo || '';
  const licenseText = pluginMeta?.license || '';
  const entryUrlHtml = entryUrl ? `
    <div>
      <div class="muted">入口地址</div>
      <div class="inline">
        <button class="btn secondary" id="open-entry"><i class="ri-external-link-line"></i> 打开地址</button>
        <button class="btn" id="copy-entry"><i class="ri-file-copy-line"></i> 复制</button>
      </div>
      <div class="muted" style="word-break: break-all; overflow-wrap: anywhere; margin-top:6px;">${entryUrl}</div>
    </div>
  ` : '';
  metaGrid.innerHTML = `
    <div>
      <div class="muted">名称</div>
      <div>${componentItem.name || componentItem.id}</div>
    </div>
    <div>
      <div class="muted">插件ID</div>
      <div style="word-break: break-all; overflow-wrap: anywhere;">${pluginMeta?.id || '未知'}</div>
    </div>
    <div>
      <div class="muted">组件ID</div>
      <div style="word-break: break-all; overflow-wrap: anywhere;">${componentItem.id || '未知'}</div>
    </div>
    <div>
      <div class="muted">版本</div>
      <div><span class="pill small">${versionText}</span></div>
    </div>
    <div>
      <div class="muted">作者</div>
      <div>${authorText}</div>
    </div>
    <div>
      <div class="muted">分组</div>
      <div><span class="pill small">${groupText}</span></div>
    </div>
    ${homepage ? `<div><div class="muted">主页</div><div><a href="${homepage}" target="_blank" rel="noreferrer">${homepage}</a></div></div>` : ''}
    ${licenseText ? `<div><div class="muted">许可证</div><div>${licenseText}</div></div>` : ''}
    <div>
      <div class="muted">入口文件</div>
      <div style="word-break: break-all; overflow-wrap: anywhere;">${entryText}</div>
    </div>
    ${entryUrl ? `${entryUrlHtml}` : ''}
  `;
  infoGroup.appendChild(infoHeader);
  infoGroup.appendChild(metaGrid);

  try {
    const openBtn = metaGrid.querySelector('#open-entry');
    const copyBtn = metaGrid.querySelector('#copy-entry');
    openBtn && openBtn.addEventListener('click', () => { try { window.open(entryUrl, '_blank', 'noreferrer'); } catch {} });
    copyBtn && copyBtn.addEventListener('click', async () => { try { await navigator.clipboard.writeText(entryUrl); showToast('已复制入口地址'); } catch {} });
  } catch {}

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const uninstallBtn = document.createElement('button'); uninstallBtn.className = 'btn danger'; uninstallBtn.textContent = '卸载组件';
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn secondary'; closeBtn.textContent = '关闭';

  closeBtn.onclick = () => { document.body.removeChild(overlay); };
  uninstallBtn.onclick = async () => {
    const res = await showModal({ title: '卸载组件', message: `确认卸载组件：${componentItem.name || componentItem.id}？`, confirmText: '卸载', cancelText: '取消' });
    if (!res) return;
    const key = componentItem.id || componentItem.name;
    const out = await window.settingsAPI?.uninstallPlugin?.(key);
    if (!out?.ok) { await showAlert(`卸载失败：${out?.error || '未知错误'}`); return; }
    document.body.removeChild(overlay);
    try { await window.initComponentsPage(); } catch {}
  };

  body.appendChild(infoGroup);
  box.appendChild(title);
  box.appendChild(body);
  actions.appendChild(uninstallBtn);
  actions.appendChild(closeBtn);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}
