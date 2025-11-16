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
      // 控制运行窗口显示/隐藏（空闲隐藏，有通知显示）
      setVisible: (visible) => ipcRenderer.invoke('notify:setVisible', !!visible),
      // 运行窗口订阅主进程广播的配置更新，实现设置实时生效
      onConfigUpdate: (handler) => {
        try { ipcRenderer.on('notify:config:update', (_e, cfg) => handler && handler(cfg)); } catch {}
      },
      // 系统音量暂调：播放通知音效前设置、结束后恢复
      setSystemVolume: (level) => ipcRenderer.invoke('notify:setSystemVolume', Number(level)),
      restoreSystemVolume: () => ipcRenderer.invoke('notify:restoreSystemVolume'),
      // 运行窗口可调用主进程插件函数（用于本地 EdgeTTS 等）
      pluginCall: (targetPluginId, fnName, args) => ipcRenderer.invoke('plugin:call', targetPluginId, fnName, args),
      // 组件：列表与入口URL（供遮罩组件加载）
      componentsList: (group) => ipcRenderer.invoke('components:list', group),
      componentsGetEntryUrl: (idOrName) => ipcRenderer.invoke('components:entryUrl', idOrName)
    });
  } catch (e) {
    // 非 Electron 环境（例如浏览器预览）下静默降级
  }
})();