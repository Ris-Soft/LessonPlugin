const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');

const app = express();
const PORT = process.env.PORT || 3030;

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'market.json');
const FALLBACK_FILE = path.join(__dirname, '..', '..', 'src', 'plugins', 'config.json');

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(morgan('dev'));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/data', express.static(DATA_DIR));

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function readMarketData() {
  if (fs.existsSync(DATA_FILE)) {
    const data = readJson(DATA_FILE);
    if (data) return data;
  }
  if (fs.existsSync(FALLBACK_FILE)) {
    const data = readJson(FALLBACK_FILE);
    if (data) return data;
  }
  return { items: [] };
}

// 新增：统一分类映射与插件/自动化目录
const PLUGINS_DIR = path.join(DATA_DIR, 'plugins');
const AUTOMATIONS_DIR = path.join(DATA_DIR, 'automation');
const CATEGORIES_MAP_FILE = path.join(DATA_DIR, 'categories.json');

function readCategoriesMap() {
  if (fs.existsSync(CATEGORIES_MAP_FILE)) {
    const map = readJson(CATEGORIES_MAP_FILE);
    if (map && typeof map === 'object') return map;
  }
  return null;
}
function categoriesMapToArrays(map) {
  const types = ['plugins', 'automation', 'components'];
  const result = {};
  for (const t of types) {
    const defs = map && typeof map[t] === 'object' ? map[t] : {};
    const arr = Object.keys(defs).map((id) => ({ id, label: defs[id]?.label || id, icon: defs[id]?.icon }))
      .sort((a, b) => String(a.id).localeCompare(String(b.id)));
    // 确保包含“全部”
    if (!arr.find((x) => x.id === 'all')) arr.unshift({ id: 'all', label: '全部', icon: 'ri-apps-2-line' });
    result[t] = arr;
  }
  return result;
}

// 原有 mock 根路径（作为回退）
const MOCK_ROOT = path.join(__dirname, '..', '..', 'src', 'renderer', 'mock', 'market');

function readCategories() {
  // 优先：统一 categories.json
  const map = readCategoriesMap();
  if (map) return categoriesMapToArrays(map);
  // 回退：旧的分文件结构
  const types = ['plugins', 'automation', 'components'];
  const result = {};
  for (const t of types) {
    const localPath = path.join(DATA_DIR, 'categories', `${t}.json`);
    const fallbackPath = path.join(MOCK_ROOT, 'categories', `${t}.json`);
    let data = null;
    if (fs.existsSync(localPath)) data = readJson(localPath);
    else if (fs.existsSync(fallbackPath)) data = readJson(fallbackPath);
    result[t] = Array.isArray(data) ? data : [];
  }
  return result;
}

function normalizeType(val) {
  const v = String(val || '').toLowerCase();
  if (v === 'plugin' || v === 'plugins') return 'plugins';
  if (v === 'automation' || v === 'auto') return 'automation';
  if (v === 'component' || v === 'components' || v === 'ui') return 'components';
  return 'plugins';
}

