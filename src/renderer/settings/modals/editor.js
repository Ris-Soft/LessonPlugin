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

async function openVarOverlaySimple(defaultPluginId, inputEl) {
  const pluginsRaw = await (window.settingsAPI?.getPlugins?.() || []);
  const withVars = [];
  for (const p of pluginsRaw) {
    const key = p.id || p.name;
    const res = await window.settingsAPI?.pluginVariablesList?.(key);
    const names = Array.isArray(res?.variables) ? res.variables : [];
    if (names.length) withVars.push({ key, name: p.name || p.id, vars: names, icon: p.icon || 'ri-puzzle-line' });
  }
  if (!withVars.length) { await showAlert('暂无可用插件变量'); return; }
  await new Promise(async (resolveOuter) => {
    const overlay = document.createElement('div'); overlay.className='modal-overlay';
    const box = document.createElement('div'); box.className='modal-box';
    const title = document.createElement('div'); title.className='modal-title'; title.textContent='快速编辑栏';
    const body = document.createElement('div'); body.className='modal-body';
    const style = document.createElement('style'); style.textContent = `
      .custom-scroll::-webkit-scrollbar{width:8px}
      .custom-scroll::-webkit-scrollbar-track{background:rgba(255,255,255,0.06);border-radius:8px}
      .custom-scroll::-webkit-scrollbar-thumb{background:rgba(255,255,255,0.18);border-radius:8px}
      .custom-scroll::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,0.28)}
    `; box.appendChild(style);
    const grid = document.createElement('div'); grid.style.display='grid'; grid.style.gridTemplateColumns='200px 1fr'; grid.style.gap='12px';
    const pluginWrap = document.createElement('div'); pluginWrap.className='custom-scroll'; pluginWrap.style.display='flex'; pluginWrap.style.flexDirection='column'; pluginWrap.style.gap='6px'; pluginWrap.style.overflow='auto'; pluginWrap.style.maxHeight='220px'; pluginWrap.style.padding='4px'; pluginWrap.style.border='1px solid var(--border,#2a2a2a)'; pluginWrap.style.borderRadius='8px';
    const right = document.createElement('div');
    const editorBar = document.createElement('div'); editorBar.style.minHeight='48px'; editorBar.style.height='56px'; editorBar.style.width='100%'; editorBar.style.border='1px solid var(--border,#2a2a2a)'; editorBar.style.borderRadius='8px'; editorBar.style.padding='8px'; editorBar.style.display='block'; editorBar.style.whiteSpace='nowrap'; editorBar.style.overflowX='auto'; editorBar.style.overflowY='hidden'; editorBar.style.fontSize='12px'; editorBar.style.lineHeight='20px'; editorBar.style.marginBottom='10px';
    const varWrap = document.createElement('div'); varWrap.className='action-list'; varWrap.style.maxHeight='240px'; varWrap.style.overflow='auto'; varWrap.style.border='1px solid var(--border,#2a2a2a)'; varWrap.style.borderRadius='8px'; varWrap.style.padding='6px';
    const actions = document.createElement('div'); actions.className='modal-actions';
    const cancel = document.createElement('button'); cancel.className='btn secondary'; cancel.textContent='取消'; cancel.onclick=()=>{ overlay.remove(); resolveOuter(); };
    const save = document.createElement('button'); save.className='btn primary'; save.textContent='保存';
    actions.appendChild(cancel); actions.appendChild(save);
    let selKey = '';
    // 解析当前输入内容为 tokens
    const parseTokens = (text) => {
      const s = String(text||'');
      const out = [];
      const re = /\$\{([^}]+)\}/g; let last=0; let m;
      while ((m=re.exec(s))!=null){ if (m.index>last) out.push({type:'text',value:s.slice(last,m.index)}); const token=m[1]; const parts=String(token||'').split(':'); out.push({type:'var',plugin:parts[0]||'',name:parts.slice(1).join(':')||''}); last = m.index + m[0].length; }
      if (last < s.length) out.push({type:'text',value:s.slice(last)});
      return out;
    };
    let tokens = parseTokens(inputEl.value || '');
    let insertPos = tokens.length; // 默认指针在末尾
    const makeBackspace = () => {
      const back = document.createElement('button'); back.className='btn secondary'; back.title='回退'; back.textContent='回退 ⌫'; back.style.marginLeft='8px'; back.onclick=()=>{
        const pos = Math.max(0, insertPos);
        if (pos===0) return;
        const prevIdx = pos-1;
        const prev = tokens[prevIdx];
        if (!prev) return;
        if (prev.type==='text') {
          const val = String(prev.value||'');
          if (val.length>0) {
            prev.value = val.slice(0, -1);
            // 保持指针不左移，继续位于当前分界
            insertPos = pos;
          }
          if (!prev.value) {
            tokens.splice(prevIdx,1);
            // 文本段移除时，将指针定位到该位置（不再跳更前）
            insertPos = Math.max(0, prevIdx);
          }
        } else {
          tokens.splice(prevIdx,1);
          insertPos = Math.max(0, prevIdx);
        }
        renderEditor();
      };
      return back;
    };
    const renderEditor = () => {
      editorBar.innerHTML='';
      const makePointer = () => { const p=document.createElement('span'); p.style.display='inline-block'; p.style.width='2px'; p.style.height='18px'; p.style.background='var(--primary,#4caf50)'; p.style.margin='0 2px'; p.title='插入位置'; return p; };
      // 渲染：在 insertPos 对应的位置前插入指针，无额外占位方框
      for (let i=0;i<=tokens.length;i++){
        if (i===insertPos) editorBar.appendChild(makePointer());
        if (i<tokens.length){
          const t = tokens[i];
          if (t.type==='text'){
            const span=document.createElement('span'); span.className='muted'; span.style.fontSize='12px'; span.style.lineHeight='20px'; span.textContent=t.value || ''; span.onclick=()=>{ insertPos=i+1; renderEditor(); }; editorBar.appendChild(span);
          } else {
            const chip=document.createElement('span'); chip.style.display='inline-flex'; chip.style.alignItems='center'; chip.style.gap='6px'; chip.style.padding='2px 6px'; chip.style.fontSize='12px'; chip.style.lineHeight='18px'; chip.style.border='1px solid var(--border,#2a2a2a)'; chip.style.borderRadius='14px'; chip.style.background='var(--pill,#222)'; const label=document.createElement('span'); label.textContent=`${t.plugin}:${t.name}`; chip.appendChild(label); chip.onclick=()=>{ insertPos=i+1; renderEditor(); }; editorBar.appendChild(chip);
          }
        }
      }
      // 点击编辑栏空白区域时，移动到末尾
      editorBar.onclick = (e) => { if (e.target === editorBar) { insertPos = tokens.length; renderEditor(); } };
      // 固定显示回退按钮（靠右）
      editorBar.appendChild(makeBackspace());
    };
    const applyResult = () => { const s = tokens.map(t=> t.type==='text' ? String(t.value||'') : `\${${t.plugin}:${t.name}}`).join(''); inputEl.value = s; inputEl.dispatchEvent(new Event('input')); overlay.remove(); resolveOuter(); };
    save.onclick = applyResult;
    const renderVars = () => {
      varWrap.innerHTML='';
      const item = withVars.find(x=> x.key===selKey) || null;
      const list = item ? item.vars : [];
      list.forEach(n=>{ const b=document.createElement('button'); b.className='btn secondary'; b.style.width='100%'; b.style.marginBottom='6px'; b.textContent=n; b.onclick=()=>{ const plugName = item?.name || selKey; const pos = insertPos==null ? tokens.length : insertPos; tokens.splice(pos,0,{type:'var',plugin:plugName,name:n}); insertPos = pos+1; renderEditor(); }; varWrap.appendChild(b); });
      if (!list.length) { const none=document.createElement('div'); none.className='muted'; none.textContent='该插件无变量'; varWrap.appendChild(none); }
    };
    withVars.forEach(p=>{ const b=document.createElement('button'); b.className='btn secondary'; b.style.width='100%'; b.style.marginBottom='6px'; b.style.textAlign='left'; b.innerHTML = `<i class="${p.icon || 'ri-puzzle-line'}" style="font-size:16px;margin-right:8px;"></i>${p.name}`; b.onclick=()=>{ selKey=p.key; [...pluginWrap.children].forEach(x=>{ x.classList.remove('selected'); x.style.background=''; }); b.classList.add('selected'); b.style.background='rgba(255,255,255,0.08)'; renderVars(); }; pluginWrap.appendChild(b); });
    const pre = withVars.find(x=> x.key===defaultPluginId) || withVars[0]; selKey = pre.key; renderVars();
    [...pluginWrap.children].forEach(btn=>{ if ((btn.innerText||'').includes(pre.name)) { btn.classList.add('selected'); btn.style.background='rgba(255,255,255,0.08)'; } });
    right.appendChild(editorBar);
    right.appendChild(varWrap);
    grid.appendChild(pluginWrap); grid.appendChild(right);
    renderEditor();
    box.appendChild(title); body.appendChild(grid); box.appendChild(body); box.appendChild(actions); overlay.appendChild(box); document.body.appendChild(overlay);
  });
}

