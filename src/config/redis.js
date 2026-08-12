/**
 * Redis client (ioredis).
 * SRS refs: §2.3 (Cache/Sessions: Redis 7), §8.1
 * Used for: JWT refresh tokens, session state, API response caching.
 */
'use strict';

const Redis = require('ioredis');
const config = require('./index');
const logger = require('../utils/logger');

const retryStrategy = (times) => Math.min(times * 50, 2000);

const redis = config.redis.url
  ? new Redis(config.redis.url, { retryStrategy, lazyConnect: true })
  : new Redis({
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password,
    retryStrategy,
    lazyConnect: true,
  });

redis.on('connect', () => logger.info('Redis connected'));
redis.on('error', (err) => logger.error('Redis error', { error: err.message }));

module.exports = redis;
