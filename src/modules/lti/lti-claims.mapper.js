/**
 * Pure helpers for LTI 1.3 claim URIs and identity-key derivation. No I/O.
 * SRS reference doc §11.5–11.7 (user/course/activity mapping rules).
 */
'use strict';

const CLAIMS = Object.freeze({
  MESSAGE_TYPE:    'https://purl.imsglobal.org/spec/lti/claim/message_type',
  VERSION:         'https://purl.imsglobal.org/spec/lti/claim/version',
  DEPLOYMENT_ID:   'https://purl.imsglobal.org/spec/lti/claim/deployment_id',
  TARGET_LINK_URI: 'https://purl.imsglobal.org/spec/lti/claim/target_link_uri',
  CONTEXT:         'https://purl.imsglobal.org/spec/lti/claim/context',
  RESOURCE_LINK:   'https://purl.imsglobal.org/spec/lti/claim/resource_link',
  ROLES:           'https://purl.imsglobal.org/spec/lti/claim/roles',
  CUSTOM:          'https://purl.imsglobal.org/spec/lti/claim/custom',
  AGS_ENDPOINT:    'https://purl.imsglobal.org/spec/lti-ags/claim/endpoint',
  NRPS:            'https://purl.imsglobal.org/spec/lti-nrps/claim/namesroleservice',
  DEEP_LINKING_SETTINGS: 'https://purl.imsglobal.org/spec/lti-dl/claim/deep_linking_settings',
  CONTENT_ITEMS:   'https://purl.imsglobal.org/spec/lti-dl/claim/content_items',
});

const MESSAGE_TYPES = Object.freeze({
  RESOURCE_LINK_REQUEST:  'LtiResourceLinkRequest',
  DEEP_LINKING_REQUEST:   'LtiDeepLinkingRequest',
  DEEP_LINKING_RESPONSE:  'LtiDeepLinkingResponse',
});

/** issuer + ':' + sub — SRS §11.5 user mapping rule. */
function deriveUserKey(issuer, sub) {
  return `${issuer}::${sub}`;
}

/** issuer + ':' + context.id — SRS §11.6 course mapping rule. */
function deriveContextKey(issuer, contextId) {
  return `${issuer}::${contextId}`;
}

/** issuer + ':' + context.id + ':' + resource_link.id — SRS §11.7 activity mapping rule. */
function deriveResourceLinkKey(issuer, contextId, resourceLinkId) {
  return `${issuer}::${contextId ?? ''}::${resourceLinkId}`;
}

/** Flattens the claims relevant for logging/response into a plain object. */
function extractLaunchSummary(claims) {
  const context = claims[CLAIMS.CONTEXT] || {};
  const resourceLink = claims[CLAIMS.RESOURCE_LINK] || {};
  return {
    sub:             claims.sub,
    issuer:          claims.iss,
    name:            claims.name ?? null,
    email:           claims.email ?? null,
    deploymentId:    claims[CLAIMS.DEPLOYMENT_ID],
    messageType:     claims[CLAIMS.MESSAGE_TYPE],
    version:         claims[CLAIMS.VERSION],
    contextId:       context.id ?? null,
    contextLabel:    context.label ?? null,
    contextTitle:    context.title ?? null,
    resourceLinkId:  resourceLink.id ?? null,
    resourceLinkTitle: resourceLink.title ?? null,
    roles:           claims[CLAIMS.ROLES] || [],
    custom:          claims[CLAIMS.CUSTOM] || {},
    agsEndpoint:     claims[CLAIMS.AGS_ENDPOINT] ?? null,
    nrps:            claims[CLAIMS.NRPS] ?? null,
    deepLinkingSettings: claims[CLAIMS.DEEP_LINKING_SETTINGS] ?? null,
  };
}

module.exports = { CLAIMS, MESSAGE_TYPES, deriveUserKey, deriveContextKey, deriveResourceLinkKey, extractLaunchSummary };
