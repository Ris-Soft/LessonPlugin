const fs = require('fs');
const vm = require('vm');

function createIpcStub() {
  const listeners = new Map();
  return {
    on(channel, fn) {
      const arr = listeners.get(channel) || [];
      arr.push(fn);
      listeners.set(channel, arr);
    },
    removeListener(channel, fn) {
      const arr = listeners.get(channel) || [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
      listeners.set(channel, arr);
    },
    send(channel, ...args) {
      const arr = listeners.get(channel) || [];
      arr.forEach((fn) => {
        try { fn({}, ...args); } catch {}
      });
    },
    invoke() { return Promise.resolve({ ok: true }); }
  };
}

const code = fs.readFileSync(require('path').join(__dirname, '..', 'src', 'preload', 'settings.js'), 'utf8');

const sandbox = {
  console,
  require,
  module: {},
  electron: {},
  contextBridge: {
    exposeInMainWorld(key, value) {
      sandbox[key] = value;
    }
  },
  ipcRenderer: createIpcStub(),
};

const wrapped = code.replace(
  /const \{ contextBridge, ipcRenderer \} = require\('electron'\);/,
  ''
);

vm.createContext(sandbox);
vm.runInContext(wrapped, sandbox, { filename: 'settings.js' });

const api = sandbox.settingsAPI;

let count = 0;
function handler(payload) { if (payload && payload.x === 1) count++; }

const unsubscribe = api.onProgress(handler);
sandbox.ipcRenderer.send('plugin-progress', { x: 1 });
const afterFirst = count;
sandbox.ipcRenderer.send('plugin-progress', { x: 1 });
const afterSecond = count;
unsubscribe && unsubscribe();
sandbox.ipcRenderer.send('plugin-progress', { x: 1 });
const afterThird = count;

console.log(JSON.stringify({ afterFirst, afterSecond, afterThird }));
