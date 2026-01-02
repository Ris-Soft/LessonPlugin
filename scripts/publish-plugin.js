const fs = require('fs');
const path = require('path');

let archiver, FormData, axios;
try {
  archiver = require('archiver');
  FormData = require('form-data');
  axios = require('axios');
} catch (e) {
  // Fallback to scripts-runner
  const runnerPath = path.join(__dirname, '..', '..', 'scripts-runner', 'node_modules');
  archiver = require(path.join(runnerPath, 'archiver'));
  FormData = require(path.join(runnerPath, 'form-data'));
  axios = require(path.join(runnerPath, 'axios'));
}
// Handle axios default export for different versions
if (axios.default) axios = axios.default;

const MARKET_SERVER = 'http://localhost:3030';
const TOKEN = 'orbiboard-dev';

const pluginName = process.argv[2];
if (!pluginName) {
  console.error('Usage: node scripts/publish-plugin.js <plugin-name>');
  process.exit(1);
}

// 假设插件位于 OrbiBoard 项目根目录的上一级（即 d:\OrbiBoard\<pluginName>）
// 或者位于 d:\OrbiBoard\OrbiBoard\plugins (不存在)
// 根据 LS 结果，插件在 d:\OrbiBoard\<pluginName>
// 而当前脚本在 d:\OrbiBoard\OrbiBoard\scripts\
// 所以插件路径应该是 path.join(__dirname, '..', '..', pluginName)
const pluginDir = path.resolve(__dirname, '..', '..', pluginName);

if (!fs.existsSync(pluginDir)) {
  console.error(`Plugin directory not found: ${pluginDir}`);
  process.exit(1);
}

const pluginJsonPath = path.join(pluginDir, 'plugin.json');
const automationJsonPath = path.join(pluginDir, 'automation.json');
let metaPath = pluginJsonPath;
if (!fs.existsSync(pluginJsonPath)) {
  if (fs.existsSync(automationJsonPath)) {
    metaPath = automationJsonPath;
  } else {
    console.error(`No plugin.json or automation.json found in ${pluginDir}`);
    process.exit(1);
  }
}

const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
console.log(`Publishing ${meta.name} (v${meta.version})...`);

// Create zip buffer
const archive = archiver('zip', { zlib: { level: 9 } });
const buffers = [];
archive.on('data', data => buffers.push(data));
archive.on('error', err => { throw err; });

// Pipe content to buffers
archive.directory(pluginDir, false);
archive.finalize().then(async () => {
  const zipBuffer = Buffer.concat(buffers);
  
  const form = new FormData();
  form.append('metadata', JSON.stringify(meta));
  form.append('file', zipBuffer, { filename: 'plugin.zip' });
  
  try {
    const res = await axios.post(`${MARKET_SERVER}/api/dev/publish`, form, {
      headers: {
        ...form.getHeaders(),
        'x-market-token': TOKEN
      }
    });
    
    if (res.data.ok) {
      console.log('✅ Publish successful!');
      console.log(`ID: ${res.data.id}`);
    } else {
      console.error('❌ Publish failed:', res.data);
    }
  } catch (e) {
    console.error('❌ Error publishing:', e.response ? e.response.data : e.message);
  }
});
