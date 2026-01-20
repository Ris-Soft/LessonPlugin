const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const store = require('../Manager/Store/Main');

function syncPluginsAndComponents() {
  const userRoot = path.join(app.getPath('userData'), 'OrbiBoard');
  const userPluginsRoot = path.join(userRoot, 'plugins');
  const userComponentsRoot = path.join(userRoot, 'components');
  const userRendererRoot = path.join(userRoot, 'renderer');
  
  let shippedPluginsRoot = path.join(app.getAppPath(), 'src', 'plugins');
  let shippedComponentsRoot = path.join(app.getAppPath(), 'src', 'components');

  // 优先检查工作区目录（开发环境/外部挂载），如果存在则覆盖默认的 src 目录
  const workspacePlugins = path.resolve(app.getAppPath(), '..', 'Plugins');
  if (fs.existsSync(workspacePlugins)) {
    shippedPluginsRoot = workspacePlugins;
  }

  const workspaceComponents = path.resolve(app.getAppPath(), '..', 'Components');
  if (fs.existsSync(workspaceComponents)) {
    shippedComponentsRoot = workspaceComponents;
  }
  const shippedRendererRoot = path.join(app.getAppPath(), 'src', 'renderer');

  try { fs.mkdirSync(userPluginsRoot, { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(userComponentsRoot, { recursive: true }); } catch (e) {}
  try { fs.mkdirSync(userRendererRoot, { recursive: true }); } catch (e) {}

  // Force sync shipped plugins to user directory (development or repair)
  try {
    const shouldForceSync = store.get('system', 'debugSyncPlugins') === true;
    if (shouldForceSync) {
      if (fs.existsSync(shippedPluginsRoot)) {
        const shippedEntries = fs.readdirSync(shippedPluginsRoot).filter((n) => {
          const p = path.join(shippedPluginsRoot, n);
          return fs.existsSync(p) && fs.statSync(p).isDirectory();
        });
        for (const entry of shippedEntries) {
          try {
            const src = path.join(shippedPluginsRoot, entry);
            const dest = path.join(userPluginsRoot, entry);
            
            // Sync with node_modules preservation
            if (fs.existsSync(dest)) {
               const nodeModulesSrc = path.join(dest, 'node_modules');
               const nodeModulesTmp = path.join(userPluginsRoot, `.${entry}_nm_tmp`);
               let hasModules = false;
               if (fs.existsSync(nodeModulesSrc)) {
                 try { fs.renameSync(nodeModulesSrc, nodeModulesTmp); hasModules = true; } catch (e) {}
               }
               
               // Clear destination except temp
               try { fs.rmSync(dest, { recursive: true, force: true }); } catch (e) {}
               
               // Copy new files
               copyRecursive(src, dest);
               
               // Restore node_modules
               if (hasModules) {
                 try { 
                    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
                    const targetNm = path.join(dest, 'node_modules');
                    if (fs.existsSync(targetNm)) fs.rmSync(targetNm, { recursive: true, force: true });
                    fs.renameSync(nodeModulesTmp, targetNm); 
                 } catch (e) {
                    // fallback clean
                    try { fs.rmSync(nodeModulesTmp, { recursive: true, force: true }); } catch (e) {}
                 }
               }
            } else {
               copyRecursive(src, dest);
            }
          } catch (e) {
            console.error(`[Startup] Failed to sync plugin ${entry}:`, e);
          }
        }
      }

      if (fs.existsSync(shippedComponentsRoot)) {
        const shippedCompEntries = fs.readdirSync(shippedComponentsRoot).filter((n) => {
          const p = path.join(shippedComponentsRoot, n);
          return fs.existsSync(p) && fs.statSync(p).isDirectory();
        });
        for (const entry of shippedCompEntries) {
          try {
            const src = path.join(shippedComponentsRoot, entry);
            const dest = path.join(userComponentsRoot, entry);
            try { if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true }); } catch (e) {}
            copyRecursive(src, dest);
          } catch (e) {
            console.error(`[Startup] Failed to sync component ${entry}:`, e);
          }
        }
      }

      const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
      const userCfg = path.join(userPluginsRoot, 'config.json');
      // Only copy config if user config missing to avoid overwriting preferences
      // Or maybe merge? For now let's safe guard it.
      if (!fs.existsSync(userCfg) && fs.existsSync(shippedCfg)) {
        try { fs.copyFileSync(shippedCfg, userCfg); } catch (e) {}
      }
    }
  } catch (e) {}

  // Initial seeding if user plugins empty (fallback)
  try {
    const entries = fs.existsSync(userPluginsRoot) ? fs.readdirSync(userPluginsRoot).filter((n) => {
      const p = path.join(userPluginsRoot, n);
      return fs.existsSync(p) && fs.statSync(p).isDirectory();
    }) : [];
    
    if (entries.length === 0) {
      if (fs.existsSync(shippedPluginsRoot)) {
        const shippedEntries = fs.readdirSync(shippedPluginsRoot);
        for (const entry of shippedEntries) {
          const src = path.join(shippedPluginsRoot, entry);
          const dest = path.join(userPluginsRoot, entry);
          if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
          copyRecursive(src, dest);
        }
      }

      if (fs.existsSync(shippedComponentsRoot)) {
        const shippedCompEntries = fs.readdirSync(shippedComponentsRoot);
        for (const entry of shippedCompEntries) {
          const src = path.join(shippedComponentsRoot, entry);
          const dest = path.join(userComponentsRoot, entry);
          if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) continue;
          copyRecursive(src, dest);
        }
      }
      
      const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
      const userCfg = path.join(userPluginsRoot, 'config.json');
      try { if (fs.existsSync(shippedCfg)) fs.copyFileSync(shippedCfg, userCfg); } catch (e) {}
    }

    // Incremental copy
    if (fs.existsSync(shippedPluginsRoot)) {
      const shippedEntries = fs.readdirSync(shippedPluginsRoot).filter((n) => {
        const p = path.join(shippedPluginsRoot, n);
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      });
      for (const entry of shippedEntries) {
        const dest = path.join(userPluginsRoot, entry);
        const src = path.join(shippedPluginsRoot, entry);
        if (!fs.existsSync(dest)) {
          copyRecursive(src, dest);
        }
      }
    }
    
    if (fs.existsSync(shippedComponentsRoot)) {
      const shippedCompEntries = fs.readdirSync(shippedComponentsRoot).filter((n) => {
        const p = path.join(shippedComponentsRoot, n);
        return fs.existsSync(p) && fs.statSync(p).isDirectory();
      });
      for (const entry of shippedCompEntries) {
        const dest = path.join(userComponentsRoot, entry);
        const src = path.join(shippedComponentsRoot, entry);
        if (!fs.existsSync(dest)) {
          copyRecursive(src, dest);
        }
      }
    }

    const shippedCfg = path.join(shippedPluginsRoot, 'config.json');
    const userCfg = path.join(userPluginsRoot, 'config.json');
    if (!fs.existsSync(userCfg) && fs.existsSync(shippedCfg)) {
      try { fs.copyFileSync(shippedCfg, userCfg); } catch (e) {}
    }
  } catch (e) {}

  // Mirror renderer assets
  try {
    mirror(shippedRendererRoot, userRendererRoot);
  } catch (e) {}

  // Ensure manifest and config exist
  const manifestPath = path.join(userPluginsRoot, 'plugins.json');
  const configPath = path.join(userPluginsRoot, 'config.json');
  try { if (!fs.existsSync(userPluginsRoot)) fs.mkdirSync(userPluginsRoot, { recursive: true }); } catch (e) {}
  try { if (!fs.existsSync(configPath)) fs.writeFileSync(configPath, JSON.stringify({ enabled: {}, registry: 'https://registry.npmmirror.com', npmSelection: {} }, null, 2), 'utf-8'); } catch (e) {}
  try { if (!fs.existsSync(manifestPath)) fs.writeFileSync(manifestPath, JSON.stringify({ plugins: [] }, null, 2), 'utf-8'); } catch (e) {}

  return { manifestPath, configPath };
}

