/**
 * LTI Names and Role Provisioning Services (NRPS) — roster sync.
 * SRS reference doc §14. Reuses the SAME provisioning helpers Deep Linking
 * and student launch use (ensureInternalUser/ensureEnrollment) — a synced
 * member becomes a normal enrolled SimuLearn user, not a parallel roster
 * record, so the existing course roster/gradebook views pick them up as-is.
 */
'use strict';

const { LtiIdentityModel, LtiPlatformModel, CourseModel, AuditModel } = require('../../db/models');
const { getPlatformAccessToken } = require('./platform-oauth.service');
const provisioningSvc = require('./lti-provisioning.service');
const ApiError = require('../../utils/apiError');

const NRPS_SCOPE = 'https://purl.imsglobal.org/spec/lti-nrps/scope/contextmembership.readonly';

/** Parses the RFC 5988 Link header NRPS uses for pagination, returns the rel="next" URL or null. */
function parseNextLink(linkHeader) {
  if (!linkHeader) return null;
  for (const part of linkHeader.split(',')) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="next"/);
    if (match) return match[1];
  }
  return null;
}

async function fetchAllMembers(url, token) {
  const members = [];
  let next = url;
  while (next) {
    const res = await fetch(next, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.ims.lti-nrps.v2.membershipcontainer+json' },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`NRPS request failed (${res.status}): ${text.slice(0, 300)}`);
    }
    const json = await res.json();
    members.push(...(json.members || []));
    next = parseNextLink(res.headers.get('link'));
  }
  return members;
}

/**
 * Syncs the roster for a SimuLearn course that was provisioned from an LTI
 * context. Each active member is provisioned/linked exactly like a real
 * launch would (see lti-provisioning.service.js), then enrolled.
 */
exports.syncRoster = async (courseId, actor) => {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  if (!actor.roles?.includes('super_admin') && course.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Course not found.');
  }

  const ltiContext = await LtiIdentityModel.findContextBySimuLearnCourseId(courseId);
  if (!ltiContext?.nrps_context_memberships_url) {
    throw ApiError.badRequest('Roster sync is not available for this course — the LMS did not provide NRPS access.');
  }

  const platform = await LtiPlatformModel.findById(ltiContext.platform_id);
  const token = await getPlatformAccessToken(platform, [NRPS_SCOPE]);
  const members = await fetchAllMembers(ltiContext.nrps_context_memberships_url, token);

  let studentsSynced = 0;
  let instructorsSynced = 0;

  for (const member of members) {
    if (member.status && member.status !== 'Active') continue;
    const roles = member.roles || [];
    const name = member.name || `${member.given_name || ''} ${member.family_name || ''}`.trim() || undefined;

    const user = await provisioningSvc.ensureInternalUser({
      issuer: ltiContext.issuer, sub: member.user_id, name, email: member.email,
      institutionId: course.institution_id, roles,
    });

    const role = provisioningSvc.mapLtiRole(roles);
    if (role === 'instructor' || role === 'teaching_assistant') instructorsSynced += 1; else studentsSynced += 1;

    await provisioningSvc.ensureEnrollment({ courseId, userId: user.id, role });
  }

  await LtiIdentityModel.touchNrpsSynced(ltiContext.id);

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'lti_nrps.roster_synced', entityType: 'Course', entityId: courseId,
    delta: { after: { totalMembers: members.length, studentsSynced, instructorsSynced } },
  });

  return {
    totalMembers: members.length, studentsSynced, instructorsSynced,
    syncedAt: new Date().toISOString(),
  };
};
