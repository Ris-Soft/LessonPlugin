const { contextBridge, ipcRenderer } = require('electron');

// 在嵌入的 webview 中暴露与主进程交互的 lowbarAPI 子集
// 供浮层页面（如多维单词的 dict/externallib 等）直接调用插件后端
try {
  contextBridge.exposeInMainWorld('lowbarAPI', {
    // 直接调用其他插件后端函数
    pluginCall: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
    // 事件通道（可选）
    emitEvent: (name, payload) => ipcRenderer.invoke('plugin:event:emit', name, payload),
    subscribe: (eventName) => ipcRenderer.send('plugin:event:subscribe', eventName),
    onEvent: (handler) => {
      try { ipcRenderer.on('plugin:event', (_e, { name, payload }) => handler && handler(name, payload)); } catch {}
    }
  });
} catch {}