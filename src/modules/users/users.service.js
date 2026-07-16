'use strict';

/**
 * Users service — SRS §4.2 USR-01 to USR-06; §10.2 Users API. RBAC v2.
 * Permission codes now use dot notation (v2 matrix).
 */

const { pool }        = require('../../config/database');
const redis           = require('../../config/redis');
const { UserModel, RoleModel, AuditModel, InstitutionModel } = require('../../db/models');
const { hashPassword, comparePassword, randomToken }         = require('../../utils/crypto');
const { sendVerificationEmail, sendInviteEmail }              = require('../../utils/email');
const { parsePagination, buildPaginationMeta }               = require('../../utils/pagination');
const ApiError        = require('../../utils/apiError');
const { parse: csvParse } = require('csv-parse/sync');
const { ROLES, ASSIGNABLE_ROLES, SUPER_ONLY_ROLES } = require('../../constants/roles');

// ── Helpers ───────────────────────────────────────────────────────────────────

function mapUser(row) {
  return {
    id:            row.id,
    email:         row.email,
    firstName:     row.first_name,
    lastName:      row.last_name,
    avatarUrl:     row.avatar_url  ?? null,
    bio:           row.bio         ?? null,
    status:        row.status,
    institutionId: row.institution_id,
    departmentId:  row.department_id ?? null,
    lastLoginAt:   row.last_login_at ?? null,
    createdAt:     row.created_at,
    updatedAt:     row.updated_at  ?? null,
    roles:         row.roles ?? [],
    currentStudentAssignment: row.current_student_assignment ?? null,
  };
}

function invalidatePermCache(userId, institutionId) {
  redis.del(`user_perms:${userId}:${institutionId ?? 'null'}`).catch(() => {});
}

async function revokeAllSessions(userId) {
  const key    = `user_sessions:${userId}`;
  const tokens = await redis.smembers(key).catch(() => []);
  if (!tokens.length) return;
  const pipeline = redis.pipeline();
  tokens.forEach((t) => pipeline.del(`refresh:${t}`));
  pipeline.del(key);
  await pipeline.exec().catch(() => {});
}

// Roles that can be assigned by institution_admin or higher
const VALID_ASSIGNABLE_ROLES = [...ASSIGNABLE_ROLES, ...SUPER_ONLY_ROLES];

// Numeric rank — lower number means higher privilege in the hierarchy
const ROLE_RANK = {
  [ROLES.SUPER_ADMIN]:        0,
  [ROLES.INSTITUTION_ADMIN]:  1,
  [ROLES.DEPT_MANAGER]:       2,
  [ROLES.INSTRUCTOR]:         3,
  [ROLES.TEACHING_ASSISTANT]: 4,
  [ROLES.STUDENT]:            5,
  [ROLES.GUEST]:              6,
};

/**
 * Returns role names that are strictly higher-ranked than the actor's best role.
 * Used to filter them out of list results so users can never see peers above them.
 * Returns [] for super_admin (rank 0 — nothing is higher).
 */
function getRestrictedRoles(actorRoles) {
  if (!actorRoles?.length) return [];
  const actorRank = Math.min(...actorRoles.map((r) => ROLE_RANK[r] ?? 99));
  if (actorRank === 0) return []; // super_admin — no restriction
  return Object.entries(ROLE_RANK)
    .filter(([, rank]) => rank < actorRank)
    .map(([name]) => name);
}

// ── list ──────────────────────────────────────────────────────────────────────

