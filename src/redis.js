const { createClient } = require('redis');
require('dotenv').config();

const client = createClient({
  url: process.env.REDIS_URL,
});

client.on('error', (err) => {
  console.error('Redis client error:', err.message);
});

async function connectRedis() {
  await client.connect();
  console.log('Redis connected');
}

module.exports = { client, connectRedis };
