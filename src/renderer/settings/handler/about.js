
function initAboutPage() {
  const vEl = document.getElementById('about-version');
  const eEl = document.getElementById('about-electron');
  const nEl = document.getElementById('about-node');
  const cEl = document.getElementById('about-chrome');
  const pEl = document.getElementById('about-platform');
  const copyBtn = document.getElementById('about-copy');
  const openDataBtn = document.getElementById('about-open-data');
  const versionEl = document.getElementById('about-version');

  // 优先通过主进程API获取版本与环境信息；否则从 UA 与 process 解析
  (async () => {
    try {
      const info = await window.settingsAPI?.getAppInfo?.();
      if (info?.appVersion) vEl.textContent = info.appVersion;
      const ev = info?.electronVersion || (navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] || '—');
      eEl.textContent = ev;
      const nv = info?.nodeVersion || (process?.versions?.node || '—');
      const cv = info?.chromeVersion || (process?.versions?.chrome || '—');
      const pv = info?.platform || (process?.platform || navigator?.platform || '—');
      if (nEl) nEl.textContent = nv;
      if (cEl) cEl.textContent = cv;
      if (pEl) pEl.textContent = pv;
    } catch {
      vEl.textContent = vEl.textContent || '—';
      eEl.textContent = eEl.textContent || (navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] || '—');
      if (nEl) nEl.textContent = process?.versions?.node || '—';
      if (cEl) cEl.textContent = process?.versions?.chrome || '—';
      if (pEl) pEl.textContent = process?.platform || navigator?.platform || '—';
    }
  })();

  // 复制版本信息到剪贴板
  copyBtn?.addEventListener('click', async () => {
    const merged = [
      `LessonPlugin ${vEl?.textContent || '—'}`,
      `Electron ${eEl?.textContent || '—'}`,
      `Node ${nEl?.textContent || '—'}`,
      `Chrome ${cEl?.textContent || '—'}`,
      `平台 ${pEl?.textContent || '—'}`
    ].join(' | ');
    try { await navigator.clipboard?.writeText(merged); } catch {}
  });

  // 打开数据目录（如主进程实现该接口）
  if (openDataBtn) {
    if (window.settingsAPI?.openUserData) {
      openDataBtn.hidden = false;
      if (openDataBtn.dataset.bound !== '1') {
        openDataBtn.dataset.bound = '1';
        openDataBtn.addEventListener('click', () => window.settingsAPI.openUserData());
      }
    } else {
      openDataBtn.hidden = true;
    }
  }

  // 开发者模式：点击版本号5次切换（避免重复绑定导致多次弹窗）
  const debugNavBtn = Array.from(document.querySelectorAll('.nav-item')).find(b => b.dataset.page === 'debug');
  if (versionEl && versionEl.dataset.devToggleBound !== '1') {
    versionEl.dataset.devToggleBound = '1';
    let tapCount = 0; let tapTimer = null;
    versionEl.addEventListener('click', async () => {
      try {
        tapCount += 1;
        if (tapTimer) clearTimeout(tapTimer);
        tapTimer = setTimeout(() => { tapCount = 0; }, 1200);
        if (tapCount < 5) return;
        tapCount = 0; clearTimeout(tapTimer); tapTimer = null;
        const current = await window.settingsAPI?.configGet?.('system', 'developerMode');
        const enable = !current;
        if (enable) {
          const ok = await showConfirm('开发者模式将显示调试功能，操作有风险，请谨慎使用。', '开启开发者模式');
          if (!ok) return;
          await window.settingsAPI?.configSet?.('system', 'developerMode', true);
          // 显示调试页导航并跳转到运行管理
          if (debugNavBtn) { debugNavBtn.style.display = ''; debugNavBtn.click(); }
          showToast('开发者模式已开启', { type: 'success', duration: 2000 });
        } else {
          await window.settingsAPI?.configSet?.('system', 'developerMode', false);
          // 隐藏调试页导航
          if (debugNavBtn) { debugNavBtn.style.display = 'none'; }
          showToast('开发者模式已关闭', { type: 'info', duration: 2000 });
        }
      } catch {}
    });
  }
}
