# Deploying the backend to Railway

The frontend (Vercel) proxies `/api/v1/*` to this service, so browsers see the
API as same-origin with the frontend. Large uploads and media files
(`/simulations-runtime`, `/thumbnails`, `/lesson-files`, …) are served
directly from Railway.

## 1. Create the services

1. Railway → **New Project → Deploy from GitHub repo** → `ayhelmy/backend`.
   `railway.json` makes it build from the `Dockerfile`, run `npm run migrate` before each deploy,
   and health-check `/api/v1/health`.
2. In the same project, **+ New → Database → PostgreSQL** and **+ New → Database → Redis**.
3. Backend service → **Settings → Networking → Generate Domain** (e.g.
   `simlearn-backend.up.railway.app`).
4. Backend service → **+ Volume**, mount path **`/app/storage`** (uploaded WebGL builds,
   thumbnails, lesson files, QTI assets, mail attachments, all of which survive redeploys).
   If the service already has a volume mounted elsewhere, either re-mount it at `/app/storage`
   or point each `*_STORAGE_PATH` variable (`SIMULATION_STORAGE_PATH`, `THUMBNAIL_STORAGE_PATH`,
   `LESSON_FILES_STORAGE_PATH`, `QTI_ASSETS_STORAGE_PATH`, `MAIL_ATTACHMENTS_STORAGE_PATH`)
   at an absolute path under the real mount.

## 2. Variables (backend service → Variables)

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"` |
| `LTI_KEY_ENCRYPTION_SECRET` | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `LTI_LAUNCH_TOKEN_SECRET` | another random secret |
| `LTI_TOOL_BASE_URL` | `https://${{RAILWAY_PUBLIC_DOMAIN}}` |
| `CORS_ORIGIN` | your Vercel URL, e.g. `https://simulab.vercel.app` (comma-separate extra origins) |
| `TRUST_PROXY_HOPS` | `2` (Vercel → Railway) |
| `RAILWAY_RUN_UID` | `0` (the image runs as a non-root user; Railway volumes are root-owned) |
| `SWAGGER_ENABLED` | `false` (or `true` to expose `/api/docs`) |
| `SMTP_*`, `EMAIL_FROM` | your mail provider |

Leave `COOKIE_DOMAIN` **unset**: the refresh cookie is set host-only on the Vercel
domain through the proxy. `PUBLIC_BASE_URL` defaults to `https://$RAILWAY_PUBLIC_DOMAIN`.

## 3. First deploy

Migrations run automatically (`preDeployCommand`). `railway.json` sets the start command to
`node server.js`, which replaces any older `npm run migrate && npm run seed && npm start`
command in the dashboard, so the seed no longer runs on deploy.

To seed demo data into an **empty** database once (the seed wipes simulations, catalogs,
sessions and grades, so never run it against real data):

```
railway run --service backend -- env ALLOW_PRODUCTION_SEED=yes-i-am-sure npm run seed
```

Check `https://<backend-domain>/api/v1/health` returns `{"status":"ok"}`.
