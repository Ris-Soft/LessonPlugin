async function showPluginAboutModal(pluginItem) {
  const old = document.querySelector('.modal-overlay'); if (old) old.remove();
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const box = document.createElement('div'); box.className = 'modal-box plugin-about';
  const title = document.createElement('div'); title.className = 'modal-title';
  title.innerHTML = `<i class="${pluginItem.icon || 'ri-puzzle-line'}"></i> 关于插件 - ${pluginItem.name}`;
  const body = document.createElement('div'); body.className = 'modal-body';

  const authorText = (() => {
    const a = pluginItem.author;
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
      <div class="muted">插件名称</div>
      <div>${pluginItem.name || '未知'}</div>
    </div>
    <div>
      <div class="muted">插件ID</div>
      <div style="word-break: break-all; overflow-wrap: anywhere;">${pluginItem.id || '未知'}</div>
    </div>
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
  depsHeader.innerHTML = `<i class=\"ri-git-repository-line\"></i> 插件依赖`;
  const chips = document.createElement('div'); chips.className = 'chips';
  // 计算依赖满足状态（插件依赖为数组，NPM 依赖为对象）
  let installedList = [];
  try { const res = await window.settingsAPI?.getPlugins?.(); installedList = Array.isArray(res) ? res : []; } catch {}
  const norm = (s) => String(s || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const parseVer = (v) => { const m = String(v||'0.0.0').split('.').map(x=>parseInt(x,10)||0); return { m:m[0]||0, n:m[1]||0, p:m[2]||0 }; };
  const cmp = (a,b)=>{ if(a.m!==b.m) return a.m-b.m; if(a.n!==b.n) return a.n-b.n; return a.p-b.p; };
  const satisfies = (ver, range) => {
    if (!range) return !!ver; const v=parseVer(ver); const r=String(range).trim(); const plain=r.replace(/^[~^]/,''); const base=parseVer(plain);
    if (r.startsWith('^')) return (v.m===base.m) && (cmp(v,base)>=0);
    if (r.startsWith('~')) return (v.m===base.m) && (v.n===base.n) && (cmp(v,base)>=0);
    if (r.startsWith('>=')) return cmp(v, parseVer(r.slice(2)))>=0;
    if (r.startsWith('>')) return cmp(v, parseVer(r.slice(1)))>0;
    if (r.startsWith('<=')) return cmp(v, parseVer(r.slice(2)))<=0;
    if (r.startsWith('<')) return cmp(v, parseVer(r.slice(1)))<0;
    const exact=parseVer(r); return cmp(v, exact)===0;
  };
  const pluginDeps = Array.isArray(pluginItem.dependencies) ? pluginItem.dependencies : (Array.isArray(pluginItem.pluginDepends) ? pluginItem.pluginDepends : []);
  if (pluginDeps.length) {
    pluginDeps.forEach((d) => {
      const [depName, depRange] = String(d).split('@');
      const depKey = norm(depName);
      const target = installedList.find(pp => norm(pp.id || pp.name) === depKey);
      const ok = !!target && satisfies(target?.version, depRange);
      const icon = ok ? 'ri-check-line' : 'ri-close-line';
      const cls = ok ? 'pill small ok' : 'pill small danger';
      const chip = document.createElement('span'); chip.className = cls;
      // 按需移除文本提示，仅保留图标与名称@版本范围
      chip.innerHTML = `<i class=\"${icon}\"></i> ${depName}${depRange ? '@'+depRange : ''}`;
      chips.appendChild(chip);
    });
  } else {
    const chip = document.createElement('span'); chip.className = 'pill small muted'; chip.textContent = '无依赖'; chips.appendChild(chip);
  }
  // 将标题与标签容器加入依赖分组
  depsGroup.appendChild(depsHeader);
  depsGroup.appendChild(chips);
  // NPM 依赖（对象名列表）
  const npmGroup = document.createElement('div'); npmGroup.className = 'section';
  const npmHeader = document.createElement('div'); npmHeader.className = 'section-title'; npmHeader.innerHTML = `<i class=\"ri-box-3-line\"></i> NPM 依赖`;
  const npmChips = document.createElement('div'); npmChips.className = 'chips';
  const npmDeps = (pluginItem && typeof pluginItem.npmDependencies === 'object' && pluginItem.npmDependencies) ? pluginItem.npmDependencies : null;
  if (npmDeps) { Object.keys(npmDeps).forEach((name) => { const chip = document.createElement('span'); chip.className = 'pill small'; chip.textContent = name; npmChips.appendChild(chip); }); }
  else { const chip = document.createElement('span'); chip.className = 'pill small muted'; chip.textContent = '无依赖'; npmChips.appendChild(chip); }

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
      const proto = ok.res?.protocolText ? `OrbiBoard://task/${encodeURIComponent(ok.res.protocolText)}` : '';
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
  npmGroup.appendChild(npmHeader);
  npmGroup.appendChild(npmChips);
  body.appendChild(npmGroup);
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

