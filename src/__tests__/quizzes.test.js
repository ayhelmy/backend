'use strict';

/**
 * Quizzes — backend unit tests (Phase 1: authoring CRUD + questions).
 * Strategy: mock all DB models so tests are fast and deterministic.
 * Run: npx jest src/__tests__/quizzes.test.js
 */

jest.mock('../db/models', () => ({
  QuizModel: {
    findById: jest.fn(),
    findByLessonId: jest.fn(),
    listByCourse: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  },
  QuizQuestionModel: {
    OPTION_BASED_TYPES: ['single_choice', 'multiple_choice', 'true_false'],
    findById: jest.fn(),
    listByQuiz: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
    reorder: jest.fn(),
    listOptions: jest.fn(),
    replaceOptions: jest.fn(),
  },
  ModuleModel: {
    findLessonById: jest.fn(),
    updateLesson: jest.fn(),
  },
  CourseModel: {
    findById: jest.fn(),
  },
  AuditModel: { log: jest.fn().mockResolvedValue({}) },
}));

const svc = require('../modules/quizzes/quizzes.service');
const { QuizModel, QuizQuestionModel, ModuleModel, CourseModel } = require('../db/models');

const INSTITUTION_ID = 'inst-1111';
const COURSE_ID = 'course-aaaa';
const QUIZ_ID = 'quiz-bbbb';
const INSTRUCTOR_ID = 'instructor-0001';

const mockCourse = {
  id: COURSE_ID, institution_id: INSTITUTION_ID, department_id: 'dept-1', instructor_id: INSTRUCTOR_ID,
};

const mockQuiz = {
  id: QUIZ_ID, course_id: COURSE_ID, module_id: null, lesson_id: null,
  title: 'Quiz 1', status: 'draft', points_possible: '100.00',
  attempt_scoring_mode: 'latest', show_score_policy: 'immediately',
  show_answers_policy: 'after_final_attempt', grade_release_mode: 'automatic',
  max_attempts: 1, shuffle_questions: false, shuffle_answers: false,
  one_question_at_a_time: false, allow_back_navigation: true,
  institution_id: INSTITUTION_ID, created_by: INSTRUCTOR_ID,
  created_at: new Date().toISOString(),
};

const instructorActor = {
  id: INSTRUCTOR_ID, email: 'instructor@test.com', institutionId: INSTITUTION_ID,
  roles: ['instructor'], permissions: ['quizzes.create', 'quizzes.update', 'quizzes.delete', 'quizzes.publish'],
};

const otherInstructorActor = {
  id: 'instructor-9999', email: 'other@test.com', institutionId: INSTITUTION_ID,
  roles: ['instructor'], permissions: ['quizzes.create', 'quizzes.update'],
};

beforeEach(() => {
  jest.clearAllMocks();
  CourseModel.findById.mockResolvedValue(mockCourse);
  QuizModel.findById.mockResolvedValue(mockQuiz);
  QuizModel.findByLessonId.mockResolvedValue(null);
  QuizModel.create.mockResolvedValue(mockQuiz);
  QuizModel.update.mockResolvedValue(mockQuiz);
  QuizQuestionModel.listByQuiz.mockResolvedValue([]);
});

