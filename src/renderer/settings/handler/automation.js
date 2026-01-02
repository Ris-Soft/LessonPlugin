
// 自动执行：列表与编辑器
async function initAutomationSettings() {
  const listEl = document.getElementById('auto-list');
  const editorEl = document.getElementById('auto-editor');
  const addBtn = document.getElementById('auto-add');
  const filterBar = document.getElementById('auto-filters');
  const filterToggle = document.getElementById('auto-filters-toggle');
  let selectedSources = new Set(['user', 'plugin']);
  let filterEnabled = 'all';

  const syncFilterChipSelection = () => {
    if (!filterBar) return;
    // 来源：多选（用户/插件/快捷）
    [...filterBar.querySelectorAll('[data-filter-source]')].forEach(el => {
      if (selectedSources.has(el.dataset.filterSource)) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
    // 启用状态：单选（不限/已启用/未启用）
    [...filterBar.querySelectorAll('[data-filter-enabled]')].forEach(el => {
      if (el.dataset.filterEnabled === filterEnabled) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
  };

  const updateFilterToggleText = () => {
    if (!filterToggle) return;
    filterToggle.innerHTML = filterBar.hidden
      ? '<i class="ri-filter-3-line"></i> 筛选'
      : '<i class="ri-arrow-up-s-line"></i> 收起';
  };

  if (filterToggle && filterBar) {
    updateFilterToggleText();
    filterToggle.onclick = () => {
      filterBar.hidden = !filterBar.hidden;
      updateFilterToggleText();
      // 展开时同步显示默认选中状态
      if (!filterBar.hidden) syncFilterChipSelection();
    };
  }

  if (filterBar) {
    // 初始化选中状态（默认：来源选用户/插件，启用不限）
    syncFilterChipSelection();
    filterBar.onclick = (e) => {
      const t = e.target;
      if (!(t instanceof HTMLElement)) return;
      if (t.classList.contains('chip')) {
        if (t.dataset.filterSource !== undefined) {
          const v = t.dataset.filterSource;
          if (selectedSources.has(v)) {
            selectedSources.delete(v);
            t.classList.remove('selected');
          } else {
            selectedSources.add(v);
            t.classList.add('selected');
          }
        }
        if (t.dataset.filterEnabled !== undefined) {
          filterEnabled = t.dataset.filterEnabled;
          [...filterBar.querySelectorAll('[data-filter-enabled]')].forEach(el => el.classList.remove('selected'));
          t.classList.add('selected');
        }
        renderList();
      }
    };
  }

  const summarize = (item) => {
    const triggers = (item.triggers || []).map((t) => t.type === 'time' ? `时间 ${t.at}` : (t.type === 'protocol' ? `协议 ${t.text}` : t.type)).join('，');
    return triggers || '未设置触发条件';
  };

  const renderList = async (selectedId) => {
    const allItems = await window.settingsAPI?.automationList?.() || [];
    const filteredItems = allItems.filter((it) => {
      const src = String(it.source || '');
      const enabled = !!it.enabled;
      const sourceOk = (selectedSources.size === 0)
        || (selectedSources.has('user') && src === 'user')
        || (selectedSources.has('plugin') && src.startsWith('plugin'))
        || (selectedSources.has('shortcut') && src === 'shortcut');
      const enabledOk = (filterEnabled === 'all') || (filterEnabled === 'enabled' && enabled) || (filterEnabled === 'disabled' && !enabled);
      return sourceOk && enabledOk;
    });
    listEl.innerHTML = '';
    filteredItems.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'auto-item';
      const src = String(it.source || '');
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
          editorEl.innerHTML = '<div class="auto-editor-empty">从左侧选择任务或新建</div>';
          editorEl.className = 'auto-editor';
        }
      });
      row.addEventListener('click', () => renderEditor(it.id));
      listEl.appendChild(row);
    });
    if (selectedId) {
      const idx = allItems.findIndex((x) => x.id === selectedId);
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
        [['time', '时间'], ['protocol', '协议']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; typeSel.appendChild(o); });
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
        del.addEventListener('click', () => { it.triggers.splice(idx, 1); updateTrigList(); });
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
    const topModeSel = document.createElement('select');['且（AND）', '或（OR）'].forEach((l, i) => { const o = document.createElement('option'); o.value = i === 0 ? 'and' : 'or'; o.textContent = l; topModeSel.appendChild(o); });
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
        const modeSel = document.createElement('select');['且（AND）', '或（OR）'].forEach((l, i) => { const o = document.createElement('option'); o.value = i === 0 ? 'and' : 'or'; o.textContent = l; modeSel.appendChild(o); });
        modeSel.value = g.mode === 'or' ? 'or' : 'and';
        const addCondBtn = document.createElement('button'); addCondBtn.className = 'btn secondary'; addCondBtn.innerHTML = '<i class="ri-add-line"></i> 添加条件';
        const delGroupBtn = document.createElement('button'); delGroupBtn.className = 'btn secondary'; delGroupBtn.innerHTML = '<i class="ri-delete-bin-line"></i>';
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
              ['alwaysTrue', '始终为真'],
              ['alwaysFalse', '始终为假'],
              ['timeEquals', '当前时间为（HH:MM）'],
              ['weekdayIn', '今天是星期（1-7）'],
              ['monthIn', '今天是几月（1-12）'],
              ['dayIn', '今天是几号（1-31）'],
              ['biweek', '单双周（需设置学期开始日期）'],
              // ['selectedWindowName','当前选中窗口名称包含'],
              // ['selectedProcess','当前选中窗口进程为']
            ].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; typeSel.appendChild(o); });
            typeSel.value = c.type || 'timeEquals';
            const editorWrap = document.createElement('div'); editorWrap.className = 'cond-editor';
            const negate = document.createElement('label'); negate.className = 'negate'; negate.innerHTML = '<input type="checkbox" /> 反条件';
            negate.querySelector('input').checked = !!c.negate;
            const delBtn = document.createElement('span'); delBtn.className = 'del'; delBtn.innerHTML = '<i class="ri-delete-bin-line"></i>';
            // 当前状态评估（与主进程逻辑一致）
            const evalCond = async () => {
              const d = new Date();
              const weekday = d.getDay() === 0 ? 7 : d.getDay();
              const month = d.getMonth() + 1;
              const dom = d.getDate();
              const semStart = await (window.settingsAPI?.configGet?.('system', 'semesterStart'));
              const offsetBase = await (window.settingsAPI?.configGet?.('system', 'offsetBaseDate'));
              const biweekOff = await (window.settingsAPI?.configGet?.('system', 'biweekOffset'));
              const base = semStart || offsetBase;
              let isEvenWeek = null;
              if (base) {
                try {
                  const baseDate = new Date(String(base) + 'T00:00:00');
                  const diffDays = Math.floor((d - baseDate) / (24 * 3600 * 1000));
                  const weekIndex = Math.floor(diffDays / 7);
                  isEvenWeek = weekIndex % 2 === 0;
                  if (biweekOff) isEvenWeek = !isEvenWeek;
                } catch (e) { }
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
              } catch (e) { }
            };
            const renderEditor = () => {
              editorWrap.innerHTML = '';
              const t = typeSel.value;
              const needValue = !(t === 'alwaysTrue' || t === 'alwaysFalse');
              if (!needValue) {
                const tip = document.createElement('span'); tip.className = 'muted'; tip.textContent = '无需填写';
                editorWrap.appendChild(tip);
                return;
              }
              if (t === 'timeEquals') {
                const timeInput = document.createElement('input');
                timeInput.type = 'time';
                timeInput.step = '60';
                const v = (typeof c.value === 'string' && /\d{2}:\d{2}/.test(c.value)) ? c.value : '';
                timeInput.value = v;
                timeInput.placeholder = 'HH:MM';
                timeInput.addEventListener('change', () => { c.value = timeInput.value; updateStatus(); });
                editorWrap.appendChild(timeInput);
                return;
              }
              if (t === 'weekdayIn' || t === 'monthIn' || t === 'dayIn') {
                const editBtn = document.createElement('button'); editBtn.className = 'btn secondary'; editBtn.innerHTML = '<i class="ri-edit-2-line"></i> 编辑选项';
                const preview = document.createElement('span'); preview.className = 'editor-summary';
                const updatePreview = () => { preview.textContent = (Array.isArray(c.value) && c.value.length) ? ('已选：' + c.value.join(',')) : '已选：无'; };
                updatePreview();
                editBtn.addEventListener('click', async () => {
                  const res = await showCondEditorModal(t, c.value);
                  if (res !== null) { c.value = res; updatePreview(); updateStatus(); }
                });
                editorWrap.appendChild(editBtn);
                editorWrap.appendChild(preview);
                return;
              }
              if (t === 'biweek') {
                const optSel = document.createElement('select');
                [['even', '双周'], ['odd', '单周']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; optSel.appendChild(o); });
                optSel.value = (c.value === 'odd' || c.value === 'even') ? c.value : 'even';
                const preview = document.createElement('span'); preview.className = 'editor-summary';
                const updatePreview = () => { preview.textContent = '当前：' + (optSel.value === 'even' ? '双周' : '单周'); };
                optSel.addEventListener('change', () => { c.value = optSel.value; updatePreview(); updateStatus(); });
                updatePreview();
                editorWrap.appendChild(optSel);
                editorWrap.appendChild(preview);
                return;
              }
              // 默认回退到文本输入（兼容扩展类型）
              const txt = document.createElement('input'); txt.type = 'text';
              txt.placeholder = '值（逗号分隔或单值）';
              txt.value = Array.isArray(c.value) ? c.value.join(',') : (c.value || '');
              txt.addEventListener('change', () => {
                if (t.endsWith('In')) c.value = txt.value.split(',').map(s => parseInt(s, 10)).filter(n => !isNaN(n));
                else c.value = txt.value.trim();
                updateStatus();
              });
              editorWrap.appendChild(txt);
            };
            typeSel.addEventListener('change', () => {
              c.type = typeSel.value;
              renderEditor();
              updateStatus();
            });
            negate.querySelector('input').addEventListener('change', (e) => { c.negate = !!e.target.checked; updateStatus(); });
            delBtn.addEventListener('click', () => { g.items.splice(ci, 1); renderConds(); });
            // 初始渲染编辑器
            renderEditor();
            row.appendChild(statusDot); row.appendChild(typeSel); row.appendChild(editorWrap); row.appendChild(negate); row.appendChild(delBtn);
            condList.appendChild(row);
            // 初次渲染更新一次状态
            updateStatus();
            // 注册到全局刷新列表
            allCondUpdateFns.push(updateStatus);
          });
        };
        addCondBtn.addEventListener('click', () => { g.items = g.items || []; g.items.push({ type: 'timeEquals', value: '08:00', negate: false }); renderConds(); });
        delGroupBtn.addEventListener('click', () => { (it.conditions.groups || []).splice(gi, 1); renderGroups(); });
        modeSel.addEventListener('change', () => { g.mode = modeSel.value; });
        // 渲染组条件并重置定时器
        renderConds();
        box.appendChild(condList);
        groupsWrap.appendChild(box);
      });
      try { if (condStatusTimer) clearInterval(condStatusTimer); } catch (e) { }
      condStatusTimer = setInterval(() => { try { allCondUpdateFns.forEach(fn => fn && fn()); } catch (e) { } }, 30 * 1000);
    };
    addGroupBtn.addEventListener('click', () => { it.conditions = it.conditions || { mode: 'and', groups: [] }; it.conditions.groups.push({ mode: 'and', items: [] }); renderGroups(); });
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
    const addActBtn = document.createElement('button'); addActBtn.className = 'btn secondary'; addActBtn.innerHTML = '<i class="ri-add-line"></i> 添加动作';
    const renderActs = () => {
      actList.innerHTML = '';
      (it.actions || []).forEach((a, ai) => {
        const row = document.createElement('div'); row.className = 'action-row';
        const typeSel = document.createElement('select');
        [
          ['pluginEvent', '插件功能'],
          ['pluginAction', '插件动作'],
          ['power', '电源功能'],
          ['openApp', '打开应用程序'],
          ['cmd', '执行CMD命令'],
          ['wait', '等待时长']
        ].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; typeSel.appendChild(o); });
        typeSel.value = a.type || 'pluginEvent';
        const cfg = document.createElement('div');
        const delBtn = document.createElement('button'); delBtn.className = 'btn secondary'; delBtn.innerHTML = '<i class="ri-delete-bin-line"></i>';

        const renderCfg = async () => {
          cfg.innerHTML = '';
          if (typeSel.value === 'pluginEvent') {
            const plugSel = document.createElement('select');
            const plugins = await window.settingsAPI?.getPlugins?.() || [];
            plugins.forEach(p => { const o = document.createElement('option'); o.value = (p.id || p.name); o.textContent = p.name; plugSel.appendChild(o); });
            plugSel.value = a.pluginId || (plugins[0]?.id || plugins[0]?.name) || '';
            const evSel = document.createElement('select');
            // 首次加载事件列表
            const loadEvents = async (plugKey) => {
              const res = await window.settingsAPI?.pluginAutomationListEvents?.(plugKey);
              const list = Array.isArray(res?.events) ? res.events : (Array.isArray(res) ? res : []);
              evSel.innerHTML = '';
              list.forEach(e => { const o = document.createElement('option'); o.value = e.name; o.textContent = (e.desc || e.title || e.name); evSel.appendChild(o); });
              return list;
            };
            let evs = await loadEvents(plugSel.value);
            evSel.value = a.event || evs[0]?.name || '';
            // 立即写入，确保act包含pluginId与event
            a.pluginId = plugSel.value;
            a.event = evSel.value;
            const editParams = document.createElement('button'); editParams.className = 'btn secondary'; editParams.innerHTML = '<i class="ri-edit-2-line"></i> 编辑参数数组';
            const paramsPreview = document.createElement('div'); paramsPreview.className = 'muted'; paramsPreview.textContent = `参数项数：${Array.isArray(a.params) ? a.params.length : 0}`;
            plugSel.addEventListener('change', async () => {
              a.pluginId = plugSel.value;
              evs = await loadEvents(plugSel.value);
              a.event = evSel.value = evs[0]?.name || '';
              // 切换插件后，参数预览清零（防止参数与事件不匹配）
              a.params = Array.isArray(a.params) ? a.params : [];
              paramsPreview.textContent = `参数项数：${a.params.length}`;
            });
            evSel.addEventListener('change', () => {
              a.event = evSel.value;
              // 切换事件后，仅重置预览；保留现有参数由用户自行调整
              paramsPreview.textContent = `参数项数：${Array.isArray(a.params) ? a.params.length : 0}`;
            });
            editParams.onclick = async () => {
              // 点击时按当前选择的插件与事件动态加载参数定义
              const curRes = await window.settingsAPI?.pluginAutomationListEvents?.(plugSel.value);
              const curEvs = Array.isArray(curRes?.events) ? curRes.events : (Array.isArray(curRes) ? curRes : []);
              const def = curEvs.find(e => e.name === evSel.value);
              const defs = Array.isArray(def?.params) ? def.params : [];
              const resEdit = await showParamsEditorForEvent(defs, Array.isArray(a.params) ? a.params : [], plugSel.value);
              if (Array.isArray(resEdit)) { a.params = resEdit; paramsPreview.textContent = `参数项数：${resEdit.length}`; }
            };
            cfg.appendChild(plugSel); cfg.appendChild(evSel); cfg.appendChild(editParams); cfg.appendChild(paramsPreview);
          } else if (typeSel.value === 'pluginAction') {
            // 选择插件 + 选择该插件在 plugin.json 中声明的 actions
            const plugSel = document.createElement('select');
            const plugins = await window.settingsAPI?.getPlugins?.() || [];
            plugins.forEach(p => { const o = document.createElement('option'); o.value = (p.id || p.name); o.textContent = p.name; plugSel.appendChild(o); });
            plugSel.value = a.pluginId || (plugins[0]?.id || plugins[0]?.name) || '';
            const actSel = document.createElement('select');
            const loadActions = (plugKey) => {
              const target = plugins.find(pp => (pp.id === plugKey) || (pp.name === plugKey));
              const acts = Array.isArray(target?.actions) ? target.actions : [];
              actSel.innerHTML = '';
              acts.forEach(ac => { const o = document.createElement('option'); o.value = (ac.id || ac.target || ''); o.textContent = (ac.text || ac.id || ac.target || '动作'); actSel.appendChild(o); });
              return acts;
            };
            let acts = loadActions(plugSel.value);
            // 立即写入，确保 act 包含 pluginId 与 target
            const first = acts[0] || null;
            a.pluginId = plugSel.value;
            if (!a.target && first) { a.target = first.target || first.id || ''; }
            actSel.value = a.action || a.target || (first?.id || first?.target || '');
            const editParams = document.createElement('button'); editParams.className = 'btn secondary'; editParams.innerHTML = '<i class="ri-edit-2-line"></i> 编辑参数数组';
            const paramsPreview = document.createElement('div'); paramsPreview.className = 'muted'; paramsPreview.textContent = `参数项数：${Array.isArray(a.params) ? a.params.length : 0}`;
            plugSel.addEventListener('change', () => {
              a.pluginId = plugSel.value;
              acts = loadActions(plugSel.value);
              const first = acts[0] || null;
              a.action = actSel.value = (first?.id || first?.target || '');
              a.target = first?.target || a.action || '';
              // 切换插件后，使用该动作的默认参数（如有），否则清零
              const defArgs = Array.isArray(first?.args) ? first.args : [];
              a.params = defArgs.map(x => x);
              paramsPreview.textContent = `参数项数：${a.params.length}`;
            });
            actSel.addEventListener('change', () => {
              const cur = acts.find(x => (x.id === actSel.value) || (x.target === actSel.value));
              a.action = actSel.value;
              a.target = cur?.target || actSel.value;
              // 切换动作后，使用动作默认参数（如有），不保留旧参数以避免不匹配
              const defArgs = Array.isArray(cur?.args) ? cur.args : [];
              a.params = defArgs.map(x => x);
              paramsPreview.textContent = `参数项数：${a.params.length}`;
            });
            editParams.onclick = async () => {
              const resEdit = await showParamsEditor(Array.isArray(a.params) ? a.params : [], plugSel.value);
              if (Array.isArray(resEdit)) { a.params = resEdit; paramsPreview.textContent = `参数项数：${resEdit.length}`; }
            };
            cfg.appendChild(plugSel); cfg.appendChild(actSel); cfg.appendChild(editParams); cfg.appendChild(paramsPreview);
          } else if (typeSel.value === 'power') {
            const opSel = document.createElement('select');[['shutdown', '关机'], ['restart', '重启'], ['logoff', '注销']].forEach(([v, l]) => { const o = document.createElement('option'); o.value = v; o.textContent = l; opSel.appendChild(o); }); opSel.value = a.op || 'shutdown'; opSel.addEventListener('change', () => { a.op = opSel.value; }); cfg.appendChild(opSel);
          } else if (typeSel.value === 'openApp') {
            const p = document.createElement('input'); p.type = 'text'; p.placeholder = '可执行文件路径'; p.value = a.path || ''; p.addEventListener('change', () => { a.path = p.value; }); cfg.appendChild(p);
          } else if (typeSel.value === 'cmd') {
            const c = document.createElement('input'); c.type = 'text'; c.placeholder = '命令行（将在Shell中执行）'; c.value = a.command || ''; c.addEventListener('change', () => { a.command = c.value; }); cfg.appendChild(c);
          } else if (typeSel.value === 'wait') {
            const s = document.createElement('input'); s.type = 'number'; s.min = '0'; s.step = '1'; s.placeholder = '秒数'; s.value = (Number.isFinite(a.seconds) ? a.seconds : 1);
            s.addEventListener('change', () => { const v = parseInt(s.value || '0', 10); a.seconds = Math.max(0, isNaN(v) ? 0 : v); });
            cfg.appendChild(s);
          }
        };
        typeSel.addEventListener('change', () => { a.type = typeSel.value; renderCfg(); });
        delBtn.addEventListener('click', () => { it.actions.splice(ai, 1); renderActs(); });
        row.appendChild(typeSel); row.appendChild(cfg); row.appendChild(delBtn);
        actList.appendChild(row);
        renderCfg();
      });
    };
    addActBtn.addEventListener('click', () => { it.actions = it.actions || []; it.actions.push({ type: 'pluginEvent', pluginId: '', event: '', params: [] }); renderActs(); });
    secAct.appendChild(addActBtn);
    secAct.appendChild(actList);
    // 初始渲染已有动作
    renderActs();
    editorEl.appendChild(secAct);

    // 执行前确认
    const secConf = document.createElement('div'); secConf.className = 'section';
    secConf.innerHTML = '<div class="section-title"><i class="ri-shield-check-line"></i> 执行前确认</div>';
    const confirmRow = document.createElement('div'); confirmRow.className = 'inline';

    // 测试执行按钮行为（忽略触发条件，仅按当前执行条件与确认流程执行）
    testBtn.addEventListener('click', async () => {
      try {
        // 在测试前先保存当前编辑配置，确保以最新配置执行
        const patched = {
          name: nameInput.value || it.name,
          triggers: it.triggers || [],
          conditions: it.conditions || { mode: 'and', groups: [] },
          actions: it.actions || [],
          confirm: { enabled: confirmEnabled.querySelector('input').checked, timeout: parseInt(timeoutInput.value || 60, 10) }
        };
        const upd = await window.settingsAPI?.automationUpdate?.(it.id, patched);
        if (!upd?.ok) { await showAlert('保存当前配置失败，无法测试'); return; }

        const res = await window.settingsAPI?.automationTest?.(id);
        if (!res?.ok) { await showAlert(res?.error || '测试执行失败'); return; }
        if (res.executed) {
          await showAlert('测试执行完成。已执行配置的动作。');
          await renderEditor(id);
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
    const confirmEnabled = document.createElement('label'); confirmEnabled.className = 'switch'; confirmEnabled.innerHTML = `<input type="checkbox" ${it.confirm?.enabled !== false ? 'checked' : ''}/><span class="slider"></span>`;
    const timeoutInput = document.createElement('input'); timeoutInput.type = 'number'; timeoutInput.step = '1'; timeoutInput.value = parseInt(it.confirm?.timeout || 60, 10);
    const timeoutLabel = document.createElement('label'); timeoutLabel.textContent = '确认超时时间（秒）'; timeoutLabel.style.color = 'var(--muted)';
    confirmRow.appendChild(confirmEnabled); confirmRow.appendChild(timeoutLabel); confirmRow.appendChild(timeoutInput);
    secConf.appendChild(confirmRow);
    editorEl.appendChild(secConf);

    // 任务信息（底部）
    const secMeta = document.createElement('div'); secMeta.className = 'section';
    secMeta.innerHTML = '<div class="section-title"><i class="ri-information-line"></i> 任务信息</div>';
    const metaList = document.createElement('div');
    metaList.className = 'inline';
    const sourceText = (() => {
      const s = String(it.source || '');
      if (s === 'user') return '用户';
      if (s === 'shortcut') return '快捷';
      if (s.startsWith('plugin')) return '插件';
      return '—';
    })();
    let tz = 'Asia/Shanghai';
    try { const v = await window.settingsAPI?.configGet?.('system', 'timeZone'); if (v) tz = String(v); } catch (e) {}
    const formatDateTimeTZ = (d) => {
      try {
        const parts = new Intl.DateTimeFormat('zh-CN', {
          timeZone: tz,
          hour12: false,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit'
        }).formatToParts(d);
        const get = (t) => parts.find(p => p.type === t)?.value || '';
        const y = get('year');
        const m = get('month');
        const day = get('day');
        const hh = get('hour');
        const mm = get('minute');
        const ss = get('second');
        return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
      } catch (e) { return d.toLocaleString(); }
    };
    const lastText = it.lastSuccessAt ? formatDateTimeTZ(new Date(it.lastSuccessAt)) : '—';
    const metaId = document.createElement('div'); metaId.className = 'muted'; metaId.textContent = 'ID：' + (it.id || '—');
    const metaSource = document.createElement('div'); metaSource.className = 'muted'; metaSource.textContent = '来源：' + sourceText;
    const metaLast = document.createElement('div'); metaLast.className = 'muted'; metaLast.textContent = '上次成功执行：' + lastText;
    metaList.appendChild(metaId); metaList.appendChild(metaSource); metaList.appendChild(metaLast);
    secMeta.appendChild(metaList);
    editorEl.appendChild(secMeta);

    // 源JSON编辑器（隐藏id，保存时强制覆盖为已有id；支持复制/粘贴）
    const secJson = document.createElement('div'); secJson.className = 'section';
    secJson.innerHTML = '<div class="section-title"><i class="ri-code-line"></i> 源JSON编辑器</div>';
    const jsonArea = document.createElement('textarea'); jsonArea.style.width = '95%'; jsonArea.style.minHeight = '180px'; jsonArea.style.marginTop = '10px'; jsonArea.style.fontFamily = 'var(--mono, monospace)'; jsonArea.spellcheck = false;
    const jsonActions = document.createElement('div'); jsonActions.className = 'inline';
    const btnRefresh = document.createElement('button'); btnRefresh.className = 'btn secondary'; btnRefresh.innerHTML = '<i class="ri-refresh-line"></i> 同步';
    const btnSaveJson = document.createElement('button'); btnSaveJson.className = 'btn primary'; btnSaveJson.innerHTML = '<i class="ri-save-3-line"></i> 保存';
    const btnCopy = document.createElement('button'); btnCopy.className = 'btn secondary'; btnCopy.innerHTML = '<i class="ri-file-copy-2-line"></i> 复制';
    const btnPaste = document.createElement('button'); btnPaste.className = 'btn secondary'; btnPaste.innerHTML = '<i class="ri-clipboard-line"></i> 粘贴';
    
    // 开发模式：发布按钮
    if (window.__isDev__) {
      const btnPublish = document.createElement('button'); 
      btnPublish.className = 'btn secondary'; 
      btnPublish.innerHTML = '<i class="ri-upload-cloud-2-line"></i> 发布';
      btnPublish.addEventListener('click', () => {
        window.publishResource && window.publishResource('automation', it);
      });
      jsonActions.appendChild(btnPublish);
    }

    const buildDisplay = () => {
      return {
        name: nameInput.value || it.name || '',
        triggers: it.triggers || [],
        conditions: it.conditions || { mode: 'and', groups: [] },
        actions: it.actions || [],
        confirm: { enabled: confirmEnabled.querySelector('input').checked, timeout: parseInt(timeoutInput.value || 60, 10) }
      };
    };
    const refreshJson = () => { try { jsonArea.value = JSON.stringify(buildDisplay(), null, 2); } catch (e) { } };
    refreshJson();

    btnRefresh.addEventListener('click', () => refreshJson());
    btnSaveJson.addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(jsonArea.value || '{}');
        const patched = {
          // 强制覆盖id为已有id
          id: it.id,
          name: typeof parsed.name === 'string' ? parsed.name : (nameInput.value || it.name),
          triggers: Array.isArray(parsed.triggers) ? parsed.triggers : (it.triggers || []),
          conditions: (parsed.conditions && typeof parsed.conditions === 'object') ? parsed.conditions : (it.conditions || { mode: 'and', groups: [] }),
          actions: Array.isArray(parsed.actions) ? parsed.actions : (it.actions || []),
          confirm: (parsed.confirm && typeof parsed.confirm === 'object') ? parsed.confirm : { enabled: confirmEnabled.querySelector('input').checked, timeout: parseInt(timeoutInput.value || 60, 10) }
        };
        const res = await window.settingsAPI?.automationUpdate?.(it.id, patched);
        if (!res?.ok) { await showAlert('保存失败'); return; }
        await renderList(it.id);
      } catch (e) {
        await showAlert('JSON解析失败：' + (e?.message || '未知错误'));
      }
    });
    btnCopy.addEventListener('click', async () => {
      try {
        const text = JSON.stringify({ id: it.id, ...buildDisplay() }, null, 2);
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        }
        await showAlert('已复制到剪贴板');
      } catch (e) {
        await showAlert('复制失败：' + (e?.message || '未知错误'));
      }
    });
    btnPaste.addEventListener('click', async () => {
      try {
        let text = '';
        if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
        if (!text) { await showAlert('剪贴板为空'); return; }
        const parsed = JSON.parse(text);
        const patched = {
          id: it.id,
          name: typeof parsed.name === 'string' ? parsed.name : it.name,
          triggers: Array.isArray(parsed.triggers) ? parsed.triggers : (it.triggers || []),
          conditions: (parsed.conditions && typeof parsed.conditions === 'object') ? parsed.conditions : (it.conditions || { mode: 'and', groups: [] }),
          actions: Array.isArray(parsed.actions) ? parsed.actions : (it.actions || []),
          confirm: (parsed.confirm && typeof parsed.confirm === 'object') ? parsed.confirm : (it.confirm || { enabled: true, timeout: 60 })
        };
        const res = await window.settingsAPI?.automationUpdate?.(it.id, patched);
        if (!res?.ok) { await showAlert('粘贴应用失败'); return; }
        await renderList(it.id);
        // 同步编辑器展示
        nameInput.value = patched.name || '';
        it.triggers = patched.triggers; it.conditions = patched.conditions; it.actions = patched.actions; it.confirm = patched.confirm;
        refreshJson();
      } catch (e) {
        await showAlert('粘贴解析失败：' + (e?.message || '未知错误'));
      }
    });

    jsonActions.appendChild(btnRefresh);
    jsonActions.appendChild(btnSaveJson);
    jsonActions.appendChild(btnCopy);
    jsonActions.appendChild(btnPaste);
    secJson.appendChild(jsonActions);
    secJson.appendChild(jsonArea);
    const jsonNote = document.createElement('div'); jsonNote.className = 'muted'; jsonNote.style.marginTop = '6px'; jsonNote.style.fontSize = '12px'; jsonNote.innerHTML = '提示：此处为自动化任务源 JSON 视图。保存时会保留当前任务 ID 并仅更新可编辑字段（name、triggers、conditions、actions、confirm）。请确保 JSON 格式正确，否则会提示解析错误。支持剪贴板复制与粘贴。';
    secJson.appendChild(jsonNote);
    editorEl.appendChild(secJson);

    // 保存
    saveBtn.addEventListener('click', async () => {
      const patched = {
        name: nameInput.value || it.name,
        triggers: it.triggers || [],
        conditions: it.conditions || { mode: 'and', groups: [] },
        actions: it.actions || [],
        confirm: { enabled: confirmEnabled.querySelector('input').checked, timeout: parseInt(timeoutInput.value || 60, 10) }
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
        const created = await window.settingsAPI?.automationCreate?.({ name: '新建自动化', source: 'user' });
        // automation:create 返回 { ok, item }，需使用 item.id 刷新并选中
        const newId = created?.item?.id || created?.id;
        await renderList(newId);
      } finally {
        addBtn.disabled = false;
      }
    });
  }

  await renderList();
}

