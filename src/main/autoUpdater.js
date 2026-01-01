const { app, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const url = require('url');
const store = require('./store');

function cmp(a, b) {
  const pa = String(a || '').split('.').map((x) => parseInt(x, 10) || 0);
  const pb = String(b || '').split('.').map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const da = pa[i] || 0; const db = pb[i] || 0;
    if (da !== db) return da - db;
  }
  return 0;
}

function getJson(u) {
  return new Promise((resolve, reject) => {
    try {
      const p = url.parse(u);
      const lib = (p.protocol === 'https:' ? https : http);
      const req = lib.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(getJson(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(String(res.statusCode)));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', (e) => reject(e));
    } catch (e) {
      reject(e);
    }
  });
}

function download(u, dest, onProgress) {
  return new Promise((resolve, reject) => {
    try {
      const p = url.parse(u);
      const lib = (p.protocol === 'https:' ? https : http);
      const file = fs.createWriteStream(dest);
      const req = lib.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          try { file.close(); } catch {}
          return resolve(download(res.headers.location, dest, onProgress));
        }
        if (res.statusCode !== 200) {
          try { file.close(); } catch {}
          return reject(new Error(String(res.statusCode)));
        }
        const total = parseInt(res.headers['content-length'] || '0', 10) || 0;
        let received = 0;
        res.on('data', (chunk) => {
          file.write(chunk);
          received += chunk.length;
          if (onProgress && total > 0) {
            try { onProgress({ stage: 'update', message: `下载更新包 ${Math.floor(received * 100 / total)}%` }); } catch {}
          }
        });
        res.on('end', () => {
          file.end(() => resolve({ ok: true, path: dest }));
        });
      });
      req.on('error', (e) => {
        try { file.close(); } catch {}
        reject(e);
      });
    } catch (e) {
      reject(e);
    }
  });
}

function applyAsar(srcPath) {
  try {
    const resourcesDir = path.resolve(path.dirname(process.execPath), 'resources');
    const target = path.join(resourcesDir, 'app.asar');
    const bak = path.join(resourcesDir, `app_${Date.now()}.asar.bak`);
    const tmp = path.join(resourcesDir, `app_${Date.now()}.asar.new`);
    fs.copyFileSync(srcPath, tmp);
    if (fs.existsSync(target)) {
      try { fs.renameSync(target, bak); } catch {}
    }
    fs.renameSync(tmp, target);
    return true;
  } catch (e) {
    return false;
  }
}

async function checkAndUpdate(onProgress, checkOnly = false) {
  try {
    if (!app.isPackaged) return { ok: false, error: 'not_packaged' };
    const cfg = store.getAll('system') || {};
    const enabled = cfg.autoUpdateEnabled !== false;
    // 如果是 checkOnly（手动检查），即使禁用了自动更新也允许检查
    if (!enabled && !checkOnly) return { ok: false, error: 'disabled' };
    const base = cfg.updateServerUrl || 'http://localhost:3030';
    const versionUrl = `${base.replace(/\/+$/,'')}/api/version`;
    if (onProgress) { try { onProgress({ stage: 'update', message: '检查更新...' }); } catch {} }
    const info = await getJson(versionUrl);
    const remote = String(info?.version || '');
    const local = String(app.getVersion ? app.getVersion() : (require('../../package.json').version || '0.0.0'));
    if (!remote) return { ok: false, error: 'no_remote_version' };
    
    // 获取更新日志
    let notes = '';
    try {
      const logUrl = `${base.replace(/\/+$/,'')}/api/changelog`;
      const logs = await getJson(logUrl);
      if (Array.isArray(logs)) {
        const entry = logs.find(x => x.version === remote);
        if (entry && entry.notes) notes = entry.notes;
      }
    } catch {}

    const hasUpdate = cmp(remote, local) > 0;
    
    // 如果只是检查，返回详细信息
    if (checkOnly) {
      return { 
        ok: true, 
        hasUpdate, 
        currentVersion: local, 
        remoteVersion: remote, 
        notes,
        info 
      };
    }

    if (!hasUpdate) return { ok: true, updated: false, version: local };
    
    const asarSupported = !!info.asarSupported;
    const asarUrl = info?.asar?.url || '';
    
    let useAsar = false;
    if (asarSupported && asarUrl) {
      useAsar = true;
    }

    const tmpDir = path.join(app.getPath('temp'), 'OrbiBoard');
    try { fs.mkdirSync(tmpDir, { recursive: true }); } catch {}

    if (useAsar) {
      // ASAR 更新模式
      if (notes && onProgress) {
        try { onProgress({ stage: 'update', message: `发现新版本 v${remote}\n${notes.split('\n')[0]}...` }); } catch {}
      }
      const dlUrl = asarUrl.startsWith('http') ? asarUrl : `${base.replace(/\/+$/,'')}${asarUrl.startsWith('/') ? asarUrl : ('/' + asarUrl)}`;
      const tmpFile = path.join(tmpDir, `update_${Date.now()}.asar`);
      const dl = await download(dlUrl, tmpFile, onProgress);
      if (!dl.ok) return { ok: false, error: 'download_failed' };
      if (onProgress) { try { onProgress({ stage: 'update', message: '应用更新包...' }); } catch {} }
      const applied = applyAsar(tmpFile);
      try { fs.unlinkSync(tmpFile); } catch {}
      if (!applied) return { ok: false, error: 'apply_failed' };
      try { store.set('system', 'openSettingsOnBootOnce', true); } catch {}
      app.relaunch();
      app.exit(0);
      return { ok: true, updated: true, version: remote, type: 'asar' };
    } else {
      // 安装包更新模式
      let installUrl = '';
      let installName = '';
      if (process.platform === 'win32') {
        installUrl = info?.windows?.url;
        installName = info?.windows?.filename || 'installer.exe';
      } else if (process.platform === 'linux') {
        installUrl = info?.uos?.url; // 假设 Linux 使用 UOS 构建
        installName = info?.uos?.filename || 'installer.deb';
      }
      
      if (!installUrl) return { ok: false, error: 'no_installer_url' };
      
      if (notes && onProgress) {
        try { onProgress({ stage: 'update', message: `下载安装包 v${remote}\n${notes.split('\n')[0]}...` }); } catch {}
      }

      const dlUrl = installUrl.startsWith('http') ? installUrl : `${base.replace(/\/+$/,'')}${installUrl.startsWith('/') ? installUrl : ('/' + installUrl)}`;
      const tmpFile = path.join(tmpDir, installName);
      
      // 如果文件已存在且大小匹配，可能无需下载（略，简单起见总是下载）
      const dl = await download(dlUrl, tmpFile, onProgress);
      if (!dl.ok) return { ok: false, error: 'download_installer_failed' };
      
      if (onProgress) { try { onProgress({ stage: 'update', message: '正在启动安装程序...' }); } catch {} }
      
      // 启动安装包
      try {
        await shell.openPath(tmpFile);
        setTimeout(() => app.quit(), 1000); // 给予一点时间启动
      } catch (e) {
        return { ok: false, error: 'open_installer_failed' };
      }
      
      return { ok: true, updated: true, version: remote, type: 'installer' };
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

module.exports = { checkAndUpdate };
