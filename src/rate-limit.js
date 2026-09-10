export class SlidingWindowRateLimiter {
  constructor({ limit = 60, windowMs = 60_000, maxKeys = 10_000, now = () => Date.now() } = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('limit must be a positive integer');
    if (!Number.isFinite(windowMs) || windowMs < 1000) throw new Error('windowMs must be at least 1000');
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
    this.now = now;
    this.buckets = new Map();
  }

  check(key) {
    const now = this.now();
    const safeKey = String(key || 'anonymous').slice(0, 256);
    const existing = this.buckets.get(safeKey) || [];
    const fresh = existing.filter((timestamp) => now - timestamp < this.windowMs);

    if (fresh.length >= this.limit) {
      const retryAfterMs = Math.max(0, this.windowMs - (now - fresh[0]));
      this.buckets.set(safeKey, fresh);
      return { allowed: false, remaining: 0, retryAfterMs };
    }

    fresh.push(now);
    this.buckets.set(safeKey, fresh);
    if (this.buckets.size > this.maxKeys) {
      const oldestKey = this.buckets.keys().next().value;
      this.buckets.delete(oldestKey);
    }

    return { allowed: true, remaining: this.limit - fresh.length, retryAfterMs: 0 };
  }
}
