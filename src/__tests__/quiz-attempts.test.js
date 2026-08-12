'use strict';

/**
 * Quiz attempts — backend unit tests (read/list scaffolding + attempt-taking lifecycle).
 * Run: npx jest src/__tests__/quiz-attempts.test.js
 */

jest.mock('../config/database', () => ({
  pool: { query: jest.fn().mockResolvedValue({ rows: [] }) },
}));

jest.mock('../db/models', () => ({
  QuizModel: { findById: jest.fn() },
  QuizQuestionModel: {
    OPTION_BASED_TYPES: ['single_choice', 'multiple_choice', 'true_false'],
    listByQuiz: jest.fn(),
    listOptions: jest.fn(),
  },
  QuizAttemptModel: {
    findById: jest.fn(),
    listByQuiz: jest.fn(),
    listByQuizAndUser: jest.fn(),
    listResponses: jest.fn(),
    findInProgress: jest.fn(),
    countByQuizAndUser: jest.fn(),
    listGradedByQuizAndUser: jest.fn(),
    create: jest.fn(),
    submit: jest.fn(),
    upsertResponse: jest.fn(),
    updateResponseScore: jest.fn(),
  },
  CourseModel: { findById: jest.fn(), findEnrollment: jest.fn() },
  AuditModel: { log: jest.fn().mockResolvedValue({}) },
  GradeModel: { createGradeItem: jest.fn(), upsertGrade: jest.fn() },
}));

const svc = require('../modules/quiz-attempts/quiz-attempts.service');
const {
  QuizModel, QuizQuestionModel, QuizAttemptModel, CourseModel,
} = require('../db/models');
const { pool } = require('../config/database');
const { GradeModel } = require('../db/models');

const INSTITUTION_ID = 'inst-1111';
const COURSE_ID = 'course-aaaa';
const QUIZ_ID = 'quiz-bbbb';
const ATTEMPT_ID = 'attempt-cccc';
const STUDENT_ID = 'student-0001';

const mockCourse = { id: COURSE_ID, institution_id: INSTITUTION_ID };
const mockQuiz = {
  id: QUIZ_ID, course_id: COURSE_ID, institution_id: INSTITUTION_ID, department_id: null, lesson_id: null,
  status: 'published', available_from: null, available_until: null, max_attempts: 3,
  show_score_policy: 'immediately', show_answers_policy: 'immediately',
  passing_percentage: null, passing_score: null, attempt_scoring_mode: 'latest',
  title: 'Quiz', points_possible: 10, due_at: null,
};
const mockAttempt = {
  id: ATTEMPT_ID, quiz_id: QUIZ_ID, course_id: COURSE_ID, user_id: STUDENT_ID,
  status: 'graded', final_score: '8.00', points_possible: '10.00', started_at: new Date().toISOString(),
};

const instructorActor = {
  id: 'instructor-0001', email: 'instructor@test.com', institutionId: INSTITUTION_ID,
  roles: ['instructor'], permissions: ['quiz_attempts.view_course'],
};
const studentActor = {
  id: STUDENT_ID, email: 'student@test.com', institutionId: INSTITUTION_ID,
  roles: ['student'], permissions: ['quiz_attempts.view_own'],
};
const otherStudentActor = {
  id: 'student-9999', email: 'other@test.com', institutionId: INSTITUTION_ID,
  roles: ['student'], permissions: ['quiz_attempts.view_own'],
};

beforeEach(() => {
  jest.clearAllMocks();
  CourseModel.findById.mockResolvedValue(mockCourse);
  CourseModel.findEnrollment.mockResolvedValue({ status: 'active' });
  QuizModel.findById.mockResolvedValue(mockQuiz);
  QuizQuestionModel.listByQuiz.mockResolvedValue([]);
  QuizQuestionModel.listOptions.mockResolvedValue([]);
  QuizAttemptModel.findById.mockResolvedValue(mockAttempt);
  QuizAttemptModel.listByQuiz.mockResolvedValue([mockAttempt]);
  QuizAttemptModel.listByQuizAndUser.mockResolvedValue([mockAttempt]);
  QuizAttemptModel.listResponses.mockResolvedValue([]);
  QuizAttemptModel.countByQuizAndUser.mockResolvedValue(1);
  QuizAttemptModel.findInProgress.mockResolvedValue(null);
  pool.query.mockResolvedValue({ rows: [] });
});

