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
    logDir = path.join(userRoot, 'LessonPlugin', 'logs');
    logFile = path.join(logDir, 'backend.log');
    fs.mkdirSync(logDir, { recursive: true });
    enabled = !!options.enabled;
    if (enabled) startCapture();
  } catch {}
}

function formatLine(level, args) {
  const ts = new Date().toISOString();
  try {
    const msg = args.map(a => {
      if (typeof a === 'string') return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    }).join(' ');
    return `${ts} [${level}] ${msg}`;
  } catch { return `${ts} [${level}] ${args?.join(' ')}`; }
}

function append(level, args) {
  if (!enabled) return;
  const line = formatLine(level, args);
  buffer.push(line);
  if (buffer.length > maxBuffer) buffer = buffer.slice(buffer.length - maxBuffer);
  try { fs.appendFileSync(logFile, line + '\n', 'utf-8'); } catch {}
  for (const wc of Array.from(subscribers)) {
    try { wc.send('backend:log', line); } catch {}
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
  console.log = (...args) => { try { originalConsole.log(...args); } catch {}; append('log', args); };
  console.info = (...args) => { try { originalConsole.info(...args); } catch {}; append('info', args); };
  console.warn = (...args) => { try { originalConsole.warn(...args); } catch {}; append('warn', args); };
  console.error = (...args) => { try { originalConsole.error(...args); } catch {}; append('error', args); };
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
    // prioritize buffer; if file exists but buffer is empty (first run), read tail of file
    if (buffer.length) return buffer.slice(Math.max(0, buffer.length - n));
    if (fs.existsSync(logFile)) {
      const text = fs.readFileSync(logFile, 'utf-8');
      const lines = text.split(/\r?\n/).filter(Boolean);
      return lines.slice(Math.max(0, lines.length - n));
    }
  } catch {}
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
  subscribe
};