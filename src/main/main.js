const { app } = require('electron');
const userDataService = require('./Services/UserDataService');
const appLifecycle = require('./App/AppLifecycle');

// 应用数据目录重定向（尽早执行）
userDataService.applyUserDataOverride();

// 进程锁：防止重复运行（单实例）
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  try { app.quit(); } catch (e) {}
  try { process.exit(0); } catch (e) {}
} else {
  appLifecycle.init(app);
}
