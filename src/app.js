/**
 * Express application factory.
 * SRS refs: §8.1 System Architecture, §10 API Requirements
 * NFR-04: Security headers (helmet), CORS, rate limiting.
 * NFR-01: API p95 < 300ms — keep middleware chain lean.
 * API versioning: all routes under /api/v1 (§4.16 API-01).
 */
'use strict';

const path    = require('path');
const express = require('express');
const cors    = require('cors');
const helmet  = require('helmet');
const cookieParser = require('cookie-parser');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const swaggerSpec = require('./config/swagger');
const requestLogger = require('./middleware/requestLogger');
const notFound = require('./middleware/notFound');
const errorHandler = require('./middleware/errorHandler');
const { defaultLimiter, authLimiter } = require('./middleware/rateLimiter');

// ── Module routers ──────────────────────────────────────────────────────────
const authRoutes = require('./modules/auth/auth.routes');
const usersRoutes = require('./modules/users/users.routes');
const rolesRoutes = require('./modules/roles/roles.routes');
const institutionsRoutes = require('./modules/institutions/institutions.routes');
const coursesRoutes = require('./modules/courses/courses.routes');
const modulesRoutes = require('./modules/modules-lessons/modules.routes');
const simulationsRoutes  = require('./modules/simulations/simulations.routes');
const simCatalogsRoutes  = require('./modules/simulation-catalogs/catalog.routes');
const sessionsRoutes = require('./modules/simulations/sessions/sessions.routes');
const gradesRoutes = require('./modules/grades/grades.routes');
const progressRoutes = require('./modules/progress/progress.routes');
const notificationsRoutes = require('./modules/notifications/notifications.routes');
const messagesRoutes = require('./modules/messages/messages.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');
const dashboardRoutes = require('./modules/analytics/dashboard.routes');
const auditRoutes = require('./modules/audit/audit.routes');
const settingsRoutes = require('./modules/settings/settings.routes');
const filesRoutes = require('./modules/files/files.routes');
const academicYearsRoutes  = require('./modules/academic-years/academic-years.routes');
const semesterTermsRoutes  = require('./modules/semester-terms/semester-terms.routes');
const pageContentRoutes    = require('./modules/page-content/page-content.routes');
const activityRoutes       = require('./modules/simulation-activity/activity.routes');

const app = express();

// ── Root landing endpoint — SRS §4.16 API-01 ──────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'Bedo SimuLearn API',
    version: config.apiVersion,
    docs: '/api/docs',
    health: '/api/v1/health',
  });
});

// ── General storage static serving (catch-all for /storage/*) ──────────────
// Serves files from the storage directory (simulations, thumbnails, lessons, etc.)
// Mount BEFORE helmet to avoid middleware conflicts
(function setupGeneralStorageStatic() {
  const storageDir = path.isAbsolute(config.storage.simulationsDir)
    ? path.dirname(config.storage.simulationsDir)  // e.g., /app/backend/storage
    : path.resolve(__dirname, '..', 'storage');    // e.g., ./storage

  const fs = require('fs');
  fs.mkdirSync(storageDir, { recursive: true });

  app.use('/storage', express.static(storageDir, {
    dotfiles: 'deny',
    index: false,
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Access-Control-Allow-Origin', '*');
    },
  }));
})();

// ── WebGL simulation static serving — SRS §4.7 SIM-01 ──────────────────────
// Serves extracted Unity WebGL builds from storage/simulations/{uuid}/.
// URL: /simulations-runtime/{uuid}/index.html (and all sub-paths).
// Must be mounted BEFORE helmet() so we can set per-path headers.
// Correct MIME types for compressed Unity WebGL assets.

