const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const https = require('https');
const querystring = require('querystring');

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
const RENDERER_DIR = path.join(__dirname, '..', '..', 'src', 'renderer');
app.get('/assets/remixicon.css', (req, res) => { res.sendFile(path.join(RENDERER_DIR, 'remixicon-local.css')); });
app.get('/assets/remixicon.woff2', (req, res) => { res.sendFile(path.join(RENDERER_DIR, 'remixicon.woff2')); });
app.get('/assets/settings.css', (req, res) => { res.sendFile(path.join(RENDERER_DIR, 'settings.css')); });

const CASDOOR_SERVER_URL = process.env.CASDOOR_SERVER_URL || '';
const CASDOOR_CLIENT_ID = process.env.CASDOOR_CLIENT_ID || '';
const CASDOOR_CLIENT_SECRET = process.env.CASDOOR_CLIENT_SECRET || '';
const CASDOOR_REDIRECT_URI = process.env.CASDOOR_REDIRECT_URI || `http://localhost:${PORT}/auth/callback`;
const MARKET_DEBUG_AUTH = String(process.env.MARKET_DEBUG_AUTH || '').toLowerCase() === 'true';

const sessions = new Map();
function parseCookies(req) {
  const header = req.headers.cookie || '';
  const pairs = header.split(';').map((x) => x.trim()).filter(Boolean);
  const out = {};
  for (const p of pairs) {
    const idx = p.indexOf('=');
    if (idx > 0) out[p.slice(0, idx)] = decodeURIComponent(p.slice(idx + 1));
  }
  return out;
}
function setCookie(res, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge != null) parts.push(`Max-Age=${options.maxAge}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.path) parts.push(`Path=${options.path}`); else parts.push('Path=/');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function getSession(req) {
  const sid = parseCookies(req).sid;
  if (!sid) return null;
  return sessions.get(sid) || null;
}
function setSession(res, user) {
  const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  sessions.set(sid, { user, created: Date.now() });
  setCookie(res, 'sid', sid, { httpOnly: true });
}
function clearSession(req, res) {
  const sid = parseCookies(req).sid;
  if (sid) sessions.delete(sid);
  setCookie(res, 'sid', '', { httpOnly: true, maxAge: 0 });
}
function httpsPostForm(urlString, form, basicAuth) {
  return new Promise((resolve, reject) => {
    const payload = querystring.stringify(form);
    const u = new URL(urlString);
    const opts = {
      method: 'POST',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(payload)
      }
    };
    if (basicAuth) opts.headers.Authorization = `Basic ${basicAuth}`;
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}
function httpsGetJson(urlString, bearer) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlString);
    const opts = {
      method: 'GET',
      hostname: u.hostname,
      path: u.pathname + (u.search || ''),
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      headers: {}
    };
    if (bearer) opts.headers.Authorization = `Bearer ${bearer}`;
    const req = https.request(opts, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf-8');
        try { resolve(JSON.parse(body)); } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

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
      const depsRaw = info.dependencies;
      const dependencies = (() => {
        try {
          if (Array.isArray(depsRaw)) return depsRaw;
          if (depsRaw && typeof depsRaw === 'object') {
            return Object.keys(depsRaw).map((k) => `${k}@${depsRaw[k]}`);
          }
          return undefined;
        } catch { return undefined; }
      })();
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
        // 统一输出 dependencies 为字符串数组（name@range），便于前端直接展示
        dependencies,
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
app.get('/logo.ico', (req, res) => {
  const p = path.join(__dirname, '..', '..', 'icon.ico');
  if (fs.existsSync(p)) return res.sendFile(p);
  res.status(404).end();
});

app.get('/api/auth/me', (req, res) => {
  const s = getSession(req);
  if (s && s.user) return res.json({ loggedIn: true, user: s.user });
  res.json({ loggedIn: false, anonymous: true });
});

app.get('/auth/login', (req, res) => {
  const ret = String(req.query.return || '/');
  if (!CASDOOR_SERVER_URL || !CASDOOR_CLIENT_ID) {
    return res.redirect(ret);
  }
  const state = Math.random().toString(36).slice(2);
  const u = new URL(CASDOOR_SERVER_URL.replace(/\/$/, '') + '/login/oauth/authorize');
  u.searchParams.set('client_id', CASDOOR_CLIENT_ID);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('redirect_uri', CASDOOR_REDIRECT_URI);
  u.searchParams.set('scope', 'openid profile email');
  u.searchParams.set('state', state);
  res.redirect(u.toString());
});

app.get('/auth/callback', async (req, res) => {
  const code = String(req.query.code || '');
  const ret = String(req.query.state || '/');
  if (!code) return res.redirect('/');
  try {
    const basic = Buffer.from(`${CASDOOR_CLIENT_ID}:${CASDOOR_CLIENT_SECRET}`).toString('base64');
    const token = await httpsPostForm(
      CASDOOR_SERVER_URL.replace(/\/$/, '') + '/api/login/oauth/access_token',
      { code, grant_type: 'authorization_code', redirect_uri: CASDOOR_REDIRECT_URI },
      basic
    );
    const accessToken = token && (token.access_token || token.accessToken);
    if (!accessToken) return res.redirect('/');
    const user = await httpsGetJson(CASDOOR_SERVER_URL.replace(/\/$/, '') + '/api/userinfo', accessToken);
    if (user) setSession(res, { id: user.sub || user.name || user.id, name: user.name || '', email: user.email || '', from: 'casdoor' });
    res.redirect('/');
  } catch (e) {
    res.redirect('/');
  }
});

app.post('/auth/logout', (req, res) => {
  clearSession(req, res);
  res.json({ ok: true });
});

app.post('/auth/debug', (req, res) => {
  if (!MARKET_DEBUG_AUTH) return res.status(403).json({ error: 'disabled' });
  setSession(res, { id: 'debug', name: 'Debug User', email: '', from: 'debug' });
  res.json({ ok: true });
});

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

app.post('/api/dev/publish', (req, res) => {
  const s = getSession(req);
  if (!MARKET_DEBUG_AUTH && !(s && s.user)) {
    return res.status(401).json({ error: 'unauthorized' });
  }
  const payload = req.body;
  if (!payload || typeof payload !== 'object') return res.status(400).json({ error: 'invalid' });
  const typeRaw = String(payload.type || '').toLowerCase();
  const type = typeRaw === 'automation' ? 'automation' : (typeRaw === 'component' || typeRaw === 'components' ? 'components' : 'plugins');
  const id = String(payload.id || '').trim();
  if (!id) return res.status(400).json({ error: 'id required' });
  ensureDataDir();
  try {
    if (type === 'automation') {
      const dir = path.join(AUTOMATIONS_DIR, id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const meta = {
        id,
        name: payload.name || id,
        type: 'automation',
        version: payload.version || '',
        description: payload.description || '',
        author: payload.author || (s && s.user && s.user.name) || '',
        icon: payload.icon || '',
        categories: Array.isArray(payload.categories) ? payload.categories : String(payload.categories || '').split(',').map((x) => x.trim()).filter(Boolean)
      };
      fs.writeFileSync(path.join(dir, 'automation.json'), JSON.stringify(meta, null, 2), 'utf-8');
    } else if (type === 'components') {
      const dir = path.join(PLUGINS_DIR, id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const meta = {
        id,
        name: payload.name || id,
        type: 'component',
        version: payload.version || '',
        description: payload.description || '',
        author: payload.author || (s && s.user && s.user.name) || '',
        icon: payload.icon || '',
        categories: Array.isArray(payload.categories) ? payload.categories : String(payload.categories || '').split(',').map((x) => x.trim()).filter(Boolean)
      };
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(meta, null, 2), 'utf-8');
    } else {
      const dir = path.join(PLUGINS_DIR, id);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const meta = {
        id,
        name: payload.name || id,
        type: 'plugin',
        version: payload.version || '',
        description: payload.description || '',
        author: payload.author || (s && s.user && s.user.name) || '',
        icon: payload.icon || '',
        dependencies: payload.dependencies,
        categories: Array.isArray(payload.categories) ? payload.categories : String(payload.categories || '').split(',').map((x) => x.trim()).filter(Boolean)
      };
      fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(meta, null, 2), 'utf-8');
    }
    return res.json({ ok: true });
  } catch (e) {
    return res.status(500).json({ error: 'persist failed' });
  }
});

app.listen(PORT, () => {
  const url = `http://localhost:${PORT}/`;
  console.log(`LessonPlugin 官网运行于 ${url}`);
});
