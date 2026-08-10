/**
 * Redis client – simplified, only reads REDIS_URL from environment.
 */
'use strict';

const Redis = require('ioredis');
const logger = require('../utils/logger');

const REDIS_URL = process.env.REDIS_URL || process.env.REDISCLOUD_URL || null;

function createNoopRedisClient() {
  const resolveValue = (value) => Promise.resolve(value);

  return {
    get: async () => resolveValue(null),
    set: async () => resolveValue(undefined),
    setex: async () => resolveValue(undefined),
    del: async () => resolveValue(undefined),
    sadd: async () => resolveValue(undefined),
    srem: async () => resolveValue(undefined),
    smembers: async () => resolveValue([]),
    expire: async () => resolveValue(undefined),
    incr: async () => resolveValue(1),
    ttl: async () => resolveValue(-1),
    pipeline: () => ({
      exec: async () => resolveValue([]),
      setex: async () => resolveValue(undefined),
      del: async () => resolveValue(undefined),
      sadd: async () => resolveValue(undefined),
      srem: async () => resolveValue(undefined),
      smembers: async () => resolveValue([]),
      expire: async () => resolveValue(undefined),
      incr: async () => resolveValue(1),
      ttl: async () => resolveValue(-1),
    }),
    on: () => undefined,
    quit: async () => resolveValue(undefined),
    disconnect: () => undefined,
  };
}

let redis = createNoopRedisClient();

if (REDIS_URL) {
  logger.info('Connecting to Redis via REDIS_URL'); // no need to log full URL
  redis = new Redis(REDIS_URL, {
    retryStrategy: (times) => Math.min(times * 100, 3000),
    maxRetriesPerRequest: 3,
    connectTimeout: 10000,
    lazyConnect: false, // connect immediately
  });

  redis.on('connect', () => logger.info('✅ Redis connected'));
  redis.on('ready', () => logger.info('✅ Redis ready'));
  redis.on('reconnecting', (delay) => logger.warn(`Redis reconnecting in ${delay}ms`));
  redis.on('error', (err) => logger.error('❌ Redis error', { error: err.message }));
} else {
  logger.warn('⚠️ REDIS_URL not set – running without Redis. Refresh tokens will be stored in memory only.');
}

module.exports = redis;
