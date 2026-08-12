'use strict';

/**
 * QTI mapping — pure-function unit tests (qti-mapping.util.js has no DB
 * dependency, so no mocking is needed here).
 * Run: npx jest src/__tests__/qti-mapping.test.js
 */

const { mapQtiItemToQuestion, detectTolerance } = require('../modules/quizzes/qti-mapping.util');

function itemXml(inner) {
  return `<?xml version="1.0"?><assessmentItem identifier="item1" title="Q">${inner}</assessmentItem>`;
}

describe('qti-mapping — choiceInteraction', () => {
  test('2 choices literally True/False -> true_false', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
        <correctResponse><value>A</value></correctResponse>
      </responseDeclaration>
      <itemBody>
        <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
          <prompt>Is water wet?</prompt>
          <simpleChoice identifier="A">True</simpleChoice>
          <simpleChoice identifier="B">False</simpleChoice>
        </choiceInteraction>
      </itemBody>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('true_false');
    expect(result.options).toEqual([
      { optionIdentifier: 'A', content: 'True', isCorrect: true, position: 0 },
      { optionIdentifier: 'B', content: 'False', isCorrect: false, position: 1 },
    ]);
  });

  test('maxChoices=1, not True/False -> single_choice', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
        <correctResponse><value>B</value></correctResponse>
      </responseDeclaration>
      <itemBody>
        <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
          <prompt>2+2?</prompt>
          <simpleChoice identifier="A">3</simpleChoice>
          <simpleChoice identifier="B">4</simpleChoice>
        </choiceInteraction>
      </itemBody>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('single_choice');
    expect(result.options.find((o) => o.optionIdentifier === 'B').isCorrect).toBe(true);
  });

  test('maxChoices=0 with multiple correct values -> multiple_choice', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="identifier">
        <correctResponse><value>A</value><value>C</value></correctResponse>
      </responseDeclaration>
      <itemBody>
        <choiceInteraction responseIdentifier="RESPONSE" maxChoices="0">
          <prompt>Pick primes</prompt>
          <simpleChoice identifier="A">2</simpleChoice>
          <simpleChoice identifier="B">4</simpleChoice>
          <simpleChoice identifier="C">3</simpleChoice>
        </choiceInteraction>
      </itemBody>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('multiple_choice');
    expect(result.options.filter((o) => o.isCorrect).map((o) => o.optionIdentifier)).toEqual(['A', 'C']);
  });
});

describe('qti-mapping — textEntryInteraction', () => {
  test('baseType=string -> short_text', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string">
        <correctResponse><value>Paris</value></correctResponse>
      </responseDeclaration>
      <itemBody><prompt>Capital of France?</prompt><textEntryInteraction responseIdentifier="RESPONSE"/></itemBody>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('short_text');
    expect(result.questionData.acceptedAnswers).toEqual(['Paris']);
  });

  test('baseType=float, no tolerance -> numeric', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="float">
        <correctResponse><value>42</value></correctResponse>
      </responseDeclaration>
      <itemBody><prompt>Answer to everything?</prompt><textEntryInteraction responseIdentifier="RESPONSE"/></itemBody>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('numeric');
    expect(result.questionData.correctValue).toBe(42);
  });

  test('baseType=float + <equal tolerance> -> numeric_tolerance, tolerance mirrored into scoringConfig', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="float">
        <correctResponse><value>3.14</value></correctResponse>
      </responseDeclaration>
      <itemBody><prompt>Value of pi?</prompt><textEntryInteraction responseIdentifier="RESPONSE"/></itemBody>
      <responseProcessing><responseCondition><responseIf>
        <equal tolerance="0.01" toleranceMode="absolute">
          <variable identifier="RESPONSE"/><correct identifier="RESPONSE"/>
        </equal>
      </responseIf></responseCondition></responseProcessing>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('numeric_tolerance');
    expect(result.questionData).toMatchObject({ correctValue: 3.14, tolerance: 0.01, toleranceMode: 'absolute' });
    expect(result.scoringConfig).toEqual({ tolerance: 0.01, toleranceMode: 'absolute' });
  });
});

describe('qti-mapping — detectTolerance()', () => {
  test('returns null when no tolerance evidence present', () => {
    expect(detectTolerance({})).toBeNull();
  });

  test('detects customOperator class="tolerance"', () => {
    const rp = { responseCondition: { responseIf: { customOperator: { '@_class': 'tolerance', '@_value': '0.5' } } } };
    expect(detectTolerance(rp)).toEqual({ tolerance: 0.5, toleranceMode: 'absolute' });
  });
});

