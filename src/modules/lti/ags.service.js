/**
 * LTI Assignment and Grade Services (AGS) — score passback.
 * SRS reference doc §13. Hooks into the EXISTING simulation-scores write
 * path (see simulation-scores.service.js) rather than inventing a parallel
 * automated-scoring system — see plan addendum "AGS — hook into the existing
 * score write path, not new automation".
 *
 * No cron/queue library exists in this codebase (verified — server.js has no
 * schedulers). Retry policy: attempt sync inline right after the score
 * write (non-fatal on failure), store status/error/retry-count columns, and
 * expose a manual "Resync Grade" endpoint for the instructor dashboard.
 */
'use strict';

const { LtiIdentityModel, LtiPlatformModel, SimulationScoreModel, AuditModel } = require('../../db/models');
const { getPlatformAccessToken } = require('./platform-oauth.service');

const AGS_SCORE_SCOPE = 'https://purl.imsglobal.org/spec/lti-ags/scope/score';

function computePercentage(rawScore, pointsPossible) {
  if (rawScore == null || !pointsPossible) return null;
  return Math.round((Number(rawScore) / Number(pointsPossible)) * 10000) / 100;
}

/** Applies the resource link's grade policy (best/last/first/average) across all of a user's attempts at this lesson. */
async function resolveEffectiveScore(courseId, lessonId, userId, attemptPolicy) {
  const attempts = (await SimulationScoreModel.listAttemptsForUserLesson(courseId, lessonId, userId))
    .filter((a) => a.raw_score != null);
  if (!attempts.length) return null;

  switch (attemptPolicy) {
    case 'first':
      return attempts[0];
    case 'last':
      return attempts[attempts.length - 1];
    case 'average': {
      const last = attempts[attempts.length - 1];
      const avgRaw = attempts.reduce((sum, a) => sum + Number(a.raw_score), 0) / attempts.length;
      const avgPossible = Number(last.points_possible) || 100;
      return { ...last, raw_score: avgRaw, percentage: computePercentage(avgRaw, avgPossible) };
    }
    case 'best':
    default:
      return attempts.reduce((best, a) => {
        const aPct = a.percentage ?? computePercentage(a.raw_score, a.points_possible) ?? 0;
        const bestPct = best.percentage ?? computePercentage(best.raw_score, best.points_possible) ?? 0;
        return Number(aPct) > Number(bestPct) ? a : best;
      });
  }
}

/**
 * Syncs one simulation_scores row to its LMS gradebook lineitem, if it's
 * linked to an LTI resource link with a captured AGS endpoint. No-op
 * (returns null) for scores that never went through an LTI launch.
 */
exports.syncScoreToAgs = async (scoreId) => {
  const score = await SimulationScoreModel.findById(scoreId);
  if (!score) return null;

  const resourceLink = score.lti_resource_link_id
    ? await LtiIdentityModel.findResourceLinkById(score.lti_resource_link_id)
    : await LtiIdentityModel.findResourceLinkByCourseAndLesson(score.course_id, score.lesson_id);

  if (!resourceLink || !resourceLink.lineitem_url) return null;

  if (!score.lti_resource_link_id) {
    await SimulationScoreModel.update(score.id, { lti_resource_link_id: resourceLink.id });
  }

  const platform = await LtiPlatformModel.findById(resourceLink.platform_id);
  const ltiUser = await LtiIdentityModel.findUserBySimuLearnUserId(score.user_id, platform.id);
  if (!ltiUser) {
    return SimulationScoreModel.update(score.id, {
      ags_sync_status: 'failed', ags_last_error: 'No LTI identity found for this user on this platform.',
      ags_last_sync_at: new Date().toISOString(),
    });
  }

  if (resourceLink.grading_mode === 'completion') return null; // no score to send, completion-only lineitems aren't created

  const effective = await resolveEffectiveScore(score.course_id, score.lesson_id, score.user_id, resourceLink.attempt_policy);
  if (!effective) return null;

  const maxScore = Number(resourceLink.max_score);
  const scoreGiven = effective.percentage != null
    ? Math.round((Number(effective.percentage) / 100) * maxScore * 100) / 100
    : Number(effective.raw_score);

  const payload = {
    timestamp: new Date().toISOString(),
    scoreGiven,
    scoreMaximum: maxScore,
    activityProgress: 'Completed',
    gradingProgress: 'FullyGraded',
    userId: ltiUser.subject,
    comment: 'Synced from SimuLearn.',
  };

  try {
    const token = await getPlatformAccessToken(platform, [AGS_SCORE_SCOPE]);
    const res = await fetch(`${resourceLink.lineitem_url}/scores`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/vnd.ims.lis.v1.score+json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`AGS score POST failed (${res.status}): ${text.slice(0, 300)}`);
    }

    const updated = await SimulationScoreModel.update(score.id, {
      ags_sync_status: 'synced', ags_last_sync_at: new Date().toISOString(), ags_last_error: null,
    });
    await AuditModel.log({
      institutionId: score.institution_id, actorId: null, actorEmail: 'lti-ags:sync',
      action: 'lti_ags.score_synced', entityType: 'SimulationScore', entityId: score.id,
      delta: { after: { scoreGiven: payload.scoreGiven, scoreMaximum: payload.scoreMaximum } },
    }).catch(() => {});
    return updated;
  } catch (err) {
    const retryCount = (score.ags_retry_count ?? 0) + 1;
    const updated = await SimulationScoreModel.update(score.id, {
      ags_sync_status: 'failed', ags_last_error: err.message.slice(0, 500),
      ags_last_sync_at: new Date().toISOString(), ags_retry_count: retryCount,
    });
    await AuditModel.log({
      institutionId: score.institution_id, actorId: null, actorEmail: 'lti-ags:sync',
      action: 'lti_ags.score_sync_failed', entityType: 'SimulationScore', entityId: score.id,
      delta: { reason: err.message },
    }).catch(() => {});
    return updated;
  }
};
