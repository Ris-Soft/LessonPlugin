function showIconAddModal() {
  try {
    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    const box = document.createElement('div');
    box.className = 'modal-box';
    const title = document.createElement('div');
    title.className = 'modal-title';
    title.innerHTML = '<i class="ri-image-add-line"></i> 加入项目图标';
    const body = document.createElement('div');
    body.className = 'modal-body';
    const actions = document.createElement('div');
    actions.className = 'modal-actions';

    const form = document.createElement('div');
    form.className = 'form';
    form.innerHTML = `
      <div class="form-row">
        <input id="icon-menu-class" type="text" placeholder="ri-settings-3-line" />
        <input id="icon-menu-filename" type="text" placeholder="文件名（如 ri-settings-3-line.png）" />
      </div>
      <div class="form-row">
        <label class="muted">背景</label>
        <input id="icon-menu-bg" class="color-input" type="color" value="#111827" />
        <label class="muted">透明背景</label>
        <input id="icon-menu-transparent" type="checkbox" />
        <label class="muted">前景</label>
        <input id="icon-menu-fg" class="color-input" type="color" value="#ffffff" />
        <label class="muted">尺寸</label>
        <input id="icon-menu-size" type="number" value="256" min="64" max="1024" step="16" />
      </div>
      <canvas id="icon-menu-canvas" class="preview-canvas" width="256" height="256"></canvas>
      <div class="muted">输出目录：<span id="icon-menu-path">—</span></div>
    `;

    const cancelBtn = document.createElement('button');
    cancelBtn.className = 'btn secondary';
    cancelBtn.textContent = '取消';
    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn primary';
    saveBtn.innerHTML = '<i class="ri-save-3-line"></i> 保存到 icons 目录';

    actions.appendChild(cancelBtn);
    actions.appendChild(saveBtn);
    body.appendChild(form);
    box.appendChild(title);
    box.appendChild(body);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);

    const iconClassInput = form.querySelector('#icon-menu-class');
    const fileNameInput = form.querySelector('#icon-menu-filename');
    const bgInput = form.querySelector('#icon-menu-bg');
    const transparentInput = form.querySelector('#icon-menu-transparent');
    const fgInput = form.querySelector('#icon-menu-fg');
    const sizeInput = form.querySelector('#icon-menu-size');
    const canvas = form.querySelector('#icon-menu-canvas');
    const pathEl = form.querySelector('#icon-menu-path');
    let iconsDir = '';
    (async () => { try { iconsDir = await window.settingsAPI?.getIconsDir?.(); pathEl.textContent = String(iconsDir || '—'); } catch {} })();

    const currentIconClass = () => (iconClassInput?.value?.trim() || 'ri-settings-3-line');
    let lastDefaultName = '';
    const computeDefaultName = () => `${currentIconClass().replace(/\s+/g, '')}.png`;

    async function renderPreview() {
      try {
        const iconClass = currentIconClass();
        let size = parseInt(sizeInput?.value || '256', 10);
        if (Number.isNaN(size)) size = 256;
        size = Math.max(64, Math.min(1024, size));
        const transparent = !!transparentInput?.checked;
        const bg = transparent ? 'transparent' : (bgInput?.value || '#111827');
        const fg = fgInput?.value || '#ffffff';
        await drawRemixIconCanvas(iconClass, canvas, bg, fg, size);
        if (fileNameInput) {
          const def = computeDefaultName();
          if (!fileNameInput.value || fileNameInput.value === lastDefaultName) {
            fileNameInput.value = def;
            lastDefaultName = def;
          }
        }
      } catch {}
    }

    iconClassInput?.addEventListener('input', renderPreview);
    bgInput?.addEventListener('input', renderPreview);
    transparentInput?.addEventListener('change', renderPreview);
    fgInput?.addEventListener('input', renderPreview);
    sizeInput?.addEventListener('input', renderPreview);

    cancelBtn.addEventListener('click', () => { try { overlay.remove(); } catch {} });
    saveBtn.addEventListener('click', async () => {
      try {
        saveBtn.disabled = true; saveBtn.innerHTML = '<i class="ri-loader-4-line"></i> 保存中...';
        const iconClass = currentIconClass();
        if (!iconClass) { await showAlert('请输入 RemixIcon 类名'); return; }
        const nameRaw = (fileNameInput?.value || '').trim();
        let filename = nameRaw || computeDefaultName();
        if (!filename.toLowerCase().endsWith('.png')) filename = `${filename}.png`;
        const dataUrl = canvas?.toDataURL('image/png');
        if (!dataUrl) { await showAlert('Canvas 不可用'); return; }
        const res = await window.settingsAPI?.writeIconPng?.(filename, dataUrl);
        if (!res?.ok) { await showAlert(res?.error || '写入失败'); return; }
        const savedPath = res?.path || '';
        pathEl.textContent = String(iconsDir || '—');
        await showToast(`已保存：${savedPath || filename}`);
        try { overlay.remove(); } catch {}
      } catch (e) {
        await showAlert(e?.message || '写入失败');
      } finally {
        saveBtn.disabled = false; saveBtn.innerHTML = '<i class="ri-save-3-line"></i> 保存到 icons 目录';
      }
    });

    renderPreview();
  } catch {}
}

try { window.settingsAPI?.onOpenIconAdder?.(() => showIconAddModal()); } catch {}
