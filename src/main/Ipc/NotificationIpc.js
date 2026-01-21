const { ipcMain } = require('electron');
const NotificationWindow = require('../Windows/NotificationWindow');
const WindowManager = require('../Windows/WindowManager');

function register() {
  ipcMain.on('notification:close', () => {
    NotificationWindow.close();
  });

  ipcMain.on('notification:action', (_e, action) => {
    if (action === 'details') {
      NotificationWindow.close();
      
      const settingsWin = WindowManager.ensureSettingsWindow();
      // Wait for load if necessary, then send command
      if (settingsWin.webContents.isLoading()) {
        settingsWin.webContents.once('did-finish-load', () => {
           settingsWin.webContents.send('cmd:showUpdateDetails');
        });
      } else {
        settingsWin.webContents.send('cmd:showUpdateDetails');
      }
    }
  });

  // Test handlers
  ipcMain.handle('notification:test', (_e, type) => {
    if (type === 'main') {
      NotificationWindow.show(
        '主程序已更新 (测试)', 
        '版本：v1.0.0 → v1.0.1<br>点击查看详细更新日志', 
        true
      );
    } else if (type === 'plugin') {
      NotificationWindow.show(
        '插件自动更新完成 (测试)',
        '已自动更新以下插件：<ul><li>Demo Plugin (v1.0 -> v1.1)</li></ul>',
        true
      );
    }
  });
}

module.exports = { register };
