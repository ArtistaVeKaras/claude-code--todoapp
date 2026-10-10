// Fixed-window counters kept in memory. Good for a single server process;
// move the counters to Redis or the database if the app runs on several instances.

function createRateLimiter({ now }) {
  const buckets = new Map(); // key -> { count, resetAt }

  function check(key, limit, windowMs) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) {
      return { ok: false, retryAfterMs: bucket.resetAt - t };
    }
    return { ok: true };
  }

  function hit(key, windowMs) {
    const t = now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= t) {
      bucket = { count: 0, resetAt: t + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
  }

  // check + hit in one step, for limits that count every attempt.
  function take(key, limit, windowMs) {
    const result = check(key, limit, windowMs);
    if (result.ok) hit(key, windowMs);
    return result;
  }

  function reset(key) {
    buckets.delete(key);
  }

  function sweep() {
    const t = now();
    for (const [key, bucket] of buckets) if (bucket.resetAt <= t) buckets.delete(key);
  }

  return { check, hit, take, reset, sweep };
}

module.exports = { createRateLimiter };
