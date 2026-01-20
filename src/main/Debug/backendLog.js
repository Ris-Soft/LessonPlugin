const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let enabled = false;
let logDir = '';
let logFile = '';
let buffer = [];
const maxBuffer = 1000; // ring buffer size to avoid memory blowup
const subscribers = new Set(); // webContents subscribers for live updates
let originalConsole = null;

function init(options = {}) {
  try {
    const userRoot = app.getPath('userData');
    logDir = path.join(userRoot, 'OrbiBoard', 'logs');
    logFile = path.join(logDir, 'backend.log');
    fs.mkdirSync(logDir, { recursive: true });
    enabled = !!options.enabled;
    if (enabled) startCapture();
  } catch (e) {}
}

function formatLine(level, args) {
  const ts = new Date().toISOString();
  try {
    const msg = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch (e) { return String(a); }
    }).join(' ');
    return `${ts} [${level}] ${msg}`;
  } catch (e) { return `${ts} [${level}] ${args?.join(' ')}`; }
}

function detectOrigin() {
  try {
    const err = new Error();
    const stack = String(err.stack || '');
    const lines = stack.split(/\r?\n/).slice(1);
    for (const line of lines) {
      const m = line.match(/\((.*?):\d+:\d+\)|at\s+(?:.*?\s+)?(.*?):\d+:\d+/);
      const file = m ? (m[1] || m[2]) : null;
      if (!file) continue;
      if (file.includes(path.sep + 'backendLog.js')) continue;
      const norm = file.replace(/\\/g, '/');
      const idx = norm.lastIndexOf('/plugins/');
      if (idx >= 0) {
        const rest = norm.slice(idx + '/plugins/'.length);
        const seg = rest.split('/')[0];
        const pid = seg || '';
        return { sourceType: 'plugin', sourceId: pid, module: pid };
      }
      const base = path.basename(file);
      const name = base.replace(/\.(js|ts|mjs|cjs)$/i, '');
      return { sourceType: 'system', sourceId: name, module: name };
    }
  } catch (e) {}
  return { sourceType: 'system', sourceId: 'unknown', module: 'unknown' };
}

function append(level, args) {
  if (!enabled) return;
  const line = formatLine(level, args);
  const origin = detectOrigin();
  const entry = {
    ts: new Date().toISOString(),
    level,
    text: (() => {
      try {
        return args.map(a => {
          if (typeof a === 'string') return a;
          try { return JSON.stringify(a); } catch (e) { return String(a); }
        }).join(' ');
      } catch (e) { return String(args?.join(' ') || ''); }
    })(),
    sourceType: origin.sourceType,
    sourceId: origin.sourceId,
    module: origin.module
  };
  buffer.push(entry);
  if (buffer.length > maxBuffer) buffer = buffer.slice(buffer.length - maxBuffer);
  try { fs.appendFileSync(logFile, line + '\n', 'utf-8'); } catch (e) {}
  for (const wc of Array.from(subscribers)) {
    try { wc.send('backend:log', line); } catch (e) {}
    try { wc.send('backend:log:entry', entry); } catch (e) {}
  }
}

function startCapture() {
  if (originalConsole) return; // already captured
  originalConsole = {
    log: console.log,
    info: console.info,
    warn: console.warn,
    error: console.error
  };
  console.log = (...args) => { try { originalConsole.log(...args); } catch (e) {}; append('log', args); };
  console.info = (...args) => { try { originalConsole.info(...args); } catch (e) {}; append('info', args); };
  console.warn = (...args) => { try { originalConsole.warn(...args); } catch (e) {}; append('warn', args); };
  console.error = (...args) => { try { originalConsole.error(...args); } catch (e) {}; append('error', args); };
}

function stopCapture() {
  if (!originalConsole) return;
  console.log = originalConsole.log;
  console.info = originalConsole.info;
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
  originalConsole = null;
}

function enableLogging(on) {
  enabled = !!on;
  if (enabled) startCapture(); else stopCapture();
}

function getLast(n = 20) {
  try {
    if (buffer.length) return buffer.slice(Math.max(0, buffer.length - n)).map(e => `${e.ts} [${e.level}] ${e.text}`);
    if (fs.existsSync(logFile)) {
      const text = fs.readFileSync(logFile, 'utf-8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      return lines.slice(Math.max(0, lines.length - n));
    }
  } catch (e) {}
  return [];
}

function getLastEntries(n = 200) {
  try {
    if (buffer.length) return buffer.slice(Math.max(0, buffer.length - n));
  } catch (e) {}
  return [];
}

function subscribe(webContents) {
  if (!webContents) return;
  subscribers.add(webContents);
  webContents.once('destroyed', () => { subscribers.delete(webContents); });
}

module.exports = {
  init,
  enableLogging,
  getLast,
  getLastEntries,
  subscribe,
  write: (level, ...args) => { try { append(String(level || 'info'), args); } catch (e) {} }
};
