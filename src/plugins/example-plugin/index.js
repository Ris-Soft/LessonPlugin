const path = require('path');
const { BrowserWindow } = require('electron');

const functions = {
  hello: (from) => `Hello ${from || ''}!`,
  openWindow: async () => {
    const win = new BrowserWindow({
      width: 800,
      height: 500,
      title: 'Example Plugin',
      frame: false,
      titleBarStyle: 'hidden',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false }
    });
    win.loadFile(path.join(__dirname, 'index.html'));
    win.show();
    return true;
  },
  getVariable: async (name) => {
    const key = String(name || '').trim();
    if (key === 'timeISO') return new Date().toISOString();
    if (key === 'pluginName') return '基础示例';
    if (key === 'random') return String(Math.random());
    return '';
  },
  listVariables: () => ['timeISO','pluginName','random']
};

const init = async (api) => {
  api.splash.setStatus('plugin:init', '初始化桌面组件');
  // 执行耗时初始化任务
  // await new Promise(r => setTimeout(r, 1500));
  api.splash.setStatus('plugin:init', '桌面组件加载完成');
  // await new Promise(r => setTimeout(r, 1500));
};

module.exports = {
  name: '基础示例',
  version: '1.0.0',
  init,
  functions
};