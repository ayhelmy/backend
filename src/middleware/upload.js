'use strict';

/**
 * Multer upload middleware for Unity WebGL ZIP files.
 * SRS §4.7 SIM-01 — secure file upload with size and type validation.
 */

const path   = require('path');
const multer = require('multer');
const os     = require('os');
const config = require('../config');

// Store uploads in the OS temp dir; the WebGL service extracts and discards the temp file.
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, os.tmpdir()),
  filename:    (_req, file, cb) => {
    // Sanitise the original name for the temp slot
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `simwebgl_${Date.now()}_${safe}`);
  },
});

function zipFilter(_req, file, cb) {
  const ext      = path.extname(file.originalname).toLowerCase();
  const mime     = file.mimetype;
  const validExt = ext === '.zip';
  const validMime = [
    'application/zip',
    'application/x-zip-compressed',
    'application/octet-stream', // Some browsers send this for .zip
    'multipart/x-zip',
  ].includes(mime);

  if (!validExt || (!validMime && mime !== 'application/octet-stream')) {
    return cb(new Error('Only .zip files are accepted.'));
  }
  cb(null, true);
}

const uploadZip = multer({
  storage,
  fileFilter: zipFilter,
  limits: { fileSize: config.storage.maxUploadBytes },
}).single('zip_file');

/**
 * Express middleware wrapper that converts multer errors to ApiError-compatible objects.
 */
function handleZipUpload(req, res, next) {
  uploadZip(req, res, (err) => {
    if (!err) return next();

    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMB = Math.round(config.storage.maxUploadBytes / 1024 / 1024);
        return res.status(413).json({
          status: 413,
          title: 'Payload Too Large',
          detail: `ZIP file exceeds the maximum upload size of ${maxMB} MB.`,
        });
      }
      return res.status(400).json({ status: 400, title: 'Upload Error', detail: err.message });
    }

    if (err) {
      return res.status(400).json({ status: 400, title: 'Upload Error', detail: err.message });
    }

    next();
  });
}

// ── Thumbnail image upload ────────────────────────────────────────────────────

const ALLOWED_IMAGE_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

const uploadImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
      cb(null, `simthumb_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_IMAGE_MIMES.includes(file.mimetype)) {
      return cb(new Error('Only image files (JPEG, PNG, WebP, GIF) are accepted.'));
    }
    cb(null, true);
  },
  limits: { fileSize: config.storage.maxThumbnailBytes },
}).single('thumbnail');

function handleImageUpload(req, res, next) {
  uploadImage(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const maxMB = Math.round(config.storage.maxThumbnailBytes / 1024 / 1024);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ status: 413, title: 'File Too Large', detail: `Image exceeds ${maxMB} MB.` });
      }
      return res.status(400).json({ status: 400, title: 'Upload Error', detail: err.message });
    }
    return res.status(400).json({ status: 400, title: 'Upload Error', detail: err.message });
  });
}

// ── Click-region reference image upload ───────────────────────────────────────
// Used together with a JSON `regions` text field (annotation categories +
// bounding boxes) to map recorded click coordinates to component names.

const uploadClickRegionsImage = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '.png';
      cb(null, `simregions_${Date.now()}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!['image/jpeg', 'image/png'].includes(file.mimetype)) {
      return cb(new Error('Only PNG or JPEG images are accepted for click regions.'));
    }
    cb(null, true);
  },
  limits: { fileSize: config.storage.maxThumbnailBytes },
}).single('image');

function handleClickRegionsUpload(req, res, next) {
  uploadClickRegionsImage(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      const maxMB = Math.round(config.storage.maxThumbnailBytes / 1024 / 1024);
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ status: 413, title: 'File Too Large', detail: `Image exceeds ${maxMB} MB.` });
      }
      return res.status(400).json({ status: 400, title: 'Upload Error', detail: err.message });
    }
    return res.status(400).json({ status: 400, title: 'Upload Error', detail: err.message });
  });
}

// ── Lesson file upload (video, PDF, documents) ────────────────────────────────

const ALLOWED_LESSON_FILE_MIMES = [
  'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
];

const uploadLessonFileMulter = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, os.tmpdir()),
    filename:    (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase() || '';
      cb(null, `lessonfile_${Date.now()}_${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_LESSON_FILE_MIMES.includes(file.mimetype)) {
      return cb(new Error(`File type "${file.mimetype}" is not allowed for lesson uploads.`));
    }
    cb(null, true);
  },
  limits: { fileSize: config.storage.maxLessonFileBytes },
}).single('file');

function handleLessonFileUpload(req, res, next) {
  uploadLessonFileMulter(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        const maxMB = Math.round(config.storage.maxLessonFileBytes / 1024 / 1024);
        return res.status(413).json({ status: 413, title: 'File Too Large', detail: `File exceeds the ${maxMB} MB limit.` });
      }
      return res.status(400).json({ status: 400, title: 'Upload Error', detail: err.message });
    }
    return res.status(400).json({ status: 400, title: 'Upload Error', detail: err.message });
  });
}

module.exports = { handleZipUpload, handleImageUpload, handleClickRegionsUpload, handleLessonFileUpload };
