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
const { defaultLimiter, authLimiter, ltiLaunchLimiter } = require('./middleware/rateLimiter');

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
const notificationPreferencesRoutes = require('./modules/notifications/notification-preferences.routes');
const mailRoutes = require('./modules/mail/mail.routes');
const courseAnnouncementsRoutes = require('./modules/course-announcements/course-announcements.routes');
const analyticsRoutes = require('./modules/analytics/analytics.routes');
const dashboardRoutes = require('./modules/dashboard/dashboard.routes');
const auditRoutes = require('./modules/audit/audit.routes');
const settingsRoutes = require('./modules/settings/settings.routes');
const filesRoutes = require('./modules/files/files.routes');
const academicYearsRoutes  = require('./modules/academic-years/academic-years.routes');
const semesterTermsRoutes  = require('./modules/semester-terms/semester-terms.routes');
const pageContentRoutes    = require('./modules/page-content/page-content.routes');
const activityRoutes       = require('./modules/simulation-activity/activity.routes');
const experimentsRoutes    = require('./modules/experiments/experiments.routes');
const experimentsInstructorRoutes = require('./modules/experiments/experiments-instructor.routes');
const quizzesRoutes          = require('./modules/quizzes/quizzes.routes');
const quizAttemptsRoutes     = require('./modules/quiz-attempts/quiz-attempts.routes');
const simulationScoresRoutes = require('./modules/simulation-scores/simulation-scores.routes');
const gradeCategoriesRoutes  = require('./modules/grade-categories/grade-categories.routes');
const ltiPlatformsRoutes     = require('./modules/lti/lti-platforms.routes');
const ltiProtocolRoutes      = require('./modules/lti/lti-protocol.routes');
const ltiAgsRoutes           = require('./modules/lti/ags.routes');
const ltiNrpsRoutes          = require('./modules/lti/nrps.routes');

const app = express();

