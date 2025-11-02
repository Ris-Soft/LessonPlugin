const path = require('path');
const url = require('url');
let pluginApi = null;

// 运行态状态
const state = {
  eventChannel: 'multiword.lowbar',
  floatPages: {},
  backgroundHome: '',
  prefs: {
    voice: 'ALL', // E(英) / A(美) / ALL
    enableCarousel: true,
    shuffleAfterCarousel: false
  },
  wordbankServerUrl: ''
};

function emitUpdate(target, value) {
  try {
    pluginApi.emit(state.eventChannel, { type: 'update', target, value });
  } catch (e) {
    console.error('[MULTIWORD] emitUpdate error:', e);
  }
}

const functions = {
  openMultiword: async (_params = {}) => {
    try {
      // 计算页面 URL
      const bgHome = path.join(__dirname, 'background', 'home.html');
      const listen = path.join(__dirname, 'float', 'listening.html');
      const selftest = path.join(__dirname, 'float', 'selftest.html');
      const check = path.join(__dirname, 'float', 'check.html');
      const externallib = path.join(__dirname, 'float', 'externallib.html');
      const dict = path.join(__dirname, 'float', 'dict.html');
      const prefs = path.join(__dirname, 'float', 'prefs.html');
      const about = path.join(__dirname, 'float', 'about.html');

      state.backgroundHome = url.pathToFileURL(bgHome).href;
      state.floatPages = {
        listening: url.pathToFileURL(listen).href,
        selftest: url.pathToFileURL(selftest).href,
        check: url.pathToFileURL(check).href,
        externallib: url.pathToFileURL(externallib).href,
        dict: url.pathToFileURL(dict).href,
        prefs: url.pathToFileURL(prefs).href,
        about: url.pathToFileURL(about).href
      };

      const params = {
        title: '多维单词',
        eventChannel: state.eventChannel,
        subscribeTopics: [state.eventChannel],
        callerPluginId: 'multi.word',
        windowMode: 'fullscreen_only',
        icon: 'ri-book-2-line',
        // 默认相对尺寸设置，具体窗口在点击时用绝对尺寸覆盖
        floatingSizePercent: 54,
        floatingBounds: 'center',
        leftItems: [ { id: 'go-home', text: '返回首页', icon: 'ri-home-3-line' } ],
        centerItems: [
          { id: 'listen', text: '单词听力', icon: 'ri-headphone-line' },
          { id: 'selftest', text: '单词自测', icon: 'ri-edit-2-line' },
          { id: 'check', text: '单词检查', icon: 'ri-search-eye-line' },
          { id: 'externallib', text: '外部词库', icon: 'ri-database-2-line' },
          { id: 'dict', text: '在线词典', icon: 'ri-book-open-line' },
          { id: 'prefs', text: '偏好设置', icon: 'ri-settings-5-line' },
          { id: 'about', text: '关于插件', icon: 'ri-information-line' }
        ],
        backgroundUrl: state.backgroundHome,
        floatingUrl: null
      };
      await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  onLowbarEvent: async (payload = {}) => {
    try {
      if (!payload || typeof payload !== 'object') return true;
      if (payload.type === 'click') {
        // 七个悬浮窗入口
        if (payload.id === 'listen') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 960, height: 640 });
          emitUpdate('floatingUrl', state.floatPages.listening);
        } else if (payload.id === 'selftest') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 840, height: 520 });
          emitUpdate('floatingUrl', state.floatPages.selftest);
        } else if (payload.id === 'check') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 960, height: 640 });
          emitUpdate('floatingUrl', state.floatPages.check);
        } else if (payload.id === 'externallib') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 800, height: 520 });
          emitUpdate('floatingUrl', state.floatPages.externallib);
        } else if (payload.id === 'dict') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 680, height: 520 });
          emitUpdate('floatingUrl', state.floatPages.dict);
        } else if (payload.id === 'prefs') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 600, height: 440 });
          emitUpdate('floatingUrl', state.floatPages.prefs);
        } else if (payload.id === 'about') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 520, height: 380 });
          emitUpdate('floatingUrl', state.floatPages.about);
        }
      } else if (payload.type === 'left.click') {
        if (payload.id === 'go-home') {
          emitUpdate('floatingUrl', null);
          emitUpdate('backgroundUrl', state.backgroundHome);
        }
      }
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  // 偏好设置
  savePreferences: async (prefs = {}) => {
    try {
      if (prefs && typeof prefs === 'object') {
        state.prefs = { ...state.prefs, ...prefs };
        pluginApi.store.set('multiword:prefs', state.prefs);
        return { ok: true };
      }
      return { ok: false };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getPreferences: async () => {
    try {
      const saved = pluginApi.store.get('multiword:prefs');
      if (saved && typeof saved === 'object') state.prefs = saved;
      return { ok: true, prefs: state.prefs };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  // 在线词典（本地 JSON 回退 + 远端尝试）
  dictLookup: async (word) => {
    try {
      const w = String(word || '').trim();
      if (!w) return { ok: false, error: 'empty word' };
      // 本地示例 JSON（作为回退）
      const fs = require('fs');
      const localJsonPath = path.resolve(__dirname, '../../renderer/a.json');
      let local = null;
      try {
        const txt = fs.readFileSync(localJsonPath, 'utf-8');
        local = JSON.parse(txt);
      } catch {}
      // 远端 API 尝试（未知参数名，先尝试 ?word=）
      let remote = null;
      try {
        const https = require('https');
        const apiUrl = new URL('https://v2.xxapi.cn/api/englishwords');
        apiUrl.searchParams.set('word', w);
        remote = await new Promise((resolve, reject) => {
          https.get(apiUrl, (res) => {
            let data = '';
            res.on('data', (d) => (data += d));
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { resolve({ raw: data }); }
            });
          }).on('error', reject);
        });
      } catch {}
      return { ok: true, remote, local };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  setWordbankUrl: async (urlStr) => {
    try {
      const s = String(urlStr || '').trim();
      state.wordbankServerUrl = s;
      pluginApi.store.set('multiword:wordbank:url', s);
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getWordbankUrl: async () => {
    try {
      const s = pluginApi.store.get('multiword:wordbank:url');
      if (typeof s === 'string') state.wordbankServerUrl = s;
      return { ok: true, url: state.wordbankServerUrl };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }
};

const init = async (api) => {
  pluginApi = api;
  api.splash.setStatus('plugin:init', '初始化 多维单词');
  api.splash.setStatus('plugin:init', '可通过动作打开 多维单词 窗口');
  api.splash.setStatus('plugin:init', '多维单词加载完成');
};

module.exports = {
  name: '多维单词',
  version: '0.1.0',
  init,
  functions
};