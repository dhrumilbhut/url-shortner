const jwt = require('jsonwebtoken');
const { client: redisClient } = require('../redis');

async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header.' });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Check if this specific token has been blocklisted
    if (decoded.jti) {
      const isBlocklisted = await redisClient.get(`blocklist:${decoded.jti}`);
      if (isBlocklisted) {
        return res.status(401).json({ error: 'Token has been invalidated.' });
      }
    }

    // Check if the user account has been banned entirely
    const isBanned = await redisClient.get(`banned:${decoded.userId}`);
    if (isBanned) {
      return res.status(403).json({ error: 'Your account has been banned.' });
    }

    req.user = {
      userId: decoded.userId,
      email: decoded.email,
      role: decoded.role,
      jti: decoded.jti,
    };

    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Access token expired. Please refresh.' });
    }
    return res.status(401).json({ error: 'Invalid token.' });
  }
}

module.exports = authenticate;
