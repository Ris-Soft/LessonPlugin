const http = require('http');
const fs = require('fs');
const path = require('path');

const rootRenderer = path.join(__dirname, '..', 'src', 'renderer');
const rootPlugins = path.join(__dirname, '..', 'src', 'plugins');
const port = process.env.PORT || 8080;

function resolveFile(urlPath) {
  // 支持 /plugins/* 路由用于预览插件设置页
  if (urlPath.startsWith('/plugins/')) {
    const rel = urlPath.replace(/^\/plugins\//, '');
    let fp = path.join(rootPlugins, rel);
    // 若未指定扩展名，默认尝试 index.html
    if (!path.extname(rel)) fp = path.join(rootPlugins, rel, 'index.html');
    return fp;
  }
  // 明确处理 /renderer/* 路由，指向 renderer 根目录
  if (urlPath.startsWith('/renderer/')) {
    const rel = urlPath.replace(/^\/renderer\//, '');
    return path.join(rootRenderer, rel);
  }
  // 其他走 renderer 静态文件
  let fp = path.join(rootRenderer, urlPath.replace(/^\//, ''));
  if (urlPath === '/' || !path.extname(urlPath)) fp = path.join(rootRenderer, 'splash.html');
  return fp;
}

function serve(req, res) {
  const urlPath = decodeURI(req.url.split('?')[0]);
  const filePath = resolveFile(urlPath);
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const types = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.woff2': 'font/woff2'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

http.createServer(serve).listen(port, () => {
  console.log(`Static server running at http://localhost:${port}/`);
});