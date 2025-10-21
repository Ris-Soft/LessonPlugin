
function renderMarkdown(md) {
  const escape = (s) => String(s || '').replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  let src = String(md || '');
  // 代码块
  src = src.replace(/```([\s\S]*?)```/g, (_m, code) => `<pre class="code"><code>${escape(code)}</code></pre>`);
  // 标题
  src = src.replace(/^######\s*(.*)$/gm, '<h6>$1</h6>')
           .replace(/^#####\s*(.*)$/gm, '<h5>$1</h5>')
           .replace(/^####\s*(.*)$/gm, '<h4>$1</h4>')
           .replace(/^###\s*(.*)$/gm, '<h3>$1</h3>')
           .replace(/^##\s*(.*)$/gm, '<h2>$1</h2>')
           .replace(/^#\s*(.*)$/gm, '<h1>$1</h1>');
  // 行内代码、粗体、斜体
  src = src.replace(/`([^`]+)`/g, '<code>$1</code>')
           .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
           .replace(/\*([^*]+)\*/g, '<em>$1</em>');
  // 链接
  src = src.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // 列表（简单处理）
  src = src.replace(/^(?:-\s+.+\n?)+/gm, (block) => {
    const items = block.trim().split(/\n/).map((line) => line.replace(/^-\s+/, '').trim());
    return `<ul>` + items.map((t) => `<li>${t}</li>`).join('') + `</ul>`;
  });
  // 段落
  src = src.replace(/^(?!<h\d|<pre|<ul)(.+)$/gm, '<p>$1</p>');
  return src;
}