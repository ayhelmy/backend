'use strict';

const fs = require('fs');
const config = require('./src/config');

const storageDirs = [
  config.storage.simulationsDirAbs,
  config.storage.thumbnailsDirAbs,
  config.storage.lessonFilesDirAbs,
];

function ensureStorageDirectories() {
  for (const dir of storageDirs) {
    try {
      fs.mkdirSync(dir, { recursive: true });
    } catch (err) {
      console.error(`Failed to ensure storage directory ${dir}:`, err);
      throw err;
    }
  }
}

module.exports = {
  ensureStorageDirectories,
};
