// 自绘提示框：Alert / Confirm
function showModal({ title = '提示', message = '', confirmText = '确定', cancelText = null }) {
  return new Promise((resolve) => {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const t = document.createElement('div'); t.className = 'modal-title'; t.textContent = title;
    const msg = document.createElement('div'); msg.className = 'modal-message';
    if (message instanceof Node) {
      msg.appendChild(message);
    } else {
      msg.textContent = String(message || '');
    }
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = confirmText || '确定';
    ok.addEventListener('click', () => { overlay.remove(); resolve(true); });
    actions.appendChild(ok);
    if (cancelText) {
      const cancel = document.createElement('button'); cancel.className = 'btn secondary'; cancel.textContent = cancelText;
      cancel.addEventListener('click', () => { overlay.remove(); resolve(false); });
      actions.appendChild(cancel);
    }
    box.appendChild(t); box.appendChild(msg); box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(!!cancelText ? false : true); } };
    document.addEventListener('keydown', onKey);
  });
}
function showAlert(message, title = '提示') { return showModal({ title, message, confirmText: '好的' }); }
function showConfirm(message, title = '确认') { return showModal({ title, message, confirmText: '确认', cancelText: '取消' }); }

// 简易日志模态框：展示多行日志，显示完毕后自动关闭
async function showLogModal(title = '日志', lines = []) {
  return new Promise((resolve) => {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const t = document.createElement('div'); t.className = 'modal-title'; t.textContent = title;
    const msg = document.createElement('div'); msg.className = 'modal-message';
    msg.style.whiteSpace = 'pre-wrap';
    msg.style.maxHeight = '300px';
    msg.style.overflow = 'auto';
    msg.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = '关闭';
    ok.addEventListener('click', () => { overlay.remove(); resolve(true); });
    actions.appendChild(ok);
    box.appendChild(t); box.appendChild(msg); box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    // 自动关闭
    setTimeout(() => { try { overlay.remove(); } catch { } resolve(true); }, 1500);
  });
}

