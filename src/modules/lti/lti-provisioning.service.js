/**
 * LTI user/course/lesson/enrollment provisioning — shared by Deep Linking
 * (instructor), real resource-link launch (student/instructor), and NRPS
 * roster sync. Auto-provisions a real SimuLearn course + lesson shadowing
 * the LMS context/resource-link so the EXISTING simulation_activity_sessions
 * tracking, gradebook, and dashboards can be reused as-is (see plan
 * addendum "Key architectural decision: course/lesson auto-provisioning").
 */
'use strict';

const crypto = require('crypto');
const {
  UserModel, RoleModel, CourseModel, ModuleModel, LtiIdentityModel, AuditModel,
  SimulationModel, SimulationCatalogModel,
} = require('../../db/models');
const { CLAIMS, deriveUserKey, deriveContextKey, deriveResourceLinkKey } = require('./lti-claims.mapper');
const { LtiError, LTI_ERROR_CODES } = require('./lti-errors');

// LTI membership role URIs -> internal role name. Unknown/Administrator
// deliberately falls back to 'student' — never auto-escalate privilege from
// an externally-controlled (LMS-issued) claim.
const LTI_ROLE_MAP = {
  'http://purl.imsglobal.org/vocab/lis/v2/membership#Instructor': 'instructor',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#TeachingAssistant': 'teaching_assistant',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#ContentDeveloper': 'instructor',
  'http://purl.imsglobal.org/vocab/lis/v2/membership#Learner': 'student',
};

function mapLtiRole(roles = []) {
  for (const uri of roles) {
    if (LTI_ROLE_MAP[uri]) return LTI_ROLE_MAP[uri];
  }
  return 'student';
}

/** Instructor-like roles are allowed to run Deep Linking / trigger course provisioning. */
function isInstructorLikeLaunch(roles = []) {
  return roles.some((r) => /Instructor|TeachingAssistant|ContentDeveloper|Administrator/.test(r));
}

function synthesizeEmail(identityKey) {
  const hash = crypto.createHash('sha256').update(identityKey).digest('hex').slice(0, 20);
  return `lti+${hash}@lti.simulearn.local`;
}

/**
 * Finds or creates the internal SimuLearn user for an LTI launch's (issuer, sub).
 * If the platform shares an email that already matches an existing account in
 * the same institution, links to it rather than creating a duplicate.
 */
async function ensureInternalUser({ issuer, sub, name, email, institutionId, roles }) {
  const identityKey = deriveUserKey(issuer, sub);
  const ltiUser = await LtiIdentityModel.findUserByKey(identityKey);

  if (ltiUser?.simulearn_user_id) {
    const user = await UserModel.findById(ltiUser.simulearn_user_id);
    if (user) return user;
    // Linked user was deleted — fall through and re-provision.
  }

  let user = null;
  if (email) {
    const existing = await UserModel.findByEmailWithHash(email.toLowerCase());
    if (existing && existing.institution_id === institutionId) user = existing;
  }

  if (!user) {
    const [firstName, ...rest] = (name || 'LMS User').trim().split(/\s+/);
    user = await UserModel.create({
      email: email ? email.toLowerCase() : synthesizeEmail(identityKey),
      passwordHash: null, // SSO-only account — never logs in with a password
      firstName: firstName || 'LMS',
      lastName: rest.join(' ') || 'User',
      institutionId,
      status: 'active', // provisioned via a trusted LTI launch — no email verification needed
    });

    const roleName = mapLtiRole(roles);
    await RoleModel.assignRole(user.id, roleName, institutionId, null);

    await AuditModel.log({
      institutionId,
      actorId: null, actorEmail: `lti-user:${identityKey}`,
      action: 'lti.user_provisioned', entityType: 'User', entityId: user.id,
      delta: { after: { email: user.email, role: roleName } },
    });
  }

  await LtiIdentityModel.linkUser(identityKey, user.id);
  return user;
}

/**
 * Finds or creates the SimuLearn course shadowing an LMS context. Only
 * called from the Deep Linking flow (instructor-initiated) — a resource-link
 * launch for a context with no course yet is rejected (see launch-validation).
 */
async function ensureCourseForContext({ issuer, context, institutionId, instructorUserId }) {
  const identityKey = deriveContextKey(issuer, context.id);
  const ltiContext = await LtiIdentityModel.findContextByKey(identityKey);

  if (ltiContext?.simulearn_course_id) {
    const course = await CourseModel.findById(ltiContext.simulearn_course_id);
    if (course) return course;
  }

  const title = context.title || context.label || 'LMS Course';
  const course = await CourseModel.create({
    institutionId,
    instructorId: instructorUserId,
    createdBy: instructorUserId,
    // Deliberately NOT context.label: courses.code is UNIQUE per institution,
    // but LMS context labels (e.g. "CS101") are not guaranteed unique across
    // different LMS courses/platforms at the same institution.
    code: null,
    title,
    description: `Auto-provisioned from LMS course "${title}" via LTI.`,
    enrollmentType: 'open',
  });
  await CourseModel.update(course.id, { status: 'published', published_at: new Date() });

  await LtiIdentityModel.linkContext(identityKey, course.id);

  await AuditModel.log({
    institutionId,
    actorId: instructorUserId, actorEmail: `lti-context:${identityKey}`,
    action: 'lti.course_provisioned', entityType: 'Course', entityId: course.id,
    delta: { after: { title } },
  });

  return course;
}

