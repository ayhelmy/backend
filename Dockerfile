# Bedo SimuLearn Backend — production image for Railway.
#
# Installs `unzip` explicitly: src/modules/simulations/webgl.service.js
# shells out to the OS `unzip` binary to extract uploaded Unity WebGL
# builds, and Railway's default Nixpacks Node image does not guarantee it
# is present — hence a Dockerfile instead of Nixpacks auto-detect.

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends unzip \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Storage lives here at runtime — mount the Railway Volume at this path so
# WebGL builds / thumbnails / lesson files / QTI assets / mail attachments
# survive redeploys (see config.storage.*Dir, all relative to backend root).
RUN mkdir -p storage \
    && useradd --system --create-home --uid 1001 simlearn \
    && chown -R simlearn:simlearn /app
USER simlearn

# Railway injects PORT at runtime; server.js reads it via config.port.
EXPOSE 5000

CMD ["node", "server.js"]
