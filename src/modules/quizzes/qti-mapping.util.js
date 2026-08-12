/**
 * QTI 2.2 → SimuLearn question mapping — pure functions, no DB dependency.
 * Phase 2a "pragmatic subset": we read responseDeclaration/outcomeDeclaration
 * DECLARATIVELY (interaction type + correct-answer data) and map into our own
 * normalized schema; we never execute/interpret arbitrary responseProcessing
 * rule XML. Items using a non-standard custom template are still imported
 * using whatever correctResponse data is available, with a warning attached.
 *
 * Security note (verified against installed fast-xml-parser@5.9.3 source,
 * node_modules/fast-xml-parser/src/v6/EntitiesParser.js): entity expansion is
 * pure in-memory regex substitution of values declared in the SAME document's
 * internal DOCTYPE subset. There is no SYSTEM/PUBLIC external-entity
 * resolution code path (no fs/http calls), so classic XXE (local file
 * disclosure, SSRF) is structurally impossible here regardless of parser
 * options. The live risk is internal-entity-expansion DoS ("billion laughs"),
 * which the library already caps by default; we tighten those caps further
 * below since legitimate QTI items never define more than a handful of
 * entities (defense-in-depth for untrusted instructor uploads).
 */
'use strict';

const { XMLParser } = require('fast-xml-parser');

// Tags that may legitimately repeat — force these to always parse as arrays
// (even when only one is present) so calling code never has to branch on
// "is this a single object or an array" for a repeatable QTI element.
const REPEATABLE_TAGS = new Set([
  'simpleChoice', 'value', 'resource', 'assessmentItemRef', 'simpleAssociableChoice',
  'file', 'gap', 'gapText', 'gapChoice',
]);

const PARSER_OPTIONS = {
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  parseAttributeValue: false,
  trimValues: true,
  textNodeName: '#text',
  // Untrusted instructor upload — tighten well below the library's own
  // defaults; see security note above for why external XXE is not possible.
  processEntities: { enabled: true, maxEntityCount: 20, maxTotalExpansions: 50, maxExpandedLength: 20000 },
  isArray: (name) => REPEATABLE_TAGS.has(name),
};

function asArray(x) {
  if (x === undefined || x === null) return [];
  return Array.isArray(x) ? x : [x];
}

function textOf(node) {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (typeof node === 'number') return String(node);
  if (typeof node === 'object' && '#text' in node) return String(node['#text']);
  return '';
}

/** Depth-first search for the first descendant object keyed `tagName` (attribute/text keys skipped). */
function findDeep(node, tagName) {
  if (node == null || typeof node !== 'object') return null;
  if (tagName in node) return node[tagName];
  for (const key of Object.keys(node)) {
    if (key.startsWith('@_') || key === '#text') continue;
    const child = node[key];
    if (Array.isArray(child)) {
      for (const c of child) {
        const found = findDeep(c, tagName);
        if (found != null) return found;
      }
    } else if (typeof child === 'object') {
      const found = findDeep(child, tagName);
      if (found != null) return found;
    }
  }
  return null;
}

/**
 * Look for declarative tolerance evidence in responseProcessing:
 * <equal tolerance="X" toleranceMode="absolute|relative"> or
 * <customOperator class="tolerance" value="X">. We never execute this
 * node's logic — only read these two well-known attribute shapes off it.
 */
function detectTolerance(responseProcessingNode) {
  const equalNode = findDeep(responseProcessingNode, 'equal');
  if (equalNode && typeof equalNode === 'object' && equalNode['@_tolerance'] != null) {
    return {
      tolerance: Number(equalNode['@_tolerance']),
      toleranceMode: equalNode['@_toleranceMode'] ?? 'absolute',
    };
  }
  const customOp = findDeep(responseProcessingNode, 'customOperator');
  if (customOp && typeof customOp === 'object' && customOp['@_class'] === 'tolerance' && customOp['@_value'] != null) {
    return { tolerance: Number(customOp['@_value']), toleranceMode: 'absolute' };
  }
  return null;
}

function getCorrectResponseValues(responseDeclaration) {
  const cr = responseDeclaration?.correctResponse;
  if (!cr) return [];
  return asArray(cr.value).map((v) => textOf(v));
}

const CUSTOM_RP_WARNING = 'custom response-processing not evaluated; verify correct answer(s) manually';

/** Absence of responseProcessing means the standard default template applies. */
function isRecognizedResponseProcessing(rp) {
  if (!rp || (typeof rp === 'object' && Object.keys(rp).length === 0)) return true;
  const template = (typeof rp === 'object' ? rp['@_template'] : null) ?? '';
  return template === '' || /match_correct|map_response/i.test(template);
}

