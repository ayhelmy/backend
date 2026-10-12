/**
 * Public origin of this backend for building absolute URLs (media files,
 * WebGL launch URLs). Prefers config.publicBaseUrl so URLs stay correct when
 * the request reached us through the frontend's /api/v1 rewrite proxy, where
 * the Host header may not be the backend's own public host.
 */
'use strict';

const config = require('../config');

module.exports = function publicBaseUrl(req) {
  return config.publicBaseUrl || `${req.protocol}://${req.get('host')}`;
};