function readCatalogFromDirs() {
  const result = { plugins: [], automation: [], components: [] };
  // 1) 扫描 plugins 目录：收集 plugin/component；兼容残留的 automation
  if (fs.existsSync(PLUGINS_DIR)) {
    const dirs = fs.readdirSync(PLUGINS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dirs) {
      const id = d.name;
      const pluginJsonPath = path.join(PLUGINS_DIR, id, 'plugin.json');
      if (!fs.existsSync(pluginJsonPath)) continue;
      const info = readJson(pluginJsonPath);
      if (!info || typeof info !== 'object') continue;
      const type = normalizeType(info.type);
      const categories = Array.isArray(info.categories)
        ? info.categories.map((x) => String(x).trim()).filter(Boolean)
        : String(info.categories || '').split(',').map((x) => x.trim()).filter(Boolean);
      const readmeCandidates = ['README.md', 'readme.md', 'README', 'readme'];
      let readmePath;
      for (const name of readmeCandidates) {
        const f = path.join(PLUGINS_DIR, id, name);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) { readmePath = `/data/plugins/${id}/${name}`; break; }
      }
      const singularType = (type === 'plugins') ? 'plugin' : (type === 'components' ? 'component' : 'automation');
      const item = {
        id: info.id || id,
        type: singularType,
        name: info.name || id,
        version: info.version || '',
        description: info.description || '',
        author: info.author || '',
        icon: info.icon || 'ri-puzzle-line',
        categories,
        readme: readmePath,
        dependencies: (info.dependencies && typeof info.dependencies === 'object') ? info.dependencies : undefined,
        zip: fs.existsSync(path.join(PLUGINS_DIR, id, 'plugin.zip')) ? `/data/plugins/${id}/plugin.zip` : undefined
      };
      // 不再从 plugins 目录产出 automation 类型
      if (singularType === 'plugin') result.plugins.push(item);
      else if (singularType === 'component') result.components.push(item);
    }
  }
  // 2) 扫描 automation 目录：仅收集 automation 类型
  if (fs.existsSync(AUTOMATIONS_DIR)) {
    const dirs = fs.readdirSync(AUTOMATIONS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
    for (const d of dirs) {
      const id = d.name;
      // 优先使用 automation.json 作为元信息；兼容 plugin.json（type=automation）
      const automationJsonPath = path.join(AUTOMATIONS_DIR, id, 'automation.json');
      const pluginJsonPath = path.join(AUTOMATIONS_DIR, id, 'plugin.json');
      let info = null;
      if (fs.existsSync(automationJsonPath)) info = readJson(automationJsonPath);
      else if (fs.existsSync(pluginJsonPath)) info = readJson(pluginJsonPath);
      if (!info || typeof info !== 'object') continue;
      const categories = Array.isArray(info.categories)
        ? info.categories.map((x) => String(x).trim()).filter(Boolean)
        : String(info.categories || '').split(',').map((x) => x.trim()).filter(Boolean);
      const readmeCandidates = ['README.md', 'readme.md', 'README', 'readme'];
      let readmePath;
      for (const name of readmeCandidates) {
        const f = path.join(AUTOMATIONS_DIR, id, name);
        if (fs.existsSync(f) && fs.statSync(f).isFile()) { readmePath = `/data/automation/${id}/${name}`; break; }
      }
      const item = {
        id: info.id || id,
        type: 'automation',
        name: info.name || id,
        version: info.version || '',
        description: info.description || '',
        author: info.author || '',
        icon: info.icon || 'ri-timer-line',
        categories,
        readme: readmePath,
        dependencies: (info.dependencies && typeof info.dependencies === 'object') ? info.dependencies : undefined,
        zip: fs.existsSync(path.join(AUTOMATIONS_DIR, id, 'automation.zip')) ? `/data/automation/${id}/automation.zip` : undefined,
        automation: fs.existsSync(automationJsonPath) ? `/data/automation/${id}/automation.json` : undefined
      };
      result.automation.push(item);
    }
  }
  return result;
}

function readCatalog() {
  // 优先：按目录扫描插件与自动化（分目录）
  const catalog = readCatalogFromDirs();
  const total = catalog.plugins.length + catalog.automation.length + catalog.components.length;
  if (total > 0) return catalog;
  // 回退：旧的分文件结构
  const types = ['plugins', 'automation', 'components'];
  const result = { plugins: [], automation: [], components: [] };
  for (const t of types) {
    const localPath = path.join(DATA_DIR, 'catalog', `${t}.json`);
    const fallbackPath = path.join(MOCK_ROOT, 'catalog', `${t}.json`);
    let data = null;
    if (fs.existsSync(localPath)) data = readJson(localPath);
    else if (fs.existsSync(fallbackPath)) data = readJson(fallbackPath);
    result[t] = Array.isArray(data) ? data : [];
  }
  return result;
}

// 健康检查
app.get('/api/ping', (req, res) => { res.json({ ok: true }); });
app.get('/api/market/ping', (req, res) => { res.json({ ok: true }); });

// 现有市场 JSON（向后兼容）
app.get('/api/market', (req, res) => {
  const data = readMarketData();
  res.json(data);
});

app.put('/api/market', (req, res) => {
  const payload = req.body;
  if (payload == null || typeof payload !== 'object') {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }
  try {
    ensureDataDir();
    fs.writeFileSync(DATA_FILE, JSON.stringify(payload, null, 2), 'utf-8');
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'Failed to persist data', detail: String(e) });
  }
});

// 新增：功能市场分类与目录端点（置于动态 :id 之前，避免冲突）
app.get('/api/market/categories', (req, res) => {
  res.json(readCategories());
});
app.get('/api/market/categories/:type', (req, res) => {
  const type = String(req.params.type);
  const cats = readCategories();
  if (!cats[type]) return res.status(404).json({ error: 'Not found' });
  res.json(cats[type]);
});
app.get('/api/market/catalog', (req, res) => {
  res.json(readCatalog());
});
app.get('/api/market/catalog/:type', (req, res) => {
  const type = String(req.params.type);
  const cat = readCatalog();
  if (!cat[type]) return res.status(404).json({ error: 'Not found' });
  res.json(cat[type]);
});

// 放到最后：按 id 获取单个市场条目
app.get('/api/market/:id', (req, res) => {
  const id = String(req.params.id);
  const data = readMarketData();
  const list = Array.isArray(data.items) ? data.items : (Array.isArray(data.plugins) ? data.plugins : []);
  const found = list.find((x) => String(x.id) === id);
  if (!found) {
    return res.status(404).json({ error: 'Not found' });
  }
  res.json(found);
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`Market server running at ${url}`);
});