exports.list = async (query, actor) => {
  const canViewAll   = actor.permissions?.includes('users.view_all');
  const canViewInst  = actor.permissions?.includes('users.view_institution');
  const canViewDept  = actor.permissions?.includes('users.view_department');

  if (!canViewAll && !canViewInst && !canViewDept) {
    throw ApiError.forbidden('Missing required permission: users.view_institution.');
  }

  const { page, limit, offset } = parsePagination(query);
  const { search, status, role } = query;

  const filterParams = [];
  const filters      = ['u.deleted_at IS NULL'];

  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  const isDeptManager = actor.roles?.includes(ROLES.DEPT_MANAGER);

  if (!isSuperAdmin) {
    filterParams.push(actor.institutionId);
    filters.push(`u.institution_id = $${filterParams.length}`);
  }

  // dept_manager only sees users enrolled in their department's courses
  if (isDeptManager && canViewDept && !canViewInst && !canViewAll) {
    const deptIds = await RoleModel.getUserDepartments(actor.id);
    if (deptIds.length) {
      filterParams.push(deptIds);
      filters.push(`u.id IN (
        SELECT DISTINCT e.user_id
          FROM enrollments e
          JOIN courses c ON c.id = e.course_id
         WHERE c.department_id = ANY($${filterParams.length})
           AND c.deleted_at IS NULL
           AND e.status != 'dropped'
      )`);
    } else {
      // dept_manager has no departments — return empty
      return { users: [], meta: buildPaginationMeta(0, page, limit) };
    }
  }

  // Exclude users who hold any role ranked above the actor's own highest role.
  // e.g. institution_admin cannot list super_admin accounts.
  const restrictedRoles = getRestrictedRoles(actor.roles);
  if (restrictedRoles.length > 0) {
    filterParams.push(restrictedRoles);
    filterParams.push(actor.institutionId ?? null);
    filters.push(`u.id NOT IN (
      SELECT DISTINCT ur_h.user_id
        FROM user_roles ur_h
        JOIN roles r_h ON r_h.id = ur_h.role_id
       WHERE r_h.name = ANY($${filterParams.length - 1})
         AND (ur_h.institution_id = $${filterParams.length} OR ur_h.institution_id IS NULL)
    )`);
  }

  if (search) {
    filterParams.push(`%${search.toLowerCase()}%`);
    const idx = filterParams.length;
    filters.push(
      `(LOWER(u.email) LIKE $${idx} OR LOWER(CONCAT(u.first_name,' ',u.last_name)) LIKE $${idx})`,
    );
  }
  if (status) {
    filterParams.push(status);
    filters.push(`u.status = $${filterParams.length}`);
  }

  let roleJoin = '';
  if (role) {
    filterParams.push(role);
    roleJoin = `
      JOIN user_roles ur_f ON ur_f.user_id = u.id
      JOIN roles r_f ON r_f.id = ur_f.role_id AND r_f.name = $${filterParams.length}
    `;
  }

  const where    = `WHERE ${filters.join(' AND ')}`;
  const countSql = `SELECT COUNT(DISTINCT u.id) AS total FROM users u ${roleJoin} ${where}`;
  const listSql  = `
    SELECT u.id, u.email, u.first_name, u.last_name, u.avatar_url, u.bio,
           u.status, u.institution_id, u.last_login_at, u.created_at, u.updated_at,
           COALESCE((
             SELECT JSON_AGG(JSON_BUILD_OBJECT('id',r.id,'name',r.name,'label',r.label))
             FROM user_roles ur2 JOIN roles r ON r.id = ur2.role_id
             WHERE ur2.user_id = u.id
               AND (ur2.institution_id = u.institution_id OR ur2.institution_id IS NULL)
               AND r.label NOT LIKE '[DEPRECATED]%'
           ), '[]'::json) AS roles,
           (
             SELECT JSON_BUILD_OBJECT(
               'id',         uaa.id,
               'departmentId',     uaa.department_id,
               'departmentName',   d.name,
               'departmentCode',   d.code,
               'academicYearId',   uaa.academic_year_id,
               'academicYearName', ay.name,
               'semesterTermId',   uaa.semester_term_id,
               'semesterTermName', st.name
             )
             FROM user_academic_assignments uaa
             JOIN departments  d  ON d.id  = uaa.department_id
             JOIN academic_years ay ON ay.id = uaa.academic_year_id
             JOIN semester_terms st ON st.id = uaa.semester_term_id
             WHERE uaa.user_id       = u.id
               AND uaa.role_context  = 'student'
               AND uaa.is_current    = true
             LIMIT 1
           ) AS current_student_assignment
    FROM users u ${roleJoin} ${where}
    ORDER BY u.last_name, u.first_name
    LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
  `;

  const listParams = [...filterParams, limit, offset];

  const [countResult, listResult] = await Promise.all([
    pool.query(countSql, filterParams),
    pool.query(listSql, listParams),
  ]);

  const total = parseInt(countResult.rows[0].total, 10);
  return {
    users: listResult.rows.map(mapUser),
    meta:  buildPaginationMeta(total, page, limit),
  };
};

// ── getOne ────────────────────────────────────────────────────────────────────

