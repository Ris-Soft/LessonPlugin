async function openWindow({ BrowserWindow, path }) {
  const win = new BrowserWindow({
    width: 800,
    height: 500,
    title: 'Example Plugin',
    frame: false, // 自定义标题栏
    titleBarStyle: 'hidden',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  win.show();
  return win;
}

// 后端功能：无需窗口即可被调用
const backend = {
  hello: (from) => `Hello ${from || ''}!`
};

module.exports = {
  name: 'ExamplePlugin',
  version: '1.0.0',
  openWindow,
  backend
};