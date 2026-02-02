/**
 * Rate limiting middleware
 */

const config = require('../config');
const { RateLimitError } = require('../utils/errors');

const storage = new Map();

setInterval(() => {
  const cutoff = Date.now() - 3600000;
  for (const [key, entries] of storage.entries()) {
    const filtered = entries.filter(e => e.timestamp >= cutoff);
    if (filtered.length === 0) storage.delete(key);
    else storage.set(key, filtered);
  }
}, 300000);

function getKey(req, limitType) {
  const identifier = req.token || req.ip || 'anonymous';
  return `rl:${limitType}:${identifier}`;
}

function checkLimit(key, limit) {
  const now = Date.now();
  const windowStart = now - (limit.window * 1000);
  let entries = (storage.get(key) || []).filter(e => e.timestamp >= windowStart);
  const allowed = entries.length < limit.max;
  const remaining = Math.max(0, limit.max - entries.length - (allowed ? 1 : 0));
  let retryAfter = 0;
  if (entries.length > 0 && !allowed) {
    const oldest = Math.min(...entries.map(e => e.timestamp));
    retryAfter = Math.ceil((oldest + limit.window * 1000 - now) / 1000);
  }
  if (allowed) {
    entries.push({ timestamp: now });
    storage.set(key, entries);
  }
  return { allowed, remaining, limit: limit.max, retryAfter };
}

function rateLimit(limitType = 'requests', options = {}) {
  const limit = config.rateLimits[limitType];
  if (!limit) throw new Error(`Unknown rate limit type: ${limitType}`);
  const { message = 'Rate limit exceeded' } = options;

  return async (req, res, next) => {
    try {
      const key = getKey(req, limitType);
      const result = checkLimit(key, limit);
      res.setHeader('X-RateLimit-Limit', result.limit);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      if (!result.allowed) {
        res.setHeader('Retry-After', result.retryAfter);
        throw new RateLimitError(message, result.retryAfter);
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

const requestLimiter = rateLimit('requests');
const postLimiter = rateLimit('posts', { message: 'You can only post once every 30 minutes' });
const commentLimiter = rateLimit('comments', { message: 'Too many comments, slow down' });

module.exports = { rateLimit, requestLimiter, postLimiter, commentLimiter };
