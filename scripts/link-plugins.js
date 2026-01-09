const fs = require('fs');
const path = require('path');

function readJsonSafe(fp, fallback) { try { return JSON.parse(fs.readFileSync(fp, 'utf-8')); } catch (e) { return fallback; } }
function ensureDir(p) { try { fs.mkdirSync(p, { recursive: true }); } catch (e) {} }
function slugName(s) { return String(s||'').toLowerCase().replace(/\./g,'-').replace(/[^a-z0-9-]+/g,'-').replace(/^-+|-+$/g,'') || 'plugin'; }

function removeIfExists(p) {
  try {
    if (fs.existsSync(p)) {
      const st = fs.lstatSync(p);
      if (st.isDirectory() || st.isSymbolicLink()) fs.rmSync(p, { recursive: true, force: true });
      else fs.unlinkSync(p);
    }
  } catch (e) {}
}

function resolvePluginId(pluginDir) {
  const metaPath = path.join(pluginDir, 'plugin.json');
  let id = '', name = '';
  if (fs.existsSync(metaPath)) { const meta = readJsonSafe(metaPath, {}); id = String(meta.id||'').trim(); name = String(meta.name||'').trim(); }
  const cleanId = slugName(id); const fromName = slugName(name); const base = path.basename(pluginDir).toLowerCase();
  return cleanId || fromName || slugName(base);
}

function copyDir(src, dst) {
  if (!fs.existsSync(src)) return;
  ensureDir(dst);
  const items = fs.readdirSync(src);
  for (const it of items) {
    if (it === '.git') continue;
    const sp = path.join(src, it);
    const dp = path.join(dst, it);
    let st;
    try { st = fs.lstatSync(sp); } catch (e) { continue; }
    if (st.isDirectory()) {
      copyDir(sp, dp);
    } else if (st.isSymbolicLink()) {
      // 遇到符号链接时，读取目标内容并写入到目标位置（解引用）
      try {
        // 先删除目标文件（如果是符号链接）
        removeIfExists(dp);
        
        const realPath = fs.realpathSync(sp);
        const realSt = fs.statSync(realPath);
        if (realSt.isDirectory()) {
          copyDir(realPath, dp);
        } else {
          fs.copyFileSync(realPath, dp);
        }
      } catch (e) {
        console.warn(`[warn] Failed to resolve symlink ${sp}: ${e.message}`);
      }
    } else {
      try { fs.copyFileSync(sp, dp); } catch (e) {}
    }
  }
}

function cleanExtra(dst, src) {
  if (!fs.existsSync(dst)) return;
  const items = fs.readdirSync(dst);
  for (const it of items) {
    const dp = path.join(dst, it);
    const sp = path.join(src, it);
    if (it === '.git') { removeIfExists(dp); continue; }
    if (!fs.existsSync(sp)) removeIfExists(dp);
    else {
      let st;
      try { st = fs.statSync(dp); } catch (e) { continue; }
      if (st.isDirectory()) cleanExtra(dp, sp);
    }
  }
}

function syncPlugin(src, dst) {
  copyDir(src, dst);
  cleanExtra(dst, src);
}

function stamp() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

function fingerprintDir(root) {
  if (!fs.existsSync(root)) return '';
  const stack = [''];
  let acc = '';
  while (stack.length) {
    const rel = stack.pop();
    const dir = path.join(root, rel);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (e) { continue; }
    for (const name of names) {
      if (name === '.git') continue;
      const subRel = rel ? path.join(rel, name) : name;
      const p = path.join(root, subRel);
      let st;
      try { st = fs.statSync(p); } catch (e) { continue; }
      if (st.isDirectory()) { stack.push(subRel); }
      else { acc += `${subRel}|${st.size}|${st.mtimeMs};`; }
    }
  }
  return acc;
}

// sync tool does not handle renderer mirroring

function ensurePlaceholders(devRoot) {
  const cfgPath = path.join(devRoot, 'config.json');
  const manifestPath = path.join(devRoot, 'plugins.json');
  try { if (!fs.existsSync(cfgPath)) fs.writeFileSync(cfgPath, JSON.stringify({ enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} }, null, 2), 'utf-8'); } catch (e) {}
  try { if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, JSON.stringify({ plugins: [] }, null, 2), 'utf-8'); } catch (e) {}
}

