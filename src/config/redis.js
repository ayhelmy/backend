/**
 * Redis client (ioredis).
 * SRS refs: §2.3 (Cache/Sessions: Redis 7), §8.1
 * Used for: JWT refresh tokens, session state, API response caching.
 */
'use strict';

const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

// Shared client configuration
const options = {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  maxRetriesPerRequest: 5,
  connectTimeout: 10000,
  lazyConnect: true,
};

/**
 * Mask credentials in a Redis connection string for safe logging,
 * e.g. redis://:secret@redis.railway.internal:6379 ->
 *      redis://:****@redis.railway.internal:6379
 */
function maskRedisUrl(url) {
  if (!url) return url;
  try {
    return url.replace(/\/\/([^@/]*)@/, (match, creds) => {
      const [user] = creds.split(':');
      return `//${user ? `${user}:` : ':'}****@`;
    });
  } catch (err) {
    return 'redis://<unparseable>';
  }
}

const redisUrl = config.redis?.url;

let redis;

if (redisUrl) {
  logger.info(`Connecting to Redis via connection string: ${maskRedisUrl(redisUrl)}`);
  redis = new Redis(redisUrl, options);
} else if (config.redis?.host) {
  logger.info(
    `Connecting to Redis via host/port: ${config.redis.host}:${config.redis.port} (password: ${
      config.redis.password ? '****' : 'none'
    })`
  );
  redis = new Redis({
    host: config.redis.host,
    port: config.redis.port,
    username: config.redis.user,
    password: config.redis.password,
    ...options,
  });
} else {
  logger.error(
    'No Redis connection information found (REDIS_URL or REDIS_HOST are both unset). Falling back to 127.0.0.1:6379.'
  );
  redis = new Redis({ host: '127.0.0.1', port: 6379, ...options });
}

redis.on('connect', () => logger.info('Redis connected'));
redis.on('ready', () => logger.info('Redis ready'));
redis.on('reconnecting', (delay) => logger.warn(`Redis reconnecting in ${delay}ms`));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

module.exports = redis;
