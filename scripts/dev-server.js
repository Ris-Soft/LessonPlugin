const http = require('http');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..', 'src', 'renderer');
const port = process.env.PORT || 8080;

function serve(req, res) {
  const urlPath = decodeURI(req.url.split('?')[0]);
  let filePath = path.join(root, urlPath);
  if (urlPath === '/' || !path.extname(urlPath)) {
    filePath = path.join(root, 'splash.html');
  }
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
      '.json': 'application/json; charset=utf-8'
    };
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  });
}

http.createServer(serve).listen(port, () => {
  console.log(`Static server running at http://localhost:${port}/`);
});