'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Frontier } = require('../src/frontier');
const { normalizeUrl, isFileUrl, parseHtml } = require('../src/parser');
const { parseRobots, isAllowed } = require('../src/robots');
const { Crawler, prioritise } = require('../src/crawler');

test('normalizeUrl canonicalises equivalent URLs', () => {
  assert.equal(normalizeUrl('HTTPS://Example.com:443/a/?b=2&a=1#top'), 'https://example.com/a?a=1&b=2');
  assert.equal(normalizeUrl('../c', 'https://example.com/a/b'), 'https://example.com/c');
  assert.equal(normalizeUrl('mailto:hi@example.com'), null);
  assert.equal(normalizeUrl('javascript:void(0)'), null);
});

test('isFileUrl separates files from pages', () => {
  assert.equal(isFileUrl('https://example.com/report.PDF'), true);
  assert.equal(isFileUrl('https://example.com/about'), false);
  assert.equal(isFileUrl('https://example.com/page.html'), false);
});

test('parseHtml extracts title and links', () => {
  const html = `<html><head><title>Hello &amp; welcome</title></head>
    <body><a href="/one">1</a><a class="x" href='two'>2</a><a href=three>3</a><a href="/one#dup">dup</a></body></html>`;
  const { title, links } = parseHtml(html, 'https://example.com/dir/');
  assert.equal(title, 'Hello & welcome');
  assert.deepEqual(links.sort(), [
    'https://example.com/dir/three',
    'https://example.com/dir/two',
    'https://example.com/one',
  ]);
});

test('parseHtml honours meta robots nofollow', () => {
  const html = '<meta name="robots" content="noindex, nofollow"><a href="/x">x</a>';
  assert.deepEqual(parseHtml(html, 'https://example.com/').links, []);
});

test('robots.txt rules use longest match', () => {
  const robots = parseRobots(
    'User-agent: *\nDisallow: /private\nAllow: /private/public\nCrawl-delay: 2\n\nUser-agent: OtherBot\nDisallow: /',
    'SimpleWebCrawler/1.0'
  );
  assert.equal(robots.crawlDelay, 2);
  assert.equal(isAllowed(robots, 'https://example.com/'), true);
  assert.equal(isAllowed(robots, 'https://example.com/private/secret'), false);
  assert.equal(isAllowed(robots, 'https://example.com/private/public/page'), true);
});

test('frontier serves higher priority first and enforces politeness per host', () => {
  const frontier = new Frontier({ politenessMs: 1000 });
  frontier.push({ url: 'https://a.com/low', priority: 2 });
  frontier.push({ url: 'https://a.com/high', priority: 0 });
  frontier.push({ url: 'https://b.com/mid', priority: 1 });

  assert.equal(frontier.next(0).item.url, 'https://a.com/high');
  assert.equal(frontier.next(0).item.url, 'https://b.com/mid');
  const waiting = frontier.next(500);
  assert.equal(waiting.item, null);
  assert.equal(waiting.waitMs, 500);
  assert.equal(frontier.next(1000).item.url, 'https://a.com/low');
  assert.equal(frontier.size, 0);
});

test('prioritise favours fresh content', () => {
  assert.ok(prioritise('https://x.com/news/today', 1) < prioritise('https://x.com/about', 1));
});

function fakeSite(pages) {
  const requests = [];
  const fetchImpl = async (url) => {
    requests.push(url);
    const { pathname } = new URL(url);
    const page = pages[pathname];
    if (!page) return new Response('not found', { status: 404, headers: { 'content-type': 'text/plain' } });
    return new Response(page.body, { status: 200, headers: { 'content-type': page.type || 'text/html' } });
  };
  return { fetchImpl, requests };
}

test('crawler follows links, skips duplicates, records files and respects robots.txt', async () => {
  const { fetchImpl, requests } = fakeSite({
    '/robots.txt': { body: 'User-agent: *\nDisallow: /secret', type: 'text/plain' },
    '/': { body: '<title>Home</title><a href="/a">a</a><a href="/b">b</a><a href="/secret">s</a><a href="/doc.pdf">pdf</a><a href="https://other.com/">ext</a>' },
    '/a': { body: '<title>A</title><a href="/">home</a><a href="/deep">deep</a>' },
    '/b': { body: '<title>A</title><a href="/">home</a><a href="/deep">deep</a>' },
    '/deep': { body: '<title>Deep</title><a href="/deeper">x</a>' },
  });

  const crawler = new Crawler({ fetchImpl, politenessMs: 0, maxDepth: 2, concurrency: 2 });
  const results = await crawler.start(['https://site.test/']);

  assert.deepEqual(results.pages.map((p) => p.title).sort(), ['A', 'Deep', 'Home']);
  assert.deepEqual(results.files.map((f) => f.url), ['https://site.test/doc.pdf']);
  assert.ok(results.skipped.some((s) => s.url === 'https://site.test/secret' && /robots/.test(s.reason)));
  assert.ok(results.skipped.some((s) => s.url === 'https://site.test/b' && /Duplicate/.test(s.reason)));
  assert.ok(!requests.some((u) => u.includes('other.com')), 'should stay on seed host');
  assert.ok(!requests.includes('https://site.test/deeper'), 'should respect max depth');
  assert.equal(requests.filter((u) => u === 'https://site.test/').length, 1, 'should not refetch pages');
});

test('crawler stops at maxPages', async () => {
  const pages = { '/robots.txt': { body: '', type: 'text/plain' } };
  for (let i = 0; i < 20; i++) pages[`/p${i}`] = { body: `<title>${i}</title><a href="/p${i + 1}">next</a>` };
  const { fetchImpl } = fakeSite(pages);

  const crawler = new Crawler({ fetchImpl, politenessMs: 0, maxDepth: 50, maxPages: 5 });
  const results = await crawler.start(['https://site.test/p0']);
  assert.equal(results.pages.length, 5);
});

test('crawler rejects invalid seeds', () => {
  assert.throws(() => new Crawler().seed(['ftp://nope', 'not a url']), /No valid seed URLs/);
});