// 安装完成提示框（带日志容器）：在成功提示中嵌入独立日志区域
async function showAlertWithLogs(title = '安装完成', pluginInfo = {}, lines = []) {
  return new Promise((resolve) => {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const t = document.createElement('div'); t.className = 'modal-title'; t.textContent = title;
    const msg = document.createElement('div'); msg.className = 'modal-message';

    // 如果传入的是字符串（向后兼容），转换为对象
    if (typeof pluginInfo === 'string') {
      const infoSection = document.createElement('div'); infoSection.className = 'section';
      const infoTitle = document.createElement('div'); infoTitle.className = 'section-title'; infoTitle.innerHTML = '<i class="ri-checkbox-circle-line"></i> 安装结果';
      const infoBody = document.createElement('div'); infoBody.style.fontSize = '13px'; infoBody.style.color = 'var(--muted)'; infoBody.style.marginTop = '6px'; infoBody.textContent = pluginInfo || '';
      infoSection.appendChild(infoTitle); infoSection.appendChild(infoBody);
      msg.appendChild(infoSection);
    } else {
      // 新的基本信息卡片显示
      const pluginCard = document.createElement('div');
      pluginCard.className = 'setting-item';
      pluginCard.style.marginBottom = '12px';
      const versionText = pluginInfo.version ? `v${pluginInfo.version}` : '未知版本';
      const authorText = pluginInfo.author || '未知作者';
      const iconCls = pluginInfo.icon || 'ri-puzzle-line';
      pluginCard.innerHTML = `
        <div class="setting-icon"><i class="${iconCls}"></i></div>
        <div class="setting-main">
          <div class="setting-title">${pluginInfo.name || '未知插件'} <span class="pill small plugin-version">${versionText}</span></div>
          <div class="setting-desc">作者：${authorText}</div>
        </div>
      `;
      msg.appendChild(pluginCard);

      // 安装结果信息
      const infoSection = document.createElement('div'); infoSection.className = 'section';
      const infoTitle = document.createElement('div'); infoTitle.className = 'section-title'; infoTitle.innerHTML = '<i class="ri-checkbox-circle-line"></i> 安装结果';
      const infoBody = document.createElement('div'); infoBody.style.fontSize = '13px'; infoBody.style.color = 'var(--muted)'; infoBody.style.marginTop = '6px';
      const pluginDepends = Array.isArray(pluginInfo.pluginDepends) ? pluginInfo.pluginDepends : [];
      const npmDepends = Array.isArray(pluginInfo.npmDepends) ? pluginInfo.npmDepends : [];
      infoBody.innerHTML = `插件依赖：${pluginDepends.length ? pluginDepends.join('，') : '无'}<br>NPM依赖：${npmDepends.length ? npmDepends.join('，') : '无'}`;
      infoSection.appendChild(infoTitle); infoSection.appendChild(infoBody);
      msg.appendChild(infoSection);
    }
    const logsSection = document.createElement('div'); logsSection.className = 'section'; logsSection.style.marginTop = '8px';
    const logsHeader = document.createElement('div'); logsHeader.className = 'section-title'; logsHeader.innerHTML = '<i class="ri-file-list-2-line"></i> 初始化日志';
    const logsBox = document.createElement('div'); logsBox.className = 'modal-logs';
    logsBox.style.whiteSpace = 'pre-wrap';
    logsBox.style.fontFamily = 'monospace';
    logsBox.style.maxHeight = '300px';
    logsBox.style.overflow = 'auto';
    logsBox.textContent = Array.isArray(lines) ? lines.join('\n') : String(lines || '');
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = '好的';
    ok.addEventListener('click', () => { overlay.remove(); resolve(true); });
    actions.appendChild(ok);
    box.appendChild(t);
    if ((Array.isArray(lines) && lines.length) || (typeof lines === 'string' && lines)) {
      logsSection.appendChild(logsHeader);
      logsSection.appendChild(logsBox);
      msg.appendChild(logsSection);
    }
    box.appendChild(msg);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// Toast 通知：非模态、自动消失
function showToast(message = '', { type = 'info', duration = 2000 } = {}) {
  try {
    let container = document.querySelector('.toast-container');
    if (!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = String(message || '');
    container.appendChild(toast);
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });
    setTimeout(() => {
      try { toast.classList.remove('show'); } catch { }
      setTimeout(() => { try { toast.remove(); } catch { } }, 300);
    }, Math.max(1000, duration));
  } catch { }
}

// 统一卸载确认弹窗：返回 { confirmed, dep }
async function showUninstallConfirm(item) {
  try {
    const key = item.id || item.name || item.npm;
    let dep = null;
    try { dep = await window.settingsAPI?.pluginDependents?.(key); } catch { }
    const pluginNames = Array.isArray(dep?.plugins) ? dep.plugins.map(p => p.name).join('，') : '';
    const autoNames = Array.isArray(dep?.automations) ? dep.automations.map(a => `${a.name}${a.enabled ? '(已启用)' : ''}`).join('，') : '';
    const extra = [
      pluginNames ? `被以下插件依赖：${pluginNames}` : '',
      autoNames ? `被以下自动化引用：${autoNames}` : ''
    ].filter(Boolean).join('\n');

    const content = document.createElement('div');

    // 基本信息卡片
    const pluginCard = document.createElement('div');
    pluginCard.className = 'setting-item';
    pluginCard.style.marginBottom = '12px';
    const v = item?.version || item?.detectedVersion;
    const versionText = v ? `v${v}` : '未知版本';
    const authorText = (() => {
      const a = item?.author;
      if (!a) return '未知作者';
      if (typeof a === 'string') return a;
      if (typeof a === 'object') return a.name || JSON.stringify(a);
      return String(a);
    })();
    const iconCls = item?.icon || 'ri-puzzle-line';
    const titleName = item?.name || item?.id || item?.npm || '';
    pluginCard.innerHTML = `
      <div class="setting-icon"><i class="${iconCls}"></i></div>
      <div class="setting-main">
        <div class="setting-title">${titleName} <span class="pill small plugin-version">${versionText}</span></div>
        <div class="setting-desc">作者：${authorText}</div>
      </div>
    `;
    content.appendChild(pluginCard);

    // 依赖警告
    if (extra) {
      const warningBox = document.createElement('div');
      warningBox.className = 'section';
      warningBox.style.cssText = `
        background: rgba(255, 193, 7, 0.1);
        border-color: rgba(255, 193, 7, 0.3);
        margin-bottom: 16px;
      `;
      const warningTitle = document.createElement('div');
      warningTitle.className = 'section-title';
      warningTitle.innerHTML = '<i class="ri-alert-line"></i> 依赖警告';
      const warningBody = document.createElement('div');
      warningBody.style.cssText = 'color: var(--muted); font-size: 13px; line-height: 1.4; margin-top: 8px; white-space: pre-wrap;';
      warningBody.textContent = `${extra}\n您可以选择继续卸载，已启用的自动化将被禁用。`;
      warningBox.appendChild(warningTitle);
      warningBox.appendChild(warningBody);
      content.appendChild(warningBox);
    }

    const confirmText = document.createElement('div');
    confirmText.style.cssText = 'color: var(--muted); font-size: 14px; margin-top: 8px;';
    confirmText.textContent = '这将删除插件目录与相关文件。';
    content.appendChild(confirmText);

    const confirmed = await showModal({ title: '卸载插件', message: content, confirmText: '卸载', cancelText: '取消' });
    return { confirmed, dep: dep || {} };
  } catch { return { confirmed: false, dep: {} }; }
}

// 进度模态框：用于展示下载/安装过程进度，返回控制器 { update, close }
function showProgressModal(title = '下载/安装进度', initialMessage = '准备中...') {
  const old = document.querySelector('.modal-overlay');
  if (old) try { old.remove(); } catch {}
  const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
  const box = document.createElement('div'); box.className = 'modal-box';
  const t = document.createElement('div'); t.className = 'modal-title'; t.textContent = title;
  const msg = document.createElement('div'); msg.className = 'modal-message';
  msg.style.whiteSpace = 'normal';
  const statusLine = document.createElement('div');
  statusLine.style.cssText = 'font-size: 14px; color: var(--muted); margin-bottom: 8px;';
  statusLine.textContent = initialMessage || '准备中...';
  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.style.cssText = 'height:8px;background:rgba(255,255,255,0.08);border:1px solid var(--border);border-radius:999px;overflow:hidden;';
  const bar = document.createElement('div');
  bar.className = 'progress-inner';
  bar.style.cssText = 'height:100%;width:0%;background:var(--accent);transition:width .25s;';
  progress.appendChild(bar);
  const actions = document.createElement('div'); actions.className = 'modal-actions';
  // 执行中不提供取消，仅在外部调用 close() 时关闭
  const closeBtn = document.createElement('button'); closeBtn.className = 'btn secondary'; closeBtn.textContent = '隐藏';
  closeBtn.addEventListener('click', () => { try { overlay.remove(); } catch {} });
  actions.appendChild(closeBtn);
  msg.appendChild(statusLine);
  msg.appendChild(progress);
  box.appendChild(t); box.appendChild(msg); box.appendChild(actions);
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const controller = {
    update: (payload) => {
      try {
        const stage = payload?.stage || '';
        const message = payload?.message || '';
        const percent = Number(payload?.percent || payload?.progress || NaN);
        // 仅当提供 message 时更新文字
        if (message) statusLine.textContent = message;
        // 百分比存在时更新进度条
        if (!Number.isNaN(percent)) {
          const clamped = Math.max(0, Math.min(100, percent));
          bar.style.width = clamped + '%';
        } else {
          // 无百分比时显示不定进度动画（通过条纹过渡实现）
          bar.style.width = '35%';
          bar.style.transition = 'width .8s ease-in-out';
          // 简易往返动画
          let dir = 1;
          if (!bar._animTimer) {
            bar._animTimer = setInterval(() => {
              const w = parseFloat(bar.style.width) || 0;
              const next = dir > 0 ? Math.min(85, w + 15) : Math.max(15, w - 15);
              if (next >= 85) dir = -1; else if (next <= 15) dir = 1;
              bar.style.width = next + '%';
            }, 800);
          }
        }
        // 完成或错误阶段时自动关闭动画，并将进度置为 100%
        if (String(stage).toLowerCase() === 'done' || String(stage).toLowerCase() === 'error' || /完成/.test(message)) {
          if (bar._animTimer) { try { clearInterval(bar._animTimer); } catch {} bar._animTimer = null; }
          bar.style.width = '100%';
        }
      } catch {}
    },
    close: () => {
      try {
        if (bar._animTimer) { clearInterval(bar._animTimer); bar._animTimer = null; }
        overlay.remove();
      } catch {}
    }
  };
  return controller;
}

