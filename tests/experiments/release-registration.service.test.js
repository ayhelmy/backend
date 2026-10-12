'use strict';

/**
 * Tests for the generic auto-registration path that replaces migration 065's
 * hand-seeding for any simulation other than FM103. `deriveRequiredItemsFromManifest`
 * is checked against the REAL projectManifest captured from the shipped FM103
 * Bernoulli build ("Build 008", 2026-09-17..20) — it must reproduce migration
 * 065's hand-seeded required_items exactly, proving the derivation logic is
 * correct against real data, not just a synthetic fixture.
 */

jest.mock('../../src/config/database', () => ({ pool: { connect: jest.fn() } }));
jest.mock('../../src/db/models', () => ({
  LmsAssessmentDefinitionModel: { findByProjectAndVersion: jest.fn(), createAuto: jest.fn() },
  LmsRegisteredReleaseModel: { findByProjectAndVersion: jest.fn(), createAuto: jest.fn() },
}));

const { pool } = require('../../src/config/database');
const { LmsAssessmentDefinitionModel, LmsRegisteredReleaseModel } = require('../../src/db/models');
const {
  deriveRequiredItemsFromManifest, ensureRegistered,
} = require('../../src/modules/experiments/release-registration.service');

// The real projectManifest captured from FM103 Build 008's SessionStarted event.
const FM103_MANIFEST = {
  schemaVersion: '2.1', projectId: 'FM103', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
  experiments: [
    {
      experimentId: 'EXP01', title: 'Calibration Process',
      steps: [
        ...Array.from({ length: 10 }, (_, i) => ({ stepNumber: i + 1, tracked: true, requiredForCompletion: true })),
        ...Array.from({ length: 4 }, (_, i) => ({ stepNumber: i + 11, tracked: false, requiredForCompletion: false })),
      ],
      questions: [{ questionId: 'EXP01_Q01', questionType: 'MultipleChoice', requiredForCompletion: true }],
    },
    {
      experimentId: 'EXP02', title: 'Venturi Effect on the Pressure Head',
      steps: [
        ...Array.from({ length: 4 }, (_, i) => ({ stepNumber: i + 1, tracked: true, requiredForCompletion: true })),
        ...Array.from({ length: 6 }, (_, i) => ({ stepNumber: i + 5, tracked: true, requiredForCompletion: false })),
        { stepNumber: 11, tracked: true, requiredForCompletion: true },
        ...Array.from({ length: 4 }, (_, i) => ({ stepNumber: i + 12, tracked: false, requiredForCompletion: false })),
      ],
      questions: [
        { questionId: 'EXP02_Q01', questionType: 'MultipleChoice', requiredForCompletion: false },
        { questionId: 'EXP02_Q02', questionType: 'TrueFalse', requiredForCompletion: true },
        { questionId: 'EXP02_Q03', questionType: 'TrueFalse', requiredForCompletion: true },
      ],
    },
    {
      experimentId: 'EXP03', title: 'Measured Flow Velocity',
      steps: [
        ...Array.from({ length: 4 }, (_, i) => ({ stepNumber: i + 1, tracked: true, requiredForCompletion: true })),
        ...Array.from({ length: 6 }, (_, i) => ({ stepNumber: i + 5, tracked: true, requiredForCompletion: false })),
        { stepNumber: 11, tracked: true, requiredForCompletion: true },
        { stepNumber: 12, tracked: true, requiredForCompletion: true },
        ...Array.from({ length: 4 }, (_, i) => ({ stepNumber: i + 13, tracked: false, requiredForCompletion: false })),
      ],
      questions: [
        { questionId: 'EXP03_Q01', questionType: 'MultipleChoice', requiredForCompletion: false },
        { questionId: 'EXP03_Q02', questionType: 'TrueFalse', requiredForCompletion: true },
        { questionId: 'EXP03_Q03', questionType: 'MultipleChoice', requiredForCompletion: true },
      ],
    },
    {
      experimentId: 'EXP04', title: 'Determination of Flow Rate Factor',
      steps: [
        ...Array.from({ length: 3 }, (_, i) => ({ stepNumber: i + 1, tracked: true, requiredForCompletion: true })),
        ...Array.from({ length: 7 }, (_, i) => ({ stepNumber: i + 4, tracked: true, requiredForCompletion: false })),
        { stepNumber: 11, tracked: true, requiredForCompletion: true },
        ...Array.from({ length: 4 }, (_, i) => ({ stepNumber: i + 12, tracked: false, requiredForCompletion: false })),
      ],
      questions: [
        { questionId: 'EXP04_Q01', questionType: 'MultipleChoice', requiredForCompletion: false },
        { questionId: 'EXP04_Q02', questionType: 'MultipleChoice', requiredForCompletion: true },
        { questionId: 'EXP04_Q03', questionType: 'TrueFalse', requiredForCompletion: true },
      ],
    },
  ],
};

