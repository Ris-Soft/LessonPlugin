const fs = require('fs');
const path = require('path');

let rootDir = '';
let pluginsDir = '';

function init(app) {
  try {
    rootDir = path.join(app.getPath('userData'), 'OrbiBoard', 'config');
    pluginsDir = path.join(rootDir, 'plugins');
    fs.mkdirSync(rootDir, { recursive: true });
    fs.mkdirSync(pluginsDir, { recursive: true });
  } catch (e) {
    console.error('Store init error:', e);
  }
}

function scopeFile(scope) {
  if (!rootDir) throw new Error('Store not initialized');
  return scope === 'system'
    ? path.join(rootDir, 'system.json')
    : path.join(pluginsDir, `${scope}.json`);
}

function readJSON(file) {
  try {
    if (!fs.existsSync(file)) return {};
    const raw = fs.readFileSync(file, 'utf-8');
    return JSON.parse(raw || '{}');
  } catch (e) {
    return {};
  }
}

function writeJSON(file, data) {
  try {
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (e) {
    console.error('Store write error:', e);
    return false;
  }
}

function getAll(scope) {
  return readJSON(scopeFile(scope));
}

function get(scope, key) {
  const all = getAll(scope);
  return all[key];
}

function set(scope, key, value) {
  const file = scopeFile(scope);
  const data = readJSON(file);
  data[key] = value;
  writeJSON(file, data);
  return data;
}

function ensureDefaults(scope, defaults) {
  const file = scopeFile(scope);
  const data = readJSON(file);
  let changed = false;
  Object.keys(defaults || {}).forEach((k) => {
    if (!(k in data)) {
      data[k] = defaults[k];
      changed = true;
    }
  });
  if (changed) writeJSON(file, data);
  return data;
}

function setAll(scope, obj) {
  const file = scopeFile(scope);
  const data = Object(obj || {});
  return writeJSON(file, data);
}

function deleteScope(scope) {
  try {
    const file = scopeFile(scope);
    if (fs.existsSync(file)) fs.unlinkSync(file);
    return true;
  } catch { return false; }
}

function listPluginScopes() {
  try {
    if (!pluginsDir) return [];
    if (!fs.existsSync(pluginsDir)) return [];
    const names = fs.readdirSync(pluginsDir).filter((n) => {
      const fp = path.join(pluginsDir, n);
      try { return fs.statSync(fp).isFile() && n.toLowerCase().endsWith('.json'); } catch { return false; }
    }).map((n) => n.replace(/\.json$/i, ''));
    return names;
  } catch { return []; }
}

module.exports = { init, getAll, get, set, ensureDefaults, listPluginScopes, setAll, deleteScope };
