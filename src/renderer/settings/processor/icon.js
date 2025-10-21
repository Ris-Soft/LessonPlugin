// 解析 remixicon ::before 的十六进制内容为字符
function getRemixCharFromComputed(el) {
  const content = getComputedStyle(el, '::before').content || '';
  const raw = String(content).replace(/^\s*["']|["']\s*$/g, '');
  if (/^\\[0-9a-fA-F]+$/.test(raw)) {
    const hex = raw.replace(/\\+/g, '');
    const code = parseInt(hex || '0', 16);
    return String.fromCharCode(code || 0);
  }
  return raw;
}

// 在 Canvas 上按当前逻辑绘制 remixicon 字体图标
async function drawRemixIconCanvas(iconClass, canvas, bg = '#111827', fg = '#ffffff', size = 256) {
  canvas.width = size; canvas.height = size;
  const ctx = canvas.getContext('2d');
  function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
  const bgNorm = String(bg || '').toLowerCase();
  if (bg && bgNorm !== 'transparent' && bgNorm !== 'none') { ctx.fillStyle = bg; roundRect(0,0,size,size, Math.floor(size*0.18)); ctx.fill(); } else { ctx.clearRect(0,0,size,size); }
  const i = document.createElement('i'); i.className = iconClass; i.style.fontFamily = 'remixicon'; i.style.fontStyle = 'normal'; i.style.fontWeight = 'normal'; document.body.appendChild(i);
  try { await document.fonts.ready; } catch {}
  let ch = getRemixCharFromComputed(i);
  for (let t = 0; t < 30 && (!ch || ch === 'none' || ch === '""' || ch === "''"); t++) { await new Promise(r => setTimeout(r, 50)); ch = getRemixCharFromComputed(i); }
  if (!ch || ch === 'none' || ch === '""' || ch === "''") { i.className = 'ri-flashlight-fill'; ch = getRemixCharFromComputed(i) || ''; }
  const fontSize = Math.floor(size*0.56);
  ctx.fillStyle = fg; ctx.font = fontSize + 'px remixicon'; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
  ctx.fillText(ch || '', size/2, size/2);
  i.remove();
}
