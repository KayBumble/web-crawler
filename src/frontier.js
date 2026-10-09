'use strict';

class Frontier {
  constructor({ politenessMs = 1000 } = {}) {
    this.politenessMs = politenessMs;
    this.hostQueues = new Map();
    this.nextAllowed = new Map();
    this.hostDelays = new Map();
    this.size = 0;
  }

  push(item) {
    const host = new URL(item.url).host;
    let queue = this.hostQueues.get(host);
    if (!queue) {
      queue = [];
      this.hostQueues.set(host, queue);
    }
    const index = queue.findIndex((queued) => queued.priority > item.priority);
    if (index === -1) queue.push(item);
    else queue.splice(index, 0, item);
    this.size++;
  }

  setHostDelay(host, ms) {
    this.hostDelays.set(host, Math.max(ms, this.politenessMs));
  }

  next(now = Date.now()) {
    let bestHost = null;
    let minWait = Infinity;

    for (const [host, queue] of this.hostQueues) {
      const wait = (this.nextAllowed.get(host) ?? 0) - now;
      if (wait > 0) {
        minWait = Math.min(minWait, wait);
        continue;
      }
      if (!bestHost || queue[0].priority < this.hostQueues.get(bestHost)[0].priority) {
        bestHost = host;
      }
    }

    if (!bestHost) return { item: null, waitMs: this.size ? minWait : 0 };

    const queue = this.hostQueues.get(bestHost);
    const item = queue.shift();
    if (queue.length === 0) this.hostQueues.delete(bestHost);
    this.nextAllowed.set(bestHost, now + (this.hostDelays.get(bestHost) ?? this.politenessMs));
    this.size--;
    return { item, waitMs: 0 };
  }
}

module.exports = { Frontier };
