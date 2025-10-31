// 统一的插件安装入口（供市场卡片、详情页、ZIP导入复用）
// 使用方式：window.unifiedPluginInstall({ kind: 'zipPath'|'zipData'|'npm', item, zipPath, zipName, zipData, pkg, preselectedDeps })
(function () {
  async function showInstallConfirm(item) {
    try {
      const titleName = item?.name || item?.id || item?.npm || '';
      const iconCls = item?.icon || 'ri-puzzle-line';
      const authorText = (() => {
        const a = item?.author;
        if (!a) return '未知作者';
        if (typeof a === 'string') return a;
        if (typeof a === 'object') return a.name || JSON.stringify(a);
        return String(a);
      })();

      
      // 创建美化的安装确认弹窗
      return await new Promise((resolve) => {
        const overlay = document.createElement('div'); 
        overlay.className = 'modal-overlay';
        
        const box = document.createElement('div'); 
        box.className = 'modal-box';
        
        const title = document.createElement('div'); 
        title.className = 'modal-title';
        title.innerHTML = `<i class="${iconCls}"></i> 插件安装确认`;
        
        const body = document.createElement('div'); 
        body.className = 'modal-body';
        
         // 上方内容滚动容器，避免挤压操作区
         const content = document.createElement('div');
         content.style.cssText = `
           max-height: 60vh;
           overflow-y: auto;
           padding-right: 4px;
         `;

         // 安全警告区域 - 使用全局section样式
         const warningBox = document.createElement('div');
         warningBox.className = 'section';
         warningBox.style.cssText = `
           background: rgba(255, 193, 7, 0.1);
           border-color: rgba(255, 193, 7, 0.3);
           margin-bottom: 16px;
         `;
         warningBox.innerHTML = `
           <div class="section-title" style="color: #ffc107;">
             <i class="ri-alert-line"></i> 安全提示
           </div>
           <div style="color: var(--muted); font-size: 13px; line-height: 1.4; margin-top: 8px;">
             插件将获得系统权限，请确保来源可信。安装前请仔细检查插件信息和依赖项。
           </div>
         `;
        
        // 插件信息卡片 - 使用全局setting-item样式
        const pluginCard = document.createElement('div');
        pluginCard.className = 'setting-item';
        pluginCard.style.marginBottom = '16px';
        const versionText = item?.version ? `v${item.version}` : '未知版本';
        pluginCard.innerHTML = `
          <div class="setting-icon"><i class="${iconCls}"></i></div>
          <div class="setting-main">
            <div class="setting-title">${titleName} <span class="pill small plugin-version">${versionText}</span></div>
            <div class="setting-desc">作者：${authorText}</div>
          </div>
        `;
        

        
        // 按钮区域
        const actions = document.createElement('div');
        actions.className = 'modal-actions';
        
        const btnCancel = document.createElement('button');
        btnCancel.className = 'btn secondary';
        btnCancel.innerHTML = '<i class="ri-close-line"></i> 取消';
        btnCancel.addEventListener('click', () => {
          try { overlay.remove(); } catch {}
          resolve(false);
        });
        
        const btnConfirm = document.createElement('button');
        btnConfirm.className = 'btn primary';
        btnConfirm.innerHTML = '<i class="ri-download-2-line"></i> 确认安装';
        btnConfirm.addEventListener('click', () => {
          try { overlay.remove(); } catch {}
          resolve(true);
        });
        
        actions.appendChild(btnCancel);
        actions.appendChild(btnConfirm);
        
         content.appendChild(warningBox);
         content.appendChild(pluginCard);
         body.appendChild(content);
         
        // 结构顺序：标题 -> 内容 -> 操作区（底部）
        box.appendChild(title);
        box.appendChild(body);
        box.appendChild(actions);
        overlay.appendChild(box);
        document.body.appendChild(overlay);
        
        // 点击遮罩关闭
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) {
            try { overlay.remove(); } catch {}
            resolve(false);
          }
        });
      });
    } catch { return true; }
  }
  async function resolveMarketBase() {
    try {
      const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase');
      if (typeof svc === 'string' && svc) return svc;
      const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase');
      return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/';
    } catch {
      return 'http://localhost:3030/';
    }
  }

  function findMarketItem(name) {
    const catalog = Array.isArray(window.__marketCatalog__) ? window.__marketCatalog__ : [];
    return catalog.find((x) => (x.id === name) || (x.name === name)) || null;
  }

  function resolveClosure(deps) {
    const seen = new Set(); const out = []; const queue = Array.isArray(deps) ? deps.slice() : [];
    const norm = (x) => { const s = String(x || '').trim(); const [n, r] = s.split('@'); return { name: n || '', range: r || '' }; };
    while (queue.length) {
      const raw = queue.shift(); const { name, range } = norm(raw);
      if (!name || seen.has(name)) continue; seen.add(name);
      const mi = findMarketItem(name);
      out.push({ name, range, market: mi });
      const next = Array.isArray(mi?.dependencies) ? mi.dependencies.slice() : [];
      queue.push(...next);
    }
    return out;
  }

  async function showDependsGuide(item, installedPlugins, deps) {
    const closure = resolveClosure(deps);
    // 即使无插件依赖，也展示概览与 NPM 状态，允许直接下一步
    return await new Promise(async (resolve) => {
      const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
      const box = document.createElement('div'); box.className = 'modal-box';
      const title = document.createElement('div'); title.className = 'modal-title';
      const iconCls = item?.icon || 'ri-puzzle-line';
      const titleName = item?.name || item?.id || item?.npm || '';
      const authorText = (() => {
        const a = item?.author;
        if (!a) return '未知作者';
        if (typeof a === 'string') return a;
        if (typeof a === 'object') return a.name || JSON.stringify(a);
        return String(a);
      })();
      title.innerHTML = `<i class="${iconCls}"></i> 插件安装向导 — ${titleName}`;
      const body = document.createElement('div'); body.className = 'modal-body';
      const header = document.createElement('div'); header.className = 'setting-item';
      header.innerHTML = `
        <div class="setting-icon"><i class="${iconCls}"></i></div>
        <div class="setting-main">
          <div class="setting-title">${titleName}</div>
          <div class="setting-desc">作者：${authorText}</div>
        </div>
      `;
      const tip = document.createElement('div'); 
      tip.className = 'section';
      tip.style.cssText = `
        margin: 16px 0;
        background: rgba(108, 117, 125, 0.1);
        border-color: rgba(108, 117, 125, 0.3);
      `;
      tip.innerHTML = `
        <div class="section-title" style="color: var(--muted); font-size: 13px;">
          <i class="ri-information-line"></i> 提示
        </div>
        <div style="color: var(--muted); font-size: 13px; margin-top: 4px;">
          未选择的依赖将跳过安装
        </div>
      `;
      const list = document.createElement('div'); list.style.display = 'grid'; list.style.gridTemplateColumns = '1fr'; list.style.gap = '8px';
      const actions = document.createElement('div'); actions.style.display = 'flex'; actions.style.justifyContent = 'flex-end'; actions.style.gap = '8px'; actions.style.marginTop = '12px';
      const btnCancel = document.createElement('button'); btnCancel.className = 'btn secondary'; btnCancel.innerHTML = '<i class="ri-close-line"></i> 取消';
      const btnSkip = document.createElement('button'); btnSkip.className = 'btn secondary'; btnSkip.innerHTML = '<i class="ri-skip-forward-line"></i> 跳过';
      const btnNext = document.createElement('button'); btnNext.className = 'btn primary'; btnNext.innerHTML = '<i class="ri-arrow-right-line"></i> 下一步';
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
      const inputs = [];
      closure.forEach((d) => {
        const target = installedPlugins.find(pp => (pp.id === d.name) || (pp.name === d.name));
        const ok = satisfies(target?.version, d.range);
        const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='12px'; row.style.justifyContent='space-between';
        const left = document.createElement('div'); left.style.display='flex'; left.style.alignItems='center'; left.style.gap='8px';
        const switchLabel = document.createElement('label'); switchLabel.className='switch';
        const cb = document.createElement('input'); cb.type = 'checkbox'; cb.dataset.depName = d.name; cb.dataset.depRange = d.range || '';
        const slider = document.createElement('span'); slider.className='slider';
        const found = !!d.market; cb.disabled = ok || !found; cb.checked = found && !ok;
        const status = ok ? '<span class="pill small ok">已安装</span>' : (found ? '<span class="pill small">可安装</span>' : '<span class="pill small danger">未在市场找到</span>');
        const nameSpan = document.createElement('span'); nameSpan.innerText = `${d.name}${d.range?'@'+d.range:''}`;
        const statusWrap = document.createElement('div'); statusWrap.innerHTML = status;
        switchLabel.appendChild(cb); switchLabel.appendChild(slider);
        left.appendChild(switchLabel); left.appendChild(nameSpan);
        row.appendChild(left); row.appendChild(statusWrap);
        list.appendChild(row); inputs.push(cb);
      });
      // 附加 NPM 依赖状态展示
      try {
        const depsObj = (item && typeof item.npmDependencies === 'object' && item.npmDependencies) ? item.npmDependencies : null;
        if (depsObj && Object.keys(depsObj).length) {
          const installedPkgsRes = await window.settingsAPI?.npmListInstalled?.();
          const installedPkgs = (installedPkgsRes?.ok && Array.isArray(installedPkgsRes.packages)) ? installedPkgsRes.packages : [];
          const hasPkg = (name) => installedPkgs.some(p => p.name === name && Array.isArray(p.versions) && p.versions.length);
          const npmBox = document.createElement('div');
          const npmTitle = document.createElement('div'); npmTitle.className = 'section-title'; npmTitle.innerHTML = '<i class="ri-box-3-line"></i> NPM 依赖状态';
          const npmList = document.createElement('div'); npmList.style.display='grid'; npmList.style.gridTemplateColumns='1fr'; npmList.style.gap='8px';
          Object.keys(depsObj).forEach((n) => {
            const ok = hasPkg(n);
            const row = document.createElement('div'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px';
            const status = ok ? '<span class="pill small ok">已下载</span>' : '<span class="pill small danger">未下载</span>';
            const range = depsObj[n] ? String(depsObj[n]) : '';
            row.innerHTML = `<span>${n}${range ? '@'+range : ''}</span>${status}`;
            npmList.appendChild(row);
          });
          npmBox.appendChild(npmTitle); npmBox.appendChild(npmList);
          body.appendChild(npmBox);
        }
      } catch {}
      actions.appendChild(btnCancel); actions.appendChild(btnSkip); actions.appendChild(btnNext);
      body.appendChild(header); body.appendChild(tip); body.appendChild(list); body.appendChild(actions);
      box.appendChild(title); box.appendChild(body); overlay.appendChild(box); document.body.appendChild(overlay);
      btnCancel.addEventListener('click', () => { try{overlay.remove();}catch{} resolve({ proceed:false, selected:[] }); });
      btnSkip.addEventListener('click', () => { try{overlay.remove();}catch{} resolve({ proceed:true, selected:[] }); });
      btnNext.addEventListener('click', () => {
        const selected = inputs.filter(i => !!i.checked).map(i => {
          const mi = findMarketItem(i.dataset.depName);
          return { name: i.dataset.depName, range: i.dataset.depRange, market: mi };
        });
        try{overlay.remove();}catch{} resolve({ proceed:true, selected });
      });
    });
  }

  async function installSelectedDeps(selected) {
    if (!Array.isArray(selected) || !selected.length) return;
    const base = await resolveMarketBase();
    for (const s of selected) {
      try {
        if (s.market?.zip) {
          const url = new URL(s.market.zip, base).toString();
          const res = await fetch(url); if (!res.ok) throw new Error('ZIP 下载失败');
          const buf = await res.arrayBuffer(); const name = s.market.id ? `${s.market.id}.zip` : `${s.market.name || 'plugin'}.zip`;
          const out = await window.settingsAPI?.installPluginZipData?.(name, new Uint8Array(buf)); if (!out?.ok) throw new Error(out?.error || '安装失败');
        } else if (s.market?.npm) {
          const res2 = await window.settingsAPI?.installNpm?.(s.market.npm || s.market.id || s.market.name); if (!res2?.ok) throw new Error(res2?.error || '安装失败');
        } else {
          await showAlert(`依赖缺少安装源：${s.name}`);
        }
      } catch (e) {
        await showAlert(`依赖安装失败：${s.name} — ${e?.message || '未知错误'}`);
      }
    }
  }

  async function refreshPluginsList() {
    try {
      const container = document.getElementById('plugins');
      const list = await (typeof fetchPlugins === 'function' ? fetchPlugins() : window.settingsAPI?.getPlugins?.());
      const items = Array.isArray(list) ? list : [];
      const filtered = items.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
      container.innerHTML = '';
      filtered.forEach((p) => container.appendChild(renderPlugin(p)));
    } catch {}
  }

  async function performInstall(kind, opts) {
    if (kind === 'zipPath') {
      return await window.settingsAPI?.installPluginZip?.(opts.zipPath);
    } else if (kind === 'zipData') {
      return await window.settingsAPI?.installPluginZipData?.(opts.zipName, opts.zipData);
    } else if (kind === 'npm') {
      return await window.settingsAPI?.installNpm?.(opts.pkg || opts.item?.npm || opts.item?.id || opts.item?.name);
    }
    throw new Error('未知安装类型');
  }

  async function unifiedPluginInstall(options) {
    const { kind, item, zipPath, zipName, zipData, pkg, preselectedDeps } = options || {};
    // 第一步：安装确认（风险告知）
    const okConfirm = await showInstallConfirm(item || {});
    if (!okConfirm) return;
    // 依赖引导（如无传入预选依赖，则进行引导）
    let selected = Array.isArray(preselectedDeps) ? preselectedDeps : [];
    try {
      if (!selected.length) {
        const installedList = await window.settingsAPI?.getPlugins?.();
        const installed = Array.isArray(installedList) ? installedList : [];
        const deps = Array.isArray(item?.dependencies) ? item.dependencies : [];
        const needGuide = deps.length > 0;
        if (needGuide) {
          const g = await showDependsGuide(item, installed, deps);
          if (!g.proceed) return;
          selected = g.selected;
          await installSelectedDeps(selected);
        }
      }
    } catch {}

    // 执行安装
    const res = await performInstall(kind, { item, zipPath, zipName, zipData, pkg });
    if (!res?.ok) {
      await showAlert(`安装失败：${res?.error || '未知错误'}`);
      return;
    }

    // 安装完成后确保依赖链接
    let ensure = null;
    try { ensure = await window.settingsAPI?.pluginEnsureDeps?.(res.id || res.name || item?.id || item?.name); } catch {}

    // 统一成功提示
    const metaAuthor = (typeof res.author === 'object') ? (res.author?.name || JSON.stringify(res.author)) : (res.author || '未知作者');
    const npmObj = (typeof res.npmDependencies === 'object' && res.npmDependencies) ? res.npmDependencies : (typeof item?.npmDependencies === 'object' ? item.npmDependencies : null);
    const npmNames = npmObj ? Object.keys(npmObj) : [];
    const pluginDepends = Array.isArray(res.pluginDepends) ? res.pluginDepends : (Array.isArray(res.dependencies) ? res.dependencies : (Array.isArray(item?.dependencies) ? item.dependencies : []));
    const mergedLogs = [];
    if (Array.isArray(res?.logs)) mergedLogs.push(...res.logs);
    if (Array.isArray(ensure?.logs)) mergedLogs.push(...ensure.logs);
    
    // 构建插件信息对象
    const pluginInfo = {
      name: res.name || item?.name || '未知插件',
      version: res.version || item?.version,
      author: metaAuthor,
      icon: item?.icon || 'ri-puzzle-line',
      pluginDepends: pluginDepends,
      npmDepends: npmNames
    };
    
    await showAlertWithLogs('插件安装完成', pluginInfo, mergedLogs);

    // 刷新插件列表
    await refreshPluginsList();
  }

  window.unifiedPluginInstall = unifiedPluginInstall;
})();