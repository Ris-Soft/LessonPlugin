const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

function readJsonSafe(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return fallback; }
}

function slugName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch {}
}

function createJunction(target, linkPath) {
  try {
    if (fs.existsSync(linkPath)) {
      const st = fs.lstatSync(linkPath);
      if (st.isSymbolicLink() || st.isDirectory()) fs.rmSync(linkPath, { recursive: true, force: true });
      else fs.unlinkSync(linkPath);
    }
  } catch {}
  ensureDir(path.dirname(linkPath));
  const type = process.platform === 'win32' ? 'junction' : 'dir';
  fs.symlinkSync(target, linkPath, type);
}

function resolvePluginId(pluginDir) {
  const metaPath = path.join(pluginDir, 'plugin.json');
  let id = '';
  let name = '';
  try {
    if (fs.existsSync(metaPath)) {
      const meta = readJsonSafe(metaPath, {});
      id = String(meta.id || '').trim();
      name = String(meta.name || '').trim();
    }
  } catch {}
  const indexJs = path.join(pluginDir, 'index.js');
  if (!id && !name && fs.existsSync(indexJs)) {
    try {
      const mod = require(indexJs);
      name = String(mod?.name || name || '');
    } catch {}
  }
  const cleanId = slugName(id);
  const fromName = slugName(name);
  const base = path.basename(pluginDir).toLowerCase();
  return cleanId || fromName || slugName(base);
}

function ensurePlaceholderFiles(devRoot) {
  const cfgPath = path.join(devRoot, 'config.json');
  const manifestPath = path.join(devRoot, 'plugins.json');
  try { if (!fs.existsSync(cfgPath)) fs.writeFileSync(cfgPath, JSON.stringify({ enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} }, null, 2), 'utf-8'); } catch {}
  try { if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, JSON.stringify({ plugins: [] }, null, 2), 'utf-8'); } catch {}
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const cfg = readJsonSafe(path.join(repoRoot, 'dev-plugins.json'), { plugins: [] });
  const devRoot = path.join(path.resolve(__dirname, '..'), 'dev-plugins');
  ensureDir(devRoot);
  ensurePlaceholderFiles(devRoot);
  const list = Array.isArray(cfg.plugins) ? cfg.plugins : [];
  for (const rel of list) {
    const abs = path.resolve(repoRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    const id = resolvePluginId(abs);
    const linkPath = path.join(devRoot, id);
    try { createJunction(abs, linkPath); } catch {}
  }
  const env = { ...process.env, LP_DEV_PLUGINS: devRoot, LP_DEV_PLUGINS_WATCH: '1', NODE_ENV: 'development' };
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const proc = spawn(npmCmd, ['run', 'start'], { cwd: path.join(__dirname, '..'), env, stdio: 'inherit' });
  proc.on('exit', (code) => process.exit(code || 0));
}

main();
