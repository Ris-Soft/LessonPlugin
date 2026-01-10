window.initComponentsPage = async function initComponentsPage() {
  if (window.__componentsInitRunning) return;
  window.__componentsInitRunning = true;
  const container = document.getElementById('components-list');
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const createCard = (c) => {
    const el = document.createElement('div');
    el.className = 'plugin-card';
    el.innerHTML = `
      <div class="card-header">
        <i class="ri-layout-3-line"></i>
        <div>
          <div class="card-title">
            ${c.name || c.id} 
            <span class="pill small">${c.group || '未分组'}</span>
            ${c.sourcePlugin ? '<span class="pill small" style="background:rgba(var(--color-primary-rgb), 0.1);color:var(--color-primary);">由插件提供</span>' : ''}
          </div>
          <div class="card-desc" style="word-break: break-all; overflow-wrap: anywhere;">入口：${c.entry || 'index.html'}</div>
        </div>
      </div>
      <div class="card-actions">
        <div class="actions-left">
          <button class="action-btn preview-btn"><i class="ri-eye-line"></i> 预览</button>
        </div>
        <div class="actions-right">
          <button class="icon-btn about-btn" title="关于组件"><i class="ri-information-line"></i></button>
          ${!c.sourcePlugin ? '<button class="icon-btn uninstall-btn" title="卸载"><i class="ri-delete-bin-line"></i></button>' : ''}
        </div>
      </div>
    `;
    const btn = el.querySelector('.preview-btn');
    btn.addEventListener('click', async () => {
      try {
        const url = c.url || (await window.settingsAPI?.componentEntryUrl?.(c.id));
        if (!url) { await showAlert('未找到组件入口'); return; }
        const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
        const box = document.createElement('div'); box.className = 'modal-box'; box.style.maxWidth = '860px';
        const title = document.createElement('div'); title.className = 'modal-title';
        title.innerHTML = `<span><i class="ri-layout-3-line"></i> 预览组件 — ${c.name || c.id}</span>`;
        const closeBtn = document.createElement('button'); closeBtn.className = 'btn secondary'; closeBtn.innerHTML = '<i class="ri-close-line"></i>';
        closeBtn.addEventListener('click', () => { try { overlay.remove(); } catch (e) {} });
        title.appendChild(closeBtn);
        try { title.style.justifyContent = 'space-between'; } catch (e) {}
        const body = document.createElement('div'); body.className = 'modal-body';
        const frame = document.createElement('iframe'); frame.style.width = '100%'; frame.style.height = '480px'; frame.src = url; frame.title = '组件预览';
        body.appendChild(frame);
        box.appendChild(title); box.appendChild(body); overlay.appendChild(box); document.body.appendChild(overlay);
      } catch (e) {}
    });
    const aboutBtn = el.querySelector('.about-btn');
    aboutBtn?.addEventListener('click', () => {
      try { showComponentAboutModal(c); } catch (e) {}
    });
    const uninstallBtn = el.querySelector('.uninstall-btn');
    uninstallBtn?.addEventListener('click', async () => {
      const ok = await showConfirm(`卸载组件：${c.name || c.id}？`);
      if (!ok) return;
      const out = await window.settingsAPI?.uninstallPlugin?.(c.id);
      if (!out?.ok) { await showAlert(`卸载失败：${out?.error || '未知错误'}`); return; }
      showToast(`已卸载组件：${c.name || c.id}`, { type: 'success', duration: 2000 });
      await refresh();
    });
    if (window.__isDev__) {
      const publishBtn = document.createElement('button');
      publishBtn.className = 'icon-btn publish-btn';
      publishBtn.title = '发布到市场';
      publishBtn.innerHTML = '<i class="ri-upload-cloud-2-line"></i>';
      publishBtn.addEventListener('click', () => {
        window.publishResource && window.publishResource('component', c);
      });
      el.querySelector('.actions-right').appendChild(publishBtn);
    }
    return el;
  };
  const refresh = async () => {
    window.__componentsRefreshId = (window.__componentsRefreshId || 0) + 1;
    const rid = window.__componentsRefreshId;
    container.innerHTML = '';
    const res = await window.settingsAPI?.componentsList?.('');
    const list = (res?.ok && Array.isArray(res.components)) ? res.components : [];
    const uniq = [];
    const seenId = new Set();
    const seenUrl = new Set();
    const seenDisplay = new Set();
    for (const c of list) {
      const idKey = norm(c.id || c.name || '');
      const urlKey = norm(c.url || '');
      const displayKey = `${String(c.name || '').trim().toLowerCase()}|${String(c.group || '').trim().toLowerCase()}`;
      if (!idKey && !urlKey) continue;
      if (idKey && seenId.has(idKey)) continue;
      if (urlKey && seenUrl.has(urlKey)) continue;
      if (displayKey && seenDisplay.has(displayKey)) continue;
      if (idKey) seenId.add(idKey);
      if (urlKey) seenUrl.add(urlKey);
      if (displayKey) seenDisplay.add(displayKey);
      uniq.push(c);
    }
    uniq.sort((a, b) => {
      const ga = String(a.group || '').toLowerCase();
      const gb = String(b.group || '').toLowerCase();
      if (ga !== gb) return ga < gb ? -1 : 1;
      const na = String(a.name || a.id || '').toLowerCase();
      const nb = String(b.name || b.id || '').toLowerCase();
      return na < nb ? -1 : (na > nb ? 1 : 0);
    });
    if (rid !== window.__componentsRefreshId) return;
    uniq.forEach((c) => container.appendChild(createCard(c)));
  };
  try { await refresh(); } finally { window.__componentsInitRunning = false; }
};
