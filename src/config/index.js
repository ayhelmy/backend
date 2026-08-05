/**
 * Central configuration loader.
 * SRS refs: §2.3 Operating Environment, §5 NFR-04 Security
 * Validates required env vars at startup so the process fails fast.
 */
'use strict';

const path = require('path');
require('dotenv').config();

const required = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
];

const projectRoot = path.resolve(__dirname, '..', '..');
function resolveBasePath(dir) {
  return path.isAbsolute(dir) ? dir : path.resolve(projectRoot, dir);
}

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

/**
 * Resolve the Redis connection string.
 *
 * Railway reference variables (e.g. `${{ Redis.REDIS_URL }}`) are expanded
 * by the Railway runtime before the process starts, so REDIS_URL should
 * always arrive as a plain `redis://[:password@]host:port` string. If an
 * unexpanded/malformed reference (e.g. containing `${{`) ever leaks
 * through, fall back to building the URL from the individual REDIS_*
 * variables instead of passing the broken string to ioredis.
 */
function resolveRedisUrl() {
  const rawUrl = process.env.REDIS_URL;

  if (rawUrl && !rawUrl.includes('${{') && !rawUrl.includes('}}')) {
    return rawUrl;
  }

  if (rawUrl) {
    // eslint-disable-next-line no-console
    console.warn(
      'REDIS_URL contains an unresolved reference and will be ignored; falling back to REDIS_HOST/REDIS_PORT/REDIS_PASSWORD.'
    );
  }

  const host = process.env.REDIS_HOST;
  const port = process.env.REDIS_PORT || '6379';
  const password = process.env.REDIS_PASSWORD;
  const user = process.env.REDIS_USER;

  if (!host) {
    // No usable connection info at all — return null and let the Redis
    // client fall back to its own localhost default. This keeps local
    // development working without REDIS_URL configured.
    return null;
  }

  const auth = password ? `${user || ''}:${password}@` : '';
  return `redis://${auth}${host}:${port}`;
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiVersion: process.env.API_VERSION || 'v1',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT, 10) || 5432,
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    pool: {
      min: parseInt(process.env.DB_POOL_MIN, 10) || 2,
      max: parseInt(process.env.DB_POOL_MAX, 10) || 10,
    },
  },

  redis: {
    url: resolveRedisUrl(),
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    user: process.env.REDIS_USER || undefined,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn: process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || 'noreply@Bedo SimuLearn.com',
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket: process.env.AWS_S3_BUCKET || 'simlearn-uploads',
    cloudfrontUrl: process.env.AWS_CLOUDFRONT_URL,
  },

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },

  cors: {
    origin: process.env.CORS_ORIGIN || '*',
  },

  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
  },

  storage: {
    // Local filesystem path for extracted WebGL simulation builds.
    // Relative to the project root, or absolute if starts with /.
    simulationsDir: process.env.SIMULATION_STORAGE_PATH || 'storage/simulations',
    simulationsDirAbs: resolveBasePath(process.env.SIMULATION_STORAGE_PATH || 'storage/simulations'),
    // Static URL prefix (served by express.static) — must start with /
    simulationsUrlPrefix: '/simulations-runtime',
    // Maximum ZIP upload size in bytes
    maxUploadBytes: parseInt(process.env.MAX_UPLOAD_MB || '500', 10) * 1024 * 1024,
    // Thumbnail image storage
    thumbnailsDir: process.env.THUMBNAIL_STORAGE_PATH || 'storage/thumbnails',
    thumbnailsDirAbs: resolveBasePath(process.env.THUMBNAIL_STORAGE_PATH || 'storage/thumbnails'),
    thumbnailsUrlPrefix: '/thumbnails',
    maxThumbnailBytes: parseInt(process.env.MAX_THUMBNAIL_MB || '5', 10) * 1024 * 1024,
    // Lesson file storage (videos, PDFs, documents)
    lessonFilesDir: process.env.LESSON_FILES_STORAGE_PATH || 'storage/lesson-files',
    lessonFilesDirAbs: resolveBasePath(process.env.LESSON_FILES_STORAGE_PATH || 'storage/lesson-files'),
    lessonFilesUrlPrefix: '/lesson-files',
    maxLessonFileBytes: parseInt(process.env.MAX_LESSON_FILE_MB || '200', 10) * 1024 * 1024,
  },
};
