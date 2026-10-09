'use strict';

const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const { Frontier } = require('./frontier');
const { normalizeUrl, isFileUrl, parseHtml } = require('./parser');
const { RobotsCache, isAllowed } = require('./robots');
const { fetchPage } = require('./fetcher');

const USER_AGENT = 'SimpleWebCrawler/1.0 (+https://github.com/KayBumble/web-crawler)';

const FRESH_CONTENT = /\/(news|blog|latest|updates|press)(\/|$)|\/20\d{2}\/\d{1,2}(\/|$)/i;

function prioritise(url, depth) {
  return depth - (FRESH_CONTENT.test(new URL(url).pathname) ? 0.5 : 0);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Crawler extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      maxPages: 50,
      maxDepth: 2,
      politenessMs: 1000,
      concurrency: 4,
      sameHost: true,
      timeoutMs: 10000,
      userAgent: USER_AGENT,
      fetchImpl: fetch,
      ...options,
    };
    this.frontier = new Frontier({ politenessMs: this.options.politenessMs });
    this.robots = new RobotsCache({ userAgent: this.options.userAgent, fetchImpl: this.options.fetchImpl });
    this.seenUrls = new Set();
    this.seenContent = new Map();
    this.seedHosts = new Set();
    this.pages = [];
    this.files = new Map();
    this.skipped = [];
    this.errors = [];
    this.processed = 0;
    this.inFlight = 0;
    this.running = false;
    this.stopped = false;
  }

  get stats() {
    return {
      running: this.running,
      processed: this.processed,
      pages: this.pages.length,
      files: this.files.size,
      skipped: this.skipped.length,
      errors: this.errors.length,
      queued: this.frontier.size,
      inFlight: this.inFlight,
    };
  }

  results() {
    return {
      options: { ...this.options, fetchImpl: undefined },
      stats: this.stats,
      pages: this.pages,
      files: [...this.files.values()],
      skipped: this.skipped,
      errors: this.errors,
    };
  }

  seed(seeds) {
    for (const seed of seeds) {
      const url = normalizeUrl(seed.trim());
      if (!url) continue;
      this.seedHosts.add(new URL(url).host);
      this.#enqueue(url, 0);
    }
    if (this.frontier.size === 0) throw new Error('No valid seed URLs (must be http:// or https://).');
  }

  async start(seeds) {
    if (seeds) this.seed(seeds);
    this.running = true;
    this.emit('stats', this.stats);
    const workers = Array.from({ length: this.options.concurrency }, () => this.#worker());
    await Promise.all(workers);
    this.running = false;
    this.emit('stats', this.stats);
    this.emit('done', this.stats);
    return this.results();
  }

  stop() {
    this.stopped = true;
  }

  #enqueue(url, depth) {
    if (this.seenUrls.has(url)) return;
    this.seenUrls.add(url);
    this.frontier.push({ url, depth, priority: prioritise(url, depth) });
  }

  #recordFile(url, details) {
    if (this.files.has(url)) return;
    const file = { url, ...details };
    this.files.set(url, file);
    this.emit('file', file);
  }

  async #worker() {
    while (!this.stopped && this.processed + this.inFlight < this.options.maxPages) {
      const { item, waitMs } = this.frontier.next();
      if (!item) {
        if (this.frontier.size === 0 && this.inFlight === 0) return;
        await sleep(Math.min(waitMs || 100, 250));
        continue;
      }
      this.inFlight++;
      try {
        await this.#process(item);
      } catch (err) {
        const error = { url: item.url, message: err.name === 'TimeoutError' ? 'Timed out' : err.message };
        this.errors.push(error);
        this.emit('failed', error);
      } finally {
        this.inFlight--;
        this.processed++;
        this.emit('stats', this.stats);
      }
    }
  }

  async #process({ url, depth }) {
    const robots = await this.robots.get(url);
    if (robots.crawlDelay) this.frontier.setHostDelay(new URL(url).host, robots.crawlDelay * 1000);
    if (!isAllowed(robots, url)) {
      const skip = { url, reason: 'Blocked by robots.txt' };
      this.skipped.push(skip);
      this.emit('skipped', skip);
      return;
    }

    const res = await fetchPage(url, this.options);

    if (!res.ok) {
      const error = { url, message: `HTTP ${res.status}` };
      this.errors.push(error);
      this.emit('failed', error);
      return;
    }

    if (res.html === null) {
      this.#recordFile(url, { contentType: res.contentType, size: res.size, source: 'fetched' });
      return;
    }

    const hash = crypto.createHash('sha256').update(res.html).digest('hex');
    if (this.seenContent.has(hash)) {
      const skip = { url, reason: `Duplicate content of ${this.seenContent.get(hash)}` };
      this.skipped.push(skip);
      this.emit('skipped', skip);
      return;
    }
    this.seenContent.set(hash, url);

    const finalUrl = normalizeUrl(res.finalUrl) || url;
    this.seenUrls.add(finalUrl);
    const { title, links, nofollow } = parseHtml(res.html, finalUrl);

    const page = {
      url,
      finalUrl: finalUrl !== url ? finalUrl : undefined,
      title,
      depth,
      status: res.status,
      size: res.size,
      links: links.length,
      nofollow,
      crawledAt: new Date().toISOString(),
    };
    this.pages.push(page);
    this.emit('page', page);

    for (const link of links) {
      if (this.options.sameHost && !this.seedHosts.has(new URL(link).host)) continue;
      if (isFileUrl(link)) {
        this.#recordFile(link, { foundOn: url, source: 'linked' });
      } else if (depth + 1 <= this.options.maxDepth) {
        this.#enqueue(link, depth + 1);
      }
    }
  }
}

module.exports = { Crawler, prioritise, USER_AGENT };
