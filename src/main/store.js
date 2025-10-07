const fs = require('fs');
const path = require('path');

let rootDir = '';
let pluginsDir = '';

function init(app) {
  try {
    rootDir = path.join(app.getPath('userData'), 'LessonPlugin', 'config');
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

module.exports = { init, getAll, get, set, ensureDefaults };