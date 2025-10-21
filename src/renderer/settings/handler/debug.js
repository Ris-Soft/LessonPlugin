
async function initDebugSettings() {
  try {
    const iconClassInput = document.getElementById('debug-icon-class');
    const fileNameInput = document.getElementById('debug-filename');
    const bgInput = document.getElementById('debug-bg');
    const transparentInput = document.getElementById('debug-transparent');
    const fgInput = document.getElementById('debug-fg');
    const sizeInput = document.getElementById('debug-size');
    const canvas = document.getElementById('debug-canvas');
    const releaseBtn = document.getElementById('debug-release');
    const openDirBtn = document.getElementById('debug-open-dir');
    const pathEl = document.getElementById('debug-icons-path');

    let iconsDir = '';
    try {
      iconsDir = await window.settingsAPI?.getIconsDir?.();
    } catch {}
    if (pathEl) pathEl.textContent = String(iconsDir || '—');

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

    releaseBtn?.addEventListener('click', async () => {
      try {
        releaseBtn.disabled = true;
        releaseBtn.innerHTML = '<i class="ri-loader-4-line"></i> 释放中...';
        const iconClass = currentIconClass();
        if (!iconClass) {
          await showAlert('请输入 RemixIcon 类名');
          return;
        }
        const nameRaw = (fileNameInput?.value || '').trim();
        let filename = nameRaw || computeDefaultName();
        if (!filename.toLowerCase().endsWith('.png')) filename = `${filename}.png`;
        const dataUrl = canvas?.toDataURL('image/png');
        if (!dataUrl) {
          await showAlert('Canvas 不可用');
          return;
        }
        const res = await window.settingsAPI?.writeIconPng?.(filename, dataUrl);
        if (!res?.ok) {
          await showAlert(res?.error || '写入失败');
          return;
        }
        if (pathEl) pathEl.textContent = String(res.dir || iconsDir || '—');
        await showAlert(`已保存：${res.filePath || (res.dir ? (res.dir + '\\' + filename) : filename)}`);
      } catch (e) {
        await showAlert(e?.message || '写入失败');
      } finally {
        releaseBtn.disabled = false;
        releaseBtn.innerHTML = '<i class="ri-upload-2-line"></i> 释放到 icons 目录';
      }
    });

    openDirBtn?.addEventListener('click', async () => {
      try {
        await window.settingsAPI?.openIconsDir?.();
      } catch {}
    });

    await renderPreview();
  } catch {}
}