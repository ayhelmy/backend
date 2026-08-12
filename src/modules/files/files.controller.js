'use strict';

const svc = require('./files.service');
const ApiResponse = require('../../utils/apiResponse');

exports.requestUpload = async (req, res, next) => { try { ApiResponse.ok(res, 'Upload URL', await svc.requestUpload(req.body, req.user)); } catch (e) { next(e); } };
exports.getUrl        = async (req, res, next) => { try { ApiResponse.ok(res, 'File URL', await svc.getUrl(req.params.key, req.user)); } catch (e) { next(e); } };
exports.remove        = async (req, res, next) => { try { await svc.remove(req.params.key, req.user); ApiResponse.noContent(res); } catch (e) { next(e); } };

exports.uploadFile = async (req, res, next) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 400, title: 'Bad Request', detail: 'No file uploaded.' });
    }
    const serverUrl = `${req.protocol}://${req.get('host')}`;
    ApiResponse.ok(res, 'File uploaded', await svc.uploadFile(req.file, serverUrl));
  } catch (e) {
    next(e);
  }
};
