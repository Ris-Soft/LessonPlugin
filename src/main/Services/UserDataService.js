const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function ensureUserDataShortcut() {
  try {
    const programDir = path.dirname(process.execPath);
    const userRoot = path.join(app.getPath('userData'), 'OrbiBoard');
    let fileName = '';
    let content = '';
    if (process.platform === 'win32') {
      fileName = 'Open User Data.bat';
      content = `@echo off\r\nstart "" "${userRoot.replace(/\\/g,'\\\\')}"\r\n`;
    } else if (process.platform === 'darwin') {
      fileName = 'Open User Data.command';
      content = `#!/bin/bash\nopen "${userRoot}"\n`;
    } else {
      // linux
      fileName = 'Open User Data.sh';
      content = `#!/bin/sh\nxdg-open "${userRoot}" 2>/dev/null || xdg-open "${userRoot}"\n`;
    }
    const fullPath = path.join(programDir, fileName);
    if (!fs.existsSync(fullPath)) {
      fs.writeFileSync(fullPath, content, 'utf-8');
      try { fs.chmodSync(fullPath, 0o755); } catch (e) {}
    }
  } catch (e) {}
}

function applyUserDataOverride() {
  try {
    const programDir = path.dirname(process.execPath);
    const markerPath = path.join(programDir, 'user-data.json');
    if (fs.existsSync(markerPath)) {
      const text = fs.readFileSync(markerPath, 'utf-8');
      const cfg = JSON.parse(text);
      const overrideDir = String(cfg?.overrideDir || '').trim();
      if (overrideDir) {
        const target = path.isAbsolute(overrideDir) ? overrideDir : path.join(programDir, overrideDir);
        try { fs.mkdirSync(target, { recursive: true }); } catch (e) {}
        app.setPath('userData', target);
      }
    }
  } catch (e) {}
}

async function getUserDataSize() {
  try {
    const root = path.join(app.getPath('userData'), 'OrbiBoard');
    const dirSize = (p) => {
      try {
        if (!fs.existsSync(p)) return 0;
        const entries = fs.readdirSync(p);
        let total = 0;
        for (const name of entries) {
          const sub = path.join(p, name);
          let st;
          try { st = fs.statSync(sub); } catch (e) { continue; }
          if (st.isDirectory()) total += dirSize(sub);
          else total += Number(st.size || 0);
        }
        return total;
      } catch (e) { return 0; }
    };
    const bytes = dirSize(root);
    return { ok: true, bytes };
  } catch (e) {
    return { ok: false, bytes: 0, error: e?.message || String(e) };
  }
}

async function openUserData() {
  try {
    const root = path.join(app.getPath('userData'), 'OrbiBoard');
    try { fs.mkdirSync(root, { recursive: true }); } catch (e) {}
    const res = await require('electron').shell.openPath(root);
    return { ok: !res, error: res || null };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function changeUserData() {
  try {
    const sel = await require('electron').dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (sel.canceled || !sel.filePaths || !sel.filePaths[0]) return { ok: false, error: '未选择目录' };
    const targetBase = sel.filePaths[0];
    if (path.resolve(targetBase) === path.resolve(app.getPath('userData'))) {
      return { ok: false, error: '选择的目录与当前目录相同' };
    }
    const currentBase = app.getPath('userData');
    const currentRoot = path.join(currentBase, 'OrbiBoard');
    const nextRoot = path.join(targetBase, 'OrbiBoard');
    try { fs.mkdirSync(nextRoot, { recursive: true }); } catch (e) {}
    const copyDir = (src, dst) => {
      if (!fs.existsSync(src)) return;
      const entries = fs.readdirSync(src);
      for (const name of entries) {
        const s = path.join(src, name);
        const d = path.join(dst, name);
        const stat = fs.statSync(s);
        if (stat.isDirectory()) {
          try { fs.mkdirSync(d, { recursive: true }); } catch (e) {}
          copyDir(s, d);
        } else {
          try { fs.copyFileSync(s, d); } catch (e) {}
        }
      }
    };
    copyDir(currentRoot, nextRoot);
    const programDir = path.dirname(process.execPath);
    const markerPath = path.join(programDir, 'user-data.json');
    let writeOk = false;
    try { fs.writeFileSync(markerPath, JSON.stringify({ overrideDir: targetBase }, null, 2), 'utf-8'); writeOk = true; } catch (e) {}
    let verifyOk = false;
    try {
      const text = fs.readFileSync(markerPath, 'utf-8');
      const cfg = JSON.parse(text);
      verifyOk = String(cfg?.overrideDir || '') === targetBase;
    } catch (e) {}
    if (!writeOk || !verifyOk) {
      return { ok: false, error: '无法写入应用目录标记文件，请检查权限后重试' };
    }
    return { ok: true, nextPath: targetBase };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function cleanupUserData() {
  try {
    const root = path.join(app.getPath('userData'), 'OrbiBoard');
    if (fs.existsSync(root)) {
      // 关闭可能打开的窗口以释放文件句柄
      // 注意：这里无法直接调用 closeAllWindows，需要外部处理或通过事件
      try { require('electron').BrowserWindow.getAllWindows().forEach(w => w.close()); } catch (e) {}
      fs.rmSync(root, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = {
  ensureUserDataShortcut,
  applyUserDataOverride,
  getUserDataSize,
  openUserData,
  changeUserData,
  cleanupUserData
};
