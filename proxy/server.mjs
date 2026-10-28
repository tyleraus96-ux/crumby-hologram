#!/usr/bin/env node
// Optional local server for the Mac Mini: serves the hologram and forwards /api/* to
// https://api.x.ai/v1/* adding your key from the XAI_API_KEY environment variable, so the
// key never has to be pasted into a browser. Node 18+; no dependencies.
//
//   XAI_API_KEY=xai-... node proxy/server.mjs          # http://localhost:8787
//   PORT=9000 HOST=0.0.0.0 XAI_API_KEY=... node proxy/server.mjs   # also reachable on your LAN (trusted networks only)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 8787), HOST = process.env.HOST || '127.0.0.1';
const KEY = (process.env.XAI_API_KEY || '').trim();
const UPSTREAM = 'https://api.x.ai/v1/';
const ALLOWED = /^(stt|tts|tts\/voices|chat\/completions)$/;
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.md': 'text/plain; charset=utf-8',
  '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.mjs': 'text/javascript; charset=utf-8' };

if (!KEY) console.warn('XAI_API_KEY is not set: the page will run in demo mode (or with a key pasted in its settings).');

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname === '/api/health') return send(res, 200, JSON.stringify({ ok: !!KEY }), 'application/json');
    if (url.pathname.startsWith('/api/')) {
      const path = url.pathname.slice(5);
      if (!KEY) return send(res, 503, 'XAI_API_KEY not set on the server');
      if (!ALLOWED.test(path)) return send(res, 404, 'not proxied');
      const headers = { Authorization: `Bearer ${KEY}` };
      if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
      const body = req.method === 'GET' ? undefined : Readable.toWeb(req);
      const up = await fetch(UPSTREAM + path, { method: req.method, headers, body, duplex: 'half' });
      res.writeHead(up.status, { 'Content-Type': up.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': 'no-store' });
      if (up.body) Readable.fromWeb(up.body).pipe(res); else res.end();
      return;
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '');
    if (p.startsWith('..') || p.startsWith('proxy')) return send(res, 404, 'not found');
    let file = join(ROOT, p || 'index.html');
    if ((await stat(file).catch(() => null))?.isDirectory()) file = join(file, 'index.html');
    const data = await readFile(file), type = TYPES[extname(file)] || 'application/octet-stream';
    // byte ranges: Safari will not play a video without them
    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
    if (m && (m[1] || m[2])) {
      let a = m[1] ? +m[1] : data.length - +m[2], b = m[1] && m[2] ? Math.min(+m[2], data.length - 1) : data.length - 1;
      if (a >= data.length || a > b) { res.writeHead(416, { 'Content-Range': `bytes */${data.length}` }); return res.end(); }
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${data.length}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes' });
      return res.end(data.subarray(a, b + 1));
    }
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Accept-Ranges': 'bytes' }); res.end(data);
  } catch (e) {
    send(res, e.code === 'ENOENT' ? 404 : 500, e.code === 'ENOENT' ? 'not found' : 'server error');
  }
}).listen(PORT, HOST, () => console.log(`Hologram on http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}  (proxy ${KEY ? 'ON' : 'OFF: no key'})`));

function send(res, code, body, type = 'text/plain; charset=utf-8') { res.writeHead(code, { 'Content-Type': type }); res.end(body); }
