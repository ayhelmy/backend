'use strict';

const svc = require('./dashboard.service');
const ApiResponse = require('../../utils/apiResponse');

const wrap = (fn) => async (req, res, next) => {
  try {
    ApiResponse.ok(res, 'Dashboard', await fn(req.user));
  } catch (e) {
    next(e);
  }
};

exports.getMe = wrap(svc.getMyDashboard);
exports.getPlatform = wrap(svc.getPlatformDashboard);
exports.getInstitution = wrap(svc.getInstitutionDashboard);
exports.getDepartment = wrap(svc.getDepartmentDashboard);
exports.getInstructor = wrap(svc.getInstructorDashboard);
exports.getTa = wrap(svc.getTaDashboard);
exports.getStudent = wrap(svc.getStudentDashboard);
