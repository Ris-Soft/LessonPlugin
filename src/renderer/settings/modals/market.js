function showStorePluginModal(item) {
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

  const depsObj = (item && typeof item.dependencies === 'object' && item.dependencies) ? item.dependencies : null;
  const depsKeys = depsObj ? Object.keys(depsObj) : [];
  const depsHtml = depsKeys.length
    ? depsKeys.slice(0, 6).map(k => `<span class=\"pill small\">${k}</span>`).join(' ') + (depsKeys.length > 6 ? ` <span class=\"pill small muted\">+${depsKeys.length - 6}</span>` : '')
    : '<span class=\"muted\">无依赖</span>';

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
    <div class=\"section-title\"><i class=\"ri-git-repository-line\"></i> 依赖</div>
    <div>${depsHtml}</div>
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
            const out = await window.settingsAPI?.installPluginZipData?.(name, new Uint8Array(buf));
            if (!out?.ok) throw new Error(out?.error || '安装失败');
            await showAlert('安装完成');
          } else {
            const key = item.id || item.name;
            const res = await window.settingsAPI?.installNpm?.(key);
            if (!res?.ok) throw new Error(res?.error || '安装失败');
            await showAlert('安装完成');
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
        const res = await showModal({ title: '卸载插件', message: `确认卸载插件：${item.name}？\n这将删除其目录与相关文件。`, confirmText: '卸载', cancelText: '取消' });
        if (!res) return;
        uninstallBtn.disabled = true; uninstallBtn.innerHTML = '<i class="ri-loader-4-line"></i> 卸载中...';
        const list = await window.settingsAPI?.getPlugins?.();
        const installed = Array.isArray(list) ? list.find((p) => (
          (item.id && (p.id === item.id)) ||
          (item.name && (p.name === item.name)) ||
          (item.npm && (p.npm === item.npm))
        )) : null;
        const key = installed ? (installed.id || installed.name) : (item.id || item.name);
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