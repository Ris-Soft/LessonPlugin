const path = require('path');
const url = require('url');
const { app } = require('electron');
const store = require(path.join(app.getAppPath(), 'src', 'main', 'store.js'));
let pluginApi = null;

// 运行态状态
const state = {
  eventChannel: 'multiword.lowbar',
  floatPages: {},
  backgroundHome: '',
  defaultCenterItems: [
    // { id: 'listen', text: '单词听力', icon: 'ri-headphone-line' },
    // { id: 'selftest', text: '单词自测', icon: 'ri-edit-2-line' },
    // { id: 'check', text: '单词检查', icon: 'ri-search-eye-line' },
    { id: 'externallib', text: '外部词库', icon: 'ri-database-2-line' },
    { id: 'dict', text: '在线词典', icon: 'ri-book-open-line' },
    // { id: 'prefs', text: '偏好设置', icon: 'ri-settings-5-line' },
    { id: 'about', text: '关于插件', icon: 'ri-information-line' }
  ],
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
        id: 'multiword.lowbar',
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
        centerItems: state.defaultCenterItems,
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
        } else if (payload.id === 'dictWord') {
          // 从轮播或列表点击某词，直接打开在线词典浮窗并填充查询词
          const w = String(payload.word || '').trim();
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 680, height: 520 });
          const dictUrl = new URL(state.floatPages.dict);
          if (w) dictUrl.searchParams.set('word', w);
          emitUpdate('floatingUrl', dictUrl.href);
        } else if (payload.id === 'prefs') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 600, height: 440 });
          emitUpdate('floatingUrl', state.floatPages.prefs);
        } else if (payload.id === 'about') {
          emitUpdate('floatingBounds', 'center');
          emitUpdate('floatingBounds', { width: 520, height: 380 });
          emitUpdate('floatingUrl', state.floatPages.about);
        } else if (payload.id === 'close-dict') {
          emitUpdate('floatingUrl', null);
          emitUpdate('centerItems', state.defaultCenterItems);
        } else if (payload.id === 'carousel-prev') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'carousel', cmd: 'prev' });
        } else if (payload.id === 'carousel-next') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'carousel', cmd: 'next' });
        } else if (payload.id === 'carousel-pause') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'carousel', cmd: 'pause' });
        } else if (payload.id === 'carousel-stop') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'carousel', cmd: 'stop' });
          // 结束轮播后恢复首页与默认底栏
          emitUpdate('backgroundUrl', state.backgroundHome);
          emitUpdate('centerItems', state.defaultCenterItems);
        } else if (payload.id === 'carousel-toggle-cn') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'carousel', cmd: 'toggle-cn' });
        } else if (payload.id === 'open-carousel-settings' || payload.id === 'carousel-settings') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'carousel', cmd: 'settings' });
        } else if (payload.id === 'allwords-sort-time') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'allwords', cmd: 'sort-time' });
        } else if (payload.id === 'allwords-sort-alpha') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'allwords', cmd: 'sort-alpha' });
        } else if (payload.id === 'allwords-stop') {
          // 停止浏览：返回首页并恢复默认底栏
          emitUpdate('backgroundUrl', state.backgroundHome);
          emitUpdate('centerItems', state.defaultCenterItems);
        } else if (payload.id === 'check-prev') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'check', cmd: 'prev' });
        } else if (payload.id === 'check-next') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'check', cmd: 'next' });
        } else if (payload.id === 'check-mark') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'check', cmd: 'mark' });
        } else if (payload.id === 'check-showcn') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'check', cmd: 'showcn' });
        } else if (payload.id === 'check-random') {
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'check', cmd: 'random' });
        } else if (payload.id === 'check-stop') {
          // 交由检查页自行显示总结并切换底栏
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'check', cmd: 'stop' });
        } else if (payload.id === 'summary-exit') {
          // 总结页退出：返回首页并恢复默认底栏
          emitUpdate('backgroundUrl', state.backgroundHome);
          emitUpdate('centerItems', state.defaultCenterItems);
        } else if (payload.id === 'check-start') {
          // 从预览底栏触发检查开始，由轮播页执行跳转
          pluginApi.emit(state.eventChannel, { type: 'control', action: 'carousel', cmd: 'start-check' });
        }
      } else if (payload.type === 'left.click') {
        if (payload.id === 'go-home') {
          emitUpdate('floatingUrl', null);
          emitUpdate('backgroundUrl', state.backgroundHome);
          emitUpdate('centerItems', state.defaultCenterItems);
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
        store.set('multi-word', 'prefs', state.prefs);
        return { ok: true };
      }
      return { ok: false };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getPreferences: async () => {
    try {
      const saved = store.get('multi-word', 'prefs');
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
      store.set('multi-word', 'wordbankUrl', s);
      return { ok: true };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getWordbankUrl: async () => {
    try {
      const s = store.get('multi-word', 'wordbankUrl');
      if (typeof s === 'string') state.wordbankServerUrl = s;
      return { ok: true, url: state.wordbankServerUrl };
    } catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getDefaultCenterItems: async () => {
    try { return { ok: true, items: state.defaultCenterItems }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  }
};

const init = async (api) => {
  pluginApi = api;
  api.splash.setStatus('plugin:init', '初始化 多维单词');
  api.splash.setStatus('plugin:init', '可通过动作打开 多维单词 窗口');
  api.splash.setStatus('plugin:init', '多维单词加载完成');
  try {
    store.ensureDefaults('multi-word', { prefs: { voice: 'ALL', enableCarousel: true, shuffleAfterCarousel: false }, wordbankUrl: '' });
  } catch {}
};

module.exports = {
  name: '多维单词',
  version: '0.1.0',
  init,
  functions: {
    ...functions,
    getVariable: async (name) => {
      const k = String(name||'');
      if (k==='timeISO') return new Date().toISOString();
      if (k==='pluginName') return '多维单词';
      if (k==='wordbankUrl') return String(state.wordbankServerUrl || '');
      return '';
    },
    listVariables: () => ['timeISO','pluginName','wordbankUrl']
  }
};
