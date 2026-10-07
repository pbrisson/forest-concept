import { createServer } from 'node:http';
import { createReadStream } from 'node:fs';
import { stat, realpath } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, relative, isAbsolute, extname } from 'node:path';

const root = await realpath(fileURLToPath(new URL('./public/', import.meta.url)));
const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? '0.0.0.0';
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.png': 'image/png', '.webp': 'image/webp', '.bin': 'application/octet-stream', '.txt': 'text/plain; charset=utf-8' };
const inside = path => {
  const rel = relative(root, path);
  return rel !== '..' && !rel.startsWith('../') && !rel.startsWith('..\\') && !isAbsolute(rel);
};

const server = createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
  }
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const candidate = resolve(root, '.' + (pathname.endsWith('/') ? pathname + 'index.html' : pathname));
    if (!inside(candidate)) { res.writeHead(403); res.end(); return; }
    const file = await realpath(candidate);
    if (!inside(file)) { res.writeHead(403); res.end(); return; }
    const info = await stat(file);
    if (!info.isFile()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': types[extname(file)] ?? 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': 'no-cache',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(file);
    stream.on('error', () => res.destroy());
    res.on('close', () => stream.destroy());
    stream.pipe(res);
  } catch (error) {
    res.writeHead(error instanceof URIError || error.code === 'ERR_INVALID_URL' ? 400 : ['ENOENT', 'ENOTDIR'].includes(error.code) ? 404 : 500);
    res.end();
  }
});
server.listen(port, host, () => console.log(`Forest available at http://${host}:${server.address().port}`));
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
