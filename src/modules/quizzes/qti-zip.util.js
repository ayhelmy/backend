/**
 * Safe ZIP extraction for untrusted QTI package uploads.
 *
 * Deliberately does NOT reuse the existing WebGL-build extraction pattern
 * (simlearn-backend/src/modules/simulations/webgl.service.js), which shells
 * out to `execSync('Expand-Archive'/'unzip')` and only scans extracted entry
 * NAMES for literal ".." after everything has already been written to disk.
 * Here every entry's resolved destination path (and total uncompressed size,
 * and entry count) is validated BEFORE any file is written, using the pure-JS
 * `unzipper` library's central-directory read (`Open.file()`), so a bad
 * package is rejected without ever touching the filesystem outside the temp
 * extraction root.
 */
'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const unzipper = require('unzipper');
const ApiError = require('../../utils/apiError');

// Unix zip tools store file-type bits in the upper 16 bits of
// externalFileAttributes; 0xA000 there marks a symlink (standard convention,
// e.g. `S_IFLNK` in `st_mode`). We only ever write plain files via
// fs.createWriteStream, so nothing here would follow/create a symlink
// regardless — this check is an extra defensive rejection, not load-bearing.
function isSymlinkEntry(entry) {
  const unixMode = (entry.externalFileAttributes >>> 16) & 0xf000;
  return unixMode === 0xa000;
}

/**
 * Extracts a ZIP file to destDir, validating every entry BEFORE any bytes are
 * written: rejects absolute paths, drive letters, path traversal outside
 * destDir, symlink entries, more than maxEntryCount entries, or a total
 * uncompressed size over maxTotalUncompressedBytes (zip-bomb guard). Throws
 * ApiError.badRequest on the first violation found during validation — no
 * partial extraction occurs in that case.
 */
async function safeExtractQtiZip(zipPath, destDir, { maxEntryCount, maxTotalUncompressedBytes }) {
  const directory = await unzipper.Open.file(zipPath);

  if (directory.files.length > maxEntryCount) {
    throw ApiError.badRequest(
      `QTI package has too many entries (${directory.files.length} > ${maxEntryCount}).`,
    );
  }

  const normalizedRoot = path.resolve(destDir) + path.sep;
  let totalUncompressed = 0;
  const plan = [];

  // ── Validation pass — no writes yet ─────────────────────────────────────────
  for (const entry of directory.files) {
    if (entry.type === 'Directory') continue;

    if (path.isAbsolute(entry.path) || /^[a-zA-Z]:/.test(entry.path)) {
      throw ApiError.badRequest(`QTI package entry has an absolute path: "${entry.path}"`);
    }
    if (isSymlinkEntry(entry)) {
      throw ApiError.badRequest(`QTI package entry is a symlink, which is not allowed: "${entry.path}"`);
    }

    const destPath = path.resolve(destDir, entry.path);
    if (destPath !== path.resolve(destDir) && !(destPath + path.sep).startsWith(normalizedRoot) && destPath !== normalizedRoot.slice(0, -1)) {
      throw ApiError.badRequest(`QTI package entry escapes extraction root: "${entry.path}"`);
    }

    totalUncompressed += entry.uncompressedSize;
    if (totalUncompressed > maxTotalUncompressedBytes) {
      throw ApiError.badRequest('QTI package exceeds maximum total uncompressed size (possible zip bomb).');
    }

    plan.push({ entry, destPath });
  }

  // ── Write pass — every entry already validated ──────────────────────────────
  await fsp.mkdir(destDir, { recursive: true });
  for (const { entry, destPath } of plan) {
    await fsp.mkdir(path.dirname(destPath), { recursive: true });
    await new Promise((resolve, reject) => {
      entry.stream()
        .pipe(fs.createWriteStream(destPath))
        .on('finish', resolve)
        .on('error', reject);
    });
  }

  return plan.map((p) => p.destPath);
}

module.exports = { safeExtractQtiZip, isSymlinkEntry };
