const { app, Tray, Menu, nativeImage, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const windowManager = require('../Windows/WindowManager');
const pluginManager = require('../Manager/Plugins/Main');

class TrayManager {
  constructor() {
    this.tray = null;
  }

  createTray() {
    const iconPath = process.platform === 'win32'
      ? path.join(app.getAppPath(), 'icon.ico')
      : path.join(app.getAppPath(), 'logo.png');
    const baseImg = nativeImage.createFromPath(iconPath);
    const trayImg = baseImg && baseImg.resize ? baseImg.resize({ width: 24, height: 24 }) : baseImg;
    this.tray = new Tray(trayImg);
    this.tray.setToolTip('OrbiBoard');
    this.updateMenu();

    nativeTheme.on('updated', () => {
      try { this.updateMenu(); } catch (e) {}
    });
  }

  updateMenu() {
    if (!this.tray) return;
    this.tray.setContextMenu(this.buildMenu());
  }

  resolveMenuIcon(riName) {
    try {
      const userIconsRoot = path.join(app.getPath('userData'), 'OrbiBoard', 'renderer', 'icons');
      const candidates = [
        path.join(userIconsRoot, `${riName}.png`),
        path.join(userIconsRoot, `${riName}.ico`),
        path.join(userIconsRoot, `${riName}.jpg`),
        path.join(app.getAppPath(), 'src', 'renderer', 'icons', `${riName}.png`),
        path.join(app.getAppPath(), 'src', 'renderer', 'icons', `${riName}.ico`),
        path.join(app.getAppPath(), 'src', 'renderer', 'icons', `${riName}.jpg`),
        path.join(app.getAppPath(), 'src', 'renderer', `${riName}.png`)
      ];
      for (const fp of candidates) {
        if (fs.existsSync(fp)) {
          try {
            const base = nativeImage.createFromPath(fp);
            const scaled = base && base.resize ? base.resize({ width: 24, height: 24 }) : base;
            if (!nativeTheme.shouldUseDarkColors && scaled && scaled.getBitmap) {
              try {
                const size = scaled.getSize();
                const buf = scaled.getBitmap();
                for (let i = 0; i < buf.length; i += 4) {
                  buf[i] = 255 - buf[i];
                  buf[i + 1] = 255 - buf[i + 1];
                  buf[i + 2] = 255 - buf[i + 2];
                }
                const inv = nativeImage.createFromBitmap(buf, { width: size.width, height: size.height });
                return inv || scaled;
              } catch (e) {}
            }
            return scaled;
          } catch (e) {}
        }
      }
    } catch (e) {}
    return null;
  }

  openSettingsTo(page) {
    const win = windowManager.ensureSettingsWindow();
    const sendNav = () => { try { win.webContents.send('settings:navigate', page); } catch (e) {} };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', sendNav);
    } else {
      sendNav();
    }
  }

  openPluginInfo(pluginKey) {
    this.openSettingsTo('plugins');
    const win = windowManager.settingsWindow;
    if (!win) return;
    const sendInfo = () => { try { win.webContents.send('settings:openPluginInfo', pluginKey); } catch (e) {} };
    if (win.webContents.isLoading()) {
      win.webContents.once('did-finish-load', sendInfo);
    } else {
      sendInfo();
    }
  }

  buildPluginActionsMenu() {
    try {
      const list = pluginManager.getPlugins() || [];
      const items = [];
      for (const p of list) {
        const acts = Array.isArray(p.actions) ? p.actions : [];
        if (!acts.length) continue;
        const sub = [];
        for (const a of acts) {
          const label = a.text || a.label || a.name || a.id || a.target || '动作';
          sub.push({
            label,
            click: async () => {
              try {
                if (a.id === 'installNpm') {
                  await pluginManager.installNpm(p.id || p.name, (status) => windowManager.sendSplashProgress(status));
                } else if (a.target) {
                  await pluginManager.callFunction(p.id || p.name, a.target, a.args || {});
                }
              } catch (e) {
                try { require('electron').dialog.showErrorBox('执行插件动作失败', e?.message || String(e)); } catch (e) {}
              }
            }
          });
        }
        sub.push({ type: 'separator' });
        sub.push({ label: '插件信息', click: () => { this.openPluginInfo(p.id || p.name); } });
        items.push({ label: p.name || p.id, submenu: sub });
      }
      if (!items.length) return [{ label: '暂无可用插件动作', enabled: false }];
      return items;
    } catch (e) { return [{ label: '加载失败', enabled: false }]; }
  }

  buildMenu() {
    return Menu.buildFromTemplate([
      { label: '通用设置', icon: this.resolveMenuIcon('ri-settings-3-line'), click: () => this.openSettingsTo('general') },
      { label: '功能市场', icon: this.resolveMenuIcon('ri-store-2-line'), click: () => this.openSettingsTo('market') },
      { label: '插件管理', icon: this.resolveMenuIcon('ri-puzzle-line'), click: () => this.openSettingsTo('plugins') },
      { label: '自动化', icon: this.resolveMenuIcon('ri-robot-line'), click: () => this.openSettingsTo('automation') },
      { label: '关于', icon: this.resolveMenuIcon('ri-information-line'), click: () => this.openSettingsTo('about') },
      { type: 'separator' },
      { label: '插件动作', icon: this.resolveMenuIcon('ri-play-line'), submenu: this.buildPluginActionsMenu() },
      { type: 'separator' },
      { label: '退出', icon: this.resolveMenuIcon('ri-close-circle-line'), click: () => app.quit() }
    ]);
  }
}

module.exports = new TrayManager();
