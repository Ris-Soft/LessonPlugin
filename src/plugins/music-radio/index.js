const path = require('path');
const url = require('url');
let pluginApi = null;

const state = {
  eventChannel: 'radio.music',
  pages: {
    recommend: '',
    search: '',
    settings: '',
    about: '',
    player: ''
  }
};

const functions = {
  openRadio: async (_params = {}) => {
    try {
      const bgFile = path.join(__dirname, 'background', 'amll.html');
      const recFile = path.join(__dirname, 'float', 'recommend.html');
      const searchFile = path.join(__dirname, 'float', 'search.html');
      const settingsFile = path.join(__dirname, 'float', 'settings.html');
      const playerFile = path.join(__dirname, 'float', 'player.html');
      const aboutFile = path.join(__dirname, 'float', 'about.html');

      const params = {
        title: '音乐电台',
        icon: 'ri-radio-line',
        eventChannel: state.eventChannel,
        subscribeTopics: [state.eventChannel],
        callerPluginId: 'radio.music',
        floatingSizePercent: 60,
        floatingWidth: 860,
        floatingHeight: 520,
        centerItems: [
          { id: 'tab-recommend', text: '推荐', icon: 'ri-thumb-up-line' },
          { id: 'tab-search', text: '搜索', icon: 'ri-search-line' },
          { id: 'tab-player', text: '播放器', icon: 'ri-music-2-line' },
          { id: 'tab-settings', text: '设置', icon: 'ri-settings-3-line' },
          { id: 'tab-about', text: '关于', icon: 'ri-information-line' }
        ],
        leftItems: [],
        backgroundUrl: url.pathToFileURL(bgFile).href,
        floatingUrl: null,
        floatingBounds: 'center'
      };

      state.pages.recommend = url.pathToFileURL(recFile).href;
      state.pages.search = url.pathToFileURL(searchFile).href;
      state.pages.settings = url.pathToFileURL(settingsFile).href;
      state.pages.player = url.pathToFileURL(playerFile).href;
      state.pages.about = url.pathToFileURL(aboutFile).href;

      await pluginApi.call('ui.lowbar', 'openTemplate', [params]);
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  searchKuwo: async (keyword = '', page = 0) => {
    try {
      const q = String(keyword || '').trim();
      if (!q) return { ok: false, error: 'empty keyword' };
      const rn = 20;
      const https = require('https');
      const zlib = require('zlib');
      const buildUrl = (pn) => `https://search.kuwo.cn/r.s?all=${encodeURIComponent(q)}&pn=${pn}&rn=${rn}&vipver=100&ft=music&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.kuwo.cn/',
        'Origin': 'https://www.kuwo.cn',
        'Accept-Encoding': 'gzip, deflate'
      };
      async function fetchJson(urlStr){
        return await new Promise((resolve, reject) => {
          https.get(urlStr, { headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              try {
                let buf = Buffer.concat(chunks);
                const enc = (res.headers['content-encoding']||'').toLowerCase();
                if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
                else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
                let txt = buf.toString('utf8');
                // 某些情况下返回含无效前后缀，尝试截取 JSON
                if (txt.trim()[0] !== '{') {
                  const s = txt.indexOf('{'); const e = txt.lastIndexOf('}');
                  if (s >= 0 && e > s) txt = txt.slice(s, e+1);
                }
                const json = JSON.parse(txt);
                resolve(json);
              } catch (e) { reject(e); }
            });
          }).on('error', reject);
        });
      }
      let data = await fetchJson(buildUrl(page));
      let list = Array.isArray(data?.abslist) ? data.abslist : [];
      if (!list.length) {
        // 兼容某些地区 pn=1 起始
        data = await fetchJson(buildUrl(page === 0 ? 1 : page));
        list = Array.isArray(data?.abslist) ? data.abslist : [];
      }
      const items = list.map((item) => {
        const id = String(item.MUSICRID || '').replace('MUSIC_', '');
        const cover = item.web_albumpic_short
          ? `https://img3.kuwo.cn/star/albumcover/${String(item.web_albumpic_short).replace('120/', '256/')}`
          : (item.web_artistpic_short ? `https://star.kuwo.cn/star/starheads/${String(item.web_artistpic_short).replace('120/', '500/')}` : '');
        const rawTitle = item.SONGNAME || '';
        const title = rawTitle.includes('-') ? rawTitle.split('-').slice(0, -1).join('-').trim() : rawTitle;
        return { id, title, artist: item.ARTIST || '', album: item.ALBUM || '', duration: item.DURATION || 0, cover };
      });
      const hasMore = (data?.PN || (page||0)) * (data?.RN || rn) < (data?.TOTAL || 0);
      return { ok: true, items, hasMore };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getKuwoPlayUrl: async (id, quality = 'standard') => {
    try {
      const https = require('https');
      const q = String(quality || 'standard');
      const api = `https://api.limeasy.cn/kwmpro/v1/?id=${encodeURIComponent(String(id||''))}&quality=${encodeURIComponent(q)}`;
      const data = await new Promise((resolve, reject) => {
        https.get(api, { headers: { 'User-Agent': 'LessonPlugin/Radio' } }, (res) => {
          const chunks = []; res.on('data', (c) => chunks.push(c));
          res.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (e) { reject(e); } });
        }).on('error', reject);
      });
      if (data && (data.code === 200 || data.code === 201) && data.url) return { ok: true, url: data.url };
      return { ok: false, error: 'resolve failed' };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  kuwoProxy: async (targetUrl = '') => {
    try {
      const https = require('https');
      const zlib = require('zlib');
      const u = String(targetUrl || '').trim();
      if (!u) return { ok: false, error: 'empty url' };
      const headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'application/json, text/plain, */*',
        'Referer': 'https://www.kuwo.cn/',
        'Origin': 'https://www.kuwo.cn',
        'Accept-Encoding': 'gzip, deflate'
      };
      const content = await new Promise((resolve, reject) => {
        https.get(u, { headers }, (res) => {
          const chunks = [];
          res.on('data', (c) => chunks.push(c));
          res.on('end', () => {
            try {
              let buf = Buffer.concat(chunks);
              const enc = (res.headers['content-encoding']||'').toLowerCase();
              if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
              else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
              resolve(buf.toString('utf8'));
            } catch (e) { reject(e); }
          });
        }).on('error', reject);
      });
      return { ok: true, content };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  setBackgroundMusic: async ({ music, album, title, artist }) => {
    try {
      const bgFile = path.join(__dirname, 'background', 'amll.html');
      const u = new url.URL(url.pathToFileURL(bgFile).href);
      if (music) u.searchParams.set('music', String(music));
      if (album) u.searchParams.set('album', String(album));
      if (title) u.searchParams.set('title', String(title));
      if (artist) u.searchParams.set('artist', String(artist));
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'backgroundUrl', value: u.href });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  readFileUtf8: async (filePath) => {
    try {
      const fs = require('fs');
      const p = String(filePath || '');
      if (!p) return { ok: false, error: 'invalid path' };
      const data = fs.readFileSync(p, 'utf8');
      return { ok: true, content: data };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getAmlEntryUrls: async () => {
    try {
      const fs = require('fs');
      const path = require('path');
      const toUrl = (p) => url.pathToFileURL(p).href;
      function unique(arr){ const s=new Set(arr.filter(Boolean)); return Array.from(s); }
      function candidateNodeModules(){
        const bases = unique([
          process.cwd(),
          __dirname,
          path.dirname(__dirname),
          path.dirname(path.dirname(__dirname)),
          path.dirname(path.dirname(path.dirname(__dirname))),
          (process.resourcesPath ? path.join(process.resourcesPath, 'app') : null),
          (process.resourcesPath ? path.join(process.resourcesPath, 'app', 'node_modules') : null),
        ]);
        const nodes = [];
        for (const b of bases) {
          if (!b) continue;
          nodes.push(path.join(b, 'node_modules'));
          nodes.push(path.join(b, '..', 'node_modules'));
        }
        return unique([...(require.main?.paths || []), ...(module.paths || []), ...nodes]);
      }
      function resolveFromPaths(pkgName){
        const nodes = candidateNodeModules();
        for (const nm of nodes) {
          try {
            const pkgJsonPath = path.join(nm, pkgName, 'package.json');
            if (!fs.existsSync(pkgJsonPath)) continue;
            const pkgDir = path.dirname(pkgJsonPath);
            const meta = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
            const candidates = [];
            if (typeof meta === 'object') {
              if (typeof meta.unpkg === 'string') candidates.push(meta.unpkg);
              if (typeof meta.module === 'string') candidates.push(meta.module);
              if (typeof meta.browser === 'string') candidates.push(meta.browser);
              if (meta.exports && typeof meta.exports === 'object') {
                const exp = meta.exports;
                if (typeof exp.import === 'string') candidates.push(exp.import);
                if (typeof exp.default === 'string') candidates.push(exp.default);
                if (exp['.'] && typeof exp['.'] === 'object') {
                  if (typeof exp['.'].import === 'string') candidates.push(exp['.'].import);
                  if (typeof exp['.'].default === 'string') candidates.push(exp['.'].default);
                }
              }
              if (typeof meta.main === 'string') candidates.push(meta.main);
            }
            const fallback = ['dist/esm/index.js','dist/index.js','index.js'];
            for (const rel of [...candidates, ...fallback]) {
              const full = path.join(pkgDir, rel);
              try { if (fs.existsSync(full)) return { file: full, pkgDir, style: path.join(pkgDir, 'style.css') }; } catch {}
            }
            return { file: null, pkgDir, style: path.join(pkgDir, 'style.css') };
          } catch {}
        }
        return { file: null, pkgDir: null, style: null };
      }
      function resolveEsm(pkgName, rel) {
        try {
          const pkgJsonPath = require.resolve(path.join(pkgName, 'package.json'));
          const pkgDir = path.dirname(pkgJsonPath);
          const full = path.join(pkgDir, rel || 'dist/esm/index.js');
          if (fs.existsSync(full)) return toUrl(full);
        } catch {}
        const info = resolveFromPaths(pkgName);
        if (info && info.file && /\/dist\/esm\//.test(info.file)) return toUrl(info.file);
        return null;
      }
      function resolveEntry(pkgName) {
        let pkgJsonPath = null;
        try { pkgJsonPath = require.resolve(path.join(pkgName, 'package.json')); } catch {}
        if (!pkgJsonPath) {
          const info = resolveFromPaths(pkgName);
          if (!info || !info.pkgDir) return info;
          pkgJsonPath = path.join(info.pkgDir, 'package.json');
        }
        try {
          const pkgDir = path.dirname(pkgJsonPath);
          const meta = JSON.parse(fs.readFileSync(pkgJsonPath, 'utf8'));
          const candidates = [];
          if (typeof meta === 'object') {
            if (meta.exports && typeof meta.exports === 'object') {
              const exp = meta.exports;
              if (typeof exp.import === 'string') candidates.push(exp.import);
              if (exp['.'] && typeof exp['.'] === 'object') {
                if (typeof exp['.'].import === 'string') candidates.push(exp['.'].import);
              }
            }
            if (typeof meta.module === 'string') candidates.push(meta.module);
            if (typeof meta.browser === 'string') candidates.push(meta.browser);
            if (typeof meta.main === 'string') candidates.push(meta.main);
          }
          const fallback = ['dist/esm/index.js','dist/index.js','index.js'];
          for (const rel of [...candidates, ...fallback]) {
            const full = path.join(pkgDir, rel);
            try { if (fs.existsSync(full)) return { file: full, pkgDir, style: path.join(pkgDir, 'style.css') }; } catch {}
          }
          return { file: null, pkgDir, style: path.join(pkgDir, 'style.css') };
        } catch {
          return { file: null, pkgDir: null, style: null };
        }
      }
      const coreInfo = resolveEntry('@applemusic-like-lyrics/core');
      const lyricInfo = resolveEntry('@applemusic-like-lyrics/lyric');
      const pixiPackages = [
        '@pixi/app',
        '@pixi/core',
        '@pixi/display',
        '@pixi/filter-blur',
        '@pixi/filter-bulge-pinch',
        '@pixi/filter-color-matrix',
        '@pixi/sprite',
        '@pixi/utils'
      ];
      function buildPixiDepsFromCore(pkgDir){
        try {
          const meta = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8'));
          const set = new Set(pixiPackages);
          const addFrom = (obj) => {
            if (obj && typeof obj === 'object') {
              for (const k of Object.keys(obj)) { if (k.startsWith('@pixi/')) set.add(k); }
            }
          };
          addFrom(meta.dependencies);
          addFrom(meta.peerDependencies);
          return Array.from(set);
        } catch {
          return pixiPackages;
        }
      }
      const importMap = {};
      const allPixi = coreInfo && coreInfo.pkgDir ? buildPixiDepsFromCore(coreInfo.pkgDir) : pixiPackages;
      for (const name of allPixi) {
        const u = resolveEsm(name, 'dist/esm/index.js');
        if (u) importMap[name] = u;
      }
      const coreUrlLocal = coreInfo.file ? toUrl(coreInfo.file) : null;
      const lyricUrlLocal = lyricInfo.file ? toUrl(lyricInfo.file) : null;
      const coreStyleLocal = coreInfo.style && coreInfo.pkgDir && fs.existsSync(coreInfo.style) ? toUrl(coreInfo.style) : null;
      return {
        ok: true,
        coreUrl: coreUrlLocal,
        lyricUrl: lyricUrlLocal,
        coreStyleUrl: coreStyleLocal,
        importMap
      };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  onLowbarEvent: async (payload = {}) => {
    try {
      if (!payload || typeof payload !== 'object') return true;
      if (payload.type === 'click') {
        if (payload.id === 'tab-recommend') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.recommend });
        } else if (payload.id === 'tab-search') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.search });
        } else if (payload.id === 'tab-player') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 1024, height: 640 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.player });
        } else if (payload.id === 'tab-settings') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 720, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.settings });
        } else if (payload.id === 'tab-about') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 640, height: 400 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.about });
        }
      }
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }
};

const init = async (api) => {
  pluginApi = api;
  api.splash.setStatus('plugin:init', '初始化 音乐电台');
  api.splash.setStatus('plugin:init', '背景为 播放器背景');
  api.splash.setStatus('plugin:init', '音乐电台加载完成');
};

module.exports = {
  name: '音乐电台',
  version: '0.1.0',
  init,
  functions: {
    ...functions,
    getVariable: async (name) => { const k=String(name||''); if (k==='timeISO') return new Date().toISOString(); return ''; },
    listVariables: () => ['timeISO']
  }
};