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
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | Postgres connection |
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

- Login returns a short-lived JWT **access token** (kept in memory on the client, sent as `Authorization: Bearer <token>`) and sets an HttpOnly, `Secure`, `SameSite=None` **refresh cookie**.
- `SameSite=None` is required, not optional, in this deployment: frontend and backend run on different registrable domains (e.g. Vercel + Railway), which is a genuinely cross-site setup. `SameSite=Strict` or `Lax` here means the browser silently never sends the refresh cookie back to the API.
- The refresh cookie is a **host-only** cookie (no `Domain` attribute) — it belongs to this API's own domain, not the frontend's. It will never be visible to anything running on the frontend's domain (including any Next.js middleware there that tries to read cookies server-side). Auth state on the frontend must come from the API response (Bearer token + user object in memory), not from inspecting cookies client- or server-side.

### Persistent storage gotcha

`storage/*` (simulation builds, thumbnails, lesson files, mail attachments) defaults to a path *relative to the repo root*. On a host like Railway, that resolves inside the container's ephemeral build layer, **not** wherever your persistent volume is actually mounted — those can be different paths. Files "work" until the next deploy silently wipes them. Always check where your volume is really mounted (e.g. via `railway ssh` + `cat /proc/mounts`, not just the dashboard's reported mount path, which can be stale) and point every `*_STORAGE_PATH` env var at it explicitly.

### Seed script safety

`seed.js` unconditionally `DELETE`s and recreates all simulations, catalogs, sessions, and grades every time it runs, and most PaaS start commands (`npm run migrate && npm run seed && npm start`) run it on **every deploy**. The `NODE_ENV=production` guard is what stops every redeploy from wiping real data — make sure `NODE_ENV` is actually set to `production` in your deployment's environment variables, not just assumed.

## Deployment

Configured for Railway: `npm run migrate && npm run seed && npm start` as the start command, with Postgres and Redis as separate services on the same project. Set every environment variable from the table above on the `backend` service (Railway does not read `.env` files at runtime).