/**
 * Parse one assessmentItem XML document and map it to our normalized shape.
 * Returns { unsupported, questionType, warningMessage, qtiIdentifier, title,
 *   prompt, responseIdentifier, points, required, manualGrading,
 *   options?, questionData, responseDeclaration, scoringConfig, feedbackConfig }.
 * Throws only when the XML itself is unparseable or missing the
 * <assessmentItem> root — every other case (unrecognized interaction, custom
 * response-processing) returns a best-effort mapping with unsupported/warning
 * fields set rather than throwing, so the caller can decide whether to skip
 * or import-with-caveat.
 */
function mapQtiItemToQuestion(itemXml, fallbackIdentifier) {
  let doc;
  try {
    doc = new XMLParser(PARSER_OPTIONS).parse(itemXml);
  } catch (err) {
    throw new Error(`invalid XML: ${err.message}`);
  }
  const item = doc.assessmentItem;
  if (!item) throw new Error('missing <assessmentItem> root element');

  const identifier = item['@_identifier'] ?? fallbackIdentifier;
  const title = item['@_title'] ?? null;
  const responseDeclaration = item.responseDeclaration ?? {};
  const responseIdentifier = responseDeclaration['@_identifier'] ?? null;
  const cardinality = responseDeclaration['@_cardinality'] ?? 'single';
  const baseType = responseDeclaration['@_baseType'] ?? 'identifier';
  const correctValues = getCorrectResponseValues(responseDeclaration);
  const responseProcessing = item.responseProcessing ?? {};
  const itemBody = item.itemBody ?? {};
  const rpWarning = isRecognizedResponseProcessing(responseProcessing) ? null : CUSTOM_RP_WARNING;

  const base = {
    qtiIdentifier: identifier,
    title,
    responseIdentifier,
    points: 1,
    required: true,
    manualGrading: false,
    unsupported: false,
    warningMessage: rpWarning,
    responseDeclaration: { cardinality, baseType, correctValues },
    scoringConfig: {},
    feedbackConfig: {},
  };

  const promptFor = (node) => textOf(findDeep(node, 'prompt')) || title || 'Untitled question';

  // ── choiceInteraction -> single_choice / multiple_choice / true_false ──────
  const choiceInteraction = findDeep(itemBody, 'choiceInteraction');
  if (choiceInteraction) {
    const maxChoices = Number(choiceInteraction['@_maxChoices'] ?? 1);
    const choices = asArray(choiceInteraction.simpleChoice);
    const options = choices.map((c, idx) => ({
      optionIdentifier: c['@_identifier'],
      content: textOf(c),
      isCorrect: correctValues.includes(c['@_identifier']),
      position: idx,
    }));
    const isTrueFalse = choices.length === 2
      && choices.every((c) => ['true', 'false'].includes(textOf(c).trim().toLowerCase()));

    return {
      ...base,
      questionType: isTrueFalse ? 'true_false' : (maxChoices === 1 ? 'single_choice' : 'multiple_choice'),
      prompt: promptFor(choiceInteraction),
      options,
      questionData: {},
    };
  }

  // ── textEntryInteraction -> short_text / numeric / numeric_tolerance ───────
  const textEntryInteraction = findDeep(itemBody, 'textEntryInteraction');
  if (textEntryInteraction) {
    const prompt = promptFor(itemBody);
    if (baseType === 'string') {
      return {
        ...base,
        questionType: 'short_text',
        prompt,
        questionData: { acceptedAnswers: correctValues, caseSensitive: false },
      };
    }
    const correctValue = correctValues[0] != null ? Number(correctValues[0]) : null;
    const tolerance = detectTolerance(responseProcessing);
    if (tolerance) {
      return {
        ...base,
        questionType: 'numeric_tolerance',
        prompt,
        questionData: { correctValue, ...tolerance },
        scoringConfig: { tolerance: tolerance.tolerance, toleranceMode: tolerance.toleranceMode },
      };
    }
    return {
      ...base,
      questionType: 'numeric',
      prompt,
      questionData: { correctValue },
    };
  }

  // ── extendedTextInteraction -> long_text (always manual grading) ───────────
  const extendedTextInteraction = findDeep(itemBody, 'extendedTextInteraction');
  if (extendedTextInteraction) {
    return {
      ...base,
      questionType: 'long_text',
      manualGrading: true,
      prompt: promptFor(itemBody),
      questionData: {},
    };
  }

  // ── matchInteraction -> matching ────────────────────────────────────────────
  const matchInteraction = findDeep(itemBody, 'matchInteraction');
  if (matchInteraction) {
    const sets = asArray(matchInteraction.simpleMatchSet);
    const sourceChoices = asArray(sets[0]?.simpleAssociableChoice).map((c) => ({ id: c['@_identifier'], text: textOf(c) }));
    const targetChoices = asArray(sets[1]?.simpleAssociableChoice).map((c) => ({ id: c['@_identifier'], text: textOf(c) }));
    const pairs = correctValues.map((v) => {
      const [sourceId, targetId] = String(v).split(' ');
      return {
        source: sourceChoices.find((s) => s.id === sourceId) ?? { id: sourceId },
        target: targetChoices.find((t) => t.id === targetId) ?? { id: targetId },
      };
    });
    return {
      ...base,
      questionType: 'matching',
      prompt: promptFor(matchInteraction),
      questionData: { pairs, sourceChoices, targetChoices },
    };
  }

  // ── orderInteraction -> ordering ────────────────────────────────────────────
  const orderInteraction = findDeep(itemBody, 'orderInteraction');
  if (orderInteraction) {
    const items = asArray(orderInteraction.simpleChoice).map((c) => ({ id: c['@_identifier'], text: textOf(c) }));
    return {
      ...base,
      questionType: 'ordering',
      prompt: promptFor(orderInteraction),
      questionData: { items, correctOrder: correctValues },
    };
  }

  // ── gapMatchInteraction -> fill_in_blank / multiple_fill_in_blank ──────────
  const gapMatchInteraction = findDeep(itemBody, 'gapMatchInteraction');
  if (gapMatchInteraction) {
    const wordBank = asArray(gapMatchInteraction.gapText).map((g) => ({ id: g['@_identifier'], text: textOf(g) }));
    const blanks = asArray(gapMatchInteraction.gap).map((g) => ({
      gapId: g['@_identifier'],
      acceptedAnswers: correctValues
        .filter((v) => String(v).includes(g['@_identifier']))
        .map((v) => String(v).split(' ')[0]),
    }));
    return {
      ...base,
      questionType: blanks.length > 1 ? 'multiple_fill_in_blank' : 'fill_in_blank',
      prompt: promptFor(gapMatchInteraction),
      questionData: { blanks, wordBank },
    };
  }

  // ── hotspotInteraction -> unsupported (Phase 2a) ────────────────────────────
  const hotspotInteraction = findDeep(itemBody, 'hotspotInteraction');
  if (hotspotInteraction) {
    return {
      ...base,
      questionType: 'hotspot',
      prompt: promptFor(hotspotInteraction),
      unsupported: true,
      warningMessage: 'hotspot interaction not evaluated; coordinates not mapped, verify manually',
      questionData: {},
    };
  }

  // ── uploadInteraction -> unsupported (Phase 2a) ─────────────────────────────
  const uploadInteraction = findDeep(itemBody, 'uploadInteraction');
  if (uploadInteraction) {
    return {
      ...base,
      questionType: 'file_upload',
      prompt: promptFor(uploadInteraction),
      unsupported: true,
      warningMessage: 'file upload interaction imported as placeholder; no auto-grading possible',
      questionData: {},
    };
  }

  // ── customInteraction class="formula" -> always unsupported ────────────────
  const customInteraction = findDeep(itemBody, 'customInteraction');
  if (customInteraction && /formula/i.test(customInteraction['@_class'] ?? '')) {
    return {
      ...base,
      questionType: 'formula',
      prompt: promptFor(customInteraction),
      unsupported: true,
      warningMessage: 'formula questions cannot be imported from QTI in Phase 2a; add manually',
      questionData: {},
    };
  }

  // ── no recognized interaction — skip the item entirely ─────────────────────
  const unknownInteraction = Object.keys(itemBody).find((k) => /Interaction$/.test(k));
  return {
    ...base,
    questionType: null,
    prompt: title ?? identifier ?? 'Untitled question',
    unsupported: true,
    warningMessage: unknownInteraction
      ? `interaction type '${unknownInteraction}' has no Phase 2a mapping; item skipped`
      : 'no recognized interaction found in item body; item skipped',
    questionData: {},
  };
}

module.exports = {
  mapQtiItemToQuestion,
  detectTolerance,
  asArray,
  textOf,
  findDeep,
  PARSER_OPTIONS,
};
