const amqp = require('amqplib');
require('dotenv').config();

const QUEUE = 'click_events';
const DLX = 'click_events_dlx';
const DLQ = 'click_events_dead';

let channel = null;

async function connectRabbitMQ() {
  let attempt = 0;

  while (true) {
    try {
      const url = process.env.RABBITMQ_URL.trim();
      const socketOptions = url.startsWith('amqps://') ? { servername: new URL(url).hostname } : {};
      const conn = await amqp.connect(url, socketOptions);

      conn.on('error', (err) => {
        console.error('RabbitMQ connection error:', err.message);
      });

      conn.on('close', () => {
        console.warn('RabbitMQ connection closed. Reconnecting...');
        setTimeout(connectRabbitMQ, 1000);
      });

      channel = await conn.createChannel();

      // Assert the dead-letter exchange and dead-letter queue first
      await channel.assertExchange(DLX, 'direct', { durable: true });
      await channel.assertQueue(DLQ, { durable: true });
      await channel.bindQueue(DLQ, DLX, QUEUE);

      // Assert the main queue, pointing failed messages to the DLX
      await channel.assertQueue(QUEUE, {
        durable: true,
        arguments: {
          'x-dead-letter-exchange': DLX,
          'x-dead-letter-routing-key': QUEUE,
        },
      });

      console.log('RabbitMQ connected');
      return channel;
    } catch (err) {
      attempt++;
      const wait = Math.min(Math.pow(2, attempt) * 500, 30000);
      console.error(`RabbitMQ connect failed (attempt ${attempt}): ${err.message}. Retrying in ${wait}ms...`);
      await new Promise((res) => setTimeout(res, wait));
    }
  }
}

function publishClickEvent(data) {
  if (!channel) {
    console.warn('RabbitMQ channel not ready, dropping click event');
    return;
  }
  channel.sendToQueue(QUEUE, Buffer.from(JSON.stringify(data)), {
    persistent: true,
  });
}

function getChannel() {
  return channel;
}

module.exports = { connectRabbitMQ, publishClickEvent, getChannel };
