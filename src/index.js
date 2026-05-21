require('dotenv').config();
const express = require('express');
const pool = require('./db');
const { client: redisClient, connectRedis } = require('./redis');
const { connectRabbitMQ } = require('./rabbitmq');

const app = express();

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static('public'));

app.get('/health', async (req, res) => {
  const status = { postgres: 'ok', redis: 'ok', rabbitmq: 'ok' };
  let httpStatus = 200;

  try {
    await pool.query('SELECT 1');
  } catch {
    status.postgres = 'down';
    httpStatus = 503;
  }

  if (!redisClient.isReady) {
    status.redis = 'down';
    httpStatus = 503;
  }

  const { getChannel } = require('./rabbitmq');
  const ch = getChannel();
  if (!ch) {
    status.rabbitmq = 'down';
    httpStatus = 503;
  }

  res.status(httpStatus).json(status);
});

// Global error handler — catches JSON parse errors and other unhandled errors
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON in request body.' });
  }
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error.' });
});

async function start() {
  try {
    await pool.query('SELECT 1');
    console.log('Postgres connected');

    await connectRedis();

    await connectRabbitMQ();

    app.use('/auth', require('./routes/auth'));
    app.use('/shorten', require('./routes/urls'));
    app.use('/urls', require('./routes/urls'));
    app.use('/r', require('./routes/redirect'));
    app.use('/analytics', require('./routes/analytics'));

    const PORT = process.env.PORT || 3000;
    const server = app.listen(PORT, () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });

    async function shutdown() {
      console.log('\nShutting down...');
      server.close();
      await redisClient.quit();
      await pool.end();
      console.log('All connections closed. Goodbye.');
      process.exit(0);
    }

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
  } catch (err) {
    console.error('Failed to start:', err.message);
    process.exit(1);
  }
}

start();