exports.getOne = async (id, actor) => {
  const isSelf  = actor.id === id;
  const canView = actor.permissions?.includes('users.view_all') ||
                  actor.permissions?.includes('users.view_institution') ||
                  actor.permissions?.includes('users.view_department') ||
                  actor.permissions?.includes('users.view_course');
  if (!isSelf && !canView) {
    throw ApiError.forbidden('Missing required permission: users.view_institution.');
  }

  const user = await UserModel.findWithRoles(id);
  if (!user) throw ApiError.notFound('User not found.');

  // Scope: non-super-admin cannot see users from other institutions
  if (!actor.roles?.includes(ROLES.SUPER_ADMIN) && !isSelf) {
    if (user.institution_id !== actor.institutionId) {
      throw ApiError.notFound('User not found.');
    }
  }

  const roles = await RoleModel.getUserRolesWithPermissions(id, user.institution_id);
  const permissions = [...new Set(roles.flatMap((r) => r.permissions ?? []))];

  return {
    ...mapUser(user),
    roles:              roles.map((r) => ({ id: r.id, name: r.name, label: r.label })),
    permissions,
    managedDepartments: user.managed_departments ?? [],
    enrolledCourseIds:  user.enrolled_course_ids ?? [],
    taCourseIds:        user.ta_course_ids ?? [],
  };
};

// ── create ────────────────────────────────────────────────────────────────────

exports.create = async (body, actor) => {
  const canCreate = actor.permissions?.includes('users.create');
  if (!canCreate) throw ApiError.forbidden('Missing required permission: users.create.');

  const { email, firstName, lastName, role } = body;
  const normEmail = email.toLowerCase().trim();

  const { rows: existing } = await pool.query(
    'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [normEmail],
  );
  if (existing.length) throw ApiError.conflict('A user with this email already exists.');

  // Resolve target institution
  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  let institutionId;

  if (isSuperAdmin && body.institutionId) {
    institutionId = body.institutionId;
  } else if (isSuperAdmin) {
    const emailDomain = normEmail.split('@')[1];
    const inst = emailDomain ? await InstitutionModel.findByEmailDomain(emailDomain) : null;
    if (!inst) {
      throw ApiError.badRequest(
        'Cannot resolve institution from this email domain. Provide institutionId explicitly.',
      );
    }
    institutionId = inst.id;
  } else {
    institutionId = actor.institutionId;
  }

  const institution = await InstitutionModel.findById(institutionId);
  if (!institution) throw ApiError.badRequest('Target institution not found.');

  const activeCount = await UserModel.countByInstitution(institutionId);
  if (activeCount >= institution.max_users) {
    throw ApiError.badRequest(`${institution.name} has reached its maximum user limit (${institution.max_users}).`);
  }

  const tempPassword = randomToken(12);
  const passwordHash = await hashPassword(tempPassword);

  const user = await UserModel.create({
    email: normEmail, passwordHash,
    firstName: firstName.trim(), lastName: lastName.trim(),
    institutionId, status: 'pending',
  });

  if (role) {
    if (!VALID_ASSIGNABLE_ROLES.includes(role)) {
      throw ApiError.badRequest(`Invalid role "${role}". Valid roles: ${VALID_ASSIGNABLE_ROLES.join(', ')}`);
    }
    if (SUPER_ONLY_ROLES.includes(role) && !isSuperAdmin) {
      throw ApiError.forbidden(`Only super admins can assign the ${role} role.`);
    }
    await RoleModel.assignRole(user.id, role, institutionId, actor.id);
  }

  const inviteToken = randomToken(32);
  await redis.setex(`pwd_reset:${inviteToken}`, 24 * 60 * 60, user.id);
  sendInviteEmail(user.email, inviteToken).catch(() => {});

  await AuditModel.log({
    institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'user.create', entityType: 'User', entityId: user.id,
    delta: { after: { email: user.email, role: role ?? null, institutionId } },
  });

  const roles = role ? await RoleModel.getUserRolesWithPermissions(user.id, institutionId) : [];
  return { ...mapUser(user), roles: roles.map((r) => ({ id: r.id, name: r.name, label: r.label })) };
};

// ── update ────────────────────────────────────────────────────────────────────

