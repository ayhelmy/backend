/**
 * Bedo SimuLearn LMS — HTTP server entry point.
 * Starts the Express app and connects to PostgreSQL + Redis.
 * SRS refs: §2.3 Operating Environment, §5 NFR-03 (99.9% uptime).
 */
'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const app = require('./src/app');
const config = require('./src/config');
const logger = require('./src/utils/logger');
const { pool } = require('./src/config/database');
const redis = require('./src/config/redis');

const PORT = config.port;

// Dev-only local HTTPS: if a cert/key pair is present (see
// `npm run gen-cert` / certs/README), serve over TLS directly so
// https://localhost:PORT works without a reverse proxy. In production, TLS
// is expected to be terminated by a reverse proxy/PaaS in front of Node
// (see app.js trust-proxy + HTTPS-redirect + HSTS setup), so this path is
// skipped there.
const SSL_CERT_PATH = process.env.SSL_CERT_PATH || path.join(__dirname, 'certs', 'localhost-cert.pem');
const SSL_KEY_PATH = process.env.SSL_KEY_PATH || path.join(__dirname, 'certs', 'localhost-key.pem');

function createServer() {
  const hasLocalCert = config.env !== 'production'
    && fs.existsSync(SSL_CERT_PATH)
    && fs.existsSync(SSL_KEY_PATH);

  if (hasLocalCert) {
    return https.createServer({
      cert: fs.readFileSync(SSL_CERT_PATH),
      key: fs.readFileSync(SSL_KEY_PATH),
    }, app);
  }
  return http.createServer(app);
}

async function start() {
  // Verify DB connection before accepting traffic
  try {
    await pool.query('SELECT 1');
    logger.info('PostgreSQL connection verified');
  } catch (err) {
    logger.error('PostgreSQL connection failed', { error: err.message });
    process.exit(1);
  }

  // Connect Redis (lazyConnect=true, so we call connect explicitly)
  try {
    await redis.connect();
  } catch (err) {
    logger.warn('Redis connection failed — caching disabled', { error: err.message });
  }

  const server = createServer();
  const isHttps = server instanceof https.Server;
  const scheme = isHttps ? 'https' : 'http';

  server.listen(PORT, () => {
    logger.info(`Bedo SimuLearn API running on ${scheme}://localhost:${PORT}/api/${config.apiVersion}`);
    if (config.swagger.enabled) {
      logger.info(`Swagger UI at ${scheme}://localhost:${PORT}/api/docs`);
    }
  });

  // Graceful shutdown
  const shutdown = async (signal) => {
    logger.info(`${signal} received — shutting down gracefully`);
    server.close(async () => {
      await pool.end();
      await redis.quit();
      logger.info('All connections closed');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

start();
