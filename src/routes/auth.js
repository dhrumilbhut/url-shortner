const express = require('express');
const router = express.Router();
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { randomUUID } = require('crypto');
const pool = require('../db');
const { client: redisClient } = require('../redis');
const authenticate = require('../middleware/authenticate');

const SALT_ROUNDS = 10;

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required.' });
  }
  next();
}

// POST /auth/register
router.post('/register', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !isValidEmail(email)) {
    return res.status(400).json({ error: 'A valid email address is required.' });
  }

  if (!password || password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);

    const result = await pool.query(
      `INSERT INTO users (email, password_hash)
       VALUES ($1, $2)
       RETURNING id, email, created_at`,
      [email.toLowerCase(), passwordHash]
    );

    const user = result.rows[0];
    res.status(201).json({
      message: 'Account created successfully.',
      user: { id: user.id, email: user.email, createdAt: user.created_at },
    });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'An account with this email already exists.' });
    }
    console.error('Register error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  try {
    const result = await pool.query(
      `SELECT id, email, password_hash, role FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    const user = result.rows[0];

    // Always run bcrypt.compare to prevent timing attacks
    const dummyHash = '$2b$10$invalidhashfortimingpurposesonly000000000000000000000';
    const passwordMatch = await bcrypt.compare(
      password,
      user ? user.password_hash : dummyHash
    );

    if (!user || !passwordMatch) {
      return res.status(401).json({ error: 'Invalid email or password.' });
    }

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, jti: randomUUID() },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    const refreshToken = randomUUID();
    const refreshTTL = 7 * 24 * 60 * 60;

    await redisClient.set(`refresh:${user.id}`, refreshToken, { EX: refreshTTL });

    res.json({
      accessToken,
      refreshToken,
      expiresIn: process.env.JWT_EXPIRES_IN,
    });
  } catch (err) {
    console.error('Login error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /auth/refresh
router.post('/refresh', async (req, res) => {
  const { userId, refreshToken } = req.body;

  if (!userId || !refreshToken) {
    return res.status(400).json({ error: 'userId and refreshToken are required.' });
  }

  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId)) {
    return res.status(400).json({ error: 'Invalid userId format.' });
  }

  try {
    const stored = await redisClient.get(`refresh:${userId}`);

    if (!stored || stored !== refreshToken) {
      return res.status(401).json({ error: 'Invalid or expired refresh token.' });
    }

    const userResult = await pool.query(
      `SELECT id, email, role FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(401).json({ error: 'User not found.' });
    }

    const user = userResult.rows[0];

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email, role: user.role, jti: randomUUID() },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN }
    );

    res.json({
      accessToken,
      expiresIn: process.env.JWT_EXPIRES_IN,
    });
  } catch (err) {
    console.error('Refresh error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /auth/invalidate — blocklist the caller's current access token immediately
// Requires valid token — uses authenticate middleware
router.post('/invalidate', authenticate, async (req, res) => {
  const { jti } = req.user;

  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader.slice(7);
    const decoded = jwt.decode(token);

    const now = Math.floor(Date.now() / 1000);
    const remainingTTL = decoded.exp - now;

    if (remainingTTL > 0) {
      await redisClient.set(`blocklist:${jti}`, '1', { EX: remainingTTL });
    }

    res.json({ message: 'Token invalidated successfully.' });
  } catch (err) {
    console.error('Invalidate error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /auth/logout — requires valid token; userId comes from the token, not body
router.post('/logout', authenticate, async (req, res) => {
  try {
    await redisClient.del(`refresh:${req.user.userId}`);
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    console.error('Logout error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// POST /admin/ban/:userId — ban a user account entirely (admin only)
router.post('/admin/ban/:userId', authenticate, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    const userResult = await pool.query(
      `SELECT id, email FROM users WHERE id = $1`,
      [userId]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    // Store ban with no TTL — permanent until manually lifted
    await redisClient.set(`banned:${userId}`, '1');

    // Also delete their refresh token so they cannot get new access tokens
    await redisClient.del(`refresh:${userId}`);

    res.json({
      message: `User ${userResult.rows[0].email} has been banned.`,
    });
  } catch (err) {
    console.error('Ban error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// DELETE /admin/ban/:userId — lift a ban (admin only)
router.delete('/admin/ban/:userId', authenticate, requireAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    await redisClient.del(`banned:${userId}`);
    res.json({ message: 'Ban lifted successfully.' });
  } catch (err) {
    console.error('Unban error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

// GET /admin/users — list all users with ban status (admin only)
router.get('/admin/users', authenticate, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, email, role, created_at FROM users ORDER BY created_at DESC`
    );

    const users = await Promise.all(
      result.rows.map(async (user) => {
        const banned = await redisClient.exists(`banned:${user.id}`);
        return {
          id: user.id,
          email: user.email,
          role: user.role,
          createdAt: user.created_at,
          banned: banned === 1,
        };
      })
    );

    res.json(users);
  } catch (err) {
    console.error('GET /admin/users error:', err.message);
    res.status(500).json({ error: 'Internal server error.' });
  }
});

module.exports = router;