// ── HTTPS enforcement — SRS §5 NFR-04 Security ──────────────────────────────
// Trust the first proxy hop (reverse proxy / load balancer / PaaS router) so
// req.secure, req.ip and req.protocol reflect the original client request
// instead of the internal HTTP hop between the proxy and this Node process.
if (config.env === 'production') {
  app.set('trust proxy', config.trustProxyHops);

  // Redirect any plain-HTTP request to HTTPS. Relies on the proxy setting
  // X-Forwarded-Proto (standard behaviour for nginx/Caddy/most PaaS routers).
  // 308 preserves the original method/body, unlike a 301/302 GET-only redirect.
  app.use((req, res, next) => {
    if (req.secure) return next();
    return res.redirect(308, `https://${req.headers.host}${req.originalUrl}`);
  });
}

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
  const fs   = require('fs');
  const zlib = require('zlib');
  fs.mkdirSync(simDir, { recursive: true });

  // Some uploaded Unity WebGL builds embed a third-party PDF-renderer plugin
  // (used to show StreamingAssets documents inside the scene) that was
  // compiled against an old Emscripten runtime aliasing UTF8ToString as
  // Pointer_stringify. Current Unity WebGL exports no longer ship that
  // alias, so calling it throws "ReferenceError: Pointer_stringify is not
  // defined" inside _PDFJS_LoadDocumentFromURL — before pdfjsLib.getDocument()
  // is ever called, so the click silently does nothing (no network request,
  // no visible error to the learner). UTF8ToString has the same single-arg
  // signature and already exists elsewhere in the same compiled file, so a
  // plain text substitution fixes it without needing the Unity project to
  // rebuild against. Applied at serve time (not to the files on disk) so it
  // covers every already-uploaded and future build using this plugin.
  //
  // Builds that still ship their own shim (`function Pointer_stringify(s,len)
  // {…return UTF8ToString(s,len)}` + `Module["Pointer_stringify"]=Pointer_stringify`)
  // must NOT be patched: the rename would turn the shim into a recursive
  // UTF8ToString and leave the bare `Pointer_stringify` reference dangling,
  // throwing a ReferenceError at load so Unity hangs at 90% forever.
  const frameworkPatchCache = new Map(); // filePath -> { mtimeMs, buffer | null (serve as-is) }

  function serveFrameworkJs(res, filePath) {
    let stat;
    try { stat = fs.statSync(filePath); } catch { return false; }

    const cached = frameworkPatchCache.get(filePath);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      if (!cached.buffer) return false; // known not to need patching
      setWebGLHeaders(res, filePath);
      res.send(cached.buffer);
      return true;
    }

    const raw = fs.readFileSync(filePath);
    const lower = filePath.toLowerCase();
    const isGz  = lower.endsWith('.gz');
    const isBr  = lower.endsWith('.br');
    const decompressed = isGz ? zlib.gunzipSync(raw) : isBr ? zlib.brotliDecompressSync(raw) : raw;
    const text = decompressed.toString('utf8');

    const needsPatch = text.includes('Pointer_stringify(')
      && !/function\s+Pointer_stringify\s*\(/.test(text); // build defines its own shim — leave it alone
    if (!needsPatch) {
      frameworkPatchCache.set(filePath, { mtimeMs: stat.mtimeMs, buffer: null });
      return false; // let express.static serve it as-is
    }

    const patchedText = text.replace(/\bPointer_stringify\(/g, 'UTF8ToString(');
    const patchedBuffer = isGz
      ? zlib.gzipSync(patchedText)
      : isBr
        ? zlib.brotliCompressSync(patchedText)
        : Buffer.from(patchedText, 'utf8');

    frameworkPatchCache.set(filePath, { mtimeMs: stat.mtimeMs, buffer: patchedBuffer });
    setWebGLHeaders(res, filePath);
    res.send(patchedBuffer);
    return true;
  }

  // Injected into every simulation index.html so the cross-origin parent page
  // can receive canvas click positions via postMessage without needing
  // same-origin access to the iframe's contentDocument.
  // Injected at the START of <head> so our capture-phase listeners are
  // registered BEFORE Unity's scripts run.  Unity often calls
  // stopImmediatePropagation on keyboard events; by being first in the
  // capture chain we always fire before it can block us.
  // A function, not a constant: the LMS relay below needs to stamp each
  // event's projectId with the requesting simulation's own build_uuid (see
  // its comment for why), which is only known per-request.
  function renderInjectedScript(buildUuid) {
    const buildUuidJson = JSON.stringify(buildUuid);
    return `<script>
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

  // ── Structured LMS event relay (experiments tracking pipeline) ───────────
  // Some Unity builds emit a richer, self-describing event contract (session/
  // experiment/step/question events) via a compiled interop function that
  // does two things: an unconditional same-page
  // window.dispatchEvent(new CustomEvent(channel, {detail: payload})), and —
  // ONLY if the Unity project has a "Parent Origin" configured AND it exactly
  // matches wherever this page is actually served from — a same-origin-
  // checked window.parent.postMessage(). Since this script runs inside the
  // simulation's own iframe (the exact same window Unity dispatches on), the
  // CustomEvent always reaches us regardless of that Parent Origin setting —
  // we relay it to the parent page ourselves via a wildcard-target
  // postMessage (same pattern as the click tracker above), so a build never
  // needs a correctly configured Parent Origin for its structured tracking
  // data to reach SimuLearn. Channel-name agnostic: it inspects the
  // dispatched event's own detail shape (schemaVersion + projectId) rather
  // than requiring a specific CustomEvent name, since that name is a runtime
  // argument from the build's own code, not something fixed in its compiled JS.
  //
  // projectId override: the FM103 Bernoulli build hardcodes payload.projectId
  // to the literal string "FM103" in its own C# code, the same for every
  // SimuLearn upload of it — it has no way to know the build_uuid SimuLearn
  // assigned this particular upload. Left as-is, every upload of this content
  // would collide onto one shared tracking identity, defeating per-upload
  // scoping. This page already knows its own build_uuid (baked in at serve
  // time, below), so it overrides payload.projectId — and, when present,
  // projectManifest.projectId — to that build_uuid before relaying. This is
  // what actually makes "any uploaded simulation gets tracked independently"
  // true regardless of whether the build itself cooperates.
  var BUILD_UUID = ${buildUuidJson};
  function withOverriddenProjectId(detail) {
    var out = Object.assign({}, detail, { projectId: BUILD_UUID });
    if (out.projectManifest && typeof out.projectManifest === 'object') {
      out.projectManifest = Object.assign({}, out.projectManifest, { projectId: BUILD_UUID });
    }
    return out;
  }
  var nativeDispatchEvent = window.dispatchEvent.bind(window);
  window.dispatchEvent = function(event) {
    try {
      var detail = event && event.detail;
      if (detail && typeof detail === 'object' &&
          typeof detail.schemaVersion === 'string' && typeof detail.projectId === 'string') {
        send({ channel: 'simlearn:lms', payload: withOverriddenProjectId(detail) });
      }
    } catch (_) {}
    return nativeDispatchEvent(event);
  };
})();
</script>`;
  }

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
    // req.path is the raw pathname — Express/Node's URL parsing does NOT
    // percent-decode it (e.g. a Unity export's "Build 005" folder arrives as
    // literal "Build%20005"). express.static decodes internally via `send`,
    // which is why it can find files this handler would otherwise miss —
    // decode here too so both paths agree on the same file.
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(req.path);
    } catch {
      return next(); // malformed percent-encoding — let express.static 400/404 it
    }
    const p = (decodedPath === '/' || decodedPath === '') ? '/index.html' : decodedPath;

    if (/\.framework\.js(\.gz|\.br)?$/i.test(p)) {
      const filePath = path.join(simDir, p);
      if (serveFrameworkJs(res, filePath)) return;
      return next(); // not found, or nothing to patch — let express.static handle it
    }

    if (!p.endsWith('.html')) return next();

    // First path segment under the mount prefix is always the build_uuid
    // (URL: /simulations-runtime/{uuid}/...) — needed by the LMS relay script.
    const buildUuid = p.split('/').filter(Boolean)[0] || '';

    const filePath = path.join(simDir, p);
    fs.readFile(filePath, 'utf8', (err, html) => {
      if (err) return next(); // not found — let express.static return 404
      setWebGLHeaders(res, filePath);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      // Inject at the very beginning of <head> so our capture listeners
      // are registered BEFORE Unity's own scripts run.
      const injectedScript = renderInjectedScript(buildUuid);
      const modified = html.includes('<head>')
        ? html.replace('<head>', '<head>' + injectedScript)
        : html.includes('</body>')
          ? html.replace('</body>', injectedScript + '\n</body>')
          : html + injectedScript;
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

// ── QTI-imported media asset static serving (images referenced by questions) ─
(function setupQtiAssetsStatic() {
  const qtiAssetsDir = path.isAbsolute(config.storage.qtiAssetsDir)
    ? config.storage.qtiAssetsDir
    : path.resolve(__dirname, '..', config.storage.qtiAssetsDir);
  const fs = require('fs');
  fs.mkdirSync(qtiAssetsDir, { recursive: true });
  app.use(config.storage.qtiAssetsUrlPrefix, express.static(qtiAssetsDir, {
    dotfiles: 'deny',
    setHeaders: (res) => {
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    },
  }));
})();

// ── Mail attachment static serving ────────────────────────────────────────────
(function setupMailAttachmentsStatic() {
  const mailAttachmentsDir = path.isAbsolute(config.storage.mailAttachmentsDir)
    ? config.storage.mailAttachmentsDir
    : path.resolve(__dirname, '..', config.storage.mailAttachmentsDir);
  const fs = require('fs');
  fs.mkdirSync(mailAttachmentsDir, { recursive: true });
  app.use(config.storage.mailAttachmentsUrlPrefix, express.static(mailAttachmentsDir, {
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
  hsts: config.env === 'production' && {
    maxAge: 63072000,   // 2 years
    includeSubDomains: true,
    preload: true,
  },
}));

// CORS configuration
// Dev: reflect any origin (origin === undefined covers non-browser/no-Origin
// requests, e.g. curl, server-to-server, Swagger "try it out" from the docs
// page itself). Production: restrict to config.cors.allowedOrigins
// (CORS_ORIGIN env, comma-separated) so only the deployed frontend(s) can
// make credentialed requests.
const corsOptions = {
  origin(origin, callback) {
    if (!origin || config.env !== 'production') return callback(null, true);
    if (config.cors.allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error(`CORS: origin "${origin}" is not allowed`));
  },
  credentials: true,
};

app.use(cors(corsOptions));

// Important: use RegExp instead of '*'
// Express v5 / newer router does not accept app.options('*')
app.options(/.*/, cors(corsOptions));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Resolves relative static-asset paths (thumbnails, WebGL builds, etc.) to
// absolute URLs using the current request's host — see the file for why
// this must stay centralized rather than done per-endpoint.
app.use(require('./middleware/mediaUrlRewriter'));

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

// Generous limiter for the public LTI OIDC login/launch endpoints — many
// distinct students launching through one LMS is legitimate traffic.
apiRouter.use('/lti/login', ltiLaunchLimiter);
apiRouter.use('/lti/launch', ltiLaunchLimiter);

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
apiRouter.use('/courses', quizzesRoutes);
apiRouter.use('/courses', quizAttemptsRoutes);
apiRouter.use('/courses', simulationScoresRoutes);
apiRouter.use('/courses', gradeCategoriesRoutes);
apiRouter.use('/courses', experimentsInstructorRoutes);
apiRouter.use('/lti-platforms', ltiPlatformsRoutes);
apiRouter.use('/lti/ags', ltiAgsRoutes);
apiRouter.use('/lti/nrps', ltiNrpsRoutes);
apiRouter.use('/lti', ltiProtocolRoutes);
apiRouter.use('/progress', progressRoutes);
apiRouter.use('/notifications', notificationsRoutes);
apiRouter.use('/notification-preferences', notificationPreferencesRoutes);
apiRouter.use('/mail', mailRoutes);
apiRouter.use('/courses', courseAnnouncementsRoutes);
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
apiRouter.use('/experiments', experimentsRoutes);

app.use(`/api/${config.apiVersion}`, apiRouter);

// ── Error handling — must be last ───────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

module.exports = app;