'use strict';

/**
 * Live-DB verification for the quiz attempt-taking lifecycle (start/save/
 * submit/auto-grade/grade-sync). Exercises the real services directly
 * (bypassing HTTP) against the REAL dev database, using real seeded fixture
 * rows (same course/institution/instructor as verify-qti-import.js). Cleans
 * up everything it creates in a finally block.
 *
 * Run: node scripts/verify-quiz-attempts.js
 */

require('../src/config');
const { pool } = require('../src/config/database');
const quizzesSvc = require('../src/modules/quizzes/quizzes.service');
const attemptsSvc = require('../src/modules/quiz-attempts/quiz-attempts.service');

const COURSE_ID = '93ad0781-8d59-4410-8532-69480d9af576'; // "Test" course, Cairo University
const INSTRUCTOR_ID = '11bdc65a-c608-499a-acbc-9c269d05e207'; // instructor@cairo-university.edu
const CAIRO_INSTITUTION = '492a2970-f6d4-48c1-affd-0073fdaad19c';
const STUDENT_ID = '1b38d72c-1a37-4c6f-ae66-ad73e3f2d881'; // student1, enrolled active in COURSE_ID

const instructorActor = {
  id: INSTRUCTOR_ID, email: 'instructor@cairo-university.edu', institutionId: CAIRO_INSTITUTION,
  roles: ['instructor'],
  permissions: [
    'quizzes.create', 'quizzes.update', 'quizzes.delete', 'quizzes.publish', 'quizzes.view_course',
    'quiz_attempts.view_course', 'quiz_attempts.manage',
  ],
};
const studentActor = {
  id: STUDENT_ID, email: 'student1@cairo-university.edu', institutionId: CAIRO_INSTITUTION,
  roles: ['student'], permissions: ['quizzes.view_own', 'quiz_attempts.view_own'],
};

let failures = 0;
function ok(desc) { console.log(`  PASS  ${desc}`); }
function fail(desc, err) { failures++; console.log(`  FAIL  ${desc}`); if (err) console.log('        ', err.message || err); }
async function expectThrow(promise, desc, statusCode) {
  try {
    await promise;
    fail(desc, new Error('expected to throw but resolved'));
  } catch (e) {
    if (statusCode == null || e.statusCode === statusCode) ok(desc);
    else fail(desc, new Error(`expected statusCode=${statusCode}, got ${e.statusCode}: ${e.message}`));
  }
}

const createdQuizIds = [];

