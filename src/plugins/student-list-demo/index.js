const path = require('path');
const { BrowserWindow } = require('electron');

const functions = {
  openWindow: async () => {
    const win = new BrowserWindow({
      width: 980,
      height: 640,
      title: '学生列表示例',
      frame: false,
      titleBarStyle: 'hidden',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false }
    });
    win.loadFile(path.join(__dirname, 'index.html'));
    win.show();
    return true;
  }
};

const init = async (api) => {
  // 在真实启动阶段报告初始化状态到启动页
  api.splash.setStatus('plugin:init', '初始化学生列表示例');
  // await new Promise(r => meout(r, 600));
  api.splash.progress('plugin:init', '学生列表示例就绪');
};

module.exports = {
  name: 'student-list-demo',
  version: '1.0.0',
  description: '演示调用学生列表、编辑档案与精准时间',
  init,
  functions
};