describe('qti-mapping — matching / ordering / gapMatch', () => {
  test('matchInteraction -> matching with pairs from correctResponse', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="pair">
        <correctResponse><value>S1 T1</value><value>S2 T2</value></correctResponse>
      </responseDeclaration>
      <itemBody>
        <matchInteraction responseIdentifier="RESPONSE">
          <prompt>Match capitals</prompt>
          <simpleMatchSet>
            <simpleAssociableChoice identifier="S1" matchMax="1">France</simpleAssociableChoice>
            <simpleAssociableChoice identifier="S2" matchMax="1">Japan</simpleAssociableChoice>
          </simpleMatchSet>
          <simpleMatchSet>
            <simpleAssociableChoice identifier="T1" matchMax="1">Paris</simpleAssociableChoice>
            <simpleAssociableChoice identifier="T2" matchMax="1">Tokyo</simpleAssociableChoice>
          </simpleMatchSet>
        </matchInteraction>
      </itemBody>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('matching');
    expect(result.questionData.pairs).toEqual([
      { source: { id: 'S1', text: 'France' }, target: { id: 'T1', text: 'Paris' } },
      { source: { id: 'S2', text: 'Japan' }, target: { id: 'T2', text: 'Tokyo' } },
    ]);
  });

  test('orderInteraction -> ordering with correctOrder from correctResponse', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="ordered" baseType="identifier">
        <correctResponse><value>C2</value><value>C1</value><value>C3</value></correctResponse>
      </responseDeclaration>
      <itemBody>
        <orderInteraction responseIdentifier="RESPONSE">
          <prompt>Order the steps</prompt>
          <simpleChoice identifier="C1">Step A</simpleChoice>
          <simpleChoice identifier="C2">Step B</simpleChoice>
          <simpleChoice identifier="C3">Step C</simpleChoice>
        </orderInteraction>
      </itemBody>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('ordering');
    expect(result.questionData.correctOrder).toEqual(['C2', 'C1', 'C3']);
    expect(result.questionData.items).toHaveLength(3);
  });

  test('gapMatchInteraction with 1 gap -> fill_in_blank, with >1 gaps -> multiple_fill_in_blank', () => {
    const oneGapXml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="directedPair">
        <correctResponse><value>W1 G1</value></correctResponse>
      </responseDeclaration>
      <itemBody>
        <gapMatchInteraction responseIdentifier="RESPONSE">
          <prompt>Fill the blank</prompt>
          <gapText identifier="W1">cat</gapText>
          <gap identifier="G1"/>
        </gapMatchInteraction>
      </itemBody>`);
    expect(mapQtiItemToQuestion(oneGapXml, 'item1').questionType).toBe('fill_in_blank');

    const twoGapXml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="directedPair">
        <correctResponse><value>W1 G1</value><value>W2 G2</value></correctResponse>
      </responseDeclaration>
      <itemBody>
        <gapMatchInteraction responseIdentifier="RESPONSE">
          <prompt>Fill the blanks</prompt>
          <gapText identifier="W1">cat</gapText>
          <gapText identifier="W2">dog</gapText>
          <gap identifier="G1"/>
          <gap identifier="G2"/>
        </gapMatchInteraction>
      </itemBody>`);
    expect(mapQtiItemToQuestion(twoGapXml, 'item1').questionType).toBe('multiple_fill_in_blank');
  });
});

describe('qti-mapping — unsupported types', () => {
  test('extendedTextInteraction -> long_text with manualGrading=true', () => {
    const xml = itemXml('<itemBody><prompt>Explain photosynthesis</prompt><extendedTextInteraction responseIdentifier="RESPONSE"/></itemBody>');
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.questionType).toBe('long_text');
    expect(result.manualGrading).toBe(true);
    expect(result.unsupported).toBe(false);
  });

  test('hotspotInteraction -> unsupported with warning, not fatal', () => {
    const xml = itemXml('<itemBody><hotspotInteraction responseIdentifier="RESPONSE"><prompt>Click the heart</prompt></hotspotInteraction></itemBody>');
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.unsupported).toBe(true);
    expect(result.questionType).toBe('hotspot');
    expect(result.warningMessage).toMatch(/hotspot/i);
  });

  test('customInteraction class="formula" -> unsupported formula', () => {
    const xml = itemXml('<itemBody><customInteraction class="formula" responseIdentifier="RESPONSE"><prompt>Solve for x</prompt></customInteraction></itemBody>');
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.unsupported).toBe(true);
    expect(result.questionType).toBe('formula');
  });

  test('unrecognized interaction -> skipped with warning naming the interaction', () => {
    const xml = itemXml('<itemBody><sliderInteraction responseIdentifier="RESPONSE"/></itemBody>');
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.unsupported).toBe(true);
    expect(result.questionType).toBeNull();
    expect(result.warningMessage).toMatch(/sliderInteraction/);
  });

  test('custom (non-standard) responseProcessing template attaches a caveat warning without failing import', () => {
    const xml = itemXml(`
      <responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier">
        <correctResponse><value>A</value></correctResponse>
      </responseDeclaration>
      <itemBody>
        <choiceInteraction responseIdentifier="RESPONSE" maxChoices="1">
          <prompt>Q</prompt>
          <simpleChoice identifier="A">1</simpleChoice>
          <simpleChoice identifier="B">2</simpleChoice>
        </choiceInteraction>
      </itemBody>
      <responseProcessing template="https://example.com/custom-scoring-logic"/>`);
    const result = mapQtiItemToQuestion(xml, 'item1');
    expect(result.unsupported).toBe(false); // still imported
    expect(result.warningMessage).toMatch(/custom response-processing/i);
  });
});

describe('qti-mapping — malformed input', () => {
  test('missing <assessmentItem> root throws', () => {
    expect(() => mapQtiItemToQuestion('<foo/>', 'item1')).toThrow(/assessmentItem/);
  });

  test('assessmentItem present but internally malformed degrades gracefully (skipped, not thrown)', () => {
    // fast-xml-parser is lenient about unclosed/malformed tags — it does not
    // throw here, it just parses what it can. With no recognizable itemBody,
    // the mapper falls through to the "no recognized interaction" case rather
    // than crashing, which is the desired behavior for a single bad item
    // inside an otherwise-good package (see qti-import.service.js's per-item
    // try/catch — a thrown error and a returned `unsupported:true` are both
    // handled as "skip with warning", so either is an acceptable contract,
    // but this asserts the actual observed non-throwing behavior).
    const result = mapQtiItemToQuestion('<assessmentItem><unclosed>', 'item1');
    expect(result.unsupported).toBe(true);
  });
});
