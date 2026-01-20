const { BrowserWindow, app } = require('electron');
const path = require('path');
const store = require('../Manager/Store/Main');

class WindowManager {
  constructor() {
    this.splashWindow = null;
    this.settingsWindow = null;
    this.consoleWindow = null;
    this.splashReady = false;
    this.splashQueue = [];
  }

  createSplashWindow() {
    const cfgAll = store.getAll('system') || {};
    const showQuote = cfgAll.splashQuoteEnabled !== false;
    this.splashWindow = new BrowserWindow({
      width: 640,
      height: showQuote ? 320 : 200,
      useContentSize: true,
      center: true,
      alwaysOnTop: true,
      resizable: false,
      frame: false,
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'src', 'preload', 'splash.js')
      }
    });
    this.splashWindow.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'splash.html'));
    this.splashWindow.once('ready-to-show', () => this.splashWindow.show());
    this.splashWindow.webContents.once('did-finish-load', () => {
      this.splashReady = true;
      try {
        this.splashQueue.forEach((p) => this.splashWindow?.webContents?.send('plugin-progress', p));
      } catch (e) {}
      this.splashQueue = [];
    });
    this.splashWindow.on('closed', () => { this.splashWindow = null; });
  }

  createSettingsWindow() {
    this.settingsWindow = new BrowserWindow({
      width: 1344,
      height: 768,
      resizable: true,
      frame: false,
      titleBarStyle: 'hidden',
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'src', 'preload', 'settings.js')
      }
    });
    this.settingsWindow.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'settings.html'));
    this.settingsWindow.on('closed', () => { this.settingsWindow = null; });
  }

  createConsoleWindow() {
    this.consoleWindow = new BrowserWindow({
      width: 1024,
      height: 640,
      resizable: true,
      frame: false,
      titleBarStyle: 'hidden',
      show: false,
      webPreferences: {
        preload: path.join(app.getAppPath(), 'src', 'preload', 'console.js')
      }
    });
    this.consoleWindow.loadFile(path.join(app.getAppPath(), 'src', 'renderer', 'console.html'));
    this.consoleWindow.on('closed', () => { this.consoleWindow = null; });
  }

  sendSplashProgress(payload) {
    try {
      if (this.splashWindow && this.splashReady) {
        this.splashWindow.webContents.send('plugin-progress', payload);
      } else {
        this.splashQueue.push(payload);
      }
    } catch (e) {}
    try {
      if (this.settingsWindow && !this.settingsWindow.isDestroyed()) {
        this.settingsWindow.webContents.send('plugin-progress', payload);
      }
    } catch (e) {}
  }

  ensureSettingsWindow() {
    if (!this.settingsWindow || this.settingsWindow.isDestroyed()) this.createSettingsWindow();
    if (this.settingsWindow?.isMinimized?.()) this.settingsWindow.restore();
    this.settingsWindow.show();
    this.settingsWindow.focus();
    return this.settingsWindow;
  }

  ensureConsoleWindow() {
    if (!this.consoleWindow || this.consoleWindow.isDestroyed()) this.createConsoleWindow();
    if (this.consoleWindow?.isMinimized?.()) this.consoleWindow.restore();
    this.consoleWindow.show();
    this.consoleWindow.focus();
    return this.consoleWindow;
  }

  closeAllWindows() {
    try { if (this.settingsWindow && !this.settingsWindow.isDestroyed()) this.settingsWindow.destroy(); } catch (e) {}
    try { if (this.splashWindow && !this.splashWindow.isDestroyed()) this.splashWindow.destroy(); } catch (e) {}
    try { if (this.consoleWindow && !this.consoleWindow.isDestroyed()) this.consoleWindow.destroy(); } catch (e) {}
  }
}

module.exports = new WindowManager();
