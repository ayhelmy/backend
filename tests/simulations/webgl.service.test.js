'use strict';

/**
 * Unit tests for webgl.service.js — filesystem-level operations.
 * No mocking: tests use real temp dirs and PowerShell ZIP creation.
 * SRS §4.7 SIM-01; requirements: upload valid ZIP creates UUID folder;
 * extracted folder has index.html + Build files; invalid ZIP rejected;
 * path traversal detected; missing index.html rejected.
 */

const os   = require('os');
const path = require('path');
const fs   = require('fs');
const { execSync } = require('child_process');

const webglSvc = require('../../src/modules/simulations/webgl.service');

// ── Filesystem helpers ────────────────────────────────────────────────────────

function makeWebGLDir(dir, opts = {}) {
  const { missingIndexHtml, missingBuildDir, missingLoaderJs, missingWasm } = opts;
  fs.mkdirSync(dir, { recursive: true });
  if (!missingIndexHtml) {
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><body>WebGL</body></html>');
  }
  if (!missingBuildDir) {
    const buildDir = path.join(dir, 'Build');
    fs.mkdirSync(buildDir, { recursive: true });
    if (!missingLoaderJs) {
      fs.writeFileSync(path.join(buildDir, 'game.loader.js'), '// Unity loader');
    }
    if (!missingWasm) {
      fs.writeFileSync(path.join(buildDir, 'game.wasm.gz'), Buffer.from('fake wasm'));
    }
    fs.writeFileSync(path.join(buildDir, 'game.data.gz'), Buffer.from('fake data'));
  }
  fs.mkdirSync(path.join(dir, 'TemplateData'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'TemplateData', 'style.css'), '');
}

