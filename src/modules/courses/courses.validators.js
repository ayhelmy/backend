'use strict';

const { body } = require('express-validator');

exports.create = [
  body('title').trim().notEmpty().withMessage('title is required'),
  body('institutionId').isUUID(),
  body('departmentId').isUUID().withMessage('departmentId (UUID) is required'),
  body('academicYearId').isUUID().withMessage('academicYearId (UUID) is required'),
  body('semesterTermId').isUUID().withMessage('semesterTermId (UUID) is required'),
  body('status').optional().isIn(['draft','published','archived']),
  body('passingGrade').optional().isFloat({ min: 0, max: 100 }),
  body('enrollmentType').optional().isIn(['open','approval','code','admin']),
  body('enrollmentCap').optional({ nullable: true }).isInt({ min: 1 }),
];

exports.update = [
  body('title').optional().trim().notEmpty(),
  body('departmentId').optional().isUUID().withMessage('departmentId must be a valid UUID'),
  body('academicYearId').optional().isUUID().withMessage('academicYearId must be a valid UUID'),
  body('semesterTermId').optional().isUUID().withMessage('semesterTermId must be a valid UUID'),
  body('status').optional().isIn(['draft','published','archived']),
  body('passingGrade').optional().isFloat({ min: 0, max: 100 }),
  body('enrollmentType').optional().isIn(['open','approval','code','admin']),
  body('enrollmentCap').optional({ nullable: true }).isInt({ min: 1 }),
];

exports.enroll = [
  body('userId').optional().isUUID(),
  body('role').optional().isIn(['student','instructor','teaching_assistant']),
  body('enrollmentCode').optional().isString().trim(),
];
