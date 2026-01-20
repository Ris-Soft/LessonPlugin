const { ipcMain } = require('electron');
const AdmZip = require('adm-zip');

function register(automationManager) {
  // Fallback to global if not passed
  const am = automationManager || global.__automationManager__;

  ipcMain.handle('automation:list', async () => am.list());
  ipcMain.handle('automation:get', async (_e, id) => am.get(id));
  ipcMain.handle('automation:create', async (_e, payload) => {
    try {
      const item = await am.create(payload);
      return { ok: true, item };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
  ipcMain.handle('automation:update', async (_e, id, patch) => am.update(id, patch));
  ipcMain.handle('automation:remove', async (_e, id) => am.remove(id));
  ipcMain.handle('automation:toggle', async (_e, id, enabled) => am.toggle(id, enabled));
  ipcMain.handle('automation:invokeProtocol', async (_e, text, params) => am.invokeProtocol(text, params || {}));
  ipcMain.handle('automation:test', async (_e, id) => {
    try {
      const res = await am.test(id);
      return res;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });

  ipcMain.handle('automation:pack', async (_e, id) => {
    try {
      const item = await am.get(id);
      if (!item) return { ok: false, error: 'automation_not_found' };
      
      const zip = new AdmZip();
      const content = JSON.stringify(item, null, 2);
      zip.addFile('automation.json', Buffer.from(content, 'utf-8'));
      
      const buffer = zip.toBuffer();
      return { ok: true, zipData: buffer };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  });
}

module.exports = { register };
