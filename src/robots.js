'use strict';

function parseRobots(text, userAgent) {
  const groups = [];
  let current = null;
  let lastWasAgent = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    const sep = line.indexOf(':');
    if (sep === -1) continue;
    const key = line.slice(0, sep).trim().toLowerCase();
    const value = line.slice(sep + 1).trim();

    if (key === 'user-agent') {
      if (!lastWasAgent) {
        current = { agents: [], rules: [], crawlDelay: null };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;

    if (key === 'allow' || key === 'disallow') {
      if (value) current.rules.push({ allow: key === 'allow', path: value });
    } else if (key === 'crawl-delay') {
      const seconds = Number(value);
      if (Number.isFinite(seconds)) current.crawlDelay = seconds;
    }
  }

  const agent = userAgent.toLowerCase();
  const group =
    groups.find((g) => g.agents.some((a) => a !== '*' && agent.includes(a))) ||
    groups.find((g) => g.agents.includes('*'));

  return { rules: group?.rules ?? [], crawlDelay: group?.crawlDelay ?? null };
}

function ruleToRegExp(path) {
  const anchored = path.endsWith('$');
  const body = (anchored ? path.slice(0, -1) : path)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + body + (anchored ? '$' : ''));
}

function isAllowed(robots, url) {
  const { pathname, search } = new URL(url);
  const target = pathname + search;
  let best = null;
  for (const rule of robots.rules) {
    if (!ruleToRegExp(rule.path).test(target)) continue;
    if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.allow)) {
      best = rule;
    }
  }
  return best ? best.allow : true;
}

class RobotsCache {
  constructor({ userAgent, fetchImpl = fetch, timeoutMs = 5000 }) {
    this.userAgent = userAgent;
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.cache = new Map();
  }

  get(url) {
    const { origin } = new URL(url);
    if (!this.cache.has(origin)) this.cache.set(origin, this.#load(origin));
    return this.cache.get(origin);
  }

  async #load(origin) {
    try {
      const res = await this.fetchImpl(origin + '/robots.txt', {
        headers: { 'User-Agent': this.userAgent },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) return { rules: [], crawlDelay: null };
      return parseRobots(await res.text(), this.userAgent);
    } catch {
      return { rules: [], crawlDelay: null };
    }
  }
}

module.exports = { parseRobots, isAllowed, RobotsCache };
