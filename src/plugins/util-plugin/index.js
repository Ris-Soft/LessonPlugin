async function openWindow({ BrowserWindow, path }) {
  const win = new BrowserWindow({
    width: 480,
    height: 360,
    title: 'Util Plugin',
    frame: false,
    titleBarStyle: 'hidden',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), nodeIntegration: false }
  });
  win.loadFile(path.join(__dirname, 'index.html'));
  return win;
}

// 后端功能：无需窗口即可被调用
const backend = {
  getTime: () => new Date().toISOString()
};

module.exports = {
  name: 'UtilPlugin',
  version: '1.0.0',
  openWindow,
  backend
};