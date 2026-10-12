'use strict';

const instructorAnalyticsService = require('./instructor-analytics.service');
const ApiResponse = require('../../utils/apiResponse');

exports.getDashboard = async (req, res, next) => {
  try {
    const data = await instructorAnalyticsService.getExperimentDashboard(
      req.params.courseId,
      req.params.simulationId,
      req.query.experimentId || null,
      { page: req.query.page, limit: req.query.limit },
      req.user,
    );
    ApiResponse.ok(res, 'Experiment dashboard.', data);
  } catch (e) { next(e); }
};
