// Static server for local use. Only the app's own files are reachable.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PORT = Number(process.env.PORT ?? 5173);
const HOST = process.env.HOST ?? '127.0.0.1';
// Set to `/recall` to try the app under a subfolder, as on GitHub Pages.
const BASE_PATH = (process.env.BASE_PATH ?? '').replace(/\/$/, '');

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};
const PUBLIC = [/^index\.html$/, /^styles\.css$/, /^sw\.js$/, /^manifest\.webmanifest$/, /^src[\\/]/, /^icons[\\/]/];

const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (BASE_PATH && !url.pathname.startsWith(`${BASE_PATH}/`)) {
    res.writeHead(404).end('Not found');
    return;
  }
  const pathname = url.pathname.slice(BASE_PATH.length);
  const relative = normalize(decodeURIComponent(pathname === '/' ? '/index.html' : pathname)).replace(/^[\\/]+/, '');
  if (relative.split(sep).includes('..') || !PUBLIC.some((rule) => rule.test(relative))) {
    res.writeHead(404).end('Not found');
    return;
  }
  try {
    const body = await readFile(join(ROOT, relative));
    res.writeHead(200, { 'Content-Type': TYPES[extname(relative)] ?? 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
});

server.listen(PORT, HOST, () => console.log(`Recall em http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
