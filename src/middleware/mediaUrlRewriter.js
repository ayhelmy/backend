/**
 * Resolves DB-stored relative static-asset paths (thumbnails, WebGL builds,
 * lesson files, etc.) into absolute URLs using the CURRENT request's
 * protocol+host, at the moment a JSON response is sent.
 *
 * Why: values like `simulations.thumbnail_url` must be stored relative
 * (e.g. "/thumbnails/xyz.jpg") so the data stays valid across environments/
 * deployments — a value baked with a specific host at upload time (e.g.
 * "http://172.20.44.1:5000/thumbnails/xyz.jpg") breaks the moment the app
 * moves to a different domain. Resolving centrally here (instead of at each
 * of the many read paths that return a simulation/catalog/etc.) means every
 * current and future endpoint gets correct absolute URLs automatically,
 * with no risk of a call site forgetting to do it.
 *
 * Already-absolute values (e.g. a user-provided external URL) are left
 * untouched, since they don't start with one of the known static prefixes.
 */
'use strict';

const config = require('../config');

const MEDIA_PREFIXES = [
  config.storage.thumbnailsUrlPrefix,
  config.storage.simulationsUrlPrefix,
  config.storage.lessonFilesUrlPrefix,
  config.storage.qtiAssetsUrlPrefix,
  config.storage.mailAttachmentsUrlPrefix,
].filter(Boolean);

function rewriteValue(value, baseUrl) {
  if (typeof value !== 'string') return value;
  for (const prefix of MEDIA_PREFIXES) {
    if (value === prefix || value.startsWith(`${prefix}/`)) {
      return `${baseUrl}${value}`;
    }
  }
  return value;
}

/**
 * Whether to recurse into this object's own properties. Response bodies here
 * are class instances (e.g. `new ApiResponse(...)`), not just plain object
 * literals, so checking for an exact Object.prototype match (as a naive
 * "isPlainObject" would) incorrectly rejects them and skips the whole tree.
 * Instead: walk anything object-like EXCEPT values with their own `toJSON`
 * (Date, and any future custom-serializable class) — those must be left
 * alone and handled natively by JSON.stringify, since (e.g.) rebuilding a
 * Date via Object.entries() would collapse it to `{}` (its fields aren't
 * own enumerable properties).
 */
function isWalkable(value) {
  if (value === null || typeof value !== 'object') return false;
  if (typeof value.toJSON === 'function') return false;
  if (Buffer.isBuffer(value)) return false;
  return true;
}

function rewriteDeep(value, baseUrl) {
  if (Array.isArray(value)) return value.map((v) => rewriteDeep(v, baseUrl));
  if (isWalkable(value)) {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = rewriteDeep(v, baseUrl);
    return out;
  }
  return rewriteValue(value, baseUrl);
}

module.exports = function mediaUrlRewriter(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    return originalJson(rewriteDeep(body, baseUrl));
  };
  next();
};
