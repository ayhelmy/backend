'use strict';

const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');
const config = require('../../config');

function getLessonFilesDir() {
  return config.storage.lessonFilesDirAbs;
}

// TODO: implement for S3 presigned URL (SRS §4.11 FILE-01 to FILE-05)
exports.requestUpload = async (_body, _actor) => { throw new Error('Not implemented'); };
exports.getUrl        = async (_key, _actor)  => { throw new Error('Not implemented'); };
exports.remove        = async (_key, _actor)  => { throw new Error('Not implemented'); };

exports.uploadFile = async (file, serverUrl) => {
  const dir = getLessonFilesDir();
  fs.mkdirSync(dir, { recursive: true });

  const ext      = path.extname(file.originalname).toLowerCase();
  const destName = `${crypto.randomUUID()}${ext}`;
  const destPath = path.join(dir, destName);

  fs.copyFileSync(file.path, destPath);
  fs.unlinkSync(file.path);

  return {
    url:      `${serverUrl}${config.storage.lessonFilesUrlPrefix}/${destName}`,
    fileName: file.originalname,
    mimeType: file.mimetype,
    size:     file.size,
  };
};
