/**
 * Redis client (ioredis).
 * SRS refs: §2.3 (Cache/Sessions: Redis 7), §8.1
 * Used for: JWT refresh tokens, session state, API response caching.
 */
'use strict';

const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

const options = {
  retryStrategy: (times) => Math.min(times * 50, 2000),
  lazyConnect: true,
  // Railway's private network is IPv6-only — family 0 lets DNS pick v4 or v6.
  family: 0,
};

const redis = config.redis.url
  ? new Redis(config.redis.url, options)
  : new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      ...options,
    });

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

module.exports = redis;
