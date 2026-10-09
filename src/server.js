'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { Crawler } = require('./crawler');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

let crawler = null;
const clients = new Set();

function broadcast(event, data) {
  const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) res.write(message);
}

function clamp(value, min, max, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : fallback;
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 100_000) reject(new Error('Body too large'));
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function startCrawl(body) {
  const current = new Crawler({
    maxPages: clamp(body.maxPages, 1, 1000, 50),
    maxDepth: clamp(body.maxDepth, 0, 10, 2),
    politenessMs: clamp(body.politenessMs, 0, 60000, 1000),
    concurrency: clamp(body.concurrency, 1, 16, 4),
    sameHost: body.sameHost !== false,
  });
  current.seed(String(body.seeds || '').split(/[\s,]+/).filter(Boolean));

  crawler?.stop();
  crawler = current;

  for (const event of ['page', 'file', 'skipped', 'failed', 'stats', 'done']) {
    current.on(event, (data) => {
      if (crawler === current) broadcast(event, data);
    });
  }

  broadcast('reset', {});
  current.start().catch((err) => broadcast('failed', { url: '', message: err.message }));
}

async function handle(req, res) {
  const { pathname } = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'POST' && pathname === '/api/crawl') {
    startCrawl(await readJson(req));
    return sendJson(res, 202, { started: true });
  }

  if (req.method === 'POST' && pathname === '/api/stop') {
    crawler?.stop();
    return sendJson(res, 200, { stopping: Boolean(crawler) });
  }

  if (req.method === 'GET' && pathname === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    res.write(`event: stats\ndata: ${JSON.stringify(crawler?.stats ?? null)}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
    return;
  }

  if (req.method === 'GET' && pathname === '/api/results') {
    if (!crawler) return sendJson(res, 404, { error: 'No crawl has been run yet.' });
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Disposition': 'attachment; filename="crawl-results.json"',
    });
    return res.end(JSON.stringify(crawler.results(), null, 2));
  }

  if (req.method === 'GET') {
    const file = path.normalize(path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname));
    if (!file.startsWith(PUBLIC_DIR)) return sendJson(res, 403, { error: 'Forbidden' });
    return fs.readFile(file, (err, data) => {
      if (err) return sendJson(res, 404, { error: 'Not found' });
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
      res.end(data);
    });
  }

  sendJson(res, 405, { error: 'Method not allowed' });
}

http
  .createServer((req, res) => {
    handle(req, res).catch((err) => sendJson(res, 400, { error: err.message }));
  })
  .listen(PORT, HOST, () => {
    console.log(`Web crawler UI running at http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  });
