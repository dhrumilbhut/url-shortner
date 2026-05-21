const express = require('express');
const router = express.Router();
const pool = require('../db');
const { client: redisClient } = require('../redis');
const { publishClickEvent } = require('../rabbitmq');
const rateLimiter = require('../middleware/rateLimiter');

router.get('/:shortCode', rateLimiter, async (req, res) => {
  const { shortCode } = req.params;
  const cacheKey = `url:${shortCode}`;

  try {
    // 1. Check Redis cache first (skip if Redis is down)
    if (redisClient.isReady) {
      const cached = await redisClient.get(cacheKey);
      if (cached) {
        publishClickEvent({ shortCode });
        return res.redirect(302, cached);
      }
    }

    // 2. Cache miss (or Redis down) — query Postgres
    const result = await pool.query(
      `SELECT original_url FROM urls WHERE short_code = $1 AND is_active = true`,
      [shortCode]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }

    const originalUrl = result.rows[0].original_url;

    // 3. Store in Redis cache for 1 hour (only if Redis is up)
    if (redisClient.isReady) {
      await redisClient.set(cacheKey, originalUrl, { EX: 3600 });
    }

    // 4. Publish click event to RabbitMQ (fire and forget — no await)
    publishClickEvent({ shortCode });

    // 5. Redirect
    res.redirect(302, originalUrl);
  } catch (err) {
    console.error('Redirect error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
