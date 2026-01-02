
async function initDebugSettings() {
  try {
    // 子页切换逻辑
    const subItems = document.querySelectorAll('#page-debug .subnav .sub-item');
    const runPanel = document.getElementById('debug-run');
    const iconsPanel = document.getElementById('debug-icons');
    const logsPanel = document.getElementById('debug-logs');
    const logList = document.getElementById('backend-log-list');
    subItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        subItems.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const sub = btn.dataset.sub;
        runPanel.hidden = sub !== 'run';
        iconsPanel.hidden = sub !== 'icons';
        logsPanel.hidden = sub !== 'logs';
        if (sub === 'logs') {
          // 初次进入日志页，拉取最近记录并订阅实时日志
          if (logList && logList.dataset.bound !== '1') {
            logList.dataset.bound = '1';
            (async () => {
              try {
                const last = await window.settingsAPI?.backendLogsGet?.();
                if (Array.isArray(last)) {
                  logList.innerHTML = '';
                  last.forEach((line) => {
                    const row = document.createElement('div');
                    row.textContent = String(line || '');
                    logList.appendChild(row);
                  });
                  logList.scrollTop = logList.scrollHeight;
                }
              } catch (e) {}
            })();
            try {
              window.settingsAPI?.onBackendLog?.((line) => {
                try {
                  const row = document.createElement('div');
                  row.textContent = String(line || '');
                  logList.appendChild(row);
                  // 自动滚动到底部
                  logList.scrollTop = logList.scrollHeight;
                } catch (e) {}
              });
            } catch (e) {}
          }
        }
      });
    });

    // 运行管理：填充基本信息与重启按钮
    (async () => {
      try {
        const info = await window.settingsAPI?.getAppInfo?.();
        document.getElementById('debug-app-version').textContent = info?.appVersion || '—';
        document.getElementById('debug-electron').textContent = info?.electronVersion || (navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] || '—');
        document.getElementById('debug-node').textContent = info?.nodeVersion || (process?.versions?.node || '—');
        document.getElementById('debug-chrome').textContent = info?.chromeVersion || (process?.versions?.chrome || '—');
        document.getElementById('debug-platform').textContent = info?.platform || (process?.platform || navigator?.platform || '—');
      } catch (e) {}
    })();
    const restartBtn = document.getElementById('debug-restart');
    restartBtn?.addEventListener('click', async () => {
      try {
        restartBtn.disabled = true; restartBtn.innerHTML = '<i class="ri-loader-4-line"></i> 重启中...';
        const res = await window.settingsAPI?.restartApp?.();
        if (!res?.ok) { await showAlert(res?.error || '无法重启'); }
      } catch (e) {
        await showAlert(e?.message || '无法重启');
      } finally {
        restartBtn.disabled = false; restartBtn.innerHTML = '<i class="ri-refresh-line"></i> 快速重启程序';
      }
    });

    // 图标工具：原有逻辑
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
    } catch (e) {}
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
      } catch (e) {}
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
      } catch (e) {}
    });

    await renderPreview();
  } catch (e) {}
}