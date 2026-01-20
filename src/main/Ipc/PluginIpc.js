const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const AdmZip = require('adm-zip');
const { app } = require('electron');
const pluginManager = require('../Manager/Plugins/Main');
const automationManager = require('../Manager/Automation/Main'); // Ensure this singleton is used/initialized
const store = require('../Manager/Store/Main');
const windowManager = require('../Windows/WindowManager');

function register() {
  ipcMain.handle('plugin:list', async () => pluginManager.getPlugins());

  ipcMain.handle('plugin:toggle', async (event, name, enabled) => pluginManager.toggle(name, enabled));

  ipcMain.handle('plugin:install', async (event, name) => {
    return pluginManager.installNpm(name, (status) => windowManager.sendSplashProgress(status));
  });

  ipcMain.handle('plugin:installZip', async (_e, zipPath) => pluginManager.installFromZip(zipPath));

  ipcMain.handle('plugin:uninstall', async (_e, name) => pluginManager.uninstall(name));

  ipcMain.handle('plugin:inspectZip', async (_e, zipPath) => pluginManager.inspectZip(zipPath));

  ipcMain.handle('plugin:installZipData', async (_e, fileName, data) => {
    try {
      const tmpDir = path.join(app.getPath('temp'), 'OrbiBoard');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const safeName = String(fileName || 'plugin.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
      const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
      const buf = Buffer.from(data);
      fs.writeFileSync(tmpPath, buf);
      const res = await pluginManager.installFromZip(tmpPath);
      try { fs.unlinkSync(tmpPath); } catch (e) {}
      return res;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('plugin:inspectZipData', async (_e, fileName, data) => {
    try {
      const tmpDir = path.join(app.getPath('temp'), 'OrbiBoard');
      if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
      const safeName = String(fileName || 'plugin.zip').replace(/[^a-zA-Z0-9._-]/g, '_');
      const tmpPath = path.join(tmpDir, `${Date.now()}_${safeName}`);
      const buf = Buffer.from(data);
      fs.writeFileSync(tmpPath, buf);
      const res = await pluginManager.inspectZip(tmpPath);
      try { fs.unlinkSync(tmpPath); } catch (e) {}
      return res;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  // Reload plugin (dev only)
  ipcMain.handle('plugin:reload', async (_e, key) => {
    try {
      const isDev = !app.isPackaged;
      if (!isDev) return { ok: false, error: 'only_dev' };
      const all = await pluginManager.getPlugins();
      const p = (all || []).find(x => (x.id === key) || (x.name === key));
      if (!p) return { ok: false, error: 'not_found' };
      if (!p.local) return { ok: false, error: 'not_local_plugin' };
      
      const shippedPluginsRoot = path.join(app.getAppPath(), 'src', 'plugins');
      const userPluginsRoot = path.join(app.getPath('userData'), 'OrbiBoard', 'plugins');
      
      const dirName = String(p.local).split(/[\\\/]/).filter(Boolean).pop();
      const srcDir = path.join(shippedPluginsRoot, dirName);
      const dstDir = path.join(userPluginsRoot, dirName);
      if (!fs.existsSync(srcDir)) return { ok: false, error: 'dev_source_missing' };
      
      try { await pluginManager.uninstall(key); } catch (e) {}
      try { if (fs.existsSync(dstDir)) fs.rmSync(dstDir, { recursive: true, force: true }); } catch (e) {}
      try { fs.mkdirSync(dstDir, { recursive: true }); } catch (e) {}
      
      // Copy logic
      const stack = [ { s: srcDir, d: dstDir } ];
      while (stack.length) {
        const { s, d } = stack.pop();
        const items = fs.readdirSync(s);
        for (const it of items) {
          const sp = path.join(s, it);
          const dp = path.join(d, it);
          const stat = fs.statSync(sp);
          if (stat.isDirectory()) {
            if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
            stack.push({ s: sp, d: dp });
          } else {
            try { fs.copyFileSync(sp, dp); } catch (e) {}
          }
        }
      }
      
      const manifestPath = path.join(userPluginsRoot, 'plugins.json');
      const configPath = path.join(userPluginsRoot, 'config.json');
      pluginManager.init({ manifestPath, configPath });
      try { await pluginManager.loadPlugins((status) => windowManager.sendSplashProgress(status)); } catch (e) {}
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('plugin:readme', async (_e, key) => {
    try { return pluginManager.getPluginReadme(key); } catch (e) { return null; }
  });

  ipcMain.handle('plugin:readmeOnline', async (_e, key) => {
    try {
      const all = await pluginManager.getPlugins();
      const p = (all || []).find(x => (x.id === key) || (x.name === key));
      const pkgName = p?.npm || p?.name;
      if (!pkgName) return null;
      const url = `https://registry.npmmirror.com/${encodeURIComponent(pkgName)}`;
      const content = await new Promise((resolve) => {
        try {
          https.get(url, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              try {
                const json = JSON.parse(data);
                const md = json?.readme || '';
                resolve(md || null);
              } catch (e) {
                resolve(null);
              }
            });
          }).on('error', () => resolve(null));
        } catch (e) { resolve(null); }
      });
      if (content) return content;
      try { return pluginManager.getPluginReadme(key); } catch (e) { return null; }
    } catch (e) { return null; }
  });

  ipcMain.handle('plugin:uninstallAll', async () => {
    try {
      const list = await pluginManager.getPlugins();
      const items = Array.isArray(list) ? list : [];
      const removed = [];
      for (const p of items) {
        const key = p.id || p.name;
        try {
          await pluginManager.uninstall(key);
          removed.push(key);
        } catch (e) {}
      }
      return { ok: true, removed };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('npm:versions', async (_e, name) => pluginManager.getPackageVersions(name));
  ipcMain.handle('npm:download', async (_e, name, version) => pluginManager.downloadPackageVersion(name, version, (status) => windowManager.sendSplashProgress(status)));
  ipcMain.handle('npm:switch', async (_e, pluginName, name, version) => pluginManager.switchPluginVersion(pluginName, { name, version }));
  ipcMain.handle('npm:installed', async () => pluginManager.listInstalledPackages());
  ipcMain.handle('npm:moduleUsers', async (_e, name) => pluginManager.listPackageUsers(name));
  ipcMain.handle('npm:remove', async (_e, name, versions) => pluginManager.removePackageVersions(name, versions));

  ipcMain.handle('plugin:deps:status', async (_e, idOrName) => pluginManager.getPluginDependencyStatus(idOrName));
  ipcMain.handle('plugin:deps:ensure', async (_e, idOrName) => pluginManager.ensureDeps(idOrName));
  ipcMain.handle('plugin:dependents', async (_e, idOrName) => pluginManager.listDependents(idOrName));

  ipcMain.handle('profiles:columnDefs', async () => pluginManager.getStudentColumnDefs());

  ipcMain.on('plugin:register', (event, pluginId, functions) => {
    pluginManager.registerFunctions(pluginId, functions, event.sender);
  });

  ipcMain.handle('plugin:call', async (event, targetPluginId, fnName, args) => {
    try {
      const callerId = pluginManager.getPluginIdByWebContentsId(event.sender.id);
      return pluginManager.callFunction(targetPluginId, fnName, args, callerId || null);
    } catch (e) {
      return pluginManager.callFunction(targetPluginId, fnName, args, null);
    }
  });

  ipcMain.on('plugin:event:subscribe', (event, evName) => {
    pluginManager.subscribeEvent(evName, event.sender);
  });

  ipcMain.handle('plugin:event:emit', async (_event, evName, payload) => pluginManager.emitEvent(evName, payload));

  ipcMain.handle('actions:list', async () => pluginManager.listActions());
  ipcMain.handle('actions:getDefaults', async () => {
    try { return store.getAll('system')?.defaultActions || {}; } catch (e) { return {}; }
  });
  ipcMain.handle('actions:setDefault', async (_e, actionId, pluginId) => pluginManager.setDefaultAction(actionId, pluginId));
  ipcMain.handle('actions:call', async (_e, actionId, args, preferredPluginId) => pluginManager.callAction(actionId, args, preferredPluginId));

  ipcMain.handle('behaviors:list', async () => pluginManager.listBehaviors());
  ipcMain.handle('behaviors:getDefaults', async () => {
    try { return store.getAll('system')?.defaultBehaviors || {}; } catch (e) { return {}; }
  });
  ipcMain.handle('behaviors:setDefault', async (_e, behaviorId, pluginId) => pluginManager.setDefaultBehavior(behaviorId, pluginId));
  ipcMain.handle('behaviors:call', async (_e, behaviorId, args, preferredPluginId) => pluginManager.callBehavior(behaviorId, args, preferredPluginId));

  ipcMain.handle('plugin:variables:list', async (_e, pluginId) => pluginManager.listVariables(pluginId));
  ipcMain.handle('plugin:variables:get', async (_e, pluginId, varName) => pluginManager.getVariable(pluginId, varName));

  ipcMain.handle('components:list', async (_e, group) => pluginManager.listComponents(group));
  ipcMain.handle('components:entryUrl', async (_e, idOrName) => pluginManager.getComponentEntryUrl(idOrName));

  ipcMain.on('plugin:automation:register', (event, pluginId, events) => {
    pluginManager.registerAutomationEvents(pluginId, events);
  });
  ipcMain.handle('plugin:automation:listEvents', async (_e, pluginId) => pluginManager.listAutomationEvents(pluginId));

  ipcMain.handle('plugin:automation:createShortcut', async (_e, pluginId, options) => {
    try {
      // Need to ensure automationManager is available. 
      // It is attached to global in main.js, or we can get it via a getter if we made one.
      // For now, assume global or passed in context.
      // Actually, automationManager is initialized in main.js and passed to pluginManager.
      // We can try to require the singleton if we exported it, but Automation/Main.js is a class.
      // Let's rely on global.__automationManager__ or similar if set, or just fix this later.
      // Wait, main.js does `global.__automationManager__ = automationManager`.
      const am = global.__automationManager__;
      if (am) return await am.createActionShortcut(pluginId, options || {});
      return { ok: false, error: 'Automation manager not ready' };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('plugin:pack', async (_e, pluginId) => {
    try {
      const dir = pluginManager.getPluginDir(pluginId);
      if (!dir) return { ok: false, error: 'plugin_not_found_or_no_local_path' };
      if (!fs.existsSync(dir)) return { ok: false, error: 'dir_not_found' };
      const zip = new AdmZip();
      zip.addLocalFolder(dir);
      const buffer = zip.toBuffer();
      return { ok: true, zipData: buffer };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('plugin:updateVersion', async (_e, pluginId, version) => pluginManager.updatePluginVersion(pluginId, version));
}

module.exports = { register };
