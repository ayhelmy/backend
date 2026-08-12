'use strict';

/**
 * Live-DB verification script for the QTI 2.2 import pipeline (Phase 2a).
 * Exercises importQtiPackage() directly (bypassing HTTP) against the REAL
 * dev database, using real seeded fixture rows. Cleans up everything it
 * creates in a finally block, mirroring how Phase 1 was verified.
 *
 * DO NOT run this against a production database — it inserts and deletes
 * real rows scoped to a real course, and assumes the dev seed data checked
 * for at the top of main() is present.
 *
 * Run: node scripts/verify-qti-import.js
 */

require('../src/config');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { ZipArchive } = require('archiver');
const { pool } = require('../src/config/database');
const { importQtiPackage } = require('../src/modules/quizzes/qti-import.service');

const COURSE_ID = '93ad0781-8d59-4410-8532-69480d9af576'; // "Test" course, Cairo University
const INSTRUCTOR_ID = '11bdc65a-c608-499a-acbc-9c269d05e207'; // instructor@cairo-university.edu
const CAIRO_INSTITUTION = '492a2970-f6d4-48c1-affd-0073fdaad19c';

const instructorActor = {
  id: INSTRUCTOR_ID, email: 'instructor@cairo-university.edu', institutionId: CAIRO_INSTITUTION,
  roles: ['instructor'],
  permissions: ['quizzes.create', 'quizzes.update', 'quizzes.view_course'],
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

// ── Fixture QTI package builders ─────────────────────────────────────────────

const MANIFEST_TEMPLATE = (items) => `<?xml version="1.0"?>
<manifest identifier="TEST-MANIFEST">
  <resources>
    ${items.map((i) => `<resource identifier="${i.identifier}" type="imsqti_item_xmlv2p2" href="${i.file}"><file href="${i.file}"/></resource>`).join('\n    ')}
  </resources>
</manifest>`;

const TRUE_FALSE_ITEM = `<?xml version="1.0"?>
<assessmentItem identifier="q-tf" title="TF Question">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
    <correctResponse><value>A</value></correctResponse>
  </responseDeclaration>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
      <prompt>Is the sky blue?</prompt>
      <simpleChoice identifier="A">True</simpleChoice>
      <simpleChoice identifier="B">False</simpleChoice>
    </choiceInteraction>
  </itemBody>
</assessmentItem>`;

const MULTIPLE_CHOICE_ITEM = `<?xml version="1.0"?>
<assessmentItem identifier="q-mc" title="MC Question">
  <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="identifier">
    <correctResponse><value>A</value><value>C</value></correctResponse>
  </responseDeclaration>
  <itemBody>
    <choiceInteraction responseIdentifier="RESPONSE" maxChoices="0">
      <prompt>Pick the primes</prompt>
      <simpleChoice identifier="A">2</simpleChoice>
      <simpleChoice identifier="B">4</simpleChoice>
      <simpleChoice identifier="C">3</simpleChoice>
      <simpleChoice identifier="D">6</simpleChoice>
    </choiceInteraction>
  </itemBody>
</assessmentItem>`;

const NUMERIC_TOLERANCE_ITEM = `<?xml version="1.0"?>
<assessmentItem identifier="q-num" title="Numeric Question">
  <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="float">
    <correctResponse><value>3.14</value></correctResponse>
  </responseDeclaration>
  <itemBody>
    <prompt>Value of pi (2 dp)?</prompt>
    <textEntryInteraction responseIdentifier="RESPONSE"/>
  </itemBody>
  <responseProcessing>
    <responseCondition><responseIf>
      <equal tolerance="0.01" toleranceMode="absolute">
        <variable identifier="RESPONSE"/><correct identifier="RESPONSE"/>
      </equal>
    </responseIf></responseCondition>
  </responseProcessing>
</assessmentItem>`;

const HOTSPOT_ITEM = `<?xml version="1.0"?>
<assessmentItem identifier="q-hotspot" title="Hotspot Question">
  <itemBody>
    <hotspotInteraction responseIdentifier="RESPONSE"><prompt>Click the heart</prompt></hotspotInteraction>
  </itemBody>
</assessmentItem>`;

async function buildZip(files, outPath) {
  return new Promise((resolve, reject) => {
    const output = fs.createWriteStream(outPath);
    const archive = new ZipArchive();
    output.on('close', resolve);
    archive.on('error', reject);
    archive.pipe(output);
    for (const [name, content] of Object.entries(files)) archive.append(content, { name });
    archive.finalize();
  });
}

async function makeGoodPackage() {
  const items = [
    { identifier: 'q-tf', file: 'item1.xml' },
    { identifier: 'q-mc', file: 'item2.xml' },
    { identifier: 'q-num', file: 'item3.xml' },
  ];
  const zipPath = path.join(os.tmpdir(), `qti-verify-good-${crypto.randomUUID()}.zip`);
  await buildZip({
    'imsmanifest.xml': MANIFEST_TEMPLATE(items),
    'item1.xml': TRUE_FALSE_ITEM,
    'item2.xml': MULTIPLE_CHOICE_ITEM,
    'item3.xml': NUMERIC_TOLERANCE_ITEM,
  }, zipPath);
  return zipPath;
}

async function makePartialPackage() {
  const items = [
    { identifier: 'q-tf', file: 'item1.xml' },
    { identifier: 'q-hotspot', file: 'item2.xml' },
  ];
  const zipPath = path.join(os.tmpdir(), `qti-verify-partial-${crypto.randomUUID()}.zip`);
  await buildZip({
    'imsmanifest.xml': MANIFEST_TEMPLATE(items),
    'item1.xml': TRUE_FALSE_ITEM,
    'item2.xml': HOTSPOT_ITEM,
  }, zipPath);
  return zipPath;
}

async function makeAllUnsupportedPackage() {
  const items = [{ identifier: 'q-hotspot', file: 'item1.xml' }];
  const zipPath = path.join(os.tmpdir(), `qti-verify-allbad-${crypto.randomUUID()}.zip`);
  await buildZip({ 'imsmanifest.xml': MANIFEST_TEMPLATE(items), 'item1.xml': HOTSPOT_ITEM }, zipPath);
  return zipPath;
}

// raw (unsanitized) zip writer -- archiver strips ".."  from entry names on
// write, so a path-traversal negative test needs a hand-built zip instead.
function makeRawZip(entryName, content, outPath) {
  const nameBuf = Buffer.from(entryName, 'utf8');
  const dataBuf = Buffer.from(content, 'utf8');
  const crc = require('zlib').crc32(dataBuf) >>> 0;

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt32LE(crc, 14);
  localHeader.writeUInt32LE(dataBuf.length, 18);
  localHeader.writeUInt32LE(dataBuf.length, 22);
  localHeader.writeUInt16LE(nameBuf.length, 26);
  const localEntry = Buffer.concat([localHeader, nameBuf, dataBuf]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt32LE(crc, 16);
  centralHeader.writeUInt32LE(dataBuf.length, 20);
  centralHeader.writeUInt32LE(dataBuf.length, 24);
  centralHeader.writeUInt16LE(nameBuf.length, 28);
  const centralEntry = Buffer.concat([centralHeader, nameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralEntry.length, 12);
  eocd.writeUInt32LE(localEntry.length, 16);

  fs.writeFileSync(outPath, Buffer.concat([localEntry, centralEntry, eocd]));
}

// ── Main ──────────────────────────────────────────────────────────────────────

const createdQuizIds = [];

async function main() {
  const fixtureCheck = await pool.query('SELECT id FROM courses WHERE id = $1', [COURSE_ID]);
  if (!fixtureCheck.rows.length) {
    throw new Error(`Fixture course ${COURSE_ID} not found — this script expects the dev seed data used by Phase 1's smoke script.`);
  }

  console.log('=== Full-success package (3 supported items) ===');
  const goodZip = await makeGoodPackage();
  const goodResult = await importQtiPackage({
    courseId: COURSE_ID, quizId: null, body: { title: 'QTI Verify Quiz' },
    tempZipPath: goodZip, actor: instructorActor,
  });
  createdQuizIds.push(goodResult.quizId);
  (goodResult.importedQuestionCount === 3 && goodResult.skippedCount === 0)
    ? ok(`imported 3/3 questions, 0 skipped (quizId=${goodResult.quizId})`)
    : fail('expected 3 imported / 0 skipped', new Error(JSON.stringify(goodResult)));

  const { rows: questions } = await pool.query(
    'SELECT question_type, qti_identifier FROM quiz_questions WHERE quiz_id = $1 ORDER BY position', [goodResult.quizId],
  );
  const types = questions.map((q) => q.question_type);
  JSON.stringify(types) === JSON.stringify(['true_false', 'multiple_choice', 'numeric_tolerance'])
    ? ok('question_type sequence matches true_false, multiple_choice, numeric_tolerance')
    : fail('question_type sequence mismatch', new Error(JSON.stringify(types)));

  const { rows: options } = await pool.query(
    `SELECT o.* FROM quiz_question_options o JOIN quiz_questions q ON q.id = o.question_id WHERE q.quiz_id = $1 AND q.question_type = 'true_false'`,
    [goodResult.quizId],
  );
  options.length === 2 ? ok('true_false question has 2 options rows') : fail('expected 2 options rows, got ' + options.length);

  const { rows: numQ } = await pool.query(
    `SELECT question_data, scoring_config FROM quiz_questions WHERE quiz_id = $1 AND question_type = 'numeric_tolerance'`, [goodResult.quizId],
  );
  (Number(numQ[0].question_data.correctValue) === 3.14 && Number(numQ[0].scoring_config.tolerance) === 0.01)
    ? ok('numeric_tolerance question_data/scoring_config correctly extracted')
    : fail('numeric_tolerance data mismatch', new Error(JSON.stringify(numQ[0])));

  const { rows: auditRows } = await pool.query(
    `SELECT * FROM audit_logs WHERE action = 'quiz.qti_import' AND entity_id = $1`, [goodResult.quizId],
  );
  auditRows.length === 1 ? ok('audit_logs row written for quiz.qti_import') : fail('expected 1 audit row, got ' + auditRows.length);

  console.log('=== Partial-success package (1 supported + 1 unsupported) ===');
  const partialZip = await makePartialPackage();
  const partialResult = await importQtiPackage({
    courseId: COURSE_ID, quizId: null, body: { title: 'QTI Verify Partial Quiz' },
    tempZipPath: partialZip, actor: instructorActor,
  });
  createdQuizIds.push(partialResult.quizId);
  (partialResult.importedQuestionCount === 1 && partialResult.skippedCount === 1 && partialResult.warnings.length === 1)
    ? ok('partial success: 1 imported, 1 skipped with 1 warning, quiz still committed')
    : fail('partial success semantics wrong', new Error(JSON.stringify(partialResult)));

  console.log('=== All-unsupported package (rollback) ===');
  const allBadZip = await makeAllUnsupportedPackage();
  await expectThrow(
    importQtiPackage({
      courseId: COURSE_ID, quizId: null, body: { title: 'QTI Verify AllBad Quiz' },
      tempZipPath: allBadZip, actor: instructorActor,
    }),
    'all-unsupported package throws and rolls back', 400,
  );
  const { rows: orphanCheck } = await pool.query(`SELECT id FROM quizzes WHERE title = 'QTI Verify AllBad Quiz'`);
  orphanCheck.length === 0 ? ok('no orphan quiz row left behind after full rollback') : fail('found orphan quiz row(s)', new Error(JSON.stringify(orphanCheck)));

  console.log('=== Path traversal rejection ===');
  const evilZip = path.join(os.tmpdir(), `qti-verify-evil-${crypto.randomUUID()}.zip`);
  makeRawZip('../../evil.txt', 'pwned', evilZip);
  await expectThrow(
    importQtiPackage({
      courseId: COURSE_ID, quizId: null, body: { title: 'Should never be created' },
      tempZipPath: evilZip, actor: instructorActor,
    }),
    'path-traversal package rejected before any file write', 400,
  );
  const escapedPath = path.resolve(os.tmpdir(), '..', 'evil.txt');
  fs.existsSync(escapedPath) ? fail('escape path exists on disk!', new Error(escapedPath)) : ok('no file written outside the temp extraction root');

  console.log(`\n${failures === 0 ? 'ALL QTI IMPORT VERIFICATION TESTS PASSED' : failures + ' TEST(S) FAILED'}`);
}

main()
  .catch((e) => { failures++; console.error('UNCAUGHT ERROR:', e); })
  .finally(async () => {
    for (const id of createdQuizIds) await pool.query('DELETE FROM quizzes WHERE id = $1', [id]);
    await pool.end();
    process.exit(failures === 0 ? 0 : 1);
  });
