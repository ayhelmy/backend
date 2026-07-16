/**
 * File upload routes — SRS §4.11 FILE-01 to FILE-05.
 * POST /api/v1/files/upload          — presigned S3 URL generation or direct upload
 * POST /api/v1/files/upload-file     — direct multipart lesson file upload (video/pdf/doc)
 * GET  /api/v1/files/:key            — get CDN delivery URL
 * DELETE /api/v1/files/:key          — soft-delete / remove from S3
 */
'use strict';

const { Router } = require('express');
const filesController = require('./files.controller');
const authenticate = require('../../middleware/authenticate');
const { authorize } = require('../../middleware/authorize');
const validate = require('../../middleware/validate');
const filesValidators = require('./files.validators');
const { handleLessonFileUpload } = require('../../middleware/upload');

const router = Router();
router.use(authenticate);

router.post('/upload',      filesValidators.requestUpload, validate, filesController.requestUpload);
router.post('/upload-file', authorize('super_admin', 'institution_admin', 'dept_manager', 'instructor', 'teaching_assistant'), handleLessonFileUpload, filesController.uploadFile);
router.get('/:key',         filesController.getUrl);
router.delete('/:key',      authorize('super_admin', 'institution_admin', 'instructor', 'content_creator'), filesController.remove);

module.exports = router;
