const fs = require('fs');
const path = require('path');
const Module = require('module');
const { app } = require('electron');
const Registry = require('./Registry');
const Utils = require('./Utils');

function addNodeModulesToGlobalPaths(baseDir) {
  try {
    if (!baseDir || !fs.existsSync(baseDir)) return;
    const names = fs.readdirSync(baseDir);
    for (const name of names) {
      const nameDir = path.join(baseDir, name);
      try { if (!fs.statSync(nameDir).isDirectory()) continue; } catch (e) { continue; }
      // 支持 scope 目录：@scope 下的多个包
      const packageDirs = name.startsWith('@')
        ? fs.readdirSync(nameDir).map((pkg) => path.join(nameDir, pkg)).filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (e) { return false; } })
        : [nameDir];
      for (const pkgDir of packageDirs) {
        let versions = [];
        try { versions = fs.readdirSync(pkgDir); } catch (e) { versions = []; }
        for (const v of versions) {
          const nm = path.join(pkgDir, v, 'node_modules');
          try {
            if (fs.existsSync(nm) && fs.statSync(nm).isDirectory()) {
              if (!Module.globalPaths.includes(nm)) Module.globalPaths.push(nm);
            }
          } catch (e) {}
        }
      }
    }
  } catch (e) {}
}

function refreshGlobalModulePaths() {
  // 用户数据 npm_store 与内置 src/npm_store 都加入查找路径
  try {
    addNodeModulesToGlobalPaths(Registry.storeRoot);
    const shippedStore = path.join(app.getAppPath(), 'src', 'npm_store');
    addNodeModulesToGlobalPaths(shippedStore);
    // 兼容在项目根目录安装的依赖（例如 d:\LessonPlugin\node_modules）
    const appNodeModules = path.join(app.getAppPath(), 'node_modules');
    try {
      if (fs.existsSync(appNodeModules) && fs.statSync(appNodeModules).isDirectory()) {
        if (!Module.globalPaths.includes(appNodeModules)) Module.globalPaths.push(appNodeModules);
      }
    } catch (e) {}
  } catch (e) {}
}

function encodePkgPath(name) {
  const base = String(Registry.config.registry || 'https://registry.npmmirror.com').replace(/\/+$/g, '');
  const segs = String(name).split('/').filter(Boolean).map((s) => encodeURIComponent(s));
  return `${base}/${segs.join('/')}`;
}

async function getPackageVersions(name) {
  const url = encodePkgPath(name);
  const res = await Utils.fetchJson(url);
  if (!res.ok) return { ok: false, error: res.error || 'registry 请求失败' };
  const data = res.json || {};
  try {
    const versionsObj = data.versions || {};
    let versions = Object.keys(versionsObj);
    try {
      const cmp = require('semver-compare');
      versions.sort(cmp);
    } catch (e) {}
    return { ok: true, versions };
  } catch (e) {
    return { ok: false, error: e?.message || '解析版本失败' };
  }
}

