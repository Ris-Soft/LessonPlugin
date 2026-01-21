const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const url = require('url');
const Store = require('../Store/Main');
const Registry = require('./Registry');
const Installer = require('./Installer');
const PackageManager = require('./PackageManager');

// 简单的 JSON 获取函数
function getJson(u) {
  return new Promise((resolve, reject) => {
    try {
      const p = url.parse(u);
      const lib = (p.protocol === 'https:' ? https : http);
      const req = lib.get(u, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(getJson(res.headers.location));
        }
        if (res.statusCode !== 200) {
          return reject(new Error(String(res.statusCode)));
        }
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { reject(e); }
        });
      });
      req.on('error', (e) => reject(e));
    } catch (e) {
      reject(e);
    }
  });
}

function compareVersions(v1, v2) {
  const p1 = String(v1 || '0').split('.').map(x => parseInt(x) || 0);
  const p2 = String(v2 || '0').split('.').map(x => parseInt(x) || 0);
  const len = Math.max(p1.length, p2.length);
  for (let i = 0; i < len; i++) {
    const n1 = p1[i] || 0;
    const n2 = p2[i] || 0;
    if (n1 > n2) return 1;
    if (n1 < n2) return -1;
  }
  return 0;
}

// 执行插件自动更新
async function runAutoUpdate() {
  try {
    const config = Store.getAll('system');
    if (config.autoUpdatePluginsEnabled === false) return { ok: true, updated: [], skipped: true };

    const serviceBase = config.serviceBase || config.marketApiBase || 'https://orbiboard.3r60.top/';
    const catalogUrl = new URL('/api/market/catalog', serviceBase).toString();

    let catalog;
    try {
      catalog = await getJson(catalogUrl);
    } catch (e) {
      console.error('[PluginAutoUpdate] Failed to fetch catalog:', e);
      return { ok: false, error: 'catalog_fetch_failed' };
    }

    if (!catalog) return { ok: false, error: 'empty_catalog' };

    const allMarketItems = [
      ...(catalog.plugins || []),
      ...(catalog.automation || []),
      ...(catalog.components || [])
    ];

    const updatedPlugins = [];

    // 遍历已安装插件
    for (const p of Registry.manifest.plugins) {
      // 忽略本地开发的非标准插件（可选）
      // if (!p.id) continue;

      // 在市场中查找
      const marketItem = allMarketItems.find(item => 
        (p.id && item.id === p.id) || 
        (p.name && item.name === p.name) ||
        (p.npm && item.npm === p.npm)
      );

      if (!marketItem) continue;

      // 检查版本
      const localVer = p.version;
      let remoteVer = marketItem.version;

      // 如果是 NPM 插件，可能需要检查 NPM 注册表获取最新版本
      // 为了简化启动速度，这里优先使用市场目录中的 version 字段（通常市场目录会定期更新）
      // 如果市场目录没有 version 或者想要更精确，可以调用 PackageManager.getPackageVersions
      // 但这里暂且信任市场目录

      if (marketItem.npm && !remoteVer) {
         // TODO: 检查 NPM 最新版
         try {
           const versions = await PackageManager.getPackageVersions(marketItem.npm);
           if (versions && versions.length) {
             remoteVer = versions[versions.length - 1];
           }
         } catch(e) {}
      }

      if (remoteVer && localVer && compareVersions(remoteVer, localVer) > 0) {
        console.log(`[PluginAutoUpdate] Updating ${p.name} from ${localVer} to ${remoteVer}...`);
        
        let success = false;
        try {
          if (marketItem.zip) {
             // ZIP 更新
             const zipUrl = new URL(marketItem.zip, serviceBase).toString();
             // 下载 ZIP
             const tmpDir = path.join(require('electron').app.getPath('temp'), 'OrbiBoard', 'PluginUpdate');
             try { fs.mkdirSync(tmpDir, { recursive: true }); } catch(e){}
             const tmpFile = path.join(tmpDir, `${p.id || p.name}_${remoteVer}.zip`);
             
             // 简单的下载实现
             await new Promise((resolve, reject) => {
               const lib = zipUrl.startsWith('https') ? https : http;
               const file = fs.createWriteStream(tmpFile);
               lib.get(zipUrl, res => {
                 if(res.statusCode !== 200) { reject(new Error(res.statusCode)); return; }
                 res.pipe(file);
                 file.on('finish', () => { file.close(); resolve(); });
               }).on('error', err => { fs.unlink(tmpFile, () => {}); reject(err); });
             });

             // 读取 ZIP 并安装
             // const zipData = fs.readFileSync(tmpFile); // 不需要读取数据
             // const enrichedItem = { ...marketItem, version: remoteVer };
             
             // 使用 Installer.installFromZip (它只接受文件路径)
             const installRes = await Installer.installFromZip(tmpFile);
             success = installRes && installRes.ok;
             
             try { fs.unlinkSync(tmpFile); } catch(e){}

          } else if (marketItem.npm) {
            // NPM 更新
            const dl = await PackageManager.downloadPackageVersion(marketItem.npm, remoteVer);
            if (dl && dl.ok) {
              const sw = await PackageManager.switchPluginVersion(p.id || p.name, marketItem.npm, remoteVer);
              success = sw && sw.ok;
            }
          }
        } catch (e) {
          console.error(`[PluginAutoUpdate] Failed to update ${p.name}:`, e);
        }

        if (success) {
          updatedPlugins.push({
            name: p.name,
            oldVersion: localVer,
            newVersion: remoteVer,
            notes: marketItem.description || '' // 暂无 changelog 字段，用描述代替或留空
          });
        }
      }
    }

    if (updatedPlugins.length > 0) {
      // 重新扫描以更新内存中的清单
      const Discovery = require('./Discovery');
      Discovery.scanPlugins();
      // 注意：这里不会重新加载已加载的代码，但会更新 Registry.manifest
      // 如果需要在不重启的情况下生效，可能需要 reload 逻辑，但为了稳定性，通常建议提示用户重启。
      // 不过，如果这是在启动阶段调用的（loadPlugins 之前），那么 scanPlugins 后再 loadPlugins 就会加载新版。
    }

    return { ok: true, updated: updatedPlugins };

  } catch (e) {
    console.error('[PluginAutoUpdate] Error:', e);
    return { ok: false, error: e.message };
  }
}

module.exports = { runAutoUpdate };
