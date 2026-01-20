const { BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

class ShortcutService {
  constructor(app) {
    this.app = app;
  }

  async createShortcut(item, protoText, options) {
    try {
      const nameRaw = String(options?.name || '').trim();
      const name = nameRaw || '插件动作';
      const iconName = String(options?.icon || '').trim() || 'ri-flashlight-fill';
      const bgColor = String(options?.bgColor || '#262626');
      const fgColor = String(options?.fgColor || '#ffffff');
      const iconDataUrl = String(options?.iconDataUrl || '').trim();

      // 2) 生成 ICO 图标（深色圆角边框背景 + 白色 Remixicon 图标）
      const iconsDir = path.join(this.app.getPath('userData'), 'icons');
      try { if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true }); } catch (e) {}
      const icoPath = path.join(iconsDir, `${item.id}.ico`);
      const pngPath = path.join(iconsDir, `${item.id}.png`);
      let icoOk = false;
      let pngOk = false;
      try {
        // 优先使用设置页预览生成的 PNG（避免在无字体环境下渲染失败）
        if (iconDataUrl && iconDataUrl.startsWith('data:image/png;base64,')) {
          const pngBuf = Buffer.from(iconDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
          if (pngBuf?.length) {
            fs.writeFileSync(pngPath, pngBuf);
            pngOk = true;
            const icoBuf = this._pngToIco(pngBuf, 256);
            fs.writeFileSync(icoPath, icoBuf);
            icoOk = true;
          }
        }
      } catch (e) {}
      if (!icoOk) {
        // 回退到主进程生成（离屏渲染 + 字体）
        icoOk = await this._generateRemixIconIco(iconName, icoPath, bgColor, fgColor);
      }
      if (!pngOk) {
        pngOk = await this._generateRemixIconPng(iconName, pngPath, bgColor, fgColor);
      }

      const desktop = this.app.getPath('desktop');
      let shortcutPath = '';
      if (process.platform === 'win32') {
        const safeFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.lnk';
        shortcutPath = path.join(desktop, safeFile);
        const execPath = process.execPath;
        const args = `OrbiBoard://task/${encodeURIComponent(protoText)}`;
        let created = false;
        try {
          const ps = [
            `$ws = New-Object -ComObject WScript.Shell;`,
            `$s = $ws.CreateShortcut(\"${shortcutPath.replace(/\\/g,'\\\\')}\");`,
            `$s.TargetPath = \"${execPath.replace(/\\/g,'\\\\')}\";`,
            `$s.Arguments = \"${args}\";`,
            icoOk ? `$s.IconLocation = \"${icoPath.replace(/\\/g,'\\\\')},0\";` : ``,
            `$s.WorkingDirectory = \"${path.dirname(execPath).replace(/\\/g,'\\\\')}\";`,
            `$s.Save()`
          ].filter(Boolean).join(' ');
          await new Promise((resolve, reject) => {
            const p = spawn('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', ps], { windowsHide: true });
            p.on('error', reject);
            p.on('exit', (code) => { if (code === 0 && fs.existsSync(shortcutPath)) resolve(); else reject(new Error('powershell_failed')); });
          });
          created = true;
        } catch (e) {}
        if (!created) {
          const fallbackFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.url';
          shortcutPath = path.join(desktop, fallbackFile);
          const urlLine = `URL=OrbiBoard://task/${encodeURIComponent(protoText)}`;
          const iconLines = icoOk ? `IconFile=${icoPath}\r\nIconIndex=0` : '';
          const content = `[InternetShortcut]\r\n${urlLine}\r\n${iconLines}\r\n`;
          try { fs.writeFileSync(shortcutPath, content, 'utf8'); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
        }
      } else if (process.platform === 'darwin') {
        const safeFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.command';
        shortcutPath = path.join(desktop, safeFile);
        const content = `#!/bin/bash\nopen \"OrbiBoard://task/${encodeURIComponent(protoText)}\"\n`;
        try { fs.writeFileSync(shortcutPath, content, 'utf8'); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
        try { fs.chmodSync(shortcutPath, 0o755); } catch (e) {}
      } else {
        const safeFile = (name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || item.id) + '.desktop';
        shortcutPath = path.join(desktop, safeFile);
        const execPath = process.env.APPIMAGE || process.execPath;
        const execLine = `Exec="${execPath}" "OrbiBoard://task/${encodeURIComponent(protoText)}"`;
        const tryExecLine = `TryExec=${execPath}`;
        const iconLine = pngOk ? `Icon=${pngPath}` : '';
        const content = `[Desktop Entry]\nType=Application\nName=${name}\n${execLine}\n${tryExecLine}\n${iconLine}\nTerminal=false\nCategories=Utility;\n`;
        try { fs.writeFileSync(shortcutPath, content, 'utf8'); } catch (e) { return { ok: false, error: e?.message || String(e) }; }
        try { fs.chmodSync(shortcutPath, 0o755); } catch (e) {}
      }

      return { ok: true, shortcutPath, iconPath: (process.platform === 'win32' ? (icoOk ? icoPath : null) : (pngOk ? pngPath : null)), itemId: item.id, protocolText: protoText };
    } catch (e) {
      return { ok: false, error: e?.message || String(e) };
    }
  }

  async _generateRemixIconIco(iconClassName, icoPath, bgColor, fgColor) {
    try {
      const size = 256;
      // path adjustment: src/main/Manager/Automation -> src/renderer
      const rendererDir = path.join(__dirname, '../../../renderer');
      const remixCssPath = path.join(rendererDir, 'remixicon-local.css');
      let remixCss = '';
      try { remixCss = fs.readFileSync(remixCssPath, 'utf8'); } catch (e) {}
      const woffUrl = `file://${rendererDir.replace(/\\/g, '/')}/remixicon.woff2`;
      if (remixCss) {
        remixCss = remixCss.replace(/url\(\s*['\"]?remixicon\.woff2['\"]?\s*\)/g, `url('${woffUrl}')`);
      }
      const cssBlock = remixCss
        ? `<style>${remixCss}\nhtml,body{margin:0;padding:0;background:transparent;}</style>`
        : `<link rel=\"stylesheet\" href=\"file://${rendererDir.replace(/\\/g, '/')}/remixicon-local.css\" />\n<style>@font-face { font-family: 'remixicon'; src: url('${woffUrl}') format('woff2'); font-display: block; } html,body{margin:0;padding:0;background:transparent;}</style>`;
      const html = `<!DOCTYPE html><html><head>
        <meta charset=\"utf-8\" />
        ${cssBlock}
      </head><body></body></html>`;
      const win = new BrowserWindow({ show: false, width: size, height: size, webPreferences: { offscreen: true } });
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const js = `(() => new Promise(async (resolve) => {
        const size = ${size};
        const bg = ${JSON.stringify(bgColor)};
        const fg = ${JSON.stringify(fgColor)};
        const icon = ${JSON.stringify(iconClassName)};
        const i = document.createElement('i');
        i.className = icon;
        i.style.fontFamily = 'remixicon';
        i.style.fontStyle = 'normal';
        i.style.fontWeight = 'normal';
        document.body.appendChild(i);
        try { await document.fonts.ready; } catch (e) {}
        function getCharFromComputed(el) {
          const content = getComputedStyle(el, '::before').content || '';
          const raw = String(content).replace(/^\s*[\"\']|[\"\']\s*$/g, '');
          if (/^\\[0-9a-fA-F]+$/.test(raw)) {
            const hex = raw.replace(/\\+/g, '');
            const code = parseInt(hex || '0', 16);
            return String.fromCharCode(code || 0);
          }
          return raw;
        }
        let ch = getCharFromComputed(i);
        for (let t = 0; t < 30 && (!ch || ch === 'none' || ch === '""' || ch === "''"); t++) {
          await new Promise(r => setTimeout(r, 50));
          ch = getCharFromComputed(i);
        }
        if (!ch || ch === '""' || ch === "''" || ch === 'none') {
          i.className = 'ri-flashlight-fill';
          ch = getCharFromComputed(i) || '';
        }
        const c = document.createElement('canvas'); c.width = size; c.height = size; document.body.appendChild(c);
        const ctx = c.getContext('2d');
        function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
        ctx.fillStyle = bg; roundRect(0,0,size,size, Math.floor(size*0.18)); ctx.fill();
        ctx.fillStyle = fg;
        const fontSize = Math.floor(size*0.56);
        ctx.font = fontSize + 'px remixicon';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(ch || '', size/2, size/2);
        const data = c.toDataURL('image/png');
        resolve(data);
      }))()`;
      const dataUrl = await win.webContents.executeJavaScript(js, true);
      try { if (!win.isDestroyed()) win.destroy(); } catch (e) {}
      const pngBuf = Buffer.from(String(dataUrl || '').replace(/^data:image\/png;base64,/, ''), 'base64');
      if (!pngBuf?.length) return false;
      const icoBuf = this._pngToIco(pngBuf, size);
      fs.writeFileSync(icoPath, icoBuf);
      return true;
    } catch (e) {
      return false;
    }
  }

  async _generateRemixIconPng(iconClassName, pngPath, bgColor, fgColor) {
    try {
      const size = 256;
      const rendererDir = path.join(__dirname, '../../../renderer');
      const remixCssPath = path.join(rendererDir, 'remixicon-local.css');
      let remixCss = '';
      try { remixCss = fs.readFileSync(remixCssPath, 'utf8'); } catch (e) {}
      const woffUrl = `file://${rendererDir.replace(/\\/g, '/')}/remixicon.woff2`;
      if (remixCss) {
        remixCss = remixCss.replace(/url\(\s*['"]?remixicon\.woff2['"]?\s*\)/g, `url('${woffUrl}')`);
      }
      const cssBlock = remixCss
        ? `<style>${remixCss}\nhtml,body{margin:0;padding:0;background:transparent;}</style>`
        : `<link rel=\"stylesheet\" href=\"file://${rendererDir.replace(/\\/g, '/')}/remixicon-local.css\" />\n<style>@font-face { font-family: 'remixicon'; src: url('${woffUrl}') format('woff2'); font-display: block; } html,body{margin:0;padding:0;background:transparent;}</style>`;
      const html = `<!DOCTYPE html><html><head><meta charset=\"utf-8\" />${cssBlock}</head><body></body></html>`;
      const win = new BrowserWindow({ show: false, width: size, height: size, webPreferences: { offscreen: true } });
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const js = `(() => new Promise(async (resolve) => {
        const size = ${size};
        const bg = ${JSON.stringify(bgColor)};
        const fg = ${JSON.stringify(fgColor)};
        const icon = ${JSON.stringify(iconClassName)};
        const i = document.createElement('i');
        i.className = icon;
        i.style.fontFamily = 'remixicon';
        i.style.fontStyle = 'normal';
        i.style.fontWeight = 'normal';
        document.body.appendChild(i);
        try { await document.fonts.ready; } catch (e) {}
        function getCharFromComputed(el) {
          const content = getComputedStyle(el, '::before').content || '';
          const raw = String(content).replace(/^\s*[^\w\\]*|[^\w\\]*\s*$/g, '');
          if (/^\\[0-9a-fA-F]+$/.test(raw)) {
            const hex = raw.replace(/\\+/g, '');
            const code = parseInt(hex || '0', 16);
            return String.fromCharCode(code || 0);
          }
          return raw;
        }
        let ch = getCharFromComputed(i);
        for (let t = 0; t < 30 && (!ch || ch === 'none' || ch === '""' || ch === "''"); t++) {
          await new Promise(r => setTimeout(r, 50));
          ch = getCharFromComputed(i);
        }
        if (!ch || ch === '""' || ch === "''" || ch === 'none') {
          i.className = 'ri-flashlight-fill';
          ch = getCharFromComputed(i) || '';
        }
        const c = document.createElement('canvas'); c.width = size; c.height = size; document.body.appendChild(c);
        const ctx = c.getContext('2d');
        function roundRect(x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
        ctx.fillStyle = bg; roundRect(0,0,size,size, Math.floor(size*0.18)); ctx.fill();
        ctx.fillStyle = fg;
        const fontSize = Math.floor(size*0.56);
        ctx.font = fontSize + 'px remixicon';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText(ch || '', size/2, size/2);
        const data = c.toDataURL('image/png');
        resolve(data);
      }))()`;
      const dataUrl = await win.webContents.executeJavaScript(js, true);
      try { if (!win.isDestroyed()) win.destroy(); } catch (e) {}
      const pngBuf = Buffer.from(String(dataUrl || '').replace(/^data:image\/png;base64,/, ''), 'base64');
      if (!pngBuf?.length) return false;
      fs.writeFileSync(pngPath, pngBuf);
      return true;
    } catch (e) {
      return false;
    }
  }

  _pngToIco(pngBuf, size) {
    const header = Buffer.alloc(6);
    header.writeUInt16LE(0, 0); // reserved
    header.writeUInt16LE(1, 2); // type: icon
    header.writeUInt16LE(1, 4); // count
    const dir = Buffer.alloc(16);
    dir[0] = size >= 256 ? 0 : size; // width
    dir[1] = size >= 256 ? 0 : size; // height
    dir[2] = 0; // color count
    dir[3] = 0; // reserved
    dir.writeUInt16LE(1, 4); // planes
    dir.writeUInt16LE(32, 6); // bit depth
    dir.writeUInt32LE(pngBuf.length, 8); // size of data
    dir.writeUInt32LE(6 + 16, 12); // offset to data
    return Buffer.concat([header, dir, pngBuf]);
  }
}

module.exports = ShortcutService;
