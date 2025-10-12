async function fetchPlugins() {
  if (!window.settingsAPI) {
    return [
      { name: 'ExamplePlugin', npm: null, local: './src/plugins/example-plugin', enabled: true, icon: 'ri-puzzle-line', description: '示例插件，演示窗口与接口', actions: [ { id: 'openWindow', icon: 'ri-window-line', text: '打开窗口' }, { id: 'installNpm', icon: 'ri-download-2-line', text: '安装NPM' } ] }
    ];
  }
  return await window.settingsAPI.getPlugins();
}

function renderPlugin(item) {
  const el = document.createElement('div');
  el.className = 'plugin-card';
  const versionText = item.version ? `v${item.version}` : '未知版本';
  const actionsHtml = Array.isArray(item.actions) && item.actions.length
    ? item.actions.map(a => `<button class="action-btn" data-action="${a.id}"><i class="${a.icon || ''}"></i> ${a.text || ''}</button>`).join('')
    : '<span class="muted">无操作</span>';
  el.innerHTML = `
    <div class="card-header">
      <i class="${item.icon || 'ri-puzzle-line'}"></i>
      <div>
        <div class="card-title">${item.name} <span class="pill small plugin-version">${versionText}</span></div>
        <div class="card-desc">${item.description || ''}</div>
      </div>
      <label class="toggle">
        <input type="checkbox" ${item.enabled ? 'checked' : ''} />
        <span class="slider"></span>
      </label>
    </div>
    <div class="card-actions">
      <div class="actions-left">${actionsHtml}</div>
      <div class="actions-right"><button class="icon-btn uninstall-btn" title="卸载"><i class="ri-delete-bin-line"></i></button></div>
    </div>
  `;

  const checkbox = el.querySelector('input[type="checkbox"]');
  checkbox.addEventListener('change', async (e) => {
    const key = item.id || item.name;
    await window.settingsAPI?.togglePlugin(key, e.target.checked);
  });

  el.querySelectorAll('.action-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.dataset.action;
      const meta = (item.actions || []).find(a => a.id === act);
      // 若 actions 配置了 target（指向插件 index.js 的 functions 中的函数），则直接调用
      if (meta && typeof meta.target === 'string' && meta.target) {
        const key = item.id || item.name;
        await window.settingsAPI?.pluginCall?.(key, meta.target, Array.isArray(meta.args) ? meta.args : []);
        console.log(key, meta.target, meta.args);
        return;
      }
      // 保留内置动作：安装NPM
      if (act === 'installNpm') {
        btn.disabled = true; btn.textContent = '安装中...';
        const key = item.id || item.name;
        await window.settingsAPI?.installNpm(key);
        btn.disabled = false; btn.innerHTML = `<i class="ri-download-2-line"></i> 安装NPM`;
      }
    });
  });
  const uninstallBtn = el.querySelector('.uninstall-btn');
  uninstallBtn?.addEventListener('click', async () => {
    const res = await showModal({ title: '卸载插件', message: `确认卸载插件：${item.name}？\n这将删除其目录与相关文件。`, confirmText: '卸载', cancelText: '取消' });
    console.log('卸载插件确认结果:', res);
    if (!res) return;
    const key = item.id || item.name;
    const out = await window.settingsAPI?.uninstallPlugin?.(key);
    console.log('卸载插件结果:', out);
    if (!out?.ok) { await showAlert(`卸载失败：${out?.error || '未知错误'}`); return; }
    // 重新刷新插件列表
    const container = document.getElementById('plugins');
    const list = await fetchPlugins();
    container.innerHTML = '';
    list.forEach((p) => container.appendChild(renderPlugin(p)));
  });
  return el;
}

// 自绘提示框：Alert / Confirm
function showModal({ title = '提示', message = '', confirmText = '确定', cancelText = null }) {
  return new Promise((resolve) => {
    const old = document.querySelector('.modal-overlay');
    if (old) old.remove();
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const t = document.createElement('div'); t.className = 'modal-title'; t.textContent = title;
    const msg = document.createElement('div'); msg.className = 'modal-message'; msg.textContent = message;
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = confirmText || '确定';
    ok.addEventListener('click', () => { overlay.remove(); resolve(true); });
    actions.appendChild(ok);
    if (cancelText) {
      const cancel = document.createElement('button'); cancel.className = 'btn secondary'; cancel.textContent = cancelText;
      cancel.addEventListener('click', () => { overlay.remove(); resolve(false); });
      actions.appendChild(cancel);
    }
    box.appendChild(t); box.appendChild(msg); box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    const onKey = (e) => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); resolve(!!cancelText ? false : true); } };
    document.addEventListener('keydown', onKey);
  });
}
function showAlert(message, title = '提示') { return showModal({ title, message, confirmText: '好的' }); }
function showConfirm(message, title = '确认') { return showModal({ title, message, confirmText: '确认', cancelText: '取消' }); }

// 参数数组编辑对话框（结构化编辑，不使用广域文本框）
async function showParamsEditor(initial) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = '编辑参数数组';
    const body = document.createElement('div'); body.className = 'modal-body';
    const help = document.createElement('div'); help.className = 'muted'; help.textContent = '支持类型：字符串、数字、布尔、对象JSON、数组JSON';
    const list = document.createElement('div');
    list.className = 'array-list';
    let items = Array.isArray(initial) ? initial.map((x) => x) : [];

    const typeOfVal = (v) => {
      if (Array.isArray(v)) return 'array';
      const t = typeof v;
      return t === 'object' && v !== null ? 'object' : t; // string/number/boolean/object
    };
    const stringifyByType = (type, v) => {
      if (type === 'object' || type === 'array') return JSON.stringify(v ?? (type === 'array' ? [] : {}));
      if (type === 'boolean') return v ? 'true' : 'false';
      if (type === 'number') return String(Number(v || 0));
      return String(v ?? '');
    };
    const parseByType = (type, str) => {
      switch (type) {
        case 'string': return String(str || '');
        case 'number': { const n = Number(str); if (!Number.isFinite(n)) throw new Error('数字格式错误'); return n; }
        case 'boolean': { const s = String(str).trim().toLowerCase(); return s === 'true' || s === '1' || s === 'yes'; }
        case 'object': { const o = JSON.parse(str || '{}'); if (Array.isArray(o) || typeof o !== 'object' || o === null) throw new Error('对象必须为JSON Object'); return o; }
        case 'array': { const a = JSON.parse(str || '[]'); if (!Array.isArray(a)) throw new Error('数组必须为JSON Array'); return a; }
        default: return String(str || '');
      }
    };

    const renderItems = () => {
      list.innerHTML = '';
      items.forEach((val, i) => {
        const row = document.createElement('div'); row.className = 'array-item';
        const typeSel = document.createElement('select');
        [['string','字符串'],['number','数字'],['boolean','布尔'],['object','对象JSON'],['array','数组JSON']]
          .forEach(([v,l]) => { const o=document.createElement('option'); o.value=v; o.textContent=l; typeSel.appendChild(o); });
        const curType = typeOfVal(val);
        typeSel.value = curType === 'object' ? 'object' : (curType === 'array' ? 'array' : curType);
        const input = document.createElement('input'); input.type = 'text'; input.value = stringifyByType(typeSel.value, val);
        const del = document.createElement('button'); del.className='btn secondary'; del.innerHTML = '<i class="ri-delete-bin-line"></i>';
        del.onclick = () => { items.splice(i,1); renderItems(); };
        typeSel.onchange = () => { try { input.value = stringifyByType(typeSel.value, parseByType(typeSel.value, input.value)); } catch { input.value = stringifyByType(typeSel.value, typeSel.value==='array'?[]:{}); } };
        row.appendChild(typeSel); row.appendChild(input); row.appendChild(del);
        list.appendChild(row);
      });
    };
    renderItems();

    const addBar = document.createElement('div'); addBar.className='array-actions';
    const addBtn = document.createElement('button'); addBtn.className='btn secondary'; addBtn.innerHTML = '<i class="ri-add-line"></i> 添加参数';
    addBtn.onclick = () => { items.push(''); renderItems(); };
    addBar.appendChild(addBtn);

    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.className='btn secondary'; cancel.textContent='取消';
    cancel.onclick = () => { document.body.removeChild(overlay); resolve(null); };
    const save = document.createElement('button'); save.className='btn primary'; save.textContent='保存';
    save.onclick = async () => {
      try {
        const result = [];
        for (const row of Array.from(list.children)) {
          const typeSel = row.querySelector('select');
          const input = row.querySelector('input');
          const val = parseByType(typeSel.value, input.value || '');
          result.push(val);
        }
        document.body.removeChild(overlay);
        resolve(result);
      } catch (e) {
        await showAlert(e?.message || '参数格式错误，请检查');
      }
    };

    const desc = document.createElement('div'); desc.className='modal-desc muted'; desc.textContent='提示：对象/数组请输入合法JSON；布尔值输入 true/false';
    box.appendChild(title);
    body.appendChild(help);
    body.appendChild(list);
    body.appendChild(addBar);
    body.appendChild(desc);
    box.appendChild(body);
    actions.appendChild(cancel); actions.appendChild(save);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

