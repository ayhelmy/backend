/**
 * Bedo SimuLearn LMS — HTTP server entry point.
 * Starts the Express app and connects to PostgreSQL + Redis.
 * SRS refs: §2.3 Operating Environment, §5 NFR-03 (99.9% uptime).
 */
'use strict';

const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { pool } = require('./src/config/database');
const redis = require('./src/config/redis');

const PORT = config.port;

async function start() {
  // Verify DB connection before accepting traffic
  try {
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connection verified');
  } catch (err) {
    logger.error('PostgreSQL connection failed', { error: err.message });
    process.exit(1);
  }

  // Connect Redis with timeout (lazyConnect=true, so we call connect explicitly)
  try {
    const redisConnectPromise = redis.connect();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Redis connection timeout')), 5000)
    );
    await Promise.race([redisConnectPromise, timeoutPromise]);
  } catch (err) {
    logger.warn('Redis connection failed — caching disabled', { error: err.message });
  }

  const server = app.listen(PORT, () => {
    logger.info(`Bedo SimuLearn API running on http://localhost:${PORT}/api/${config.apiVersion}`);
    if (config.swagger.enabled) {
      logger.info(`Swagger UI at http://localhost:${PORT}/api/docs`);
    }
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await pool.end();
      try {
        await redis.quit();
      } catch (err) {
        logger.warn('Redis quit error', { error: err.message });
      }
      logger.info('All connections closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();