describe('quiz-attempts.service — listAttempts()', () => {
  test('instructor sees all attempts for a quiz in their course', async () => {
    const result = await svc.listAttempts(COURSE_ID, QUIZ_ID, instructorActor);
    expect(result).toHaveLength(1);
  });

  test('a student cannot list all attempts', async () => {
    await expect(
      svc.listAttempts(COURSE_ID, QUIZ_ID, studentActor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('quiz-attempts.service — getAttempt()', () => {
  test('owner student can view their own attempt', async () => {
    const result = await svc.getAttempt(COURSE_ID, QUIZ_ID, ATTEMPT_ID, studentActor);
    expect(result.id).toBe(ATTEMPT_ID);
  });

  test('a different student cannot view another student\'s attempt', async () => {
    await expect(
      svc.getAttempt(COURSE_ID, QUIZ_ID, ATTEMPT_ID, otherStudentActor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  test('instructor can view any attempt in their course', async () => {
    await expect(svc.getAttempt(COURSE_ID, QUIZ_ID, ATTEMPT_ID, instructorActor)).resolves.toBeDefined();
  });

  test('score is hidden when show_score_policy is never', async () => {
    QuizModel.findById.mockResolvedValue({ ...mockQuiz, show_score_policy: 'never' });
    const result = await svc.getAttempt(COURSE_ID, QUIZ_ID, ATTEMPT_ID, studentActor);
    expect(result.finalScore).toBeNull();
  });
});

describe('quiz-attempts.service — startAttempt()', () => {
  test('student can start a fresh attempt', async () => {
    QuizQuestionModel.listByQuiz.mockResolvedValue([{ id: 'q1', points: 5 }, { id: 'q2', points: 5 }]);
    QuizAttemptModel.countByQuizAndUser.mockResolvedValue(0);
    QuizAttemptModel.create.mockResolvedValue({ ...mockAttempt, status: 'in_progress', attempt_number: 1 });
    const result = await svc.startAttempt(COURSE_ID, QUIZ_ID, studentActor);
    expect(QuizAttemptModel.create).toHaveBeenCalledWith(expect.objectContaining({ pointsPossible: 10, attemptNumber: 1 }));
    expect(result.status).toBe('in_progress');
  });

  test('resumes an existing in_progress attempt instead of creating a new one', async () => {
    QuizAttemptModel.findInProgress.mockResolvedValue({ ...mockAttempt, status: 'in_progress' });
    const result = await svc.startAttempt(COURSE_ID, QUIZ_ID, studentActor);
    expect(QuizAttemptModel.create).not.toHaveBeenCalled();
    expect(result.status).toBe('in_progress');
  });

  test('unpublished quiz cannot be started', async () => {
    QuizModel.findById.mockResolvedValue({ ...mockQuiz, status: 'draft' });
    await expect(svc.startAttempt(COURSE_ID, QUIZ_ID, studentActor)).rejects.toMatchObject({ statusCode: 400 });
  });

  test('unenrolled student cannot start an attempt', async () => {
    CourseModel.findEnrollment.mockResolvedValue(null);
    await expect(svc.startAttempt(COURSE_ID, QUIZ_ID, studentActor)).rejects.toMatchObject({ statusCode: 403 });
  });

  test('max attempts exhausted blocks a new attempt', async () => {
    QuizAttemptModel.countByQuizAndUser.mockResolvedValue(3);
    QuizQuestionModel.listByQuiz.mockResolvedValue([{ id: 'q1', points: 10 }]);
    await expect(svc.startAttempt(COURSE_ID, QUIZ_ID, studentActor)).rejects.toMatchObject({ statusCode: 400 });
  });
});

describe('quiz-attempts.service — saveResponses()', () => {
  test('owner can save responses while in_progress', async () => {
    QuizAttemptModel.findById.mockResolvedValue({ ...mockAttempt, status: 'in_progress' });
    QuizQuestionModel.listByQuiz.mockResolvedValue([{ id: 'q1' }]);
    await svc.saveResponses(COURSE_ID, ATTEMPT_ID, [{ questionId: 'q1', responsePayload: { text: 'x' } }], studentActor);
    expect(QuizAttemptModel.upsertResponse).toHaveBeenCalledWith(expect.objectContaining({ attemptId: ATTEMPT_ID, questionId: 'q1' }));
  });

  test('cannot save responses for an already-submitted attempt', async () => {
    QuizAttemptModel.findById.mockResolvedValue({ ...mockAttempt, status: 'graded' });
    await expect(
      svc.saveResponses(COURSE_ID, ATTEMPT_ID, [{ questionId: 'q1', responsePayload: {} }], studentActor),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  test('non-owner cannot save responses', async () => {
    QuizAttemptModel.findById.mockResolvedValue({ ...mockAttempt, status: 'in_progress', user_id: 'someone-else' });
    await expect(
      svc.saveResponses(COURSE_ID, ATTEMPT_ID, [{ questionId: 'q1', responsePayload: {} }], studentActor),
    ).rejects.toMatchObject({ statusCode: 403 });
  });
});

describe('quiz-attempts.service — submitAttempt()', () => {
  test('fully auto-gradable attempt submits as graded', async () => {
    QuizAttemptModel.findById.mockResolvedValue({ ...mockAttempt, status: 'in_progress', points_possible: '10.00' });
    QuizQuestionModel.listByQuiz.mockResolvedValue([
      { id: 'q1', question_type: 'single_choice', points: 10, manual_grading: false, question_data: {} },
    ]);
    QuizQuestionModel.listOptions.mockResolvedValue([{ id: 'o1', is_correct: true }]);
    QuizAttemptModel.listResponses.mockResolvedValue([
      { id: 'r1', question_id: 'q1', response_payload: { selectedOptionId: 'o1' } },
    ]);
    QuizAttemptModel.submit.mockResolvedValue({ ...mockAttempt, status: 'graded', final_score: '10.00', percentage: '100.00' });
    QuizAttemptModel.listGradedByQuizAndUser.mockResolvedValue([{ ...mockAttempt, status: 'graded', final_score: '10.00' }]);
    GradeModel.createGradeItem.mockResolvedValue({ id: 'grade-item-1' });

    const result = await svc.submitAttempt(COURSE_ID, ATTEMPT_ID, studentActor);
    expect(QuizAttemptModel.submit).toHaveBeenCalledWith(ATTEMPT_ID, expect.objectContaining({ status: 'graded' }));
    expect(result.status).toBe('graded');
  });

  test('a question requiring manual grading marks the attempt pending_manual_grading', async () => {
    QuizAttemptModel.findById.mockResolvedValue({ ...mockAttempt, status: 'in_progress' });
    QuizQuestionModel.listByQuiz.mockResolvedValue([
      { id: 'q1', question_type: 'long_text', points: 10, manual_grading: false, question_data: {} },
    ]);
    QuizAttemptModel.listResponses.mockResolvedValue([
      { id: 'r1', question_id: 'q1', response_payload: { text: 'answer' } },
    ]);
    QuizAttemptModel.submit.mockResolvedValue({ ...mockAttempt, status: 'pending_manual_grading', final_score: null });

    const result = await svc.submitAttempt(COURSE_ID, ATTEMPT_ID, studentActor);
    expect(QuizAttemptModel.submit).toHaveBeenCalledWith(ATTEMPT_ID, expect.objectContaining({ status: 'pending_manual_grading', finalScore: null }));
    expect(result.status).toBe('pending_manual_grading');
  });

  test('cannot submit an already-submitted attempt', async () => {
    QuizAttemptModel.findById.mockResolvedValue({ ...mockAttempt, status: 'graded' });
    await expect(svc.submitAttempt(COURSE_ID, ATTEMPT_ID, studentActor)).rejects.toMatchObject({ statusCode: 400 });
  });
});
