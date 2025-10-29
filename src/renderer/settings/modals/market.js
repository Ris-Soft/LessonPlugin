async function showStorePluginModal(item) {
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

  const depsObj = (item && typeof item.npmDependencies === 'object' && item.npmDependencies) ? item.npmDependencies : null;
  const depsKeys = depsObj ? Object.keys(depsObj) : [];
  const npmDepsHtml = depsKeys.length
    ? depsKeys.slice(0, 6).map(k => `<span class="pill small">${k}</span>`).join(' ') + (depsKeys.length > 6 ? ` <span class="pill small muted">+${depsKeys.length - 6}</span>` : '')
    : '<span class="muted">无依赖</span>';
  // 依赖满足状态：获取已安装插件列表并进行版本对比
  let installedList = [];
  try { const res = await window.settingsAPI?.getPlugins?.(); installedList = Array.isArray(res) ? res : []; } catch {}
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
  const pluginDepsArray = Array.isArray(item.dependencies) ? item.dependencies : [];
  const pluginDepsHtml = pluginDepsArray.length ? pluginDepsArray.slice(0, 6).map(d => {
    const [depName, depRange] = String(d).split('@');
    const target = installedList.find(pp => (pp.id === depName) || (pp.name === depName));
    const ok = !!target && satisfies(target?.version, depRange);
    const icon = ok ? 'ri-check-line' : 'ri-close-line';
    const cls = ok ? 'pill small ok' : 'pill small danger';
    return `<span class="${cls}"><i class="${icon}"></i> ${depName}${depRange ? '@'+depRange : ''}</span>`;
  }).join(' ') + (pluginDepsArray.length > 6 ? ` <span class="pill small muted">+${pluginDepsArray.length - 6}</span>` : '') : '<span class="muted">无依赖</span>';

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
    <div class=\"section-title\"><i class=\"ri-git-repository-line\"></i> 插件依赖</div>
    <div>${pluginDepsHtml}</div>
    <div class=\"section-title\" style=\"margin-top:8px;\"><i class=\"ri-box-3-line\"></i> NPM 依赖</div>
    <div>${npmDepsHtml}</div>
    <div class=\"section-title\" style=\"margin-top:12px;\"><i class=\"ri-file-text-line\"></i> 插件说明</div>
  `;
  body.appendChild(readmeBox);

  // 自动化条目预览（触发条件、执行条件、执行动作）
  const autoBox = document.createElement('div');
  const autoTitle = document.createElement('div'); autoTitle.className = 'section-title'; autoTitle.innerHTML = '<i class="ri-timer-line"></i> 自动化预览';
  const autoContent = document.createElement('div'); autoContent.className = 'automation-preview';
  if ((item.type || 'plugin') === 'automation') {
    body.appendChild(autoTitle);
    body.appendChild(autoContent);
  }

  // 操作按钮
  const actionBox = body.querySelector('.setting-action');
  const actionBtn = document.createElement('button'); actionBtn.className = 'btn primary'; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装';
  const uninstallBtn = document.createElement('button'); uninstallBtn.className = 'btn danger'; uninstallBtn.innerHTML = '<i class="ri-delete-bin-line"></i> 卸载';
  actionBox.appendChild(actionBtn);

  // 自动化安装（与插件安装分支）
  if ((item.type || 'plugin') === 'automation') {
    uninstallBtn.hidden = true;
    actionBtn.disabled = false;
    actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装自动化';
    actionBtn.dataset.action = 'install-automation';
    actionBtn.addEventListener('click', async () => {
      try {
        actionBtn.disabled = true; actionBtn.innerHTML = '<i class="ri-loader-4-line"></i> 安装中...';
        const base = await (async () => {
          try {
            const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase');
            if (typeof svc === 'string' && svc) return svc;
            const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase');
            return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/';
          } catch { return 'http://localhost:3030/'; }
        })();
        let autoJson = null;
        if (item.automation) {
          const url = new URL(item.automation, base).toString();
          const res = await fetch(url);
          if (res.ok) autoJson = await res.json();
        } else if (item.id) {
          const url = new URL(`/data/plugins/${item.id}/automation.json`, base).toString();
          const res = await fetch(url);
          if (res.ok) autoJson = await res.json();
        }
        if (!autoJson) throw new Error('未获取到自动化配置');
        const id = String(autoJson.id || item.id || ('automation-' + Date.now()));
        const payload = {
          name: autoJson.name || item.name || '未命名自动化',
          triggers: Array.isArray(autoJson.triggers) ? autoJson.triggers : [],
          conditions: (autoJson.conditions && typeof autoJson.conditions === 'object') ? autoJson.conditions : { mode:'and', groups:[] },
          actions: Array.isArray(autoJson.actions) ? autoJson.actions : [],
          confirm: (autoJson.confirm && typeof autoJson.confirm === 'object') ? autoJson.confirm : { enabled:false, timeout:60 }
          ,source: 'plugin:market'
          ,id: id
        };
        const existed = await window.settingsAPI?.automationGet?.(id);
        if (existed) {
          const ok = await showConfirm('同名自动化已存在，是否覆盖当前配置？');
          if (!ok) { actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装自动化'; return; }
          const out = await window.settingsAPI?.automationUpdate?.(id, payload);
          if (!out?.ok) throw new Error(out?.error || '覆盖失败');
          await window.settingsAPI?.automationToggle?.(id, true);
          await showAlert('已覆盖并启用');
        } else {
          const out = await window.settingsAPI?.automationCreate?.({ id, ...payload });
          if (!out?.ok) throw new Error(out?.error || '安装失败');
          await window.settingsAPI?.automationToggle?.(id, true);
          await showAlert('已安装并启用');
        }
        try { overlay.remove(); } catch {}
        const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.dataset.page === 'automations');
        btn?.click?.();
      } catch (e) {
        await showAlert('安装失败：' + (e?.message || '未知错误'));
        actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装自动化';
      }
    });
  }

  // 插件安装逻辑（仅当类型为插件时启用）
  if ((item.type || 'plugin') !== 'automation') {
    const setActionButton = async () => {
      try {
        const list = await window.settingsAPI?.getPlugins?.();
        const installed = Array.isArray(list) ? list.find((p) => (
          (item.id && (p.id === item.id)) ||
          (item.name && (p.name === item.name)) ||
          (item.npm && (p.npm === item.npm))
        )) : null;
        // 控制卸载按钮展示
        uninstallBtn.hidden = !installed;
        if (!installed) {
          actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装'; actionBtn.dataset.action = 'install'; return;
        }
        // 已安装：无 npm 源时仅展示“已安装”
        if (!item.npm) { actionBtn.disabled = true; actionBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装'; actionBtn.dataset.action = 'installed'; return; }
        const res = await window.settingsAPI?.npmGetVersions?.(item.npm);
        const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
        const latest = versions.length ? versions[versions.length - 1] : null;
        if (latest && item.version && latest !== item.version) {
          actionBtn.disabled = false; actionBtn.innerHTML = `<i class="ri-refresh-line"></i> 更新到 v${latest}`; actionBtn.dataset.action = 'update'; actionBtn.dataset.latest = latest;
        } else {
          actionBtn.disabled = true; actionBtn.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装'; actionBtn.dataset.action = 'installed';
        }
      } catch {
        actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装'; actionBtn.dataset.action = 'install';
        uninstallBtn.hidden = true;
      }
    };
    setActionButton();

    actionBtn.addEventListener('click', async () => {
      const action = actionBtn.dataset.action;
      try {
        actionBtn.disabled = true; actionBtn.innerHTML = '<i class="ri-loader-4-line"></i> 处理中...';
        if (action === 'install') {
          // 支持 ZIP 安装（优先）
          if (item.zip) {
            const base = await (async () => {
              try {
                const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase');
                if (typeof svc === 'string' && svc) return svc;
                const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase');
                return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/';
              } catch { return 'http://localhost:3030/'; }
            })();
            const url = new URL(item.zip, base).toString();
            const res = await fetch(url);
            if (!res.ok) throw new Error('ZIP 下载失败');
            const buf = await res.arrayBuffer();
            const name = item.id ? `${item.id}.zip` : `${item.name || 'plugin'}.zip`;
            // 安装前检查ZIP显示依赖并确认（保持与卡片安装一致）
            try {
              const inspect = await window.settingsAPI?.inspectPluginZipData?.(name, new Uint8Array(buf));
              if (inspect?.ok) {
                // 美化安装确认弹窗：展示作者、插件依赖状态与 NPM 依赖
                const installedList = await window.settingsAPI?.getPlugins?.();
                const installed = Array.isArray(installedList) ? installedList : [];
                const normalizeAuthor = (a) => {
                  if (a === null || a === undefined) return null;
                  if (typeof a === 'object') return a?.name || null;
                  return String(a);
                };
                const authorVal = normalizeAuthor(inspect?.author) || normalizeAuthor(item?.author) || '未知作者';
                const pluginDepends = Array.isArray(inspect.dependencies) ? inspect.dependencies : (Array.isArray(item.dependencies) ? item.dependencies : []);
                const depsObjZip = (typeof inspect.npmDependencies === 'object' && inspect.npmDependencies) ? inspect.npmDependencies : null;
                const depNames = depsObjZip ? Object.keys(depsObjZip) : [];

                const parseVer = (v) => { const m = String(v||'0.0.0').split('.').map(x=>parseInt(x,10)||0); return { m:m[0]||0, n:m[1]||0, p:m[2]||0 }; };
                const cmp = (a,b)=>{ if(a.m!==b.m) return a.m-b.m; if(a.n!==b.n) return a.n-b.n; return a.p-b.p; };
                const satisfies = (ver, range) => {
                  if (!range) return !!ver;
                  const v = parseVer(ver);
                  const r = String(range).trim();
                  const plain = r.replace(/^[~^]/, '');
                  const base = parseVer(plain);
                  if (r.startsWith('^')) return (v.m === base.m) && (cmp(v, base) >= 0);
                  if (r.startsWith('~')) return (v.m === base.m) && (v.n === base.n) && (cmp(v, base) >= 0);
                  if (r.startsWith('>=')) return cmp(v, parseVer(r.slice(2))) >= 0;
                  if (r.startsWith('>')) return cmp(v, parseVer(r.slice(1))) > 0;
                  if (r.startsWith('<=')) return cmp(v, parseVer(r.slice(2))) <= 0;
                  if (r.startsWith('<')) return cmp(v, parseVer(r.slice(1))) < 0;
                  const exact = parseVer(r); return cmp(v, exact) === 0;
                };
                const depPills = pluginDepends.map(d => {
                  const [depName, depRange] = String(d).split('@');
                  const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
                  const ok = !!target && satisfies(target?.version, depRange);
                  const icon = ok ? 'ri-check-line' : 'ri-close-line';
                  const cls = ok ? 'pill small ok' : 'pill small danger';
                  return `<span class="${cls}"><i class="${icon}"></i> ${depName}${depRange ? '@'+depRange : ''}</span>`;
                }).join(' ');
                const hasUnsatisfied = pluginDepends.some(d => {
                  const [depName, depRange] = String(d).split('@');
                  const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
                  return !(!!target && satisfies(target?.version, depRange));
                });
                const npmPills = depNames.map(k => `<span class="pill small">${k}</span>`).join(' ');

                // 插件安装向导弹窗（多选，可忽略不安装；展示含上级依赖）
                const catalog = Array.isArray(window.__marketCatalog__) ? window.__marketCatalog__ : [];
                const findMarketItem = (name) => catalog.find((x) => (x.id === name) || (x.name === name));
                const resolveClosure = (deps) => {
                  const seen = new Set();
                  const out = [];
                  const queue = deps.slice();
                  while (queue.length) {
                    const raw = queue.shift();
                    const [depName, depRange] = String(raw).split('@');
                    const key = depName.trim();
                    if (!key || seen.has(key)) continue;
                    seen.add(key);
                    const mi = findMarketItem(key) || null;
                    out.push({ name: key, range: depRange || '', market: mi });
                    const next = Array.isArray(mi?.dependencies) ? mi.dependencies.slice() : [];
                    queue.push(...next);
                  }
                  return out;
                };
                const closure = resolveClosure(pluginDepends);
                const guideOverlay = document.createElement('div'); guideOverlay.className = 'modal-overlay';
                const guideBox = document.createElement('div'); guideBox.className = 'modal-box';
                const guideTitle = document.createElement('div'); guideTitle.className = 'modal-title';
                guideTitle.innerHTML = `<i class="${item.icon || 'ri-puzzle-line'}"></i> 插件安装向导 — ${inspect.name || item.name}`;
                const guideBody = document.createElement('div'); guideBody.className = 'modal-body';
                const tipEl = document.createElement('div'); tipEl.className = 'muted'; tipEl.textContent = '可忽略不安装：未选择的依赖将跳过安装';
                guideBody.innerHTML = `
                  <div class="setting-item">
                    <div class="setting-icon"><i class="${item.icon || 'ri-puzzle-line'}"></i></div>
                    <div class="setting-main">
                      <div class="setting-title">${inspect.name || item.name}</div>
                      <div class="setting-desc">作者：${authorVal}</div>
                    </div>
                  </div>
                  <br>
                  <div class="section-title"><i class="ri-git-repository-line"></i> 需要安装的依赖（含上级依赖）</div>
                `;
                guideBody.appendChild(tipEl);
                const listEl = document.createElement('div'); listEl.style.display='grid'; listEl.style.gridTemplateColumns='1fr'; listEl.style.gap='8px';
                const inputs = [];
                closure.forEach((d) => {
                  const target = installed.find(pp => (pp.id === d.name) || (pp.name === d.name));
                  const ok2 = !!target && satisfies(target?.version, d.range);
                  const row = document.createElement('label'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px';
                  const cb = document.createElement('input'); cb.type='checkbox'; cb.dataset.depName=d.name; cb.dataset.depRange=d.range||'';
                  const found = !!d.market;
                  cb.disabled = ok2 || !found;
                  cb.checked = found && !ok2;
                  const status = ok2 ? '<span class="pill small ok">已安装</span>' : (found ? '<span class="pill small">可安装</span>' : '<span class="pill small danger">未在市场找到</span>');
                  row.innerHTML = `
                    <span>${d.name}${d.range ? '@'+d.range : ''}</span>
                    ${status}
                  `;
                  row.insertBefore(cb, row.firstChild);
                  listEl.appendChild(row);
                  inputs.push(cb);
                });
                guideBody.appendChild(listEl);
                const guideActions = document.createElement('div'); guideActions.style.display='flex'; guideActions.style.justifyContent='flex-end'; guideActions.style.gap='8px'; guideActions.style.marginTop='12px';
                const btnCancel = document.createElement('button'); btnCancel.className='btn secondary'; btnCancel.innerHTML='<i class="ri-close-line"></i> 取消';
                const btnSkip = document.createElement('button'); btnSkip.className='btn secondary'; btnSkip.innerHTML='<i class="ri-skip-forward-line"></i> 跳过';
                const btnNext = document.createElement('button'); btnNext.className='btn primary'; btnNext.innerHTML='<i class="ri-arrow-right-line"></i> 下一步';
                guideActions.appendChild(btnCancel); guideActions.appendChild(btnSkip); guideActions.appendChild(btnNext);
                guideOverlay.appendChild(guideBox); guideBox.appendChild(guideTitle); guideBox.appendChild(guideBody); guideBody.appendChild(guideActions);
                document.body.appendChild(guideOverlay);
                const waitGuide = await new Promise((resolve)=>{
                  btnCancel.addEventListener('click', ()=>{ try{guideOverlay.remove();}catch{} resolve({ proceed:false, selected:[] }); });
                  btnSkip.addEventListener('click', ()=>{ try{guideOverlay.remove();}catch{} resolve({ proceed:true, selected:[] }); });
                  btnNext.addEventListener('click', ()=>{
                    const selected = inputs.filter(i=>i.checked && !i.disabled).map(i=>{
                      const mi = findMarketItem(i.dataset.depName);
                      return { name: i.dataset.depName, range: i.dataset.depRange, market: mi };
                    });
                    try{guideOverlay.remove();}catch{}
                    resolve({ proceed:true, selected });
                  });
                });
                if (!waitGuide.proceed) { actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装'; return; }
                if (waitGuide.selected.length) {
                  const ok3 = await showConfirm(`将先安装以下依赖，再安装插件：\n- ${waitGuide.selected.map(s=>s.name+(s.range?('@'+s.range):'')).join('\n- ')}`);
                  if (!ok3) { actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装'; return; }
                  const base2 = await (async () => {
                    try { const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase'); if (typeof svc === 'string' && svc) return svc; const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase'); return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/'; } catch { return 'http://localhost:3030/'; }
                  })();
                  for (const s of waitGuide.selected) {
                    try {
                      if (s.market?.zip) {
                        const url2 = new URL(s.market.zip, base2).toString();
                        const res2 = await fetch(url2); if (!res2.ok) throw new Error('ZIP 下载失败');
                        const buf2 = await res2.arrayBuffer();
                        const name2 = s.market.id ? `${s.market.id}.zip` : `${s.market.name || 'plugin'}.zip`;
                        const out2 = await window.settingsAPI?.installPluginZipData?.(name2, new Uint8Array(buf2)); if (!out2?.ok) throw new Error(out2?.error || '安装失败');
                      } else if (s.market?.npm) {
                        const res3 = await window.settingsAPI?.installNpm?.(s.market.npm || s.market.id || s.market.name); if (!res3?.ok) throw new Error(res3?.error || '安装失败');
                      } else {
                        await showAlert(`依赖缺少安装源：${s.name}`);
                      }
                    } catch (e) {
                      await showAlert(`依赖安装失败：${s.name} — ${e?.message || '未知错误'}`);
                    }
                  }
                }
              }
            } catch {}
            const out = await window.settingsAPI?.installPluginZipData?.(name, new Uint8Array(buf));
            if (!out?.ok) throw new Error(out?.error || '安装失败');
            const metaAuthor = (typeof out.author === 'object') ? (out.author?.name || JSON.stringify(out.author)) : (out.author || '未知作者');
            const depsObj = (typeof out.npmDependencies === 'object' && out.npmDependencies) ? out.npmDependencies : null;
            const depNames = depsObj ? Object.keys(depsObj) : [];
            await showAlertWithLogs(
              '插件安装完成',
              `安装成功：${out.name}\n作者：${metaAuthor}\n依赖：${depNames.length ? depNames.join(', ') : '无'}`,
              Array.isArray(out?.logs) ? out.logs : []
            );
          } else {
            // NPM 安装前引导依赖选择
            const installedList2 = await window.settingsAPI?.getPlugins?.();
            const installed2 = Array.isArray(installedList2) ? installedList2 : [];
            const pluginDepends2 = Array.isArray(item.dependencies) ? item.dependencies : [];
            const hasUnsatisfied2 = pluginDepends2.some(d => {
              const [depName, depRange] = String(d).split('@');
              const target = installed2.find(pp => (pp.id === depName) || (pp.name === depName));
              return !(!!target && satisfies(target?.version, depRange));
            });
            if (hasUnsatisfied2) {
              const catalog2 = Array.isArray(window.__marketCatalog__) ? window.__marketCatalog__ : [];
              const findMarketItem2 = (name) => catalog2.find((x) => (x.id === name) || (x.name === name));
              const resolveClosure2 = (deps) => {
                const seen = new Set(); const out = []; const queue = deps.slice();
                while (queue.length) {
                  const raw = queue.shift(); const [depName, depRange] = String(raw).split('@');
                  const key2 = depName.trim(); if (!key2 || seen.has(key2)) continue; seen.add(key2);
                  const mi = findMarketItem2(key2) || null; out.push({ name: key2, range: depRange || '', market: mi });
                  const next = Array.isArray(mi?.dependencies) ? mi.dependencies.slice() : []; queue.push(...next);
                }
                return out;
              };
              const closure2 = resolveClosure2(pluginDepends2);
              const guideOverlay2 = document.createElement('div'); guideOverlay2.className = 'modal-overlay';
              const guideBox2 = document.createElement('div'); guideBox2.className = 'modal-box';
              const guideTitle2 = document.createElement('div'); guideTitle2.className = 'modal-title';
              guideTitle2.innerHTML = `<i class="${item.icon || 'ri-puzzle-line'}"></i> 插件安装向导 — ${item.name}`;
              const guideBody2 = document.createElement('div'); guideBody2.className = 'modal-body';
              const tipEl2 = document.createElement('div'); tipEl2.className = 'muted'; tipEl2.textContent = '可忽略不安装：未选择的依赖将跳过安装';
              guideBody2.innerHTML = `
                <div class="setting-item">
                  <div class="setting-icon"><i class="${item.icon || 'ri-puzzle-line'}"></i></div>
                  <div class="setting-main">
                    <div class="setting-title">${item.name}</div>
                    <div class="setting-desc">作者：${authorText}</div>
                  </div>
                </div>
                <br>
                <div class="section-title"><i class="ri-git-repository-line"></i> 需要安装的依赖（含上级依赖）</div>
              `;
              guideBody2.appendChild(tipEl2);
              const listEl2 = document.createElement('div'); listEl2.style.display='grid'; listEl2.style.gridTemplateColumns='1fr'; listEl2.style.gap='8px';
              const inputs2 = [];
              closure2.forEach((d) => {
                const target = installed2.find(pp => (pp.id === d.name) || (pp.name === d.name));
                const ok2 = !!target && satisfies(target?.version, d.range);
                const row = document.createElement('label'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px';
                const cb = document.createElement('input'); cb.type='checkbox'; cb.dataset.depName=d.name; cb.dataset.depRange=d.range||'';
                const found = !!d.market; cb.disabled = ok2 || !found; cb.checked = found && !ok2;
                const status = ok2 ? '<span class="pill small ok">已安装</span>' : (found ? '<span class="pill small">可安装</span>' : '<span class="pill small danger">未在市场找到</span>');
                row.innerHTML = `<span>${d.name}${d.range ? '@'+d.range : ''}</span>${status}`;
                row.insertBefore(cb, row.firstChild);
                listEl2.appendChild(row);
                inputs2.push(cb);
              });
              guideBody2.appendChild(listEl2);
              const guideActions2 = document.createElement('div'); guideActions2.style.display='flex'; guideActions2.style.justifyContent='flex-end'; guideActions2.style.gap='8px'; guideActions2.style.marginTop='12px';
              const btnCancel2 = document.createElement('button'); btnCancel2.className='btn secondary'; btnCancel2.innerHTML='<i class="ri-close-line"></i> 取消';
              const btnSkip2 = document.createElement('button'); btnSkip2.className='btn secondary'; btnSkip2.innerHTML='<i class="ri-skip-forward-line"></i> 跳过';
              const btnNext2 = document.createElement('button'); btnNext2.className='btn primary'; btnNext2.innerHTML='<i class="ri-arrow-right-line"></i> 下一步';
              guideActions2.appendChild(btnCancel2); guideActions2.appendChild(btnSkip2); guideActions2.appendChild(btnNext2);
              guideOverlay2.appendChild(guideBox2); guideBox2.appendChild(guideTitle2); guideBox2.appendChild(guideBody2); guideBody2.appendChild(guideActions2);
              document.body.appendChild(guideOverlay2);
              const waitGuide2 = await new Promise((resolve)=>{
                btnCancel2.addEventListener('click', ()=>{ try{guideOverlay2.remove();}catch{} resolve({ proceed:false, selected:[] }); });
                btnSkip2.addEventListener('click', ()=>{ try{guideOverlay2.remove();}catch{} resolve({ proceed:true, selected:[] }); });
                btnNext2.addEventListener('click', ()=>{
                  const selected = inputs2.filter(i=>i.checked && !i.disabled).map(i=>{ const mi = findMarketItem2(i.dataset.depName); return { name: i.dataset.depName, range: i.dataset.depRange, market: mi }; });
                  try{guideOverlay2.remove();}catch{} resolve({ proceed:true, selected });
                });
              });
              if (!waitGuide2.proceed) { actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装'; return; }
              if (waitGuide2.selected.length) {
                const ok4 = await showConfirm(`将先安装以下依赖，再安装插件：\n- ${waitGuide2.selected.map(s=>s.name+(s.range?('@'+s.range):'')).join('\n- ')}`);
                if (!ok4) { actionBtn.disabled = false; actionBtn.innerHTML = '<i class="ri-download-2-line"></i> 安装'; return; }
                const base3 = await (async () => {
                  try { const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase'); if (typeof svc === 'string' && svc) return svc; const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase'); return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/'; } catch { return 'http://localhost:3030/'; }
                })();
                for (const s of waitGuide2.selected) {
                  try {
                    if (s.market?.zip) {
                      const url3 = new URL(s.market.zip, base3).toString();
                      const r3 = await fetch(url3); if (!r3.ok) throw new Error('ZIP 下载失败');
                      const b3 = await r3.arrayBuffer(); const n3 = s.market.id ? `${s.market.id}.zip` : `${s.market.name || 'plugin'}.zip`;
                      const o3 = await window.settingsAPI?.installPluginZipData?.(n3, new Uint8Array(b3)); if (!o3?.ok) throw new Error(o3?.error || '安装失败');
                    } else if (s.market?.npm) {
                      const r4 = await window.settingsAPI?.installNpm?.(s.market.npm || s.market.id || s.market.name); if (!r4?.ok) throw new Error(r4?.error || '安装失败');
                    } else {
                      await showAlert(`依赖缺少安装源：${s.name}`);
                    }
                  } catch (e) {
                    await showAlert(`依赖安装失败：${s.name} — ${e?.message || '未知错误'}`);
                  }
                }
              }
            }
            const key = item.id || item.name;
            const res = await window.settingsAPI?.installNpm?.(key);
            if (!res?.ok) throw new Error(res?.error || '安装失败');
            {
              const metaAuthor2 = (typeof res.author === 'object') ? (res.author?.name || JSON.stringify(res.author)) : (res.author || '未知作者');
              const depsObj2 = (typeof res.npmDependencies === 'object' && res.npmDependencies) ? res.npmDependencies : null;
              const depNames2 = depsObj2 ? Object.keys(depsObj2) : [];
              await showAlertWithLogs(
                '插件安装完成',
                `安装成功：${res.name}\n作者：${metaAuthor2}\n依赖：${depNames2.length ? depNames2.join(', ') : '无'}`,
                Array.isArray(res?.logs) ? res.logs : []
              );
            }
          }
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
        // 先确定插件键并查询被依赖情况
        const list = await window.settingsAPI?.getPlugins?.();
        const installed = Array.isArray(list) ? list.find((p) => (
          (item.id && (p.id === item.id)) ||
          (item.name && (p.name === item.name)) ||
          (item.npm && (p.npm === item.npm))
        )) : null;
        const key = installed ? (installed.id || installed.name) : (item.id || item.name);
        let dep = null;
        try { dep = await window.settingsAPI?.pluginDependents?.(key); } catch {}
        const pluginNames = Array.isArray(dep?.plugins) ? dep.plugins.map(p => p.name).join('，') : '';
        const autoNames = Array.isArray(dep?.automations) ? dep.automations.map(a => `${a.name}${a.enabled ? '(已启用)' : ''}`).join('，') : '';
        const extra = [
          pluginNames ? `被以下插件依赖：${pluginNames}` : '',
          autoNames ? `被以下自动化引用：${autoNames}` : ''
        ].filter(Boolean).join('\n');
        const msg = extra ? `确认卸载插件：${item.name}？\n${extra}\n您可以选择继续卸载，已启用的自动化将被禁用。` : `确认卸载插件：${item.name}？\n这将删除其目录与相关文件。`;
        const res = await showModal({ title: '卸载插件', message: msg, confirmText: '卸载', cancelText: '取消' });
        if (!res) return;
        uninstallBtn.disabled = true; uninstallBtn.innerHTML = '<i class="ri-loader-4-line"></i> 卸载中...';
        // 自动禁用引用该插件的已启用自动化
        try {
          if (Array.isArray(dep?.automations)) {
            for (const a of dep.automations) {
              if (a.enabled) {
                try { await window.settingsAPI?.automationToggle?.(a.id, false); } catch {}
              }
            }
          }
        } catch {}
        const out = await window.settingsAPI?.uninstallPlugin?.(key);
        if (!out?.ok) throw new Error(out?.error || '卸载失败');
        await showAlert('已卸载');
        try { overlay.remove(); } catch {}
        const btn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.dataset.page === 'plugins');
        btn?.click?.();
      } catch (e) {
        await showAlert('卸载失败：' + (e?.message || '未知错误'));
        uninstallBtn.disabled = false; uninstallBtn.innerHTML = '<i class="ri-delete-bin-line"></i> 卸载';
      }
    });

    actionBox.appendChild(uninstallBtn);
  }

  // 已移除重复的插件事件绑定，插件逻辑已置于条件分支中

  overlay.appendChild(box);
  box.appendChild(title);
  box.appendChild(body);
  document.body.appendChild(overlay);

  (async () => {
    try {
      // 优先从功能市场服务器读取 README
      const base = await (async () => {
        try {
          const svc = await window.settingsAPI?.configGet?.('system', 'serviceBase');
          if (typeof svc === 'string' && svc) return svc;
          const legacy = await window.settingsAPI?.configGet?.('system', 'marketApiBase');
          return (typeof legacy === 'string' && legacy) ? legacy : 'http://localhost:3030/';
        } catch { return 'http://localhost:3030/'; }
      })();
      let mdText = null;
      if (item.readme) {
        const url = new URL(item.readme, base).toString();
        const res = await fetch(url);
        if (res.ok) mdText = await res.text();
      } else if (item.id) {
        // 回退：automation 类型仅尝试 /data/automation/<id>/README.md；其他类型走 /data/plugins
        if ((item.type || 'plugin') === 'automation') {
          const url = new URL(`/data/automation/${item.id}/README.md`, base).toString();
          const res = await fetch(url);
          if (res.ok) mdText = await res.text();
        } else {
          const url = new URL(`/data/plugins/${item.id}/README.md`, base).toString();
          const res = await fetch(url);
          if (res.ok) mdText = await res.text();
        }
      }
      if (!mdText) {
        // 再回退到在线 npm 镜像或本地
        const key = item.id || item.name;
        const online = await window.settingsAPI?.readmeOnline?.(key);
        mdText = online || (await window.settingsAPI?.getPluginReadme?.(key)) || (item.description || '暂无说明');
      }
      const html = renderMarkdown(mdText || (item.description || '暂无说明'));
      readmeBox.innerHTML = html;

      // 自动化预览：加载并呈现触发/条件/动作
      if ((item.type || 'plugin') === 'automation') {
        try {
          let autoJson = null;
          if (item.automation) {
            const url = new URL(item.automation, base).toString();
            const res = await fetch(url);
            if (res.ok) autoJson = await res.json();
          } else if (item.id) {
            // 回退：automation 仅从 /data/automation/<id>/automation.json 加载
            const url = new URL(`/data/automation/${item.id}/automation.json`, base).toString();
            const res = await fetch(url);
            if (res.ok) autoJson = await res.json();
          }
          const renderTrig = (trigs) => window.AutomationView.renderTriggersHTML(trigs);
          const renderConds = (conds) => window.AutomationView.renderConditionsHTML(conds);
          const renderActs = (acts) => window.AutomationView.renderActionsHTML(acts);
          const summaryHtml = window.AutomationView.renderSummaryHTML(autoJson);
          autoContent.innerHTML = `
            ${summaryHtml}
            <div style="margin-top:8px;">触发条件</div>
            ${renderTrig(autoJson?.triggers)}
            <div style="margin-top:8px;">执行条件</div>
            ${renderConds(autoJson?.conditions)}
            <div style="margin-top:8px;">执行动作</div>
            ${renderActs(autoJson?.actions)}
          `;
        } catch {
          autoContent.innerHTML = '<div class="muted">未能加载自动化示例</div>';
        }
      }
    } catch {
      readmeBox.innerHTML = renderMarkdown(item.description || '暂无说明');
    }
  })();
}