function copyRecursive(src, dest) {
  if (!fs.existsSync(src)) return;
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  const stack = [{ s: src, d: dest }];
  while (stack.length) {
    const { s, d } = stack.pop();
    const items = fs.readdirSync(s);
    for (const it of items) {
      if (it === 'node_modules' || it === '.git') continue;
      const sp = path.join(s, it);
      const dp = path.join(d, it);
      const stat = fs.statSync(sp);
      if (stat.isDirectory()) {
        if (!fs.existsSync(dp)) fs.mkdirSync(dp, { recursive: true });
        stack.push({ s: sp, d: dp });
      } else {
        try { fs.copyFileSync(sp, dp); } catch (e) {}
      }
    }
  }
}

function mirror(src, dst) {
  try { fs.mkdirSync(dst, { recursive: true }); } catch (e) {}
  const stack = [{ s: src, d: dst }];
  while (stack.length) {
    const { s, d } = stack.pop();
    if (!fs.existsSync(s)) continue;
    const items = fs.readdirSync(s);
    for (const it of items) {
      const sp = path.join(s, it);
      const dp = path.join(d, it);
      const st = fs.statSync(sp);
      if (st.isDirectory()) { try { fs.mkdirSync(dp, { recursive: true }); } catch (e) {} stack.push({ s: sp, d: dp }); }
      else { try { fs.copyFileSync(sp, dp); } catch (e) {} }
    }
  }
}

module.exports = {
  syncPluginsAndComponents
};
