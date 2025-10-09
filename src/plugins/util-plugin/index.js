const path = require('path');
const { BrowserWindow } = require('electron');

const functions = {
  getTime: () => new Date().toISOString(),
  // 允许通过 actions.target 调用以打开窗口
  openWindow: async () => {
    const win = new BrowserWindow({
      width: 480,
      height: 360,
      title: 'Util Plugin',
      frame: false,
      titleBarStyle: 'hidden',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false }
    });
    win.loadFile(path.join(__dirname, 'index.html'));
    return true;
  }
};

module.exports = {
  name: 'UtilPlugin',
  version: '1.0.0',
  functions
};