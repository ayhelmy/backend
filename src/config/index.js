/**
 * Central configuration loader.
 * SRS refs: §2.3 Operating Environment, §5 NFR-04 Security
 *
 * Validates required environment variables during application startup
 * so deployment configuration errors are detected immediately.
 */

'use strict';

require('dotenv').config();

const environment = process.env.NODE_ENV || 'development';

/**
 * Read an integer environment variable safely.
 *
 * @param {string} key
 * @param {number} defaultValue
 * @returns {number}
 */
function getInteger(key, defaultValue) {
  const rawValue = process.env[key];

  if (rawValue === undefined || rawValue === '') {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (Number.isNaN(parsedValue)) {
    throw new Error(
      `Environment variable ${key} must be a valid integer.`
    );
  }

  return parsedValue;
}

/**
 * Read and normalize an HTTP/HTTPS URL.
 *
 * @param {string|undefined} value
 * @param {string} fallback
 * @param {string} variableName
 * @returns {string}
 */
function normalizeUrl(value, fallback, variableName) {
  const normalizedValue = String(value || fallback)
    .trim()
    .replace(/\/+$/, '');

  try {
    const parsedUrl = new URL(normalizedValue);

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      throw new Error('Unsupported protocol');
    }

    return normalizedValue;
  } catch {
    throw new Error(
      `Environment variable ${variableName} must contain a valid HTTP or HTTPS URL.`
    );
  }
}

/**
 * Parse comma-separated CORS origins.
 *
 * Example:
 * CORS_ORIGIN=https://app.vercel.app,http://localhost:3000
 *
 * @param {string|undefined} rawOrigins
 * @returns {string[]}
 */
function parseCorsOrigins(rawOrigins) {
  const origins = String(
    rawOrigins || 'http://localhost:3000'
  )
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter(Boolean);

  for (const origin of origins) {
    try {
      const parsedOrigin = new URL(origin);

      if (!['http:', 'https:'].includes(parsedOrigin.protocol)) {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new Error(
        `Invalid CORS origin "${origin}". ` +
          'Each origin must be a complete HTTP or HTTPS URL.'
      );
    }
  }

  return [...new Set(origins)];
}

/**
 * Parse Railway REDIS_URL while retaining compatibility with
 * applications that use separate Redis host, port and password values.
 *
 * @returns {{
 *   url: string|undefined,
 *   host: string,
 *   port: number,
 *   username: string|undefined,
 *   password: string|undefined,
 *   tls: boolean
 * }}
 */
function getRedisConfiguration() {
  const redisUrl = process.env.REDIS_URL?.trim();

  if (!redisUrl) {
    return {
      url: undefined,
      host: process.env.REDIS_HOST || 'localhost',
      port: getInteger('REDIS_PORT', 6379),
      username: process.env.REDIS_USERNAME || undefined,
      password: process.env.REDIS_PASSWORD || undefined,
      tls: process.env.REDIS_TLS === 'true',
    };
  }

  try {
    const parsedUrl = new URL(redisUrl);

    if (!['redis:', 'rediss:'].includes(parsedUrl.protocol)) {
      throw new Error('Invalid Redis protocol');
    }

    return {
      url: redisUrl,
      host: parsedUrl.hostname,
      port: parsedUrl.port
        ? Number.parseInt(parsedUrl.port, 10)
        : parsedUrl.protocol === 'rediss:'
          ? 6380
          : 6379,
      username: parsedUrl.username
        ? decodeURIComponent(parsedUrl.username)
        : undefined,
      password: parsedUrl.password
        ? decodeURIComponent(parsedUrl.password)
        : undefined,
      tls: parsedUrl.protocol === 'rediss:',
    };
  } catch {
    throw new Error(
      'Environment variable REDIS_URL must be a valid ' +
        'redis:// or rediss:// URL.'
    );
  }
}

/**
 * Validate required variables.
 */
const requiredVariables = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
];

if (environment === 'production') {
  requiredVariables.push(
    'DB_HOST',
    'DB_PORT',
    'BACKEND_URL',
    'CORS_ORIGIN'
  );
}

const missingVariables = requiredVariables.filter(
  (key) => !process.env[key]?.trim()
);

if (missingVariables.length > 0) {
  throw new Error(
    `Missing required environment variable${
      missingVariables.length > 1 ? 's' : ''
    }: ${missingVariables.join(', ')}`
  );
}