function zipDirContents(srcDir, zipPath) {
  if (process.platform === 'win32') {
    const src = srcDir.replace(/'/g, "''");
    const dst = zipPath.replace(/'/g, "''");
    execSync(
      `powershell.exe -NoProfile -Command "Compress-Archive -Path '${src}\\*' -DestinationPath '${dst}' -Force"`,
      { stdio: 'pipe' },
    );
  } else {
    execSync(`cd "${srcDir}" && zip -r "${zipPath}" .`, { stdio: 'pipe' });
  }
}

function zipDirAsWrapper(srcDir, zipPath) {
  const parentDir = path.dirname(srcDir);
  const dirName   = path.basename(srcDir);
  if (process.platform === 'win32') {
    const src = path.join(parentDir, dirName).replace(/'/g, "''");
    const dst = zipPath.replace(/'/g, "''");
    execSync(
      `powershell.exe -NoProfile -Command "Compress-Archive -Path '${src}' -DestinationPath '${dst}' -Force"`,
      { stdio: 'pipe' },
    );
  } else {
    execSync(`cd "${parentDir}" && zip -r "${zipPath}" "${dirName}"`, { stdio: 'pipe' });
  }
}

// Track build UUIDs created during extraction tests so we can clean them up.
const createdBuildUuids = [];

afterAll(async () => {
  for (const uuid of createdBuildUuids) {
    try { await webglSvc.removeBuildFolder(uuid); } catch (_) {}
  }
});

// ── Path helpers ──────────────────────────────────────────────────────────────

describe('webgl.service — path helpers', () => {
  it('generateBuildUuid() returns a valid UUID v4', () => {
    const uuid = webglSvc.generateBuildUuid();
    expect(uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it('generateBuildUuid() produces unique values', () => {
    const a = webglSvc.generateBuildUuid();
    const b = webglSvc.generateBuildUuid();
    expect(a).not.toBe(b);
  });

  it('getBuildPath() returns an absolute path ending with the UUID', () => {
    const uuid = '00000000-0000-4000-a000-000000000001';
    const p = webglSvc.getBuildPath(uuid);
    expect(path.isAbsolute(p)).toBe(true);
    expect(p.endsWith(uuid)).toBe(true);
  });

  it('getPublicEntryUrl() returns /simulations-runtime/{uuid}/index.html', () => {
    const uuid = '00000000-0000-4000-a000-000000000001';
    expect(webglSvc.getPublicEntryUrl(uuid, 'index.html'))
      .toBe(`/simulations-runtime/${uuid}/index.html`);
  });

  it('getPublicEntryUrl() defaults entryFile to index.html', () => {
    const uuid = '00000000-0000-4000-a000-000000000002';
    expect(webglSvc.getPublicEntryUrl(uuid))
      .toBe(`/simulations-runtime/${uuid}/index.html`);
  });

  it('getPublicEntryUrl() handles wrapper folder sub-path', () => {
    const uuid = '00000000-0000-4000-a000-000000000003';
    expect(webglSvc.getPublicEntryUrl(uuid, 'MyBuild/index.html'))
      .toBe(`/simulations-runtime/${uuid}/MyBuild/index.html`);
  });
});

// ── validateWebGLStructure() ──────────────────────────────────────────────────

describe('webgl.service — validateWebGLStructure()', () => {
  let tmpBase;

  beforeAll(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-validate-'));
  });

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('returns valid=true for a correct Unity WebGL structure', async () => {
    const dir = path.join(tmpBase, 'valid');
    makeWebGLDir(dir);
    const r = await webglSvc.validateWebGLStructure(dir);

    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
    expect(r.checklist.indexHtml).toBe(true);
    expect(r.checklist.buildDir).toBe(true);
    expect(r.checklist.loaderJs).toBe(true);
    expect(r.checklist.wasmFile).toBe(true);
  });

  it('errors when index.html is missing', async () => {
    const dir = path.join(tmpBase, 'no-index');
    makeWebGLDir(dir, { missingIndexHtml: true });
    const r = await webglSvc.validateWebGLStructure(dir);

    expect(r.valid).toBe(false);
    expect(r.checklist.indexHtml).toBe(false);
    expect(r.errors.some((e) => /index\.html/i.test(e))).toBe(true);
  });

  it('errors when Build/ directory is missing', async () => {
    const dir = path.join(tmpBase, 'no-build');
    makeWebGLDir(dir, { missingBuildDir: true });
    const r = await webglSvc.validateWebGLStructure(dir);

    expect(r.valid).toBe(false);
    expect(r.checklist.buildDir).toBe(false);
    expect(r.errors.some((e) => /Build\//i.test(e))).toBe(true);
  });

  it('errors when loader.js is missing from Build/', async () => {
    const dir = path.join(tmpBase, 'no-loader');
    makeWebGLDir(dir, { missingLoaderJs: true });
    const r = await webglSvc.validateWebGLStructure(dir);

    expect(r.valid).toBe(false);
    expect(r.checklist.loaderJs).toBe(false);
    expect(r.errors.some((e) => /loader\.js/i.test(e))).toBe(true);
  });

  it('errors when wasm file is missing from Build/', async () => {
    const dir = path.join(tmpBase, 'no-wasm');
    makeWebGLDir(dir, { missingWasm: true });
    const r = await webglSvc.validateWebGLStructure(dir);

    expect(r.valid).toBe(false);
    expect(r.checklist.wasmFile).toBe(false);
    expect(r.errors.some((e) => /wasm/i.test(e))).toBe(true);
  });

  it('detects a wrapper folder and populates checklist.wrapperFolder', async () => {
    const outerDir = path.join(tmpBase, 'with-wrapper');
    fs.mkdirSync(outerDir, { recursive: true });
    // Simulate a ZIP extracted with a single top-level wrapper folder
    const innerDir = path.join(outerDir, 'WebGLBuild');
    makeWebGLDir(innerDir);
    const r = await webglSvc.validateWebGLStructure(outerDir);

    expect(r.valid).toBe(true);
    expect(r.checklist.wrapperFolder).not.toBeNull();
    expect(r.checklist.wrapperFolder).toContain('WebGLBuild');
    expect(r.rootDir).toBe(innerDir);
  });

  it('sets wrapperFolder=null when no wrapper folder (files at root)', async () => {
    const dir = path.join(tmpBase, 'no-wrapper');
    makeWebGLDir(dir);
    const r = await webglSvc.validateWebGLStructure(dir);

    expect(r.checklist.wrapperFolder).toBeNull();
    expect(r.rootDir).toBe(dir);
  });

  it('accumulates multiple errors for a badly malformed structure', async () => {
    const dir = path.join(tmpBase, 'very-bad');
    fs.mkdirSync(dir, { recursive: true });
    // Completely empty directory
    const r = await webglSvc.validateWebGLStructure(dir);

    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ── extractWebGLZip() ─────────────────────────────────────────────────────────

describe('webgl.service — extractWebGLZip()', () => {
  let tmpBase;

  beforeAll(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-extract-'));
  });

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('creates UUID folder and extracts a valid Unity WebGL ZIP', async () => {
    const srcDir  = path.join(tmpBase, 'src-valid');
    const zipPath = path.join(tmpBase, 'valid.zip');
    makeWebGLDir(srcDir);
    zipDirContents(srcDir, zipPath);

    const uuid = webglSvc.generateBuildUuid();
    createdBuildUuids.push(uuid);

    const { destDir, validation } = await webglSvc.extractWebGLZip(zipPath, uuid);

    expect(fs.existsSync(destDir)).toBe(true);
    expect(validation.valid).toBe(true);
    expect(webglSvc.getBuildPath(uuid)).toBe(destDir);
  });

  it('extracted folder contains index.html and Build/ with loader.js and wasm', async () => {
    const srcDir  = path.join(tmpBase, 'src-contents');
    const zipPath = path.join(tmpBase, 'contents.zip');
    makeWebGLDir(srcDir);
    zipDirContents(srcDir, zipPath);

    const uuid = webglSvc.generateBuildUuid();
    createdBuildUuids.push(uuid);

    const { destDir } = await webglSvc.extractWebGLZip(zipPath, uuid);

    expect(fs.existsSync(path.join(destDir, 'index.html'))).toBe(true);
    expect(fs.existsSync(path.join(destDir, 'Build'))).toBe(true);

    const buildFiles = fs.readdirSync(path.join(destDir, 'Build'));
    expect(buildFiles.some((f) => f.endsWith('.loader.js'))).toBe(true);
    expect(buildFiles.some((f) => /\.(wasm|wasm\.gz|wasm\.br)$/.test(f))).toBe(true);
  });

  it('simulation build_uuid and public_entry_url are deterministic from the UUID', async () => {
    const uuid = webglSvc.generateBuildUuid();
    const url  = webglSvc.getPublicEntryUrl(uuid);
    expect(url).toBe(`/simulations-runtime/${uuid}/index.html`);
  });

  it('returns validation.valid=false when ZIP is missing index.html (caller rejects)', async () => {
    const srcDir  = path.join(tmpBase, 'src-no-index');
    const zipPath = path.join(tmpBase, 'no-index.zip');
    makeWebGLDir(srcDir, { missingIndexHtml: true });
    zipDirContents(srcDir, zipPath);

    const uuid = webglSvc.generateBuildUuid();
    createdBuildUuids.push(uuid); // folder stays on disk; clean up in afterAll

    // extractWebGLZip does NOT throw for validation failures —
    // it returns the validation result and the caller (catalog.service) rejects it.
    const { validation } = await webglSvc.extractWebGLZip(zipPath, uuid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => /index\.html/i.test(e))).toBe(true);
    // Folder exists on disk (caller is responsible for cleanup decision)
    expect(fs.existsSync(webglSvc.getBuildPath(uuid))).toBe(true);
  });

  it('returns validation.valid=false when ZIP is missing Build/ (caller rejects)', async () => {
    const srcDir  = path.join(tmpBase, 'src-no-build');
    const zipPath = path.join(tmpBase, 'no-build.zip');
    makeWebGLDir(srcDir, { missingBuildDir: true });
    zipDirContents(srcDir, zipPath);

    const uuid = webglSvc.generateBuildUuid();
    createdBuildUuids.push(uuid);

    const { validation } = await webglSvc.extractWebGLZip(zipPath, uuid);
    expect(validation.valid).toBe(false);
    expect(validation.errors.some((e) => /Build\//i.test(e))).toBe(true);
  });

  it('throws when UUID folder already exists (prevents overwrite)', async () => {
    const uuid = webglSvc.generateBuildUuid();
    createdBuildUuids.push(uuid);

    // Pre-create the target folder to simulate a collision
    fs.mkdirSync(webglSvc.getBuildPath(uuid), { recursive: true });

    const srcDir  = path.join(tmpBase, 'src-dup');
    const zipPath = path.join(tmpBase, 'dup.zip');
    makeWebGLDir(srcDir);
    zipDirContents(srcDir, zipPath);

    await expect(webglSvc.extractWebGLZip(zipPath, uuid)).rejects.toThrow(/already exists/);
  });

  it('detects wrapper folder in extracted ZIP and sets checklist.wrapperFolder', async () => {
    // Create WebGL content inside a named folder, then ZIP the folder itself
    const innerName = 'MyWebGLBuild';
    const outerDir  = path.join(tmpBase, 'wrapper-outer');
    const innerDir  = path.join(outerDir, innerName);
    makeWebGLDir(innerDir);

    const zipPath = path.join(tmpBase, 'wrapper.zip');
    zipDirAsWrapper(innerDir, zipPath);

    const uuid = webglSvc.generateBuildUuid();
    createdBuildUuids.push(uuid);

    const { validation } = await webglSvc.extractWebGLZip(zipPath, uuid);

    expect(validation.valid).toBe(true);
    expect(validation.checklist.wrapperFolder).not.toBeNull();
  });
});

// ── cleanup helpers ───────────────────────────────────────────────────────────

describe('webgl.service — cleanup helpers', () => {
  let tmpBase;

  beforeAll(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'sl-cleanup-'));
  });

  afterAll(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('removeBuildFolder() deletes the build directory and its contents', async () => {
    const uuid     = webglSvc.generateBuildUuid();
    const buildDir = webglSvc.getBuildPath(uuid);
    fs.mkdirSync(buildDir, { recursive: true });
    fs.writeFileSync(path.join(buildDir, 'index.html'), '<html/>');

    await webglSvc.removeBuildFolder(uuid);

    expect(fs.existsSync(buildDir)).toBe(false);
  });

  it('removeBuildFolder() is a no-op for a non-existent UUID', async () => {
    const uuid = webglSvc.generateBuildUuid();
    await expect(webglSvc.removeBuildFolder(uuid)).resolves.toBeUndefined();
  });

  it('removeBuildFolder() is a no-op for null/undefined', async () => {
    await expect(webglSvc.removeBuildFolder(null)).resolves.toBeUndefined();
    await expect(webglSvc.removeBuildFolder(undefined)).resolves.toBeUndefined();
  });

  it('cleanTempFile() deletes the temp file', async () => {
    const filePath = path.join(tmpBase, 'upload.zip');
    fs.writeFileSync(filePath, 'dummy zip content');

    await webglSvc.cleanTempFile(filePath);

    expect(fs.existsSync(filePath)).toBe(false);
  });

  it('cleanTempFile() is a no-op for a non-existent path', async () => {
    await expect(
      webglSvc.cleanTempFile(path.join(tmpBase, 'nonexistent.zip')),
    ).resolves.toBeUndefined();
  });

  it('cleanTempFile() is a no-op for null/undefined', async () => {
    await expect(webglSvc.cleanTempFile(null)).resolves.toBeUndefined();
    await expect(webglSvc.cleanTempFile(undefined)).resolves.toBeUndefined();
  });
});
