const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

class ConfirmationService {
  constructor() {}

  request(item, ctx) {
    return new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 800, height: 560, fullscreen: true, frame: false, transparent: true, alwaysOnTop: true,
        skipTaskbar: true, focusable: false, hasShadow: false, acceptFirstMouse: true,
        webPreferences: { preload: path.join(__dirname, '../../../preload/settings.js'), backgroundThrottling: false }
      });
      try { win.setAlwaysOnTop(true, 'screen-saver'); } catch (e) {}
      win.loadFile(path.join(__dirname, '../../../renderer', 'automation-confirm.html'));
      const timeout = Math.max(5, parseInt(item?.confirm?.timeout || 60, 10));
      // 将自动化条目基本信息传递给渲染页
      try {
        win.webContents.once('did-finish-load', () => {
          try { win.webContents.send('automation:confirm:init', { id: item.id, name: item.name, timeout }); } catch (e) {}
        });
      } catch (e) {}
      let done = false;
      const finish = async (ok) => {
        if (done) return; done = true; try { if (!win.isDestroyed()) win.destroy(); } catch (e) {}
        resolve(ok);
      };
      // 监听渲染确认
      try {
        const onConfirm = (_e, id, approved) => {
          if (id !== item.id) return;
          try { ipcMain.removeListener('automation:confirm:result', onConfirm); } catch (e) {}
          finish(approved);
        };
        ipcMain.on('automation:confirm:result', onConfirm);
      } catch (e) {}
      // 超时自动执行
      setTimeout(() => finish(true), timeout * 1000);
    });
  }
}

module.exports = ConfirmationService;