// 基于插件事件参数定义的编辑器：数量、类型、提示文本皆由插件提供
async function showParamsEditorForEvent(paramDefs, initial) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = '编辑插件事件参数';
    const body = document.createElement('div'); body.className = 'modal-body';
    const list = document.createElement('div'); list.className = 'array-list';
    const defs = Array.isArray(paramDefs) ? paramDefs : [];
    const values = Array.isArray(initial) ? initial.map((x) => x) : [];
    const parseByType = (type, str) => {
      switch (String(type || 'string')) {
        case 'string': return String(str || '');
        case 'number': { const n = Number(str); if (!Number.isFinite(n)) throw new Error('数字格式错误'); return n; }
        case 'boolean': { const s = String(str).trim().toLowerCase(); return s === 'true' || s === '1' || s === 'yes'; }
        case 'object': { const o = JSON.parse(str || '{}'); if (Array.isArray(o) || typeof o !== 'object' || o === null) throw new Error('对象必须为JSON Object'); return o; }
        case 'array': { const a = JSON.parse(str || '[]'); if (!Array.isArray(a)) throw new Error('数组必须为JSON Array'); return a; }
        default: return String(str || '');
      }
    };
    const stringifyByType = (type, v) => {
      const t = String(type || 'string');
      if (t === 'object' || t === 'array') return JSON.stringify(v ?? (t === 'array' ? [] : {}));
      if (t === 'boolean') return v ? 'true' : 'false';
      if (t === 'number') return String(Number(v || 0));
      return String(v ?? '');
    };
    defs.forEach((def, i) => {
      const row = document.createElement('div'); row.className = 'array-item';
      const label = document.createElement('label'); label.className = 'muted'; label.textContent = def?.name || `参数${i+1}`;
      const type = String(def?.type || 'string');
      let input = null;
      if (type === 'boolean') {
        const wrap = document.createElement('label'); wrap.className = 'switch';
        input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!values[i];
        const slider = document.createElement('span'); slider.className = 'slider';
        wrap.appendChild(input); wrap.appendChild(slider);
        row.appendChild(label); row.appendChild(wrap);
      } else {
        input = document.createElement('input'); input.type = (type === 'number') ? 'number' : 'text';
        input.value = stringifyByType(type, values[i]);
        input.placeholder = String(def?.hint || def?.desc || def?.name || '');
        row.appendChild(label); row.appendChild(input);
      }
      list.appendChild(row);
    });

    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.className='btn secondary'; cancel.textContent='取消';
    cancel.onclick = () => { document.body.removeChild(overlay); resolve(null); };
    const save = document.createElement('button'); save.className='btn primary'; save.textContent='保存';
    save.onclick = async () => {
      try {
        const result = defs.map((def, i) => {
          const type = String(def?.type || 'string');
          const row = list.children[i];
          const checkbox = row.querySelector('input[type="checkbox"]');
          const input = checkbox || row.querySelector('input');
          const raw = (checkbox ? checkbox.checked : (input?.value || ''));
          const val = checkbox ? !!raw : parseByType(type, raw);
          return val;
        });
        document.body.removeChild(overlay);
        resolve(result);
      } catch (e) {
        await showAlert(e?.message || '参数格式错误，请检查');
      }
    };
    const desc = document.createElement('div'); desc.className='modal-desc muted'; desc.textContent='参数类型与数量由插件定义；布尔值用开关，复杂类型按JSON编辑';
    box.appendChild(title);
    body.appendChild(list);
    body.appendChild(desc);
    box.appendChild(body);
    actions.appendChild(cancel); actions.appendChild(save);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

