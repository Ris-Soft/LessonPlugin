// 条件值编辑模态框（用于选项较多的条件）
async function showCondEditorModal(type, initial) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = '编辑条件值';
    const body = document.createElement('div'); body.className = 'modal-body';
    const hint = document.createElement('div'); hint.className = 'muted'; hint.textContent = '点击标签进行选择/取消，确认后生效';
    const wrap = document.createElement('div'); wrap.className = 'cond-editor';
    let sel = new Set(Array.isArray(initial) ? initial : []);

    const renderChips = (values, labelsFn = (v) => String(v)) => {
      wrap.innerHTML = '';
      values.forEach((v) => {
        const lab = document.createElement('span');
        lab.className = 'chip' + (sel.has(v) ? ' selected' : '');
        lab.textContent = labelsFn(v);
        lab.addEventListener('click', () => {
          if (sel.has(v)) { sel.delete(v); lab.classList.remove('selected'); }
          else { sel.add(v); lab.classList.add('selected'); }
        });
        wrap.appendChild(lab);
      });
    };

    if (type === 'weekdayIn') {
      title.textContent = '编辑星期选择';
      renderChips([1,2,3,4,5,6,7]);
    } else if (type === 'monthIn') {
      title.textContent = '编辑月份选择';
      renderChips(Array.from({ length: 12 }, (_, i) => i + 1));
    } else if (type === 'dayIn') {
      title.textContent = '编辑日期选择';
      renderChips(Array.from({ length: 31 }, (_, i) => i + 1));
    } else {
      // Fallback：仅返回原值，不使用模态编辑
      resolve(initial);
      return;
    }

    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const ok = document.createElement('button'); ok.className = 'btn primary'; ok.textContent = '确认';
    ok.addEventListener('click', () => { overlay.remove(); resolve(Array.from(sel).sort((a,b)=>a-b)); });
    const cancel = document.createElement('button'); cancel.className = 'btn secondary'; cancel.textContent = '取消';
    cancel.addEventListener('click', () => { overlay.remove(); resolve(null); });
    actions.appendChild(ok); actions.appendChild(cancel);

    box.appendChild(title); box.appendChild(body);
    body.appendChild(hint); body.appendChild(wrap);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}

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
  const list = document.createElement('div'); list.className = 'action-list';
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
