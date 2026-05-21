const express = require('express');
const router = express.Router();
const { nanoid } = require('nanoid');
const pool = require('../db');
const { client: redisClient } = require('../redis');
const authenticate = require('../middleware/authenticate');

function isValidUrl(string) {
  try {
    const url = new URL(string);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

// POST /shorten — authenticated users only
router.post('/', authenticate, async (req, res) => {
  const { url, customCode } = req.body;

  if (!url || !isValidUrl(url)) {
    return res.status(400).json({ error: 'A valid http or https URL is required.' });
  }

  const shortCode = customCode || nanoid(6);

  if (shortCode.length > 10) {
    return res.status(400).json({ error: 'Custom code must be 10 characters or fewer.' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO urls (short_code, original_url, created_by)
       VALUES ($1, $2, $3)
       ON CONFLICT (short_code) DO UPDATE
         SET original_url = EXCLUDED.original_url,
             is_active    = true,
             created_at   = NOW(),
             created_by   = EXCLUDED.created_by
         WHERE urls.is_active = false
       RETURNING short_code, original_url, created_at`,
      [shortCode, url, req.user.userId]
    );

    if (result.rowCount === 0) {
      return res.status(409).json({ error: `Short code "${shortCode}" is already taken.` });
    }

    const row = result.rows[0];
    res.status(201).json({
      shortCode: row.short_code,
      shortUrl: `${process.env.BASE_URL}/r/${row.short_code}`,
      originalUrl: row.original_url,
      createdAt: row.created_at,
    });
  } catch (err) {
    console.error('POST /shorten error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /urls/me — list all active URLs for the authenticated user
router.get('/me', authenticate, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT short_code, original_url, created_at
       FROM urls
       WHERE created_by = $1 AND is_active = true
       ORDER BY created_at DESC`,
      [req.user.userId]
    );

    res.json(result.rows.map(row => ({
      shortCode: row.short_code,
      originalUrl: row.original_url,
      shortUrl: `${process.env.BASE_URL}/r/${row.short_code}`,
      createdAt: row.created_at,
    })));
  } catch (err) {
    console.error('GET /urls/me error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// DELETE /urls/:shortCode — authenticated users only, owner only
router.delete('/:shortCode', authenticate, async (req, res) => {
  const { shortCode } = req.params;

  try {
    const result = await pool.query(
      `UPDATE urls SET is_active = false
       WHERE short_code = $1
         AND is_active  = true
         AND created_by = $2
       RETURNING short_code`,
      [shortCode, req.user.userId]
    );

    if (result.rowCount === 0) {
      // Could be: not found, already deleted, or belongs to another user.
      // We return 404 in all cases — don't reveal whether a code belongs to someone else.
      return res.status(404).json({ error: 'Short URL not found or you do not have permission to delete it.' });
    }

    await redisClient.del(`url:${shortCode}`);
    await redisClient.del(`clicks:${shortCode}`);

    res.status(204).send();
  } catch (err) {
    console.error('DELETE /urls error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
