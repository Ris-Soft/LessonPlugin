// 快捷方式创建预览与选项对话框
async function showShortcutCreateDialog(pluginItem, chosen, pluginId, action) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div'); overlay.className = 'modal-overlay';
    const box = document.createElement('div'); box.className = 'modal-box';
    const title = document.createElement('div'); title.className = 'modal-title'; title.textContent = '创建快捷方式预览';
    const body = document.createElement('div'); body.className = 'modal-body';

    const defaultName = `${pluginItem.name} - ${chosen.label}`;
    const nameRow = document.createElement('div'); nameRow.className = 'form-row';
    const nameLabel = document.createElement('label'); nameLabel.textContent = '名称'; nameLabel.className = 'muted';
    const nameInput = document.createElement('input'); nameInput.type = 'text'; nameInput.value = defaultName; nameInput.style.flex = '1';
    nameRow.appendChild(nameLabel); nameRow.appendChild(nameInput);

    const iconRow = document.createElement('div'); iconRow.className = 'form-row';
    const iconLabel = document.createElement('label'); iconLabel.textContent = '图标来源'; iconLabel.className = 'muted';
    const iconOpts = document.createElement('div'); iconOpts.className = 'options';
    const r1 = document.createElement('input'); r1.type = 'radio'; r1.name = 'iconSrc'; r1.id = 'iconSrcAction'; r1.checked = true;
    const l1 = document.createElement('label'); l1.htmlFor = 'iconSrcAction'; l1.innerHTML = '<i class="ri-flashlight-line"></i> 动作图标';
    const r2 = document.createElement('input'); r2.type = 'radio'; r2.name = 'iconSrc'; r2.id = 'iconSrcPlugin';
    const l2 = document.createElement('label'); l2.htmlFor = 'iconSrcPlugin'; l2.innerHTML = '<i class="ri-puzzle-line"></i> 插件图标';
    iconOpts.appendChild(r1); iconOpts.appendChild(l1); iconOpts.appendChild(r2); iconOpts.appendChild(l2);
    iconRow.appendChild(iconLabel); iconRow.appendChild(iconOpts);

    const colorRow = document.createElement('div'); colorRow.className = 'form-row';
    const bgLabel = document.createElement('label'); bgLabel.textContent = '背景色'; bgLabel.className = 'muted';
    const bgInput = document.createElement('input'); bgInput.type = 'color'; bgInput.value = '#111827'; bgInput.className = 'color-input';
    const fgLabel = document.createElement('label'); fgLabel.textContent = '前景色'; fgLabel.className = 'muted'; fgLabel.style.marginLeft = '12px';
    const fgInput = document.createElement('input'); fgInput.type = 'color'; fgInput.value = '#ffffff'; fgInput.className = 'color-input';
    colorRow.appendChild(bgLabel); colorRow.appendChild(bgInput); colorRow.appendChild(fgLabel); colorRow.appendChild(fgInput);

    const grid = document.createElement('div'); grid.className = 'shortcut-preview-grid';
    const meta = document.createElement('div'); meta.className = 'preview-meta';
    const info = document.createElement('div'); info.className = 'muted';
    const eventName = (chosen.kind === 'meta') ? chosen.target : (chosen.def?.name || chosen.def?.id);
    const kindLabel = (chosen.kind === 'meta') ? '动作' : '事件';
    info.textContent = `目标：${pluginItem.name} / ${chosen.label}（${kindLabel}：${eventName}）`;
    // 字符串预览（示例，实际创建时由主进程生成具体ID）
    const protoPreview = document.createElement('div'); protoPreview.className = 'muted';
    const sample = `plugin:${pluginId}:${Math.random().toString(16).slice(2,10)}`;
    protoPreview.textContent = `协议字符串预览：OrbiBoard://task/${encodeURIComponent(sample)}`;
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256; canvas.className = 'preview-canvas';
    // 左列放画布，右列放文本容器，避免跨行造成空白
    meta.appendChild(info); meta.appendChild(protoPreview);
    grid.appendChild(canvas);
    grid.appendChild(meta);

    const actions = document.createElement('div'); actions.className = 'modal-actions';
    const cancel = document.createElement('button'); cancel.className='btn secondary'; cancel.textContent='取消';
    cancel.onclick = () => { document.body.removeChild(overlay); resolve(false); };
    const ok = document.createElement('button'); ok.className='btn primary'; ok.textContent='创建快捷方式';

    function currentIconClass() {
      const useAction = r1.checked;
      return useAction ? (chosen.icon || pluginItem.icon || 'ri-links-line') : (pluginItem.icon || 'ri-links-line');
    }
    async function renderPreview() {
      await drawRemixIconCanvas(currentIconClass(), canvas, bgInput.value, fgInput.value, 256);
    }
    r1.addEventListener('change', renderPreview);
    r2.addEventListener('change', renderPreview);
    bgInput.addEventListener('input', renderPreview);
    fgInput.addEventListener('input', renderPreview);

    ok.onclick = async () => {
      const options = {
        name: (nameInput.value || defaultName),
        icon: currentIconClass(),
        bgColor: bgInput.value,
        fgColor: fgInput.value,
        actions: [action],
        iconDataUrl: canvas.toDataURL('image/png')
      };
      const res = await window.settingsAPI?.pluginAutomationCreateShortcut?.(pluginId, options);
      if (!res?.ok) { await showAlert(`创建快捷方式失败：${res?.error || '未知错误'}`); return; }
      document.body.removeChild(overlay);
      resolve({ ok: true, res });
    };

    box.appendChild(title);
    body.appendChild(nameRow);
    body.appendChild(iconRow);
    body.appendChild(colorRow);
    body.appendChild(grid);
    box.appendChild(body);
    actions.appendChild(cancel); actions.appendChild(ok);
    box.appendChild(actions);
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    renderPreview();
  });
}

