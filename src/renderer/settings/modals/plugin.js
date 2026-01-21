async function showPluginAboutModal(pluginItem) {
  const old = document.querySelector('.modal-overlay'); if (old) old.remove();
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const box = document.createElement('div'); box.className = 'modal-box plugin-about';
  // 增加高度以适应 tab 布局
  box.style.minHeight = '550px';
  box.style.display = 'flex';
  box.style.flexDirection = 'column';

  const title = document.createElement('div'); title.className = 'modal-title';
  title.innerHTML = `<i class="${pluginItem.icon || 'ri-puzzle-line'}"></i> 关于插件 - ${pluginItem.name}`;
  
  const body = document.createElement('div'); body.className = 'modal-body';
  body.style.flex = '1';
  body.style.display = 'flex';
  body.style.flexDirection = 'column';
  body.style.overflow = 'hidden';

  // --- Tab Header (Adapted Style) ---
  const tabHeader = document.createElement('div');
  tabHeader.className = 'subnav'; // Use global subnav class
  tabHeader.style.padding = '0'; // Override padding for modal context
  tabHeader.style.marginBottom = '0'; // Removed bottom margin
  tabHeader.style.marginTop = '10px'; // Added top margin
  tabHeader.style.borderBottom = 'none';
  tabHeader.style.justifyContent = 'center';

  const tabs = [
    { key: 'basic', label: '基本', icon: 'ri-file-info-line' },
    { key: 'features', label: '功能', icon: 'ri-function-line' }, // Merged Actions & Events
    { key: 'deps', label: '依赖', icon: 'ri-links-line' },
    { key: 'config', label: '配置', icon: 'ri-settings-3-line' },
    { key: 'stats', label: '统计', icon: 'ri-bar-chart-line' }
  ];

  let activeTab = 'basic';
  const tabButtons = {};
  const tabPanels = {};

  tabs.forEach(t => {
    const btn = document.createElement('div');
    btn.className = 'sub-item'; // Use global sub-item class
    // btn.textContent = t.label;
    btn.innerHTML = `<i class="${t.icon}" style="margin-right:4px;"></i>${t.label}`;
    btn.style.fontSize = '13px';
    btn.style.padding = '5px 10px';
    
    btn.onclick = () => switchTab(t.key);
    tabButtons[t.key] = btn;
    tabHeader.appendChild(btn);

    const panel = document.createElement('div');
    panel.style.display = 'none';
    panel.style.flex = '1';
    panel.style.overflowY = 'auto';
    panel.className = 'tab-panel-' + t.key + ' custom-scroll';
    tabPanels[t.key] = panel;
    body.appendChild(panel);
  });

  function switchTab(key) {
    activeTab = key;
    Object.keys(tabButtons).forEach(k => {
      const b = tabButtons[k];
      if (k === key) {
        b.classList.add('active');
      } else {
        b.classList.remove('active');
      }
    });
    Object.keys(tabPanels).forEach(k => {
      tabPanels[k].style.display = (k === key) ? 'block' : 'none';
    });
  }

  // --- Tab Content: Basic ---
  const basicPanel = tabPanels['basic'];
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

  const metaGrid = document.createElement('div');
  metaGrid.style.display = 'grid';
  metaGrid.style.gridTemplateColumns = 'repeat(auto-fit, minmax(180px, 1fr))';
  metaGrid.style.gap = '10px';
  metaGrid.innerHTML = `
    <div><div class="muted">插件名称</div><div>${pluginItem.name || '未知'}</div></div>
    <div><div class="muted">插件ID</div><div style="word-break: break-all; overflow-wrap: anywhere;">${pluginItem.id || '未知'}</div></div>
    <div><div class="muted">版本</div><div id="plugin-ver-slot"></div></div>
    <div><div class="muted">作者</div><div>${authorText}</div></div>
    ${homepage ? `<div><div class="muted">主页</div><div><a href="${homepage}" target="_blank" rel="noreferrer">${homepage}</a></div></div>` : ''}
    ${licenseText ? `<div><div class="muted">许可证</div><div>${licenseText}</div></div>` : ''}
  `;
  
  const verSlot = metaGrid.querySelector('#plugin-ver-slot');
  const verContainer = document.createElement('div');
  verContainer.style.display = 'flex';
  verContainer.style.alignItems = 'center';
  verContainer.style.gap = '8px';
  verContainer.innerHTML = `<span class="pill small">${versionText}</span>`;
  verSlot.appendChild(verContainer);

  // Auto-check for updates
  (async () => {
    try {
        const pkgName = (typeof pluginItem.npm === 'string') ? pluginItem.npm : (pluginItem.npm?.name || null);
        if (!pkgName || !window.settingsAPI?.npmGetVersions) return;

        const res = await window.settingsAPI.npmGetVersions(pkgName);
        if (res?.ok && Array.isArray(res.versions) && res.versions.length) {
            const latest = res.versions[res.versions.length - 1];
            
            // Simple semver compare
            const compare = (v1, v2) => {
                const p1 = String(v1).split('.').map(x => parseInt(x,10)||0);
                const p2 = String(v2).split('.').map(x => parseInt(x,10)||0);
                for (let i = 0; i < Math.max(p1.length, p2.length); i++) {
                    const n1 = p1[i] || 0, n2 = p2[i] || 0;
                    if (n1 > n2) return 1;
                    if (n1 < n2) return -1;
                }
                return 0;
            };

            if (compare(latest, versionText) > 0) {
                const btn = document.createElement('button');
                btn.className = 'btn small primary';
                btn.style.padding = '2px 8px';
                btn.style.fontSize = '12px';
                btn.innerHTML = `<i class="ri-download-cloud-2-line"></i> 更新至 ${latest}`;
                btn.title = `发现新版本 ${latest}，点击更新`;
                
                btn.onclick = async () => {
                    if (btn.disabled) return;
                    btn.disabled = true;
                    const oldHtml = btn.innerHTML;
                    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> 更新中...';
                    
                    try {
                        // Using installNpm to update (it fetches latest if pkgName is string)
                        // Wait, installNpm logic in main process:
                        // if (typeof p.npm === 'string') { const latest = await getPackageVersions(p.npm); ... }
                        // So calling installNpm(pkgName) where pkgName is the plugin name/ID passed to IPC should work IF the plugin ID matches package name?
                        // No, IPC 'plugin:install' takes (event, name). 'name' is passed to pluginManager.installNpm(idOrName).
                        // pluginManager.installNpm finds plugin by idOrName first.
                        // So we should pass pluginItem.id or pluginItem.name.
                        
                        const key = pluginItem.id || pluginItem.name;
                        const installRes = await window.settingsAPI.installNpm(key);
                        
                        if (installRes?.ok) {
                            showToast(`更新成功，即将重启应用...`, { type: 'success' });
                            btn.innerHTML = '<i class="ri-check-line"></i> 更新成功';
                            setTimeout(() => {
                                window.settingsAPI.restartApp();
                            }, 1500);
                        } else {
                            throw new Error(installRes?.error || '更新失败');
                        }
                    } catch (e) {
                        btn.disabled = false;
                        btn.innerHTML = oldHtml;
                        showToast(`更新出错：${e.message}`, { type: 'error' });
                    }
                };
                verContainer.appendChild(btn);
            }
        }
    } catch(e) {
        console.error('Check update failed', e);
    }
  })();
  const desc = document.createElement('div');
  desc.style.marginTop = '12px';
  desc.innerHTML = `<div class="muted">描述</div><div>${descText}</div>`;
  basicPanel.appendChild(metaGrid);
  basicPanel.appendChild(desc);

  // README section
  const readmeContainer = document.createElement('div');
  readmeContainer.className = 'modal-readme'; // Use same class as market for consistency
  readmeContainer.style.marginTop = '16px';
  readmeContainer.style.paddingTop = '16px';
  readmeContainer.style.borderTop = '1px solid var(--border)';
  basicPanel.appendChild(readmeContainer);

  (async () => {
    readmeContainer.innerHTML = '<div class="muted">正在加载说明文档...</div>';
    try {
        const key = pluginItem.id || pluginItem.name;
        let md = await window.settingsAPI?.getPluginReadme?.(key);
        
        // If no local README, try online if it's an npm plugin
        if (!md && pluginItem.npm) {
            md = await window.settingsAPI?.getPluginReadmeOnline?.(key);
        }

        if (md) {
            if (typeof renderMarkdown === 'function') {
                readmeContainer.innerHTML = renderMarkdown(md);
            } else {
                readmeContainer.textContent = md;
                readmeContainer.style.whiteSpace = 'pre-wrap';
            }
        } else {
            readmeContainer.innerHTML = '<div class="muted">暂无说明文档</div>';
        }
    } catch (e) {
        readmeContainer.innerHTML = `<div class="danger">加载说明文档失败: ${e.message}</div>`;
    }
  })();

  // --- Tab Content: Features (Merged Actions & Events) ---
  const featuresPanel = tabPanels['features'];
  
  // Create internal tab switcher
  const featTabs = document.createElement('div');
  featTabs.style.display = 'flex';
  featTabs.style.gap = '12px';
  featTabs.style.marginBottom = '12px';
  featTabs.style.borderBottom = '1px solid var(--border)';
  featTabs.style.paddingBottom = '8px';
  
  const ftAction = document.createElement('div');
  ftAction.textContent = '动作 (Actions)';
  ftAction.style.cursor = 'pointer';
  ftAction.style.fontWeight = 'bold';
  ftAction.style.color = 'var(--fg)';
  
  const ftEvent = document.createElement('div');
  ftEvent.textContent = '事件 (Events)';
  ftEvent.style.cursor = 'pointer';
  ftEvent.style.color = 'var(--muted)';
  
  featTabs.appendChild(ftAction);
  featTabs.appendChild(ftEvent);
  featuresPanel.appendChild(featTabs);
  
  const featContent = document.createElement('div');
  featuresPanel.appendChild(featContent);
  
  // Render functions
  const renderActions = () => {
    featContent.innerHTML = '';
    const acts = Array.isArray(pluginItem.actions) ? pluginItem.actions : [];
    if (acts.length === 0) {
        featContent.innerHTML = '<div class="muted" style="padding: 20px; text-align: center;">该插件未定义任何动作</div>';
        return;
    }
    const actList = document.createElement('div');
    actList.className = 'array-list';
    acts.forEach(a => {
        const row = document.createElement('div');
        row.className = 'action-item';
        row.style.display = 'flex';
        row.style.justifyContent = 'space-between';
        row.style.alignItems = 'center';
        
        const infoDiv = document.createElement('div');
        infoDiv.style.flex = '1';
        infoDiv.style.display = 'flex';
        infoDiv.style.alignItems = 'center';
        infoDiv.style.gap = '10px';
        infoDiv.innerHTML = `
        <i class="${a.icon || pluginItem.icon || 'ri-play-line'}"></i>
        <div>
            <div style="font-weight:500;">${a.text || a.label || a.id}</div>
            <div class="muted small">Target: ${a.target || '-'}</div>
        </div>
        `;
        
        const runBtn = document.createElement('button');
        runBtn.className = 'btn small secondary';
        runBtn.title = '执行动作';
        runBtn.innerHTML = '<i class="ri-play-fill"></i> 执行';
        runBtn.onclick = async () => {
        if (!a.target) return;
        const key = pluginItem.id || pluginItem.name;
        try {
            await window.settingsAPI?.pluginCall?.(key, a.target, Array.isArray(a.args) ? a.args : []);
            showToast(`已执行动作：${a.text || a.target}`, { type: 'success' });
        } catch (e) {
            showToast(`执行失败：${e.message}`, { type: 'error' });
        }
        };

        row.appendChild(infoDiv);
        row.appendChild(runBtn);
        actList.appendChild(row);
    });
    featContent.appendChild(actList);
  };
  
  const renderEvents = async () => {
    featContent.innerHTML = '<div class="muted">正在加载事件...</div>';
    try {
        const pluginId = pluginItem.id || pluginItem.name;
        const evRes = await window.settingsAPI?.pluginAutomationListEvents?.(pluginId);
        const events = Array.isArray(evRes?.events) ? evRes.events : [];
        
        featContent.innerHTML = '';
        if (events.length === 0) {
            featContent.innerHTML = '<div class="muted" style="padding: 20px; text-align: center;">该插件未注册任何事件</div>';
            return;
        }
        
        const evList = document.createElement('div');
        evList.className = 'array-list';
        events.forEach(e => {
            const row = document.createElement('div');
            row.className = 'action-item';
            row.style.display = 'flex';
            row.style.justifyContent = 'space-between';
            row.style.alignItems = 'center';
            
            const infoDiv = document.createElement('div');
            infoDiv.style.flex = '1';
            infoDiv.style.display = 'flex';
            infoDiv.style.alignItems = 'center';
            infoDiv.style.gap = '10px';
            infoDiv.innerHTML = `
            <i class="ri-broadcast-line"></i>
            <div>
                <div style="font-weight:500;">${e.name || e.id}</div>
                <div class="muted small">${e.description || '无描述'}</div>
            </div>
            `;
            
            const triggerBtn = document.createElement('button');
            triggerBtn.className = 'btn small secondary';
            triggerBtn.title = '触发事件';
            triggerBtn.innerHTML = '<i class="ri-flashlight-line"></i> 触发';
            triggerBtn.onclick = async () => {
            let params = {};
            if (Array.isArray(e.params) && e.params.length > 0) {
                const editedVals = await showParamsEditorForEvent(e.params, [], pluginId);
                if (editedVals === null) return;
                e.params.forEach((p, idx) => {
                if (p.name) params[p.name] = editedVals[idx];
                });
            }
            try {
                const evName = e.name || e.id;
                await window.settingsAPI?.pluginEmitEvent?.(evName, params);
                showToast(`已触发事件：${evName}`, { type: 'success' });
            } catch (err) {
                showToast(`触发失败：${err.message}`, { type: 'error' });
            }
            };

            row.appendChild(infoDiv);
            row.appendChild(triggerBtn);
            evList.appendChild(row);
        });
        featContent.appendChild(evList);
    } catch (err) {
        featContent.innerHTML = `<div class="danger">加载事件失败：${err.message}</div>`;
    }
  };
  
  // Tab switch logic
  ftAction.onclick = () => {
      ftAction.style.fontWeight = 'bold'; ftAction.style.color = 'var(--fg)';
      ftEvent.style.fontWeight = 'normal'; ftEvent.style.color = 'var(--muted)';
      renderActions();
  };
  ftEvent.onclick = () => {
      ftEvent.style.fontWeight = 'bold'; ftEvent.style.color = 'var(--fg)';
      ftAction.style.fontWeight = 'normal'; ftAction.style.color = 'var(--muted)';
      renderEvents();
  };
  
  // Initial render
  renderActions();


  // --- Tab Content: Dependencies ---
  const depsPanel = tabPanels['deps'];
  const depsList = document.createElement('div');
  depsList.className = 'array-list';
  
  // 计算依赖满足状态
  let installedList = [];
  try { const res = await window.settingsAPI?.getPlugins?.(); installedList = Array.isArray(res) ? res : []; } catch (e) {}
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
      const color = ok ? 'var(--success, #4caf50)' : 'var(--danger, #f44336)';
      
      const row = document.createElement('div');
      row.className = 'action-item';
      row.style.cursor = 'pointer';
      row.innerHTML = `
        <i class="${icon}" style="color:${color}"></i>
        <div style="flex:1; margin-left:8px;">
            <div style="font-weight:500;">${depName}</div>
            <div class="muted small">${depRange ? '需求版本: ' + depRange : '任意版本'} ${target ? `(当前: ${target.version || '未知'})` : '(未安装)'}</div>
        </div>
        <i class="ri-arrow-right-s-line muted"></i>
      `;
      row.onclick = () => {
          if (target) {
              // 关闭当前，打开目标
              document.body.removeChild(overlay);
              showPluginAboutModal(target);
          } else {
              showToast('该插件未安装，无法查看详情', { type: 'warning' });
          }
      };
      depsList.appendChild(row);
    });
  } else {
    const empty = document.createElement('div');
    empty.className = 'muted';
    empty.style.padding = '10px';
    empty.textContent = '无插件依赖';
    depsList.appendChild(empty);
  }
  
  const npmDepsDiv = document.createElement('div');
  npmDepsDiv.style.marginTop = '16px';
  npmDepsDiv.innerHTML = '<div class="section-title"><i class="ri-box-3-line"></i> NPM 依赖</div>';
  const npmList = document.createElement('div');
  npmList.className = 'array-list';
  
  const npmDeps = (pluginItem && typeof pluginItem.npmDependencies === 'object' && pluginItem.npmDependencies) ? pluginItem.npmDependencies : null;
  if (npmDeps && Object.keys(npmDeps).length > 0) {
      Object.keys(npmDeps).forEach((name) => {
          const row = document.createElement('div');
          row.className = 'action-item';
          row.style.display = 'flex';
          row.style.alignItems = 'center';
          row.style.cursor = 'pointer';
          row.innerHTML = `
            <i class="ri-box-3-line"></i>
            <div style="flex:1; margin-left:8px;">
                <div style="font-weight:500;">${name}</div>
                <div class="muted small">需求版本: ${npmDeps[name]}</div>
            </div>
            <i class="ri-external-link-line muted"></i>
          `;
          row.onclick = () => {
              // 关闭当前，跳转NPM页并定位
              document.body.removeChild(overlay);
              if (window.locateNpmPackage) {
                  window.locateNpmPackage(name);
              } else {
                  const navNpm = document.querySelector('.nav-item[data-page="npm"]');
                  if (navNpm) navNpm.click();
              }
          };
          npmList.appendChild(row);
      });
  } else {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.style.padding = '10px';
      empty.textContent = '无NPM依赖';
      npmList.appendChild(empty);
  }
  
  npmDepsDiv.appendChild(npmList);
  
  depsPanel.appendChild(depsList);
  depsPanel.appendChild(npmDepsDiv);

  // --- Tab Content: Config ---
  const configPanel = tabPanels['config'];
  configPanel.style.display = 'flex';
  configPanel.style.flexDirection = 'column';
  configPanel.style.alignItems = 'center';
  configPanel.style.justifyContent = 'center';
  configPanel.style.height = '100%';
  
  const configBtn = document.createElement('button');
  configBtn.className = 'btn primary large';
  configBtn.innerHTML = '<i class="ri-settings-4-line"></i> 打开配置总览';
  configBtn.onclick = () => {
    // 关闭当前模态框
    document.body.removeChild(overlay);
    // 修复：使用 DOM 点击导航到配置页
    const navConfig = document.querySelector('.nav-item[data-page="config"]');
    if (navConfig) {
        navConfig.click();
        // 如果已定义 openConfigScope，则尝试调用以自动展开
        if (typeof window.openConfigScope === 'function') {
            window.openConfigScope(pluginItem.id || pluginItem.name);
        }
    } else {
        // Fallback if nav item not found
        try { window.initConfigOverview?.(); } catch(e){}
    }
  };
  
  const configDesc = document.createElement('div');
  configDesc.className = 'muted';
  configDesc.style.marginTop = '12px';
  configDesc.textContent = '请在“配置总览”中查找并修改该插件的配置项';
  
  configPanel.appendChild(configBtn);
  configPanel.appendChild(configDesc);

  // --- Tab Content: Stats ---
  const statsPanel = tabPanels['stats'];
  statsPanel.innerHTML = '<div class="muted">正在加载统计信息...</div>';
  // 异步加载统计
  (async () => {
    try {
      const stats = await window.settingsAPI?.getPluginStats?.(pluginItem.id || pluginItem.name);
      if (!stats || !stats.ok) {
        statsPanel.innerHTML = '<div class="muted">暂无统计信息</div>';
        return;
      }
      const s = stats.stats || {};
      const formatSize = (bytes) => {
        if (bytes === 0) return '0 B';
        const k = 1024; const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
      };
      const formatDate = (ts) => {
        if (!ts) return '未知';
        return new Date(ts).toLocaleString();
      };
      
      statsPanel.innerHTML = `
        <div style="display:grid; grid-template-columns: 1fr 1fr; gap:16px;">
          <div class="stat-card" style="background:rgba(255,255,255,0.06); border:1px solid var(--border); padding:12px; border-radius:8px;">
            <div class="muted small">占用空间</div>
            <div style="font-size:18px; font-weight:bold;">${formatSize(s.size || 0)}</div>
          </div>
          <div class="stat-card" style="background:rgba(255,255,255,0.06); border:1px solid var(--border); padding:12px; border-radius:8px;">
            <div class="muted small">文件数量</div>
            <div style="font-size:18px; font-weight:bold;">${s.files || 0}</div>
          </div>
          <div class="stat-card" style="background:rgba(255,255,255,0.06); border:1px solid var(--border); padding:12px; border-radius:8px;">
            <div class="muted small">安装时间</div>
            <div>${formatDate(s.birthtime)}</div>
          </div>
          <div class="stat-card" style="background:rgba(255,255,255,0.06); border:1px solid var(--border); padding:12px; border-radius:8px;">
            <div class="muted small">更新时间</div>
            <div>${formatDate(s.mtime)}</div>
          </div>
        </div>
      `;
    } catch (e) {
      statsPanel.innerHTML = `<div class="danger">加载失败：${e.message}</div>`;
    }
  })();


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
    } catch (e) {}
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
        const edited = await showParamsEditorForEvent(chosen.def.params, [], pluginId);
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
        const edited = await showParamsEditorForEvent(chosen.def.params, [], pluginId);
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

  // 初始切换
  switchTab('basic');

  box.appendChild(title);
  body.appendChild(tabHeader);
  box.appendChild(body); // body contains panels
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
