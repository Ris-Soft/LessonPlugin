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
          inp.addEventListener('change', () => { stu.name = inp.value; });
          td.appendChild(inp);
          td.className = 'col-name';
        } else if (col.key === 'gender') {
          const sel = document.createElement('select');
          [['','未选择'],['男','男'],['女','女']].forEach(([v,l])=>{const o=document.createElement('option'); o.value=v; o.textContent=l; sel.appendChild(o);});
          sel.value = stu.gender || '';
          sel.addEventListener('change', () => { stu.gender = sel.value || '未选择'; });
          td.appendChild(sel);
          td.className = 'col-gender';
        } else if (col.key === 'actions') {
          const delBtn = document.createElement('button'); delBtn.className = 'btn secondary'; delBtn.innerHTML = '<i class="ri-delete-bin-line"></i> 删除';
          delBtn.addEventListener('click', async () => {
            const ok = await showConfirm?.('确定删除该学生吗？');
            if (ok) {
              const origIndex = students.indexOf(stu);
              if (origIndex >= 0) {
                students.splice(origIndex, 1);
                try { await window.settingsAPI?.configSet('profiles', 'students', students); } catch (e) {}
              }
              renderBody();
            }
          });
          td.appendChild(delBtn);
          td.className = 'col-actions';
        } else {
          const inp = document.createElement('input'); inp.type='text'; inp.value = stu[col.key] || '';
          inp.addEventListener('change', () => { stu[col.key] = inp.value; });
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
    const existing = new Set(students.map(s => String(s.name||'').trim()).filter(Boolean));
    const unique = [];
    for (const name of lines) { if (!existing.has(name)) { existing.add(name); unique.push(name); } }
    const newItems = unique.map(name => ({ required: true, name, gender: '未选择' }));
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