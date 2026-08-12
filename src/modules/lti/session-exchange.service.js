/**
 * Exchanges a validated-launch token for a real SimuLearn session. Called
 * once by the /lti/launching frontend page after a resource-link launch.
 * See auth.service.js's issueLtiSession for why no refresh cookie is issued.
 */
'use strict';

const { verifyLaunchToken } = require('../../utils/lti-launch-token');
const authService = require('../auth/auth.service');
const ApiError = require('../../utils/apiError');

exports.exchange = async (token) => {
  let payload;
  try {
    payload = verifyLaunchToken(token);
  } catch {
    throw ApiError.badRequest('This launch link has expired or is invalid. Please relaunch from your LMS.');
  }
  if (payload.purpose !== 'resource_link') {
    throw ApiError.badRequest('Invalid session token.');
  }

  const session = await authService.issueLtiSession(payload.simulearnUserId);
  return {
    ...session,
    courseId: payload.courseId,
    lessonId: payload.lessonId,
    simulationId: payload.simulationId,
  };
};
