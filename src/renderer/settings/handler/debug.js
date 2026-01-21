
async function initDebugSettings() {
  const pageDebug = document.getElementById('page-debug');
  if (pageDebug.dataset.init === '1') return;
  pageDebug.dataset.init = '1';

  try {
    // 子页切换逻辑
    const subItems = document.querySelectorAll('#page-debug .subnav .sub-item');
    const runPanel = document.getElementById('debug-run');
    const iconsPanel = document.getElementById('debug-icons');
    const logsPanel = document.getElementById('debug-logs');
    const updateTestPanel = document.getElementById('debug-update-test');
    const logList = document.getElementById('backend-log-list');

    // 确保所有面板初始状态正确
    if (runPanel) runPanel.hidden = false;
    if (iconsPanel) iconsPanel.hidden = true;
    if (logsPanel) logsPanel.hidden = true;
    if (updateTestPanel) updateTestPanel.hidden = true;

    subItems.forEach((btn) => {
      btn.addEventListener('click', () => {
        subItems.forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        const sub = btn.dataset.sub;
        
        if (runPanel) runPanel.hidden = sub !== 'run';
        if (iconsPanel) iconsPanel.hidden = sub !== 'icons';
        if (logsPanel) logsPanel.hidden = sub !== 'logs';
        if (updateTestPanel) updateTestPanel.hidden = sub !== 'update-test';
        
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

    // 插件同步开关
    const syncPluginsSwitch = document.getElementById('debug-sync-plugins');
    if (syncPluginsSwitch) {
      try {
        const cfg = await window.settingsAPI?.configGet?.('system', 'debugSyncPlugins');
        syncPluginsSwitch.checked = !!cfg;
        syncPluginsSwitch.addEventListener('change', async () => {
          try {
            await window.settingsAPI?.configSet?.('system', 'debugSyncPlugins', syncPluginsSwitch.checked);
          } catch (e) {}
        });
      } catch (e) {}
    }

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

    // 更新测试逻辑
    const testMainUpdateBtn = document.getElementById('debug-test-main-update');
    testMainUpdateBtn?.addEventListener('click', () => {
      // 以前是前端模拟，现在改为请求后端显示真实通知窗口
      // 但为了方便测试，我们也可以直接调用 window.settingsAPI.testNotification? 
      // 或者我们暂时保留前端模拟（但只是模拟UI），或者我们添加一个 IPC 让后端弹窗。
      // 既然现在是独立窗口，前端直接模拟已经不一样了。
      // 最好是添加一个 debug IPC。
      
      // 这里我们使用一个简单的 fetch 或者 invoke 来触发后端测试（如果后端支持）
      // 由于没有专门的 debug IPC，我们可以通过 consoleIpc 或者临时添加。
      // 或者，为了简单演示，我们还是保留“前端模拟”，但提示用户这是旧版模拟。
      // 不，用户要求“测试该功能的组件”，所以应该是测试新窗口。
      // 让我们修改 NotificationIpc.js 增加一个 test 接口，或者复用。
      
      // 鉴于不能随意修改 IPC 接口定义（需要重启后端），我们这里先用前端模拟，
      // 但其实用户更想看的是右下角弹窗。
      // 我们可以尝试通过 backendLog 来触发？不行。
      
      // 既然我已经修改了 NotificationIpc.js，我可以再加一个 'notification:test' handler。
      // 但我现在不能修改已经写入的文件而不再次调用 Write。
      
      // 让我们修改 debug.js 来提示用户。
      // 或者，我再次修改 NotificationIpc.js 添加 test 方法。
      // 这样 debug 页面就能调用了。
      
      window.settingsAPI?.testNotification?.('main');
    });

    const testPluginUpdateBtn = document.getElementById('debug-test-plugin-update');
    testPluginUpdateBtn?.addEventListener('click', () => {
       window.settingsAPI?.testNotification?.('plugin');
    });

    const simNextUpdateBtn = document.getElementById('debug-sim-next-update');
    simNextUpdateBtn?.addEventListener('click', async () => {
      try {
        const info = await window.settingsAPI?.getAppInfo?.();
        const currentVer = info?.appVersion || '1.0.0';
        // 设置标记
        await window.settingsAPI?.configSet?.('system', 'justUpdated', true);
        await window.settingsAPI?.configSet?.('system', 'previousVersion', '0.0.0-dev');
        await showAlert(`已设置标记。当前版本: ${currentVer}。请重启应用以查看“主程序更新”提示。`);
      } catch(e) {
        await showAlert(`设置失败: ${e.message}`);
      }
    });

    await renderPreview();
  } catch (e) {}
}