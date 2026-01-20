const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawn } = require('child_process');
const https = require('https');
const http = require('http');
const extract = require('extract-zip');

let tar = null;
try { tar = require('tar'); } catch (e) {}

function ensureTar() {
  if (!tar) {
    try { tar = require('tar'); } catch (e) {}
  }
  return !!tar;
}

function getTar() {
  return tar;
}

// 生成稳定 ID：优先使用 id，其次 name，再次 fallbackStr；若全为特殊字符导致为空，则使用 MD5 哈希
function generateStableId(metaId, name, fallbackStr, prefix = 'plugin') {
  const rawId = String(metaId || '').trim();
  const cleanId = rawId.toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (cleanId) return cleanId;

  const slugFromName = String(name || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (slugFromName) return slugFromName;

  const slugFromFallback = String(fallbackStr || '').toLowerCase().replace(/\./g, '-').replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '');
  if (slugFromFallback) return slugFromFallback;

  // 使用 MD5 生成稳定 ID
  const source = String(name || fallbackStr || Date.now());
  const hash = crypto.createHash('md5').update(source).digest('hex').slice(0, 12);
  return `${prefix}_${hash}`;
}

function extractWithSystemTar(file, cwd) {
  return new Promise((resolve, reject) => {
    try {
      const args = process.platform === 'win32'
        ? ['-x', '-f', file, '-C', cwd]
        : ['-x', '-z', '-f', file, '-C', cwd];
      const proc = spawn('tar', args, { stdio: 'ignore' });
      proc.on('error', (e) => reject(e));
      proc.on('exit', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`tar_exit_${code}`));
      });
    } catch (e) {
      reject(e);
    }
  });
}

function extractTgzPureJS(file, cwd) {
  return new Promise((resolve, reject) => {
    try {
      const gz = fs.readFileSync(file);
      const tarBuf = zlib.gunzipSync(gz);
      let i = 0;
      const isEmptyHeader = (buf) => {
        for (let j = 0; j < 512; j++) { if (buf[j] !== 0) return false; }
        return true;
      };
      while (i + 512 <= tarBuf.length) {
        const header = tarBuf.slice(i, i + 512);
        if (isEmptyHeader(header)) break;
        const name = header.toString('utf8', 0, 100).replace(/\0.*$/, '');
        const sizeStr = header.toString('utf8', 124, 136).replace(/\0.*$/, '').trim();
        const typeflag = header[156];
        const size = parseInt(sizeStr, 8) || 0;
        i += 512;
        const data = tarBuf.slice(i, i + size);
        i += size;
        const pad = (512 - (size % 512)) % 512;
        i += pad;
        const safe = String(name || '').replace(/\\/g, '/');
        const outPath = path.join(cwd, safe);
        if (!outPath.startsWith(path.resolve(cwd))) continue;
        if (typeflag === 53) {
          try { fs.mkdirSync(outPath, { recursive: true }); } catch (e) {}
        } else {
          try { fs.mkdirSync(path.dirname(outPath), { recursive: true }); } catch (e) {}
          fs.writeFileSync(outPath, data);
        }
      }
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function readJsonSafe(jsonPath, fallback) {
  try {
    const raw = fs.readFileSync(jsonPath, 'utf-8');
    return JSON.parse(raw);
  } catch (e) {
    return fallback;
  }
}

function writeJsonSafe(jsonPath, data) {
  fs.writeFileSync(jsonPath, JSON.stringify(data, null, 2), 'utf-8');
}

function httpGet(url) {
  return new Promise((resolve) => {
    try {
      const mod = url.startsWith('https') ? https : http;
      const req = mod.get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return resolve(httpGet(res.headers.location));
        }
        if ((res.statusCode || 0) !== 200) {
          let err = '';
          res.on('data', (d) => { err += String(d || ''); });
          res.on('end', () => resolve({ ok: false, error: `HTTP_${res.statusCode}: ${err}` }));
          return;
        }
        const chunks = [];
        res.on('data', (d) => chunks.push(Buffer.from(d)));
        res.on('end', () => resolve({ ok: true, buffer: Buffer.concat(chunks) }));
      });
      req.on('error', (e) => resolve({ ok: false, error: e?.message || String(e) }));
    } catch (e) {
      resolve({ ok: false, error: e?.message || String(e) });
    }
  });
}

function fetchJson(url) {
  return httpGet(url).then((res) => {
    if (!res.ok) return { ok: false, error: res.error };
    try { return { ok: true, json: JSON.parse(res.buffer.toString('utf-8')) }; }
    catch (e) { return { ok: false, error: e?.message || 'json_parse_error' }; }
  });
}

function expandZip(zipPath, dest) {
  // 使用纯 Node 依赖 extract-zip，避免外部命令依赖（如 PowerShell）
  return extract(zipPath, { dir: dest })
    .then(() => ({ ok: true }))
    .catch((e) => ({ ok: false, error: e?.message || String(e) }));
}

module.exports = {
  ensureTar,
  getTar,
  generateStableId,
  extractWithSystemTar,
  extractTgzPureJS,
  readJsonSafe,
  writeJsonSafe,
  httpGet,
  fetchJson,
  expandZip
};
