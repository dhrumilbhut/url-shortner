require('dotenv').config();
const amqp = require('amqplib');
const { createClient } = require('redis');

const QUEUE = 'click_events';
const PREFETCH = 10;

const redisClient = createClient({ url: process.env.REDIS_URL });

redisClient.on('error', (err) => {
  console.error('Worker Redis error:', err.message);
});

async function processMessage(msg, channel) {
  let data;

  try {
    data = JSON.parse(msg.content.toString());
  } catch {
    console.error('Invalid JSON in message, sending to dead-letter queue');
    channel.nack(msg, false, false);
    return;
  }

  const { shortCode } = data;

  try {
    const count = await redisClient.incr(`clicks:${shortCode}`);
    console.log(`Processed click for ${shortCode}, total clicks: ${count}`);
    channel.ack(msg);
  } catch (err) {
    console.error(`Failed to process click for ${shortCode}:`, err.message);
    channel.nack(msg, false, false);
  }
}

async function startWorker() {
  let attempt = 0;

  while (true) {
    try {
      await redisClient.connect();
      console.log('Worker Redis connected');

      const conn = await amqp.connect(process.env.RABBITMQ_URL);

      conn.on('error', (err) => {
        console.error('Worker RabbitMQ connection error:', err.message);
      });

      conn.on('close', () => {
        console.warn('Worker RabbitMQ connection closed. Restarting...');
        redisClient.quit().finally(() => startWorker());
      });

      const channel = await conn.createChannel();
      await channel.prefetch(PREFETCH);

      await channel.assertQueue(QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': 'click_events_dlx',
          'x-dead-letter-routing-key': QUEUE,
        },
      });

      console.log(`Worker listening on queue "${QUEUE}" (prefetch: ${PREFETCH})`);

      channel.consume(QUEUE, (msg) => {
        if (msg !== null) {
          processMessage(msg, channel);
        }
      });

      return;
    } catch (err) {
      attempt++;
      const wait = Math.min(Math.pow(2, attempt) * 500, 30000);
      console.error(`Worker connect failed (attempt ${attempt}). Retrying in ${wait}ms...`);
      try { await redisClient.quit(); } catch { }
      await new Promise((res) => setTimeout(res, wait));
    }
  }
}

startWorker();