(function setupWebGLStatic() {
  const simDir = path.isAbsolute(config.storage.simulationsDir)
    ? config.storage.simulationsDir
    : path.resolve(__dirname, '..', config.storage.simulationsDir);

  // Ensure the directory exists before serving (avoids startup error)
  const fs = require('fs');
  fs.mkdirSync(simDir, { recursive: true });

  // Injected into every simulation index.html so the cross-origin parent page
  // can receive canvas click positions via postMessage without needing
  // same-origin access to the iframe's contentDocument.
  // Injected at the START of <head> so our capture-phase listeners are
  // registered BEFORE Unity's scripts run.  Unity often calls
  // stopImmediatePropagation on keyboard events; by being first in the
  // capture chain we always fire before it can block us.
  const CLICK_TRACKER_SCRIPT = `<script>
(function(){
  var send = function(data) {
    try { window.parent.postMessage(data, '*'); } catch(_) {}
  };
  // Unity's WebGL canvas is a fixed-size element (e.g. 960x600) centered
  // inside the page, NOT the full window — the page itself can be much
  // larger than the canvas. Click coordinates must be measured relative to
  // the canvas's own bounding box so (0,0) is the canvas's top-left corner,
  // matching the coordinate system the reference screenshot/bbox regions
  // were annotated against.
  function getCanvasRect() {
    var c = document.getElementById('unity-canvas') || document.querySelector('canvas');
    return c ? c.getBoundingClientRect() : null;
  }
  // Capture phase on window — fires before every other handler on the page.
  window.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return;
    var rect = getCanvasRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return;
    var x = e.clientX - rect.left;
    var y = e.clientY - rect.top;
    if (x < 0 || y < 0 || x > rect.width || y > rect.height) return; // outside canvas
    send({
      type:   'sim_click',
      x:      parseFloat(x.toFixed(1)),
      y:      parseFloat(y.toFixed(1)),
      norm_x: parseFloat((x / rect.width).toFixed(4)),
      norm_y: parseFloat((y / rect.height).toFixed(4)),
      t:      new Date().toISOString()
    });
  }, true);
  window.addEventListener('keydown', function(e) {
    send({ type: 'sim_key', key: e.key, t: new Date().toISOString() });
  }, true);
})();
</script>`;

  // Custom setHeaders for Unity WebGL MIME/encoding
  function setWebGLHeaders(res, filePath) {
    const f = filePath.toLowerCase();

    // Brotli-compressed files
    if (f.endsWith('.wasm.br')) {
      res.setHeader('Content-Type',     'application/wasm');
      res.setHeader('Content-Encoding', 'br');
    } else if (f.endsWith('.js.br') || f.endsWith('.framework.js.br')) {
      res.setHeader('Content-Type',     'application/javascript');
      res.setHeader('Content-Encoding', 'br');
    } else if (f.endsWith('.data.br')) {
      res.setHeader('Content-Type',     'application/octet-stream');
      res.setHeader('Content-Encoding', 'br');

    // Gzip-compressed files
    } else if (f.endsWith('.wasm.gz')) {
      res.setHeader('Content-Type',     'application/wasm');
      res.setHeader('Content-Encoding', 'gzip');
    } else if (f.endsWith('.framework.js.gz') || f.endsWith('.js.gz')) {
      res.setHeader('Content-Type',     'application/javascript');
      res.setHeader('Content-Encoding', 'gzip');
    } else if (f.endsWith('.data.gz')) {
      res.setHeader('Content-Type',     'application/octet-stream');
      res.setHeader('Content-Encoding', 'gzip');

    // Uncompressed WebAssembly
    } else if (f.endsWith('.wasm')) {
      res.setHeader('Content-Type', 'application/wasm');

    // Loader JS (explicit to avoid text/plain fallback)
    } else if (f.endsWith('.loader.js') || f.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    }

    // Cache build assets for 1 day (index.html intentionally uncached)
    if (!f.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=86400');
    } else {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    }

    // Unity Multithreading: add COOP + COEP only on the /simulations-runtime/ path
    // so it does not affect the main app CORS policy.
    res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
    res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  }

  // Intercept HTML requests to inject the click-tracker script before serving.
  // Non-HTML requests fall through to express.static below.
  app.use(config.storage.simulationsUrlPrefix, (req, res, next) => {
    const p = (req.path === '/' || req.path === '') ? '/index.html' : req.path;
    if (!p.endsWith('.html')) return next();

    const filePath = path.join(simDir, p);
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return next(); // not found — let express.static return 404
      setWebGLHeaders(res, filePath);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Inject at the very beginning of <head> so our capture listeners
      // are registered BEFORE Unity's own scripts run.
      const modified = html.includes('<head>')
        ? html.replace('<head>', '<head>' + CLICK_TRACKER_SCRIPT)
        : html.includes('</body>')
          ? html.replace('</body>', CLICK_TRACKER_SCRIPT + '\n</body>')
          : html + CLICK_TRACKER_SCRIPT;
      res.send(modified);
    });
  });

  app.use(
    config.storage.simulationsUrlPrefix,
    express.static(simDir, {
      dotfiles:   'deny',
      index:      'index.html',
      setHeaders: setWebGLHeaders,
    }),
  );
})();

