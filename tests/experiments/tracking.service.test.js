'use strict';

/**
 * Tests the auto-registration trigger condition in tracking.service.js's
 * processEvent: it must only ever call ensureRegistered for a SessionStarted
 * event on an unregistered project, and must reject (without ever calling
 * ensureRegistered) any other event type arriving first for one — the event
 * contract guarantees SessionStarted always fires first for a given build.
 */

jest.mock('../../src/config/database', () => ({ pool: { connect: jest.fn() } }));
jest.mock('../../src/db/models', () => ({
  LmsAssessmentDefinitionModel: { findByProjectAndVersion: jest.fn() },
  LmsRegisteredReleaseModel: { findByProjectAndVersion: jest.fn() },
  LmsRawEventModel: { insertIfAbsent: jest.fn() },
  LmsLearnerSessionModel: { createIfAbsent: jest.fn(), markCompleted: jest.fn() },
  LmsExperimentAttemptModel: { createIfAbsent: jest.fn(), markStatus: jest.fn() },
  LmsStepStateModel: { markStarted: jest.fn(), markCompleted: jest.fn(), findByAttempt: jest.fn() },
  LmsAnswerSubmissionModel: { upsertAnswered: jest.fn(), upsertResult: jest.fn() },
  LmsSavedResultModel: { insertIfAbsent: jest.fn() },
}));
jest.mock('../../src/modules/experiments/release-registration.service', () => ({
  ensureRegistered: jest.fn(),
}));

const { pool } = require('../../src/config/database');
const { LmsAssessmentDefinitionModel, LmsRegisteredReleaseModel, LmsRawEventModel } = require('../../src/db/models');
const releaseRegistrationService = require('../../src/modules/experiments/release-registration.service');
const { processEvent } = require('../../src/modules/experiments/tracking.service');

const ACTOR = { id: 'learner-1', institutionId: 'inst-1' };
const UUID_A = '509154cd-f58c-4f75-8074-7f08987451f2';
const UUID_B = 'd508b28e-4c7d-43a1-880a-d32442447a4d';

describe('tracking.service — auto-registration trigger', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
    LmsRawEventModel.insertIfAbsent.mockResolvedValue(true);
  });

  test('rejects a non-SessionStarted event on an unregistered project without calling ensureRegistered', async () => {
    LmsAssessmentDefinitionModel.findByProjectAndVersion.mockResolvedValue(null);

    await expect(processEvent({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B,
      projectId: 'BRAND-NEW', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      eventType: 'ExperimentStarted', experimentId: 'EXP01',
    }, ACTOR)).rejects.toThrow(/SessionStarted/);

    expect(releaseRegistrationService.ensureRegistered).not.toHaveBeenCalled();
  });

  test('calls ensureRegistered for a SessionStarted event on an unregistered project, with its projectManifest', async () => {
    LmsAssessmentDefinitionModel.findByProjectAndVersion.mockResolvedValue(null);
    const manifest = { projectId: 'BRAND-NEW', assessmentVersion: '1.0.0', experiments: [] };
    const assessmentDef = {
      project_id: 'BRAND-NEW', assessment_version: '1.0.0', legacy_step_map: {}, required_items: {}, grading_rules: {},
    };
    releaseRegistrationService.ensureRegistered.mockResolvedValue({
      assessmentDef,
      release: { assessment_version: '1.0.0' },
    });

    const result = await processEvent({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B,
      projectId: 'BRAND-NEW', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      eventType: 'SessionStarted', projectManifest: manifest,
    }, ACTOR);

    expect(releaseRegistrationService.ensureRegistered).toHaveBeenCalledWith(expect.objectContaining({
      projectId: 'BRAND-NEW', projectVersion: '1.0.0', assessmentVersion: '1.0.0', manifest,
    }));
    expect(result).toEqual({ eventId: UUID_A, status: 'stored' });
  });

  test('never calls ensureRegistered when both rows are already registered (FM103 regression check)', async () => {
    LmsAssessmentDefinitionModel.findByProjectAndVersion.mockResolvedValue({
      project_id: 'FM103', assessment_version: '1.0.0', legacy_step_map: {}, required_items: { EXP01: {
        requiredSteps: [1], trackedSteps: [1], catalogStepCount: 14, requiredQuestions: [], allQuestions: [],
      } }, grading_rules: {},
    });
    LmsRegisteredReleaseModel.findByProjectAndVersion.mockResolvedValue({ assessment_version: '1.0.0' });

    await processEvent({
      schemaVersion: '2.1', eventId: UUID_A, sessionId: UUID_B, experimentAttemptId: UUID_B,
      projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      experimentId: 'EXP01', eventType: 'StepStarted', stepNumber: 1,
    }, ACTOR);

    expect(releaseRegistrationService.ensureRegistered).not.toHaveBeenCalled();
  });
});
