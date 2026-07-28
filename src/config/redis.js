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
  lazyConnect: true,
};

// Prefer REDIS_URL if available; fallback to individual host/port config
const redis = process.env.REDIS_URL
  ? new Redis(process.env.REDIS_URL, options)
  : new Redis({
      host: config.redis?.host || '127.0.0.1',
      port: config.redis?.port || 6379,
      password: config.redis?.password,
      ...options,
    });

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

module.exports = redis;