async function main() {
  // 左侧导航切换
  const navItems = document.querySelectorAll('.nav-item');
  const pages = {
    plugins: document.getElementById('page-plugins'),
    general: document.getElementById('page-general'),
    profiles: document.getElementById('page-profiles'),
    automation: document.getElementById('page-automation'),
    about: document.getElementById('page-about'),
    npm: document.getElementById('page-npm')
  };
  navItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      navItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.page;
      for (const key of Object.keys(pages)) {
        pages[key].hidden = key !== page;
      }
      if (page === 'npm') {
        renderInstalled();
      } else if (page === 'general') {
        initGeneralSettings();
      } else if (page === 'profiles') {
        initProfilesSettings();
      } else if (page === 'automation') {
        initAutomationSettings();
      } else if (page === 'about') {
        initAboutPage();
      }
    });
  });

  // 渲染插件列表
  const container = document.getElementById('plugins');
  const list = await fetchPlugins();
  container.innerHTML = '';
  list.forEach((p) => container.appendChild(renderPlugin(p)));

  // 自定义标题栏按钮
  document.querySelectorAll('.win-btn').forEach((b) => {
    b.addEventListener('click', () => {
      const act = b.dataset.act;
      window.settingsAPI?.windowControl(act);
    });
  });

  // NPM 管理逻辑（仅展示已安装列表）
  const installedEl = document.getElementById('npm-installed');
  async function renderInstalled() {
    installedEl.innerHTML = '加载已安装模块...';
    const res = await window.settingsAPI?.npmListInstalled();
    if (!res?.ok) {
      installedEl.innerHTML = `<div class="panel">获取失败：${res?.error || '未知错误'}</div>`;
      return;
    }
    const { packages } = res;
    installedEl.innerHTML = '';
    packages.forEach((pkg) => {
      const div = document.createElement('div');
      div.className = 'pkg';
      div.innerHTML = `
        <div class="pkg-header">
          <div class="pkg-name"><i class="ri-box-3-line"></i> ${pkg.name}</div>
          <div class="count">${pkg.versions.length} 个版本</div>
        </div>
        <div class="versions">${pkg.versions.map(v => `<span class="pill">v${v}</span>`).join(' ')}</div>
      `;
      installedEl.appendChild(div);
    });
  }
  // 初次进入NPM页面时加载
  const activeNav = document.querySelector('.nav-item.active');
  if (activeNav?.dataset.page === 'npm') {
    renderInstalled();
  }

  // 如果初次进入为档案管理，初始化
  if (activeNav?.dataset.page === 'profiles') {
    initProfilesSettings();
  }

  // 拖拽安装ZIP
  const drop = document.getElementById('drop-install');
  const modal = document.getElementById('install-modal');
  const btnCancel = document.getElementById('install-cancel');
  const btnConfirm = document.getElementById('install-confirm');
  let pendingZipPath = null;
  let pendingZipData = null; // { name, data: Uint8Array }
  ['dragenter','dragover'].forEach(evt => drop.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.add('dragover'); }));
  ['dragleave','drop'].forEach(evt => drop.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); drop.classList.remove('dragover'); }));
  drop.addEventListener('drop', async (e) => {
    const files = e.dataTransfer?.files || [];
    const file = files[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.zip')) { showAlert('请拖入ZIP插件安装包'); return; }
    pendingZipPath = file.path || null;
    pendingZipData = null;
    if (!pendingZipPath) {
      // 回退：读取数据并通过IPC传输安装，避免路径不可用导致失败
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        pendingZipData = { name: file.name, data: buf };
      } catch (err) {
        await showAlert('读取文件失败，请重试或手动选择安装');
        return;
      }
    }
    modal.hidden = false;
  });
  btnCancel?.addEventListener('click', () => { pendingZipPath = null; modal.hidden = true; });
  btnConfirm?.addEventListener('click', async () => {
    if (!pendingZipPath && !pendingZipData) return;
    btnConfirm.disabled = true; btnConfirm.innerHTML = '<i class="ri-loader-4-line"></i> 安装中...';
    let res;
    if (pendingZipPath) {
      res = await window.settingsAPI?.installPluginZip(pendingZipPath);
    } else {
      res = await window.settingsAPI?.installPluginZipData(pendingZipData.name, pendingZipData.data);
    }
    btnConfirm.disabled = false; btnConfirm.innerHTML = '<i class="ri-checkbox-circle-line"></i> 确认安装';
    if (!res?.ok) {
      showAlert(`安装失败：${res?.error || '未知错误'}\n如需手动导入Node模块，请将对应包拷贝至 src/npm_store/<name>/<version>/node_modules/<name>`);
      return;
    }
    modal.hidden = true; pendingZipPath = null; pendingZipData = null;
    // 重新刷新插件列表
    const container = document.getElementById('plugins');
    const list = await fetchPlugins();
    container.innerHTML = '';
    list.forEach((p) => container.appendChild(renderPlugin(p)));
  });
}

