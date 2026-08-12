# Local dev TLS certs

Self-signed cert/key used only for local development so
`https://localhost:5000` works without a reverse proxy. `server.js` picks
these up automatically when present and `NODE_ENV !== production`.

Covers `localhost`, `127.0.0.1`, and `172.20.44.1` (this machine's LAN IP —
matches the frontend's default `API_BASE_URL` fallback in
`simlearn-app/lib/constants.ts` for testing from other devices on the same
network). If your LAN IP changes (`ipconfig`), edit the `-addext` SAN list
in the `gen-cert` script in `package.json` before regenerating.

This directory is gitignored — regenerate with:

```
npm run gen-cert
```

**After regenerating, restart the server manually** — nodemon does not
watch `certs/*.pem`, so it won't auto-restart on cert changes alone.

Your browser will show an "untrusted certificate" warning the first time
(self-signed, not from a trusted CA) — click through/accept it for
localhost. This is not used in production; real deployments should
terminate TLS at a reverse proxy or PaaS in front of Node.
