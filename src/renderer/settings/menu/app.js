window.showAppMenu = function(pos) {
  const old = document.querySelector('.app-menu-overlay');
  if (old) try { old.remove(); } catch (e) {}
  const overlay = document.createElement('div');
  overlay.className = 'app-menu-overlay';
  const menu = document.createElement('div');
  menu.className = 'app-menu';
  const items = [
    { icon: 'ri-terminal-box-line', text: '打开控制台', action: async () => { try { await window.settingsAPI?.consoleOpen?.(); } catch (e) {} } },
    { icon: 'ri-refresh-line', text: '刷新设置页', action: () => { try { location.reload(); } catch (e) {} } },
    { sep: true },
    { icon: 'ri-rocket-line', text: '快速重启程序', action: async () => { try { await window.settingsAPI?.restartApp?.(); } catch (e) {} } },
    { icon: 'ri-folder-open-line', text: '打开数据目录', action: async () => { try { await window.settingsAPI?.openUserData?.(); } catch (e) {} } },
    { icon: 'ri-folder-2-line', text: '打开安装目录', action: async () => { try { await window.settingsAPI?.openInstallDir?.(); } catch (e) {} } },
  ];
  try {
    if (window.__isDev__) {
      items.push({ sep: true });
      items.push({ icon: 'ri-delete-bin-6-line', text: '卸载所有插件', action: async () => {
        try {
          const ok = await showConfirm('确定卸载所有插件？该操作将删除所有已安装插件。', '确认卸载');
          if (!ok) return;
          const res = await window.settingsAPI?.uninstallAllPlugins?.();
          if (res?.ok) {
            await showToast(`已卸载 ${Array.isArray(res.removed) ? res.removed.length : 0} 个插件`);
            try { location.reload(); } catch (e) {}
          } else {
            await showAlert(res?.error || '卸载失败');
          }
        } catch (e) {
          await showAlert(e?.message || '卸载失败');
        }
      }});
    }
  } catch (e) {}
  items.push(
    { sep: true },
    { icon: 'ri-close-circle-line', text: '退出程序', action: async () => { try { await window.settingsAPI?.quitApp?.(); } catch (e) {} } }
  );
  items.forEach(it => {
    if (it.sep) { const s = document.createElement('div'); s.className = 'app-menu-sep'; menu.appendChild(s); return; }
    const btn = document.createElement('div');
    btn.className = 'app-menu-item';
    btn.innerHTML = `<i class="${it.icon}"></i><span>${it.text}</span>`;
    btn.addEventListener('click', async () => { try { await it.action(); } catch (e) {} try { overlay.remove(); } catch (e) {} });
    menu.appendChild(btn);
  });
  overlay.appendChild(menu);
  document.body.appendChild(overlay);
  const x = Number(pos?.x || 0);
  const y = Number(pos?.y || 0);
  if (x && y) { menu.style.left = x + 'px'; menu.style.top = y + 'px'; }
  else {
    const btn = document.querySelector('.window-actions .win-btn[data-act="menu"]');
    if (btn) {
      const r = btn.getBoundingClientRect();
      menu.style.left = (r.right - 180) + 'px';
      menu.style.top = (r.bottom + 6) + 'px';
    } else {
      menu.style.right = '8px';
      menu.style.top = '40px';
    }
  }
  const close = (e) => {
    const t = e.target;
    if (!menu.contains(t)) { try { overlay.remove(); document.removeEventListener('mousedown', close); } catch (e) {} }
  };
  document.addEventListener('mousedown', close);
};
