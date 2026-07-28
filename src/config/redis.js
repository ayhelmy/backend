const redis = require('redis');

// Use REDIS_URL from environment, with fallback for Railway
const redisUrl = process.env.REDIS_URL || 'redis://:password@redis.railway.internal:6379';

const client = redis.createClient({
  url: redisUrl,
  // Add any additional options here
});

client.on('error', (err) => console.error('Redis Client Error', err));
client.on('connect', () => console.log('Redis connected successfully'));

(async () => {
  await client.connect();
})();

module.exports = client;
