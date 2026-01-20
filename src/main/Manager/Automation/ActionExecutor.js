const { shell } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

class ActionExecutor {
  constructor(pluginManager, logFn) {
    this.pluginManager = pluginManager;
    this.log = logFn || ((...a) => {});
  }

  async execute(actions, ctx) {
    // 变量展开：支持字符串中的 ${插件:变量}
    const expandString = async (s) => {
      try {
        const str = String(s ?? '');
        const re = /\$\{([^}]+)\}/g;
        let out = str;
        let m;
        const seen = new Set();
        while ((m = re.exec(str)) != null) {
          const token = String(m[1] || '').trim();
          if (!token) continue;
          if (seen.has(m.index)) continue;
          seen.add(m.index);
          const parts = token.split(':');
          const pluginKey = String(parts[0] || '').trim();
          const varName = String(parts.slice(1).join(':') || '').trim();
          if (!pluginKey || !varName) continue;
          if (pluginKey === 'protocol') {
            const val = ctx && ctx.params ? ctx.params[varName] : '';
            out = out.replace(m[0], String(val ?? ''));
            continue;
          }
          try {
            const res = await this.pluginManager.getVariable(pluginKey, varName);
            const val = (res && res.ok) ? (res.result ?? '') : '';
            out = out.replace(m[0], String(val ?? ''));
          } catch (e) {}
        }
        return out;
      } catch (e) { return String(s ?? ''); }
    };
    const expandValue = async (v) => {
      try {
        if (typeof v === 'string') return expandString(v);
        if (Array.isArray(v)) {
          const arr = [];
          for (const it of v) arr.push(await expandValue(it));
          return arr;
        }
        if (v && typeof v === 'object') {
          const obj = {};
          for (const [k, val] of Object.entries(v)) obj[k] = await expandValue(val);
          return obj;
        }
        return v;
      } catch (e) { return v; }
    };

    for (const act of actions) {
      try {
        const manual = String(ctx?.reason || '') === 'manual_test';
        try { console.info('automation:action:start', { type: act.type, pluginId: act.pluginId || '', target: act.event || act.target || act.action || '' }); } catch (e) {}
        this.log('executeAction:start', act.type, act.pluginId || '', act.event || act.target || act.action || '');
        if (act.type === 'pluginEvent') {
          const params = Array.isArray(act.params) ? await Promise.all(act.params.map((x) => expandValue(x))) : [];
          await this.pluginManager.callFunction(act.pluginId, act.event, params);
        } else if (act.type === 'pluginAction') {
          const fn = String(act.target || act.action || '').trim();
          if (fn) {
            const params = Array.isArray(act.params) ? await Promise.all(act.params.map((x) => expandValue(x))) : [];
            await this.pluginManager.callFunction(act.pluginId, fn, params);
          }
        } else if (act.type === 'power') {
          const platform = process.platform;
          if (platform === 'win32') {
            const sysRoot = process.env.SystemRoot || 'C\\Windows';
            const p1 = path.join(sysRoot, 'System32', 'shutdown.exe');
            const p2 = path.join(sysRoot, 'Sysnative', 'shutdown.exe');
            const exe = fs.existsSync(p1) ? p1 : (fs.existsSync(p2) ? p2 : 'shutdown');
            const args = (act.op === 'restart') ? ['/r', '/t', '0'] : (act.op === 'logoff') ? ['/l'] : ['/s', '/t', '0'];
            spawn(exe, args, { windowsHide: true });
          } else if (platform === 'darwin') {
            // macOS: 使用 AppleScript 调用系统事件
            const action = (act.op === 'restart') ? 'restart' : (act.op === 'logoff') ? 'log out' : 'shut down';
            try {
              spawn('osascript', ['-e', `tell application "System Events" to ${action}`], { windowsHide: true });
            } catch (e) {}
          } else {
            // Linux: 优先使用 systemctl，其次回退到 shutdown
            const trySpawn = (cmd, args) => { try { spawn(cmd, args, { windowsHide: true }); return true; } catch (e) { return false; } };
            if (act.op === 'restart') {
              if (!trySpawn('systemctl', ['reboot'])) {
                trySpawn('shutdown', ['-r', 'now']);
              }
            } else if (act.op === 'logoff') {
              // 退出会话依赖桌面环境，尝试常见命令
              if (!trySpawn('gnome-session-quit', ['--logout', '--no-prompt'])) {
                const user = process.env.USER || process.env.LOGNAME || '';
                if (user) {
                  // loginctl 需要 systemd 支持；可能需权限
                  trySpawn('loginctl', ['terminate-user', user]);
                }
              }
            } else {
              if (!trySpawn('systemctl', ['poweroff'])) {
                trySpawn('shutdown', ['-h', 'now']);
              }
            }
          }
        } else if (act.type === 'openApp') {
          if (act.path) {
            try { const p = await expandString(act.path); shell.openPath(p); } catch (e) { shell.openPath(act.path); }
          }
        } else if (act.type === 'cmd') {
          const cmdStr = String(act.command || '').trim();
          if (cmdStr) {
            let expanded = cmdStr;
            try { expanded = await expandString(cmdStr); } catch (e) {}
            const platform = process.platform;
            if (platform === 'win32') {
              // Windows: 使用 cmd.exe /d /s /c
              const comspec = process.env.ComSpec || path.join(process.env.SystemRoot || 'C\\Windows', 'System32', 'cmd.exe');
              try {
                spawn(comspec, ['/d', '/s', '/c', expanded], { windowsHide: true });
              } catch (e) {
                try { spawn(expanded, { shell: true, windowsHide: true }); } catch (e) {}
              }
            } else {
              // macOS/Linux: 使用登录 Shell 执行命令，支持别名与 PATH
              const shellPath = process.env.SHELL || '/bin/sh';
              try {
                spawn(shellPath, ['-lc', expanded], { windowsHide: true });
              } catch (e) {
                try { spawn(expanded, { shell: true, windowsHide: true }); } catch (e) {}
              }
            }
          }
        } else if (act.type === 'wait') {
          let secVal = 0;
          if (act.seconds != null) secVal = Number(act.seconds);
          else if (act.sec != null) secVal = Number(act.sec);
          else if (act.ms != null) secVal = Number(act.ms) / 1000;
          const sec = Math.max(0, isNaN(secVal) ? 0 : secVal);
          await new Promise((resolve) => setTimeout(resolve, Math.round(sec * 1000)));
        }
        try { console.info('automation:action:success', { type: act.type }); } catch (e) {}
        this.log('executeAction:success', act.type);
      } catch (e) {
        try { console.info('automation:action:error', { type: act.type, error: e?.message || String(e) }); } catch (e) {}
        this.log('executeAction:error', act.type, e?.message || String(e));
      }
    }
  }
}

module.exports = ActionExecutor;