describe('release-registration.service — deriveRequiredItemsFromManifest', () => {
  test('reproduces migration 065\'s hand-seeded required_items exactly, from the real FM103 manifest', () => {
    const { requiredItems, questionTypes } = deriveRequiredItemsFromManifest(FM103_MANIFEST);

    expect(requiredItems.EXP01).toEqual({
      requiredSteps: [1,2,3,4,5,6,7,8,9,10],
      trackedSteps:  [1,2,3,4,5,6,7,8,9,10],
      catalogStepCount: 14,
      requiredQuestions: ['EXP01_Q01'],
      allQuestions:      ['EXP01_Q01'],
    });
    expect(requiredItems.EXP02).toEqual({
      requiredSteps: [1,2,3,4,11],
      trackedSteps:  [1,2,3,4,5,6,7,8,9,10,11],
      catalogStepCount: 15,
      requiredQuestions: ['EXP02_Q02','EXP02_Q03'],
      allQuestions:      ['EXP02_Q01','EXP02_Q02','EXP02_Q03'],
    });
    expect(requiredItems.EXP03).toEqual({
      requiredSteps: [1,2,3,4,11,12],
      trackedSteps:  [1,2,3,4,5,6,7,8,9,10,11,12],
      catalogStepCount: 16,
      requiredQuestions: ['EXP03_Q02','EXP03_Q03'],
      allQuestions:      ['EXP03_Q01','EXP03_Q02','EXP03_Q03'],
    });
    expect(requiredItems.EXP04).toEqual({
      requiredSteps: [1,2,3,11],
      trackedSteps:  [1,2,3,4,5,6,7,8,9,10,11],
      catalogStepCount: 15,
      requiredQuestions: ['EXP04_Q02','EXP04_Q03'],
      allQuestions:      ['EXP04_Q01','EXP04_Q02','EXP04_Q03'],
    });

    expect(questionTypes).toEqual({
      EXP01_Q01: 'MultipleChoice',
      EXP02_Q01: 'MultipleChoice', EXP02_Q02: 'TrueFalse', EXP02_Q03: 'TrueFalse',
      EXP03_Q01: 'MultipleChoice', EXP03_Q02: 'TrueFalse', EXP03_Q03: 'MultipleChoice',
      EXP04_Q01: 'MultipleChoice', EXP04_Q02: 'MultipleChoice', EXP04_Q03: 'TrueFalse',
    });
  });

  test('an empty/missing manifest yields no experiments', () => {
    expect(deriveRequiredItemsFromManifest(null)).toEqual({ requiredItems: {}, questionTypes: {} });
    expect(deriveRequiredItemsFromManifest({})).toEqual({ requiredItems: {}, questionTypes: {} });
  });
});

describe('release-registration.service — ensureRegistered', () => {
  let client;

  beforeEach(() => {
    jest.clearAllMocks();
    client = { query: jest.fn().mockResolvedValue({}), release: jest.fn() };
    pool.connect.mockResolvedValue(client);
  });

  test('brand-new project: auto-creates both the assessment definition and the release', async () => {
    LmsAssessmentDefinitionModel.findByProjectAndVersion.mockResolvedValue(null);
    LmsAssessmentDefinitionModel.createAuto.mockResolvedValue({ assessment_version: '1.0.0', source: 'auto' });
    LmsRegisteredReleaseModel.findByProjectAndVersion.mockResolvedValue(null);
    LmsRegisteredReleaseModel.createAuto.mockResolvedValue({ source: 'auto' });

    const result = await ensureRegistered({
      projectId: 'NEWSIM', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      manifest: { projectId: 'NEWSIM', assessmentVersion: '1.0.0', experiments: [] },
      existingAssessmentDef: null,
    });

    expect(LmsAssessmentDefinitionModel.createAuto).toHaveBeenCalledTimes(1);
    expect(LmsRegisteredReleaseModel.createAuto).toHaveBeenCalledTimes(1);
    expect(result.assessmentDef.source).toBe('auto');
    expect(result.release.source).toBe('auto');
    expect(client.query).toHaveBeenCalledWith('COMMIT');
  });

  test('known assessmentVersion (manually curated), new projectVersion: only the release is auto-created', async () => {
    const manualDef = { assessment_version: '1.0.0', source: 'manual' };
    LmsRegisteredReleaseModel.findByProjectAndVersion.mockResolvedValue(null);
    LmsRegisteredReleaseModel.createAuto.mockResolvedValue({ source: 'auto' });

    const result = await ensureRegistered({
      projectId: 'FM103', projectVersion: '2.0.0', assessmentVersion: '1.0.0',
      manifest: { projectId: 'FM103', assessmentVersion: '1.0.0', experiments: [] },
      existingAssessmentDef: manualDef,
    });

    expect(LmsAssessmentDefinitionModel.createAuto).not.toHaveBeenCalled();
    expect(LmsRegisteredReleaseModel.createAuto).toHaveBeenCalledTimes(1);
    expect(result.assessmentDef).toBe(manualDef);
  });

  test('no manifest and nothing registered: rejects instead of silently registering an empty definition', async () => {
    LmsAssessmentDefinitionModel.findByProjectAndVersion.mockResolvedValue(null);

    await expect(ensureRegistered({
      projectId: 'NEWSIM', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      manifest: null, existingAssessmentDef: null,
    })).rejects.toThrow(/no projectManifest/);

    expect(LmsAssessmentDefinitionModel.createAuto).not.toHaveBeenCalled();
    expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  });

  test('manifest whose own projectId/assessmentVersion disagree with the request is rejected', async () => {
    LmsAssessmentDefinitionModel.findByProjectAndVersion.mockResolvedValue(null);

    await expect(ensureRegistered({
      projectId: 'NEWSIM', projectVersion: '1.0.0', assessmentVersion: '1.0.0',
      manifest: { projectId: 'OTHER', assessmentVersion: '1.0.0', experiments: [] },
      existingAssessmentDef: null,
    })).rejects.toThrow(/does not match/);

    expect(LmsAssessmentDefinitionModel.createAuto).not.toHaveBeenCalled();
  });
});