// 档案管理：学生列表
async function initProfilesSettings() {
  // 子页导航（目前仅一个“学生列表”）
  const subItems = document.querySelectorAll('#page-profiles .sub-item');
  const subpages = { students: document.getElementById('profiles-students') };
  subItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      subItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.sub;
      for (const key of Object.keys(subpages)) subpages[key].hidden = key !== page;
    });
  });
  for (const key of Object.keys(subpages)) subpages[key].hidden = key !== 'students';
  subItems.forEach((b) => b.classList.toggle('active', b.dataset.sub === 'students'));

  await window.settingsAPI?.configEnsureDefaults('profiles', { students: [] });
  const defsRes = await window.settingsAPI?.profilesGetColumnDefs?.();
  const extraCols = Array.isArray(defsRes?.columns) ? defsRes.columns : [];
  const columns = [
    { key: 'index', label: '序号' },
    { key: 'name', label: '姓名' },
    { key: 'gender', label: '性别' },
    ...extraCols.map(c => ({ key: c.key, label: c.label })),
    { key: 'actions', label: '操作' }
  ];

  let students = await window.settingsAPI?.configGet('profiles', 'students');
  students = Array.isArray(students) ? students : [];

  const thead = document.getElementById('profiles-thead');
  const tbody = document.getElementById('profiles-tbody');
  const filters = document.getElementById('profiles-filters');
  const btnAdd = document.getElementById('profiles-add');
  const btnSave = document.getElementById('profiles-save');
  const btnImpToggle = document.getElementById('profiles-import-toggle');
  const impBox = document.getElementById('profiles-import');
  const impText = document.getElementById('profiles-import-text');
  const btnImpApply = document.getElementById('profiles-import-apply');
  const btnImpCancel = document.getElementById('profiles-import-cancel');

  // 渲染表头
  const headRow = document.createElement('tr');
  columns.forEach(col => {
    const th = document.createElement('th');
    th.textContent = col.label;
    if (col.key === 'index') th.className = 'col-index';
    if (col.key === 'name') th.className = 'col-name';
    if (col.key === 'gender') th.className = 'col-gender';
    if (col.key === 'actions') th.className = 'col-actions';
    headRow.appendChild(th);
  });
  thead.innerHTML = '';
  thead.appendChild(headRow);

  // 过滤控件
  const filterState = { name: '', gender: '', extras: {} };
  filters.innerHTML = '';
  // 姓名过滤
  const fName = document.createElement('input'); fName.type = 'text'; fName.placeholder = '按姓名筛选';
  fName.addEventListener('input', () => { filterState.name = fName.value.trim(); renderBody(); });
  filters.appendChild(fName);
  // 性别过滤
  const fGender = document.createElement('select');
  [['','全部'],['男','男'],['女','女'],['未选择','未选择']].forEach(([v,l])=>{const o=document.createElement('option'); o.value=v; o.textContent=l; fGender.appendChild(o);});
  fGender.addEventListener('change', () => { filterState.gender = fGender.value; renderBody(); });
  filters.appendChild(fGender);
  // 额外列过滤
  extraCols.forEach(c => {
    const inp = document.createElement('input'); inp.type='text'; inp.placeholder = `按${c.label}筛选`;
    inp.addEventListener('input', () => { filterState.extras[c.key] = inp.value.trim(); renderBody(); });
    filters.appendChild(inp);
  });

  function matchesFilter(stu) {
    if (filterState.name && !String(stu.name||'').includes(filterState.name)) return false;
    if (filterState.gender) {
      const g = stu.gender || '未选择';
      if (filterState.gender !== '' && g !== filterState.gender) return false;
    }
    for (const k of Object.keys(filterState.extras)) {
      const val = filterState.extras[k]; if (!val) continue;
      if (!String(stu[k]||'').includes(val)) return false;
    }
    return true;
  }

  // 渲染表体
  function renderBody() {
    tbody.innerHTML = '';
    students.filter(matchesFilter).forEach((stu, idx) => {
      const tr = document.createElement('tr');
      columns.forEach(col => {
        const td = document.createElement('td');
        if (col.key === 'index') {
          td.textContent = String(idx + 1);
          td.className = 'col-index';
        } else if (col.key === 'name') {
          const inp = document.createElement('input'); inp.type='text'; inp.value = stu.name || '';
          inp.addEventListener('change', () => { students[idx].name = inp.value; });
          td.appendChild(inp);
          td.className = 'col-name';
        } else if (col.key === 'gender') {
          const sel = document.createElement('select');
          [['','未选择'],['男','男'],['女','女']].forEach(([v,l])=>{const o=document.createElement('option'); o.value=v; o.textContent=l; sel.appendChild(o);});
          sel.value = stu.gender || '';
          sel.addEventListener('change', () => { students[idx].gender = sel.value || '未选择'; });
          td.appendChild(sel);
          td.className = 'col-gender';
        } else if (col.key === 'actions') {
          const delBtn = document.createElement('button'); delBtn.className = 'btn secondary'; delBtn.innerHTML = '<i class="ri-delete-bin-line"></i> 删除';
          delBtn.addEventListener('click', async () => {
            const ok = await showConfirm?.('确定删除该学生吗？');
            if (ok) { students.splice(idx, 1); renderBody(); }
          });
          td.appendChild(delBtn);
          td.className = 'col-actions';
        } else {
          const inp = document.createElement('input'); inp.type='text'; inp.value = stu[col.key] || '';
          inp.addEventListener('change', () => { students[idx][col.key] = inp.value; });
          td.appendChild(inp);
        }
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
  }
  renderBody();

  // 导入逻辑
  btnImpToggle.onclick = () => { impBox.hidden = !impBox.hidden; };
  btnImpCancel.onclick = () => { impBox.hidden = true; };
  btnImpApply.onclick = () => {
    const text = String(impText.value || '');
    const lines = text.split(/\r?\n/).map(s => s.trim()).filter(s => s.length);
    const newItems = lines.map(name => ({ required: true, name, gender: '未选择' }));
    students = students.concat(newItems);
    impText.value = '';
    impBox.hidden = true;
    renderBody();
  };

  // 新增与保存
  btnAdd.onclick = () => { students.push({ required: true, name: '', gender: '未选择' }); renderBody(); };
  btnSave.onclick = async () => {
    await window.settingsAPI?.configSet('profiles', 'students', students);
    await showAlert('已保存');
  };
}


function initAboutPage() {
  const vEl = document.getElementById('about-version');
  const eEl = document.getElementById('about-electron');
  // 优先通过主进程API获取版本信息；否则从UA解析Electron版本
  (async () => {
    try {
      const info = await window.settingsAPI?.getAppInfo?.();
      if (info?.appVersion) vEl.textContent = info.appVersion;
      const ev = info?.electronVersion || (navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] || '—');
      eEl.textContent = ev;
    } catch {
      vEl.textContent = '—';
      eEl.textContent = navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] || '—';
    }
  })();
}

// 通用设置：启动页与名言、基础设置
async function initGeneralSettings() {
  // 子夹（子页面）导航切换（限定在通用设置页面内）
  const subItems = document.querySelectorAll('#page-general .sub-item');
  const subpages = {
    splash: document.getElementById('general-splash'),
    basic: document.getElementById('general-basic'),
    time: document.getElementById('general-time'),
    data: document.getElementById('general-data')
  };
  subItems.forEach((btn) => {
    btn.addEventListener('click', () => {
      subItems.forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      const page = btn.dataset.sub;
      for (const key of Object.keys(subpages)) {
        subpages[key].hidden = key !== page;
      }
    });
  });
  // 默认显示“基础”子页
  for (const key of Object.keys(subpages)) subpages[key].hidden = key !== 'basic';
  subItems.forEach((b) => b.classList.toggle('active', b.dataset.sub === 'basic'));

  const defaults = {
    quoteSource: 'hitokoto',
    quoteApiUrl: 'https://v1.hitokoto.cn/',
    localQuotes: [],
    splashEnabled: true,
    splashQuoteEnabled: true,
    autostartEnabled: false,
    autostartHigh: false,
    preciseTimeEnabled: false,
    ntpServer: 'ntp.aliyun.com',
    timeOffset: 0,
    autoOffsetDaily: 0,
    offsetBaseDate: new Date().toISOString().slice(0, 10),
    semesterStart: new Date().toISOString().slice(0, 10),
    biweekOffset: false
  };
  await window.settingsAPI?.configEnsureDefaults('system', defaults);
  const cfg = await window.settingsAPI?.configGetAll('system');

  // 启动页与名言相关控件
  const splashEnabled = document.getElementById('splash-enabled');
  const splashQuoteEnabled = document.getElementById('splash-quote-enabled');
  splashEnabled.checked = !!cfg.splashEnabled;
  splashQuoteEnabled.checked = !!cfg.splashQuoteEnabled;
  splashEnabled.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'splashEnabled', !!splashEnabled.checked);
  });
  splashQuoteEnabled.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'splashQuoteEnabled', !!splashQuoteEnabled.checked);
  });

  const radios = document.querySelectorAll('input[name="quoteSource"]');
  const fieldApi = document.getElementById('field-api');
  const fieldLocal = document.getElementById('field-local');
  const apiUrl = document.getElementById('api-url');
  const apiTest = document.getElementById('api-test');
  const apiSample = document.getElementById('api-sample');
  const openArrayEditor = document.getElementById('open-array-editor');

  radios.forEach((r) => { r.checked = r.value === (cfg.quoteSource || 'hitokoto'); });
  apiUrl.value = cfg.quoteApiUrl || 'https://v1.hitokoto.cn/';
  const switchSource = (val) => { fieldApi.hidden = val !== 'hitokoto'; fieldLocal.hidden = val !== 'local'; };
  switchSource(cfg.quoteSource || 'hitokoto');

  radios.forEach((r) => {
    r.addEventListener('change', async () => {
      if (!r.checked) return;
      await window.settingsAPI?.configSet('system', 'quoteSource', r.value);
      switchSource(r.value);
    });
  });

  apiUrl.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'quoteApiUrl', apiUrl.value.trim());
  });

  apiTest.addEventListener('click', async () => {
    const url = apiUrl.value.trim() || 'https://v1.hitokoto.cn/';
    try {
      const resp = await fetch(url);
      const data = await resp.json();
      const txt = `「${data.hitokoto}」—— ${data.from || ''}`;
      apiSample.textContent = txt;
    } catch (e) {
      apiSample.textContent = '获取失败，请检查API地址或网络。';
    }
  });

  openArrayEditor.addEventListener('click', async () => {
    const modal = document.getElementById('array-modal');
    const listEl = document.getElementById('array-list');
    const addBtn = document.getElementById('array-add');
    const importInput = document.getElementById('array-import');
    const saveBtn = document.getElementById('array-save');
    const cancelBtn = document.getElementById('array-cancel');

    const renderItems = (items) => {
      listEl.innerHTML = '';
      items.forEach((val, idx) => {
        const row = document.createElement('div');
        row.className = 'array-item';
        // 文本列
        const inputText = document.createElement('input');
        inputText.type = 'text';
        inputText.placeholder = '文本';
        inputText.value = typeof val === 'string' ? val : (val?.text || '');
        inputText.addEventListener('change', () => {
          const current = items[idx];
          items[idx] = typeof current === 'object' ? { ...current, text: inputText.value } : { text: inputText.value, from: '' };
        });
        // 来源列
        const inputFrom = document.createElement('input');
        inputFrom.type = 'text';
        inputFrom.placeholder = '来源';
        inputFrom.value = typeof val === 'object' ? (val?.from || '') : '';
        inputFrom.addEventListener('change', () => {
          const current = items[idx];
          items[idx] = typeof current === 'object' ? { ...current, from: inputFrom.value } : { text: inputText.value, from: inputFrom.value };
        });
        const del = document.createElement('button');
        del.innerHTML = '<i class="ri-delete-bin-line"></i> 删除';
        del.addEventListener('click', () => { items.splice(idx, 1); renderItems(items); });
        row.appendChild(inputText);
        row.appendChild(inputFrom);
        row.appendChild(del);
        listEl.appendChild(row);
      });
    };

    // 每次打开从配置读取最新值，避免保存后无效的问题
    const latest = await window.settingsAPI?.configGet('system', 'localQuotes');
    let items = Array.isArray(latest) ? [...latest] : [];
    renderItems(items);

    addBtn.onclick = () => { items.push({ text: '', from: '' }); renderItems(items); };
    importInput.onchange = () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const text = String(reader.result || '');
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter((s) => s.length);
        items = lines.map((line) => {
          const parts = line.split(/[\|\t]/);
          const t = (parts[0] || '').trim();
          const f = (parts[1] || '').trim();
          return { text: t, from: f };
        });
        renderItems(items);
      };
      reader.readAsText(file, 'utf-8');
    };
    saveBtn.onclick = async () => {
      await window.settingsAPI?.configSet('system', 'localQuotes', items);
      // 更新内存中的cfg以便再次打开时显示最新
      cfg.localQuotes = items;
      modal.hidden = true;
    };
    cancelBtn.onclick = () => { modal.hidden = true; };

    modal.hidden = false;
  });

  // 基础设置：自启动、精确时间与偏移
  const autostartEnabled = document.getElementById('autostart-enabled');
  const autostartHigh = document.getElementById('autostart-high');
  const preciseTime = document.getElementById('precise-time');
  const semesterStart = document.getElementById('semester-start');
  const biweekOffset = document.getElementById('biweek-offset');
  const timeOffset = document.getElementById('time-offset');
  const autoOffsetDaily = document.getElementById('auto-offset-daily');

  autostartEnabled.checked = !!cfg.autostartEnabled;
  autostartHigh.checked = !!cfg.autostartHigh;
  preciseTime.checked = !!cfg.preciseTimeEnabled;
  semesterStart.value = String(cfg.semesterStart || cfg.offsetBaseDate || new Date().toISOString().slice(0, 10));
  if (biweekOffset) biweekOffset.checked = !!cfg.biweekOffset;
  timeOffset.value = Number(cfg.timeOffset || 0);
  autoOffsetDaily.value = Number(cfg.autoOffsetDaily || 0);

  // NTP服务器地址绑定
  const ntpServer = document.getElementById('ntp-server');
  if (ntpServer) {
    ntpServer.value = String(cfg.ntpServer || 'ntp.aliyun.com');
    ntpServer.addEventListener('change', async () => {
      const val = String(ntpServer.value || '').trim() || 'ntp.aliyun.com';
      await window.settingsAPI?.configSet('system', 'ntpServer', val);
    });
  }

  // 清理用户数据：提示确认后调用主进程删除用户数据目录
  const cleanupBtn = document.getElementById('cleanup-user-data');
  if (cleanupBtn) {
    cleanupBtn.addEventListener('click', async () => {
      const confirmed = window.confirm('确认删除所有插件与配置等用户数据？此操作不可恢复。');
      if (!confirmed) return;
      const res = await window.settingsAPI?.cleanupUserData?.();
      if (res?.ok) {
        alert('已清理用户数据。您现在可以从系统中卸载应用。');
      } else {
        alert('清理失败：' + (res?.error || '未知错误'));
      }
    });
  }

  autostartEnabled.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'autostartEnabled', !!autostartEnabled.checked);
    await window.settingsAPI?.setAutostart?.(!!autostartEnabled.checked, !!autostartHigh.checked);
  });
  autostartHigh.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'autostartHigh', !!autostartHigh.checked);
    await window.settingsAPI?.setAutostart?.(!!autostartEnabled.checked, !!autostartHigh.checked);
  });
  preciseTime.addEventListener('change', async () => {
    await window.settingsAPI?.configSet('system', 'preciseTimeEnabled', !!preciseTime.checked);
  });
  semesterStart.addEventListener('change', async () => {
    const val = String(semesterStart.value || '').slice(0, 10);
    await window.settingsAPI?.configSet('system', 'semesterStart', val);
  });
  if (biweekOffset) {
    biweekOffset.addEventListener('change', async () => {
      await window.settingsAPI?.configSet('system', 'biweekOffset', !!biweekOffset.checked);
    });
  }
  timeOffset.addEventListener('change', async () => {
    const val = Number(timeOffset.value || 0);
    await window.settingsAPI?.configSet('system', 'timeOffset', val);
  });
  autoOffsetDaily.addEventListener('change', async () => {
    const val = Number(autoOffsetDaily.value || 0);
    await window.settingsAPI?.configSet('system', 'autoOffsetDaily', val);
  });

  // 数据目录：显示当前路径并绑定打开/更改
  const userDataPathEl = document.getElementById('user-data-path');
  const openUserDataBtn = document.getElementById('open-user-data');
  const changeUserDataBtn = document.getElementById('change-user-data');
  if (userDataPathEl && window.settingsAPI?.getUserDataPath) {
    try {
      const p = await window.settingsAPI.getUserDataPath();
      userDataPathEl.textContent = String(p || '');
    } catch {}
  }
  if (openUserDataBtn) {
    openUserDataBtn.addEventListener('click', async () => {
      try { await window.settingsAPI?.openUserData?.(); } catch {}
    });
  }
  if (changeUserDataBtn) {
    changeUserDataBtn.addEventListener('click', async () => {
      const res = await window.settingsAPI?.changeUserData?.();
      if (res?.ok) {
        const p = await window.settingsAPI?.getUserDataPath?.();
        if (userDataPathEl) userDataPathEl.textContent = String(p || '');
        alert('已更改数据目录。重启应用后生效。');
      } else if (res && res.error) {
        alert('更改失败：' + res.error);
      }
    });
  }
}

