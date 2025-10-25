function showPluginAboutModal(pluginItem) {
  const old = document.querySelector('.modal-overlay'); if (old) old.remove();
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const box = document.createElement('div'); box.className = 'modal-box plugin-about';
  const title = document.createElement('div'); title.className = 'modal-title';
  title.innerHTML = `<i class="${pluginItem.icon || 'ri-puzzle-line'}"></i> 关于插件 - ${pluginItem.name}`;
  const body = document.createElement('div'); body.className = 'modal-body';

  const authorText = (() => {
    const meta = pluginItem.author;
    if (!meta) return '未知';
    if (typeof meta === 'string') return meta;
    const name = meta.name || meta.username || meta.id || '';
    const link = meta.url || meta.link || meta.homepage || meta.repo || '';
    const join = link ? `<a href="${link}" target="_blank" rel="noreferrer">${name}</a>` : name;
    if (meta.email) return `${join} (${meta.email})`;
    return join || '未知';
  })();
  const versionText = pluginItem.version || pluginItem.detectedVersion || '未知版本';
  const descText = pluginItem.description || '无描述';
  const homepage = pluginItem.homepage || pluginItem.url || pluginItem.link || pluginItem.repo || '';
  const licenseText = pluginItem.license || '';

  // 基本信息卡片
  const infoGroup = document.createElement('div'); infoGroup.className = 'section';
  const infoHeader = document.createElement('div'); infoHeader.className = 'section-title';
  infoHeader.innerHTML = `<i class="ri-information-line"></i> 基本信息`;
  const metaGrid = document.createElement('div');
  metaGrid.style.display = 'grid';
  metaGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
  metaGrid.style.gap = '10px';
  metaGrid.innerHTML = `
    <div>
      <div class="muted">版本</div>
      <div><span class="pill small">${versionText}</span></div>
    </div>
    <div>
      <div class="muted">作者</div>
      <div>${authorText}</div>
    </div>
    ${homepage ? `<div><div class="muted">主页</div><div><a href="${homepage}" target="_blank" rel="noreferrer">${homepage}</a></div></div>` : ''}
    ${licenseText ? `<div><div class="muted">许可证</div><div>${licenseText}</div></div>` : ''}
  `;
  const desc = document.createElement('div');
  desc.style.marginTop = '12px';
  desc.innerHTML = `<div class="muted">描述</div><div>${descText}</div>`;
  infoGroup.appendChild(infoHeader);
  infoGroup.appendChild(metaGrid);
  infoGroup.appendChild(desc);

  // 依赖卡片
  const depsGroup = document.createElement('div'); depsGroup.className = 'section';
  const depsHeader = document.createElement('div'); depsHeader.className = 'section-title';
  depsHeader.innerHTML = `<i class="ri-box-3-line"></i> 依赖项`;
  const chips = document.createElement('div'); chips.className = 'chips';
  const deps = pluginItem.npmDependencies || pluginItem.dependencies || pluginItem.deps || null;
  if (deps && typeof deps === 'object') {
    Object.keys(deps).forEach((name) => {
      const ver = deps[name];
      const chip = document.createElement('span'); chip.className = 'chip';
      chip.textContent = `${name}${ver ? '@' + ver : ''}`;
      chips.appendChild(chip);
    });
  } else {
    const chip = document.createElement('span'); chip.className = 'chip'; chip.textContent = '无'; chips.appendChild(chip);
  }
  depsGroup.appendChild(depsHeader);
  depsGroup.appendChild(chips);

  const actions = document.createElement('div'); actions.className = 'modal-actions';
  const createBtn = document.createElement('button'); createBtn.className = 'btn'; createBtn.textContent = '创建快捷方式';
  const uninstallBtn = document.createElement('button'); uninstallBtn.className = 'btn danger'; uninstallBtn.textContent = '卸载插件';
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn secondary'; closeBtn.textContent = '关闭';

  closeBtn.onclick = () => { document.body.removeChild(overlay); };

  createBtn.onclick = async () => {
    // 与卡片上的逻辑一致：收集候选动作后进入创建流程
    const pluginId = pluginItem.id || pluginItem.name;
    const metaActions = Array.isArray(pluginItem.actions) ? pluginItem.actions.filter(a => typeof a.target === 'string' && a.target) : [];
    let eventDefs = [];
    try {
      const evRes = await window.settingsAPI?.pluginAutomationListEvents?.(pluginId);
      eventDefs = Array.isArray(evRes?.events) ? evRes.events : [];
    } catch {}
    const candidates = [];
    for (const a of metaActions) {
      candidates.push({ kind: 'meta', id: a.id || a.target, label: a.text || a.id || a.target, icon: a.icon || pluginItem.icon || 'ri-links-line', target: a.target, args: Array.isArray(a.args) ? a.args : [] });
    }
    for (const e of eventDefs) {
      candidates.push({ kind: 'event', id: e.id || e.name, label: e.name || e.id, icon: pluginItem.icon || 'ri-links-line', def: e });
    }
    if (!candidates.length) { await showAlert('该插件未定义可用于快捷方式的动作'); return; }

    let chosen = null; let params = [];
    if (candidates.length === 1) {
      chosen = candidates[0];
      if (chosen.kind === 'event' && Array.isArray(chosen.def?.params) && chosen.def.params.length) {
        const edited = await showParamsEditorForEvent(chosen.def.params, []);
        if (edited === null) return; params = edited;
      } else if (chosen.kind === 'meta') {
        params = Array.isArray(chosen.args) ? chosen.args : [];
      }
    } else {
      const sel = await showActionSelector(candidates);
      if (!sel) return;
      chosen = candidates.find(c => c.kind === sel.kind && c.id === sel.id);
      if (!chosen) return;
      if (chosen.kind === 'event' && Array.isArray(chosen.def?.params) && chosen.def.params.length) {
        const edited = await showParamsEditorForEvent(chosen.def.params, []);
        if (edited === null) return; params = edited;
      } else if (chosen.kind === 'meta') {
        params = Array.isArray(chosen.args) ? chosen.args : [];
      }
    }
    const eventName = (chosen.kind === 'meta') ? chosen.target : (chosen.def?.name || chosen.def?.id);
    const action = (chosen.kind === 'meta')
      ? { type: 'pluginAction', pluginId, target: eventName, params: Array.isArray(params) ? params : [] }
      : { type: 'pluginEvent', pluginId, event: eventName, params: Array.isArray(params) ? params : [] };
    const ok = await showShortcutCreateDialog(pluginItem, chosen, pluginId, action);
    if (ok?.res) {
      const proto = ok.res?.protocolText ? `LessonPlugin://task/${encodeURIComponent(ok.res.protocolText)}` : '';
      const msg = proto ? `已在桌面创建快捷方式\n协议：${proto}` : '已在桌面创建快捷方式';
      await showAlert(msg);
    }
  };

  uninstallBtn.onclick = async () => {
    const res = await showModal({ title: '卸载插件', message: `确认卸载插件：${pluginItem.name}？\n这将删除其目录与相关文件。`, confirmText: '卸载', cancelText: '取消' });
    if (!res) return;
    const key = pluginItem.id || pluginItem.name;
    const out = await window.settingsAPI?.uninstallPlugin?.(key);
    if (!out?.ok) { await showAlert(`卸载失败：${out?.error || '未知错误'}`); return; }
    // 关闭并刷新列表
    document.body.removeChild(overlay);
    const container = document.getElementById('plugins');
    const list = await fetchPlugins();
    container.innerHTML = ''; list.forEach((p) => container.appendChild(renderPlugin(p)));
  };

  body.appendChild(infoGroup);
  body.appendChild(depsGroup);
  box.appendChild(title);
  box.appendChild(body);
  actions.appendChild(createBtn);
  actions.appendChild(uninstallBtn);
  actions.appendChild(closeBtn);
  box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);
}


