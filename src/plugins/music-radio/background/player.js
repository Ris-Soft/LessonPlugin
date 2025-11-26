window.addEventListener('DOMContentLoaded', () => {
  const params = new URL(location.href).searchParams;
  const musicUrl = params.get('music') || '';
  const albumUrl = params.get('album') || '';
  const title = params.get('title') || '';
  const artist = params.get('artist') || '';
  const audioBar = document.getElementById('audioBar');
  const audio = document.getElementById('audio');
  const audioCover = document.getElementById('audioCover');
  const audioTitle = document.getElementById('audioTitle');
  const audioArtist = document.getElementById('audioArtist');
  const progressBar = document.getElementById('audioProgressBar');
  const progress = document.getElementById('audioProgress');
  const progressDot = document.getElementById('audioProgressDot');
  const bgRule = document.getElementById('bgRule');
  const musicId = params.get('id') || '';
  const lyricsLoading = document.getElementById('lyricsLoading');
  const songLoading = document.getElementById('songLoading');
  const musicSource = params.get('source') || '';
  const biliFloat = document.getElementById('biliVideoFloat');
  const biliVideo = document.getElementById('biliVideo');
  const biliToolbar = document.getElementById('biliToolbar');
  const biliCollapseBtn = document.getElementById('biliCollapseBtn');
  const biliExpandBtn = document.getElementById('biliExpandBtn');
  const bgModePanel = document.getElementById('bgModePanel');
  let biliMode = localStorage.getItem('radio.biliVideo.mode') || 'float';
  function applyBiliMode(){ try {
    if (!biliFloat || !biliToolbar) return;
    if (musicSource !== 'bili') { biliFloat.style.display = 'none'; biliToolbar.style.display = 'none'; return; }
    const nowLeft = document.querySelector('.now-left');
    const lyr = document.getElementById('lyrics');
    biliToolbar.style.display = 'flex';
    if (biliMode === 'hidden') {
      biliFloat.style.display = 'none';
      biliFloat.classList.remove('expand');
      biliToolbar.classList.remove('overlay');
      if (nowLeft) nowLeft.style.display = '';
      if (lyr) lyr.style.display = '';
      if (biliCollapseBtn) biliCollapseBtn.innerHTML = '<i class="ri-add-line"></i> 展开';
      if (biliExpandBtn) biliExpandBtn.innerHTML = '<i class="ri-expand-diagonal-line"></i> 放大';
    } else if (biliMode === 'expand') {
      biliFloat.style.display = 'block';
      biliFloat.classList.add('expand');
      biliToolbar.classList.add('overlay');
      if (nowLeft) nowLeft.style.display = 'none';
      if (lyr) lyr.style.display = 'none';
      if (biliExpandBtn) biliExpandBtn.innerHTML = '<i class="ri-contract-left-right-line"></i> 缩小';
      if (biliCollapseBtn) biliCollapseBtn.innerHTML = '<i class="ri-subtract-line"></i> 收起';
    } else {
      biliFloat.style.display = 'block';
      biliFloat.classList.remove('expand');
      biliToolbar.classList.remove('overlay');
      if (nowLeft) nowLeft.style.display = '';
      if (lyr) lyr.style.display = '';
      if (biliCollapseBtn) biliCollapseBtn.innerHTML = '<i class="ri-subtract-line"></i> 收起';
      if (biliExpandBtn) biliExpandBtn.innerHTML = '<i class="ri-expand-diagonal-line"></i> 放大';
    }
  } catch {} }
  function setBiliMode(m){ biliMode = m; try { localStorage.setItem('radio.biliVideo.mode', biliMode); } catch {} applyBiliMode(); }
  if (musicUrl) {
    audio.src = musicUrl;
    audioBar.style.display = 'flex';
    audioCover.src = albumUrl || '';
    audioTitle.textContent = title || '';
    audioArtist.textContent = artist || '';
    if (songLoading) songLoading.style.display = 'flex';
    try { audio.play(); } catch { }
    try { updateFullscreenStyles(); let tries = 0; const tmr = setInterval(() => { updateFullscreenStyles(); if (++tries >= 10) clearInterval(tmr); }, 100); } catch { }
    if (musicSource === 'bili' && biliFloat && biliVideo) {
      biliFloat.style.display = 'block';
      try { biliVideo.src = musicUrl; biliVideo.muted = true; biliVideo.play(); } catch { }
      applyBiliMode();
    } else {
      if (biliFloat) biliFloat.style.display = 'none';
      if (biliToolbar) biliToolbar.style.display = 'none';
    }
  }
  function applyBlurBackground(urlStr) {
    if (!bgRule) return;
    bgRule.textContent = `body::before{content:'';position:absolute;inset:0;background:url(${urlStr}) center/cover;filter:blur(${28}px) brightness(${0.6});z-index:-1;}`;
    const ex = document.getElementById('EX_background_fluentShine'); if (ex) ex.remove();
    const st = document.getElementById('EX_background_fluentShine_style'); if (st) st.remove();
  }
  function applyFluentShine(urlStr) {
    if (bgRule) bgRule.textContent = '';
    let ex = document.getElementById('EX_background_fluentShine');
    if (!ex) {
      ex = document.createElement('div');
      ex.id = 'EX_background_fluentShine';
      ex.style.position = 'absolute';
      ex.style.inset = '0';
      ex.style.zIndex = '-1';
      document.body.appendChild(ex);
      for (let i = 1; i <= 4; i++) {
        const d = document.createElement('div');
        d.className = 'fluentShine';
        d.style.position = 'absolute';
        d.style.width = '50%';
        d.style.height = '50%';
        if (i === 1) { d.style.top = '0'; d.style.left = '0'; }
        else if (i === 2) { d.style.top = '0'; d.style.right = '0'; }
        else if (i === 3) { d.style.bottom = '0'; d.style.left = '0'; }
        else { d.style.bottom = '0'; d.style.right = '0'; }
        ex.appendChild(d);
      }
    }
    let style = document.getElementById('EX_background_fluentShine_style');
    if (!style) { style = document.createElement('style'); style.id = 'EX_background_fluentShine_style'; document.head.appendChild(style); }
    const blurPx = Number(localStorage.getItem('radio.bg.blur') || 70);
    const dark = Number(localStorage.getItem('radio.bg.dark') || 0.6);
    style.textContent = `#EX_background_fluentShine:before{content:'';position:absolute;inset:0;background:url(${urlStr}) center/cover;filter:blur(${blurPx}px) brightness(${dark});z-index:-1;}
    .fluentShine:before{content:'';position:absolute;inset:0;background:url(${urlStr}) center/cover;filter:blur(${blurPx}px) brightness(${dark});z-index:-1;}
    @keyframes rotate-clockwise{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    @keyframes rotate-counterclockwise{from{transform:rotate(0deg)}to{transform:rotate(-360deg)}}
    .fluentShine:nth-child(1){animation:rotate-clockwise 15s linear infinite}
    .fluentShine:nth-child(2){animation:rotate-counterclockwise 12s linear infinite}
    .fluentShine:nth-child(3){animation:rotate-clockwise 18s linear infinite}
    .fluentShine:nth-child(4){animation:rotate-counterclockwise 14s linear infinite}`;
  }
  const bgMode = (localStorage.getItem('radio.bgmode') || 'blur');
  if (albumUrl) { if (bgMode === 'shine') applyFluentShine(albumUrl); else applyBlurBackground(albumUrl); }
  function applyBackgroundCurrent(){ try { const src = document.getElementById('audioCover')?.src || albumUrl || ''; if (!src) return; const mode = localStorage.getItem('radio.bgmode') || 'blur'; if (mode === 'shine') applyFluentShine(src); else applyBlurBackground(src); } catch {} }
  async function renderLyricsForKuwo(id) {
    try {
      const le = document.getElementById('lyrics'); if (le) le.textContent = '';
      if (lyricsLoading) lyricsLoading.style.display = 'flex';
      const r = await window.lowbarAPI.pluginCall('radio.music', 'fetchKuwoLyrics', [id, true]);
      const data = r && r.result ? r.result : r;
      if (!data || !data.ok || !data.dataBase64) return;
      const bin = atob(String(data.dataBase64 || ''));
      const arr = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      let text = '';
      try { text = new TextDecoder('gb18030', { fatal: false }).decode(arr); } catch { text = new TextDecoder('utf-8').decode(arr); }
      const yrc = lrcxToYrcArr(text);
      mountYrc2(yrc);
    } catch { }
    finally { if (lyricsLoading) lyricsLoading.style.display = 'none'; }
  }
  function lrcxToYrcArr(krc) { const lines = String(krc || '').split('\n').filter(l => l.trim()); const yrc = []; let w = 0; for (const line of lines) { const m = line.match(/^\[(\d+):(\d+)\.(\d+)\](.*)/); if (!m) { const mk = line.match(/^\[kuwo:(\d+)\]/); if (mk) { w = parseInt(mk[1], 8) || 0; } continue; } const minutes = parseInt(m[1], 10), seconds = parseInt(m[2], 10), ms = parseInt(String(m[3]).padEnd(3, '0'), 10); const ts = minutes * 60000 + seconds * 1000 + ms; const content = m[4]; const words = []; const re = /<(\d+),(-?\d+)>([^<]*)/g; let mm; const k1 = Math.floor(w / 10), k2 = w % 10; while ((mm = re.exec(content))) { const v1 = parseInt(mm[1], 10), v2 = parseInt(mm[2], 10); const start = (v1 + v2) / (k1 * 2); const dur = (v1 - v2) / (k2 * 2); words.push({ t: ts + start, d: dur, tx: mm[3] }); } let ld = 0; if (words.length) { const last = words[words.length - 1]; ld = last.t + last.d - ts; } yrc.push({ t: ts, d: ld, c: words }); } return yrc; }
  function isCJK(s) { return /[\u3400-\u9FFF]/.test(String(s || '')); }
  function isPunc(s) { return /^[\s\.,!\?;:\-–—·、，。！？；：…()（）\[\]\{\}]+$/.test(String(s || '')); }
  function needSpace(a, b) { return !isPunc(a) && !isPunc(b) && !isCJK(a) && !isCJK(b); }
  function hasLatin(s) { return /[A-Za-z]/.test(String(s || '')); }
  function mountYrc2(yrc) { const el = document.getElementById('lyrics'); if (!el) return; el.innerHTML = ''; const AUTO_SCROLL_PAUSE_MS = 4000; const sorted = Array.isArray(yrc) ? yrc.slice().sort((a, b) => (parseInt(a.t || 0, 10) || 0) - (parseInt(b.t || 0, 10) || 0)) : []; function makeRow(line, kind) { const row = document.createElement('div'); row.className = 'row ' + kind; row.style.whiteSpace = 'normal'; row.style.opacity = '0.9'; line.c.forEach((w, i) => { const s = document.createElement('span'); s.textContent = w.tx; s.dataset.t = w.t; s.dataset.d = w.d; s.style.transition = `opacity ${Math.max(0, w.d)}ms ease-out`; s.style.opacity = '0.55'; s.style.display = 'inline'; row.appendChild(s); const next = line.c[i + 1]; if (next && needSpace(w.tx, next.tx)) row.appendChild(document.createTextNode(' ')); }); return row; } const CLUSTER_MS = 600; let i = 0; while (i < sorted.length) { const start = parseInt(sorted[i].t || 0, 10) || 0; const cluster = []; let j = i; while (j < sorted.length) { const tt = parseInt(sorted[j].t || 0, 10) || 0; if (tt - start <= CLUSTER_MS) { cluster.push(sorted[j]); j++; } else break; } let origin = cluster[0]; let trans = null; if (cluster.length >= 2) { const types = cluster.map(l => ({ l, cjk: l.c.some(w => isCJK(w.tx)), lat: l.c.some(w => hasLatin(w.tx)) })); const nonCjk = types.find(x => !x.cjk && x.lat); const cjk = types.find(x => x.cjk); if (nonCjk && cjk) { origin = nonCjk.l; trans = cjk.l; } else { origin = cluster[0]; trans = cluster[1]; } } const c = document.createElement('div'); c.className = 'line'; c.dataset.t = String(origin.t); let dmax = parseInt(origin.d || '0', 10) || 0; if (trans) dmax = Math.max(dmax, parseInt(trans.d || '0', 10) || 0); c.dataset.d = String(dmax); const r1 = makeRow(origin, 'origin'); c.appendChild(r1); if (trans) { const r2 = makeRow(trans, 'trans'); r2.style.marginTop = '2px'; c.appendChild(r2); } else { c.classList.add('single'); } c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch { } }; el.appendChild(c); const leftovers = cluster.filter(l => l !== origin && l !== trans); leftovers.forEach((ln) => { const sc = document.createElement('div'); sc.className = 'line single'; sc.dataset.t = String(ln.t); sc.dataset.d = String(parseInt(ln.d || '0', 10) || 0); const r = makeRow(ln, 'origin'); sc.appendChild(r); sc.onclick = () => { try { audio.currentTime = (parseInt(sc.dataset.t || '0', 10)) / 1000; } catch { } }; el.appendChild(sc); }); i = j; } let userScrollTs = 0; let touchStartY = 0; el.addEventListener('wheel', () => { userScrollTs = Date.now(); }); el.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length === 1) { touchStartY = e.touches[0].clientY; } }); el.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length === 1) { const dy = Math.abs(e.touches[0].clientY - touchStartY); if (dy > 5) userScrollTs = Date.now(); } }); function update() { const t = audio.currentTime * 1000; const lines = Array.from(el.querySelectorAll('.line')); let active = null; for (let k = 0; k < lines.length; k++) { const c = lines[k]; const lt = parseInt(c.dataset.t || '0', 10); const ld = parseInt(c.dataset.d || '0', 10); if (t >= lt && t < lt + ld) { active = c; break; } } lines.forEach((c) => { const rows = c.querySelectorAll('.row'); const isActive = (c === active); rows.forEach((row) => { row.style.opacity = isActive ? '1' : '0.7'; const spans = row.querySelectorAll('span'); spans.forEach((s) => { const st = parseInt(s.dataset.t || '0', 10); const sd = parseInt(s.dataset.d || '0', 10); const se = st + sd; if (isActive && t >= st && t < se) { s.style.opacity = '1'; } else if (isActive && t >= se) { s.style.opacity = '1'; } else { s.style.opacity = '0.5'; } }); }); }); if (active && (Date.now() - userScrollTs > AUTO_SCROLL_PAUSE_MS)) { const rect = active.getBoundingClientRect(); const mid = rect.top + (rect.height / 2); const viewMid = window.innerHeight * 0.42; const dy = mid - viewMid; try { el.scrollTo({ top: el.scrollTop + dy, behavior: 'smooth' }); } catch { el.scrollTop += dy; } } } audio.addEventListener('timeupdate', update); }
  function mountYrc(yrc) { const el = document.getElementById('lyrics'); if (!el) return; el.innerHTML = ''; yrc.forEach((line) => { const c = document.createElement('div'); c.className = 'line'; c.dataset.t = line.t; c.dataset.d = line.d; const row = document.createElement('div'); row.style.whiteSpace = 'normal'; row.style.opacity = '0.9'; line.c.forEach((w, i) => { const s = document.createElement('span'); s.textContent = w.tx; s.dataset.t = w.t; s.dataset.d = w.d; s.style.transition = `opacity ${Math.max(0, w.d)}ms ease-out`; s.style.opacity = '0.55'; s.style.display = 'inline'; row.appendChild(s); if (i < line.c.length - 1) row.appendChild(document.createTextNode(' ')); }); c.appendChild(row); c.onclick = () => { try { audio.currentTime = (parseInt(c.dataset.t || '0', 10)) / 1000; } catch { } }; el.appendChild(c); }); let userScrollTs = 0; let touchStartY = 0; el.addEventListener('wheel', () => { userScrollTs = Date.now(); }); el.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length === 1) { touchStartY = e.touches[0].clientY; } }); el.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length === 1) { const dy = Math.abs(e.touches[0].clientY - touchStartY); if (dy > 5) userScrollTs = Date.now(); } }); function update() { const t = audio.currentTime * 1000; const lines = Array.from(el.querySelectorAll('.line')); let active = null; for (let i = 0; i < lines.length; i++) { const c = lines[i]; const lt = parseInt(c.dataset.t || '0', 10); const ld = parseInt(c.dataset.d || '0', 10); if (t >= lt && t < lt + ld) { active = c; break; } } lines.forEach((c) => { const lt = parseInt(c.dataset.t || '0', 10); const ld = parseInt(c.dataset.d || '0', 10); const row = c.firstChild; const isActive = (c === active); row.style.opacity = isActive ? '1' : '0.7'; const spans = row.querySelectorAll('span'); spans.forEach((s) => { const st = parseInt(s.dataset.t || '0', 10); const sd = parseInt(s.dataset.d || '0', 10); const se = st + sd; if (isActive && t >= st && t < se) { s.style.opacity = '1'; } else if (isActive && t >= se) { s.style.opacity = '1'; } else { s.style.opacity = '0.5'; } }); }); if (active && (Date.now() - userScrollTs > 250)) { const rect = active.getBoundingClientRect(); const mid = rect.top + (rect.height / 2); const viewMid = (window.innerHeight / 2); const dy = mid - viewMid; const el2 = document.getElementById('lyrics'); el2.scrollTop += dy; } } audio.addEventListener('timeupdate', update); }
  if (musicId && musicSource === 'kuwo') renderLyricsForKuwo(musicId);
  function formatTime(sec) { if (!sec) return '0:00'; const s = Math.floor(sec); const m = Math.floor(s / 60); const r = s % 60; return `${m}:${String(r).padStart(2, '0')}`; }
  const progressCurrent = document.getElementById('progressCurrent');
  const progressDuration = document.getElementById('progressDuration');
  function updateProgress() { if (!audio || !audio.duration) return; const pct = (audio.currentTime / audio.duration); progress.style.width = `${pct * 100}%`; progressDot.style.left = `${pct * 100}%`; if (progressCurrent) progressCurrent.textContent = formatTime(audio.currentTime); if (progressDuration) progressDuration.textContent = formatTime(audio.duration); }
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('canplay', () => { if (songLoading) songLoading.style.display = 'none'; });
  audio.addEventListener('waiting', () => { if (songLoading) songLoading.style.display = 'flex'; });
  audio.addEventListener('play', () => { if (biliVideo && musicSource === 'bili') { try { biliVideo.play(); } catch { } } });
  audio.addEventListener('pause', () => { if (biliVideo && musicSource === 'bili') { try { biliVideo.pause(); } catch { } } });
  audio.addEventListener('timeupdate', () => { if (biliVideo && musicSource === 'bili') { try { const dt = Math.abs((biliVideo.currentTime||0) - (audio.currentTime||0)); if (dt > 0.5) biliVideo.currentTime = audio.currentTime; } catch { } } });
  if (biliCollapseBtn) biliCollapseBtn.onclick = () => { setBiliMode(biliMode === 'hidden' ? 'float' : 'hidden'); };
  if (biliExpandBtn) biliExpandBtn.onclick = () => { setBiliMode(biliMode === 'expand' ? 'float' : 'expand'); };
  try { if (bgModePanel) { const items = bgModePanel.querySelectorAll('.bgmode-item'); items.forEach((el) => { el.onclick = () => { try { const m = el.dataset.mode || 'blur'; localStorage.setItem('radio.bgmode', m); bgModePanel.style.display = 'none'; applyBackgroundCurrent(); } catch {} }; }); } } catch {}
  let isDragging = false;
  function seekByClientX(x){ if (!audio.duration) return; const rect = progressBar.getBoundingClientRect(); const pct = Math.max(0, Math.min(1, (x - rect.left) / rect.width)); audio.currentTime = pct * audio.duration; }
  if (progressBar) {
    progressBar.addEventListener('click', (e) => { if (!audio.duration) return; const rect = progressBar.getBoundingClientRect(); const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)); audio.currentTime = pct * audio.duration; });
    progressBar.addEventListener('mousedown', (e) => { isDragging = true; seekByClientX(e.clientX); });
    window.addEventListener('mousemove', (e) => { if (isDragging) seekByClientX(e.clientX); });
    window.addEventListener('mouseup', () => { isDragging = false; });
    progressBar.addEventListener('touchstart', (e) => { if (e.touches && e.touches.length) { isDragging = true; seekByClientX(e.touches[0].clientX); } });
    window.addEventListener('touchmove', (e) => { if (isDragging && e.touches && e.touches.length) { seekByClientX(e.touches[0].clientX); } });
    window.addEventListener('touchend', () => { isDragging = false; });
  }
  audio.addEventListener('ended', async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'nextTrack', ['ended']); } catch { } });
  async function loadPlaylist() {
    try {
      const r = await window.lowbarAPI.pluginCall('radio.music', 'getPlaylist', []);
      const data = r && r.result ? r.result : r;
      const listEl = document.getElementById('playlist');
      const totalEl = document.getElementById('playlistTotal');
      const empty = document.getElementById('emptyOverlay');
      if (!data || !listEl || !Array.isArray(data.items)) return;
      listEl.innerHTML = '';
      const fmt = (s) => { const n = Math.floor(Number(s) || 0); const m = Math.floor(n / 60); const r = n % 60; return `${m}:${String(r).padStart(2, '0')}`; };
      data.items.forEach((it, idx) => { const row = document.createElement('div'); row.className = 'item'; const name = document.createElement('div'); name.textContent = `${it.title || ''}`; const dur = document.createElement('div'); dur.textContent = fmt(it.duration || 0); row.appendChild(name); row.appendChild(dur); if (idx === data.currentIndex) row.classList.add('active'); row.onclick = async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'playIndex', [idx]); } catch { } }; let pressTimer = null; row.addEventListener('mousedown', () => { pressTimer = setTimeout(async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'removeIndex', [idx]); } catch { } }, 600); }); row.addEventListener('mouseup', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }); row.addEventListener('mouseleave', () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } }); listEl.appendChild(row); }); try { const tt = document.getElementById('playlistTotalText'); if (tt) tt.textContent = `总时长：${fmt(data.totalSecs || 0)}`; } catch { } try { const finEl = document.getElementById('playlistFinish'); if (finEl) { const startIdx = Math.max(0, data.currentIndex || 0); const remainList = Array.isArray(data.items) ? data.items.slice(startIdx) : []; const remainSecs = Math.max(0, remainList.reduce((acc, it) => acc + (Number(it.duration) || 0), 0) - Math.floor(Number(audio.currentTime) || 0)); const dt = new Date(Date.now() + remainSecs * 1000); const hh = String(dt.getHours()).padStart(2, '0'); const mm = String(dt.getMinutes()).padStart(2, '0'); finEl.textContent = `预计播完：${hh}:${mm}`; } } catch { } if (empty) empty.style.display = (data.items.length === 0) ? 'flex' : 'none'; if (!musicUrl && data.items.length > 0) { const last = data.items[data.items.length - 1]; try { if (last) { document.getElementById('audioCover').src = last.cover || ''; document.getElementById('audioTitle').textContent = last.title || ''; document.getElementById('audioArtist').textContent = last.artist || ''; } } catch { } }
    } catch { }
  }
  let lastFinishUpdateTs = 0;
  async function updateFinishEstimate() { try { const finEl = document.getElementById('playlistFinish'); if (!finEl) return; if (Date.now() - lastFinishUpdateTs < 3000) return; lastFinishUpdateTs = Date.now(); const r = await window.lowbarAPI.pluginCall('radio.music', 'getPlaylist', []); const data = r && r.result ? r.result : r; if (!data || !Array.isArray(data.items)) return; const startIdx = Math.max(0, data.currentIndex || 0); const remainList = data.items.slice(startIdx); const remainSecs = Math.max(0, remainList.reduce((acc, it) => acc + (Number(it.duration) || 0), 0) - Math.floor(Number(audio.currentTime) || 0)); const dt = new Date(Date.now() + remainSecs * 1000); const hh = String(dt.getHours()).padStart(2, '0'); const mm = String(dt.getMinutes()).padStart(2, '0'); finEl.textContent = `预计播完：${hh}:${mm}`; } catch { } }
  try { audio.addEventListener('timeupdate', updateFinishEstimate); } catch { }
  loadPlaylist();
  try { const ch = new URL(location.href).searchParams.get('channel'); if (ch) { window.lowbarAPI.subscribe?.(ch); window.lowbarAPI.onEvent?.((name, payload) => { if (name === ch && payload && payload.type === 'update') { if (payload.target === 'playlist') { loadPlaylist(); try { applyBackgroundCurrent(); } catch {} (async () => { try { const r2 = await window.lowbarAPI.pluginCall('radio.music', 'getPlaylist', []); const d2 = r2 && r2.result ? r2.result : r2; if (d2 && Array.isArray(d2.items) && d2.currentIndex >= 0) { const cur = d2.items[d2.currentIndex]; const le = document.getElementById('lyrics'); if (cur && cur.id && cur.source === 'kuwo') { await renderLyricsForKuwo(cur.id); } else { if (le) le.textContent = ''; } } } catch { } })(); } else if (payload.target === 'songLoading') { try { const x = document.getElementById('songLoading'); if (x) x.style.display = (payload.value === 'show') ? 'flex' : 'none'; } catch { } } else if (payload.target === 'bgModePanel') { try { if (!bgModePanel) return; const v = String(payload.value||''); if (v === 'toggle') { const cur = bgModePanel.style.display; bgModePanel.style.display = (!cur || cur==='none') ? 'flex' : 'none'; } else if (v === 'show') bgModePanel.style.display = 'flex'; else if (v === 'hide') bgModePanel.style.display = 'none'; } catch {} } } }); } } catch { }
  try { const toggle = document.getElementById('removeAfterPlay'); async function initToggle() { try { const r = await window.lowbarAPI.pluginCall('radio.music', 'getSettings', []); const d = r && r.result ? r.result : r; const cur = !!(d && d.settings && d.settings.removeAfterPlay); if (toggle) toggle.checked = cur; } catch { } } function persistLocal() { try { if (toggle) localStorage.setItem('radio.removeAfterPlay', toggle.checked ? '1' : '0'); } catch { } } if (toggle) { initToggle(); toggle.addEventListener('change', async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'setRemoveAfterPlay', [toggle.checked]); persistLocal(); } catch { } }); } } catch { }
  try { const addBtn = document.getElementById('playlistAddBtn'); if (addBtn) addBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'onLowbarEvent', [{ type: 'click', id: 'tab-search' }]); } catch { } }; } catch { }
  const prevBtn = document.getElementById('audioPrevBtn');
  const nextBtn = document.getElementById('audioNextBtn');
  const playBtn = document.getElementById('audioPlayBtn');
  if (prevBtn) prevBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'prevTrack', []); } catch { } };
  if (nextBtn) nextBtn.onclick = async () => { try { await window.lowbarAPI.pluginCall('radio.music', 'nextTrack', ['manual']); } catch { } };
  if (playBtn) { playBtn.onclick = () => { try { if (audio.paused) { audio.play(); playBtn.innerHTML = '<i class="ri-pause-fill"></i>'; } else { audio.pause(); playBtn.innerHTML = '<i class="ri-play-fill"></i>'; } } catch { } }; audio.addEventListener('play', () => { playBtn.innerHTML = '<i class="ri-pause-fill"></i>'; }); audio.addEventListener('pause', () => { playBtn.innerHTML = '<i class="ri-play-fill"></i>'; }); }
  try { audio.addEventListener('play', updateFullscreenStyles); } catch { }
});
function updateFullscreenStyles() { try { const fsMatch = (window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches); const fs = !!document.fullscreenElement || fsMatch || (window.innerHeight >= (screen.availHeight - 1)); const bar = document.getElementById('audioBar'); if (bar) bar.style.bottom = fs ? '96px' : '16px'; const content = document.querySelector('.content-area'); if (bar && content) { const rect = bar.getBoundingClientRect(); const barH = Math.max(64, Math.floor(rect.height || 64)); const barBottomPx = parseInt(String(bar.style.bottom || '16').replace('px', ''), 10) || 16; const padding = 16; const offset = barBottomPx + barH + padding; content.style.bottom = `${offset}px`; } } catch { } }
updateFullscreenStyles();
window.addEventListener('resize', updateFullscreenStyles);
document.addEventListener('fullscreenchange', updateFullscreenStyles);
try { setInterval(updateFullscreenStyles, 1500); } catch { }
