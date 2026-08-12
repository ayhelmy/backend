/**
 * LTI Deep Linking 2.0 — instructor simulation selection.
 * SRS reference doc §10 (Workflow 2).
 *
 * Flow: validated LtiDeepLinkingRequest launch -> provision instructor +
 * shadow course -> mint a deep-linking-scoped token -> frontend picker (only
 * institution-assigned simulations) -> signed content-item response JWT ->
 * frontend auto-posts it back to deep_link_return_url.
 */
'use strict';

const jwt = require('jsonwebtoken');
const { pool } = require('../../config/database');
const config = require('../../config');
const { randomToken } = require('../../utils/crypto');
const { signLaunchToken, verifyLaunchToken } = require('../../utils/lti-launch-token');
const toolKeysSvc = require('./tool-keys.service');
const provisioningSvc = require('./lti-provisioning.service');
const { CLAIMS, MESSAGE_TYPES } = require('./lti-claims.mapper');
const { LtiError, LTI_ERROR_CODES } = require('./lti-errors');
const { SimulationCatalogModel, LtiPlatformModel } = require('../../db/models');
const ApiError = require('../../utils/apiError');

/**
 * Called right after a validated LtiDeepLinkingRequest launch. Provisions the
 * instructor + shadow course (see plan addendum), and mints a short-lived
 * token carrying everything the picker/response endpoints need.
 */
exports.prepareDeepLinkingSession = async ({ claims, platform, deployment }) => {
  const context = claims[CLAIMS.CONTEXT] || {};
  const roles = claims[CLAIMS.ROLES] || [];

  const instructor = await provisioningSvc.ensureInternalUser({
    issuer: claims.iss, sub: claims.sub, name: claims.name, email: claims.email,
    institutionId: platform.institution_id, roles,
  });

  let courseId = null;
  if (context.id) {
    const course = await provisioningSvc.ensureCourseForContext({
      issuer: claims.iss, context, institutionId: platform.institution_id, instructorUserId: instructor.id,
    });
    courseId = course.id;
  }

  const deepLinkingSettings = claims[CLAIMS.DEEP_LINKING_SETTINGS];
  if (!deepLinkingSettings?.deep_link_return_url) {
    throw new LtiError(LTI_ERROR_CODES.CLAIM_VALIDATION_FAILED, 'Missing deep_linking_settings.deep_link_return_url.');
  }

  const token = signLaunchToken({
    purpose: 'deep_linking',
    platformId: platform.id,
    deploymentId: deployment.deployment_id,
    institutionId: platform.institution_id,
    instructorUserId: instructor.id,
    courseId,
    contextTitle: context.title ?? context.label ?? null,
    deepLinkingSettings,
  });

  return { token };
};

/** Institution-scoped simulation library for the picker — never trusts the frontend to filter. */
async function listAvailableSimulations(institutionId, search) {
  const catalogs = await SimulationCatalogModel.getAssignedTree(institutionId);
  const catalogIds = catalogs.map((c) => c.id);
  if (!catalogIds.length) return [];

  const params = [catalogIds];
  let searchClause = '';
  if (search) {
    params.push(`%${search.toLowerCase()}%`);
    searchClause = `AND LOWER(s.title) LIKE $${params.length}`;
  }

  const { rows } = await pool.query(
    `SELECT DISTINCT s.id, s.title, s.description, s.type, s.launch_type, s.thumbnail_url,
            s.estimated_minutes, s.difficulty, s.max_score, s.status, s.build_status
       FROM simulations s
       JOIN simulation_catalog_items sci ON sci.simulation_id = s.id
      WHERE sci.catalog_id = ANY($1::uuid[])
        AND s.deleted_at IS NULL AND s.status = 'active'
        AND (s.launch_type != 'webgl' OR s.build_status = 'ready')
        ${searchClause}
      ORDER BY s.title`,
    params,
  );
  return rows;
}