/** One shared module per auto-provisioned course holds all its LMS-linked lessons. */
async function ensureLtiModule(courseId) {
  const modules = await ModuleModel.listByCourse(courseId);
  const existing = modules.find((m) => m.title === 'LMS Activities');
  if (existing) return existing;
  return ModuleModel.create({ courseId, title: 'LMS Activities', description: 'Activities added from your LMS.', position: modules.length, isPublished: true });
}

/**
 * Finds or creates the lesson shadowing an LMS resource link. Persists the
 * Deep-Linking-configured grading settings (custom params) + AGS lineitem
 * URL onto lti_resource_links so ags.service.js can read them later.
 */
async function ensureLessonForResourceLink({ issuer, context, resourceLink, courseId, simulationId, agsEndpoint, gradingConfig }) {
  const identityKey = deriveResourceLinkKey(issuer, context?.id, resourceLink.id);
  const existing = await LtiIdentityModel.findResourceLinkByKey(identityKey);

  let lessonId = existing?.simulearn_lesson_id ?? null;

  if (!lessonId) {
    const mod = await ensureLtiModule(courseId);
    const lesson = await ModuleModel.createLesson({
      moduleId: mod.id,
      title: resourceLink.title || 'Simulation Activity',
      type: 'text',
      lessonMode: 'simulation',
      simulationId,
      courseId,
      isRequired: true,
      isPublished: true, // required for students — see activity.service.js's is_published gate
    });
    lessonId = lesson.id;
  }

  const updated = await LtiIdentityModel.linkResourceLink(identityKey, {
    simulearnLessonId: lessonId,
    simulationId,
    lineitemUrl: agsEndpoint?.lineitem ?? null,
    lineitemsUrl: agsEndpoint?.lineitems ?? null,
    maxScore: gradingConfig?.maxScore,
    customParams: gradingConfig?.customParams,
    gradingMode: gradingConfig?.gradingMode,
    attemptPolicy: gradingConfig?.attemptPolicy,
    durationLimit: gradingConfig?.durationLimit,
  });

  return { lessonId, resourceLinkRow: updated };
}

async function ensureEnrollment({ courseId, userId, role }) {
  const enrollRole = role === 'instructor' || role === 'teaching_assistant' ? 'ta' : 'student';
  // Course.instructor_id is the actual instructor of record — don't also enroll them.
  const course = await CourseModel.findById(courseId);
  if (course?.instructor_id === userId) return null;
  return CourseModel.enroll({ courseId, userId, role: enrollRole, status: 'active' });
}

/**
 * Full resolution pipeline for a validated LtiResourceLinkRequest launch:
 * course must already be provisioned (via Deep Linking), the simulation must
 * be active and assigned to the launching institution's catalog (re-checked
 * on every launch — never trusted from custom params alone, per spec §3),
 * then the internal user/lesson/enrollment are ensured.
 */
async function resolveResourceLinkLaunch({ claims, platform }) {
  const context = claims[CLAIMS.CONTEXT] || {};
  const resourceLink = claims[CLAIMS.RESOURCE_LINK] || {};
  const custom = claims[CLAIMS.CUSTOM] || {};

  if (!context.id) {
    throw new LtiError(LTI_ERROR_CODES.CONTEXT_NOT_PROVISIONED);
  }
  const contextKey = deriveContextKey(claims.iss, context.id);
  const ltiContext = await LtiIdentityModel.findContextByKey(contextKey);
  if (!ltiContext?.simulearn_course_id) {
    throw new LtiError(LTI_ERROR_CODES.CONTEXT_NOT_PROVISIONED);
  }
  const courseId = ltiContext.simulearn_course_id;

  const rlKey = deriveResourceLinkKey(claims.iss, context.id, resourceLink.id);
  const existingResourceLink = await LtiIdentityModel.findResourceLinkByKey(rlKey);
  const simulationId = custom.simulation_id || existingResourceLink?.simulation_id;
  if (!simulationId) {
    throw new LtiError(LTI_ERROR_CODES.CLAIM_VALIDATION_FAILED, 'Missing custom.simulation_id — this activity was not fully configured via Deep Linking.');
  }

  const sim = await SimulationModel.findById(simulationId);
  if (!sim || sim.status !== 'active') {
    throw new LtiError(LTI_ERROR_CODES.SIMULATION_NOT_FOUND);
  }
  const assigned = await SimulationCatalogModel.isSimulationAssignedToInstitution(simulationId, platform.institution_id);
  if (!assigned) {
    throw new LtiError(LTI_ERROR_CODES.SIMULATION_NOT_ASSIGNED);
  }

  const roles = claims[CLAIMS.ROLES] || [];
  const user = await ensureInternalUser({
    issuer: claims.iss, sub: claims.sub, name: claims.name, email: claims.email,
    institutionId: platform.institution_id, roles,
  });

  const role = mapLtiRole(roles);
  await ensureEnrollment({ courseId, userId: user.id, role });

  const { lessonId } = await ensureLessonForResourceLink({
    issuer: claims.iss, context, resourceLink, courseId, simulationId,
    agsEndpoint: claims[CLAIMS.AGS_ENDPOINT],
    gradingConfig: {
      maxScore: custom.max_score ? Number(custom.max_score) : undefined,
      customParams: custom,
      gradingMode: custom.grading_mode,
      attemptPolicy: custom.attempt_policy,
      durationLimit: custom.duration_limit ? Number(custom.duration_limit) : undefined,
    },
  });

  return { user, courseId, lessonId, simulationId };
}

module.exports = {
  mapLtiRole,
  isInstructorLikeLaunch,
  ensureInternalUser,
  ensureCourseForContext,
  ensureLessonForResourceLink,
  ensureEnrollment,
  resolveResourceLinkLaunch,
};
