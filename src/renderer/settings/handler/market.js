
// 辅助：加载本地 JSON（相对 settings.html 路径）
async function fetchJson(path) {
  const url = new URL(path, location.href).toString();
  const res = await fetch(url);
  if (!res.ok) throw new Error('加载失败: ' + path);
  return await res.json();
}



function renderStoreCard(item, installedList) {
  const el = document.createElement('div');
  el.className = 'store-card plugin-card';
  const versionText = item.version ? `v${item.version}` : '';
  const authorText = (() => {
    const a = item.author;
    if (!a) return '未知作者';
    if (typeof a === 'string') return a;
    if (typeof a === 'object') return a.name || JSON.stringify(a);
    return String(a);
  })();
  const pkg = item.npm || item.id || item.name;
  el.innerHTML = `
    <div class="card-header" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">
      <div style="display:flex;gap:12px;">
        <i class="${item.icon || 'ri-puzzle-line'}"></i>
        <div>
          <div class="card-title">${item.name} ${versionText ? `<span class=\"pill small plugin-version\">${versionText}</span>` : ''}</div>
          <div class="card-desc">${item.description || ''}</div>
          <div class="muted">作者：${authorText}</div>
        </div>
      </div>
      <div class="card-action" style="flex-shrink:0;">
        <button class="btn primary" data-action="install"><i class="ri-download-2-line"></i> 安装</button>
      </div>
    </div>
  `;
  const btnInstall = el.querySelector('button[data-action="install"]');
  const isPluginType = (item.type || 'plugin') === 'plugin';
  const installed = Array.isArray(installedList) ? installedList.find((p) => (
    (item.id && (p.id === item.id)) ||
    (item.name && (p.name === item.name)) ||
    (item.npm && (p.npm === item.npm))
  )) : null;
  const isInstalled = !!installed;

  // 非插件类型：允许点击进入详情预览
  if (!isPluginType) {
    btnInstall.disabled = false;
    btnInstall.innerHTML = '<i class="ri-eye-line"></i> 预览';
    btnInstall.addEventListener('click', () => { try { showStorePluginModal(item); } catch {} });
  }

  const setInstallButton = async () => {
    try {
      if (!isPluginType) return;
      // ZIP 安装或 NPM 安装的按钮状态
      if (!isInstalled) {
        btnInstall.disabled = false;
        btnInstall.innerHTML = '<i class="ri-download-2-line"></i> 安装';
        return;
      }
      // 已安装：若无 npm 源，则仅显示“已安装”
      if (!item.npm) {
        btnInstall.disabled = true;
        btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装';
        return;
      }
      const res = await window.settingsAPI?.npmGetVersions?.(item.npm);
      const versions = (res?.ok && Array.isArray(res.versions)) ? res.versions : [];
      const latest = versions.length ? versions[versions.length - 1] : null;
      const installedVersion = installed?.version || null;
      if (latest && installedVersion && latest !== installedVersion) {
        btnInstall.disabled = false;
        btnInstall.innerHTML = `<i class=\"ri-refresh-line\"></i> 更新到 v${latest}`;
        btnInstall.dataset.latest = latest;
      } else {
        btnInstall.disabled = true;
        btnInstall.innerHTML = '<i class="ri-checkbox-circle-line"></i> 已安装';
        btnInstall.dataset.latest = '';
      }
    } catch {
      btnInstall.disabled = isInstalled;
      btnInstall.innerHTML = isInstalled ? '<i class="ri-checkbox-circle-line"></i> 已安装' : '<i class="ri-download-2-line"></i> 安装';
    }
  };

  if (isPluginType) {
    setInstallButton();
    btnInstall.addEventListener('click', async () => {
      try {
        const latest = btnInstall.dataset.latest;
        btnInstall.disabled = true; btnInstall.innerHTML = '<i class="ri-loader-4-line"></i> 处理中...';
        if (latest) {
          const dl = await window.settingsAPI?.npmDownload?.(item.npm, latest);
          if (!dl?.ok) throw new Error(dl?.error || '下载失败');
          const sw = await window.settingsAPI?.npmSwitch?.(item.id || item.name, item.npm, latest);
          if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
          await showAlert('已更新到最新版本');
        } else {
          // 若存在 ZIP 字段，走 ZIP 安装
          if (item.zip) {
            try {
              const base = await getMarketBase();
              const url = new URL(item.zip, base).toString();
              const res = await fetch(url);
              if (!res.ok) throw new Error('ZIP 下载失败');
              const buf = await res.arrayBuffer();
              const name = item.id ? `${item.id}.zip` : `${item.name || 'plugin'}.zip`;
              // 安装前检查ZIP并弹出美化确认窗口
              try {
                const inspect = await window.settingsAPI?.inspectPluginZipData?.(name, new Uint8Array(buf));
                if (inspect?.ok) {
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
                    if (!range) return !!ver; const v=parseVer(ver); const r=String(range).trim(); const plain=r.replace(/^[~^]/,''); const base=parseVer(plain);
                    if (r.startsWith('^')) return (v.m===base.m) && (cmp(v,base)>=0);
                    if (r.startsWith('~')) return (v.m===base.m) && (v.n===base.n) && (cmp(v,base)>=0);
                    if (r.startsWith('>=')) return cmp(v, parseVer(r.slice(2)))>=0;
                    if (r.startsWith('>')) return cmp(v, parseVer(r.slice(1)))>0;
                    if (r.startsWith('<=')) return cmp(v, parseVer(r.slice(2)))<=0;
                    if (r.startsWith('<')) return cmp(v, parseVer(r.slice(1)))<0;
                    const exact=parseVer(r); return cmp(v, exact)===0;
                  };
                  const depPills = pluginDepends.map(d => {
                    const [depName, depRange] = String(d).split('@');
                    const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
                    const ok = !!target && satisfies(target?.version, depRange);
                    const icon = ok ? 'ri-check-line' : 'ri-close-line';
                    const cls = ok ? 'pill small ok' : 'pill small danger';
                    return `<span class=\"${cls}\"><i class=\"${icon}\"></i> ${depName}${depRange ? '@'+depRange : ''}</span>`;
                  }).join(' ');
                  const hasUnsatisfied = pluginDepends.some(d => {
                    const [depName, depRange] = String(d).split('@');
                    const target = installed.find(pp => (pp.id === depName) || (pp.name === depName));
                    return !(!!target && satisfies(target?.version, depRange));
                  });
                  const npmPills = depNames.map(k => `<span class=\"pill small\">${k}</span>`).join(' ');
                  // 引导依赖安装弹窗：展示依赖（含上级依赖），可多选，默认市场可安装的依赖选中；已满足或未在市场找到的禁用
                  const catalog = Array.isArray(window.__marketCatalog__) ? window.__marketCatalog__ : [];
                  const findMarketItem = (name) => catalog.find((x) => (x.id === name) || (x.name === name));
                  const resolveClosure = (deps) => {
                    const seen = new Set(); const out = []; const queue = Array.isArray(deps) ? deps.slice() : [];
                    while (queue.length) {
                      const raw = queue.shift(); const [depName, depRange] = String(raw).split('@');
                      const key = depName.trim(); if (!key || seen.has(key)) continue; seen.add(key);
                      const mi = findMarketItem(key) || null; out.push({ name: key, range: depRange || '', market: mi });
                      const next = Array.isArray(mi?.dependencies) ? mi.dependencies.slice() : []; queue.push(...next);
                    }
                    return out;
                  };
                  const closure = resolveClosure(pluginDepends);
                  const guideOverlay = document.createElement('div'); guideOverlay.className = 'modal-overlay';
                  const guideBox = document.createElement('div'); guideBox.className = 'modal-box';
                  const guideTitle = document.createElement('div'); guideTitle.className = 'modal-title';
                  guideTitle.innerHTML = `<i class=\"${item.icon || 'ri-puzzle-line'}\"></i> 插件安装向导 — ${inspect.name || item.name}`;
                  const guideBody = document.createElement('div'); guideBody.className = 'modal-body';
                  guideBody.innerHTML = `
                    <div class=\"setting-item\">
                      <div class=\"setting-icon\"><i class=\"${item.icon || 'ri-puzzle-line'}\"></i></div>
                      <div class=\"setting-main\">
                        <div class=\"setting-title\">${inspect.name || item.name}</div>
                        <div class=\"setting-desc\">作者：${authorVal}</div>
                      </div>
                    </div>
                    <br>
                    <div class=\"section-title\"><i class=\"ri-git-repository-line\"></i> 插件依赖（含上级依赖）</div>
                    <div class=\"muted\">未选择的依赖将跳过安装</div>
                  `;
                  const listEl = document.createElement('div'); listEl.style.display='grid'; listEl.style.gridTemplateColumns='1fr'; listEl.style.gap='8px';
                  const inputs = [];
                  closure.forEach((d) => {
                    const target = installed.find(pp => (pp.id === d.name) || (pp.name === d.name));
                    const ok2 = !!target && satisfies(target?.version, d.range);
                    const row = document.createElement('label'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px';
                    const cb = document.createElement('input'); cb.type='checkbox'; cb.dataset.depName=d.name; cb.dataset.depRange=d.range||'';
                    const found = !!d.market; cb.disabled = ok2 || !found; cb.checked = found && !ok2;
                    const status = ok2 ? '<span class=\"pill small ok\">已安装</span>' : (found ? '<span class=\"pill small\">可安装</span>' : '<span class=\"pill small danger\">未在市场找到</span>');
                    row.innerHTML = `<span>${d.name}${d.range ? '@'+d.range : ''}</span>${status}`;
                    row.insertBefore(cb, row.firstChild);
                    listEl.appendChild(row);
                    inputs.push(cb);
                  });
                  guideBody.appendChild(listEl);
                  const guideActions = document.createElement('div'); guideActions.style.display='flex'; guideActions.style.justifyContent='flex-end'; guideActions.style.gap='8px'; guideActions.style.marginTop='12px';
                  const btnCancel = document.createElement('button'); btnCancel.className='btn secondary'; btnCancel.innerHTML='<i class=\"ri-close-line\"></i> 取消';
                  const btnSkip = document.createElement('button'); btnSkip.className='btn secondary'; btnSkip.innerHTML='<i class=\"ri-skip-forward-line\"></i> 跳过';
                  const btnNext = document.createElement('button'); btnNext.className='btn primary'; btnNext.innerHTML='<i class=\"ri-arrow-right-line\"></i> 下一步';
                  guideActions.appendChild(btnCancel); guideActions.appendChild(btnSkip); guideActions.appendChild(btnNext);
                  guideOverlay.appendChild(guideBox); guideBox.appendChild(guideTitle); guideBox.appendChild(guideBody); guideBody.appendChild(guideActions);
                  document.body.appendChild(guideOverlay);
                  const waitGuide = await new Promise((resolve)=>{
                    btnCancel.addEventListener('click', ()=>{ try{guideOverlay.remove();}catch{} resolve({ proceed:false, selected:[] }); }); // 取消整个安装流程
                    btnSkip.addEventListener('click', ()=>{ try{guideOverlay.remove();}catch{} resolve({ proceed:true, selected:[] }); }); // 跳过依赖但继续安装插件
                    btnNext.addEventListener('click', ()=>{
                      const selected = inputs.filter(i=>i.checked && !i.disabled).map(i=>{ const mi = findMarketItem(i.dataset.depName); return { name: i.dataset.depName, range: i.dataset.depRange, market: mi }; });
                      try{guideOverlay.remove();}catch{} resolve({ proceed:true, selected });
                    });
                  });
                  if (!waitGuide.proceed) { setInstallButton(); return; }
                  if (waitGuide.proceed && waitGuide.selected.length) {
                    const ok3 = await showConfirm(`将先安装以下依赖，再安装插件：\n- ${waitGuide.selected.map(s=>s.name+(s.range?('@'+s.range):'')).join('\n- ')}`);
                    // 若用户取消提示，则不安装依赖，仅继续安装插件
                    if (ok3) {
                      const base2 = await getMarketBase();
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
            } catch (e) {
              throw e;
            }
          } else {
            const pkg = item.npm || item.id || item.name;
            // 在直接安装 NPM 前，引导安装插件依赖（含上级依赖），可忽略不安装
            try {
              const installed2 = Array.isArray(await window.settingsAPI?.getPlugins?.()) ? await window.settingsAPI.getPlugins() : [];
              const pluginDepends2 = Array.isArray(item.dependencies) ? item.dependencies : [];
              const parseVer2 = (v) => { const m = String(v||'0.0.0').split('.').map(x=>parseInt(x,10)||0); return { m:m[0]||0, n:m[1]||0, p:m[2]||0 }; };
              const cmp2 = (a,b)=>{ if(a.m!==b.m) return a.m-b.m; if(a.n!==b.n) return a.n-b.n; return a.p-b.p; };
              const satisfies2 = (ver, range) => {
                if (!range) return !!ver; const v=parseVer2(ver); const r=String(range).trim(); const plain=r.replace(/^[~^]/,''); const base=parseVer2(plain);
                if (r.startsWith('^')) return (v.m===base.m) && (cmp2(v,base)>=0);
                if (r.startsWith('~')) return (v.m===base.m) && (v.n===base.n) && (cmp2(v,base)>=0);
                if (r.startsWith('>=')) return cmp2(v, parseVer2(r.slice(2)))>=0;
                if (r.startsWith('>')) return cmp2(v, parseVer2(r.slice(1)))>0;
                if (r.startsWith('<=')) return cmp2(v, parseVer2(r.slice(2)))<=0;
                if (r.startsWith('<')) return cmp2(v, parseVer2(r.slice(1)))<0;
                const exact=parseVer2(r); return cmp2(v, exact)===0;
              };
              const needGuide = pluginDepends2.length > 0;
              if (needGuide) {
                const catalog2 = Array.isArray(window.__marketCatalog__) ? window.__marketCatalog__ : [];
                const findMarketItem2 = (name) => catalog2.find((x) => (x.id === name) || (x.name === name));
                const resolveClosure2 = (deps) => { const seen=new Set(); const out=[]; const queue=deps.slice(); while(queue.length){ const raw=queue.shift(); const [n,r]=String(raw).split('@'); const key=String(n||'').trim(); if(!key||seen.has(key)) continue; seen.add(key); const mi=findMarketItem2(key)||null; out.push({name:key,range:r||'',market:mi}); const next=Array.isArray(mi?.dependencies)?mi.dependencies.slice():[]; queue.push(...next);} return out; };
                const closure2 = resolveClosure2(pluginDepends2);
                const overlay2 = document.createElement('div'); overlay2.className='modal-overlay';
                const box2 = document.createElement('div'); box2.className='modal-box';
                const title2 = document.createElement('div'); title2.className='modal-title'; title2.innerHTML = `<i class=\"${item.icon || 'ri-puzzle-line'}\"></i> 插件安装向导 — ${item.name}`;
                const body2 = document.createElement('div'); body2.className='modal-body';
                const tip2 = document.createElement('div'); tip2.className='muted'; tip2.textContent='未选择的依赖将跳过安装';
                const list2 = document.createElement('div'); list2.style.display='grid'; list2.style.gridTemplateColumns='1fr'; list2.style.gap='8px';
                const inputs2 = [];
                closure2.forEach((d)=>{ const target=installed2.find(pp => (pp.id===d.name)||(pp.name===d.name)); const ok=satisfies2(target?.version, d.range); const row=document.createElement('label'); row.style.display='flex'; row.style.alignItems='center'; row.style.gap='8px'; const cb=document.createElement('input'); cb.type='checkbox'; cb.dataset.depName=d.name; cb.dataset.depRange=d.range||''; const found=!!d.market; cb.disabled=ok||!found; cb.checked=found&&!ok; const status=ok?'<span class=\"pill small ok\">已安装</span>':(found?'<span class=\"pill small\">可安装</span>':'<span class=\"pill small danger\">未在市场找到</span>'); row.innerHTML=`<span>${d.name}${d.range?'@'+d.range:''}</span>${status}`; row.insertBefore(cb, row.firstChild); list2.appendChild(row); inputs2.push(cb); });
                const actions2 = document.createElement('div'); actions2.style.display='flex'; actions2.style.justifyContent='flex-end'; actions2.style.gap='8px'; actions2.style.marginTop='12px';
                const btnCancel2 = document.createElement('button'); btnCancel2.className='btn secondary'; btnCancel2.innerHTML='<i class=\"ri-close-line\"></i> 取消';
                const btnSkip2 = document.createElement('button'); btnSkip2.className='btn secondary'; btnSkip2.innerHTML='<i class=\"ri-skip-forward-line\"></i> 跳过';
                const btnNext2 = document.createElement('button'); btnNext2.className='btn primary'; btnNext2.innerHTML='<i class=\"ri-arrow-right-line\"></i> 下一步';
                actions2.appendChild(btnCancel2); actions2.appendChild(btnSkip2); actions2.appendChild(btnNext2);
                body2.appendChild(tip2); body2.appendChild(list2); body2.appendChild(actions2);
                overlay2.appendChild(box2); box2.appendChild(title2); box2.appendChild(body2);
                document.body.appendChild(overlay2);
                const wait2 = await new Promise((resolve)=>{ 
                  btnCancel2.addEventListener('click', ()=>{ try{overlay2.remove();}catch{} resolve({ proceed:false, selected:[] }); });
                  btnSkip2.addEventListener('click', ()=>{ try{overlay2.remove();}catch{} resolve({ proceed:true, selected:[] }); }); 
                  btnNext2.addEventListener('click', ()=>{ 
                    const selected=inputs2.filter(i=>i.checked&&!i.disabled).map(i=>{ const mi=findMarketItem2(i.dataset.depName); return { name:i.dataset.depName, range:i.dataset.depRange, market:mi }; }); 
                    try{overlay2.remove();}catch{} resolve({ proceed:true, selected }); 
                  }); 
                });
                if (!wait2.proceed) { setInstallButton(); return; }
                if (wait2.proceed && wait2.selected.length) {
                  const okx = await showConfirm(`将先安装以下依赖，再安装插件：\n- ${wait2.selected.map(s=>s.name+(s.range?('@'+s.range):'')).join('\n- ')}`);
                  if (okx) {
                    const baseX = await getMarketBase();
                    for (const s of wait2.selected) {
                      try {
                        if (s.market?.zip) {
                          const urlX = new URL(s.market.zip, baseX).toString(); const resX = await fetch(urlX); if (!resX.ok) throw new Error('ZIP 下载失败');
                          const bufX = await resX.arrayBuffer(); const nameX = s.market.id ? `${s.market.id}.zip` : `${s.market.name || 'plugin'}.zip`;
                          const outX = await window.settingsAPI?.installPluginZipData?.(nameX, new Uint8Array(bufX)); if (!outX?.ok) throw new Error(outX?.error || '安装失败');
                        } else if (s.market?.npm) {
                          const resY = await window.settingsAPI?.installNpm?.(s.market.npm || s.market.id || s.market.name); if (!resY?.ok) throw new Error(resY?.error || '安装失败');
                        } else {
                          await showAlert(`依赖缺少安装源：${s.name}`);
                        }
                      } catch (e) {
                        await showAlert(`依赖安装失败：${s.name} — ${e?.message || '未知错误'}`);
                      }
                    }
                  }
                }
              }
            } catch {}
            const res = await window.settingsAPI?.installNpm?.(pkg);
            if (!res?.ok) throw new Error(res?.error || '安装失败');
            const metaAuthor = (typeof res.author === 'object') ? (res.author?.name || JSON.stringify(res.author)) : (res.author || '未知作者');
            const depsObj = (typeof res.npmDependencies === 'object' && res.npmDependencies) ? res.npmDependencies : null;
            const depNames = depsObj ? Object.keys(depsObj) : [];
            await showAlertWithLogs(
              '插件安装完成',
              `安装成功：${res.name}\n作者：${metaAuthor}\n依赖：${depNames.length ? depNames.join(', ') : '无'}`,
              Array.isArray(res?.logs) ? res.logs : []
            );
          }
        }
        const active = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.classList.contains('active'));
        active?.click?.();
        // 安装或更新成功后刷新插件管理页面（仅显示包含动作的插件）
        try {
          const container = document.getElementById('plugins');
          const list = await fetchPlugins();
          const filtered = list.filter((p) => Array.isArray(p.actions) && p.actions.length > 0);
          container.innerHTML = '';
          filtered.forEach((p) => container.appendChild(renderPlugin(p)));
        } catch {}
      } catch (err) {
        alert(err?.message || '操作失败');
        setInstallButton();
      }
    });
  }

  el.addEventListener('click', (evt) => {
    if (evt.target === btnInstall || btnInstall.contains(evt.target)) return;
    try { showStorePluginModal(item); } catch {}
  });
  return el;
}

function renderUpdateCard(p) {
  const el = document.createElement('div');
  el.className = 'store-card plugin-card';
  el.style.width = '100%';
  const versionText = p.version ? `v${p.version}` : '';
  const latestText = p.latest ? `v${p.latest}` : '';
  el.innerHTML = `
    <div class=\"card-header\" style=\"display:flex;justify-content:space-between;align-items:flex-start;gap:12px;\">
      <div style=\"display:flex;gap:12px;\">
        <i class=\"${p.icon || 'ri-refresh-line'}\"></i>
        <div>
          <div class=\"card-title\">${p.name} <span class=\\\"pill small\\\">当前 ${versionText}</span> <span class=\\\"pill small primary\\\">最新 ${latestText}</span></div>
          <div class=\"card-desc\">${p.description || ''}</div>
          <div class=\"muted\">提示：该功能可更新</div>
        </div>
      </div>
      <div class=\"card-action\" style=\"flex-shrink:0;\">
        <button class=\"btn primary\"><i class=\"ri-download-2-line\"></i> 更新到 ${latestText}</button>
      </div>
    </div>
  `;
  const btn = el.querySelector('button.btn.primary');
  btn.addEventListener('click', async () => {
    try {
      btn.disabled = true; btn.innerHTML = '<i class=\"ri-loader-4-line\"></i> 更新中...';
      const dl = await window.settingsAPI?.npmDownload?.(p.npm, p.latest);
      if (!dl?.ok) throw new Error(dl?.error || '下载失败');
      const sw = await window.settingsAPI?.npmSwitch?.(p.id || p.name, p.npm, p.latest);
      if (!sw?.ok) throw new Error(sw?.error || '切换版本失败');
      await showAlert('已更新到最新版本');
      const btnNav = Array.from(document.querySelectorAll('#page-market .store-tabs .sub-item')).find(b => b.dataset.storeTab === 'updates');
      btnNav?.click?.();
      // 更新成功后刷新插件管理页面
      try {
        const container = document.getElementById('plugins');
        const list = await fetchPlugins();
        const filtered = list.filter((pp) => Array.isArray(pp.actions) && pp.actions.length > 0);
        container.innerHTML = '';
        filtered.forEach((pp) => container.appendChild(renderPlugin(pp)));
      } catch {}
    } catch (e) {
      alert('更新失败：' + (e?.message || '未知错误'));
      btn.disabled = false; btn.innerHTML = `<i class=\"ri-download-2-line\"></i> 更新到 ${latestText}`;
    }
  });
  return el;
}