async function main() {
  console.log('=== Setup: quiz with single_choice, numeric_tolerance, matching ===');

  const quiz = await quizzesSvc.createQuiz(COURSE_ID, { title: 'Attempt Verify Quiz', maxAttempts: 1 }, instructorActor);
  createdQuizIds.push(quiz.id);

  await quizzesSvc.createQuestion(COURSE_ID, quiz.id, {
    questionType: 'single_choice', prompt: '2+2?', points: 2,
    options: [
      { optionIdentifier: 'a', content: '3', isCorrect: false },
      { optionIdentifier: 'b', content: '4', isCorrect: true },
    ],
  }, instructorActor);

  await quizzesSvc.createQuestion(COURSE_ID, quiz.id, {
    questionType: 'numeric_tolerance', prompt: 'Value of pi (2dp)?', points: 3,
    questionData: { correctValue: 3.14, tolerance: 0.02, toleranceMode: 'absolute' },
  }, instructorActor);

  await quizzesSvc.createQuestion(COURSE_ID, quiz.id, {
    questionType: 'matching', prompt: 'Match capitals', points: 4,
    questionData: {
      sourceChoices: [{ id: 's1', text: 'France' }, { id: 's2', text: 'Japan' }],
      targetChoices: [{ id: 't1', text: 'Paris' }, { id: 't2', text: 'Tokyo' }],
      pairs: [{ source: { id: 's1' }, target: { id: 't1' } }, { source: { id: 's2' }, target: { id: 't2' } }],
    },
  }, instructorActor);

  await quizzesSvc.publishQuiz(COURSE_ID, quiz.id, instructorActor);
  ok('quiz created with 3 questions and published');

  console.log('=== Answer-leakage check ===');
  const studentQuestions = await quizzesSvc.listQuestions(COURSE_ID, quiz.id, studentActor);
  const leaked = studentQuestions.some((q) =>
    q.options.some((o) => 'isCorrect' in o) ||
    (q.questionData && ('correctValue' in q.questionData || 'pairs' in q.questionData)));
  leaked ? fail('student-visible questions leak correct-answer data') : ok('student-visible questions contain no correct-answer data');

  console.log('=== Start / resume ===');
  const attempt1 = await attemptsSvc.startAttempt(COURSE_ID, quiz.id, studentActor);
  (attempt1.status === 'in_progress' && attempt1.attemptNumber === 1) ? ok('attempt started, status=in_progress, attemptNumber=1') : fail('unexpected start result', new Error(JSON.stringify(attempt1)));

  const attempt1b = await attemptsSvc.startAttempt(COURSE_ID, quiz.id, studentActor);
  attempt1b.id === attempt1.id ? ok('second startAttempt resumes the same row (no duplicate)') : fail('expected resume, got a different attempt id');

  console.log('=== Save responses (1 correct, 1 correct-within-tolerance, 1 partial) ===');
  const questions = await quizzesSvc.listQuestions(COURSE_ID, quiz.id, instructorActor); // instructor view has real ids
  const scq = questions.find((q) => q.questionType === 'single_choice');
  const numq = questions.find((q) => q.questionType === 'numeric_tolerance');
  const matq = questions.find((q) => q.questionType === 'matching');
  const correctOptionId = scq.options.find((o) => o.isCorrect).id;

  await attemptsSvc.saveResponses(COURSE_ID, attempt1.id, [
    { questionId: scq.id, responsePayload: { selectedOptionId: correctOptionId } },
    { questionId: numq.id, responsePayload: { value: 3.145 } }, // within 0.02 tolerance -> correct
    { questionId: matq.id, responsePayload: { matches: [{ sourceId: 's1', targetId: 't1' }] } }, // 1 of 2 correct -> partial
  ], studentActor);
  ok('responses saved');

  console.log('=== Submit + auto-grade ===');
  const submitted = await attemptsSvc.submitAttempt(COURSE_ID, attempt1.id, studentActor);
  // expected: scq 2/2 + numq 3/3 + matq (1/2 * 4 = 2) = 7 / 9 points = 77.78%
  const expectedFinal = 7;
  const expectedPercentage = Math.round((7 / 9) * 10000) / 100;
  (submitted.status === 'graded' && submitted.finalScore === expectedFinal)
    ? ok(`submitted & auto-graded: finalScore=${submitted.finalScore} (expected ${expectedFinal})`)
    : fail('unexpected grading result', new Error(JSON.stringify({ status: submitted.status, finalScore: submitted.finalScore, percentage: submitted.percentage })));
  Math.abs(submitted.percentage - expectedPercentage) < 0.01
    ? ok(`percentage=${submitted.percentage} matches expected ${expectedPercentage}`)
    : fail('percentage mismatch', new Error(`got ${submitted.percentage}, expected ${expectedPercentage}`));

  console.log('=== Grade sync ===');
  const { rows: giRows } = await pool.query(
    `SELECT id, max_points FROM grade_items WHERE course_id=$1 AND quiz_id=$2 AND item_type='quiz'`, [COURSE_ID, quiz.id],
  );
  giRows.length === 1 ? ok('grade_items row auto-created for this quiz') : fail('expected 1 grade_items row, got ' + giRows.length);

  if (giRows.length) {
    const { rows: gRows } = await pool.query(
      `SELECT score, quiz_attempt_id FROM grades WHERE grade_item_id=$1 AND user_id=$2`, [giRows[0].id, STUDENT_ID],
    );
    (gRows.length === 1 && Number(gRows[0].score) === expectedFinal && gRows[0].quiz_attempt_id === attempt1.id)
      ? ok('grades row created with correct score and quiz_attempt_id traceability')
      : fail('grades row missing or incorrect', new Error(JSON.stringify(gRows)));
  }

  console.log('=== Max attempts enforcement ===');
  await expectThrow(
    attemptsSvc.startAttempt(COURSE_ID, quiz.id, studentActor),
    'starting a new attempt after max_attempts=1 exhausted is rejected', 400,
  );

  console.log('=== Manual-grading branch (long_text question) ===');
  const quiz2 = await quizzesSvc.createQuiz(COURSE_ID, { title: 'Attempt Verify Manual Quiz', maxAttempts: 1 }, instructorActor);
  createdQuizIds.push(quiz2.id);
  await quizzesSvc.createQuestion(COURSE_ID, quiz2.id, { questionType: 'long_text', prompt: 'Explain X.', points: 5 }, instructorActor);
  await quizzesSvc.publishQuiz(COURSE_ID, quiz2.id, instructorActor);

  const attempt2 = await attemptsSvc.startAttempt(COURSE_ID, quiz2.id, studentActor);
  const q2list = await quizzesSvc.listQuestions(COURSE_ID, quiz2.id, instructorActor);
  await attemptsSvc.saveResponses(COURSE_ID, attempt2.id, [{ questionId: q2list[0].id, responsePayload: { text: 'My answer.' } }], studentActor);
  const submitted2 = await attemptsSvc.submitAttempt(COURSE_ID, attempt2.id, studentActor);
  submitted2.status === 'pending_manual_grading' ? ok('long_text-only submission -> pending_manual_grading') : fail('expected pending_manual_grading, got ' + submitted2.status);

  const { rows: gi2Rows } = await pool.query(
    `SELECT id FROM grade_items WHERE course_id=$1 AND quiz_id=$2 AND item_type='quiz'`, [COURSE_ID, quiz2.id],
  );
  gi2Rows.length === 0 ? ok('no grade sync fired for a pending_manual_grading submission') : fail('grade_items row created prematurely for ungraded quiz');

  console.log('=== Manual grading (gradeAttempt) ===');
  const beforeGrade = await attemptsSvc.getAttempt(COURSE_ID, quiz2.id, attempt2.id, instructorActor);
  const manualResponse = beforeGrade.responses.find((r) => r.questionId === q2list[0].id);
  const graded2 = await attemptsSvc.gradeAttempt(
    COURSE_ID, attempt2.id,
    [{ responseId: manualResponse.id, score: 4, feedback: 'Good, missed one point.' }],
    instructorActor,
  );
  (graded2.status === 'graded' && graded2.finalScore === 4 && graded2.percentage === 80)
    ? ok(`gradeAttempt: status=graded, finalScore=4, percentage=80 (got finalScore=${graded2.finalScore}, percentage=${graded2.percentage})`)
    : fail('unexpected gradeAttempt result', new Error(JSON.stringify({ status: graded2.status, finalScore: graded2.finalScore, percentage: graded2.percentage })));

  const gradedResponse = graded2.responses.find((r) => r.id === manualResponse.id);
  (gradedResponse.finalScore === 4 && gradedResponse.feedback === 'Good, missed one point.')
    ? ok('response row carries manual score + feedback')
    : fail('response not graded as expected', new Error(JSON.stringify(gradedResponse)));

  const { rows: gi2RowsAfter } = await pool.query(
    `SELECT id FROM grade_items WHERE course_id=$1 AND quiz_id=$2 AND item_type='quiz'`, [COURSE_ID, quiz2.id],
  );
  if (gi2RowsAfter.length === 1) {
    const { rows: g2Rows } = await pool.query(
      `SELECT score, quiz_attempt_id FROM grades WHERE grade_item_id=$1 AND user_id=$2`, [gi2RowsAfter[0].id, STUDENT_ID],
    );
    (g2Rows.length === 1 && Number(g2Rows[0].score) === 4 && g2Rows[0].quiz_attempt_id === attempt2.id)
      ? ok('grade sync fired after manual grading, with correct score + traceability')
      : fail('grades row missing or incorrect after manual grading', new Error(JSON.stringify(g2Rows)));
  } else {
    fail('expected exactly 1 grade_items row after manual grading, got ' + gi2RowsAfter.length);
  }

  console.log('=== Concurrent startAttempt race (unique-violation retry) ===');
  const quiz3 = await quizzesSvc.createQuiz(COURSE_ID, { title: 'Attempt Verify Race Quiz', maxAttempts: 3 }, instructorActor);
  createdQuizIds.push(quiz3.id);
  await quizzesSvc.createQuestion(COURSE_ID, quiz3.id, { questionType: 'short_text', prompt: 'Race question.', points: 1, questionData: { acceptedAnswers: ['x'] } }, instructorActor);
  await quizzesSvc.publishQuiz(COURSE_ID, quiz3.id, instructorActor);

  const [raceA, raceB] = await Promise.all([
    attemptsSvc.startAttempt(COURSE_ID, quiz3.id, studentActor),
    attemptsSvc.startAttempt(COURSE_ID, quiz3.id, studentActor),
  ]);
  (raceA.id === raceB.id) ? ok(`two concurrent startAttempt calls resolved to the same attempt (${raceA.id}), no unique-violation thrown`)
    : fail('concurrent startAttempt calls produced two different attempts', new Error(JSON.stringify({ raceA, raceB })));

  const { rows: raceRows } = await pool.query(
    `SELECT COUNT(*) FROM quiz_attempts WHERE quiz_id=$1 AND user_id=$2`, [quiz3.id, STUDENT_ID],
  );
  Number(raceRows[0].count) === 1 ? ok('exactly one attempt row exists after the race (no duplicate)') : fail('expected 1 attempt row, got ' + raceRows[0].count);

  console.log(`\n${failures === 0 ? 'ALL QUIZ ATTEMPT VERIFICATION TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
}

main()
  .catch((e) => { failures++; console.error('UNCAUGHT ERROR:', e); })
  .finally(async () => {
    for (const id of createdQuizIds) {
      // grade_items/grades referencing this quiz aren't cascade-deleted by quiz
      // deletion (quiz_id FK is ON DELETE SET NULL on grade_items) -- clean up
      // explicitly so a re-run doesn't find a stale grade_items row.
      await pool.query(`DELETE FROM grades WHERE grade_item_id IN (SELECT id FROM grade_items WHERE quiz_id = $1)`, [id]);
      await pool.query(`DELETE FROM grade_items WHERE quiz_id = $1`, [id]);
      await pool.query(`DELETE FROM quizzes WHERE id = $1`, [id]); // cascades questions/options/attempts/responses
    }
    await pool.end();
    process.exit(failures === 0 ? 0 : 1);
  });
