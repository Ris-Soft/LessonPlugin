const path = require('path');
const { BrowserWindow } = require('electron');

// 插件函数统一放到 functions 中（不使用 backend 关键字）
const functions = {
  // 允许通过 actions.target 调用以打开窗口
  openWindow: async () => {
    const win = new BrowserWindow({
      width: 600,
      height: 420,
      title: 'Automation Demo',
      frame: false,
      titleBarStyle: 'hidden',
      webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false }
    });
    win.loadFile(path.join(__dirname, 'index.html'));
    return true;
  },
  notify: (title = '自动化示例', body = '') => {
    try {
      const { Notification } = require('electron');
      const n = new Notification({ title: String(title), body: String(body) });
      n.show();
      return true;
    } catch (e) {
      return false;
    }
  },
  logTime: () => {
    try {
      const fs = require('fs');
      const p = path.join(__dirname, 'automation.log');
      fs.appendFileSync(p, new Date().toISOString() + '\n', 'utf-8');
      return p;
    } catch (e) {
      return null;
    }
  }
};

// 自动化事件声明（供设置页查询）
const automationEvents = [
  { id: 'notify', name: 'notify', desc: '系统通知', params: [ { name: 'title', type: 'string', hint: '通知标题' }, { name: 'body', type: 'string', hint: '通知内容' } ] },
  { id: 'logTime', name: 'logTime', desc: '时间写入日志文件', params: [] }
];

module.exports = {
  name: '自动化演示',
  version: '1.0.0',
  functions,
  automationEvents
};