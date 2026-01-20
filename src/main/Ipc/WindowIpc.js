const { ipcMain, BrowserWindow, Menu, app } = require('electron');
const path = require('path');
const fs = require('fs');
const windowManager = require('../Windows/WindowManager');
const store = require('../Manager/Store/Main');

function register() {
  ipcMain.handle('window:control', async (event, action) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    if (!win) return { ok: false };
    switch (action) {
      case 'minimize':
        win.minimize();
        break;
      case 'maximize':
        win.isMaximized() ? win.unmaximize() : win.maximize();
        break;
      case 'fullscreen':
        try { win.setFullScreen(!win.isFullScreen()); } catch (e) {}
        break;
      case 'hide':
        win.hide();
        break;
      case 'blur':
        try {
          try { win.setFocusable(false); } catch (e) {}
          try { win.blur(); } catch (e) {}
          try { setTimeout(() => { try { win.setFocusable(true); } catch (e) {} }, 500); } catch (e) {}
        } catch (e) {}
        break;
      case 'close':
        win.close();
        break;
      default:
        break;
    }
    return { ok: true };
  });

  ipcMain.handle('window:isFullscreen', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    if (!win) return false;
    try { return !!win.isFullScreen(); } catch (e) { return false; }
  });

  ipcMain.handle('window:getBounds', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    if (!win) return null;
    try { return win.getBounds(); } catch (e) { return null; }
  });

  ipcMain.handle('settings:showMenu', async (event, coords) => {
    const win = BrowserWindow.fromWebContents(event.sender) || BrowserWindow.getFocusedWindow();
    const menu = Menu.buildFromTemplate([
      { label: '打开控制台', click: () => {
        try {
          windowManager.ensureConsoleWindow();
        } catch (e) {}
      } },
      { label: '刷新设置页', click: () => { try { win?.webContents?.reload(); } catch (e) {} } },
      { type: 'separator' },
      { label: '快速重启程序', click: () => { try { store.set('system', 'openSettingsOnBootOnce', true); } catch (e) {} app.relaunch(); app.exit(0); } },
      { label: '打开数据目录', click: async () => { try { const root = path.join(app.getPath('userData'), 'OrbiBoard'); try { fs.mkdirSync(root, { recursive: true }); } catch (e) {} await require('electron').shell.openPath(root); } catch (e) {} } },
      { label: '打开安装目录', click: async () => { try { const dir = path.dirname(process.execPath); await require('electron').shell.openPath(dir); } catch (e) {} } },
      { type: 'separator' },
      { label: '退出程序', click: () => app.quit() }
    ]);
    try { menu.popup({ window: win }); } catch (e) {}
    return { ok: true };
  });
}

module.exports = { register };
