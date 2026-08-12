/**
 * QTI 2.2 package export — Phase 2a.
 * Generates a valid QTI package (imsmanifest.xml + one assessmentItem XML per
 * question) from our normalized quiz/question/option rows and streams it as
 * a .zip to the response. `unzipper` (already a dependency) is extract-only,
 * so zip *writing* uses `archiver`, added specifically for this.
 */
'use strict';

const { ZipArchive } = require('archiver');
const { QuizModel, QuizQuestionModel, CourseModel, AuditModel } = require('../../db/models');
const ApiError = require('../../utils/apiError');
const { assertCourseScope } = require('./quizzes.service');

function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Question types with a clean, faithful QTI 2.2 interaction equivalent.
const OPTION_BASED_TYPES = new Set(['single_choice', 'multiple_choice', 'true_false']);

function buildChoiceItem(q, options) {
  const maxChoices = q.question_type === 'single_choice' || q.question_type === 'true_false' ? 1 : 0;
  const correctIds = options.filter((o) => o.is_correct).map((o) => o.option_identifier);
  return `
  <responseDeclaration identifier="RESPONSE" cardinality="${maxChoices === 1 ? 'single' : 'multiple'}" baseType="identifier">
    <correctResponse>
      ${correctIds.map((id) => `<value>${esc(id)}</value>`).join('\n      ')}
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>0</value></defaultValue></outcomeDeclaration>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" shuffle="${!!q.shuffle_options}" maxChoices="${maxChoices}">
      <prompt>${esc(q.prompt)}</prompt>
      ${options.map((o) => `<simpleChoice identifier="${esc(o.option_identifier)}">${esc(o.content)}</simpleChoice>`).join('\n      ')}
    </choiceInteraction>
  </itemBody>
  <responseProcessing template="https://www.imsglobal.org/question/qti_v2p2/rptemplates/match_correct"/>`;
}

function buildTextEntryItem(q) {
  const data = q.question_data ?? {};
  const isNumeric = q.question_type === 'numeric' || q.question_type === 'numeric_tolerance';
  const baseType = isNumeric ? 'float' : 'string';
  const correctValues = isNumeric
    ? [data.correctValue]
    : (Array.isArray(data.acceptedAnswers) ? data.acceptedAnswers : []);
  const scoring = q.scoring_config ?? {};

  const responseProcessing = q.question_type === 'numeric_tolerance' && scoring.tolerance != null
    ? `
  <responseProcessing>
    <responseCondition>
      <responseIf>
        <equal tolerance="${esc(scoring.tolerance)}" toleranceMode="${esc(scoring.toleranceMode ?? 'absolute')}">
          <variable identifier="RESPONSE"/>
          <correct identifier="RESPONSE"/>
        </equal>
      </responseIf>
    </responseCondition>
  </responseProcessing>`
    : `
  <responseProcessing template="https://www.imsglobal.org/question/qti_v2p2/rptemplates/match_correct"/>`;

  return `
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="${baseType}">
    <correctResponse>
      ${correctValues.map((v) => `<value>${esc(v)}</value>`).join('\n      ')}
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>0</value></defaultValue></outcomeDeclaration>
  <itemBody>
    <prompt>${esc(q.prompt)}</prompt>
    <textEntryInteraction responseIdentifier="RESPONSE"/>
  </itemBody>${responseProcessing}`;
}

function buildExtendedTextItem(q) {
  return `
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>0</value></defaultValue></outcomeDeclaration>
  <itemBody>
    <prompt>${esc(q.prompt)}</prompt>
    <extendedTextInteraction responseIdentifier="RESPONSE"/>
  </itemBody>`;
}

function buildMatchItem(q) {
  const data = q.question_data ?? {};
  const sourceChoices = Array.isArray(data.sourceChoices) ? data.sourceChoices : [];
  const targetChoices = Array.isArray(data.targetChoices) ? data.targetChoices : [];
  const pairs = Array.isArray(data.pairs) ? data.pairs : [];
  return `
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="pair">
    <correctResponse>
      ${pairs.map((p) => `<value>${esc(p.source?.id)} ${esc(p.target?.id)}</value>`).join('\n      ')}
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>0</value></defaultValue></outcomeDeclaration>
  <itemBody>
    <matchInteraction responseIdentifier="RESPONSE" shuffle="false" maxAssociations="${pairs.length}">
      <prompt>${esc(q.prompt)}</prompt>
      <simpleMatchSet>
        ${sourceChoices.map((c) => `<simpleAssociableChoice identifier="${esc(c.id)}" matchMax="1">${esc(c.text)}</simpleAssociableChoice>`).join('\n        ')}
      </simpleMatchSet>
      <simpleMatchSet>
        ${targetChoices.map((c) => `<simpleAssociableChoice identifier="${esc(c.id)}" matchMax="1">${esc(c.text)}</simpleAssociableChoice>`).join('\n        ')}
      </simpleMatchSet>
    </matchInteraction>
  </itemBody>
  <responseProcessing template="https://www.imsglobal.org/question/qti_v2p2/rptemplates/match_correct"/>`;
}

