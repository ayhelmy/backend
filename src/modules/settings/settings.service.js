'use strict';

/**
 * Settings service — SRS §4.16 SET-01 to SET-05.
 * Institution settings: branding stored on institutions table + key-value pairs in settings table.
 * User settings: notification preferences stored in settings table scoped to institution.
 */

const { pool }                        = require('../../config/database');
const { InstitutionModel, AuditModel } = require('../../db/models');
const ApiError                         = require('../../utils/apiError');

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Upsert a settings row. Works for both NULL and non-NULL institution_id. */
async function upsertSetting(institutionId, key, value, updatedBy) {
  if (institutionId === null || institutionId === undefined) {
    // NULL institution_id: ON CONFLICT won't fire (NULLs not equal in UNIQUE).
    // Use manual SELECT + UPDATE/INSERT instead.
    const { rows } = await pool.query(
      `SELECT id FROM settings WHERE institution_id IS NULL AND key = $1`, [key],
    );
    if (rows.length) {
      await pool.query(
        `UPDATE settings SET value = $2::jsonb, updated_at = NOW(), updated_by = $3
          WHERE institution_id IS NULL AND key = $1`,
        [key, JSON.stringify(value), updatedBy ?? null],
      );
    } else {
      await pool.query(
        `INSERT INTO settings (institution_id, key, value, updated_by)
         VALUES (NULL, $1, $2::jsonb, $3)`,
        [key, JSON.stringify(value), updatedBy ?? null],
      );
    }
  } else {
    await pool.query(
      `INSERT INTO settings (institution_id, key, value, updated_by)
       VALUES ($1, $2, $3::jsonb, $4)
       ON CONFLICT (institution_id, key)
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
      [institutionId, key, JSON.stringify(value), updatedBy ?? null],
    );
  }
}

/** Fetch all settings for an institution, merged with platform defaults. */
async function fetchSettingsMap(instId) {
  const { rows } = await pool.query(
    `SELECT key, value
       FROM settings
      WHERE institution_id = $1 OR institution_id IS NULL
      ORDER BY institution_id NULLS FIRST`,
    [instId],
  );
  // platform defaults come first (institution_id IS NULL), institution overrides last
  const map = {};
  for (const row of rows) map[row.key] = row.value;
  return map;
}

// ── Institution Settings ──────────────────────────────────────────────────────

exports.getInstitution = async (instId) => {
  if (!instId) throw ApiError.badRequest('No institution associated with your account.');

  const inst = await InstitutionModel.findById(instId);
  if (!inst) throw ApiError.notFound('Institution not found.');

  const sm = await fetchSettingsMap(instId);

  return {
    // Branding (from institutions table)
    id:           inst.id,
    name:         inst.name,
    slug:         inst.slug,
    domain:       inst.domain      ?? null,
    logoUrl:      inst.logo_url    ?? null,
    primaryColor: inst.primary_color,
    timezone:     inst.timezone,
    locale:       inst.locale,
    subscriptionPlan: inst.subscription_plan,
    maxUsers:     inst.max_users,
    status:       inst.status,
    // Enrollment policy (from institutions.settings JSONB)
    enrollmentType:   inst.settings?.enrollment_type   ?? 'open',
    enrollmentCap:    inst.settings?.enrollment_cap    ?? null,
    requireApproval:  inst.settings?.require_approval  ?? false,
    // From settings table key-value pairs
    notificationEmailEnabled:  sm['notifications.email_enabled']          ?? true,
    notificationPushEnabled:   sm['notifications.push_enabled']           ?? true,
    maxSimAttempts:            sm['simulations.max_attempts_default']     ?? 3,
    passScore:                 sm['simulations.pass_score_default']       ?? 70,
    requireEmailVerification:  sm['auth.require_email_verification']      ?? true,
    sessionDurationDays:       sm['auth.session_duration_days']           ?? 7,
  };
};

exports.updateInstitution = async (instId, body, actor) => {
  if (!instId) throw ApiError.badRequest('No institution associated with your account.');

  const inst = await InstitutionModel.findById(instId);
  if (!inst) throw ApiError.notFound('Institution not found.');

  // Branding fields → institutions table
  const instFields = {};
  if (body.name         !== undefined) instFields.name          = body.name.trim();
  if (body.logoUrl      !== undefined) instFields.logo_url      = body.logoUrl;
  if (body.primaryColor !== undefined) instFields.primary_color = body.primaryColor;
  if (body.timezone     !== undefined) instFields.timezone      = body.timezone;
  if (body.locale       !== undefined) instFields.locale        = body.locale;

  // Enrollment policy → institutions.settings JSONB
  const instSettings = { ...(inst.settings ?? {}) };
  let settingsChanged = false;
  if (body.enrollmentType  !== undefined) { instSettings.enrollment_type  = body.enrollmentType;  settingsChanged = true; }
  if (body.enrollmentCap   !== undefined) { instSettings.enrollment_cap   = body.enrollmentCap;   settingsChanged = true; }
  if (body.requireApproval !== undefined) { instSettings.require_approval = body.requireApproval; settingsChanged = true; }
  if (settingsChanged) instFields.settings = instSettings;

  if (Object.keys(instFields).length > 0) {
    await InstitutionModel.update(instId, instFields);
  }

  // Key-value overrides → settings table
  const kvMap = {
    'notifications.email_enabled':      body.notificationEmailEnabled,
    'notifications.push_enabled':       body.notificationPushEnabled,
    'simulations.max_attempts_default': body.maxSimAttempts,
    'simulations.pass_score_default':   body.passScore,
    'auth.require_email_verification':  body.requireEmailVerification,
    'auth.session_duration_days':       body.sessionDurationDays,
  };

  for (const [key, val] of Object.entries(kvMap)) {
    if (val !== undefined) {
      await upsertSetting(instId, key, val, actor.id);
    }
  }

  await AuditModel.log({
    institutionId: instId,
    actorId: actor.id, actorEmail: actor.email,
    action: 'institution.settings.update', entityType: 'Institution', entityId: instId,
    delta: { after: { ...instFields, ...Object.fromEntries(Object.entries(kvMap).filter(([, v]) => v !== undefined)) } },
  });

  return exports.getInstitution(instId);
};

// ── User Settings ─────────────────────────────────────────────────────────────

const userPrefsKey = (userId) => `user_prefs:${userId}`;

const DEFAULT_USER_PREFS = {
  locale: 'en',
  notificationPreferences: {
    courseUpdates:  true,
    gradePosted:    true,
    newMessages:    true,
    systemAnnounce: true,
    weeklyDigest:   false,
  },
};

exports.getUserSettings = async (userId, institutionId) => {
  const key = userPrefsKey(userId);
  // Store under institutionId if available; NULL otherwise (super_admin)
  const instId = institutionId ?? null;

  if (instId) {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE institution_id = $1 AND key = $2`,
      [instId, key],
    );
    return rows.length ? { ...DEFAULT_USER_PREFS, ...rows[0].value } : { ...DEFAULT_USER_PREFS };
  } else {
    const { rows } = await pool.query(
      `SELECT value FROM settings WHERE institution_id IS NULL AND key = $1`,
      [key],
    );
    return rows.length ? { ...DEFAULT_USER_PREFS, ...rows[0].value } : { ...DEFAULT_USER_PREFS };
  }
};

exports.updateUserSettings = async (userId, body, institutionId) => {
  const key     = userPrefsKey(userId);
  const instId  = institutionId ?? null;
  const current = await exports.getUserSettings(userId, institutionId);
  const updated = { ...current, ...body };
  await upsertSetting(instId, key, updated, userId);
  return updated;
};
