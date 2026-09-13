import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve } from 'node:path';

const root = resolve('.');
const port = Number(process.env.LOCKIN_UI_TEST_PORT || 4178);
const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
};

createServer(async (request, response) => {
  try {
    const requested = request.url === '/' ? '/src/pages/options/options.html' : request.url.split('?')[0];
    const path = resolve(root, `.${requested}`);
    if (!path.startsWith(root)) throw new Error('Path escapes test root.');
    let body = await readFile(path);
    if (requested.endsWith('/options.html') || requested.endsWith('/popup.html')) {
      body = Buffer.from(body.toString('utf8').replace(
        '<script type="module"',
        '<script src="../../../tests/ui/chrome-mock.js"></script><script type="module"'
      ));
    }
    response.writeHead(200, { 'content-type': mime[extname(path)] || 'application/octet-stream' });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end(error.message);
  }
}).listen(port, '127.0.0.1', () => {
  console.log(`Lock In UI test server listening on http://127.0.0.1:${port}/`);
});
