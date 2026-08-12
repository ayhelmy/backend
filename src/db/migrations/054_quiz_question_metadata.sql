-- =============================================================================
-- Migration 052 — Quiz Question Metadata
-- Adds nullable difficulty and taxonomy classification columns to quiz
-- questions, for instructor-facing question authoring/filtering. Existing
-- questions (including QTI-imported ones) are untouched — both columns are
-- optional and default to NULL.
-- =============================================================================

ALTER TABLE quiz_questions
  ADD COLUMN IF NOT EXISTS difficulty_level VARCHAR(20)
    CHECK (difficulty_level IN ('easy', 'medium', 'hard'));

ALTER TABLE quiz_questions
  ADD COLUMN IF NOT EXISTS taxonomy_level VARCHAR(20)
    CHECK (taxonomy_level IN ('remember', 'understand', 'apply', 'analyze', 'evaluate', 'create'));
