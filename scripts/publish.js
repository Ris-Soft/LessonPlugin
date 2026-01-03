const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { FormData, Blob } = require('formdata-node'); // Ensure FormData is available

// 简单构建 multipart/form-data 的函数（为了避免引入额外依赖，使用原生 http）
function uploadFiles(url, files, fields, onDone) {
  const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
  const crlf = '\r\n';
  
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'multipart/form-data; boundary=' + boundary
    }
  };

  const client = url.startsWith('https') ? https : http;
  const req = client.request(url, options, (res) => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        onDone(null, data);
      } else {
        onDone(new Error(`Upload failed: ${res.statusCode} ${data}`));
      }
    });
  });

  req.on('error', e => onDone(e));

  // Write fields
  for (const [key, value] of Object.entries(fields)) {
    req.write(`--${boundary}${crlf}`);
    req.write(`Content-Disposition: form-data; name="${key}"${crlf}${crlf}`);
    req.write(`${value}${crlf}`);
  }

  // Write files
  for (const [key, filePath] of Object.entries(files)) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    const filename = path.basename(filePath);
    req.write(`--${boundary}${crlf}`);
    req.write(`Content-Disposition: form-data; name="${key}"; filename="${filename}"${crlf}`);
    req.write(`Content-Type: application/octet-stream${crlf}${crlf}`);
    const content = fs.readFileSync(filePath);
    req.write(content);
    req.write(crlf);
  }

  req.write(`--${boundary}--${crlf}`);
  req.end();
}

// 询问更新日志
function askChangelog() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    console.log('请输入更新日志 (输入空行结束):');
    let lines = [];
    rl.on('line', (line) => {
      if (line.trim() === '') {
        rl.close();
      } else {
        lines.push(line);
      }
    });
    
    rl.on('close', () => {
      resolve(lines.join('\n'));
    });
  });
}

