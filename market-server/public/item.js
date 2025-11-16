function qs(key) {
  const u = new URL(location.href);
  return u.searchParams.get(key) || '';
}
async function load() {
  const type = (qs('type') || 'plugin').toLowerCase();
  const id = qs('id') || '';
  const catalogRes = await fetch('/api/market/catalog');
  const catalog = await catalogRes.json();
  const arr = type === 'automation' ? (catalog.automation || []) : (type === 'component' || type === 'components' ? (catalog.components || []) : (catalog.plugins || []));
  const item = arr.find((x) => String(x.id || x.name) === id);
  const icon = item?.icon || (type === 'automation' ? 'ri-timer-line' : type === 'components' ? 'ri-layout-grid-line' : 'ri-puzzle-line');
  const name = item?.name || id;
  const desc = item?.description || '';
  document.getElementById('icon').className = icon;
  document.getElementById('name').textContent = name;
  document.getElementById('desc').textContent = desc;
  const actionsEl = document.getElementById('actions');
  actionsEl.innerHTML = `<button id="openInAppBtn" class="btn primary"><i class="ri-external-link-line"></i> 在 LessonPlugin 中查看</button> <a href="/" class="btn secondary"><i class="ri-arrow-left-line"></i> 返回市场</a>`;
  const openBtn = document.getElementById('openInAppBtn');
  if (openBtn) openBtn.addEventListener('click', () => {
    const url = `LessonPlugin://market?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`;
    let ok = false;
    try { location.href = url; ok = true; } catch {}
    try { if (!ok) { window.open(url, '_self'); ok = true; } } catch {}
    const iframe = document.createElement('iframe');
    iframe.style.display = 'none';
    iframe.src = url;
    document.body.appendChild(iframe);
    setTimeout(async () => {
      try { iframe.remove(); } catch {}
      if (!ok) {
        try { await navigator.clipboard.writeText(url); } catch {}
        const tc = document.querySelector('.toast-container') || (() => { const el = document.createElement('div'); el.className = 'toast-container'; document.body.appendChild(el); return el; })();
        const t = document.createElement('div');
        t.className = 'toast toast-info';
        t.textContent = '无法直接打开主程序，已复制链接到剪贴板';
        tc.appendChild(t);
        requestAnimationFrame(() => t.classList.add('show'));
        setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 200); }, 2500);
      }
    }, 600);
  });
  const pluginDepsEl = document.getElementById('pluginDeps');
  const depsArr = Array.isArray(item?.dependencies) ? item.dependencies : [];
  pluginDepsEl.innerHTML = depsArr.length ? depsArr.map(d => `<span class="pill small">${d}</span>`).join(' ') : '<span class="muted">无依赖</span>';
  const npmDepsEl = document.getElementById('npmDeps');
  const npmObj = (item && typeof item.npmDependencies === 'object' && item.npmDependencies) ? item.npmDependencies : null;
  npmDepsEl.innerHTML = (npmObj && Object.keys(npmObj).length) ? Object.keys(npmObj).map(n => `<span class="pill small">${n}${npmObj[n] ? '@'+npmObj[n] : ''}</span>`).join(' ') : '<span class="muted">无依赖</span>';
  const readmeEl = document.getElementById('readme');
  let baseReadme = null;
  if (item?.readme) baseReadme = item.readme;
  else if (item?.id) baseReadme = type === 'automation' ? `/data/automation/${item.id}/README.md` : `/data/plugins/${item.id}/README.md`;
  if (baseReadme) {
    try {
      const res = await fetch(baseReadme);
      if (res.ok) {
        const text = await res.text();
        readmeEl.innerHTML = `<div class="muted">说明</div><pre style="white-space:pre-wrap;word-break:break-word;">${text}</pre>`;
      }
    } catch {}
  }
}
load();