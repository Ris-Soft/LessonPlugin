const fs = require('fs');
const path = require('path');

function readJsonSafe(fp, fallback) {
  try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch { return fallback; }
}

function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch {} }

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(dst);
  const items = fs.readdirSync(src);
  for (const it of items) {
    const sp = path.join(src, it);
    const dp = path.join(dst, it);
    const st = fs.statSync(sp);
    if (st.isDirectory()) {
      copyDir(sp, dp);
    } else {
      try { fs.copyFileSync(sp, dp); } catch {}
    }
  }
}

function slugName(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/\./g, '-')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
}

function resolvePluginDirName(pluginDir) {
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
  const base = path.basename(pluginDir).toLowerCase();
  const cleanId = slugName(id);
  const fromName = slugName(name);
  return cleanId || fromName || slugName(base);
}

function main() {
  const repoRoot = path.resolve(__dirname, '..', '..');
  const cfg = readJsonSafe(path.join(repoRoot, 'pack-plugins.json'), { plugins: [] });
  const outRoot = path.join(path.resolve(__dirname, '..'), 'src', 'plugins');
  ensureDir(outRoot);
  const keepFiles = new Set(['config.json']);
  const existing = fs.readdirSync(outRoot).filter((n) => fs.existsSync(path.join(outRoot, n)));
  for (const name of existing) {
    if (keepFiles.has(name)) continue;
    try { fs.rmSync(path.join(outRoot, name), { recursive: true, force: true }); } catch {}
  }
  const list = Array.isArray(cfg.plugins) ? cfg.plugins : [];
  for (const rel of list) {
    const abs = path.resolve(repoRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    const dirName = resolvePluginDirName(abs);
    const dst = path.join(outRoot, dirName);
    copyDir(abs, dst);
  }
}

main();
