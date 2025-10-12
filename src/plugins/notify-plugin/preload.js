// 预加载脚本：在 Electron 环境中暴露控制穿透的 API
(() => {
  try {
    const { contextBridge, ipcRenderer } = require('electron');
    contextBridge.exposeInMainWorld('notifyAPI', {
      // 启用/关闭运行窗口的穿透；true 为穿透（允许点击穿透到下层应用）
      setClickThrough: (enable) => ipcRenderer.invoke('notify:setClickThrough', !!enable),
      // 运行窗口订阅主进程投递的通知
      onEnqueue: (handler) => {
        try { ipcRenderer.on('notify:enqueue', (_e, payloadOrList) => handler && handler(payloadOrList)); } catch {}
      },
      // 运行窗口订阅主进程广播的配置更新，实现设置实时生效
      onConfigUpdate: (handler) => {
        try { ipcRenderer.on('notify:config:update', (_e, cfg) => handler && handler(cfg)); } catch {}
      }
    });
  } catch (e) {
    // 非 Electron 环境（例如浏览器预览）下静默降级
  }
})();