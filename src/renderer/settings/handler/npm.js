(() => {
  const installedEl = document.getElementById('npm-installed');
  const versionsEl = document.getElementById('npm-versions');
  const searchInput = document.getElementById('npm-search-input');
  const searchBtn = document.getElementById('npm-search-btn');

  async function renderInstalled() {
    installedEl.innerHTML = '加载已安装模块...';
    const res = await window.settingsAPI?.npmListInstalled();
    if (!res?.ok) {
      installedEl.innerHTML = `<div class="panel">获取失败：${res?.error || '未知错误'}</div>`;
      return;
    }
    const { packages } = res;
    installedEl.innerHTML = '';
    packages.forEach((pkg) => {
      const div = document.createElement('div');
      div.className = 'pkg';
      div.innerHTML = `
        <div class="pkg-header">
          <div class="pkg-name"><i class="ri-box-3-line"></i> ${pkg.name}</div>
          <div class="count">${pkg.versions.length} 个版本</div>
          <div class="spacer"></div>
          <button class="btn danger small" data-act="delete">删除</button>
        </div>
        <div class="versions">${pkg.versions.map(v => `<span class="pill">v${v}</span>`).join(' ')}</div>
        <div class="pkg-actions" hidden></div>
      `;
      const delBtn = div.querySelector('button[data-act="delete"]');
      const actions = div.querySelector('.pkg-actions');
      delBtn.addEventListener('click', async () => {
        const name = pkg.name;
        actions.hidden = false;
        actions.innerHTML = '正在加载占用信息...';
        const usesRes = await window.settingsAPI?.npmModuleUsers?.(name);
        const usedMap = new Map();
        if (usesRes?.ok && Array.isArray(usesRes.users)) {
          usesRes.users.forEach(u => {
            if (u.version) usedMap.set(String(u.version), (usedMap.get(String(u.version)) || 0) + 1);
          });
        }
        actions.innerHTML = `
          <div class="inline" style="gap:8px;align-items:center;margin-top:8px;">
            <span class="muted">选择要删除的版本：</span>
            ${pkg.versions.map(v => {
              const used = usedMap.has(String(v));
              const hint = used ? `（被${usedMap.get(String(v))}个插件占用）` : '';
              return `<label class="inline" style="gap:6px;">
                <input type="checkbox" name="ver" value="${v}" ${used ? 'disabled' : ''} />
                <span>v${v} ${hint}</span>
              </label>`;
            }).join(' ')}
            <div class="spacer"></div>
            <button class="btn secondary small" data-act="cancel">取消</button>
            <button class="btn danger small" data-act="confirm">确认删除</button>
          </div>
        `;
        const cancelBtn = actions.querySelector('button[data-act="cancel"]');
        const confirmBtn = actions.querySelector('button[data-act="confirm"]');
        cancelBtn.addEventListener('click', () => { actions.hidden = true; actions.innerHTML = ''; });
        confirmBtn.addEventListener('click', async () => {
          const selected = Array.from(actions.querySelectorAll('input[name="ver"]:checked')).map(i => i.value);
          if (!selected.length) { await showAlert('请至少选择一个可删除的版本'); return; }
          const rmRes = await window.settingsAPI?.npmRemove?.(name, selected);
          if (!rmRes?.ok) {
            await showAlert(`删除失败：${rmRes?.error || (rmRes?.errors?.[0]?.error) || '未知错误'}`);
            return;
          }
          if (rmRes.blocked?.length) {
            await showAlert(`以下版本当前被插件占用，未删除：${rmRes.blocked.join('，')}`);
          }
          if (rmRes.removed?.length) {
            await showToast(`已删除版本：${rmRes.removed.join('，')}`);
          }
          actions.hidden = true; actions.innerHTML = '';
          await renderInstalled();
        });
      });
      installedEl.appendChild(div);
    });
  }

  async function renderVersions(name) {
    versionsEl.innerHTML = '';
    const res = await window.settingsAPI?.npmGetVersions?.(name);
    if (!res?.ok) {
      versionsEl.innerHTML = `<div class="panel">获取版本失败：${res?.error || '未知错误'}</div>`;
      return;
    }
    const { versions } = res;
    if (!Array.isArray(versions) || versions.length === 0) {
      versionsEl.innerHTML = `<div class="muted">未查询到版本</div>`;
      return;
    }
    versionsEl.innerHTML = `<div class="muted">找到 ${versions.length} 个版本，点击下载所需版本</div>`;
    const grid = document.createElement('div');
    grid.className = 'versions-grid';
    grid.style.display = 'flex';
    grid.style.flexWrap = 'wrap';
    grid.style.gap = '8px';
    versions.forEach(v => {
      const pill = document.createElement('button');
      pill.className = 'btn small';
      pill.textContent = `v${v}`;
      pill.addEventListener('click', async () => {
        const ok = await showConfirm(`下载 ${name}@${v} 吗？`);
        if (!ok) return;
        try {
          const progressModal = showProgressModal('下载/安装进度', `准备下载 ${name}@${v} ...`);
          const handler = (payload) => {
            try {
              if (payload && String(payload.stage).toLowerCase() === 'npm') {
                const msg = String(payload.message || '');
                if (msg.includes(`${name}@${v}`) || msg.includes(name)) {
                  progressModal.update(payload);
                }
              }
            } catch {}
          };
          const unsubscribe = window.settingsAPI?.onProgress?.(handler);
          const dl = await window.settingsAPI?.npmDownload?.(name, v);
          try { unsubscribe && unsubscribe(); } catch {}
          try { progressModal?.close?.(); } catch {}
          if (!dl?.ok) {
            await showAlert(`下载失败：${dl?.error || '未知错误'}`);
            return;
          }
          await showToast(`已下载 ${name}@${v}`);
          await renderInstalled();
        } catch (e) { await showAlert(`下载异常：${e?.message || String(e)}`); }
      });
      grid.appendChild(pill);
    });
    versionsEl.appendChild(grid);
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', async () => {
      const name = searchInput?.value?.trim();
      if (!name) { await showAlert('请输入 NPM 包名'); return; }
      await renderVersions(name);
    });
  }

  window.renderInstalled = renderInstalled;
  window.renderVersions = renderVersions;

  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav?.dataset.page === 'npm') {
    renderInstalled();
  }
})();