async function main() {
  try {
    const args = process.argv.slice(2);
    const isLinux = args.includes('--linux');
    
    let changelog = '';
    let newVer = '';
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const oldVer = pkg.version;

    if (!isLinux) {
      // 0. 获取更新日志
      changelog = await askChangelog();
      if (!changelog) {
        console.log('未输入更新日志，取消发布。');
        process.exit(0);
      }

      // 0.1 检查云端版本（避免重复发布）
      const serverBase = process.env.MARKET_URL ? process.env.MARKET_URL.replace(/\/api\/admin\/publish$/, '') : 'https://orbiboard.3r60.top/';
      const versionUrl = `${serverBase}/api/version`;
      
      console.log(`[Publish] Checking remote version from ${versionUrl}...`);
      try {
        const verRes = await new Promise((resolve) => {
          const req = (versionUrl.startsWith('https') ? https : http).get(versionUrl, (res) => {
            let data = '';
            res.on('data', c => data += c);
            res.on('end', () => {
              try { resolve(JSON.parse(data)); } catch (e) { resolve({}); }
            });
          });
          req.on('error', () => resolve({}));
        });
        
        const remoteVer = verRes.version;
        console.log(`[Publish] Local: ${oldVer}, Remote: ${remoteVer}`);
        
        const cmp = (a, b) => {
          const pa = String(a).split('.').map(Number);
          const pb = String(b).split('.').map(Number);
          for(let i=0; i<Math.max(pa.length, pb.length); i++) {
            const v1 = pa[i]||0; const v2 = pb[i]||0;
            if(v1 > v2) return 1;
            if(v1 < v2) return -1;
          }
          return 0;
        };
        
        let targetVer = oldVer;
        // 仅当远程版本与本地版本相同，执行 Patch+1；其余情况不自增
        if (remoteVer && cmp(oldVer, remoteVer) === 0) {
          console.log(`[Publish] Remote has current version (${remoteVer}). Incrementing patch for new release...`);
          const parts = oldVer.split('.').map(Number);
          if (parts.length < 3) while (parts.length < 3) parts.push(0);
          parts[parts.length - 1]++;
          targetVer = parts.join('.');
          console.log(`[Publish] Upgrading to ${targetVer}`);
          pkg.version = targetVer;
          fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2), 'utf-8');
        } else {
          console.log(`[Publish] Using current local version (${oldVer}).`);
          targetVer = oldVer;
        }
        newVer = targetVer;

      } catch (e) {
        console.warn('[Publish] Failed to check remote version, assuming upgrade needed.', e);
        newVer = oldVer; // fallback
      }

      console.log(`[Publish] Target version: ${newVer}`);
      console.log(`[Publish] Changelog:\n${changelog}`);

      // 2.1 Git 集成
      try {
        console.log('[Publish] Committing to Git...');
        try { execSync('git --version', { stdio: 'ignore' }); } catch (e) { throw new Error('Git not found'); }
        
        execSync('git add package.json', { cwd: path.resolve(__dirname, '..') });
        execSync(`git commit -m "chore(release): v${newVer}"`, { cwd: path.resolve(__dirname, '..') });
        execSync(`git tag v${newVer}`, { cwd: path.resolve(__dirname, '..') });
        
        console.log(`[Publish] Git tag v${newVer} created.`);
        
        try {
          console.log('[Publish] Pushing to remote (triggering GitHub Actions)...');
          execSync('git push && git push --tags', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
        } catch (e) {
          console.warn('[Publish] Git push failed. You may need to push manually to trigger GitHub builds.');
        }
      } catch (e) {
        console.warn('[Publish] Git operation failed:', e.message);
      }
    } else {
      // Linux 模式：不询问日志，不检查版本，不 Git 提交
      newVer = oldVer;
      console.log(`[Publish] Linux mode: Using current version ${newVer}. Skipping changelog and git tags.`);
    }

    try {
      // 3. 执行本地构建
      if (isLinux) {
        console.log('[Publish] Building Linux package...');
        execSync('npm run build:linux', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
      } else {
        console.log('[Publish] Building Windows package...');
        execSync('npm run build', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
      }

      // 4. 定位构建产物
      const distDir = path.resolve(__dirname, '..', 'dist');
      const files = fs.readdirSync(distDir);
      
      const uploadMap = {};
      
      if (isLinux) {
        // 查找 .deb (优先) 或 .AppImage
        const debFile = files.find(f => f.endsWith('.deb') && f.includes(newVer));
        if (debFile) {
          uploadMap.uos = path.join(distDir, debFile);
          console.log(`[Publish] Found Linux artifact (deb): ${debFile}`);
        } else {
          // fallback to AppImage if deb not found (though build:linux usually produces both or specified one)
          const appImage = files.find(f => f.endsWith('.AppImage') && f.includes(newVer));
          if (appImage) {
            // Note: Server expects 'uos' usually for deb/linux. 
            uploadMap.uos = path.join(distDir, appImage);
            console.log(`[Publish] Found Linux artifact (AppImage): ${appImage}`);
          } else {
             throw new Error('Linux build artifact (.deb or .AppImage) not found');
          }
        }
        // Linux 模式下不上传 asar，以免覆盖 Windows 的 asar（如果 native modules 不同）
      } else {
        const exeFile = files.find(f => f.endsWith('.exe') && f.includes(newVer));
        if (!exeFile) throw new Error('Windows build artifact (.exe) not found');
        uploadMap.windows = path.join(distDir, exeFile);
        console.log(`[Publish] Found Windows artifact: ${exeFile}`);

        const asarPath = path.join(distDir, 'win-unpacked', 'resources', 'app.asar');
        if (fs.existsSync(asarPath)) {
          const asarName = `OrbiBoard-${newVer}.asar`;
          const asarDest = path.join(distDir, asarName);
          fs.copyFileSync(asarPath, asarDest);
          uploadMap.asar = asarDest;
          console.log(`[Publish] Found ASAR: ${asarName}`);
        }
      }
      
      // 5. 上传到市场服务器
      const serverUrl = process.env.MARKET_URL || 'https://orbiboard.3r60.top/api/admin/publish';
      console.log(`[Publish] Uploading to ${serverUrl}...`);
      
      // 管理员密码
      const passFile = path.resolve(__dirname, '..', '.admin_password');
      let adminPassword = '';
      try {
        if (fs.existsSync(passFile)) {
          adminPassword = fs.readFileSync(passFile, 'utf-8').trim();
        }
      } catch (e) {}
      
      async function promptPassword() {
        return new Promise((resolve) => {
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          rl.question('请输入市场服务器管理员密码: ', (ans) => {
            rl.close();
            resolve(String(ans || '').trim());
          });
        });
      }
      if (!adminPassword) {
        adminPassword = await promptPassword();
        try { if (adminPassword) fs.writeFileSync(passFile, adminPassword, 'utf-8'); } catch (e) {}
      }

      const pingUrl = (process.env.MARKET_URL ? process.env.MARKET_URL.replace(/\/api\/admin\/publish$/, '') : 'https://orbiboard.3r60.top') + '/api/ping';
      try { await fetch(pingUrl); } catch (e) {}
      
      const buildFormData = () => {
        const fd = new FormData();
        fd.append('version', newVer);
        fd.append('asarSupported', 'true');
        if (changelog) fd.append('changelog', changelog);
        if (adminPassword) fd.append('adminPassword', adminPassword);
        
        if (uploadMap.windows && fs.existsSync(uploadMap.windows)) {
          const buf = fs.readFileSync(uploadMap.windows);
          fd.append('windows', new Blob([buf]), path.basename(uploadMap.windows));
        }
        if (uploadMap.uos && fs.existsSync(uploadMap.uos)) {
          const buf = fs.readFileSync(uploadMap.uos);
          fd.append('uos', new Blob([buf]), path.basename(uploadMap.uos));
        }
        if (uploadMap.asar && fs.existsSync(uploadMap.asar)) {
          const buf = fs.readFileSync(uploadMap.asar);
          fd.append('asar', new Blob([buf]), path.basename(uploadMap.asar));
        }
        return fd;
      };

      let resUpload;
      try {
        resUpload = await fetch(serverUrl, { method: 'POST', body: buildFormData() });
      } catch (e) {
        resUpload = { ok: false, status: 0, error: e && e.message };
      }
      
      if (!resUpload || !resUpload.ok) {
        if (resUpload && resUpload.status === 401) {
          try { fs.unlinkSync(passFile); } catch (e) {}
          console.log('[Publish] Password rejected or expired.');
          adminPassword = await promptPassword();
          try { if (adminPassword) fs.writeFileSync(passFile, adminPassword, 'utf-8'); } catch (e) {}
          
          try {
            resUpload = await fetch(serverUrl, { method: 'POST', body: buildFormData() });
          } catch (e) {
            resUpload = { ok: false, status: 0, error: e && e.message };
          }
        }
      }
      
      if (resUpload && resUpload.ok) {
        const data = await resUpload.text();
        console.log('[Publish] Upload success!');
        console.log(data);
      } else {
        console.error('[Publish] Upload failed:', (resUpload && resUpload.status) || 0);
        let err = '';
        try { err = await (resUpload && resUpload.text ? resUpload.text() : ''); } catch (e) {}
        console.error(err || (resUpload && resUpload.error) || 'read error');
      }

    } catch (e) {
      console.error('[Publish] Build failed:', e);
      process.exit(1);
    }

  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
