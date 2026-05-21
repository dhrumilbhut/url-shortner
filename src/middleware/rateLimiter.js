const { client: redisClient } = require('../redis');

const WINDOW_SECONDS = 60;
const MAX_REQUESTS = 60;

async function rateLimiter(req, res, next) {
  if (!redisClient.isReady) {
    return next();
  }

  const ip = req.ip || req.socket.remoteAddress;
  const key = `rate:${ip}`;
  const now = Date.now();
  const windowStart = now - WINDOW_SECONDS * 1000;

  try {
    // Remove timestamps older than the start of the current window
    await redisClient.zRemRangeByScore(key, 0, windowStart);

    // Count how many requests remain in the window
    const count = await redisClient.zCard(key);

    if (count >= MAX_REQUESTS) {
      return res.status(429).json({
        error: 'Too many requests. Max 60 requests per 60 seconds.',
      });
    }

    // Add this request's timestamp to the sorted set
    await redisClient.zAdd(key, { score: now, value: String(now) });

    // Set the key to auto-expire after the window so Redis cleans up
    await redisClient.expire(key, WINDOW_SECONDS);

    next();
  } catch (err) {
    console.error('Rate limiter error:', err.message);
    next();
  }
}

module.exports = rateLimiter;
