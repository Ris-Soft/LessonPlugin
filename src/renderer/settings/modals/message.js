// 自绘提示框：Alert / Confirm
function showModal({ title = '提示', message = '', confirmText = '确定', cancelText = null }) {
  return new Promise((resolve) => {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const t = document.createElement('div'); t.className = 'modal-title'; t.textContent = title;
    const msg = document.createElement('div'); msg.className = 'modal-message'; msg.textContent = message;
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
    setTimeout(() => { try { overlay.remove(); } catch {} resolve(true); }, 1500);
  });
}

// 安装完成提示框（带日志容器）：在成功提示中嵌入独立日志区域
async function showAlertWithLogs(title = '安装完成', message = '安装成功', lines = []) {
  return new Promise((resolve) => {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const t = document.createElement('div'); t.className = 'modal-title'; t.textContent = title;
    const msg = document.createElement('div'); msg.className = 'modal-message'; msg.textContent = message || '';
    const logsSection = document.createElement('div'); logsSection.className = 'panel';
    logsSection.style.marginTop = '8px';
    const logsHeader = document.createElement('div'); logsHeader.className = 'section-title';
    logsHeader.innerHTML = '<i class="ri-file-list-2-line"></i> 初始化日志';
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
    box.appendChild(t); box.appendChild(msg);
    if ((Array.isArray(lines) && lines.length) || (typeof lines === 'string' && lines)) {
      logsSection.appendChild(logsHeader);
      logsSection.appendChild(logsBox);
      box.appendChild(logsSection);
    }
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

