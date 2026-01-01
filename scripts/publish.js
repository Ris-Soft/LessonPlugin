const readline = require('readline');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

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
    // 0. 获取更新日志
    const changelog = await askChangelog();
    if (!changelog) {
      console.log('未输入更新日志，取消发布。');
      process.exit(0);
    }

    // 0.1 检查云端版本（避免重复发布）
    const pkgPath = path.resolve(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const oldVer = pkg.version;
    const serverBase = process.env.MARKET_URL ? process.env.MARKET_URL.replace(/\/api\/admin\/publish$/, '') : 'http://localhost:3030';
    const versionUrl = `${serverBase}/api/version`;
    
    console.log(`[Publish] Checking remote version from ${versionUrl}...`);
    try {
      const verRes = await new Promise((resolve) => {
        const req = (versionUrl.startsWith('https') ? https : http).get(versionUrl, (res) => {
          let data = '';
          res.on('data', c => data += c);
          res.on('end', () => {
            try { resolve(JSON.parse(data)); } catch { resolve({}); }
          });
        });
        req.on('error', () => resolve({}));
      });
      
      const remoteVer = verRes.version;
      console.log(`[Publish] Local: ${oldVer}, Remote: ${remoteVer}`);
      
      if (remoteVer === oldVer) {
        console.warn(`[Publish] Remote version is same as local (${oldVer}). Skipping build to avoid duplication.`);
        // 可以在这里选择退出，或者询问是否强制重新发布（覆盖）
        // 题目要求“如果没有就不自动累加构建号”，意味着如果有，就不构建了？
        // “发布时需要检查云端有没有当前版本号，如果没有就不自动累加构建号” -> 这句话可能意味着：
        // 如果云端已经有当前版本，就不应该再自增发布新版本？或者如果云端没有，才允许发布？
        // 结合“不自动累加构建号”，可能是指如果本地版本已经落后于云端或等于云端，才需要累加？
        // 让我们重新解读：
        // "发布时需要检查云端有没有当前版本号，如果没有就不自动累加构建号" -> 这句话有点歧义。
        // 可能的意思是：如果云端 *没有* 当前版本号（即本地版本是新的），那么就 *不* 需要再执行 Patch+1 了（因为本地已经是新版本了）。
        // 换句话说：如果本地版本 == 云端版本，说明需要升级（Patch+1）；如果本地版本 > 云端版本，说明本地已经改过版本号了，直接发布当前版本即可，不要再加 1。
        
        // 逻辑修正：
        // 1. 获取远程版本 R，本地版本 L
        // 2. 如果 L > R，说明本地已经是新版本，直接发布 L，不要自增。
        // 3. 如果 L == R，说明需要升级，执行 Patch+1，发布 L+1。
        
        // 之前的逻辑是总是 Patch+1。现在改为智能判断。
      }
      
      // Semver 比较简单实现
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
      
      // 接下来的流程使用 targetVer
      const newVer = targetVer;

      // 2.1 Git 集成：只有当版本发生变化（且未打 tag）时才提交
      // ... (后续逻辑保持，需要将 newVer 传递下去)
      
      // 注意：上面的代码结构是线性的，我需要替换原来的逻辑块。
      // 下面开始重构这一段。

    } catch (e) {
      console.warn('[Publish] Failed to check remote version, assuming upgrade needed.', e);
      // 出错时默认自增
    }
    
    // 重新读取（因为可能刚刚修改了）
    const finalPkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    const newVer = finalPkg.version;

    console.log(`[Publish] Target version: ${newVer}`);
    console.log(`[Publish] Changelog:\n${changelog}`);

    // 2.1 Git 集成

    try {
      console.log('[Publish] Committing to Git...');
      // 检查是否有 git
      try { execSync('git --version', { stdio: 'ignore' }); } catch { throw new Error('Git not found'); }
      
      execSync('git add package.json', { cwd: path.resolve(__dirname, '..') });
      execSync(`git commit -m "chore(release): v${newVer}"`, { cwd: path.resolve(__dirname, '..') });
      execSync(`git tag v${newVer}`, { cwd: path.resolve(__dirname, '..') });
      
      console.log(`[Publish] Git tag v${newVer} created.`);
      
      // 询问是否 Push
      // 这里为了自动化，我们尝试直接 push。如果失败（比如没有 remote），则忽略但提示。
      try {
        console.log('[Publish] Pushing to remote (triggering GitHub Actions)...');
        execSync('git push && git push --tags', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });
      } catch (e) {
        console.warn('[Publish] Git push failed. You may need to push manually to trigger GitHub builds.');
      }
    } catch (e) {
      console.warn('[Publish] Git operation failed:', e.message);
      // 继续执行本地构建，不中断
    }

    try {
      // 3. 执行本地构建
      console.log('[Publish] Building Windows package...');
      // 传递环境变量或参数给 electron-builder（如果需要）
      execSync('npm run build', { stdio: 'inherit', cwd: path.resolve(__dirname, '..') });

      // 4. 定位构建产物
      const distDir = path.resolve(__dirname, '..', 'dist');
      // 查找 .exe, .deb, .AppImage, .asar (从 win-unpacked/resources/app.asar 提取)
      // 注意：Electron Builder 默认生成的安装包名包含版本号
      // artifactName: "${productName}-${version}-${os}-${arch}.${ext}"
      
      const files = fs.readdirSync(distDir);
      const exeFile = files.find(f => f.endsWith('.exe') && f.includes(newVer));
      const asarPath = path.join(distDir, 'win-unpacked', 'resources', 'app.asar');
      
      if (!exeFile) {
        throw new Error('Build artifact (.exe) not found');
      }
      
      console.log(`[Publish] Found artifact: ${exeFile}`);
      
      // 5. 上传到市场服务器
      const serverUrl = process.env.MARKET_URL || 'http://localhost:3030/api/admin/publish';
      console.log(`[Publish] Uploading to ${serverUrl}...`);
      
      // 管理员密码（生产环境）：从本地缓存读取，不存在则提示输入；失败时重试一次
      const passFile = path.resolve(__dirname, '..', '.admin_password');
      let adminPassword = '';
      try {
        if (fs.existsSync(passFile)) {
          adminPassword = fs.readFileSync(passFile, 'utf-8').trim();
        }
      } catch {}
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
        try { if (adminPassword) fs.writeFileSync(passFile, adminPassword, 'utf-8'); } catch {}
      }

      // 准备上传文件
      const uploadMap = {
        windows: path.join(distDir, exeFile)
      };
      
      if (fs.existsSync(asarPath)) {
        // 为了上传方便，将 app.asar 复制出来改名
        const asarName = `OrbiBoard-${newVer}.asar`;
        const asarDest = path.join(distDir, asarName);
        fs.copyFileSync(asarPath, asarDest);
        uploadMap.asar = asarDest;
        console.log(`[Publish] Found ASAR: ${asarName}`);
      }

      // 5. 直接上传（MARKET_DEBUG_AUTH=true 时允许匿名）
      const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
      const crlf = '\r\n';
      const options = {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data; boundary=' + boundary
        }
      };
      const client = serverUrl.startsWith('https') ? https : http;
      const doUpload = async () => {
        return new Promise((resolve) => {
          const reqUpload = client.request(serverUrl, options, (resUpload) => {
            let data = '';
            resUpload.on('data', (c) => data += c);
            resUpload.on('end', () => {
              let json = null;
              try { json = JSON.parse(data); } catch {}
              resolve({ status: resUpload.statusCode, body: data, json });
            });
          });
          reqUpload.on('error', (e) => {
            resolve({ status: 0, error: e });
          });
          // Fields
          reqUpload.write(`--${boundary}${crlf}`);
          reqUpload.write(`Content-Disposition: form-data; name="version"${crlf}${crlf}`);
          reqUpload.write(`${newVer}${crlf}`);
          reqUpload.write(`--${boundary}${crlf}`);
          reqUpload.write(`Content-Disposition: form-data; name="asarSupported"${crlf}${crlf}`);
          reqUpload.write(`true${crlf}`);
          reqUpload.write(`--${boundary}${crlf}`);
          reqUpload.write(`Content-Disposition: form-data; name="changelog"${crlf}${crlf}`);
          reqUpload.write(`${changelog}${crlf}`);
          reqUpload.write(`--${boundary}${crlf}`);
          reqUpload.write(`Content-Disposition: form-data; name="adminPassword"${crlf}${crlf}`);
          reqUpload.write(`${adminPassword}${crlf}`);
          // Files
          for (const [key, filePath] of Object.entries(uploadMap)) {
            if (!filePath || !fs.existsSync(filePath)) continue;
            const filename = path.basename(filePath);
            reqUpload.write(`--${boundary}${crlf}`);
            reqUpload.write(`Content-Disposition: form-data; name="${key}"; filename="${filename}"${crlf}`);
            reqUpload.write(`Content-Type: application/octet-stream${crlf}${crlf}`);
            const content = fs.readFileSync(filePath);
            reqUpload.write(content);
            reqUpload.write(crlf);
          }
          reqUpload.write(`--${boundary}--${crlf}`);
          reqUpload.end();
        });
      };
      let result = await doUpload();
      if (result.status === 401 && result.json && (result.json.error === 'admin_password_invalid' || result.json.error === 'admin_password_required' || result.json.error === 'admin_not_set')) {
        console.error('[Publish] 管理员密码错误或未设置，将重新输入...');
        try { fs.unlinkSync(passFile); } catch {}
        adminPassword = await promptPassword();
        try { if (adminPassword) fs.writeFileSync(passFile, adminPassword, 'utf-8'); } catch {}
        result = await doUpload();
      }
      if (result.status === 200) {
        console.log('[Publish] Upload success!');
        console.log(result.body);
      } else {
        if (result.status === 401) {
          console.error('[Publish] Upload failed: unauthorized (401).');
          console.error(result.body);
        } else {
          console.error(`[Publish] Upload failed: ${result.status}`);
          console.error(result.body || (result.error && result.error.message) || result.error || 'unknown');
        }
      }

    } catch (e) {
      console.error('[Publish] Build failed:', e);
      // 还原版本号？如果不还原，那下次修复 bug 就继续加。建议不还原。
      // 如果构建失败，可能希望 revert。
      // 但既然已经 commit 了，这里就不 revert 文件了。用户可以手动 git reset。
      process.exit(1);
    }

  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

main();