exports.update = async (id, body, actor) => {
  const isSelf      = actor.id === id;
  const canEditAll  = actor.permissions?.includes('users.update_all');
  const canEditInst = actor.permissions?.includes('users.update_institution');
  const canEditDept = actor.permissions?.includes('users.update_department');
  const canEdit     = canEditAll || canEditInst || canEditDept;

  if (!isSelf && !canEdit) throw ApiError.forbidden('You can only edit your own profile.');

  const before = await UserModel.findById(id);
  if (!before) throw ApiError.notFound('User not found.');

  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  if (!isSuperAdmin && !isSelf && before.institution_id !== actor.institutionId) {
    throw ApiError.notFound('User not found.');
  }

  const fields = {};
  if (body.firstName !== undefined) fields.first_name = body.firstName.trim();
  if (body.lastName  !== undefined) fields.last_name  = body.lastName.trim();
  if (body.avatarUrl !== undefined) fields.avatar_url = body.avatarUrl;
  if (body.bio       !== undefined) fields.bio        = body.bio;

  if (body.status !== undefined && canEdit) {
    if (body.status === 'suspended' && isSelf) {
      throw ApiError.badRequest('You cannot suspend your own account.');
    }
    if (body.status === 'suspended' && !actor.permissions?.includes('users.suspend')) {
      throw ApiError.forbidden('Missing required permission: users.suspend.');
    }
    fields.status = body.status;
    if (body.status === 'suspended') {
      await revokeAllSessions(id);
      invalidatePermCache(id, before.institution_id);

      await AuditModel.log({
        institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
        action: 'user.suspend', entityType: 'User', entityId: id,
        delta: { before: { status: before.status }, after: { status: 'suspended' } },
      });
    } else if (body.status === 'active') {
      invalidatePermCache(id, before.institution_id);
    }
  }

  const after = await UserModel.update(id, fields);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'user.update', entityType: 'User', entityId: id,
    delta: { before: { status: before.status }, after: fields },
  });

  const roles = await RoleModel.getUserRolesWithPermissions(id, after.institution_id);
  return { ...mapUser(after), roles: roles.map((r) => ({ id: r.id, name: r.name, label: r.label })) };
};

// ── remove ────────────────────────────────────────────────────────────────────

exports.remove = async (id, actor) => {
  const canDelete = actor.permissions?.includes('users.delete');
  if (!canDelete) throw ApiError.forbidden('Missing required permission: users.delete.');
  if (actor.id === id) throw ApiError.badRequest('You cannot delete your own account.');

  const target = await UserModel.findById(id);
  if (!target) throw ApiError.notFound('User not found.');

  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  if (!isSuperAdmin && target.institution_id !== actor.institutionId) {
    throw ApiError.notFound('User not found.');
  }

  const targetRoles = await RoleModel.getUserRolesWithPermissions(id, target.institution_id);
  if (targetRoles.some((r) => r.name === ROLES.SUPER_ADMIN) && !isSuperAdmin) {
    throw ApiError.forbidden('Only a super admin can delete another super admin account.');
  }

  await revokeAllSessions(id);
  await UserModel.softDelete(id);
  invalidatePermCache(id, target.institution_id);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'user.delete', entityType: 'User', entityId: id,
    delta: { before: { email: target.email } },
  });
};

// ── changePassword ────────────────────────────────────────────────────────────

exports.changePassword = async (id, body, actor) => {
  const isSelf      = actor.id === id;
  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  const canUpdateAll  = actor.permissions?.includes('users.update_all');
  const canUpdateInst = actor.permissions?.includes('users.update_institution');
  const isAdmin = canUpdateAll || canUpdateInst;

  if (!isSelf && !isAdmin) throw ApiError.forbidden('You can only change your own password.');

  // Always load the target user first so we can scope-check before acting
  const { rows } = await pool.query(
    'SELECT id, institution_id, password_hash FROM users WHERE id = $1 AND deleted_at IS NULL', [id],
  );
  const target = rows[0];
  if (!target) throw ApiError.notFound('User not found.');

  // Cross-institution guard: non-super-admin admin cannot change passwords across institutions
  if (!isSelf && !isSuperAdmin && target.institution_id !== actor.institutionId) {
    throw ApiError.notFound('User not found.');
  }

  if (isSelf) {
    if (!body.currentPassword) throw ApiError.badRequest('Current password is required.');
    const valid = await comparePassword(body.currentPassword, target.password_hash);
    if (!valid) throw ApiError.badRequest('Current password is incorrect.');
  }

  const newHash = await hashPassword(body.newPassword);
  await pool.query(
    'UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2', [newHash, id],
  );

  if (!isSelf) {
    await revokeAllSessions(id);
    invalidatePermCache(id, actor.institutionId);
  }

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'user.password_change', entityType: 'User', entityId: id,
    delta: { meta: { byAdmin: !isSelf } },
  });
};

