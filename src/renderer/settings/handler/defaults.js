async function initDefaultsPage() {
  const listEl = document.getElementById('defaults-list');
  const emptyEl = document.getElementById('defaults-empty');
  if (!listEl) return;
  listEl.innerHTML = '';
  try {
    const res = await window.settingsAPI?.behaviorsList?.();
    const actions = (res?.ok && Array.isArray(res.actions)) ? res.actions : [];
    const defaults = await window.settingsAPI?.behaviorsGetDefaults?.();
    if (!actions.length) { emptyEl.hidden = false; return; }
    emptyEl.hidden = true;
    for (const act of actions) {
      const card = document.createElement('div');
      card.className = 'plugin-card';
      const providers = Array.isArray(act.providers) ? act.providers : [];
      const currentPid = defaults?.[act.id] || (providers.length === 1 ? providers[0]?.pluginId : '');
      const current = providers.find(p => p.pluginId === currentPid) || null;
      const chosenText = current ? `${current.pluginName} · ${current.target}` : (providers.length > 1 ? '未选择' : (providers[0] ? `${providers[0].pluginName} · ${providers[0].target}` : '无提供者'));
      const header = `
        <div class="card-header">
          <i class="ri-flag-2-line"></i>
          <div>
            <div class="card-title">${act.id}</div>
            <div class="card-desc">当前：${chosenText}</div>
          </div>
        </div>
      `;
      card.innerHTML = header;
      card.addEventListener('click', async () => {
        if (!providers.length) { await showAlert('无可选提供者'); return; }
        const sel = await showProvidersSelectModal(act.id, providers, currentPid);
        if (!sel) return;
        const r = await window.settingsAPI?.behaviorsSetDefault?.(act.id, sel);
        if (r?.ok) {
          await showToast('已更新默认行为', { type: 'success', duration: 1200 });
          await initDefaultsPage();
        } else {
          await showAlert(`保存失败：${r?.error || '未知错误'}`);
        }
      });
      listEl.appendChild(card);
    }
  } catch {}
}

async function showProvidersSelectModal(actionId, providers, currentPid) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = `选择默认提供者 — ${actionId}`;
    const body = document.createElement('div'); body.className = 'modal-body';
    const grid = document.createElement('div'); grid.className = 'plugins';
    providers.forEach((p) => {
      const card = document.createElement('div');
      card.className = 'plugin-card';
      const header = `
        <div class="card-header">
          <i class="${p.icon || 'ri-puzzle-line'}"></i>
          <div>
            <div class="card-title">${p.pluginName}</div>
            <div class="card-desc">函数 ${p.target}</div>
          </div>
        </div>
      `;
      card.innerHTML = header;
      if (p.pluginId === currentPid) { try { card.style.outline = '2px solid var(--primary,#4caf50)'; } catch {} }
      card.addEventListener('click', () => { document.body.removeChild(overlay); resolve(p.pluginId); });
      grid.appendChild(card);
    });
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.className = 'btn secondary'; cancel.textContent = '取消';
    cancel.addEventListener('click', () => { document.body.removeChild(overlay); resolve(null); });
    box.appendChild(title);
    body.appendChild(grid);
    box.appendChild(body);
    actions.appendChild(cancel);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

window.initDefaultsPage = initDefaultsPage;
