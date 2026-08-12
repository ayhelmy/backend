'use strict';

/**
 * Grade categories — backend unit tests (weighted gradebook grouping).
 * Run: npx jest src/__tests__/grade-categories.test.js
 */

jest.mock('../db/models', () => ({
  GradeCategoryModel: {
    findById: jest.fn(),
    listByCourse: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    sumWeights: jest.fn(),
  },
  CourseModel: {
    findById: jest.fn(),
  },
  AuditModel: { log: jest.fn().mockResolvedValue({}) },
}));

const svc = require('../modules/grade-categories/grade-categories.service');
const { GradeCategoryModel, CourseModel } = require('../db/models');

const INSTITUTION_ID = 'inst-1111';
const COURSE_ID = 'course-aaaa';

const mockCourse = { id: COURSE_ID, institution_id: INSTITUTION_ID, instructor_id: 'instructor-0001' };

const instructorActor = {
  id: 'instructor-0001', email: 'instructor@test.com', institutionId: INSTITUTION_ID,
  roles: ['instructor'], permissions: ['grade_categories.manage', 'grade_categories.view'],
};
const otherInstructorActor = {
  id: 'instructor-9999', email: 'other@test.com', institutionId: INSTITUTION_ID,
  roles: ['instructor'], permissions: ['grade_categories.manage'],
};

beforeEach(() => {
  jest.clearAllMocks();
  CourseModel.findById.mockResolvedValue(mockCourse);
  GradeCategoryModel.listByCourse.mockResolvedValue([]);
});

describe('grade-categories.service — createCategory()', () => {
  test('instructor creates a category in their own course', async () => {
    GradeCategoryModel.create.mockResolvedValue({ id: 'cat-1', course_id: COURSE_ID, name: 'Quizzes', weight: '0.3000', position: 0 });
    const result = await svc.createCategory(COURSE_ID, { name: 'Quizzes', weight: 0.3 }, instructorActor);
    expect(result.weight).toBe(0.3);
  });

  test('unauthorized instructor cannot create a category in another course', async () => {
    await expect(
      svc.createCategory(COURSE_ID, { name: 'Quizzes', weight: 0.3 }, otherInstructorActor),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(GradeCategoryModel.create).not.toHaveBeenCalled();
  });
});

describe('grade-categories.service — validateWeights()', () => {
  test('weights summing to 100% (1.0 fraction) are valid', async () => {
    GradeCategoryModel.sumWeights.mockResolvedValue(1.0);
    const result = await svc.validateWeights(COURSE_ID, instructorActor);
    expect(result.valid).toBe(true);
    expect(result.totalPercentage).toBe(100);
  });

  test('weights not summing to 100% are invalid', async () => {
    GradeCategoryModel.sumWeights.mockResolvedValue(1.1);
    const result = await svc.validateWeights(COURSE_ID, instructorActor);
    expect(result.valid).toBe(false);
    expect(result.totalPercentage).toBe(110);
  });

  test('cross-institution access is blocked with 404', async () => {
    const foreignActor = { ...instructorActor, institutionId: 'other-institution' };
    await expect(
      svc.validateWeights(COURSE_ID, foreignActor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
