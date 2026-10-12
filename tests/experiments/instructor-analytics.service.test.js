'use strict';

/**
 * Tests the instructor dashboard's access control and batching: no
 * per-student query loop regardless of roster size, and a student actor
 * (not the course instructor) is rejected.
 */

jest.mock('../../src/db/models', () => ({
  CourseModel: { findById: jest.fn(), listEnrollments: jest.fn(), enrollmentCount: jest.fn() },
  SimulationModel: { findById: jest.fn() },
  LmsExperimentAttemptModel: { listForExperiment: jest.fn(), aggregateForExperiment: jest.fn() },
  LmsStepStateModel: { findByAttempts: jest.fn(), aggregateForExperiment: jest.fn() },
  LmsAnswerSubmissionModel: { findByAttempts: jest.fn(), aggregateResultsForExperiment: jest.fn() },
  LmsRawEventModel: { countByAttempts: jest.fn() },
  LmsRegisteredReleaseModel: { findLatestForProject: jest.fn() },
  LmsAssessmentDefinitionModel: { findByProjectAndVersion: jest.fn() },
}));

const {
  CourseModel, SimulationModel, LmsExperimentAttemptModel, LmsStepStateModel,
  LmsAnswerSubmissionModel, LmsRawEventModel, LmsRegisteredReleaseModel, LmsAssessmentDefinitionModel,
} = require('../../src/db/models');
const { getExperimentDashboard } = require('../../src/modules/experiments/instructor-analytics.service');

const COURSE = { id: 'course-1', institution_id: 'inst-1', instructor_id: 'instructor-1' };
const SIM = { id: 'sim-1', build_uuid: 'project-uuid-1' };
const INSTRUCTOR = { id: 'instructor-1', institutionId: 'inst-1', roles: ['instructor'] };
const STUDENT = { id: 'student-1', institutionId: 'inst-1', roles: ['student'] };

function makeEnrollments(n) {
  return Array.from({ length: n }, (_, i) => ({
    user_id: `student-${i}`, first_name: 'A', last_name: `${i}`, email: `s${i}@x.com`, status: 'active',
  }));
}

describe('instructor-analytics.service — getExperimentDashboard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    CourseModel.findById.mockResolvedValue(COURSE);
    SimulationModel.findById.mockResolvedValue(SIM);
    LmsRegisteredReleaseModel.findLatestForProject.mockResolvedValue({
      assessment_version: '1.0.0',
      manifest: { experiments: [{ experimentId: 'EXP01', title: 'Calibration' }] },
    });
    LmsAssessmentDefinitionModel.findByProjectAndVersion.mockResolvedValue({
      required_items: { EXP01: { requiredSteps: [1, 2], requiredQuestions: ['EXP01_Q01'] } },
    });
    LmsExperimentAttemptModel.listForExperiment.mockResolvedValue([]);
    LmsExperimentAttemptModel.aggregateForExperiment.mockResolvedValue({
      attemptCount: 0, completedCount: 0, studentCount: 0, medianDurationSeconds: null,
    });
    LmsStepStateModel.findByAttempts.mockResolvedValue([]);
    LmsStepStateModel.aggregateForExperiment.mockResolvedValue([]);
    LmsAnswerSubmissionModel.findByAttempts.mockResolvedValue([]);
    LmsAnswerSubmissionModel.aggregateResultsForExperiment.mockResolvedValue({ correct: 0, incorrect: 0 });
    LmsRawEventModel.countByAttempts.mockResolvedValue(0);
  });

  test('rejects a student actor (not the course instructor) with 403', async () => {
    CourseModel.listEnrollments.mockResolvedValue(makeEnrollments(1));
    CourseModel.enrollmentCount.mockResolvedValue(1);

    await expect(getExperimentDashboard('course-1', 'sim-1', null, {}, STUDENT))
      .rejects.toMatchObject({ statusCode: 403 });
  });

  test('rejects a cross-institution instructor with 404 (not 403, to avoid enumeration)', async () => {
    CourseModel.findById.mockResolvedValue({ ...COURSE, institution_id: 'other-inst' });

    await expect(getExperimentDashboard('course-1', 'sim-1', null, {}, INSTRUCTOR))
      .rejects.toMatchObject({ statusCode: 404 });
  });

  test('batches: one call each to listForExperiment/findByAttempts/findByAttempts regardless of roster size, never a per-student loop', async () => {
    const roster = makeEnrollments(25);
    CourseModel.listEnrollments.mockResolvedValue(roster);
    CourseModel.enrollmentCount.mockResolvedValue(25);
    LmsExperimentAttemptModel.listForExperiment.mockResolvedValue(
      roster.map((e, i) => ({
        experiment_attempt_id: `attempt-${i}`, learner_id: e.user_id, status: 'completed',
        started_at: '2026-01-01T00:00:00Z', ended_at: '2026-01-01T00:05:00Z',
      })),
    );

    const result = await getExperimentDashboard('course-1', 'sim-1', 'EXP01', {}, INSTRUCTOR);

    expect(LmsExperimentAttemptModel.listForExperiment).toHaveBeenCalledTimes(1);
    expect(LmsStepStateModel.findByAttempts).toHaveBeenCalledTimes(1);
    expect(LmsAnswerSubmissionModel.findByAttempts).toHaveBeenCalledTimes(1);
    expect(LmsStepStateModel.findByAttempts).toHaveBeenCalledWith(roster.map((_, i) => `attempt-${i}`));
    expect(result.students).toHaveLength(25);
    expect(result.students[0].attempts).toHaveLength(1);
  });

  test('falls back to the first known experiment when none is requested, and reports an empty shape when the roster is empty', async () => {
    CourseModel.listEnrollments.mockResolvedValue([]);
    CourseModel.enrollmentCount.mockResolvedValue(0);

    const result = await getExperimentDashboard('course-1', 'sim-1', null, {}, INSTRUCTOR);

    expect(result.selectedExperimentId).toBe('EXP01');
    expect(result.students).toEqual([]);
    expect(result.overview.stepPercentage).toBeNull();
    expect(LmsExperimentAttemptModel.listForExperiment).not.toHaveBeenCalled();
  });

  test('a simulation with no build_uuid is rejected as having no structured tracking', async () => {
    SimulationModel.findById.mockResolvedValue({ id: 'sim-1', build_uuid: null });
    CourseModel.listEnrollments.mockResolvedValue(makeEnrollments(1));
    CourseModel.enrollmentCount.mockResolvedValue(1);

    await expect(getExperimentDashboard('course-1', 'sim-1', null, {}, INSTRUCTOR))
      .rejects.toMatchObject({ statusCode: 400 });
  });
});
