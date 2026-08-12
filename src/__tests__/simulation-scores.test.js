'use strict';

/**
 * Simulation scores — backend unit tests (Phase 1: CRUD + manual instructor entry).
 * Run: npx jest src/__tests__/simulation-scores.test.js
 */

jest.mock('../db/models', () => ({
  SimulationScoreModel: {
    findById: jest.fn(),
    listByCourse: jest.fn(),
    listByUser: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
  },
  SimulationModel: {
    findById: jest.fn(),
  },
  CourseModel: {
    findById: jest.fn(),
    findEnrollment: jest.fn(),
  },
  AuditModel: { log: jest.fn().mockResolvedValue({}) },
}));

const svc = require('../modules/simulation-scores/simulation-scores.service');
const { SimulationScoreModel, SimulationModel, CourseModel } = require('../db/models');

const INSTITUTION_ID = 'inst-1111';
const COURSE_ID = 'course-aaaa';
const SIM_ID = 'sim-dddd';
const SCORE_ID = 'score-eeee';
const STUDENT_ID = 'student-0001';

const mockCourse = { id: COURSE_ID, institution_id: INSTITUTION_ID, department_id: 'dept-1', instructor_id: 'instructor-0001' };
const mockSim = { id: SIM_ID, max_score: '100.00' };
const mockScore = {
  id: SCORE_ID, course_id: COURSE_ID, user_id: STUDENT_ID, simulation_id: SIM_ID,
  score_source: 'instructor', raw_score: '82.00', points_possible: '100.00', percentage: '82.00',
  status: 'graded',
};

const instructorActor = {
  id: 'instructor-0001', email: 'instructor@test.com', institutionId: INSTITUTION_ID,
  roles: ['instructor'], permissions: ['simulation_scores.manage', 'simulation_scores.view_course'],
};
const studentActor = {
  id: STUDENT_ID, email: 'student@test.com', institutionId: INSTITUTION_ID,
  roles: ['student'], permissions: ['simulation_scores.view_own'],
};
const otherStudentActor = {
  id: 'student-9999', email: 'other@test.com', institutionId: INSTITUTION_ID,
  roles: ['student'], permissions: ['simulation_scores.view_own'],
};

beforeEach(() => {
  jest.clearAllMocks();
  CourseModel.findById.mockResolvedValue(mockCourse);
  CourseModel.findEnrollment.mockResolvedValue({ status: 'active' });
  SimulationModel.findById.mockResolvedValue(mockSim);
  SimulationScoreModel.create.mockResolvedValue(mockScore);
  SimulationScoreModel.findById.mockResolvedValue(mockScore);
  SimulationScoreModel.update.mockResolvedValue({ ...mockScore, status: 'overridden' });
});

describe('simulation-scores.service — createManualScore()', () => {
  test('instructor manual simulation grade works', async () => {
    const result = await svc.createManualScore(COURSE_ID, {
      simulationId: SIM_ID, userId: STUDENT_ID, rawScore: 82, pointsPossible: 100,
    }, instructorActor);
    expect(SimulationScoreModel.create).toHaveBeenCalledWith(expect.objectContaining({
      scoreSource: 'instructor', rawScore: 82, status: 'graded',
    }));
    expect(result.percentage).toBe(82);
  });

  test('unauthorized simulation score submission is blocked (missing permission)', async () => {
    await expect(
      svc.createManualScore(COURSE_ID, { simulationId: SIM_ID, userId: STUDENT_ID, rawScore: 82 }, studentActor),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(SimulationScoreModel.create).not.toHaveBeenCalled();
  });

  test('score for a non-enrolled student is rejected', async () => {
    CourseModel.findEnrollment.mockResolvedValue(null);
    await expect(
      svc.createManualScore(COURSE_ID, { simulationId: SIM_ID, userId: STUDENT_ID, rawScore: 82 }, instructorActor),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('cross-institution access is blocked with 404', async () => {
    const foreignActor = { ...instructorActor, institutionId: 'other-institution' };
    await expect(
      svc.createManualScore(COURSE_ID, { simulationId: SIM_ID, userId: STUDENT_ID, rawScore: 82 }, foreignActor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('simulation-scores.service — getById()', () => {
  test('owner student can view their own score', async () => {
    const result = await svc.getById(COURSE_ID, SCORE_ID, studentActor);
    expect(result.id).toBe(SCORE_ID);
  });

  test('a different student cannot view another student\'s score', async () => {
    await expect(
      svc.getById(COURSE_ID, SCORE_ID, otherStudentActor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('instructor can view any score in their course', async () => {
    await expect(svc.getById(COURSE_ID, SCORE_ID, instructorActor)).resolves.toBeDefined();
  });
});

describe('simulation-scores.service — updateScore() (grade / override)', () => {
  test('grade override preserves original score in audit delta', async () => {
    const { AuditModel } = require('../db/models');
    await svc.updateScore(COURSE_ID, SCORE_ID, { rawScore: 90, overrideReason: 'Re-graded per rubric' }, instructorActor);
    expect(AuditModel.log).toHaveBeenCalledWith(expect.objectContaining({
      action: 'simulation_score.override',
      delta: expect.objectContaining({ before: { rawScore: '82.00', status: 'graded' } }),
    }));
  });
});
