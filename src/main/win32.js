const koffi = require('koffi');

let user32 = null;
let kernel32 = null;

// Cache function handles to avoid re-parsing and duplicate type registration
let FindWindowA = null;
let FindWindowExA = null;
let SendMessageTimeoutA = null;
let EnumWindows = null;
let SetParent = null;
let MessageBoxA = null;

// Cache types
let EnumWindowProc = null;

function init() {
  if (process.platform !== 'win32') return;
  try {
    user32 = koffi.load('user32.dll');
    kernel32 = koffi.load('kernel32.dll');

    // Define callback type once
    try {
        EnumWindowProc = koffi.proto('bool EnumWindowProc(void *hwnd, int lParam)');
    } catch (e) {
        // In case it's already defined (e.g. hot reload), ignore or handle
        console.warn('EnumWindowProc definition warning:', e);
    }

    // Load functions
    FindWindowA = user32.func('void *FindWindowA(str className, str windowName)');
    FindWindowExA = user32.func('void *FindWindowExA(void *parent, void *childAfter, str className, str windowName)');
    SendMessageTimeoutA = user32.func('void *SendMessageTimeoutA(void *hwnd, uint msg, int wParam, int lParam, uint flags, uint timeout, void *result)');
    EnumWindows = user32.func('bool EnumWindows(void *lpEnumFunc, int lParam)');
    SetParent = user32.func('void *SetParent(void *child, void *newParent)');
    MessageBoxA = user32.func('int MessageBoxA(void *hwnd, str text, str title, int type)');

  } catch (e) {
    console.error('Failed to load Windows DLLs:', e);
  }
}

function getLibrary(name) {
  if (process.platform !== 'win32') return null;
  try {
    return koffi.load(name);
  } catch (e) {
    console.error(`Failed to load library ${name}:`, e);
    return null;
  }
}

// Example: Expose MessageBox
function messageBox(text, title = 'OrbiBoard', type = 0) {
  if (!user32) return;
  try {
    // Use cached function if available, otherwise define (fallback for safety)
    const fn = MessageBoxA || user32.func('int MessageBoxA(void *hwnd, str text, str title, int type)');
    return fn(null, text, title, type);
  } catch (e) {
    console.error('MessageBoxA failed:', e);
  }
}

function getDesktopWindow() {
  if (!user32) return null;
  try {
    // Ensure functions are loaded
    if (!FindWindowA || !FindWindowExA || !SendMessageTimeoutA || !EnumWindows || !EnumWindowProc) {
        console.error('Win32 functions not initialized correctly.');
        return null;
    }
    
    // 1. Find Progman
    let progman = FindWindowA('Progman', null);
    
    // 2. Send message to spawn WorkerW
    // 0x052C = WM_USER + ? (Undocumented message to spawn WorkerW behind icons)
    let result = Buffer.alloc(8);
    SendMessageTimeoutA(progman, 0x052C, 0, 0, 0x0002, 1000, result);
    
    // 3. Find the correct WorkerW
    let workerW = null;
    
    // Callback for EnumWindows
    // Register the callback using the pointer to the function type
    const findWorkerW = koffi.register((hwnd, lParam) => {
      // Use cached FindWindowExA
      let shellDll = FindWindowExA(hwnd, null, 'SHELLDLL_DefView', null);
      if (shellDll) {
        workerW = FindWindowExA(null, hwnd, 'WorkerW', null);
        return false; // Stop enumeration
      }
      return true; // Continue
    }, koffi.pointer(EnumWindowProc));

    try {
        EnumWindows(findWorkerW, 0);
    } finally {
        // Always unregister the callback to prevent memory leaks
        koffi.unregister(findWorkerW);
    }
    
    if (!workerW) {
        // Fallback: simply use Progman if WorkerW logic fails (though WorkerW is standard on Win10+)
        workerW = progman;
    }
    
    return workerW;
  } catch (e) {
    console.error('getDesktopWindow failed:', e);
    return null;
  }
}

function setParent(child, parent) {
  if (!user32) return;
  try {
    const fn = SetParent || user32.func('void *SetParent(void *child, void *newParent)');
    return fn(child, parent);
  } catch (e) {
    console.error('SetParent failed:', e);
  }
}

module.exports = {
  init,
  getLibrary,
  messageBox,
  getDesktopWindow,
  setParent,
  koffi
};