const backendUrl = normalizeUrl(
  process.env.BACKEND_URL,
  'http://localhost:5000',
  'BACKEND_URL'
);

const corsOrigins = parseCorsOrigins(process.env.CORS_ORIGIN);
const redisConfiguration = getRedisConfiguration();

module.exports = {
  env: environment,

  port: getInteger('PORT', 5000),

  apiVersion: process.env.API_VERSION || 'v1',

  /**
   * Public address of the Railway backend.
   *
   * Production example:
   * https://your-backend.up.railway.app
   */
  backendUrl,

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: getInteger('DB_PORT', 5432),
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,

    ssl:
      process.env.DB_SSL === 'true'
        ? {
            rejectUnauthorized:
              process.env.DB_SSL_REJECT_UNAUTHORIZED === 'true',
          }
        : false,

    pool: {
      min: getInteger('DB_POOL_MIN', 2),
      max: getInteger('DB_POOL_MAX', 10),
    },
  },

  redis: {
    /**
     * Prefer this property when creating the Redis client:
     *
     * createClient({
     *   url: config.redis.url
     * });
     */
    url: redisConfiguration.url,

    /**
     * Retained for Redis clients using separate connection properties.
     */
    host: redisConfiguration.host,
    port: redisConfiguration.port,
    username: redisConfiguration.username,
    password: redisConfiguration.password,
    tls: redisConfiguration.tls,
  },

  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET,
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    accessExpiresIn:
      process.env.JWT_ACCESS_EXPIRES_IN || '15m',
    refreshExpiresIn:
      process.env.JWT_REFRESH_EXPIRES_IN || '7d',
  },

  email: {
    host: process.env.SMTP_HOST,
    port: getInteger('SMTP_PORT', 587),
    secure:
      process.env.SMTP_SECURE === 'true' ||
      getInteger('SMTP_PORT', 587) === 465,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,

    // Domain names and email addresses cannot contain spaces.
    from:
      process.env.EMAIL_FROM ||
      'BEDO SimuLearn <noreply@bedo-simulearn.com>',
  },

  aws: {
    region: process.env.AWS_REGION || 'us-east-1',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    s3Bucket:
      process.env.AWS_S3_BUCKET || 'simlearn-uploads',
    cloudfrontUrl: process.env.AWS_CLOUDFRONT_URL
      ? normalizeUrl(
          process.env.AWS_CLOUDFRONT_URL,
          process.env.AWS_CLOUDFRONT_URL,
          'AWS_CLOUDFRONT_URL'
        )
      : undefined,
  },

  rateLimit: {
    windowMs: getInteger(
      'RATE_LIMIT_WINDOW_MS',
      15 * 60 * 1000
    ),
    max: getInteger('RATE_LIMIT_MAX', 100),
  },

  cors: {
    /**
     * The cors package accepts an array of permitted origins.
     */
    origin: corsOrigins,
    origins: corsOrigins,
    credentials: true,

    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
    ],

    methods: [
      'GET',
      'HEAD',
      'POST',
      'PUT',
      'PATCH',
      'DELETE',
      'OPTIONS',
    ],
  },

  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
  },

  storage: {
    /**
     * WebGL simulation builds.
     */
    simulationsDir:
      process.env.SIMULATION_STORAGE_PATH ||
      'storage/simulations',

    simulationsUrlPrefix: '/simulations-runtime',

    simulationsPublicUrl:
      `${backendUrl}/simulations-runtime`,

    maxUploadBytes:
      getInteger('MAX_UPLOAD_MB', 500) *
      1024 *
      1024,

    /**
     * Thumbnail images.
     */
    thumbnailsDir:
      process.env.THUMBNAIL_STORAGE_PATH ||
      'storage/thumbnails',

    thumbnailsUrlPrefix: '/thumbnails',

    thumbnailsPublicUrl: `${backendUrl}/thumbnails`,

    maxThumbnailBytes:
      getInteger('MAX_THUMBNAIL_MB', 5) *
      1024 *
      1024,

    /**
     * Lesson videos, PDFs and documents.
     */
    lessonFilesDir:
      process.env.LESSON_FILES_STORAGE_PATH ||
      'storage/lesson-files',

    lessonFilesUrlPrefix: '/lesson-files',

    lessonFilesPublicUrl: `${backendUrl}/lesson-files`,

    maxLessonFileBytes:
      getInteger('MAX_LESSON_FILE_MB', 200) *
      1024 *
      1024,
  },
};
