const path = require('path');

async function openWindow({ BrowserWindow, path: pathMod }) {
  const win = new BrowserWindow({
    width: 600,
    height: 420,
    title: 'Automation Demo',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: { preload: pathMod.join(__dirname, 'preload.js'), nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

// 后端函数：无需窗口即可执行，适合自动化
const backend = {
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
  { id: 'notify', name: 'notify', desc: '系统通知（标题、内容）', params: [ { name: 'title', type: 'string' }, { name: 'body', type: 'string' } ] },
  { id: 'logTime', name: 'logTime', desc: '将当前时间写入日志文件', params: [] }
];

module.exports = {
  name: 'AutomationDemo',
  version: '1.0.0',
  openWindow,
  backend,
  automationEvents
};