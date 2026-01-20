const fs = require('fs');
const path = require('path');
const Registry = require('./Registry');
const Utils = require('./Utils');

function scanPlugins() {
  const pluginsRoot = Registry.pluginsRoot;
  // 从各插件目录读取清单（plugin.json），不再依赖集中式 plugins.json
  Registry.manifest = { plugins: [] };
  try {
    const entries = fs.readdirSync(pluginsRoot);
    for (const entry of entries) {
      const full = path.join(pluginsRoot, entry);
      // 跳过非目录和已知配置文件目录
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
      // 读取 plugin.json 元数据（如有）
      let meta = {};
      const metaPath = path.join(full, 'plugin.json');
      if (fs.existsSync(metaPath)) {
        meta = Utils.readJsonSafe(metaPath, {});
      }
      // 判断是否为组件：允许无 index.js，仅要求 plugin.json 声明 type=component 且存在入口HTML
      const indexPath = path.join(full, 'index.js');
      const isComponent = String(meta?.type || '').toLowerCase() === 'component';
      const entryHtml = meta?.entry || 'index.html';
      const entryPath = path.join(full, entryHtml);
      if (!fs.existsSync(indexPath)) {
        if (!isComponent || !fs.existsSync(entryPath)) continue;
      }
      // 尝试从 package.json 读取版本与作者、依赖
      // 已统一在下方读取 package.json 并解析版本与其它元信息
      const pkgPath = path.join(full, 'package.json');
      let pkg = null;
      if (fs.existsSync(pkgPath)) { try { pkg = Utils.readJsonSafe(pkgPath, {}); } catch (e) {} }
      let detectedVersion = meta.version || (pkg?.version || null);
      // 计算相对路径（用于 local 字段）
      const rel = path.relative(pluginsRoot, full).replace(/\\/g, '/');
      // 填充插件信息（name 来自 meta 或 index.js 导出）
      let name = meta.name;
      if (!name) {
        try {
          const mod = require(indexPath);
          if (mod?.name) name = mod.name;
        } catch (e) {}
      }
      if (!name) name = entry; // 回退到目录名

      // 生成稳定 id：优先 meta.id（清洗为规范），否则根据 name 生成 slug；若 slug 为空则回退到目录名或随机
      const id = Utils.generateStableId(meta.id, name, entry, 'plugin');

      Registry.manifest.plugins.push({
        id,
        name,
        npm: meta.npm || null,
        local: rel,
        enabled: meta.enabled !== undefined ? !!meta.enabled : true,
        icon: meta.icon || null,
        description: meta.description || '',
        author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
        type: String(meta.type || 'plugin'),
        group: meta.group || null,
        entry: isComponent ? (meta.entry || 'index.html') : undefined,
        componentsDir: meta.componentsDir || null,
        // 统一 npmDependencies：仅接收对象（非数组）；dependencies 为数组表示插件依赖
        npmDependencies: (() => {
          if (meta && typeof meta.npmDependencies === 'object' && !Array.isArray(meta.npmDependencies)) return meta.npmDependencies;
          if (meta && typeof meta.dependencies === 'object' && !Array.isArray(meta.dependencies)) return meta.dependencies;
          if (pkg && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) return pkg.dependencies;
          return undefined;
        })(),
        // 兼容新旧清单：优先顶层 actions，其次回退到 functions.actions（旧格式）
        actions: Array.isArray(meta.actions) ? meta.actions : (Array.isArray(meta?.functions?.actions) ? meta.functions.actions : []),
        // 新增：behaviors 与 actions 区分（优先顶层 behaviors）
        behaviors: Array.isArray(meta.behaviors) ? meta.behaviors : [],
        // 保留 functions 以备后续扩展（如声明 backend 名称等）
        functions: typeof meta.functions === 'object' ? meta.functions : undefined,
        packages: Array.isArray(meta.packages) ? meta.packages : undefined,
        version: detectedVersion,
        studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
        // 统一插件依赖为 dependencies（数组），兼容旧字段 pluginDepends
        dependencies: Array.isArray(meta.dependencies) ? meta.dependencies : (Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined),
        // 新增：插件变量声明（数组或对象{name: fnName}）
        variables: (() => {
          try {
            if (Array.isArray(meta.variables)) return meta.variables.map((x) => String(x));
            if (meta && typeof meta.variables === 'object' && meta.variables) return meta.variables;
          } catch (e) {}
          return undefined;
        })(),
        configSchema: (() => {
          try {
            if (Array.isArray(meta.configSchema)) return meta.configSchema;
            if (meta && typeof meta.configSchema === 'object' && meta.configSchema) return meta.configSchema;
            if (Array.isArray(meta.config)) return meta.config;
            if (meta && typeof meta.config === 'object' && meta.config) return meta.config;
          } catch (e) {}
          return undefined;
        })()
      });
      // 建立多路映射：name、原始id（可能含点号）、清洗id、规范id本身
      try {
        if (name) Registry.nameToId.set(String(name), id);
        // if (rawId) Registry.nameToId.set(String(rawId), id); // rawId inside generateStableId scope. Reconstruct logic?
        // generateStableId cleans id.
        // In main.js, rawId was meta.id.
        const rawId = String(meta.id || '').trim();
        const cleanId = rawId.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        const slugFromName = String(name || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');

        if (rawId) Registry.nameToId.set(String(rawId), id);
        if (cleanId) Registry.nameToId.set(String(cleanId), id);
        if (slugFromName) Registry.nameToId.set(String(slugFromName), id);
        Registry.nameToId.set(String(id), id);
        if (Array.isArray(meta.aliases)) {
          meta.aliases.forEach(a => Registry.nameToId.set(String(a), id));
        }
      } catch (e) {}
    }
  } catch (e) {}

  scanComponents(pluginsRoot);
  scanGlobalComponents(pluginsRoot);
}

function scanComponents(pluginsRoot) {
  try {
    const pluginComponents = [];
    for (const p of Registry.manifest.plugins) {
      if (p.type === 'plugin' && p.local) {
        const pDir = path.resolve(pluginsRoot, p.local);
        const compDirName = p.componentsDir || 'components';
        const cRoot = path.join(pDir, compDirName);
        
        if (fs.existsSync(cRoot) && fs.statSync(cRoot).isDirectory()) {
          const entries = fs.readdirSync(cRoot);
          for (const entry of entries) {
            const full = path.join(cRoot, entry);
            if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
            const metaPath = path.join(full, 'plugin.json');
            if (!fs.existsSync(metaPath)) continue;
            const meta = Utils.readJsonSafe(metaPath, {});
            
            // 放宽类型检查：默认为 component
            const type = String(meta.type || 'component').toLowerCase();
            if (type !== 'component') continue;
            
            const entryHtml = meta?.entry || 'index.html';
            const entryPath = path.join(full, entryHtml);
            if (!fs.existsSync(entryPath)) continue;

            const pkgPath = path.join(full, 'package.json');
            let pkg = null;
            if (fs.existsSync(pkgPath)) { try { pkg = Utils.readJsonSafe(pkgPath, {}); } catch (e) {} }
            let detectedVersion = meta.version || (pkg?.version || null);

            const rel = path.join(p.local, compDirName, entry).replace(/\\/g, '/');
            let name = meta.name || entry;
            
            const id = Utils.generateStableId(meta.id, name, entry, 'component');

            pluginComponents.push({
              id,
              name,
              npm: meta.npm || null,
              local: rel,
              enabled: meta.enabled !== undefined ? !!meta.enabled : true,
              icon: meta.icon || null,
              description: meta.description || '',
              author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
              type: 'component',
              group: meta.group || null,
              entry: meta.entry || 'index.html',
              usage: meta.usage || null,
              recommendedSize: meta.recommendedSize || undefined,
              npmDependencies: (() => {
                if (meta && typeof meta.npmDependencies === 'object' && !Array.isArray(meta.npmDependencies)) return meta.npmDependencies;
                if (pkg && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) return pkg.dependencies;
                return undefined;
              })(),
              actions: Array.isArray(meta.actions) ? meta.actions : [],
              behaviors: Array.isArray(meta.behaviors) ? meta.behaviors : [],
              functions: typeof meta.functions === 'object' ? meta.functions : undefined,
              packages: Array.isArray(meta.packages) ? meta.packages : undefined,
              version: detectedVersion,
              studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
              dependencies: Array.isArray(meta.dependencies) ? meta.dependencies : (Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined),
              variables: undefined,
              configSchema: (() => {
                try {
                  if (Array.isArray(meta.configSchema)) return meta.configSchema;
                  if (meta && typeof meta.configSchema === 'object' && meta.configSchema) return meta.configSchema;
                  if (Array.isArray(meta.config)) return meta.config;
                  if (meta && typeof meta.config === 'object' && meta.config) return meta.config;
                } catch (e) {}
                return undefined;
              })(),
              sourcePlugin: { id: p.id, name: p.name }
            });

            try {
              if (name) Registry.nameToId.set(String(name), id);
              Registry.nameToId.set(String(id), id);
            } catch (e) {}
          }
        }
      }
    }
    Registry.manifest.plugins.push(...pluginComponents);
  } catch (e) {
    try { console.error('Error scanning plugin components:', e); } catch (_) {}
  }
}

function scanGlobalComponents(pluginsRoot) {
  // 组件目录：%USER_DATA%/OrbiBoard/components
  try {
    const componentsRoot = path.resolve(pluginsRoot, '..', 'components');
    const entries = fs.existsSync(componentsRoot) ? fs.readdirSync(componentsRoot) : [];
    for (const entry of entries) {
      const full = path.join(componentsRoot, entry);
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) continue;
      const metaPath = path.join(full, 'plugin.json');
      if (!fs.existsSync(metaPath)) continue;
      const meta = Utils.readJsonSafe(metaPath, {});
      const entryHtml = meta?.entry || 'index.html';
      const entryPath = path.join(full, entryHtml);
      if (!fs.existsSync(entryPath)) continue;
      const pkgPath = path.join(full, 'package.json');
      let pkg = null;
      if (fs.existsSync(pkgPath)) { try { pkg = Utils.readJsonSafe(pkgPath, {}); } catch (e) {} }
      let detectedVersion = meta.version || (pkg?.version || null);
      const rel = path.relative(pluginsRoot, full).replace(/\\/g, '/');
      let name = meta.name || entry;
      const id = Utils.generateStableId(meta.id, name, entry, 'component');
      Registry.manifest.plugins.push({
        id,
        name,
        npm: meta.npm || null,
        local: rel,
        enabled: meta.enabled !== undefined ? !!meta.enabled : true,
        icon: meta.icon || null,
        description: meta.description || '',
        author: (meta.author !== undefined ? meta.author : (pkg?.author || null)),
        type: 'component',
        group: meta.group || null,
        entry: meta.entry || 'index.html',
        usage: meta.usage || null,
        recommendedSize: meta.recommendedSize || undefined,
        npmDependencies: (() => {
          if (meta && typeof meta.npmDependencies === 'object' && !Array.isArray(meta.npmDependencies)) return meta.npmDependencies;
          if (pkg && typeof pkg.dependencies === 'object' && !Array.isArray(pkg.dependencies)) return pkg.dependencies;
          return undefined;
        })(),
        actions: Array.isArray(meta.actions) ? meta.actions : [],
        behaviors: Array.isArray(meta.behaviors) ? meta.behaviors : [],
        functions: typeof meta.functions === 'object' ? meta.functions : undefined,
        packages: Array.isArray(meta.packages) ? meta.packages : undefined,
        version: detectedVersion,
        studentColumns: Array.isArray(meta.studentColumns) ? meta.studentColumns : [],
        dependencies: Array.isArray(meta.dependencies) ? meta.dependencies : (Array.isArray(meta.pluginDepends) ? meta.pluginDepends : undefined),
        variables: undefined,
        configSchema: (() => {
          try {
            if (Array.isArray(meta.configSchema)) return meta.configSchema;
            if (meta && typeof meta.configSchema === 'object' && meta.configSchema) return meta.configSchema;
            if (Array.isArray(meta.config)) return meta.config;
            if (meta && typeof meta.config === 'object' && meta.config) return meta.config;
          } catch (e) {}
          return undefined;
        })()
      });
      try {
        if (name) Registry.nameToId.set(String(name), id);
        const rawId = String(meta.id || '').trim();
        const cleanId = rawId.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        const slugFromName = String(name || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
        
        if (rawId) Registry.nameToId.set(String(rawId), id);
        if (cleanId) Registry.nameToId.set(String(cleanId), id);
        if (slugFromName) Registry.nameToId.set(String(slugFromName), id);
        Registry.nameToId.set(String(id), id);
      } catch (e) {}
    }
  } catch (e) {}
}

module.exports = {
  scanPlugins
};