function buildOrderItem(q) {
  const data = q.question_data ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  const correctOrder = Array.isArray(data.correctOrder) ? data.correctOrder : [];
  return `
  <responseDeclaration identifier="RESPONSE" cardinality="ordered" baseType="identifier">
    <correctResponse>
      ${correctOrder.map((id) => `<value>${esc(id)}</value>`).join('\n      ')}
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>0</value></defaultValue></outcomeDeclaration>
  <itemBody>
    <orderInteraction responseIdentifier="RESPONSE" shuffle="false">
      <prompt>${esc(q.prompt)}</prompt>
      ${items.map((it) => `<simpleChoice identifier="${esc(it.id)}">${esc(it.text)}</simpleChoice>`).join('\n      ')}
    </orderInteraction>
  </itemBody>
  <responseProcessing template="https://www.imsglobal.org/question/qti_v2p2/rptemplates/match_correct"/>`;
}

function buildGapMatchItem(q) {
  const data = q.question_data ?? {};
  const wordBank = Array.isArray(data.wordBank) ? data.wordBank : [];
  const blanks = Array.isArray(data.blanks) ? data.blanks : [];
  return `
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="directedPair">
    <correctResponse>
      ${blanks.flatMap((b) => (b.acceptedAnswers ?? []).map((a) => `<value>${esc(a)} ${esc(b.gapId)}</value>`)).join('\n      ')}
    </correctResponse>
  </responseDeclaration>
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>0</value></defaultValue></outcomeDeclaration>
  <itemBody>
    <gapMatchInteraction responseIdentifier="RESPONSE" shuffle="false">
      <prompt>${esc(q.prompt)}</prompt>
      ${wordBank.map((w) => `<gapText identifier="${esc(w.id)}">${esc(w.text)}</gapText>`).join('\n      ')}
      ${blanks.map((b) => `<gap identifier="${esc(b.gapId)}"/>`).join('\n      ')}
    </gapMatchInteraction>
  </itemBody>
  <responseProcessing template="https://www.imsglobal.org/question/qti_v2p2/rptemplates/match_correct"/>`;
}

// hotspot/file_upload/formula have no clean QTI 2.2 equivalent — export a
// best-effort extendedTextInteraction placeholder (valid QTI, but not a
// faithful round-trip) rather than omitting the question or breaking export.
function buildPlaceholderItem(q) {
  return `
  <outcomeDeclaration identifier="SCORE" cardinality="single" baseType="float"><defaultValue><value>0</value></defaultValue></outcomeDeclaration>
  <itemBody>
    <!-- Original SimuLearn question_type: ${esc(q.question_type)} — no faithful QTI 2.2
         equivalent exists; exported as a placeholder extended-text item. -->
    <prompt>${esc(q.prompt)}</prompt>
    <extendedTextInteraction responseIdentifier="RESPONSE"/>
  </itemBody>`;
}

function buildItemBody(q, options) {
  if (OPTION_BASED_TYPES.has(q.question_type)) return buildChoiceItem(q, options);
  if (q.question_type === 'short_text' || q.question_type === 'numeric' || q.question_type === 'numeric_tolerance') return buildTextEntryItem(q);
  if (q.question_type === 'long_text') return buildExtendedTextItem(q);
  if (q.question_type === 'matching') return buildMatchItem(q);
  if (q.question_type === 'ordering') return buildOrderItem(q);
  if (q.question_type === 'fill_in_blank' || q.question_type === 'multiple_fill_in_blank') return buildGapMatchItem(q);
  return buildPlaceholderItem(q);
}

function buildItemXml(q, options) {
  const identifier = q.qti_identifier || q.id;
  return `<?xml version="1.0" encoding="UTF-8"?>
<assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p2"
  identifier="${esc(identifier)}" title="${esc(q.title || q.prompt.slice(0, 60))}"
  adaptive="false" timeDependent="false">${buildItemBody(q, options)}
</assessmentItem>`;
}

function buildManifestXml(quiz, itemFiles) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" identifier="MANIFEST-${esc(quiz.id)}">
  <organizations/>
  <resources>
${itemFiles.map(({ identifier, filename }) => `    <resource identifier="${esc(identifier)}" type="imsqti_item_xmlv2p2" href="${esc(filename)}">
      <file href="${esc(filename)}"/>
    </resource>`).join('\n')}
  </resources>
</manifest>`;
}

/**
 * Streams a QTI package (.zip) for the given quiz directly to `res`.
 */
exports.streamQuizAsQti = async (courseId, quizId, actor, res) => {
  const course = await CourseModel.findById(courseId);
  assertCourseScope(course, actor);

  const quiz = await QuizModel.findById(quizId);
  if (!quiz || quiz.course_id !== courseId) throw ApiError.notFound('Quiz not found in this course.');

  const questions = await QuizQuestionModel.listByQuiz(quizId);
  const questionsWithOptions = await Promise.all(questions.map(async (q) => ({
    ...q,
    options: QuizQuestionModel.OPTION_BASED_TYPES.includes(q.question_type)
      ? await QuizQuestionModel.listOptions(q.id)
      : [],
  })));

  await AuditModel.log({
    institutionId: course.institution_id, actorId: actor.id, actorEmail: actor.email,
    action: 'quiz.qti_export', entityType: 'Quiz', entityId: quizId,
    delta: { after: { courseId, questionCount: questions.length, exportedAt: new Date().toISOString() } },
  });

  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on('error', (err) => { throw err; });
  archive.pipe(res);

  const itemFiles = questionsWithOptions.map((q, idx) => ({
    identifier: q.qti_identifier || q.id,
    filename: `item${idx + 1}.xml`,
    xml: buildItemXml(q, q.options),
  }));

  archive.append(buildManifestXml(quiz, itemFiles), { name: 'imsmanifest.xml' });
  for (const item of itemFiles) {
    archive.append(item.xml, { name: item.filename });
  }

  await archive.finalize();
};