// ── Thumbnail static serving ─────────────────────────────────────────────────
(function setupThumbnailStatic() {
  const thumbDir = path.isAbsolute(config.storage.thumbnailsDir)
    ? config.storage.thumbnailsDir
    : path.resolve(__dirname, '..', config.storage.thumbnailsDir);
  const fs = require('fs');
  fs.mkdirSync(thumbDir, { recursive: true });
  app.use(config.storage.thumbnailsUrlPrefix, express.static(thumbDir, { dotfiles: 'deny' }));
})();

// ── Lesson files static serving (video, PDF, documents) ──────────────────────
(function setupLessonFilesStatic() {
  const lessonFilesDir = path.isAbsolute(config.storage.lessonFilesDir)
    ? config.storage.lessonFilesDir
    : path.resolve(__dirname, '..', config.storage.lessonFilesDir);
  const fs = require('fs');
  fs.mkdirSync(lessonFilesDir, { recursive: true });
  app.use(config.storage.lessonFilesUrlPrefix, express.static(lessonFilesDir, {
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }));
})();

// ── Security & parsing ──────────────────────────────────────────────────────
// Allow the WebGL player page to embed the /simulations-runtime/* content in an iframe.
app.use(helmet({
  contentSecurityPolicy: false,       // Managed per-route; Unity builds need unsafe-eval
  crossOriginEmbedderPolicy: false,   // Already set per-path for simulations-runtime
  crossOriginOpenerPolicy: false,     // Same — set explicitly on simulations-runtime
}));

// CORS configuration
const corsOptions = {
  origin: true,
  credentials: true,
};

app.use(cors(corsOptions));

// Important: use RegExp instead of '*'
// Express v5 / newer router does not accept app.options('*')
app.options(/.*/, cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Temporary request logger for debugging repeated API calls
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

app.use(requestLogger);

// ── Swagger UI — SRS §4.16 API-01 ──────────────────────────────────────────
if (config.swagger.enabled) {
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));
  app.get('/api/docs.json', (_req, res) => res.json(swaggerSpec));
}

// ── API v1 routes ───────────────────────────────────────────────────────────
const apiRouter = express.Router();

// Health-check — no rate limiting
apiRouter.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: config.apiVersion,
  });
});

// Stricter limiter for sensitive auth routes
apiRouter.use('/auth/login', authLimiter);
apiRouter.use('/auth/register', authLimiter);
apiRouter.use('/auth/forgot-password', authLimiter);
apiRouter.use('/auth/reset-password', authLimiter);
apiRouter.use('/auth/refresh', authLimiter);

// General limiter for all API routes after health-check
apiRouter.use(defaultLimiter);

apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', usersRoutes);
apiRouter.use('/roles', rolesRoutes);
apiRouter.use('/institutions', institutionsRoutes);
apiRouter.use('/courses', coursesRoutes);
apiRouter.use('/courses', modulesRoutes);
apiRouter.use('/simulations', simulationsRoutes);
apiRouter.use('/simulation-catalogs', simCatalogsRoutes);
apiRouter.use('/simulation-sessions', sessionsRoutes);
apiRouter.use('/courses', gradesRoutes);
apiRouter.use('/progress', progressRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/messages', messagesRoutes);
apiRouter.use('/analytics', analyticsRoutes);
apiRouter.use('/dashboard', dashboardRoutes);
apiRouter.use('/audit-logs', auditRoutes);
apiRouter.use('/settings', settingsRoutes);
apiRouter.use('/files', filesRoutes);
// Page content — MUST be before the wildcard '/' mounts below, otherwise the
// global authenticate in academic-years/semester-terms routers intercepts first.
apiRouter.use('/page-content', pageContentRoutes);

// Academic structure — routes use full paths (e.g. /departments/:id/academic-years)
apiRouter.use('/', academicYearsRoutes);
apiRouter.use('/', semesterTermsRoutes);

// Simulation activity tracking — all paths defined inside the router
apiRouter.use('/', activityRoutes);

app.use(`/api/${config.apiVersion}`, apiRouter);

// ── Error handling — must be last ───────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;