describe('quizzes.service — createQuiz()', () => {
  test('instructor creates a quiz in their own course', async () => {
    const result = await svc.createQuiz(COURSE_ID, { title: 'Quiz 1' }, instructorActor);
    expect(QuizModel.create).toHaveBeenCalledWith(expect.objectContaining({
      courseId: COURSE_ID, title: 'Quiz 1', status: 'draft', createdBy: INSTRUCTOR_ID,
    }));
    expect(result.status).toBe('draft');
  });

  test('instructor cannot create a quiz in a course they do not own', async () => {
    await expect(
      svc.createQuiz(COURSE_ID, { title: 'Quiz 1' }, otherInstructorActor),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(QuizModel.create).not.toHaveBeenCalled();
  });

  test('cross-institution access is blocked with 404', async () => {
    const foreignActor = { ...instructorActor, institutionId: 'other-institution' };
    await expect(
      svc.createQuiz(COURSE_ID, { title: 'Quiz 1' }, foreignActor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  test('attaching a quiz to a lesson that already has one is rejected', async () => {
    ModuleModel.findLessonById.mockResolvedValue({ id: 'lesson-1', course_id: COURSE_ID, module_id: 'mod-1' });
    QuizModel.findByLessonId.mockResolvedValue({ id: 'other-quiz' });
    await expect(
      svc.createQuiz(COURSE_ID, { title: 'Quiz 1', lessonId: 'lesson-1' }, instructorActor),
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe('quizzes.service — updateQuiz()', () => {
  test('unauthorized instructor cannot edit another course quiz', async () => {
    await expect(
      svc.updateQuiz(COURSE_ID, QUIZ_ID, { title: 'Hacked' }, otherInstructorActor),
    ).rejects.toMatchObject({ statusCode: 403 });
    expect(QuizModel.update).not.toHaveBeenCalled();
  });

  test('quiz not belonging to the given course is not found', async () => {
    QuizModel.findById.mockResolvedValue({ ...mockQuiz, course_id: 'different-course' });
    await expect(
      svc.updateQuiz(COURSE_ID, QUIZ_ID, { title: 'X' }, instructorActor),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});

describe('quizzes.service — publishQuiz()', () => {
  test('publishing a quiz with no questions is rejected', async () => {
    QuizQuestionModel.listByQuiz.mockResolvedValue([]);
    await expect(
      svc.publishQuiz(COURSE_ID, QUIZ_ID, instructorActor),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(QuizModel.update).not.toHaveBeenCalled();
  });

  test('publishing a quiz with at least one question succeeds', async () => {
    QuizQuestionModel.listByQuiz.mockResolvedValue([{ id: 'q1' }]);
    QuizModel.update.mockResolvedValue({ ...mockQuiz, status: 'published' });
    const result = await svc.publishQuiz(COURSE_ID, QUIZ_ID, instructorActor);
    expect(QuizModel.update).toHaveBeenCalledWith(QUIZ_ID, { status: 'published' });
    expect(result.status).toBe('published');
  });
});

describe('quizzes.service — createQuestion() type split', () => {
  test('single_choice question requires at least one option', async () => {
    await expect(
      svc.createQuestion(COURSE_ID, QUIZ_ID, { questionType: 'single_choice', prompt: 'Q?', options: [] }, instructorActor),
    ).rejects.toMatchObject({ statusCode: 400 });
    expect(QuizQuestionModel.create).not.toHaveBeenCalled();
  });

  test('single_choice question creates row + replaces options', async () => {
    const createdQuestion = { id: 'q1', quiz_id: QUIZ_ID, question_type: 'single_choice', points: '1.00', position: 0 };
    QuizQuestionModel.create.mockResolvedValue(createdQuestion);
    QuizQuestionModel.replaceOptions.mockResolvedValue([
      { id: 'o1', option_identifier: 'a', content: '3', is_correct: false, position: 0 },
      { id: 'o2', option_identifier: 'b', content: '4', is_correct: true, position: 1 },
    ]);

    const result = await svc.createQuestion(COURSE_ID, QUIZ_ID, {
      questionType: 'single_choice', prompt: 'What is 2+2?',
      options: [
        { optionIdentifier: 'a', content: '3', isCorrect: false },
        { optionIdentifier: 'b', content: '4', isCorrect: true },
      ],
    }, instructorActor);

    expect(QuizQuestionModel.replaceOptions).toHaveBeenCalled();
    expect(result.options).toHaveLength(2);
  });

  test('matching question stores questionData and does not require options', async () => {
    const createdQuestion = {
      id: 'q2', quiz_id: QUIZ_ID, question_type: 'matching', points: '1.00', position: 0,
      question_data: { pairs: [{ left: 'A', right: '1' }] },
    };
    QuizQuestionModel.create.mockResolvedValue(createdQuestion);

    const result = await svc.createQuestion(COURSE_ID, QUIZ_ID, {
      questionType: 'matching', prompt: 'Match these',
      questionData: { pairs: [{ left: 'A', right: '1' }] },
    }, instructorActor);

    expect(QuizQuestionModel.replaceOptions).not.toHaveBeenCalled();
    expect(result.options).toHaveLength(0);
    expect(result.questionData.pairs).toHaveLength(1);
  });
});
