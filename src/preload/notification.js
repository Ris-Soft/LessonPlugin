const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notificationAPI', {
  close: () => ipcRenderer.send('notification:close'),
  action: (act) => ipcRenderer.send('notification:action', act),
  onUpdate: (callback) => ipcRenderer.on('notification:update', (_e, data) => callback(data))
});
