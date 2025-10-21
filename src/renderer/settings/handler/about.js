
function initAboutPage() {
  const vEl = document.getElementById('about-version');
  const eEl = document.getElementById('about-electron');
  const nEl = document.getElementById('about-node');
  const cEl = document.getElementById('about-chrome');
  const pEl = document.getElementById('about-platform');
  const copyBtn = document.getElementById('about-copy');
  const openDataBtn = document.getElementById('about-open-data');

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
      openDataBtn.addEventListener('click', () => window.settingsAPI.openUserData());
    } else {
      openDataBtn.hidden = true;
    }
  }
}