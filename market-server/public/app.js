const statusEl = document.getElementById('status');
const editorEl = document.getElementById('editor');
const listEl = document.getElementById('list');
const storeSubnavEl = document.getElementById('store-subnav');
const storeGridEl = document.getElementById('store-grid');
const authBox = document.getElementById('authBox');
let currentType = 'plugins';

function setStatus(text, ok = true) {
  statusEl.textContent = text;
  statusEl.style.color = ok ? '#2f6f2f' : '#b00020';
}

function showPage(id) {
  document.querySelectorAll('main > section').forEach((s) => s.classList.add('hidden'));
  const el = document.getElementById('page-' + id);
  if (el) el.classList.remove('hidden');
}

function setActiveTopNav(id) {
  document.querySelectorAll('.topnav-item').forEach((a) => {
    if (a.getAttribute('data-nav') === id) a.classList.add('active'); else a.classList.remove('active');
  });
}
document.querySelectorAll('[data-nav]').forEach((btn) => {
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    const id = btn.getAttribute('data-nav');
    showPage(id);
    setActiveTopNav(id);
    if (id === 'home') initHome();
    if (id === 'market') initMarket();
    if (id === 'dev') initDev();
    location.hash = '#' + id;
  });
});

async function loadData() {
  try {
    setStatus('加载中…');
    const res = await fetch('/api/market');
    const data = await res.json();
    editorEl.value = JSON.stringify(data, null, 2);
    renderList(data);
    setStatus('加载完成');
  } catch (e) {
    setStatus('加载失败: ' + String(e), false);
  }
}

function tryParse() {
  try { return JSON.parse(editorEl.value); } catch { return null; }
}

function renderList(data) {
  const list = Array.isArray(data.items) ? data.items : (Array.isArray(data.plugins) ? data.plugins : []);
  if (!Array.isArray(list)) {
    listEl.innerHTML = '<em>未检测到 items 或 plugins 列表</em>';
    return;
  }
  listEl.innerHTML = list.map((item, idx) => {
    const name = item.name || item.title || item.id || ('#' + idx);
    const desc = item.description || item.desc || '';
    return `<div class="item"><strong>${name}</strong><div>${desc}</div></div>`;
  }).join('');
}

