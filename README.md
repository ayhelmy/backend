# Bedo SimuLearn — Backend

Node.js/Express v5 REST API for Bedo SimuLearn, a simulation-based learning platform. Handles auth, RBAC, courses, quizzes, grading, WebGL simulation delivery, LTI 1.3 integration, and messaging for a multi-tenant (multi-institution) LMS.

Frontend repo: [ayhelmy/simulab](https://github.com/ayhelmy/simulab)

## Tech stack

- **Runtime**: Node.js ≥18, Express 5
- **Database**: PostgreSQL (plain SQL migrations, no ORM)
- **Cache/sessions**: Redis (refresh-token/session state, permission caching, rate limiting)
- **Auth**: JWT access tokens (in-memory on the client) + HttpOnly refresh cookie
- **File storage**: local filesystem (WebGL builds, thumbnails, lesson files, mail attachments), served via Express static routes
- **Deployment**: Railway (see [Deployment](#deployment) below)

## Getting started

```bash
npm install
cp .env.example .env   # fill in the values below
npm run migrate
npm run seed            # optional — demo institutions, users, courses, simulations
npm run dev
```

The API listens on `http://localhost:<PORT>/api/v1` (default port `5000`). Swagger UI is available at `/api/docs` when `SWAGGER_ENABLED=true`.

### Required environment variables

The app fails fast at startup if any of these are missing:

| Variable | Purpose |
|---|---|
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | Sign access/refresh tokens |
| `DATABASE_URL` **or** `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Postgres connection (`DATABASE_URL` wins when set, e.g. on Railway) |
| `LTI_KEY_ENCRYPTION_SECRET` | Encrypts LTI tool signing keys at rest |
| `LTI_TOOL_BASE_URL` | Public base URL of this backend, used in LTI OIDC redirects |

### Everything else (all optional, sensible defaults)

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | **Must be `production` in any real deployment** — gates HTTPS redirect, HSTS, error detail hiding, and the seed-script safety guard (see below) |
| `PORT` | `5000` | |
| `DB_HOST` / `DB_PORT` | `localhost` / `5432` | |
| `REDIS_URL` | — | Preferred if your host injects a single connection string (e.g. Railway) |
| `REDIS_HOST` / `REDIS_PORT` / `REDIS_PASSWORD` | `localhost` / `6379` | Used when `REDIS_URL` isn't set (local dev) |
| `JWT_ACCESS_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `15m` / `7d` | |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | — | Without `SMTP_HOST`, mail falls back to a console/`jsonTransport` logger — verification and password-reset links are printed to the server log instead of emailed |
| `SIMULATION_STORAGE_PATH` / `THUMBNAIL_STORAGE_PATH` / `LESSON_FILES_STORAGE_PATH` / `QTI_ASSETS_STORAGE_PATH` / `MAIL_ATTACHMENTS_STORAGE_PATH` | `storage/<name>` (relative to repo root) | **Set these to an absolute path pointing at your persistent volume's actual mount point in production** — see [Persistent storage](#persistent-storage-gotcha) |
| `MAX_UPLOAD_MB` / `MAX_THUMBNAIL_MB` / `MAX_LESSON_FILE_MB` / `MAX_QTI_UPLOAD_MB` | various | Upload size limits per asset type |
| `RATE_LIMIT_WINDOW_MS` / `RATE_LIMIT_MAX` | 15 min / `100` | Default rate limiter; auth endpoints use a stricter dedicated limiter |
| `SWAGGER_ENABLED` | `false` | Serves interactive API docs at `/api/docs` |
| `ALLOW_PRODUCTION_SEED` | — | Set to `yes-i-am-sure` to force `npm run seed` to run destructively against a production database (see below) |

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Start with nodemon (auto-restart) |
| `npm start` | Start once (production) |
| `npm run migrate` | Apply pending SQL migrations from `src/db/migrations/`, tracked in a `schema_migrations` table |
| `npm run seed` | **Destructive** — wipes and recreates demo institutions/users/courses/simulations. Refuses to run when `NODE_ENV=production` unless `ALLOW_PRODUCTION_SEED=yes-i-am-sure` is set |
| `npm test` | Run the Jest suite |
| `npm run lint` | ESLint over `src/` |

## Project structure

```
src/
  app.js              Express app: middleware, static asset serving, route mounting
  config/              Env var loading, DB pool, Redis client
  constants/           Roles, permission codes
  db/
    migrations/        Numbered, sequential .sql files — never edit an already-applied one
    models/             Thin query-builder-style DB access, no ORM
    migrate.js          Migration runner
    seed.js              Demo data generator (see the NODE_ENV guard above)
  middleware/           authenticate, authorize, rate limiting, error handling, upload
  modules/               One folder per feature (routes + controller + service [+ validators]),
                          e.g. auth/, courses/, quizzes/, simulation-catalogs/, lti/, mail/
  utils/                 JWT helpers, email, logger, RFC 7807 ApiError
storage/                 Local file storage (gitignored) — see below
tests/                    Jest integration tests
```

Each feature module under `src/modules/` follows the same shape: `*.routes.js` wires up `authenticate`/`authorize` + validators per endpoint, `*.controller.js` is a thin HTTP layer, `*.service.js` holds the actual logic and SQL.

## Architecture notes

### Auth flow

- Login returns a short-lived JWT **access token** (kept in memory on the client, sent as `Authorization: Bearer <token>`) and sets an HttpOnly, `Secure`, `SameSite=Strict` (in production) **refresh cookie**.
- The frontend (Vercel) does not call this API cross-site: its `next.config.ts` rewrites `/api/v1/*` on the frontend's own domain to this backend. The browser therefore sees the API as same-origin, and the host-only refresh cookie lands on the **frontend's** domain, so `SameSite=Strict` works and the frontend's `proxy.ts` auth guard can see it.
- Large multipart uploads (WebGL builds, lesson files) skip the rewrite and hit this backend directly (Bearer auth, no cookie), so `CORS_ORIGIN` must list the frontend origin.
- Leave `COOKIE_DOMAIN` unset for this setup; it is only for a frontend/backend pair on sibling subdomains of one domain.

### Persistent storage gotcha

`storage/*` (simulation builds, thumbnails, lesson files, mail attachments) defaults to a path *relative to the repo root*. On a host like Railway, that resolves inside the container's ephemeral build layer, **not** wherever your persistent volume is actually mounted — those can be different paths. Files "work" until the next deploy silently wipes them. Always check where your volume is really mounted (e.g. via `railway ssh` + `cat /proc/mounts`, not just the dashboard's reported mount path, which can be stale) and point every `*_STORAGE_PATH` env var at it explicitly.

### Seed script safety

`seed.js` unconditionally `DELETE`s and recreates all simulations, catalogs, sessions, and grades every time it runs. It is no longer part of the deploy command, and the `NODE_ENV=production` guard still refuses to run it unless `ALLOW_PRODUCTION_SEED=yes-i-am-sure` is set — make sure `NODE_ENV` is actually set to `production` in your deployment's environment variables, not just assumed.

### Migration numbering

Two development lines once numbered the same migrations differently (044–065 vs 046–067; local-only ones became 068–071). `migrate.js` has a `RENAMED_FROM` map so a database that applied a migration under its old filename skips it under the new one. Never renumber an applied migration again — add new ones after the highest number.

## Deployment

Configured for Railway via `railway.json` + `Dockerfile` (config-as-code overrides any start command set in the dashboard): `npm run migrate` runs as the pre-deploy command, then `node server.js`, health-checked at `/api/v1/health`. Postgres and Redis run as separate services in the same project. See [DEPLOYMENT.md](DEPLOYMENT.md) for the full variable list and the Vercel frontend pairing.
