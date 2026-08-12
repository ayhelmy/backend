'use strict';

/**
 * Notification preferences — lazy-upsert-on-read, same pattern used by
 * other per-user settings in this codebase.
 */

const { NotificationPreferenceModel } = require('../../db/models');

function mapPreferences(row) {
  return {
    id:              row.id,
    userId:          row.user_id,
    institutionId:   row.institution_id ?? null,
    emailEnabled:    row.email_enabled,
    inAppEnabled:    row.in_app_enabled,
    pushEnabled:     row.push_enabled,
    digestFrequency: row.digest_frequency,
    preferences:     row.preferences,
    updatedAt:       row.updated_at,
  };
}

exports.get = async (actor) => {
  const row = await NotificationPreferenceModel.ensureForUser(actor.id, actor.institutionId);
  return mapPreferences(row);
};

exports.update = async (actor, body) => {
  const row = await NotificationPreferenceModel.upsert(actor.id, actor.institutionId, {
    emailEnabled:    body.emailEnabled,
    inAppEnabled:    body.inAppEnabled,
    pushEnabled:     body.pushEnabled,
    digestFrequency: body.digestFrequency,
    preferences:     body.preferences,
  });
  return mapPreferences(row);
};
