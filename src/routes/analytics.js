const express = require('express');
const router = express.Router();
const pool = require('../db');
const { client: redisClient } = require('../redis');

// GET /analytics/:shortCode
router.get('/:shortCode', async (req, res) => {
  const { shortCode } = req.params;

  try {
    const result = await pool.query(
      `SELECT short_code, original_url, created_at, is_active
       FROM urls
       WHERE short_code = $1`,
      [shortCode]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Short URL not found.' });
    }

    const row = result.rows[0];

    // Get click count from Redis — if key doesn't exist, default to 0
    const clicks = await redisClient.get(`clicks:${shortCode}`);
    const totalClicks = clicks ? parseInt(clicks, 10) : 0;

    res.json({
      shortCode: row.short_code,
      originalUrl: row.original_url,
      totalClicks,
      isActive: row.is_active,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('Analytics error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
