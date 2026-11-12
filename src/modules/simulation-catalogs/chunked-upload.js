'use strict';

/**
 * Chunked (resumable-per-chunk) upload for large Unity WebGL ZIPs.
 *
 * Why: Railway's edge requires every request body to finish uploading within
 * 5 minutes (docs.railway.com/networking/public-networking/specs-and-limits),
 * and that limit can't be raised. A 350 MB ZIP on a ~5 Mbps uplink needs ~10
 * minutes, so a single multipart POST is always cut off mid-transfer. Here the
 * browser sends the file as small chunks — each one its own short request —
 * and the final "complete" call stitches them together and hands the result
 * to the unchanged createWebGLSimulationInCatalog() pipeline.
 *
 * Flow:
 *   POST /:id/simulations/webgl-upload/chunks                       { fileName, fileSize }                → { uploadId, chunkSize, totalChunks }
 *   PUT  /:id/simulations/webgl-upload/chunks/:uploadId/:index      raw bytes (application/octet-stream)
 *   POST /:id/simulations/webgl-upload/chunks/:uploadId/complete    { title, description, … }            → { simulation, catalogId }
 *
 * State lives in os.tmpdir() — fine for this single-replica service
 * (railway.json numReplicas: 1). A redeploy mid-upload loses the session and
 * the client simply starts again. Abandoned sessions are swept after 24 h.
 */

const fs     = require('fs');
const fsp    = fs.promises;
const os     = require('os');
const path   = require('path');
const crypto = require('crypto');
const { once }     = require('events');
const { pipeline } = require('stream/promises');

const config   = require('../../config');
const ApiError    = require('../../utils/apiError');
const ApiResponse = require('../../utils/apiResponse');
const svc      = require('./catalog.service');

/** Client chunk size. 10 MB ≈ 16 s at 5 Mbps — far inside Railway's 5 min. */
const CHUNK_SIZE   = 10 * 1024 * 1024;
const ROOT_DIR     = path.join(os.tmpdir(), 'simwebgl_chunks');
const STALE_MS     = 24 * 60 * 60 * 1000;
const UPLOAD_ID_RE = /^[0-9a-f-]{36}$/;

function sessionDir(uploadId) {
  if (!UPLOAD_ID_RE.test(uploadId)) throw ApiError.notFound('Upload session not found.');
  return path.join(ROOT_DIR, uploadId);
}

const partPath = (dir, index) => path.join(dir, `${index}.part`);

async function readSession(uploadId, catalogId, actor) {
  const dir = sessionDir(uploadId);
  let meta;
  try {
    meta = JSON.parse(await fsp.readFile(path.join(dir, 'meta.json'), 'utf8'));
  } catch {
    throw ApiError.notFound('Upload session not found or expired. Please start the upload again.');
  }
  // A session is bound to the user and catalog that opened it.
  if (meta.actorId !== actor.id || meta.catalogId !== catalogId) {
    throw ApiError.notFound('Upload session not found.');
  }
  return { dir, meta };
}

/** Best-effort removal of sessions abandoned more than STALE_MS ago. */
async function sweepStaleSessions() {
  let entries;
  try { entries = await fsp.readdir(ROOT_DIR); } catch { return; }
  const cutoff = Date.now() - STALE_MS;
  await Promise.all(entries.map(async (name) => {
    const dir = path.join(ROOT_DIR, name);
    try {
      const { mtimeMs } = await fsp.stat(dir);
      if (mtimeMs < cutoff) await fsp.rm(dir, { recursive: true, force: true });
    } catch { /* already gone */ }
  }));
}

// ── Handlers ──────────────────────────────────────────────────────────────────

