async function initConfigOverview() {
  const searchInput = document.getElementById('config-search-input');
  const searchBtn = document.getElementById('config-search-btn');
  const refreshBtn = document.getElementById('config-refresh-btn');
  const listEl = document.getElementById('config-list');
  const emptyEl = document.getElementById('config-empty');

  async function loadAll() {
    const plugins = await window.settingsAPI?.getPlugins?.();
    const scopes = [];
    const sysVals = await window.settingsAPI?.configGetAll?.('system');
    try { await window.settingsAPI?.configEnsureDefaults?.('system', systemDefaults); } catch (e) {}
    scopes.push({ id: 'system', name: '主程序', icon: 'ri-settings-3-line', schema: systemSchema, values: sysVals || {} });
    for (const p of (Array.isArray(plugins) ? plugins : [])) {
      const id = p.id || p.name;
      let vals = await window.settingsAPI?.configPluginGetAll?.(id);
      try {
        // 兼容旧ID（点号形式），例如 morning.reading -> morning-reading
        if (!vals || Object.keys(vals).length === 0) {
          const dotId = String(id).replace(/-/g, '.');
          const older = await window.settingsAPI?.configGetAll?.(dotId);
          if (older && Object.keys(older).length) vals = older;
        }
      } catch (e) {}
      const schema = (Array.isArray(p.configSchema) || (p.configSchema && typeof p.configSchema === 'object')) ? p.configSchema : null;
      if (schema) {
        const defs = Array.isArray(schema) ? schema : Object.keys(schema).map((k) => ({ key: k, default: schema[k]?.default }));
        const defaults = {};
        defs.forEach((d) => { if (d && d.key !== undefined && d.default !== undefined) defaults[d.key] = d.default; });
        if (Object.keys(defaults).length) { try { await window.settingsAPI?.configEnsureDefaults?.(id, defaults); } catch (e) {} }
      }
      scopes.push({ id, name: p.name || id, icon: p.icon || 'ri-puzzle-line', schema, values: vals || {}, kind: 'plugin' });
    }
    // 补充未知插件的本地存储卡片（非主程序且不在插件列表）
    try {
      const known = new Set((Array.isArray(plugins) ? plugins : []).map((p) => String(p.id || p.name)));
      const listed = await window.settingsAPI?.configListScopes?.();
      const reserved = new Set(['system','automation']);
      const unknownScopes = (Array.isArray(listed) ? listed : []).filter((s) => !reserved.has(s) && !known.has(s));
      for (const s of unknownScopes) {
        const vals = await window.settingsAPI?.configGetAll?.(s);
        const hasVals = vals && Object.keys(vals).length > 0;
        if (!hasVals) continue;
        scopes.push({ id: s, name: `未知插件（${s}）`, icon: 'ri-question-line', schema: null, values: vals, kind: 'unknown' });
      }
    } catch (e) {}
    return scopes;
  }

  function normalizeSchema(schema, values) {
    if (Array.isArray(schema)) return schema;
    if (schema && typeof schema === 'object') {
      const out = [];
      Object.keys(schema).forEach((key) => {
        const def = schema[key] || {};
        out.push({ key, type: def.type || inferType(values[key]), label: def.label || key, desc: def.desc || def.description || '', options: def.options || undefined, default: def.default });
      });
      return out;
    }
    const out = [];
    Object.keys(values || {}).forEach((key) => {
      const v = values[key];
      out.push({ key, type: inferType(v), label: key, desc: '', options: undefined, default: undefined });
    });
    return out;
  }

  function inferType(v) {
    const t = typeof v;
    if (t === 'boolean') return 'boolean';
    if (t === 'number') return 'number';
    if (t === 'string') return 'string';
    if (Array.isArray(v) || (v && t === 'object')) return 'json';
    return 'string';
  }

  function renderJsonEditor(rootVal) {
    const container = document.createElement('div');
    container.className = 'json-editor';
    let current = (typeof rootVal === 'object' && rootVal !== null) ? JSON.parse(JSON.stringify(rootVal)) : rootVal;

    const buildNode = (key, value, path = []) => {
      const node = document.createElement('div');
      node.className = 'json-node';
      const header = document.createElement('div'); header.className = 'json-header';
      const toggle = document.createElement('button'); toggle.className = 'icon-btn json-toggle'; toggle.innerHTML = '<i class="ri-arrow-right-s-line"></i>';
      const title = document.createElement('div'); title.className = 'json-key'; title.textContent = key ?? '(root)';
      header.appendChild(toggle); header.appendChild(title);
      node.appendChild(header);
      const children = document.createElement('div'); children.className = 'json-children'; children.style.display = 'none';
      node.appendChild(children);

      const setAtPath = (p, val) => {
        let cur = current;
        for (let i = 0; i < p.length - 1; i++) { cur = cur[p[i]]; }
        cur[p[p.length - 1]] = val;
      };

      const isObj = value && typeof value === 'object' && !Array.isArray(value);
      const isArr = Array.isArray(value);
      if (!isObj && !isArr) {
        // primitive editor
        const action = document.createElement('div'); action.className = 'json-leaf-actions';
        let input;
        const t = typeof value;
        if (t === 'boolean') {
          const wrap = document.createElement('label'); wrap.className = 'switch';
          input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!value;
          const slider = document.createElement('span'); slider.className = 'slider';
          wrap.appendChild(input); wrap.appendChild(slider); action.appendChild(wrap);
          input.addEventListener('change', () => { setAtPath(path, !!input.checked); });
        } else if (t === 'number') {
          input = document.createElement('input'); input.type = 'number'; input.value = Number(value ?? 0);
          action.appendChild(input);
          input.addEventListener('change', () => { setAtPath(path, Number(input.value)); });
        } else {
          input = document.createElement('input'); input.type = 'text'; input.value = String(value ?? '');
          action.appendChild(input);
          input.addEventListener('change', () => { setAtPath(path, String(input.value)); });
        }
        node.appendChild(action);
        // leaf: no toggle
        toggle.style.visibility = 'hidden';
      } else {
        // build children
        const entries = isArr ? value.map((v, idx) => [String(idx), v]) : Object.entries(value);
        entries.forEach(([k, v]) => {
          const child = buildNode(k, v, path.concat(isArr ? Number(k) : k));
          children.appendChild(child);
        });
        // toggle expand/collapse
        toggle.addEventListener('click', (e) => {
          e.stopPropagation();
          const open = children.style.display === 'none';
          children.style.display = open ? '' : 'none';
          const i = toggle.querySelector('i'); if (i) i.className = open ? 'ri-arrow-down-s-line' : 'ri-arrow-right-s-line';
        });
      }
      return node;
    };

    const root = buildNode(null, current, Array.isArray(current) || (current && typeof current === 'object') ? [] : ['']);
    container.appendChild(root);
    return { el: container, getValue: () => current };
  }

  function renderScope(scope) {
    const card = document.createElement('div');
    card.className = 'plugin-card';
    const defs = normalizeSchema(scope.schema, scope.values);
    const iconCls = scope.icon || (scope.id === 'system' ? 'ri-settings-3-line' : 'ri-puzzle-line');
    const header = `
      <div class="card-header">
        <i class="${iconCls}"></i>
        <div>
          <div class="card-title">${scope.name} <span class="pill small">${scope.id}</span></div>
          <div class="card-desc">${defs.length} 项</div>
        </div>
      </div>
    `;
    card.innerHTML = header;
    // 移除列表卡片上的数组/对象展开按钮与区域，改在编辑模态中提供树视图
    const open = async () => {
      const content = document.createElement('div');
      content.classList.add('modal-body', 'config-editor');
      const form = document.createElement('div');
      form.className = 'form';
      defs.forEach((def) => {
        const row = document.createElement('div'); row.className = 'setting-item';
        const icon = document.createElement('div'); icon.className = 'setting-icon'; icon.innerHTML = '<i class="ri-settings-2-line"></i>';
        const main = document.createElement('div'); main.className = 'setting-main';
        const title = document.createElement('div'); title.className = 'setting-title'; title.textContent = def.label || def.key;
        const desc = document.createElement('div'); desc.className = 'setting-desc'; desc.textContent = def.desc || '';
        main.appendChild(title); main.appendChild(desc);
        const action = document.createElement('div'); action.className = 'setting-action';
        const key = def.key; const current = scope.values[key];
        if (def.type === 'json') {
          const btn = document.createElement('button'); btn.className = 'btn secondary'; btn.innerHTML = '<i class="ri-edit-2-line"></i> 编辑';
          btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const body = document.createElement('div'); body.classList.add('modal-body','config-editor');
            const editor = renderJsonEditor(current ?? def.default ?? {});
            body.appendChild(editor.el);
            const ok = await showModal({ title: `编辑 ${def.label || key}`, message: body, confirmText: '保存', cancelText: '取消', boxClass: 'config-wide-modal', stack: true });
            if (!ok) return;
            const val = editor.getValue();
            if (scope.id === 'system') await window.settingsAPI?.configSet?.('system', key, val);
            else if (scope.kind === 'plugin') await window.settingsAPI?.configPluginSet?.(scope.id, key, val);
            else await window.settingsAPI?.configSet?.(scope.id, key, val);
            scope.values[key] = val; showToast(`已保存 ${key}`, { type: 'success', duration: 1200 });
          });
          action.appendChild(btn);
        } else {
          let input;
          if (def.type === 'boolean') {
            const sw = document.createElement('label'); sw.className = 'switch';
            input = document.createElement('input'); input.type = 'checkbox'; input.checked = !!current;
            const slider = document.createElement('span'); slider.className = 'slider';
            sw.appendChild(input); sw.appendChild(slider); action.appendChild(sw);
          } else if (def.type === 'number') {
            input = document.createElement('input'); input.type = 'number'; input.value = Number(current ?? def.default ?? 0); action.appendChild(input);
          } else if (def.type === 'select' && Array.isArray(def.options)) {
            input = document.createElement('select');
            def.options.forEach((opt) => { const o = document.createElement('option'); if (typeof opt === 'object') { o.value = String(opt.value); o.textContent = opt.label || String(opt.value); } else { o.value = String(opt); o.textContent = String(opt); } input.appendChild(o); });
            const val0 = current ?? def.default ?? (def.options[0] && (typeof def.options[0]==='object'? def.options[0].value : def.options[0])); input.value = String(val0 ?? ''); action.appendChild(input);
          } else {
            input = document.createElement('input'); input.type = 'text'; input.value = String(current ?? def.default ?? ''); action.appendChild(input);
          }
          const handler = async () => {
            try {
              let valRaw;
              if (input.type === 'checkbox') valRaw = !!input.checked; else valRaw = input.value;
              let val = valRaw; if (def.type === 'number') val = Number(valRaw); if (def.type === 'boolean') val = !!valRaw;
              if (scope.id === 'system') await window.settingsAPI?.configSet?.('system', key, val);
              else if (scope.kind === 'plugin') await window.settingsAPI?.configPluginSet?.(scope.id, key, val);
              else await window.settingsAPI?.configSet?.(scope.id, key, val);
              scope.values[key] = val; showToast(`已保存 ${key}`, { type: 'success', duration: 1200 });
            } catch (e) {}
          };
          if (input.type === 'text' || input.type === 'number') { input.addEventListener('change', handler); }
          else if (input.type === 'checkbox') { input.addEventListener('change', handler); }
          else { input.addEventListener('change', handler); }
        }
        row.appendChild(icon);
        row.appendChild(main);
        row.appendChild(action);
        form.appendChild(row);
      });
      content.appendChild(form);
      // 若为未知作用域，提供迁移按钮
      if (scope.kind === 'unknown') {
        const actionsTop = document.createElement('div'); actionsTop.className = 'card-actions';
        const migrateBtn = document.createElement('button'); migrateBtn.className = 'btn danger'; migrateBtn.innerHTML = '<i class="ri-swap-box-line"></i> 迁移到已知插件';
        actionsTop.appendChild(migrateBtn);
        content.insertBefore(actionsTop, content.firstChild);
        migrateBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          // 选择目标插件
          const list = await window.settingsAPI?.getPlugins?.();
          const body = document.createElement('div'); body.classList.add('modal-body');
          const select = document.createElement('select');
          (Array.isArray(list) ? list : []).forEach((p) => { const o = document.createElement('option'); o.value = p.id || p.name; o.textContent = p.name || p.id; select.appendChild(o); });
          body.appendChild(select);
          const okSel = await showModal({ title: '选择目标插件', message: body, confirmText: '确定', cancelText: '取消', boxClass: 'config-wide-modal', stack: true });
          if (!okSel) return;
          const target = select.value;
          const sure = await showModal({ title: '确认迁移', message: `将当前作用域（${scope.id}）配置迁移到插件 ${target}？`, confirmText: '迁移', cancelText: '取消', stack: true });
          if (!sure) return;
          const res = await window.settingsAPI?.configPluginMigrateScope?.(scope.id, target, true);
          if (res?.ok) { showToast('迁移完成', { type: 'success', duration: 1500 }); }
          else { showToast(`迁移失败：${res?.error || '未知错误'}`, { type: 'error', duration: 2000 }); }
        });
      }
      await showModal({ title: `配置项 — ${scope.name}`, message: content, confirmText: '关闭', cancelText: null });
    };
    card.addEventListener('click', open);
    card.addEventListener('contextmenu', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (scope.id === 'system') {
        showToast('主程序配置不可删除', { type: 'error' });
        return;
      }
      const sure = await showModal({
        title: '删除配置',
        message: `确定要删除 "${scope.name}" (${scope.id}) 的所有配置吗？\n此操作将清空该组所有已保存的设置项，且不可恢复。`,
        confirmText: '删除',
        cancelText: '取消',
        stack: true
      });
      if (sure) {
        try {
          await window.settingsAPI?.configDeleteScope?.(scope.id);
          showToast(`已删除 ${scope.name} 配置`, { type: 'success' });
          cached = await loadAll();
          await render(cached, searchInput?.value || '');
        } catch (err) {
          showToast(`删除失败: ${err.message}`, { type: 'error' });
        }
      }
    });
    return card;
  }

  async function render(scopes, keyword) {
    listEl.innerHTML = '';
    const kw = String(keyword || '').trim().toLowerCase();
    const items = scopes.filter((s) => {
      if (!kw) return true;
      if (String(s.name || '').toLowerCase().includes(kw)) return true;
      const keys = Object.keys(s.values || {});
      return keys.some(k => k.toLowerCase().includes(kw));
    }).filter((s) => (Array.isArray(s.schema) || (s.schema && typeof s.schema === 'object')) || (Object.keys(s.values || {}).length > 0));
    emptyEl.hidden = items.length > 0;
    items.forEach((s) => listEl.appendChild(renderScope(s)));
  }

  let cached = await loadAll();
  await render(cached, '');
  searchBtn?.addEventListener('click', async () => { await render(cached, searchInput?.value || ''); });
  refreshBtn?.addEventListener('click', async () => { cached = await loadAll(); await render(cached, searchInput?.value || ''); });
}
  const systemDefaults = {
    quoteSource: 'hitokoto',
    quoteApiUrl: 'https://v1.hitokoto.cn/',
    localQuotes: [],
    splashEnabled: true,
    splashQuoteEnabled: true,
    splashBgStyle: 'default',
    splashProgramName: 'OrbiBoard',
    splashProgramDesc: '插件化大屏课堂辅助工具',
    autostartEnabled: false,
    autostartHigh: false,
    preciseTimeEnabled: false,
    ntpServer: 'ntp.aliyun.com',
    timeOffset: 0,
    autoOffsetDaily: 0,
    offsetBaseDate: new Date().toISOString().slice(0, 10),
    semesterStart: new Date().toISOString().slice(0, 10),
    biweekOffset: false,
    serviceBase: 'http://localhost:3030/',
    timeZone: 'Asia/Shanghai'
  };

  const systemSchema = {
    splashEnabled: { type: 'boolean', label: '启用启动页', desc: '应用启动时显示加载页面', default: systemDefaults.splashEnabled },
    splashQuoteEnabled: { type: 'boolean', label: '显示名言', desc: '在启动页展示名言语句', default: systemDefaults.splashQuoteEnabled },
    splashBgStyle: { type: 'select', label: '背景样式', desc: '启动页背景主题', options: ['default','blue','black'], default: systemDefaults.splashBgStyle },
    splashProgramName: { type: 'string', label: '程序名称', desc: '启动页主标题', default: systemDefaults.splashProgramName },
    splashProgramDesc: { type: 'string', label: '副标题/描述', desc: '启动页副标题', default: systemDefaults.splashProgramDesc },
    quoteSource: { type: 'select', label: '名言来源', desc: 'Hitokoto / EngQuote / 本地列表 / 自定义地址', options: ['hitokoto','engquote','local','custom'], default: systemDefaults.quoteSource },
    quoteApiUrl: { type: 'string', label: '自定义API地址', desc: '在“自定义地址”来源下用于获取名言', default: systemDefaults.quoteApiUrl },
    localQuotes: { type: 'json', label: '本地名言列表', desc: '数组：{ text, from }', default: systemDefaults.localQuotes },
    autostartEnabled: { type: 'boolean', label: '开机自启动', desc: '系统登录后自动启动应用', default: systemDefaults.autostartEnabled },
    preciseTimeEnabled: { type: 'boolean', label: '使用精确时间', desc: '启用后通过NTP获取时间', default: systemDefaults.preciseTimeEnabled },
    ntpServer: { type: 'string', label: 'NTP服务器', desc: '如 ntp.aliyun.com', default: systemDefaults.ntpServer },
    semesterStart: { type: 'string', label: '学期开始日期', desc: '用于单双周判断与时间偏移基准（YYYY-MM-DD）', default: systemDefaults.semesterStart },
    biweekOffset: { type: 'boolean', label: '单双周偏移', desc: '从下周开始（反转单双周）', default: systemDefaults.biweekOffset },
    timeOffset: { type: 'number', label: '时间偏移（秒）', desc: '对当前时间进行加减，负数为减', default: systemDefaults.timeOffset },
    autoOffsetDaily: { type: 'number', label: '自动时间偏移（秒/天）', desc: '每天自动叠加该偏移值', default: systemDefaults.autoOffsetDaily },
    timeZone: { type: 'string', label: '时区', desc: '用于时间显示的时区（如 Asia/Shanghai）', default: systemDefaults.timeZone },
    serviceBase: { type: 'string', label: '在线服务地址', desc: '功能市场/更新等，例如 http://localhost:3030/', default: systemDefaults.serviceBase }
  };
