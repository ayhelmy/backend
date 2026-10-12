'use strict';

/**
 * Instructor-facing dashboard over the experiments tracking pipeline for one
 * course + simulation: course-wide step-funnel/timing charts and KPI tiles,
 * plus a page of full per-student attempt detail — modeled directly on the
 * FM103 standalone harness's own dashboard (templates/dashboard.html +
 * static/dashboard.js), scoped to one selected experiment at a time. This
 * fully replaces the click/region heatmap view for this page; that backend
 * (simulation-activity module) is untouched and still usable elsewhere.
 *
 * Access rules mirror simulation-activity/activity.service.js's
 * canViewCourseActivity/assertRead exactly: instructor who owns the course,
 * dept_manager, institution_admin, super_admin.
 */

const {
  CourseModel, SimulationModel,
  LmsExperimentAttemptModel: AttemptModel, LmsStepStateModel, LmsAnswerSubmissionModel,
  LmsRawEventModel, LmsRegisteredReleaseModel, LmsAssessmentDefinitionModel,
} = require('../../db/models');
const { parsePagination, buildPaginationMeta } = require('../../utils/pagination');
const ApiError = require('../../utils/apiError');
const progressService = require('./progress.service');

// ── RBAC helpers (copied verbatim from simulation-activity/activity.service.js) ─

function isSuperAdmin(actor) {
  return actor?.roles?.includes('super_admin');
}

function isInstitutionAdmin(actor) {
  return actor?.roles?.includes('institution_admin');
}

function isDeptManager(actor) {
  return actor?.roles?.includes('dept_manager');
}

function isInstructor(actor) {
  return actor?.roles?.includes('instructor') || actor?.roles?.includes('teaching_assistant');
}

function canViewCourseActivity(course, actor) {
  if (isSuperAdmin(actor)) return true;
  if (isInstitutionAdmin(actor) && course.institution_id === actor.institutionId) return true;
  if (isDeptManager(actor) && course.institution_id === actor.institutionId) return true;
  if (isInstructor(actor) && course.instructor_id === actor.id &&
      course.institution_id === actor.institutionId) return true;
  return false;
}

function assertRead(course, actor) {
  if (isSuperAdmin(actor)) return;
  if (course.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Course not found.');
  }
}

async function assertCourseAccess(courseId, actor) {
  const course = await CourseModel.findById(courseId);
  if (!course) throw ApiError.notFound('Course not found.');
  assertRead(course, actor);
  if (!canViewCourseActivity(course, actor)) throw ApiError.forbidden('Access denied.');
  return course;
}

/** The simulation's build_uuid doubles as the generic tracking projectId (see play page). */
async function resolveProjectId(simulationId) {
  const sim = await SimulationModel.findById(simulationId);
  if (!sim) throw ApiError.notFound('Simulation not found.');
  if (!sim.build_uuid) {
    throw ApiError.badRequest('This simulation has no structured experiment tracking (not a WebGL build).');
  }
  return sim.build_uuid;
}

/**
 * { experiments: [{experimentId, title}], itemsByExperiment: { [experimentId]: required_items entry } }
 * Titles come from whichever registered release has a manifest; required
 * items (requiredSteps/requiredQuestions) come from the assessment
 * definition. A manually-curated project with no stored manifest (FM103,
 * migration 065) still resolves experiments from required_items alone.
 */
async function resolveTrackingContext(projectId) {
  const release = await LmsRegisteredReleaseModel.findLatestForProject(projectId);
  const experiments = (release?.manifest?.experiments ?? [])
    .map((e) => ({ experimentId: e.experimentId, title: e.title ?? null }));

  let itemsByExperiment = {};
  if (release?.assessment_version) {
    const assessmentDef = await LmsAssessmentDefinitionModel.findByProjectAndVersion(projectId, release.assessment_version);
    itemsByExperiment = assessmentDef?.required_items ?? {};
  }
  for (const experimentId of Object.keys(itemsByExperiment)) {
    if (!experiments.some((e) => e.experimentId === experimentId)) {
      experiments.push({ experimentId, title: null });
    }
  }
  return { experiments, itemsByExperiment };
}