exports.getPickerContext = async (token, search) => {
  let payload;
  try {
    payload = verifyLaunchToken(token);
  } catch {
    throw ApiError.badRequest('This Deep Linking session has expired or is invalid. Please reopen it from your LMS.');
  }
  if (payload.purpose !== 'deep_linking') throw ApiError.badRequest('Invalid session token.');

  const simulations = await listAvailableSimulations(payload.institutionId, search);
  return {
    contextTitle: payload.contextTitle,
    acceptMultiple: payload.deepLinkingSettings?.accept_multiple ?? false,
    acceptPresentationDocumentTargets: payload.deepLinkingSettings?.accept_presentation_document_targets ?? ['iframe'],
    simulations: simulations.map((s) => ({
      id: s.id,
      title: s.title,
      description: s.description,
      thumbnailUrl: s.thumbnail_url,
      estimatedMinutes: s.estimated_minutes,
      difficulty: s.difficulty,
      maxScore: Number(s.max_score ?? 100),
      launchType: s.launch_type,
    })),
  };
};

/**
 * @param {string} token
 * @param {Array<{simulationId, title?, maxScore, gradingMode, attemptPolicy, durationLimit, launchBehavior}>} selections
 */
exports.buildResponse = async (token, selections) => {
  let payload;
  try {
    payload = verifyLaunchToken(token);
  } catch {
    throw ApiError.badRequest('This Deep Linking session has expired or is invalid. Please reopen it from your LMS.');
  }
  if (payload.purpose !== 'deep_linking') throw ApiError.badRequest('Invalid session token.');
  if (!selections?.length) throw ApiError.badRequest('Select at least one simulation.');

  const toolLaunchUrl = `${config.lti.toolBaseUrl}/api/${config.apiVersion}/lti/launch`;

  const contentItems = [];
  for (const sel of selections) {
    const assigned = await SimulationCatalogModel.isSimulationAssignedToInstitution(sel.simulationId, payload.institutionId);
    if (!assigned) throw new LtiError(LTI_ERROR_CODES.SIMULATION_NOT_ASSIGNED);

    const maxScore = Number(sel.maxScore ?? 100);
    const gradingMode = sel.gradingMode ?? 'score_and_completion';
    const custom = {
      simulation_id: sel.simulationId,
      content_type: 'simulation',
      grading_mode: gradingMode,
      max_score: String(maxScore),
      attempt_policy: sel.attemptPolicy ?? 'best',
      ...(sel.durationLimit ? { duration_limit: String(sel.durationLimit) } : {}),
    };

    contentItems.push({
      type: 'ltiResourceLink',
      title: sel.title || 'Simulation Activity',
      url: toolLaunchUrl,
      custom,
      ...(gradingMode !== 'completion' ? {
        lineItem: { scoreMaximum: maxScore, label: sel.title || 'Simulation Activity', resourceId: sel.simulationId },
      } : {}),
      presentation: { documentTarget: sel.launchBehavior ?? 'iframe' },
    });
  }

  const platform = await LtiPlatformModel.findById(payload.platformId);
  if (!platform) throw ApiError.notFound('Platform no longer registered.');

  const { kid, privateKeyPem } = await toolKeysSvc.getActiveSigningKey();
  const now = Math.floor(Date.now() / 1000);
  const responseClaims = {
    iss: platform.client_id,
    aud: platform.issuer,
    exp: now + 300,
    iat: now,
    nonce: randomToken(16),
    [CLAIMS.MESSAGE_TYPE]: MESSAGE_TYPES.DEEP_LINKING_RESPONSE,
    [CLAIMS.VERSION]: '1.3.0',
    [CLAIMS.DEPLOYMENT_ID]: payload.deploymentId,
    [CLAIMS.CONTENT_ITEMS]: contentItems,
  };
  if (payload.deepLinkingSettings?.data) {
    responseClaims['https://purl.imsglobal.org/spec/lti-dl/claim/data'] = payload.deepLinkingSettings.data;
  }

  const responseJwt = jwt.sign(responseClaims, privateKeyPem, { algorithm: 'RS256', keyid: kid });

  return { returnUrl: payload.deepLinkingSettings.deep_link_return_url, jwt: responseJwt };
};