function main() {
  const orbiRoot = path.resolve(__dirname, '..');
  const repoRoot = path.resolve(orbiRoot, '..');
  const cfg = readJsonSafe(path.join(orbiRoot, 'dev-plugins.json'), { paths: [] });
  const devRoot = path.join(orbiRoot, 'src', 'plugins');
  ensureDir(devRoot);
  // initialize src/plugins with default config if missing
  const cfgPath = path.join(devRoot, 'config.json');
  try {
    if (!fs.existsSync(cfgPath)) {
      fs.writeFileSync(cfgPath, JSON.stringify({ enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} }, null, 2), 'utf-8');
    }
  } catch (e) {}
  const list = Array.isArray(cfg.paths) ? cfg.paths : [];
  const lastFinger = new Map();
  for (const rel of list) {
    const abs = path.isAbsolute(rel) ? rel : path.resolve(orbiRoot, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) continue;
    const id = resolvePluginId(abs);
    const target = path.join(devRoot, id);
    let fp = '';
    try { fp = fingerprintDir(abs); } catch (e) { fp = ''; }
    try { syncPlugin(abs, target); } catch (e) {}
    lastFinger.set(abs, fp);
    try {
      const debounce = { t: 0 };
      const w = fs.watch(abs, { recursive: true }, (eventType, filename) => {
        const now = Date.now();
        if (now - debounce.t < 600) return;
        debounce.t = now;
        let cur = '';
        try { cur = fingerprintDir(abs); } catch (e) { cur = ''; }
        const prev = lastFinger.get(abs) || '';
        if (cur === prev) return;
        try { syncPlugin(abs, target); } catch (e) {}
        lastFinger.set(abs, cur);
        const rel = filename ? String(filename) : '';
        console.log(`[${stamp()}] Synced ${id}${rel ? `:${rel}` : ''} → ${target}`);
      });
      w.on('error', () => {});
      console.log(`[${stamp()}] Watching ${id} → ${target}`);
    } catch (e) {}
  }

  const componentsSrc = path.join(repoRoot, 'components');
  const componentsDst = path.join(orbiRoot, 'src', 'components');
  if (fs.existsSync(componentsSrc) && fs.statSync(componentsSrc).isDirectory()) {
    ensureDir(componentsDst);
    const componentItems = fs.readdirSync(componentsSrc);
    for (const item of componentItems) {
      if (item === '.git') continue;
      const abs = path.join(componentsSrc, item);
      try { if (!fs.statSync(abs).isDirectory()) continue; } catch (e) { continue; }
      
      const id = resolvePluginId(abs);
      const target = path.join(componentsDst, id);
      
      let fp = '';
      try { fp = fingerprintDir(abs); } catch (e) { fp = ''; }
      try { syncPlugin(abs, target); } catch (e) {}
      lastFinger.set(abs, fp);
      
      try {
        const debounce = { t: 0 };
        const w = fs.watch(abs, { recursive: true }, (eventType, filename) => {
          const now = Date.now();
          if (now - debounce.t < 600) return;
          debounce.t = now;
          let cur = '';
          try { cur = fingerprintDir(abs); } catch (e) { cur = ''; }
          const prev = lastFinger.get(abs) || '';
          if (cur === prev) return;
          try { syncPlugin(abs, target); } catch (e) {}
          lastFinger.set(abs, cur);
          const rel = filename ? String(filename) : '';
          console.log(`[${stamp()}] Synced Component ${id}${rel ? `:${rel}` : ''} → ${target}`);
        });
        w.on('error', () => {});
        console.log(`[${stamp()}] Watching Component ${id} → ${target}`);
      } catch (e) {}
    }
    console.log(`[${stamp()}] Components root (src): ${componentsDst}`);
  }
  console.log(`[${stamp()}] Plugins root (src): ${devRoot}`);
  if (process.argv.includes('--once')) {
    process.exit(0);
  }
  setInterval(() => {}, 1 << 30); // keep alive
}

main();