async function getExperimentDashboard(courseId, simulationId, experimentId, { page, limit } = {}, actor) {
  await assertCourseAccess(courseId, actor);
  const projectId = await resolveProjectId(simulationId);
  const { experiments, itemsByExperiment } = await resolveTrackingContext(projectId);
  const selectedExperimentId = experimentId || experiments[0]?.experimentId || null;

  const { page: p, limit: l, offset } = parsePagination({ page, limit });
  const [enrollments, total] = await Promise.all([
    CourseModel.listEnrollments(courseId, { role: 'student', status: 'active', limit: l, offset }),
    CourseModel.enrollmentCount(courseId),
  ]);
  const learnerIds = enrollments.map((e) => e.user_id);
  const baseStudents = enrollments.map((e) => ({
    studentId: e.user_id,
    name: `${e.first_name} ${e.last_name}`.trim(),
    email: e.email,
  }));

  const emptyOverview = {
    attemptCount: 0, completedCount: 0, studentCount: 0, correct: 0, incorrect: 0,
    medianDurationSeconds: null, eventCount: 0, stepPercentage: null,
  };

  if (!selectedExperimentId || learnerIds.length === 0) {
    return {
      projectId, experiments, selectedExperimentId,
      overview: emptyOverview, funnel: [], timing: [],
      students: baseStudents.map((s) => ({ ...s, attempts: [] })),
      meta: buildPaginationMeta(total, p, l),
    };
  }

  const items = itemsByExperiment[selectedExperimentId] ?? {};
  const requiredSteps = items.requiredSteps ?? [];
  const requiredQuestions = items.requiredQuestions ?? [];

  const [attempts, aggAttempt, aggSteps, aggAnswers] = await Promise.all([
    AttemptModel.listForExperiment(projectId, selectedExperimentId, learnerIds),
    AttemptModel.aggregateForExperiment(projectId, selectedExperimentId, learnerIds),
    LmsStepStateModel.aggregateForExperiment(projectId, selectedExperimentId, learnerIds),
    LmsAnswerSubmissionModel.aggregateResultsForExperiment(projectId, selectedExperimentId, learnerIds),
  ]);

  const attemptIds = attempts.map((a) => a.experiment_attempt_id);
  const [stepStates, submissions, eventCount] = await Promise.all([
    LmsStepStateModel.findByAttempts(attemptIds),
    LmsAnswerSubmissionModel.findByAttempts(attemptIds),
    LmsRawEventModel.countByAttempts(attemptIds),
  ]);

  const stepStatesByAttempt = new Map();
  for (const s of stepStates) {
    if (!stepStatesByAttempt.has(s.experiment_attempt_id)) stepStatesByAttempt.set(s.experiment_attempt_id, []);
    stepStatesByAttempt.get(s.experiment_attempt_id).push(s);
  }
  const submissionsByAttempt = new Map();
  for (const s of submissions) {
    if (!submissionsByAttempt.has(s.experiment_attempt_id)) submissionsByAttempt.set(s.experiment_attempt_id, []);
    submissionsByAttempt.get(s.experiment_attempt_id).push(s);
  }
  const attemptsByLearner = new Map();
  for (const a of attempts) {
    if (!attemptsByLearner.has(a.learner_id)) attemptsByLearner.set(a.learner_id, []);
    attemptsByLearner.get(a.learner_id).push(a);
  }

  // Overall step completion % (KPI tile): sum each attempt's own
  // numerator/denominator (progress.service's existing formula) across every
  // attempt, then one percentage — same approach as the FM103 harness's
  // aggregate() function.
  let stepNumeratorSum = 0;
  let stepDenominatorSum = 0;

  const students = baseStudents.map((student) => {
    const studentAttempts = attemptsByLearner.get(student.studentId) ?? [];
    return {
      ...student,
      attempts: studentAttempts.map((a) => {
        const rows = stepStatesByAttempt.get(a.experiment_attempt_id) ?? [];
        const stepProgress = progressService.computeStepProgress(rows, requiredSteps);
        stepNumeratorSum += stepProgress.numerator;
        stepDenominatorSum += stepProgress.denominator;

        const subs = submissionsByAttempt.get(a.experiment_attempt_id) ?? [];
        const durationSeconds = a.started_at && a.ended_at
          ? (new Date(a.ended_at) - new Date(a.started_at)) / 1000
          : null;

        return {
          experimentAttemptId: a.experiment_attempt_id,
          status: a.status,
          startedAt: a.started_at,
          endedAt: a.ended_at,
          durationSeconds,
          steps: progressService.buildStepRows(rows, requiredSteps),
          questions: progressService.computeQuestionResults(subs, requiredQuestions),
          correctAnswers: subs.filter((s) => s.result === 'correct').length,
          wrongAnswers: subs.filter((s) => s.result === 'incorrect').length,
        };
      }),
    };
  });

  const stepPercentage = stepDenominatorSum
    ? Math.round((stepNumeratorSum / stepDenominatorSum) * 1000) / 10
    : null;

  const funnel = aggSteps.map((s) => ({
    stepNumber: s.stepNumber,
    required: requiredSteps.includes(s.stepNumber),
    reachedCount: s.reachedCount,
    completedCount: s.completedCount,
  }));
  const timing = aggSteps
    .filter((s) => s.avgDurationSeconds != null)
    .map((s) => ({ stepNumber: s.stepNumber, avgDurationSeconds: s.avgDurationSeconds, sampleCount: s.sampleCount }));

  return {
    projectId,
    experiments,
    selectedExperimentId,
    overview: {
      attemptCount: aggAttempt.attemptCount,
      completedCount: aggAttempt.completedCount,
      studentCount: aggAttempt.studentCount,
      correct: aggAnswers.correct,
      incorrect: aggAnswers.incorrect,
      medianDurationSeconds: aggAttempt.medianDurationSeconds,
      eventCount,
      stepPercentage,
    },
    funnel,
    timing,
    students,
    meta: buildPaginationMeta(total, p, l),
  };
}

module.exports = { getExperimentDashboard };