// ── getRoles ──────────────────────────────────────────────────────────────────

exports.getRoles = async (id, actor) => {
  const isSelf  = actor.id === id;
  const canView = actor.permissions?.includes('users.view_institution') ||
                  actor.permissions?.includes('users.view_all') ||
                  actor.permissions?.includes('users.assign_roles');
  if (!isSelf && !canView) throw ApiError.forbidden('Missing required permission: users.view_institution.');

  const user = await UserModel.findById(id);
  if (!user) throw ApiError.notFound('User not found.');

  // Cross-institution guard
  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  if (!isSelf && !isSuperAdmin && user.institution_id !== actor.institutionId) {
    throw ApiError.notFound('User not found.');
  }

  return RoleModel.getUserRolesWithPermissions(id, user.institution_id);
};

// ── assignRole ────────────────────────────────────────────────────────────────

exports.assignRole = async (userId, body, actor) => {
  const canAssign = actor.permissions?.includes('users.assign_roles');
  if (!canAssign) throw ApiError.forbidden('Missing required permission: users.assign_roles.');

  const { roleName } = body;
  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);

  if (SUPER_ONLY_ROLES.includes(roleName) && !isSuperAdmin) {
    throw ApiError.forbidden(`Only super admins can assign the ${roleName} role.`);
  }

  const target = await UserModel.findById(userId);
  if (!target) throw ApiError.notFound('User not found.');

  const institutionId = target.institution_id ?? actor.institutionId;
  if (!isSuperAdmin && institutionId !== actor.institutionId) {
    throw ApiError.forbidden('You can only assign roles within your own institution.');
  }

  await RoleModel.assignRole(userId, roleName, institutionId, actor.id);
  invalidatePermCache(userId, institutionId);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'role.assign', entityType: 'User', entityId: userId,
    delta: { after: { roleName } },
  });

  return RoleModel.getUserRolesWithPermissions(userId, institutionId);
};

// ── revokeRole ────────────────────────────────────────────────────────────────

exports.revokeRole = async (userId, roleId, actor) => {
  const canRevoke = actor.permissions?.includes('users.assign_roles');
  if (!canRevoke) throw ApiError.forbidden('Missing required permission: users.assign_roles.');

  const { rows: [role] } = await pool.query('SELECT name FROM roles WHERE id = $1', [roleId]);
  if (!role) throw ApiError.notFound('Role not found.');

  if (actor.id === userId && role.name === ROLES.SUPER_ADMIN) {
    throw ApiError.badRequest('You cannot revoke your own super admin role.');
  }

  // Cross-institution guard: non-super-admin cannot revoke roles in another institution
  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  if (!isSuperAdmin) {
    const target = await UserModel.findById(userId);
    if (!target || target.institution_id !== actor.institutionId) {
      throw ApiError.notFound('User not found.');
    }
    // institution_admin cannot revoke SUPER_ONLY_ROLES
    if (SUPER_ONLY_ROLES.includes(role.name)) {
      throw ApiError.forbidden(`Only super admins can revoke the ${role.name} role.`);
    }
  }

  await RoleModel.revokeRole(userId, role.name, actor.institutionId);
  invalidatePermCache(userId, actor.institutionId);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'role.revoke', entityType: 'User', entityId: userId,
    delta: { before: { roleName: role.name } },
  });
};

// ── assignDepartment ──────────────────────────────────────────────────────────

exports.assignDepartment = async (userId, body, actor) => {
  const canAssign = actor.permissions?.includes('users.assign_department') ||
                    actor.permissions?.includes('departments.assign_manager');
  if (!canAssign) throw ApiError.forbidden('Missing required permission: users.assign_department.');

  const { departmentId } = body;
  const user = await UserModel.findById(userId);
  if (!user) throw ApiError.notFound('User not found.');

  // Verify department belongs to actor's institution
  const { rows: [dept] } = await pool.query(
    'SELECT id, institution_id FROM departments WHERE id = $1', [departmentId],
  );
  if (!dept) throw ApiError.notFound('Department not found.');

  const isSuperAdmin = actor.roles?.includes(ROLES.SUPER_ADMIN);
  if (!isSuperAdmin && dept.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Department does not belong to your institution.');
  }

  await RoleModel.assignDepartment(userId, departmentId, actor.id);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'user.assign_department', entityType: 'User', entityId: userId,
    delta: { after: { departmentId } },
  });

  return RoleModel.getUserDepartments(userId);
};

