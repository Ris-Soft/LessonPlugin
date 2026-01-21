const { BrowserWindow, screen, ipcMain } = require('electron');
const path = require('path');

class NotificationWindow {
  constructor() {
    this.window = null;
    this.width = 340; // Slightly larger than content to account for shadows/padding
    this.height = 200; // Estimated height
    this.isShowing = false;
    this.closeTimer = null;
  }

  create() {
    if (this.window && !this.window.isDestroyed()) return;

    this.window = new BrowserWindow({
      width: this.width,
      height: this.height,
      frame: false,
      transparent: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../../preload/notification.js'),
        nodeIntegration: false,
        contextIsolation: true
      }
    });

    this.window.loadFile(path.join(__dirname, '../../renderer/notification.html'));

    this.window.on('closed', () => {
      this.window = null;
      this.isShowing = false;
    });
  }

  show(title, content, hasDetails = true, duration = 0) {
    if (!this.window || this.window.isDestroyed()) {
      this.create();
    }

    // Wait for load if needed, but usually we just send update
    this.window.webContents.once('did-finish-load', () => {
       this._display(title, content, hasDetails, duration);
    });

    // If already loaded
    if (this.window.webContents.isLoading() === false) {
       this._display(title, content, hasDetails, duration);
    }
  }

  _display(title, content, hasDetails, duration) {
    if (!this.window) return;

    // Calculate position: Bottom Right
    const primaryDisplay = screen.getPrimaryDisplay();
    const { workArea } = primaryDisplay; // workArea excludes taskbar
    const x = workArea.x + workArea.width - this.width - 10;
    const y = workArea.y + workArea.height - this.height - 10;

    this.window.setPosition(x, y);
    
    this.window.webContents.send('notification:update', { title, content, hasDetails });
    
    // Show window without focusing to avoid stealing focus
    this.window.showInactive();
    this.isShowing = true;

    if (this.closeTimer) clearTimeout(this.closeTimer);
    if (duration > 0) {
      this.closeTimer = setTimeout(() => this.close(), duration);
    }
  }

  close() {
    if (this.window && !this.window.isDestroyed()) {
      this.window.close();
    }
  }
}

module.exports = new NotificationWindow();