async function downloadPackageVersion(name, version, onProgress) {
  const segs = String(name).split('/').filter(Boolean);
  const dest = path.join(Registry.storeRoot, ...segs, version);
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const nm = path.join(dest, 'node_modules');
  if (!fs.existsSync(nm)) { try { fs.mkdirSync(nm, { recursive: true }); } catch (e) {} }
  const directPath = path.join(nm, ...segs);
  if (fs.existsSync(directPath)) return { ok: true, path: directPath };
  onProgress && onProgress({ stage: 'npm', message: `下载 ${name}@${version} ...` });
  const metaRes = await Utils.fetchJson(`${encodePkgPath(name)}`);
  if (!metaRes.ok) return { ok: false, error: metaRes.error || '获取包信息失败' };
  const data = metaRes.json || {};
  const verData = (data.versions && data.versions[version]) ? data.versions[version] : null;
  const tarball = verData && verData.dist && verData.dist.tarball ? verData.dist.tarball : null;
  if (!tarball) return { ok: false, error: '缺少 tarball 地址' };
  const tgz = await Utils.httpGet(tarball);
  if (!tgz.ok) return { ok: false, error: tgz.error || '下载失败' };
  const tmpDir = path.join(dest, '__tmp__');
  try { if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true }); } catch (e) {}
  const tmpTgz = path.join(tmpDir, `${segs[segs.length - 1]}-${version}.tgz`);
  try { fs.writeFileSync(tmpTgz, tgz.buffer); } catch (e) { return { ok: false, error: e?.message || '写入临时文件失败' }; }
  {
    let extractedOk = false;
    let extractErr = null;
    const tarAvailable = Utils.ensureTar();
    if (tarAvailable) {
      try { await Utils.getTar().x({ file: tmpTgz, cwd: tmpDir }); extractedOk = true; }
      catch (e) { extractErr = e; }
    }
    if (!extractedOk) {
      try { await Utils.extractWithSystemTar(tmpTgz, tmpDir); extractedOk = true; }
      catch (e) { extractErr = e; }
    }
    if (!extractedOk) {
      try { await Utils.extractTgzPureJS(tmpTgz, tmpDir); extractedOk = true; }
      catch (e) { extractErr = e; }
    }
    if (!extractedOk) {
      return { ok: false, error: `解压失败：${extractErr?.message || 'tar不可用'}` };
    }
  }
  const extracted = path.join(tmpDir, 'package');
  if (!fs.existsSync(extracted)) return { ok: false, error: '解压内容缺失' };
  try {
    fs.mkdirSync(path.dirname(directPath), { recursive: true });
    const copyDir = (src, dst) => {
      const items = fs.readdirSync(src);
      if (!fs.existsSync(dst)) fs.mkdirSync(dst, { recursive: true });
      for (const it of items) {
        const s = path.join(src, it);
        const d = path.join(dst, it);
        const st = fs.statSync(s);
        if (st.isDirectory()) { copyDir(s, d); }
        else { fs.copyFileSync(s, d); }
      }
    };
    copyDir(extracted, directPath);
  } catch (e) {
    return { ok: false, error: e?.message || '复制解压内容失败' };
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (e) {}
  }
  try { if (!Module.globalPaths.includes(nm)) Module.globalPaths.push(nm); } catch (e) {}
  onProgress && onProgress({ stage: 'npm', message: `完成 ${name}@${version}` });
  return { ok: fs.existsSync(directPath), path: directPath };
}

// 选择已安装的最新版本（简单策略）
function pickInstalledLatest(name) {
  try {
    const segs = String(name).split('/').filter(Boolean);
    const nameDir = path.join(Registry.storeRoot, ...segs);
    if (!fs.existsSync(nameDir) || !fs.statSync(nameDir).isDirectory()) return null;
    const versions = fs.readdirSync(nameDir).filter((v) => {
      const vDir = path.join(nameDir, v, 'node_modules', ...segs);
      return fs.existsSync(vDir);
    }).sort((a, b) => {
      const pa = String(a).split('.').map((x) => parseInt(x, 10) || 0);
      const pb = String(b).split('.').map((x) => parseInt(x, 10) || 0);
      for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
        const da = pa[i] || 0; const db = pb[i] || 0;
        if (da !== db) return da - db;
      }
      return 0;
    });
    return versions[versions.length - 1] || null;
  } catch (e) { return null; }
}

