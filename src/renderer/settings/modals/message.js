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

