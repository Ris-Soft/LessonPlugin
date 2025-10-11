const path = require('path');
const { BrowserWindow } = require('electron');

module.exports = {
  // 可被其他插件调用的函数集合
  functions: {
    hello: (name = '世界') => {
      return { ok: true, message: `你好，${name}!` };
    },
    logTime: () => {
      const now = new Date().toLocaleString();
      console.log('[插件开发示例] 当前时间：', now);
      return now;
    },
    openWindow: async () => {
      const win = new BrowserWindow({
        width: 620,
        height: 420,
        title: '插件开发示例',
        frame: false,
        titleBarStyle: 'hidden',
        webPreferences: {
          preload: path.join(__dirname, 'preload.js'),
          nodeIntegration: false
        }
      });
      win.loadFile(path.join(__dirname, 'index.html'));
      win.show();
      return true;
    },
  },

  // 自动化事件列表（供设置页查询）
  automationEvents: [
    { id: 'demo.notify', name: '示例通知', desc: '显示示例通知', params: [{ key: 'text', label: '文本' }] },
    { id: 'demo.logTime', name: '记录时间', desc: '在主进程日志记录当前时间', params: [] }
  ],

  // 启动页状态演示
  async init(pluginAPI) {
    try {
      pluginAPI?.splash?.setStatus('plugin', '初始化 插件开发示例...');
      await new Promise(r => setTimeout(r, 300));
      pluginAPI?.splash?.progress('plugin', '就绪');
    } catch { }
  }
};