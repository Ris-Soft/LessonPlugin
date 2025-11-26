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
  },
  currentFloatingUrl: null,
  playlist: [],
  currentIndex: -1,
  settings: { removeAfterPlay: true }
};

const functions = {
  openRadio: async (_params = {}) => {
    try {
      const bgFile = path.join(__dirname, 'background', 'player.html');
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
        width: 1680,
        height: 960,
        floatingSizePercent: 60,
        floatingWidth: 860,
        floatingHeight: 520,
        centerItems: [
          // { id: 'tab-recommend', text: '推荐', icon: 'ri-thumb-up-line' },
          { id: 'tab-search', text: '搜索', icon: 'ri-search-line' },
          { id: 'btn-bgmode', text: '背景', icon: 'ri-contrast-drop-2-line' },
          // { id: 'tab-settings', text: '设置', icon: 'ri-settings-3-line' },
          // { id: 'tab-about', text: '关于', icon: 'ri-information-line' }
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
      state.currentFloatingUrl = null;
      try {
        if (state.currentIndex >= 0 && state.currentIndex < state.playlist.length) {
          const cur = state.playlist[state.currentIndex];
          const g = await functions.getPlayUrl(cur, 'standard');
          if (g && g.ok && g.url) {
            await functions.setBackgroundMusic({ music: g.url, album: cur.cover, title: cur.title, artist: cur.artist, id: cur.id, source: cur.source || 'kuwo' });
          }
        }
      } catch {}
      return true;
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  httpProxy: async (targetUrl = '', options = {}) => {
    try {
      const u = String(targetUrl || '').trim();
      if (!u) return { ok: false, error: 'empty url' };
      const parsed = new url.URL(u);
      const wl = new Set(['search.kuwo.cn', 'newlyric.kuwo.cn']);
      if (!wl.has(parsed.host)) return { ok: false, error: 'domain not allowed' };
      const http = require('http');
      const https = require('https');
      const zlib = require('zlib');
      const method = String(options.method || 'GET').toUpperCase();
      const rawHeaders = options.headers && typeof options.headers === 'object' ? options.headers : {};
      const headers = {};
      for (const k of Object.keys(rawHeaders)) {
        const lk = k.toLowerCase();
        if (lk === 'host' || lk === 'referer' || lk === 'origin') continue;
        headers[k] = rawHeaders[k];
      }
      if (!headers['Accept-Encoding']) headers['Accept-Encoding'] = 'gzip, deflate';
      if (!headers['User-Agent']) headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
      if (!headers['Accept-Language']) headers['Accept-Language'] = 'zh-CN,zh;q=0.9';
      const body = options.body;
      async function fetchOnce(href){
        const reqMod = href.startsWith('https:') ? https : http;
        return await new Promise((resolve, reject) => {
          const req = reqMod.request(href, { method, headers }, (res) => {
            const chunks = [];
            res.on('data', (c) => chunks.push(c));
            res.on('end', () => {
              try {
                const status = res.statusCode || 0;
                const redirect = status >= 300 && status < 400 && res.headers && res.headers.location;
                const raw = Buffer.concat(chunks);
                resolve({ status, headers: res.headers, contentBuffer: raw, redirect });
              } catch (e) { reject(e); }
            });
          });
          req.on('error', reject);
          if (body && method !== 'GET' && method !== 'HEAD') {
            if (Buffer.isBuffer(body)) req.write(body);
            else req.write(String(body));
          }
          req.end();
        });
      }
      let href = u; let redirects = 0;
      while (redirects < 5) {
        const r = await fetchOnce(href);
        if (r.redirect) {
          const nextUrl = new url.URL(r.redirect, href).href;
          const nextParsed = new url.URL(nextUrl);
          if (!wl.has(nextParsed.host)) return { ok: false, error: 'redirect domain not allowed', status: r.status };
          href = nextUrl; redirects += 1; continue;
        }
        let buf = r.contentBuffer;
        const enc = (r.headers['content-encoding']||'').toLowerCase();
        if (enc.includes('gzip')) buf = zlib.gunzipSync(buf);
        else if (enc.includes('deflate')) buf = zlib.inflateSync(buf);
        const content = buf.toString('utf8');
        return { ok: true, status: r.status, headers: r.headers, content };
      }
      return { ok: false, error: 'too many redirects' };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  searchKuwo: async (keyword = '', page = 0) => {
    try {
      const q = String(keyword || '').trim();
      if (!q) return { ok: false, error: 'empty keyword' };
      const rn = 20;
      const buildUrl = (pn) => `https://search.kuwo.cn/r.s?all=${encodeURIComponent(q)}&pn=${pn}&rn=${rn}&vipver=100&ft=music&encoding=utf8&rformat=json&vermerge=1&mobi=1`;
      async function fetchJson(urlStr){
        const res = await functions.httpProxy(urlStr, { method: 'GET', headers: { 'Accept': 'application/json, text/plain, */*' } });
        const rawTxt = String(res && res.content ? res.content : '');
        let txt = rawTxt;
        if (txt.trim()[0] !== '{') {
          const s = txt.indexOf('{'); const e = txt.lastIndexOf('}');
          if (s >= 0 && e > s) txt = txt.slice(s, e+1);
        }
        let obj = null;
        try { obj = JSON.parse(txt); } catch {}
        return { obj, raw: rawTxt };
      }
      let dat = await fetchJson(buildUrl(page));
      let data = dat.obj;
      let raw = dat.raw;
      let list = Array.isArray(data?.abslist) ? data.abslist : [];
      if (!list.length) {
        dat = await fetchJson(buildUrl(page === 0 ? 1 : page));
        data = dat.obj;
        raw = dat.raw;
        list = Array.isArray(data?.abslist) ? data.abslist : [];
      }
      const items = list.map((item) => {
        const id = String(item.MUSICRID || '').replace('MUSIC_', '');
        const cover = item.web_albumpic_short
          ? `https://img3.kuwo.cn/star/albumcover/${String(item.web_albumpic_short).replace('120/', '256/')}`
          : (item.web_artistpic_short ? `https://star.kuwo.cn/star/starheads/${String(item.web_artistpic_short).replace('120/', '500/')}` : '');
        const rawTitle = item.SONGNAME || '';
        const title = rawTitle.includes('-') ? rawTitle.split('-').slice(0, -1).join('-').trim() : rawTitle;
        return { id, title, artist: item.ARTIST || '', album: item.ALBUM || '', duration: item.DURATION || 0, cover, source: 'kuwo' };
      });
      const hasMore = (data?.PN || (page||0)) * (data?.RN || rn) < (data?.TOTAL || 0);
      return { ok: true, items, hasMore, raw };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  searchBili: async (keyword = '', page = 1) => {
    try {
      const q = String(keyword || '').trim();
      if (!q) return { ok: false, error: 'empty keyword' };
      const https = require('https');
      async function fetchJson(u){ return await new Promise((resolve, reject) => { https.get(u, { headers: { 'User-Agent': 'LessonPlugin/Radio', 'Accept': 'application/json' } }, (res) => { const chunks=[]; res.on('data',(c)=>chunks.push(c)); res.on('end',()=>{ try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }catch(e){ reject(e); } }); }).on('error', reject); }); }
      const data = await fetchJson(`https://api.3r60.top/v2/bili/s/?keydown=${encodeURIComponent(q)}`);
      const arr = data && data.data && Array.isArray(data.data.result) ? data.data.result : [];
      const pageSize = 20;
      const pageArr = arr.slice(((Math.max(1, Number(page)||1)-1)*pageSize), (Math.max(1, Number(page)||1)*pageSize));
      const items = [];
      for (const it of pageArr) {
        const bvid = it && it.bvid ? String(it.bvid) : '';
        if (!bvid) continue;
        try {
          const meta = await fetchJson(`https://api.bilibili.com/x/web-interface/view?bvid=${encodeURIComponent(bvid)}`);
          const m = meta && meta.data ? meta.data : {};
          const title = String(m.title || '');
          const artist = (m.owner && m.owner.name) ? m.owner.name : '';
          const album = m.tname_v2 ? String(m.tname_v2) : (m.tname ? String(m.tname) : '');
          const duration = Number(m.duration || 0) || 0;
          const cover = m.pic ? (String(m.pic).startsWith('http') ? m.pic : ('https:' + String(m.pic))) : '';
          items.push({ id: bvid, title, artist, album, duration, cover, source: 'bili', cid: 'default' });
        } catch {}
      }
      const hasMore = arr.length > (Math.max(1, Number(page)||1) * pageSize);
      return { ok: true, items, hasMore };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getPlayUrl: async (item = {}, quality = 'standard') => {
    try {
      const src = String(item.source || 'kuwo');
      if (src === 'bili') {
        const r = await functions.getBiliPlayUrl(String(item.id||''), String(item.cid||''));
        return r;
      }
      return await functions.getKuwoPlayUrl(String(item.id||''), String(quality||'standard'));
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getBiliPlayUrl: async (bvid = '', cid = '') => {
    try {
      const https = require('https');
      const fs = require('fs');
      const os = require('os');
      async function fetchJson(u){ return await new Promise((resolve, reject) => { https.get(u, { headers: { 'User-Agent': 'LessonPlugin/Radio', 'Accept': 'application/json' } }, (res) => { const chunks=[]; res.on('data',(c)=>chunks.push(c)); res.on('end',()=>{ try{ resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }catch(e){ reject(e); } }); }).on('error', reject); }); }
      let c = String(cid || '');
      if (!c || c === 'default') {
        const v = await fetchJson(`https://api.bilibili.com/x/player/pagelist?bvid=${encodeURIComponent(String(bvid||''))}`);
        c = v && v.data && Array.isArray(v.data) && v.data[0] && v.data[0].cid ? String(v.data[0].cid) : '';
      }
      if (!bvid || !c) return { ok: false, error: 'invalid bvid/cid' };
      const info = await fetchJson(`https://api.bilibili.com/x/player/playurl?bvid=${encodeURIComponent(bvid)}&cid=${encodeURIComponent(c)}`);
      const durl = info && info.data && Array.isArray(info.data.durl) ? info.data.durl : [];
      const url0 = durl[0] && durl[0].url ? durl[0].url : null;
      if (!url0) return { ok: false, error: 'resolve failed' };
      const tempDir = require('path').join(os.tmpdir(), 'lessonplugin.radio.bilibili', 'cache');
      try { if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true }); } catch {}
      const fileName = `${String(bvid)}-${String(c)}.mp4`;
      const cachePath = require('path').join(tempDir, fileName);
      if (fs.existsSync(cachePath)) return { ok: true, url: require('url').pathToFileURL(cachePath).href };
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'show' }); } catch {}
      async function headSize(u){ return await new Promise((resolve, reject) => { https.get(u, { method: 'HEAD', headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36', 'Accept-Encoding': 'gzip', 'Origin': 'https://www.bilibili.com', 'Referer': `https://www.bilibili.com/${String(bvid)}` } }, (res) => { const len = parseInt(res.headers['content-length']||'0', 10) || 0; resolve(len); }).on('error', reject); }); }
      async function fetchRange(u, start, end){ return await new Promise((resolve, reject) => { https.get(u, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0 Safari/537.36', 'Accept-Encoding': 'gzip', 'Origin': 'https://www.bilibili.com', 'Referer': `https://www.bilibili.com/${String(bvid)}`, 'Range': `bytes=${start}-${end}` } }, (res) => { const chunks=[]; res.on('data',(c)=>chunks.push(c)); res.on('end',()=>resolve(Buffer.concat(chunks))); }).on('error', reject); }); }
      const size = await headSize(url0);
      if (!size) return { ok: false, error: 'invalid content size' };
      const parts = 10;
      const chunk = Math.ceil(size / parts);
      const tasks = [];
      for (let i=0;i<parts;i++){ const s=i*chunk; const e=Math.min(size-1, (i+1)*chunk-1); tasks.push(fetchRange(url0, s, e)); }
      const bufs = await Promise.all(tasks);
      const out = Buffer.concat(bufs);
      fs.writeFileSync(cachePath, out);
      try {
        const files = fs.readdirSync(tempDir);
        const maxTemp = 50;
        if (files.length > maxTemp) {
          const oldest = files.sort((a,b)=>fs.statSync(require('path').join(tempDir,a)).mtime - fs.statSync(require('path').join(tempDir,b)).mtime)[0];
          try { fs.unlinkSync(require('path').join(tempDir, oldest)); } catch {}
        }
      } catch {}
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch {}
      return { ok: true, url: require('url').pathToFileURL(cachePath).href };
    } catch (e) {
      try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'songLoading', value: 'hide' }); } catch {}
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
  setBackgroundMusic: async ({ music, album, title, artist, id, source }) => {
    try {
      const bgFile = path.join(__dirname, 'background', 'player.html');
      const u = new url.URL(url.pathToFileURL(bgFile).href);
      if (music) u.searchParams.set('music', String(music));
      if (album) u.searchParams.set('album', String(album));
      if (title) u.searchParams.set('title', String(title));
      if (artist) u.searchParams.set('artist', String(artist));
      if (id) u.searchParams.set('id', String(id));
      if (source) u.searchParams.set('source', String(source));
      u.searchParams.set('channel', state.eventChannel);
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'backgroundUrl', value: u.href });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  enqueueTail: async (item = {}) => {
    try {
      const it = {
        id: String(item.id||''),
        title: String(item.title||''),
        artist: String(item.artist||''),
        album: String(item.album||''),
        cover: String(item.cover||''),
        duration: Number(item.duration||0) || 0,
        source: String(item.source||'kuwo'),
        cid: String(item.cid||'')
      };
      if (!it.id) return { ok: false, error: 'invalid item' };
      const wasEmpty = state.playlist.length === 0 || state.currentIndex < 0;
      state.playlist.push(it);
      if (wasEmpty) {
        state.currentIndex = 0;
        const g = await functions.getPlayUrl(it, 'standard');
        if (g && g.ok && g.url) await functions.setBackgroundMusic({ music: g.url, album: it.cover, title: it.title, artist: it.artist, id: it.id, source: it.source });
      }
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
      return { ok: true, length: state.playlist.length };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  enqueueNext: async (item = {}) => {
    try {
      const it = {
        id: String(item.id||''),
        title: String(item.title||''),
        artist: String(item.artist||''),
        album: String(item.album||''),
        cover: String(item.cover||''),
        duration: Number(item.duration||0) || 0,
        source: String(item.source||'kuwo'),
        cid: String(item.cid||'')
      };
      if (!it.id) return { ok: false, error: 'invalid item' };
      const wasEmpty = state.playlist.length === 0 || state.currentIndex < 0;
      if (wasEmpty) {
        state.playlist.push(it);
        state.currentIndex = 0;
        const g = await functions.getPlayUrl(it, 'standard');
        if (g && g.ok && g.url) await functions.setBackgroundMusic({ music: g.url, album: it.cover, title: it.title, artist: it.artist, id: it.id, source: it.source });
        pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
        return { ok: true, length: state.playlist.length, pos: 0 };
      } else {
        const pos = state.currentIndex >= 0 ? state.currentIndex + 1 : state.playlist.length;
        state.playlist.splice(pos, 0, it);
        pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
        return { ok: true, length: state.playlist.length, pos };
      }
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  playNow: async (item = {}) => {
    try {
      const id = String(item.id||'');
      if (!id) return { ok: false, error: 'invalid item id' };
      const meta = {
        id,
        title: String(item.title||''),
        artist: String(item.artist||''),
        album: String(item.album||''),
        cover: String(item.cover||''),
        duration: Number(item.duration||0) || 0,
        source: String(item.source||'kuwo'),
        cid: String(item.cid||'')
      };
      // push into playlist and mark current
      state.playlist.push(meta);
      state.currentIndex = state.playlist.length - 1;
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) return { ok: false, error: g?.error || 'resolve failed' };
      await functions.setBackgroundMusic({ music: g.url, album: meta.cover, title: meta.title, artist: meta.artist, id: meta.id, source: meta.source });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  nextTrack: async (cause = 'manual') => {
    try {
      const prevIdx = state.currentIndex;
      let nextIdx = prevIdx >= 0 ? prevIdx + 1 : (state.playlist.length ? 0 : -1);
      const isLast = prevIdx === state.playlist.length - 1;
      if (cause === 'ended' && state.settings.removeAfterPlay && prevIdx >= 0 && prevIdx < state.playlist.length) {
        state.playlist.splice(prevIdx, 1);
        pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
        nextIdx = prevIdx;
      }
      if (cause === 'manual' && isLast) return { ok: false, error: 'no next track' };
      if (nextIdx < 0 || nextIdx >= state.playlist.length) return { ok: false, error: 'no next track' };
      state.currentIndex = nextIdx;
      const meta = state.playlist[nextIdx];
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) return { ok: false, error: g?.error || 'resolve failed' };
      await functions.setBackgroundMusic({ music: g.url, album: meta.cover, title: meta.title, artist: meta.artist, id: meta.id, source: meta.source });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  prevTrack: async () => {
    try {
      const prevIdx = state.currentIndex > 0 ? state.currentIndex - 1 : -1;
      if (prevIdx < 0 || prevIdx >= state.playlist.length) return { ok: false, error: 'no previous track' };
      state.currentIndex = prevIdx;
      const meta = state.playlist[prevIdx];
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) return { ok: false, error: g?.error || 'resolve failed' };
      await functions.setBackgroundMusic({ music: g.url, album: meta.cover, title: meta.title, artist: meta.artist, id: meta.id, source: meta.source });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  getPlaylist: async () => {
    try {
      const total = state.playlist.reduce((acc, it) => acc + (Number(it.duration)||0), 0);
      return { ok: true, items: state.playlist.slice(), currentIndex: state.currentIndex, totalSecs: total };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  setRemoveAfterPlay: async (flag = false) => {
    try { state.settings.removeAfterPlay = !!flag; return { ok: true, value: state.settings.removeAfterPlay }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  getSettings: async () => {
    try { return { ok: true, settings: { ...state.settings } }; }
    catch (e) { return { ok: false, error: e?.message || String(e) }; }
  },
  removeIndex: async (idx = 0) => {
    try {
      const i = Math.floor(Number(idx)||0);
      if (i < 0 || i >= state.playlist.length) return { ok: false, error: 'index out of range' };
      state.playlist.splice(i, 1);
      if (state.currentIndex === i) state.currentIndex = Math.min(state.currentIndex, state.playlist.length - 1);
      else if (state.currentIndex > i) state.currentIndex -= 1;
      pluginApi.emit(state.eventChannel, { type: 'update', target: 'playlist', value: { length: state.playlist.length } });
      return { ok: true, length: state.playlist.length };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  fetchKuwoLyrics: async (id, isLyricx = true) => {
    try {
      const https = require('https');
      const http = require('http');
      const zlib = require('zlib');
      const bufKey = Buffer.from('yeelion');
      function buildParams(mid, lrcx){
        let params = `user=12345,web,web,web&requester=localhost&req=1&rid=MUSIC_${String(mid)}`;
        if (lrcx) params += '&lrcx=1';
        const src = Buffer.from(params);
        const out = Buffer.alloc(src.length * 2);
        let k = 0;
        for (let i=0;i<src.length;){ for (let j=0;j<bufKey.length && i<src.length; j++, i++){ out[k++] = bufKey[j] ^ src[i]; } }
        return out.slice(0, k).toString('base64');
      }
      async function inflateAsync(buf){ return await new Promise((resolve, reject) => zlib.inflate(buf, (e, r) => e ? reject(e) : resolve(r))); }
      function requestRaw(u){ return new Promise((resolve, reject) => { const lib = u.startsWith('https') ? https : http; const req = lib.get(u, (res) => { const chunks=[]; res.on('data',(c)=>chunks.push(c)); res.on('end',()=>resolve(Buffer.concat(chunks))); }).on('error', reject); req.setTimeout(15000, () => { try{req.destroy(new Error('timeout'));}catch{} }); }); }
      const api = `http://newlyric.kuwo.cn/newlyric.lrc?${buildParams(id, !!isLyricx)}`;
      const raw = await requestRaw(api);
      const head = raw.toString('utf8', 0, 12);
      if (!head.startsWith('tp=content')) return { ok: false, error: 'no content' };
      const start = raw.indexOf('\r\n\r\n');
      const inflated = await inflateAsync(raw.slice(start + 4));
      if (!isLyricx) return { ok: true, format: 'plain', dataBase64: Buffer.from(inflated).toString('base64') };
      const base = Buffer.from(inflated.toString('utf8'), 'base64');
      const out = Buffer.alloc(base.length * 2);
      let k = 0;
      for (let i=0;i<base.length;){ for (let j=0;j<bufKey.length && i<base.length; j++, i++){ out[k++] = base[i] ^ bufKey[j]; } }
      return { ok: true, format: 'lrcx', dataBase64: out.slice(0, k).toString('base64') };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  },
  playIndex: async (idx = 0) => {
    try {
      const i = Math.floor(Number(idx)||0);
      if (i < 0 || i >= state.playlist.length) return { ok: false, error: 'index out of range' };
      state.currentIndex = i;
      const meta = state.playlist[i];
      const g = await functions.getPlayUrl(meta, 'standard');
      if (!g || !g.ok || !g.url) return { ok: false, error: g?.error || 'resolve failed' };
      await functions.setBackgroundMusic({ music: g.url, album: meta.cover, title: meta.title, artist: meta.artist, id: meta.id, source: meta.source });
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
      if (payload.type === 'update' && payload.target === 'floatingUrl') {
        state.currentFloatingUrl = payload.value || null;
      }
      if (payload.type === 'click') {
        if (payload.id === 'tab-recommend') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.recommend });
          state.currentFloatingUrl = state.pages.recommend;
        } else if (payload.id === 'tab-search') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 860, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.search });
          state.currentFloatingUrl = state.pages.search;
        } else if (payload.id === 'tab-settings') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 720, height: 520 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.settings });
          state.currentFloatingUrl = state.pages.settings;
        } else if (payload.id === 'tab-about') {
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: 'center' });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingBounds', value: { width: 640, height: 400 } });
          pluginApi.emit(state.eventChannel, { type: 'update', target: 'floatingUrl', value: state.pages.about });
          state.currentFloatingUrl = state.pages.about;
        } else if (payload.id === 'btn-bgmode') {
          try { pluginApi.emit(state.eventChannel, { type: 'update', target: 'bgModePanel', value: 'toggle' }); } catch {}
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