// ── revokeDepartment ──────────────────────────────────────────────────────────

exports.revokeDepartment = async (userId, deptId, actor) => {
  const canRevoke = actor.permissions?.includes('users.assign_department') ||
                    actor.permissions?.includes('departments.assign_manager');
  if (!canRevoke) throw ApiError.forbidden('Missing required permission: users.assign_department.');

  await RoleModel.revokeDepartment(userId, deptId);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'user.revoke_department', entityType: 'User', entityId: userId,
    delta: { before: { departmentId: deptId } },
  });
};

// ── Bulk import (SRS USR-06) ──────────────────────────────────────────────────

exports.importValidate = async (fileBuffer, actor) => {
  if (!actor.permissions?.includes('users.create')) {
    throw ApiError.forbidden('Missing required permission: users.create.');
  }

  let rows;
  try {
    rows = csvParse(fileBuffer, { columns: true, skip_empty_lines: true, trim: true });
  } catch (err) {
    throw ApiError.badRequest(`Invalid CSV: ${err.message}`);
  }
  if (!rows.length) throw ApiError.badRequest('CSV file is empty.');

  const emails = rows.map((r) => (r.email || '').toLowerCase().trim()).filter(Boolean);
  const { rows: existing } = emails.length
    ? await pool.query('SELECT email FROM users WHERE email = ANY($1) AND deleted_at IS NULL', [emails])
    : { rows: [] };
  const existingEmails = new Set(existing.map((r) => r.email));

  const valid  = [];
  const errors = [];
  const emailSet = new Set();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowErrors = [];
    const email     = (row.email || '').toLowerCase().trim();
    const firstName = (row.firstName || row.first_name || '').trim();
    const lastName  = (row.lastName  || row.last_name  || '').trim();
    const role      = (row.role || 'student').trim();

    if (!email)                                              rowErrors.push('Email is required');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))    rowErrors.push('Invalid email format');
    else if (existingEmails.has(email))                      rowErrors.push('Email already exists');
    else if (emailSet.has(email))                            rowErrors.push('Duplicate email in CSV');

    if (!firstName) rowErrors.push('First name is required');
    if (!lastName)  rowErrors.push('Last name is required');
    if (role && !VALID_ASSIGNABLE_ROLES.includes(role)) {
      rowErrors.push(`Invalid role "${role}". Valid: ${ASSIGNABLE_ROLES.join(', ')}`);
    }

    if (rowErrors.length) {
      errors.push({ row: i + 2, email, errors: rowErrors });
    } else {
      emailSet.add(email);
      valid.push({ email, firstName, lastName, role });
    }
  }

  return {
    valid,
    errors,
    summary: { total: rows.length, validCount: valid.length, errorCount: errors.length },
  };
};

exports.importConfirm = async (rows, actor) => {
  if (!actor.permissions?.includes('users.create')) {
    throw ApiError.forbidden('Missing required permission: users.create.');
  }

  const institutionId = actor.institutionId;
  const created = [];
  const failed  = [];

  for (const row of rows) {
    try {
      const normEmail = row.email.toLowerCase().trim();
      const { rows: dup } = await pool.query(
        'SELECT id FROM users WHERE email = $1 AND deleted_at IS NULL', [normEmail],
      );
      if (dup.length) { failed.push({ email: normEmail, error: 'Email already exists' }); continue; }

      const passwordHash = await hashPassword(randomToken(12));
      const user         = await UserModel.create({
        email: normEmail, passwordHash,
        firstName: row.firstName, lastName: row.lastName,
        institutionId, status: 'pending',
      });

      if (row.role) await RoleModel.assignRole(user.id, row.role, institutionId, actor.id);

      const inviteToken = randomToken(32);
      await redis.setex(`pwd_reset:${inviteToken}`, 24 * 60 * 60, user.id);
      sendInviteEmail(user.email, inviteToken).catch(() => {});

      created.push({ email: user.email, id: user.id });
    } catch (err) {
      failed.push({ email: row.email, error: err.message });
    }
  }

  await AuditModel.log({
    institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'user.bulk_import', entityType: 'User', entityId: null,
    delta: { after: { created: created.length, failed: failed.length } },
  });

  return { created, failed };
};
