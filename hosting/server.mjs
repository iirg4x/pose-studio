import http from 'node:http';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare } from './prepare.mjs';
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.glb': 'model/gltf-binary',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
};
export function createHost({ cache, dist = path.join(appRoot, 'dist'), catalog }) {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader(
      'Content-Security-Policy',
      "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; worker-src 'self' blob:; connect-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
    );
    const send = (status, body, type = 'text/plain; charset=utf-8') => {
      res.writeHead(status, { 'Content-Type': type });
      res.end(body);
    };
    try {
      const url = new URL(req.url, 'http://localhost'),
        pathname = decodeURIComponent(url.pathname);
      if (pathname.startsWith('/open/')) {
        res.writeHead(302, { Location: '/' });
        return res.end();
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(405, 'Method not allowed');
      if (pathname === '/api/catalog')
        return send(200, JSON.stringify(catalog), 'application/json');
      let filename;
      if (pathname.startsWith('/api/clips/')) {
        const id = pathname.slice(11);
        if (!catalog.clips.some((c) => c.id === id)) return send(404, 'Animation not found');
        filename = path.join(cache, 'clips', id + '.json.gz');
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Type', 'application/json');
      } else if (pathname.startsWith('/api/assets/')) {
        const id = pathname.slice(12);
        if (!/^(?:[a-f0-9]{64}|builtin-[a-z-]+|example-fantasy-(?:male|female))$/.test(id))
          return send(404, 'Asset not found');
        filename = path.join(cache, 'assets', id + '.glb');
        res.setHeader('Content-Type', 'model/gltf-binary');
        res.setHeader('Cache-Control', 'private, max-age=86400');
      } else {
        if (pathname.includes('\\') || pathname.includes('\0')) return send(400, 'Invalid path');
        filename = path.resolve(dist, '.' + (pathname === '/' ? '/index.html' : pathname));
        if (!filename.startsWith(path.resolve(dist) + path.sep)) return send(403, 'Forbidden');
        res.setHeader('Content-Type', mime[path.extname(filename)] ?? 'application/octet-stream');
        if (pathname.startsWith('/assets/'))
          res.setHeader('Cache-Control', 'private, max-age=86400');
      }
      const stat = await fs.stat(filename);
      if (!stat.isFile()) return send(404, 'Not found');
      res.setHeader('Content-Length', stat.size);
      if (req.method === 'HEAD') return res.end();
      const stream = createReadStream(filename);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    } catch (e) {
      if (!res.headersSent)
        send(
          e.code === 'ENOENT' ? 404 : 500,
          e.code === 'ENOENT' ? 'Not found' : 'Could not serve this request',
        );
      else res.destroy();
    }
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const settings = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
  const catalog = await prepare(settings.project, settings.cache);
  const server = createHost({ ...settings, catalog });
  server.listen(settings.port ?? 47831, settings.bindHost ?? '127.0.0.1', () =>
    console.log(
      'Pose host ready at http://' +
        (settings.bindHost ?? '127.0.0.1') +
        ':' +
        (settings.port ?? 47831),
    ),
  );
}