// 选择插件动作（meta actions + automation events）
async function showActionSelector(candidates) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = '选择动作';
    const body = document.createElement('div'); body.className = 'modal-body';
    const list = document.createElement('div'); list.className = 'array-list';
    let selected = null;

    candidates.forEach((c) => {
    const row = document.createElement('div'); row.className = 'action-item';
    const icon = document.createElement('i'); icon.className = c.icon || 'ri-links-line';
    const label = document.createElement('div'); label.textContent = `${c.label}`;
    label.style.flex = '1'; label.style.marginLeft = '8px';
    const kind = document.createElement('span'); kind.className = 'muted'; kind.textContent = c.kind === 'event' ? '事件' : '动作';
    kind.style.marginLeft = '8px';
    const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'actionSel';
      radio.addEventListener('change', () => { selected = { kind: c.kind, id: c.id }; });
      row.appendChild(radio); row.appendChild(icon); row.appendChild(label); row.appendChild(kind);
      list.appendChild(row);
    });

    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.className='btn secondary'; cancel.textContent='取消';
    cancel.onclick = () => { document.body.removeChild(overlay); resolve(null); };
    const ok = document.createElement('button'); ok.className='btn primary'; ok.textContent='确定';
    ok.onclick = () => { if (!selected) { return; } document.body.removeChild(overlay); resolve(selected); };
    box.appendChild(title);
    body.appendChild(list);
    box.appendChild(body);
    actions.appendChild(cancel); actions.appendChild(ok);
    box.appendChild(actions);
    overlay.appendChild(box);
  document.body.appendChild(overlay);
  });
}