// 自动执行：列表与编辑器
async function initAutomationSettings() {
  const listEl = document.getElementById('auto-list');
  const editorEl = document.getElementById('auto-editor');
  const addBtn = document.getElementById('auto-add');

  const summarize = (item) => {
    const triggers = (item.triggers || []).map((t) => t.type === 'time' ? `时间 ${t.at}` : (t.type === 'protocol' ? `协议 ${t.text}` : t.type)).join('，');
    return triggers || '未设置触发条件';
  };

  const renderList = async (selectedId) => {
    const items = await window.settingsAPI?.automationList?.() || [];
    listEl.innerHTML = '';
    items.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'auto-item';
      row.innerHTML = `
        <div>
          <div class="title">${it.name || '未命名自动化'}</div>
          <div class="desc">${summarize(it)}</div>
        </div>
        <div class="actions">
          <label class="switch toggle">
            <input type="checkbox" ${it.enabled ? 'checked' : ''} />
            <span class="slider"></span>
          </label>
          <button class="btn secondary del"><i class="ri-delete-bin-line"></i></button>
        </div>
      `;
      const toggle = row.querySelector('input[type="checkbox"]');
      toggle.addEventListener('click', async (e) => {
        await window.settingsAPI?.automationToggle?.(it.id, !!e.target.checked);
      });
      const delBtn = row.querySelector('.del');
      delBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const ok = await showConfirm('确定删除该自动化吗？');
        if (ok) {
          await window.settingsAPI?.automationRemove?.(it.id);
          renderList();
          editorEl.innerHTML = '从左侧选择任务或新建';
          editorEl.className = 'auto-editor muted';
        }
      });
      row.addEventListener('click', () => renderEditor(it.id));
      listEl.appendChild(row);
    });
    if (selectedId) {
      const idx = items.findIndex((x) => x.id === selectedId);
      if (idx >= 0) renderEditor(selectedId);
    }
  };

  const renderEditor = async (id) => {
    const it = await window.settingsAPI?.automationGet?.(id);
    if (!it) { editorEl.textContent = '未找到该自动化'; editorEl.className = 'auto-editor muted'; return; }
    editorEl.className = 'auto-editor';
    editorEl.innerHTML = '';

    const header = document.createElement('div');
    header.className = 'auto-editor-header';
    const nameInput = document.createElement('input');
    nameInput.type = 'text'; nameInput.value = it.name || '';
    nameInput.placeholder = '自动化名称';
    const saveBtn = document.createElement('button'); saveBtn.className = 'btn primary'; saveBtn.innerHTML = '<i class="ri-save-3-line"></i> 保存';
    const testBtn = document.createElement('button'); testBtn.className = 'btn secondary'; testBtn.innerHTML = '<i class="ri-play-mini-fill"></i> 测试执行';
    header.appendChild(nameInput);
    header.appendChild(saveBtn);
    header.appendChild(testBtn);
    editorEl.appendChild(header);

    // 触发条件
    const secTrig = document.createElement('div'); secTrig.className = 'section';
    secTrig.innerHTML = '<div class="section-title"><i class="ri-timer-line"></i> 触发条件</div>';
    const trigList = document.createElement('div');
    const addTime = document.createElement('button'); addTime.className = 'btn secondary'; addTime.innerHTML = '<i class="ri-time-line"></i> 添加时间触发';
    const addProtocol = document.createElement('button'); addProtocol.className = 'btn secondary'; addProtocol.innerHTML = '<i class="ri-link-m"></i> 添加协议触发';
    const updateTrigList = () => {
      trigList.innerHTML = '';
      (it.triggers || []).forEach((t, idx) => {
        const row = document.createElement('div'); row.className = 'action-row';
        const typeSel = document.createElement('select');
        [['time','时间'],['protocol','协议']].forEach(([v,l]) => { const o=document.createElement('option'); o.value=v; o.textContent=l; typeSel.appendChild(o); });
        typeSel.value = t.type || 'time';
        const input = document.createElement('input'); input.type = 'text'; input.placeholder = t.type === 'protocol' ? '条件文本' : 'HH:MM'; input.value = t.type === 'protocol' ? (t.text || '') : (t.at || '');
        const del = document.createElement('button'); del.className = 'btn secondary'; del.innerHTML = '<i class="ri-delete-bin-line"></i>';
        typeSel.addEventListener('change', () => {
          t.type = typeSel.value;
          input.placeholder = t.type === 'protocol' ? '条件文本' : 'HH:MM';
          input.value = '';
        });
        input.addEventListener('change', () => {
          if (t.type === 'protocol') t.text = input.value; else t.at = input.value;
        });
        del.addEventListener('click', () => { it.triggers.splice(idx,1); updateTrigList(); });
        row.appendChild(typeSel); row.appendChild(input); row.appendChild(del);
        trigList.appendChild(row);
      });
    };
    addTime.addEventListener('click', () => { it.triggers = it.triggers || []; it.triggers.push({ type: 'time', at: '08:00' }); updateTrigList(); });
    addProtocol.addEventListener('click', () => { it.triggers = it.triggers || []; it.triggers.push({ type: 'protocol', text: '' }); updateTrigList(); });
    const trigActions = document.createElement('div'); trigActions.className = 'inline'; trigActions.appendChild(addTime); trigActions.appendChild(addProtocol);
    secTrig.appendChild(trigActions);
    secTrig.appendChild(trigList);
    // 初始渲染已有触发器
    updateTrigList();
    editorEl.appendChild(secTrig);

    // 执行条件
    const secCond = document.createElement('div'); secCond.className = 'section';
    secCond.innerHTML = '<div class="section-title"><i class="ri-equalizer-line"></i> 执行条件</div>';
    const topModeSel = document.createElement('select'); ['且（AND）','或（OR）'].forEach((l, i) => { const o=document.createElement('option'); o.value = i===0?'and':'or'; o.textContent=l; topModeSel.appendChild(o); });
    topModeSel.value = it.conditions?.mode === 'or' ? 'or' : 'and';
    topModeSel.addEventListener('change', () => { it.conditions = it.conditions || { mode: 'and', groups: [] }; it.conditions.mode = topModeSel.value; });
    secCond.appendChild(topModeSel);
    const groupsWrap = document.createElement('div');
    const addGroupBtn = document.createElement('button'); addGroupBtn.className = 'btn secondary'; addGroupBtn.innerHTML = '<i class="ri-add-line"></i> 添加条件组'; addGroupBtn.style.marginLeft = '5px';
    const renderGroups = () => {
      groupsWrap.innerHTML = '';
      const groups = it.conditions?.groups || [];
      groups.forEach((g, gi) => {
        const box = document.createElement('div'); box.className = 'group';
        const header = document.createElement('div'); header.className = 'group-header';
        const modeSel = document.createElement('select'); ['且（AND）','或（OR）'].forEach((l, i) => { const o=document.createElement('option'); o.value=i===0?'and':'or'; o.textContent=l; modeSel.appendChild(o); });
        modeSel.value = g.mode === 'or' ? 'or' : 'and';
        const addCondBtn = document.createElement('button'); addCondBtn.className='btn secondary'; addCondBtn.innerHTML = '<i class="ri-add-line"></i> 添加条件';
        const delGroupBtn = document.createElement('button'); delGroupBtn.className='btn secondary'; delGroupBtn.innerHTML = '<i class="ri-delete-bin-line"></i>';
        header.appendChild(modeSel); header.appendChild(addCondBtn); header.appendChild(delGroupBtn);
        box.appendChild(header);
        const condList = document.createElement('div');
        const renderConds = () => {
          condList.innerHTML = '';
          (g.items || []).forEach((c, ci) => {
            const row = document.createElement('div'); row.className = 'cond-row';
            const statusDot = document.createElement('span'); statusDot.className = 'cond-status'; statusDot.title = '计算中…';
            const typeSel = document.createElement('select');
            [
              ['alwaysTrue','始终为真'],
              ['alwaysFalse','始终为假'],
              ['timeEquals','当前时间为（HH:MM）'],
              ['weekdayIn','今天是星期（1-7）'],
              ['monthIn','今天是几月（1-12）'],
              ['dayIn','今天是几号（1-31）'],
              ['biweek','单双周（需设置学期开始日期）'],
              // ['selectedWindowName','当前选中窗口名称包含'],
              // ['selectedProcess','当前选中窗口进程为']
            ].forEach(([v,l]) => { const o=document.createElement('option'); o.value=v; o.textContent=l; typeSel.appendChild(o); });
            typeSel.value = c.type || 'timeEquals';
            const valInput = document.createElement('input'); valInput.type = 'text'; valInput.placeholder = '值（逗号分隔或单值）';
            if (Array.isArray(c.value)) valInput.value = c.value.join(','); else valInput.value = c.value || '';
            const negate = document.createElement('label'); negate.className='negate'; negate.innerHTML = '<input type="checkbox" /> 反条件';
            negate.querySelector('input').checked = !!c.negate;
            const delBtn = document.createElement('span'); delBtn.className='del'; delBtn.innerHTML = '<i class="ri-delete-bin-line"></i>';
            // 当前状态评估（与主进程逻辑一致）
            const evalCond = async () => {
              const d = new Date();
              const weekday = d.getDay() === 0 ? 7 : d.getDay();
              const month = d.getMonth() + 1;
              const dom = d.getDate();
              const semStart = await (window.settingsAPI?.configGet?.('system','semesterStart'));
              const offsetBase = await (window.settingsAPI?.configGet?.('system','offsetBaseDate'));
              const biweekOff = await (window.settingsAPI?.configGet?.('system','biweekOffset'));
              const base = semStart || offsetBase;
              let isEvenWeek = null;
              if (base) {
                try {
                  const baseDate = new Date(String(base) + 'T00:00:00');
                  const diffDays = Math.floor((d - baseDate) / (24 * 3600 * 1000));
                  const weekIndex = Math.floor(diffDays / 7);
                  isEvenWeek = weekIndex % 2 === 0;
                  if (biweekOff) isEvenWeek = !isEvenWeek;
                } catch {}
              }
              let ok = true;
              switch (c.type) {
                case 'alwaysTrue': ok = true; break;
                case 'alwaysFalse': ok = false; break;
                case 'timeEquals': {
                  const hh = String(d.getHours()).padStart(2, '0');
                  const mm = String(d.getMinutes()).padStart(2, '0');
                  ok = (`${hh}:${mm}` === String(c.value || '')); break;
                }
                case 'weekdayIn': ok = Array.isArray(c.value) ? c.value.includes(weekday) : false; break;
                case 'monthIn': ok = Array.isArray(c.value) ? c.value.includes(month) : false; break;
                case 'dayIn': ok = Array.isArray(c.value) ? c.value.includes(dom) : false; break;
                case 'biweek': {
                  if (isEvenWeek == null) ok = false; else ok = (c.value === 'even') ? isEvenWeek : !isEvenWeek;
                  break;
                }
                default: ok = true;
              }
              if (c.negate) ok = !ok;
              return !!ok;
            };
            const updateStatus = async () => {
              try {
                const ok = await evalCond();
                statusDot.classList.toggle('ok', ok);
                statusDot.classList.toggle('fail', !ok);
                statusDot.title = ok ? '当前满足' : '当前不满足';
              } catch {}
            };
            typeSel.addEventListener('change', () => {
              c.type = typeSel.value;
              const needValue = !(c.type === 'alwaysTrue' || c.type === 'alwaysFalse');
              valInput.disabled = !needValue; valInput.placeholder = needValue ? '值（逗号分隔或单值）' : '无需填写';
              updateStatus();
            });
            valInput.addEventListener('change', () => {
              if (c.type.endsWith('In')) c.value = valInput.value.split(',').map(s => parseInt(s,10)).filter(n => !isNaN(n));
              else c.value = valInput.value.trim();
              updateStatus();
            });
            negate.querySelector('input').addEventListener('change', (e) => { c.negate = !!e.target.checked; updateStatus(); });
            delBtn.addEventListener('click', () => { g.items.splice(ci,1); renderConds(); });
            // 初始禁用状态
            valInput.disabled = (c.type === 'alwaysTrue' || c.type === 'alwaysFalse'); if (valInput.disabled) valInput.placeholder = '无需填写';
            row.appendChild(statusDot); row.appendChild(typeSel); row.appendChild(valInput); row.appendChild(negate); row.appendChild(delBtn);
            condList.appendChild(row);
            // 初次渲染更新一次状态
            updateStatus();
            // 注册到全局刷新列表
            allCondUpdateFns.push(updateStatus);
          });
        };
        addCondBtn.addEventListener('click', () => { g.items = g.items || []; g.items.push({ type: 'timeEquals', value: '08:00', negate: false }); renderConds(); });
        delGroupBtn.addEventListener('click', () => { (it.conditions.groups || []).splice(gi,1); renderGroups(); });
        modeSel.addEventListener('change', () => { g.mode = modeSel.value; });
        // 渲染组条件并重置定时器
        renderConds();
        box.appendChild(condList);
        groupsWrap.appendChild(box);
      });
      try { if (condStatusTimer) clearInterval(condStatusTimer); } catch {}
      condStatusTimer = setInterval(() => { try { allCondUpdateFns.forEach(fn => fn && fn()); } catch {} }, 30 * 1000);
    };
    addGroupBtn.addEventListener('click', () => { it.conditions = it.conditions || { mode:'and', groups:[] }; it.conditions.groups.push({ mode:'and', items: [] }); renderGroups(); });
    secCond.appendChild(addGroupBtn);
    secCond.appendChild(groupsWrap);
    // 初始渲染已有条件组
    // 状态刷新定时器与函数列表
    let allCondUpdateFns = [];
    let condStatusTimer = null;
    renderGroups();
    editorEl.appendChild(secCond);

    // 执行动作
    const secAct = document.createElement('div'); secAct.className = 'section';
    secAct.innerHTML = '<div class="section-title"><i class="ri-flashlight-line"></i> 执行动作</div>';
    const actList = document.createElement('div');
    const addActBtn = document.createElement('button'); addActBtn.className='btn secondary'; addActBtn.innerHTML = '<i class="ri-add-line"></i> 添加动作';
    const renderActs = () => {
      actList.innerHTML = '';
      (it.actions || []).forEach((a, ai) => {
        const row = document.createElement('div'); row.className='action-row';
        const typeSel = document.createElement('select');
        [
          ['pluginEvent','插件功能'],
          ['power','电源功能'],
          ['openApp','打开应用程序'],
          ['cmd','执行CMD命令'],
          ['wait','等待时长']
        ].forEach(([v,l]) => { const o=document.createElement('option'); o.value=v; o.textContent=l; typeSel.appendChild(o); });
        typeSel.value = a.type || 'pluginEvent';
        const cfg = document.createElement('div');
        const delBtn = document.createElement('button'); delBtn.className='btn secondary'; delBtn.innerHTML = '<i class="ri-delete-bin-line"></i>';

        const renderCfg = async () => {
          cfg.innerHTML = '';
          if (typeSel.value === 'pluginEvent') {
            const plugSel = document.createElement('select');
            const plugins = await window.settingsAPI?.getPlugins?.() || [];
            plugins.forEach(p => { const o=document.createElement('option'); o.value=(p.id || p.name); o.textContent=p.name; plugSel.appendChild(o); });
            plugSel.value = a.pluginId || (plugins[0]?.id || plugins[0]?.name) || '';
            const evSel = document.createElement('select');
            const res = await window.settingsAPI?.pluginAutomationListEvents?.(plugSel.value);
            const evs = Array.isArray(res?.events) ? res.events : (Array.isArray(res) ? res : []);
            evs.forEach(e => { const o=document.createElement('option'); o.value=e.name; o.textContent=(e.desc || e.title || e.name); evSel.appendChild(o); });
            evSel.value = a.event || evs[0]?.name || '';
            // 立即写入，确保act包含pluginId与event
            a.pluginId = plugSel.value;
            a.event = evSel.value;
            const editParams = document.createElement('button'); editParams.className='btn secondary'; editParams.innerHTML = '<i class="ri-edit-2-line"></i> 编辑参数数组';
            const paramsPreview = document.createElement('div'); paramsPreview.className='muted'; paramsPreview.textContent = `参数项数：${Array.isArray(a.params)? a.params.length : 0}`;
            plugSel.addEventListener('change', async () => {
              a.pluginId = plugSel.value;
              const res2 = await window.settingsAPI?.pluginAutomationListEvents?.(plugSel.value);
              const evs2 = Array.isArray(res2?.events) ? res2.events : (Array.isArray(res2) ? res2 : []);
              evSel.innerHTML = '';
              evs2.forEach(e => { const o=document.createElement('option'); o.value=e.name; o.textContent=(e.desc || e.title || e.name); evSel.appendChild(o); });
              a.event = evSel.value = evs2[0]?.name || '';
            });
            evSel.addEventListener('change', () => { a.event = evSel.value; });
            editParams.onclick = async () => {
              const def = evs.find(e => e.name === evSel.value);
              const defs = Array.isArray(def?.params) ? def.params : [];
              const resEdit = await showParamsEditorForEvent(defs, Array.isArray(a.params) ? a.params : []);
              if (Array.isArray(resEdit)) { a.params = resEdit; paramsPreview.textContent = `参数项数：${resEdit.length}`; }
            };
            cfg.appendChild(plugSel); cfg.appendChild(evSel); cfg.appendChild(editParams); cfg.appendChild(paramsPreview);
          } else if (typeSel.value === 'power') {
            const opSel = document.createElement('select'); [['shutdown','关机'],['restart','重启'],['logoff','注销']].forEach(([v,l]) => { const o=document.createElement('option'); o.value=v; o.textContent=l; opSel.appendChild(o); }); opSel.value = a.op || 'shutdown'; opSel.addEventListener('change', () => { a.op = opSel.value; }); cfg.appendChild(opSel);
          } else if (typeSel.value === 'openApp') {
            const p = document.createElement('input'); p.type='text'; p.placeholder='可执行文件路径'; p.value=a.path||''; p.addEventListener('change', () => { a.path = p.value; }); cfg.appendChild(p);
          } else if (typeSel.value === 'cmd') {
            const c = document.createElement('input'); c.type='text'; c.placeholder='命令行（将在Shell中执行）'; c.value=a.command||''; c.addEventListener('change', () => { a.command = c.value; }); cfg.appendChild(c);
          } else if (typeSel.value === 'wait') {
            const s = document.createElement('input'); s.type='number'; s.min='0'; s.step='1'; s.placeholder='秒数'; s.value=(Number.isFinite(a.seconds)? a.seconds : 1);
            s.addEventListener('change', () => { const v = parseInt(s.value || '0', 10); a.seconds = Math.max(0, isNaN(v)?0:v); });
            cfg.appendChild(s);
          }
        };
        typeSel.addEventListener('change', () => { a.type = typeSel.value; renderCfg(); });
        delBtn.addEventListener('click', () => { it.actions.splice(ai,1); renderActs(); });
        row.appendChild(typeSel); row.appendChild(cfg); row.appendChild(delBtn);
        actList.appendChild(row);
        renderCfg();
      });
    };
    addActBtn.addEventListener('click', () => { it.actions = it.actions || []; it.actions.push({ type:'pluginEvent', pluginId:'', event:'', params:[] }); renderActs(); });
    secAct.appendChild(addActBtn);
    secAct.appendChild(actList);
    // 初始渲染已有动作
    renderActs();
    editorEl.appendChild(secAct);

    // 执行前确认
    const secConf = document.createElement('div'); secConf.className='section';
    secConf.innerHTML = '<div class="section-title"><i class="ri-shield-check-line"></i> 执行前确认</div>';
    const confirmRow = document.createElement('div'); confirmRow.className='inline';

    // 测试执行按钮行为（忽略触发条件，仅按当前执行条件与确认流程执行）
    testBtn.addEventListener('click', async () => {
      try {
        // 在测试前先保存当前编辑配置，确保以最新配置执行
        const patched = {
          name: nameInput.value || it.name,
          triggers: it.triggers || [],
          conditions: it.conditions || { mode:'and', groups:[] },
          actions: it.actions || [],
          confirm: { enabled: confirmEnabled.querySelector('input').checked, timeout: parseInt(timeoutInput.value||60,10) }
        };
        const upd = await window.settingsAPI?.automationUpdate?.(it.id, patched);
        if (!upd?.ok) { await showAlert('保存当前配置失败，无法测试'); return; }

        const res = await window.settingsAPI?.automationTest?.(id);
        if (!res?.ok) { await showAlert(res?.error || '测试执行失败'); return; }
        if (res.executed) {
          await showAlert('测试执行完成。已执行配置的动作。');
        } else if (res.reason === 'conditions_not_met') {
          await showAlert('当前执行条件不满足，未执行。');
        } else if (res.reason === 'cancelled') {
          await showAlert('已取消执行。');
        } else {
          await showAlert('未执行。');
        }
      } catch (e) {
        await showAlert(e?.message || '测试执行失败');
      }
    });
    const confirmEnabled = document.createElement('label'); confirmEnabled.className='switch'; confirmEnabled.innerHTML = `<input type="checkbox" ${it.confirm?.enabled!==false?'checked':''}/><span class="slider"></span>`;
    const timeoutInput = document.createElement('input'); timeoutInput.type='number'; timeoutInput.step='1'; timeoutInput.value = parseInt(it.confirm?.timeout || 60,10);
    const timeoutLabel = document.createElement('label'); timeoutLabel.textContent = '确认超时时间（秒）'; timeoutLabel.style.color = 'var(--muted)';
    confirmRow.appendChild(confirmEnabled); confirmRow.appendChild(timeoutLabel); confirmRow.appendChild(timeoutInput);
    secConf.appendChild(confirmRow);
    editorEl.appendChild(secConf);

    // 保存
    saveBtn.addEventListener('click', async () => {
      const patched = {
        name: nameInput.value || it.name,
        triggers: it.triggers || [],
        conditions: it.conditions || { mode:'and', groups:[] },
        actions: it.actions || [],
        confirm: { enabled: confirmEnabled.querySelector('input').checked, timeout: parseInt(timeoutInput.value||60,10) }
      };
      const res = await window.settingsAPI?.automationUpdate?.(it.id, patched);
      if (!res?.ok) { showAlert('保存失败'); return; }
      await renderList(it.id);
    });
  };

  // 防止重复绑定导致一次点击创建多条任务
  if (!addBtn.dataset.bound) {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', async () => {
      try {
        addBtn.disabled = true;
        const created = await window.settingsAPI?.automationCreate?.({ name: '新建自动化' });
        if (created?.id) { await renderList(created.id); }
      } finally {
        addBtn.disabled = false;
      }
    });
  }

  await renderList();
}

main();