window.AutomationView = window.AutomationView || {
  renderTriggersHTML: function (trigs) {
    const arr = Array.isArray(trigs) ? trigs : [];
    if (!arr.length) return '<div class="muted">无触发条件</div>';
    return '<ul>' + arr.map(function (t) {
      if (t.type === 'time') return `<li>时间：<code>${t.at || ''}</code></li>`;
      if (t.type === 'protocol') return `<li>协议：<code>${t.text || ''}</code></li>`;
      return `<li>${t.type || '未知'}</li>`;
    }).join('') + '</ul>';
  },
  renderConditionsHTML: function (conds) {
    const mode = (conds && conds.mode) === 'or' ? '或(OR)' : '且(AND)';
    const groups = (conds && Array.isArray(conds.groups)) ? conds.groups : [];
    if (!groups.length) return `<div class="muted">无条件（顶层: ${mode}）</div>`;
    const htmlGroups = groups.map(function (g, gi) {
      const gm = g.mode === 'or' ? '或(OR)' : '且(AND)';
      const items = Array.isArray(g.items) ? g.items : [];
      const itemsHtml = items.map(function (c) {
        const neg = c.negate ? '<span class="pill small danger">反</span> ' : '';
        const value = (c.value !== undefined) ? JSON.stringify(c.value) : '';
        return `<li>${neg}${c.type || '未知'} ${value ? `<code>${value}</code>` : ''}</li>`;
      }).join('');
      return `<div class="group"><div class="muted">条件组${gi + 1}（${gm}）</div><ul>${itemsHtml || '<li>空</li>'}</ul></div>`;
    }).join('');
    return `<div class="muted">顶层: ${mode}</div>${htmlGroups}`;
  },
  renderActionsHTML: function (acts) {
    const arr = Array.isArray(acts) ? acts : [];
    if (!arr.length) return '<div class="muted">无执行动作</div>';
    return '<ul>' + arr.map(function (a) {
      if (a.type === 'pluginEvent') return `<li>插件事件：<code>${a.pluginId || ''}</code> → <code>${a.event || ''}</code></li>`;
      if (a.type === 'pluginAction') return `<li>插件动作：<code>${a.pluginId || ''}</code> → <code>${a.target || a.action || ''}</code></li>`;
      if (a.type === 'power') return `<li>电源：<code>${a.op || ''}</code></li>`;
      if (a.type === 'openApp') return `<li>打开应用：<code>${a.path || ''}</code></li>`;
      if (a.type === 'cmd') return `<li>命令：<code>${a.command || ''}</code></li>`;
      if (a.type === 'wait') return `<li>等待：<code>${a.seconds || 0}</code> 秒</li>`;
      return `<li>${a.type || '未知'}</li>`;
    }).join('') + '</ul>';
  },
  renderSummaryHTML: function (autoJson) {
    const trigCount = Array.isArray(autoJson?.triggers) ? autoJson.triggers.length : 0;
    const condGroupCount = (autoJson?.conditions && Array.isArray(autoJson.conditions.groups)) ? autoJson.conditions.groups.length : 0;
    const actCount = Array.isArray(autoJson?.actions) ? autoJson.actions.length : 0;
    return `<div class="muted" style="margin-top:4px;">概览：触发 ${trigCount}、条件组 ${condGroupCount}、动作 ${actCount}</div>`;
  }
};