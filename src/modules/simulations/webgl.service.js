'use strict';

/**
 * WebGL simulation build service.
 * SRS §4.7 SIM-01 — ZIP extraction, structure validation, and path management.
 *
 * Security rules enforced:
 *  - Reject non-.zip extension (handled upstream in upload middleware)
 *  - Reject path traversal (verified post-extraction)
 *  - Reject overwriting an existing UUID folder
 *  - Clean temp file after extraction (success or failure)
 *  - Remove partial extraction folder on failure
 *  - Validate required Unity WebGL structure post-extraction
 *
 * Extraction strategy: uses PowerShell Expand-Archive (Windows) or unzip (POSIX).
 * No external npm ZIP library required.
 */

const fs    = require('fs');
const fsp   = require('fs').promises;
const path  = require('path');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config');

// ── Path helpers ──────────────────────────────────────────────────────────────

function getStorageBase() {
  const dir = config.storage.simulationsDir;
  return path.isAbsolute(dir) ? dir : path.resolve(process.cwd(), dir);
}

function getBuildPath(buildUuid) {
  
  return path.join(getStorageBase(), buildUuid);
}

function getPublicEntryUrl(buildUuid, entryFile = 'index.html') {
  return `${config.storage.simulationsUrlPrefix}/${buildUuid}/${entryFile}`;
}

/**
 * Portable, deployment-agnostic representation of where a build lives —
 * for DB storage only. Deliberately NOT the same as getBuildPath(), which
 * returns an OS-absolute filesystem path needed for actual fs operations;
 * baking that absolute path into the database would break the moment the
 * app moves to a different machine/container/drive.
 */
function getRelativeBuildPath(buildUuid) {
  return `${config.storage.simulationsDir}/${buildUuid}`.replace(/\\/g, '/');
}

async function ensureStorageDir() {
  await fsp.mkdir(getStorageBase(), { recursive: true });
}

// ── Extraction ────────────────────────────────────────────────────────────────

/**
 * Detects OS and extracts a ZIP file to destDir using the most available tool.
 * On Windows: PowerShell Expand-Archive (built-in).
 * On POSIX:   `unzip -o zipPath -d destDir`.
 */
function extractZipSync(zipPath, destDir) {
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    // Escape paths for PowerShell
    const ps = `powershell.exe -NoProfile -Command "Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${destDir.replace(/'/g, "''")}' -Force"`;
    execSync(ps, { stdio: 'pipe' });
  } else {
    execSync(`unzip -o "${zipPath}" -d "${destDir}"`, { stdio: 'pipe' });
  }
}

/**
 * Scans destDir recursively for any path component containing `..`.
 * Throws if traversal is detected.
 */
function assertNoPathTraversal(destDir) {
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir)) {
      if (entry === '..' || entry.startsWith('../')) {
        throw new Error(`Path traversal detected in extracted content: "${entry}"`);
      }
      const full = path.join(dir, entry);
      if (fs.statSync(full).isDirectory()) walk(full);
    }
  };
  walk(destDir);
}

/**
 * Extracts a Unity WebGL ZIP to storage/simulations/{uuid}/.
 *
 * @param {string} zipPath   - Absolute path to temp ZIP file.
 * @param {string} buildUuid - UUID to use as the folder name.
 * @returns {Promise<{ destDir, validation }>}
 */
async function extractWebGLZip(zipPath, buildUuid) {
  await ensureStorageDir();

  const destDir = getBuildPath(buildUuid);

  if (fs.existsSync(destDir)) {
    throw new Error(`Build folder already exists for UUID ${buildUuid}.`);
  }

  await fsp.mkdir(destDir, { recursive: true });

  try {
    extractZipSync(zipPath, destDir);

    // Security: verify no path traversal survived extraction
    assertNoPathTraversal(destDir);

    // Validate Unity WebGL structure
    const validation = await validateWebGLStructure(destDir);
    return { destDir, validation };

  } catch (err) {
    // Remove partial extraction on failure
    try { fs.rmSync(destDir, { recursive: true, force: true }); } catch (_) {}
    throw err;
  }
}

// ── Validation ────────────────────────────────────────────────────────────────

/**
 * Validates that the extracted folder has the expected Unity WebGL structure.
 * Returns { valid, errors, checklist }.
 */
async function validateWebGLStructure(destDir) {
  const errors    = [];
  const checklist = {};

  // Some ZIP files have a single top-level folder — unwrap if needed
  const topEntries = fs.readdirSync(destDir);
  let rootDir = destDir;

  if (topEntries.length === 1) {
    const singleEntry = path.join(destDir, topEntries[0]);
    if (fs.statSync(singleEntry).isDirectory()) {
      // The ZIP had a wrapping folder (e.g., "Build 002 Benshmark/")
      rootDir = singleEntry;
    }
  }

  // 1. index.html must exist
  const indexHtml = path.join(rootDir, 'index.html');
  checklist.indexHtml = fs.existsSync(indexHtml);
  if (!checklist.indexHtml) errors.push('Missing index.html in ZIP root.');

  // 2. Build/ directory must exist
  const buildDir = path.join(rootDir, 'Build');
  checklist.buildDir = fs.existsSync(buildDir) && fs.statSync(buildDir).isDirectory();
  if (!checklist.buildDir) errors.push('Missing Build/ directory.');

  // 3. Required files inside Build/
  if (checklist.buildDir) {
    const buildFiles = fs.readdirSync(buildDir);

    checklist.loaderJs = buildFiles.some((f) => /\.loader\.js$/i.test(f));
    if (!checklist.loaderJs) errors.push('Missing *.loader.js in Build/.');

    checklist.wasmFile = buildFiles.some((f) => /\.(wasm|wasm\.gz|wasm\.br)$/i.test(f));
    if (!checklist.wasmFile) errors.push('Missing *.wasm or *.wasm.gz in Build/.');

    checklist.dataFile = buildFiles.some((f) => /\.(data|data\.gz|data\.br)$/i.test(f));
    if (!checklist.dataFile) {
      checklist.dataFileWarning = 'No *.data or *.data.gz found (may be intentional).';
    }
  }

  // If the ZIP had a wrapper folder, rewrite the destDir index.html link
  checklist.wrapperFolder = rootDir !== destDir ? rootDir : null;

  return {
    valid: errors.length === 0,
    errors,
    checklist,
    rootDir, // callers may use this to build the correct public_entry_url
  };
}

// ── Cleanup helpers ───────────────────────────────────────────────────────────

async function removeBuildFolder(buildUuid) {
  if (!buildUuid) return;
  const buildDir = getBuildPath(buildUuid);
  if (fs.existsSync(buildDir)) {
    await fsp.rm(buildDir, { recursive: true, force: true });
  }
}

async function cleanTempFile(zipPath) {
  if (zipPath && fs.existsSync(zipPath)) {
    try { await fsp.unlink(zipPath); } catch (_) {}
  }
}

module.exports = {
  getStorageBase,
  getBuildPath,
  getRelativeBuildPath,
  getPublicEntryUrl,
  extractWebGLZip,
  validateWebGLStructure,
  removeBuildFolder,
  cleanTempFile,
  generateBuildUuid: () => uuidv4(),
};
