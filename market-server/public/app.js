const statusEl = document.getElementById('status');
const editorEl = document.getElementById('editor');
const listEl = document.getElementById('list');

function setStatus(text, ok=true) {
  statusEl.textContent = text;
  statusEl.style.color = ok ? '#2f6f2f' : '#b00020';
}

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

// 自动加载
loadData();