async function saveData() {
  const data = tryParse();
  if (!data) {
    setStatus('JSON 解析失败，请检查语法。', false);
    return;
  }
  try {
    setStatus('保存中…');
    const res = await fetch('/api/market', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const r = await res.json();
    if (r && r.ok) {
      setStatus('已保存');
      renderList(data);
    } else {
      setStatus('保存失败: ' + JSON.stringify(r), false);
    }
  } catch (e) {
    setStatus('保存异常: ' + String(e), false);
  }
}

function formatJson() {
  const data = tryParse();
  if (!data) {
    setStatus('无法格式化：当前 JSON 不合法。', false);
    return;
  }
  editorEl.value = JSON.stringify(data, null, 2);
  setStatus('已格式化');
}

document.getElementById('btnLoad').addEventListener('click', loadData);
document.getElementById('btnSave').addEventListener('click', saveData);
document.getElementById('btnFormat').addEventListener('click', formatJson);

async function initMarket() {
  try {
    const catsRes = await fetch('/api/market/categories');
    const cats = await catsRes.json();
    const catalogRes = await fetch('/api/market/catalog');
    let catalog = await catalogRes.json();
    const tabs = document.querySelectorAll('#page-market .store-tabs .sub-item');
    let currentTab = 'comprehensive';
    tabs.forEach((b) => b.addEventListener('click', () => {
      tabs.forEach((x) => x.classList.remove('active'));
      b.classList.add('active');
      currentTab = b.getAttribute('data-store-tab');
      buildCats();
      render('all');
    }));
    function buildCats() {
      const t = currentTab === 'comprehensive' ? currentType : currentTab;
      storeSubnavEl.innerHTML = '';
      if (t === 'comprehensive' || t === 'updates') { storeSubnavEl.hidden = true; return; }
      storeSubnavEl.hidden = false;
      const list = (cats[t] || []).filter((x) => x.id !== 'all');
      const arr = [{ id: 'all', label: '全部' }, ...list];
      const frag = document.createDocumentFragment();
      arr.forEach((c) => {
        const chip = document.createElement('span');
        chip.className = 'chip' + (c.id === 'all' ? ' selected' : '');
        chip.dataset.sub = c.id;
        chip.innerHTML = `<i class="${c.icon || 'ri-apps-2-line'}"></i> ${c.label}`;
        chip.addEventListener('click', () => {
          // 选中态
          storeSubnavEl.querySelectorAll('.chip').forEach((x) => x.classList.remove('selected'));
          chip.classList.add('selected');
          render(c.id);
        });
        frag.appendChild(chip);
      });
      storeSubnavEl.appendChild(frag);
    }
    function render(catId) {
      let items = [];
      const q = String(document.getElementById('market-search-input')?.value || '').trim().toLowerCase();
      if (currentTab === 'plugins') items = catalog.plugins || [];
      else if (currentTab === 'automation') items = catalog.automation || [];
      else if (currentTab === 'components') items = catalog.components || [];
      else if (currentTab === 'updates') items = [];
      else items = [...(catalog.plugins || []), ...(catalog.automation || []), ...(catalog.components || [])];
      if (catId && catId !== 'all') items = items.filter((x) => Array.isArray(x.categories) ? x.categories.includes(catId) : String(x.categories || '').split(',').includes(catId));
      if (q) items = items.filter((x) => ((x.name || '') + ' ' + (x.description || '')).toLowerCase().includes(q));
      storeGridEl.innerHTML = items.map((x) => {
        const type = x.type || (x.automation ? 'automation' : 'plugin');
        const icon = x.icon || (type === 'automation' ? 'ri-timer-line' : type === 'component' ? 'ri-layout-grid-line' : 'ri-puzzle-line');
        const id = x.id || x.name;
        return `<div class="plugin-card">
          <div class="card-header">
            <i class="${icon}"></i>
            <div>
              <div class="card-title">${x.name || x.id} ${x.version ? `<span class=\"pill small\">v${x.version}</span>` : ''}</div>
              <div class="card-desc">${x.description || ''}</div>
            </div>
            <div class="card-action"><a href="/item.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}" class="btn secondary"><i class="ri-information-line"></i> 详情</a></div>
          </div>
        </div>`;
      }).join('');
      document.getElementById('store-empty').hidden = items.length > 0;
    }
    buildCats();
    render('all');
    const searchBtn = document.getElementById('market-search-btn');
    if (searchBtn) searchBtn.addEventListener('click', () => render('all'));
    const searchInput = document.getElementById('market-search-input');
    if (searchInput) searchInput.addEventListener('keyup', (e) => { if (e.key === 'Enter') render('all'); });
    const refreshBtn = document.getElementById('market-refresh-btn');
    if (refreshBtn) refreshBtn.addEventListener('click', async () => { const cr = await fetch('/api/market/catalog'); catalog = await cr.json(); render('all'); });
  } catch (e) {
    storeGridEl.innerHTML = '<em class="muted">加载失败</em>';
  }
}

async function initDev() {
  try {
    const meRes = await fetch('/api/auth/me');
    const me = await meRes.json();
    if (me && me.loggedIn) {
      authBox.innerHTML = `<span class="muted">已登录：${me.user && me.user.name ? me.user.name : '用户'}</span><button id="logoutBtn" class="btn danger"><i class="ri-logout-box-line"></i> 退出登录</button>`;
      document.getElementById('logoutBtn').onclick = async () => {
        await fetch('/auth/logout', { method: 'POST' });
        initDev();
      };
    } else {
      authBox.innerHTML = `<button id="loginBtn" class="btn secondary"><i class="ri-external-link-line"></i> Casdoor 登录</button><button id="debugBtn" class="btn"><i class="ri-bug-line"></i> 调试免登录</button>`;
      document.getElementById('loginBtn').onclick = () => { location.href = '/auth/login?return=/'; };
      document.getElementById('debugBtn').onclick = async () => {
        const r = await fetch('/auth/debug', { method: 'POST' });
        if (r.ok) initDev();
      };
    }
  } catch {
    authBox.innerHTML = '';
  }
}

document.getElementById('publishForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  const payload = {
    type: f.type.value,
    id: f.id.value,
    name: f.name.value,
    version: f.version.value,
    categories: f.categories.value,
    author: f.author.value,
    icon: f.icon.value,
    description: f.description.value
  };
  try {
    const res = await fetch('/api/dev/publish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const r = await res.json();
    if (r && r.ok) setStatus('发布成功'); else setStatus('发布失败', false);
  } catch {
    setStatus('发布异常', false);
  }
});

async function initHome() {
  try {
    const box = document.getElementById('home-featured');
    const empty = document.getElementById('home-featured-empty');
    if (!box) return;
    const catalogRes = await fetch('/api/market/catalog');
    const cat = await catalogRes.json();
    const items = [...(cat.plugins || []), ...(cat.automation || []), ...(cat.components || [])];
    const featured = items.slice(0, 6);
    box.innerHTML = featured.map((x) => {
      const type = x.type || (x.automation ? 'automation' : 'plugin');
      const icon = x.icon || (type === 'automation' ? 'ri-timer-line' : type === 'component' ? 'ri-layout-grid-line' : 'ri-puzzle-line');
      const id = x.id || x.name;
      return `<div class="plugin-card">
        <div class="card-header">
          <i class="${icon}"></i>
          <div>
            <div class="card-title">${x.name || x.id} ${x.version ? `<span class=\"pill small\">v${x.version}</span>` : ''}</div>
            <div class="card-desc">${x.description || ''}</div>
          </div>
          <div class="card-action"><a href="/item.html?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}" class="btn secondary"><i class="ri-information-line"></i> 详情</a></div>
        </div>
      </div>`;
    }).join('');
    if (empty) empty.hidden = featured.length > 0;
  } catch (e) {
    const box = document.getElementById('home-featured');
    if (box) box.innerHTML = '<em class="muted">加载精选失败</em>';
  }
}

const initialPage = (location.hash.replace('#', '') || 'home');
showPage(initialPage);
setActiveTopNav(initialPage);
if (initialPage === 'home') initHome();
if (initialPage === 'market') initMarket();
if (initialPage === 'dev') initDev();
