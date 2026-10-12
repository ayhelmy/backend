/**
 * Central configuration loader.
 * SRS refs: §2.3 Operating Environment, §5 NFR-04 Security
 * Validates required env vars at startup so the process fails fast.
 */
'use strict';

require('dotenv').config();

const required = [
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'LTI_KEY_ENCRYPTION_SECRET',
  'LTI_TOOL_BASE_URL',
  // Railway's Postgres plugin exposes a single DATABASE_URL; local dev uses
  // the discrete DB_* vars. One of the two must be present.
  ...(process.env.DATABASE_URL ? [] : ['DB_NAME', 'DB_USER', 'DB_PASSWORD']),
];

for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}

module.exports = {
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT, 10) || 5000,
  apiVersion: process.env.API_VERSION || 'v1',

  db: {
    // Takes precedence over the discrete DB_* vars when set (Railway).
    url: process.env.DATABASE_URL || undefined,
    ssl: process.env.DB_SSL === 'true',
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
    // Takes precedence over REDIS_HOST/PORT/PASSWORD when set (Railway).
    url: process.env.REDIS_URL || undefined,
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
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

  // Number of reverse-proxy hops in front of Node (Express `trust proxy`).
  // Railway alone = 1. Requests proxied Vercel → Railway = 2, so req.ip is
  // the real client rather than Vercel's egress IP (rate limiting, audit log).
  trustProxyHops: parseInt(process.env.TRUST_PROXY_HOPS, 10) || 1,

  // Public origin of THIS backend (e.g. https://simlearn-backend.up.railway.app).
  // Used to build absolute media/launch URLs. When unset, falls back to the
  // request's own protocol+host — fine for direct access, but wrong when the
  // request arrives through the frontend's /api/v1 rewrite proxy.
  publicBaseUrl: (process.env.PUBLIC_BASE_URL
    || (process.env.RAILWAY_PUBLIC_DOMAIN ? `https://${process.env.RAILWAY_PUBLIC_DOMAIN}` : '')
  ).replace(/\/+$/, '') || undefined,

  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000,
    max: parseInt(process.env.RATE_LIMIT_MAX, 10) || 100,
  },

  cors: (() => {
    const list = (process.env.CORS_ORIGIN || 'http://localhost:3000')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    return {
      // Primary frontend origin — used to build absolute redirect URLs
      // (e.g. LTI error/launch redirects back to the SPA).
      origin: list[0],
      // Full allowlist consulted by the CORS middleware in app.js. Supports
      // a comma-separated CORS_ORIGIN so preview/staging frontends can be
      // added without a code change.
      allowedOrigins: list,
    };
  })(),

  // Cookie `Domain` attribute for the refresh-token cookie. Leave unset for
  // local dev (host-only cookie). In production, set to the shared parent
  // domain (e.g. ".simulearn.example.com") so the cookie is visible to both
  // the frontend (app.simulearn.example.com) and backend
  // (api.simulearn.example.com) subdomains — required for the frontend's
  // server-side auth guard (proxy.ts) to see the session cookie at all.
  cookieDomain: process.env.COOKIE_DOMAIN || undefined,

  lti: {
    // Master key used to derive the AES-256-GCM key that encrypts tool
    // signing-key private material at rest — see utils/lti-key-crypto.js.
    keyEncryptionSecret: process.env.LTI_KEY_ENCRYPTION_SECRET,
    // Public base URL of THIS backend, used to build the redirect_uri sent
    // to LMS platforms during OIDC login initiation (must exactly match the
    // tool's registered redirect URI).
    toolBaseUrl: process.env.LTI_TOOL_BASE_URL,
    // Signs the short-lived post-launch token (separate from JWT_ACCESS_SECRET
    // so the generic `authenticate` middleware can never mistake an LTI launch
    // token for a full user session). Falls back to the access secret only for
    // local-dev convenience — set explicitly in every real environment.
    launchTokenSecret: process.env.LTI_LAUNCH_TOKEN_SECRET || process.env.JWT_ACCESS_SECRET,
    launchTokenTtl: process.env.LTI_LAUNCH_TOKEN_TTL || '5m',
    // TTL of the SimuLearn access token minted for an LTI-launched session
    // (no refresh cookie is issued — see auth.service.js issueLtiSession).
    sessionTokenTtl: process.env.LTI_SESSION_TOKEN_TTL || '4h',
    // TTL for the Redis-backed OIDC state/nonce entry created at /lti/login
    // and consumed (single-use) at /lti/launch.
    stateTtlSeconds: parseInt(process.env.LTI_STATE_TTL_SECONDS, 10) || 600,
  },

  swagger: {
    enabled: process.env.SWAGGER_ENABLED === 'true',
  },

  storage: {
    // Local filesystem path for extracted WebGL simulation builds.
    // Relative to the backend root (server.js), or absolute if starts with /.
    simulationsDir: process.env.SIMULATION_STORAGE_PATH || 'storage/simulations',
    // Static URL prefix (served by express.static) — must start with /
    simulationsUrlPrefix: '/simulations-runtime',
    // Maximum ZIP upload size in bytes
    maxUploadBytes: parseInt(process.env.MAX_UPLOAD_MB || '500', 10) * 1024 * 1024,
    // Thumbnail image storage
    thumbnailsDir: process.env.THUMBNAIL_STORAGE_PATH || 'storage/thumbnails',
    thumbnailsUrlPrefix: '/thumbnails',
    maxThumbnailBytes: parseInt(process.env.MAX_THUMBNAIL_MB || '5', 10) * 1024 * 1024,
    // Lesson file storage (videos, PDFs, documents)
    lessonFilesDir: process.env.LESSON_FILES_STORAGE_PATH || 'storage/lesson-files',
    lessonFilesUrlPrefix: '/lesson-files',
    maxLessonFileBytes: parseInt(process.env.MAX_LESSON_FILE_MB || '200', 10) * 1024 * 1024,
    // QTI package import — max upload size, max total uncompressed size (zip-bomb
    // guard), max entry count, and where extracted media assets are served from.
    maxQtiUploadBytes: parseInt(process.env.MAX_QTI_UPLOAD_MB || '50', 10) * 1024 * 1024,
    maxQtiUncompressedBytes: parseInt(process.env.MAX_QTI_UNCOMPRESSED_MB || '200', 10) * 1024 * 1024,
    maxQtiEntryCount: parseInt(process.env.MAX_QTI_ENTRY_COUNT || '500', 10),
    qtiAssetsDir: process.env.QTI_ASSETS_STORAGE_PATH || 'storage/qti-assets',
    qtiAssetsUrlPrefix: '/qti-assets',
    // Mail attachment storage (compose/reply/forward attachments)
    mailAttachmentsDir: process.env.MAIL_ATTACHMENTS_STORAGE_PATH || 'storage/mail-attachments',
    mailAttachmentsUrlPrefix: '/mail-attachments',
    maxMailAttachmentBytes: parseInt(process.env.MAX_MAIL_ATTACHMENT_MB || '25', 10) * 1024 * 1024,
  },
};
