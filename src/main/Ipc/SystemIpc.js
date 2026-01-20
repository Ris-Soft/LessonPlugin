const { ipcMain, app, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const win32 = require('../System/Win32');
const autoUpdater = require('../App/autoUpdater');
const store = require('../Manager/Store/Main');
const userDataService = require('../Services/UserDataService');
const ntpService = require('../Services/NtpService');
const windowManager = require('../Windows/WindowManager');

function register() {
  ipcMain.handle('win32:msgbox', async (_e, text, title) => {
    try {
      win32.messageBox(text, title || 'OrbiBoard');
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('system:openSettings', async () => {
    try {
      windowManager.ensureSettingsWindow();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('system:update:check', async () => {
    try {
      return await autoUpdater.checkAndUpdate((status) => windowManager.sendSplashProgress(status));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('system:checkUpdate', async (_e, checkOnly = false) => {
    return autoUpdater.checkAndUpdate((payload) => windowManager.sendSplashProgress(payload), checkOnly);
  });

  ipcMain.handle('system:performUpdate', async (_e) => {
    return autoUpdater.checkAndUpdate((payload) => windowManager.sendSplashProgress(payload), false);
  });

  ipcMain.handle('system:getTime', async () => ntpService.getTime());

  ipcMain.handle('system:getUserDataPath', async () => {
    try { return app.getPath('userData'); } catch (e) { return ''; }
  });

  ipcMain.handle('system:getUserDataSize', async () => userDataService.getUserDataSize());
  ipcMain.handle('system:openUserData', async () => userDataService.openUserData());
  ipcMain.handle('system:changeUserData', async () => userDataService.changeUserData());
  ipcMain.handle('system:cleanupUserData', async () => userDataService.cleanupUserData());

  ipcMain.handle('system:getAppInfo', async () => {
    let platformText = '';
    try {
      const ver = (typeof os.version === 'function') ? os.version() : '';
      const release = os.release();
      const plat = process.platform;
      const name = plat === 'win32' ? 'Windows' : (plat === 'darwin' ? 'macOS' : (plat === 'linux' ? 'Linux' : plat));
      if (ver && typeof ver === 'string' && ver.trim()) {
        platformText = plat === 'win32' ? `${ver} ${release}` : ver;
      } else {
        platformText = `${name} ${release}`;
      }
    } catch (e) {
      const release = require('os').release();
      const plat = process.platform;
      const name = plat === 'win32' ? 'Windows' : (plat === 'darwin' ? 'macOS' : (plat === 'linux' ? 'Linux' : plat));
      platformText = `${name} ${release}`;
    }
    const archRaw = process.arch;
    const archLabel = archRaw === 'ia32' ? 'x86' : archRaw;
    return {
      appVersion: app.getVersion(),
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      chromeVersion: process.versions.chrome,
      platform: `${platformText} (${archLabel})`,
      isDev: !app.isPackaged
    };
  });

  ipcMain.handle('system:getAutostart', async () => {
    try {
      if (process.platform === 'linux') {
        const configDir = process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config');
        const autoDir = path.join(configDir, 'autostart');
        const filePath = path.join(autoDir, 'OrbiBoard.desktop');
        let enabled = false;
        if (fs.existsSync(filePath)) {
          try {
            const text = fs.readFileSync(filePath, 'utf-8');
            const m = text.match(/X-GNOME-Autostart-enabled\s*=\s*(true|false)/i);
            if (m) enabled = String(m[1]).toLowerCase() === 'true'; else enabled = true;
          } catch (e) { enabled = true; }
        }
        return { ok: true, openAtLogin: enabled };
      }
      const settings = app.getLoginItemSettings();
      return { ok: true, openAtLogin: !!settings.openAtLogin };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('system:setAutostart', async (_e, enabled, highPriority) => {
    try {
      if (process.platform === 'linux') {
        const configDir = process.env.XDG_CONFIG_HOME || path.join(require('os').homedir(), '.config');
        const autoDir = path.join(configDir, 'autostart');
        try { fs.mkdirSync(autoDir, { recursive: true }); } catch (e) {}
        const filePath = path.join(autoDir, 'OrbiBoard.desktop');
        if (enabled) {
          const execPath = process.env.APPIMAGE || process.execPath;
          const iconPng = path.join(app.getAppPath(), 'logo.png');
          const lines = [
            '[Desktop Entry]',
            'Type=Application',
            'Name=OrbiBoard',
            `Exec=${execPath}`,
            fs.existsSync(iconPng) ? `Icon=${iconPng}` : '',
            'Terminal=false',
            'Categories=Utility;',
            'X-GNOME-Autostart-enabled=true',
            'OnlyShowIn=Deepin;GNOME;KDE;',
            'Hidden=false'
          ].filter(Boolean).join('\n');
          fs.writeFileSync(filePath, lines, 'utf-8');
          try { fs.chmodSync(filePath, 0o644); } catch (e) {}
        } else {
          try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (e) {}
        }
        store.set('system', 'autostartEnabled', !!enabled);
        store.set('system', 'autostartHigh', !!highPriority);
        return { ok: true };
      }
      app.setLoginItemSettings({ openAtLogin: !!enabled });
      store.set('system', 'autostartEnabled', !!enabled);
      store.set('system', 'autostartHigh', !!highPriority);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('icons:dir', async () => {
    try {
      const dir = path.join(app.getPath('userData'), 'OrbiBoard', 'renderer', 'icons');
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      return dir;
    } catch (e) {
      return '';
    }
  });

  ipcMain.handle('icons:write', async (_e, fileName, dataUrl) => {
    try {
      const dir = path.join(app.getPath('userData'), 'OrbiBoard', 'renderer', 'icons');
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      const safe = String(fileName || 'icon.png').replace(/[^a-zA-Z0-9._-]/g, '_');
      const target = path.join(dir, safe);
      const m = String(dataUrl || '').match(/^data:image\/png;base64,(.+)$/i);
      if (!m) return { ok: false, error: '无效PNG数据' };
      const buf = Buffer.from(m[1], 'base64');
      fs.writeFileSync(target, buf);
      return { ok: true, path: target };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('asset:url', async (_e, relPath) => {
    try {
      const userRoot = path.join(app.getPath('userData'), 'OrbiBoard', 'renderer');
      const shippedRoot = path.join(app.getAppPath(), 'src', 'renderer');
      const candidates = [path.join(userRoot, relPath), path.join(shippedRoot, relPath)];
      const found = candidates.find((p) => fs.existsSync(p));
      if (!found) return null;
      const url = 'file://' + found.replace(/\\/g, '/');
      return url;
    } catch (e) {
      return null;
    }
  });

  ipcMain.handle('system:restart', async () => {
    try {
      try { store.set('system', 'openSettingsOnBootOnce', true); } catch (e) {}
      app.relaunch();
      app.exit(0);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('system:openInstallDir', async () => {
    try {
      const dir = path.dirname(process.execPath);
      const res = await require('electron').shell.openPath(dir);
      return { ok: !res, error: res || null };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('system:quit', async () => {
    try { app.quit(); return { ok: true }; } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  });
}

module.exports = { register };