exports.initUpload = async (req, res, next) => {
  try {
    const { fileName, fileSize } = req.body ?? {};
    const size = Number(fileSize);

    if (typeof fileName !== 'string' || path.extname(fileName).toLowerCase() !== '.zip') {
      throw ApiError.badRequest('Only .zip files are accepted.');
    }
    if (!Number.isInteger(size) || size <= 0) throw ApiError.badRequest('fileSize must be a positive integer.');
    if (size > config.storage.maxUploadBytes) {
      const maxMB = Math.round(config.storage.maxUploadBytes / 1024 / 1024);
      throw new ApiError(413, `ZIP file exceeds the maximum upload size of ${maxMB} MB.`);
    }
    const count = Math.ceil(size / CHUNK_SIZE);

    void sweepStaleSessions();

    const uploadId = crypto.randomUUID();
    const dir = sessionDir(uploadId);
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(path.join(dir, 'meta.json'), JSON.stringify({
      actorId: req.user.id,
      catalogId: req.params.id,
      fileName,
      fileSize: size,
      totalChunks: count,
      createdAt: new Date().toISOString(),
    }));

    ApiResponse.created(res, 'Upload session created', { uploadId, chunkSize: CHUNK_SIZE, totalChunks: count });
  } catch (e) { next(e); }
};

/** Streams one chunk straight to disk — never buffered in memory. Idempotent: re-sending an index overwrites it. */
exports.uploadChunk = async (req, res, next) => {
  try {
    const { dir, meta } = await readSession(req.params.uploadId, req.params.id, req.user);
    const index = Number(req.params.index);
    if (!Number.isInteger(index) || index < 0 || index >= meta.totalChunks) {
      throw ApiError.badRequest(`Chunk index must be 0..${meta.totalChunks - 1}.`);
    }

    const isLast   = index === meta.totalChunks - 1;
    const expected = isLast ? meta.fileSize - CHUNK_SIZE * (meta.totalChunks - 1) : CHUNK_SIZE;

    // Write to a temp name and rename, so a dropped request never leaves a
    // truncated part that "complete" would mistake for a finished one.
    const tmp = `${partPath(dir, index)}.${crypto.randomUUID()}.tmp`;
    // Overflow stops disk writes but keeps draining the body, so the client
    // gets a clean 400 rather than a reset socket (which its retry logic would
    // treat as a transient network failure).
    let received = 0;
    const out = fs.createWriteStream(tmp);
    try {
      for await (const buf of req) {
        received += buf.length;
        if (received > expected) continue;
        if (!out.write(buf)) await once(out, 'drain');
      }
    } catch (err) {
      out.destroy();
      await fsp.rm(tmp, { force: true });
      throw err;
    }
    await new Promise((resolve, reject) => out.end((err) => (err ? reject(err) : resolve())));
    if (received !== expected) {
      await fsp.rm(tmp, { force: true });
      throw ApiError.badRequest(`Chunk ${index} has ${received} bytes; expected ${expected}.`);
    }
    await fsp.rename(tmp, partPath(dir, index));

    ApiResponse.ok(res, 'Chunk stored', { index, received });
  } catch (e) { next(e); }
};

/** Assembles the parts into one ZIP and runs the regular WebGL upload pipeline on it. */
exports.completeUpload = async (req, res, next) => {
  try {
    const { dir, meta } = await readSession(req.params.uploadId, req.params.id, req.user);

    for (let i = 0; i < meta.totalChunks; i++) {
      try { await fsp.access(partPath(dir, i)); } catch {
        throw ApiError.badRequest(`Chunk ${i} is missing — the upload is incomplete.`);
      }
    }

    // Same temp-file naming the multer path uses; createWebGLSimulationInCatalog
    // deletes it in its own finally block.
    const safe    = meta.fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
    const zipPath = path.join(os.tmpdir(), `simwebgl_${Date.now()}_${safe}`);
    const out = fs.createWriteStream(zipPath);
    try {
      for (let i = 0; i < meta.totalChunks; i++) {
        await pipeline(fs.createReadStream(partPath(dir, i)), out, { end: false });
      }
    } finally {
      await new Promise((resolve) => out.end(resolve));
    }

    const { size } = await fsp.stat(zipPath);
    if (size !== meta.fileSize) {
      await fsp.rm(zipPath, { force: true });
      throw ApiError.badRequest(`Assembled file is ${size} bytes; expected ${meta.fileSize}.`);
    }

    // Parts are no longer needed once the single ZIP exists.
    await fsp.rm(dir, { recursive: true, force: true });

    const file = { path: zipPath, originalname: meta.fileName, size };
    const result = await svc.createWebGLSimulationInCatalog(req.params.id, req.body, file, req.user);
    ApiResponse.created(res, 'WebGL simulation uploaded and ready', result);
  } catch (e) { next(e); }
};

exports.CHUNK_SIZE = CHUNK_SIZE;