function linkDepToPlugin(pluginDir, pkgName, version) {
  try {
    const pluginNm = path.join(pluginDir, 'node_modules');
    const segs = String(pkgName).split('/').filter(Boolean);
    const target = path.join(pluginNm, ...segs);
    const storePkg = path.join(Registry.storeRoot, ...segs, version, 'node_modules', ...segs);
    if (!fs.existsSync(storePkg)) return { ok: false, error: 'store_package_missing' };
    try { if (!fs.existsSync(pluginNm)) fs.mkdirSync(pluginNm, { recursive: true }); } catch (e) {}
    try {
      if (fs.existsSync(target)) {
        const stat = fs.lstatSync(target);
        if (stat.isSymbolicLink() || stat.isDirectory()) {
          fs.rmSync(target, { recursive: true, force: true });
        } else {
          fs.unlinkSync(target);
        }
      }
    } catch (e) {}
    // 确保父目录存在（处理 scope 嵌套）
    try { fs.mkdirSync(path.dirname(target), { recursive: true }); } catch (e) {}
    const type = process.platform === 'win32' ? 'junction' : 'dir';
    try {
      fs.symlinkSync(storePkg, target, type);
      return { ok: true, method: 'link' };
    } catch (e) {
      // 在部分 Windows 环境下可能没有创建符号链接的权限；回退为复制目录
      try {
        const copyDir = (src, dst) => {
          const items = fs.readdirSync(src);
          for (const it of items) {
            const sp = path.join(src, it);
            const dp = path.join(dst, it);
            const st = fs.statSync(sp);
            if (st.isDirectory()) {
              if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
              copyDir(sp, dp);
            } else {
              fs.copyFileSync(sp, dp);
            }
          }
        };
        if (!fs.existsSync(target)) fs.mkdirSync(target, { recursive: true });
        copyDir(storePkg, target);
        return { ok: true, method: 'copy' };
      } catch (copyErr) {
        return { ok: false, error: (copyErr?.message || String(copyErr)) };
      }
    }
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function collectPluginDeps(p) {
  const deps = [];
  try {
    const obj = (typeof p.npmDependencies === 'object' && !Array.isArray(p.npmDependencies) && p.npmDependencies) ? p.npmDependencies : {};
    for (const name of Object.keys(obj)) deps.push({ name, range: String(obj[name] || '').trim() });
    if (Array.isArray(p.packages)) {
      for (const pkg of p.packages) {
        const name = pkg?.name; if (!name) continue;
        const versions = Array.isArray(pkg.versions) ? pkg.versions : (pkg.version ? [pkg.version] : []);
        if (versions.length) {
          for (const v of versions) deps.push({ name, explicit: String(v) });
        } else {
          deps.push({ name });
        }
      }
    }
  } catch (e) {}
  return deps;
}

async function ensureDeps(idOrName, options) {
  try {
    const opts = options || {};
    const downloadIfMissing = (opts.downloadIfMissing !== undefined) ? !!opts.downloadIfMissing : true;
    const p = Registry.findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    if (!p.local) return { ok: true, logs: ['[deps] 插件未安装到本地目录，跳过依赖链接'] };
    const baseDir = path.join(path.dirname(Registry.manifestPath), p.local);
    const deps = collectPluginDeps(p);
    // 确保 config.npmSelection 存在，防止 undefined 错误
    if (!Registry.config.npmSelection) Registry.config.npmSelection = {};
    const selMap = (Registry.config.npmSelection[p.id] || Registry.config.npmSelection[p.name] || {});
    const logs = [];
    let hadError = false;
    logs.push(`[deps] 开始处理插件依赖：${p.name}（${deps.length} 项）`);
    console.log('deps:ensure', p.name, deps);
    for (const d of deps) {
      const name = d.name;
      let version = selMap[name] || d.explicit || null;
      if (!version) version = pickInstalledLatest(name);
      const segs = String(name).split('/').filter(Boolean);
      const storePath = version ? path.join(Registry.storeRoot, ...segs, version, 'node_modules', ...segs) : null;
      if (!version || !storePath || !fs.existsSync(storePath)) {
        if (!downloadIfMissing) {
          logs.push(`[deps] ${name} 缺少已安装版本，暂不下载（启动加速）`);
          continue;
        }
        let pick = d.explicit || null;
        if (!pick) {
          const list = await getPackageVersions(name);
          if (list.ok && Array.isArray(list.versions) && list.versions.length) {
            pick = list.versions[list.versions.length - 1];
          }
        }
        if (pick) {
          const dl = await downloadPackageVersion(name, pick, (status) => {
            try { if (Registry.progressReporter) Registry.progressReporter(status); } catch (e) {}
          });
          if (dl.ok) {
            version = pick;
            logs.push(`[deps] 下载 ${name}@${pick} 完成`);
          } else {
            logs.push(`[deps] 下载 ${name}@${pick} 失败：${dl.error}`);
            hadError = true;
            continue;
          }
        } else {
          logs.push(`[deps] 未能确定 ${name} 可用版本`);
          hadError = true;
          continue;
        }
      }
      try { if (Registry.progressReporter) Registry.progressReporter({ stage: 'npm', message: `链接 ${name}@${version} 到插件...` }); } catch (e) {}
      const link = linkDepToPlugin(baseDir, name, version);
      if (!link.ok) {
        logs.push(`[deps] 链接 ${name}@${version} 到插件失败：${link.error}`);
        try { console.error('deps:link:failed', name, version, link.error); } catch (e) {}
        hadError = true;
      } else {
        const method = link.method === 'copy' ? '复制' : '链接';
        logs.push(`[deps] 已${method} ${name}@${version} 到插件`);
        try { console.log('deps:link:success', name, version, method); } catch (e) {}
        try { if (Registry.progressReporter) Registry.progressReporter({ stage: 'npm', message: `已${method} ${name}@${version}` }); } catch (e) {}
      }
    }
    return { ok: !hadError, logs };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function getPluginDependencyStatus(idOrName) {
  try {
    const p = Registry.findPluginByIdOrName(idOrName);
    if (!p) return { ok: false, error: 'plugin_not_found' };
    const baseDir = p.local ? path.join(path.dirname(Registry.manifestPath), p.local) : null;
    const deps = collectPluginDeps(p);
    const status = [];
    for (const d of deps) {
      const name = d.name;
      const segs = String(name).split('/').filter(Boolean);
      const installed = [];
      try {
        const nameDir = path.join(Registry.storeRoot, ...segs);
        if (fs.existsSync(nameDir)) {
          const versions = fs.readdirSync(nameDir).filter((v) => {
            const vDir = path.join(nameDir, v, 'node_modules', ...segs);
            return fs.existsSync(vDir);
          });
          installed.push(...versions);
        }
      } catch (e) {}
      const linked = baseDir ? fs.existsSync(path.join(baseDir, 'node_modules', ...segs)) : false;
      status.push({ name, installed, linked });
    }
    return { ok: true, status };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function installNpm(idOrName, onProgress) {
  const p = Registry.findPluginByIdOrName(idOrName);
  if (!p) return { ok: false, error: '插件不存在' };

  const jobs = [];
  // 支持单个 npm 字段
  if (p.npm) {
    if (typeof p.npm === 'string') {
      // 获取最新版本
      const latest = await getPackageVersions(p.npm);
      if (!latest.ok || !latest.versions.length) return { ok: false, error: '无法获取最新版本' };
      const version = latest.versions[latest.versions.length - 1];
      jobs.push({ name: p.npm, version });
    } else if (p.npm.name) {
      jobs.push({ name: p.npm.name, version: p.npm.version });
    }
  }

  // 支持 packages 数组: [{ name, versions: ["1.0.0", "2.0.0"] }]
  if (Array.isArray(p.packages)) {
    for (const pkg of p.packages) {
      if (Array.isArray(pkg.versions)) {
        for (const v of pkg.versions) jobs.push({ name: pkg.name, version: v });
      } else if (pkg.version) {
        jobs.push({ name: pkg.name, version: pkg.version });
      }
    }
  }

  if (!jobs.length) return { ok: false, error: '无可安装的NPM包配置' };

  const results = [];
  for (const job of jobs) {
    const res = await downloadPackageVersion(job.name, job.version, onProgress);
    results.push({ pkg: `${job.name}@${job.version}`, ok: res.ok, error: res.error });
    if (res.ok) {
      if (!Registry.config.npmSelection[p.id]) Registry.config.npmSelection[p.id] = {};
      Registry.config.npmSelection[p.id][job.name] = job.version;
      Registry.saveConfig();
    }
  }
  try { await ensureDeps(p.id, { downloadIfMissing: false }); } catch (e) {}
  return { ok: results.every((r) => r.ok), results };
}

async function listInstalledPackages() {
  const result = [];
  try {
    if (!fs.existsSync(Registry.storeRoot)) return { ok: true, packages: [] };
    const names = fs.readdirSync(Registry.storeRoot);
    for (const name of names) {
      const nameDir = path.join(Registry.storeRoot, name);
      if (!fs.statSync(nameDir).isDirectory()) continue;
      if (name.startsWith('@')) {
        // 处理 scope 下的包
        const pkgs = fs.readdirSync(nameDir).filter((p) => {
          const pDir = path.join(nameDir, p);
          try { return fs.statSync(pDir).isDirectory(); } catch (e) { return false; }
        });
        for (const p of pkgs) {
          const pkgDir = path.join(nameDir, p);
          const versions = fs.readdirSync(pkgDir).filter((v) => {
            const vDir = path.join(pkgDir, v, 'node_modules', name, p);
            return fs.existsSync(vDir);
          });
          // 仅在存在有效版本时纳入列表；无版本则尝试清理空目录
          if (versions.length > 0) {
            result.push({ name: `${name}/${p}`, versions });
          } else {
            try {
              // 尝试移除空包目录（不影响其他包）
              const entries = fs.readdirSync(pkgDir);
              if (!entries.length) fs.rmSync(pkgDir, { recursive: true, force: true });
              // 若 scope 目录已空，也尝试清理
              const remain = fs.readdirSync(nameDir).filter((n) => {
                try { return fs.statSync(path.join(nameDir, n)).isDirectory(); } catch (e) { return false; }
              });
              if (!remain.length) fs.rmSync(nameDir, { recursive: true, force: true });
            } catch (e) {}
          }
        }
      } else {
        // 普通包
        const versions = fs.readdirSync(nameDir).filter((v) => {
          const vDir = path.join(nameDir, v, 'node_modules', name);
          return fs.existsSync(vDir);
        });
        if (versions.length > 0) {
          result.push({ name, versions });
        } else {
          // 清理空包目录
          try {
            const entries = fs.readdirSync(nameDir);
            if (!entries.length) fs.rmSync(nameDir, { recursive: true, force: true });
          } catch (e) {}
        }
      }
    }
    return { ok: true, packages: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function listPackageUsers(pkgName) {
  try {
    const users = [];
    const segs = String(pkgName).split('/').filter(Boolean);
    for (const p of (Registry.manifest.plugins || [])) {
      const baseDir = p.local ? path.join(path.dirname(Registry.manifestPath), p.local) : null;
      if (!baseDir) continue;
      const linkedPath = path.join(baseDir, 'node_modules', ...segs);
      if (fs.existsSync(linkedPath)) {
        let realLinked = null;
        let version = null;
        try {
          realLinked = fs.realpathSync(linkedPath);
          // 解析版本：storeRoot/[...segs]/<version>/node_modules/[...segs]
          const rel = path.relative(Registry.storeRoot, realLinked).replace(/\\/g, '/');
          const parts = rel.split('/').filter(Boolean);
          // 普通包：name/version/...
          // scope 包：@scope/pkg/version/...
          if (parts.length >= 2 && parts[0].startsWith('@')) {
            version = parts[2] || null;
          } else {
            version = parts[1] || null;
          }
        } catch (e) {}
        users.push({ pluginId: p.id, pluginName: p.name, version: version || null });
      }
    }
    return { ok: true, users };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

function removePackageVersions(pkgName, versions) {
  try {
    const segs = String(pkgName).split('/').filter(Boolean);
    const blocked = [];
    const removed = [];
    const errors = [];
    // 检查占用
    const usesRes = listPackageUsers(pkgName);
    const uses = (usesRes?.ok && Array.isArray(usesRes.users)) ? usesRes.users : [];
    const inUseVersions = new Set(uses.filter(u => u.version).map(u => String(u.version)));
    for (const v of (Array.isArray(versions) ? versions : [])) {
      const ver = String(v);
      if (inUseVersions.has(ver)) {
        blocked.push(ver);
        continue;
      }
      try {
        const verDir = path.join(Registry.storeRoot, ...segs, ver);
        if (fs.existsSync(verDir)) {
          // 递归删除版本目录
          fs.rmSync(verDir, { recursive: true, force: true });
          removed.push(ver);
        } else {
          errors.push({ version: ver, error: 'version_not_found' });
        }
      } catch (e) {
        errors.push({ version: ver, error: e?.message || String(e) });
      }
    }
    // 若该包已无有效版本，清理包目录及空的 scope 目录
    try {
      const pkgBase = path.join(Registry.storeRoot, ...segs);
      const isScoped = segs[0]?.startsWith('@');
      const pkgDir = isScoped && segs.length >= 2 ? path.join(Registry.storeRoot, segs[0], segs[1]) : (segs.length ? path.join(Registry.storeRoot, segs[0]) : pkgBase);
      const existsPkgDir = fs.existsSync(pkgDir) && fs.statSync(pkgDir).isDirectory();
      if (existsPkgDir) {
        // 检查是否还存在有效版本（node_modules/...segs 路径存在）
        const verNames = fs.readdirSync(pkgDir).filter((vn) => {
          const vPath = path.join(pkgDir, vn, 'node_modules', ...segs);
          return fs.existsSync(vPath);
        });
        if (verNames.length === 0) {
          // 没有有效版本，删除包目录
          try { fs.rmSync(pkgDir, { recursive: true, force: true }); } catch (e) {}
          // 若为 scoped 包，scope 目录为空则删除
          if (isScoped) {
            const scopeDir = path.join(Registry.storeRoot, segs[0]);
            try {
              const remain = fs.readdirSync(scopeDir).filter((n) => {
                try { return fs.statSync(path.join(scopeDir, n)).isDirectory(); } catch (e) { return false; }
              });
              if (remain.length === 0) fs.rmSync(scopeDir, { recursive: true, force: true });
            } catch (e) {}
          }
        }
      }
    } catch (e) {}
    // 删除后刷新全局模块路径（避免残留）
    try { refreshGlobalModulePaths(); } catch (e) {}
    const ok = errors.length === 0;
    return { ok, removed, blocked, errors, uses };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}

async function switchPluginVersion(pluginName, sel) {
  Registry.config.npmSelection[pluginName] = sel;
  Registry.saveConfig();
  return { ok: true, selection: sel };
}

module.exports = {
  addNodeModulesToGlobalPaths,
  refreshGlobalModulePaths,
  getPackageVersions,
  downloadPackageVersion,
  ensureDeps,
  getPluginDependencyStatus,
  installNpm,
  listInstalledPackages,
  listPackageUsers,
  removePackageVersions,
  switchPluginVersion
};