// 参数数组编辑对话框（结构化编辑，不使用广域文本框）
async function showParamsEditor(initial, pluginId) {
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
        // 插件变量插入按钮（仅字符串类型）
        const ins = document.createElement('button'); ins.className='btn secondary'; ins.title='插入插件变量'; ins.innerHTML = '<i class="ri-braces-line"></i>';
        ins.onclick = async () => { try { if (typeSel.value !== 'string') return; await openVarOverlaySimple(pluginId, input); } catch (e) { await showAlert('变量加载失败：' + (e?.message || '未知错误')); } };
        const wrap = document.createElement('div'); wrap.style.display='grid'; wrap.style.gridTemplateColumns='1fr auto'; wrap.style.gap='8px'; wrap.appendChild(input); wrap.appendChild(ins);
        row.appendChild(typeSel); row.appendChild(wrap); row.appendChild(del);
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
async function showParamsEditorForEvent(paramDefs, initial, pluginId) {
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
        // 插件变量插入按钮（仅字符串类型）
        const insBtn = document.createElement('button'); insBtn.className='btn secondary'; insBtn.title='插入插件变量'; insBtn.innerHTML = '<i class="ri-braces-line"></i>';
        insBtn.onclick = async () => { try { if (!['string','text'].includes(String(type).toLowerCase())) return; await openVarOverlaySimple(pluginId, input); } catch (e) { await showAlert('变量加载失败：' + (e?.message || '未知错误')); } };
        const wrap = document.createElement('div'); wrap.style.display='grid'; wrap.style.gridTemplateColumns='1fr auto'; wrap.style.gap='8px'; wrap.appendChild(input); wrap.appendChild(insBtn);
        row.appendChild(label); row.appendChild(wrap);
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

// 源JSON编辑器（模态）：隐藏/忽略id字段，保存时强制保留原ID
async function showAutomationJsonEditorModal(initial) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = '源JSON编辑器';
    const body = document.createElement('div'); body.className = 'modal-body';
    const desc = document.createElement('div'); desc.className = 'muted'; desc.textContent = '提示：ID不可更改，保存时将强制保留当前任务ID';
    const ta = document.createElement('textarea'); ta.style.width = '100%'; ta.style.minHeight = '240px'; ta.style.fontFamily = 'var(--mono, monospace)'; ta.spellcheck = false;
    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const btnCopy = document.createElement('button'); btnCopy.className = 'btn secondary'; btnCopy.innerHTML = '<i class="ri-file-copy-2-line"></i> 复制JSON';
    const btnPaste = document.createElement('button'); btnPaste.className = 'btn secondary'; btnPaste.innerHTML = '<i class="ri-clipboard-line"></i> 粘贴';
    const btnCancel = document.createElement('button'); btnCancel.className = 'btn secondary'; btnCancel.textContent = '取消';
    const btnSave = document.createElement('button'); btnSave.className = 'btn primary'; btnSave.innerHTML = '<i class="ri-save-3-line"></i> 保存';

    const composeInitial = () => {
      const clone = { ...initial };
      // 展示时移除id，避免误改
      delete clone.id;
      return JSON.stringify(clone, null, 2);
    };
    try { ta.value = composeInitial(); } catch { ta.value = '{}'; }

    btnCopy.onclick = async () => {
      try {
        const text = JSON.stringify({ id: initial.id, ...JSON.parse(ta.value || '{}') }, null, 2);
        if (navigator.clipboard?.writeText) {
          await navigator.clipboard.writeText(text);
        } else {
          const tmp = document.createElement('textarea'); tmp.value = text; document.body.appendChild(tmp); tmp.select(); document.execCommand('copy'); tmp.remove();
        }
        await showAlert('已复制到剪贴板');
      } catch (e) {
        await showAlert('复制失败：' + (e?.message || '未知错误'));
      }
    };
    btnPaste.onclick = async () => {
      try {
        let text = '';
        if (navigator.clipboard?.readText) text = await navigator.clipboard.readText();
        if (!text) { await showAlert('剪贴板为空'); return; }
        const parsed = JSON.parse(text);
        delete parsed.id; // 粘贴时忽略外部ID
        ta.value = JSON.stringify(parsed, null, 2);
      } catch (e) {
        await showAlert('粘贴解析失败：' + (e?.message || '未知错误'));
      }
    };
    btnCancel.onclick = () => { overlay.remove(); resolve(null); };
    btnSave.onclick = async () => {
      try {
        const parsed = JSON.parse(ta.value || '{}');
        // 返回不含id的字段，调用方负责覆盖id并保存
        overlay.remove();
        resolve(parsed);
      } catch (e) {
        await showAlert('JSON解析失败：' + (e?.message || '未知错误'));
      }
    };

    box.appendChild(title);
    body.appendChild(desc);
    body.appendChild(ta);
    box.appendChild(body);
    actions.appendChild(btnCopy);
    actions.appendChild(btnPaste);
    actions.appendChild(btnCancel);
    actions.appendChild(btnSave);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
  });
}
