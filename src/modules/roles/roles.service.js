'use strict';

/**
 * Roles & permissions service — SRS §4.3 PERM-01 to PERM-04; §12 RBAC matrix.
 */

const { pool }       = require('../../config/database');
const redis          = require('../../config/redis');
const { RoleModel, UserModel, AuditModel } = require('../../db/models');
const ApiError       = require('../../utils/apiError');
const { SUPER_ONLY_ROLES } = require('../../constants/roles');

// ── Helpers ───────────────────────────────────────────────────────────────────

async function invalidateRolePermCaches(roleId) {
  const { rows } = await pool.query(
    `SELECT DISTINCT ur.user_id, u.institution_id
       FROM user_roles ur
       JOIN users u ON u.id = ur.user_id
      WHERE ur.role_id = $1`,
    [roleId],
  );
  if (!rows.length) return;
  const pipeline = redis.pipeline();
  rows.forEach(({ user_id, institution_id }) => {
    pipeline.del(`user_perms:${user_id}:${institution_id ?? 'null'}`);
  });
  await pipeline.exec().catch(() => {});
}

function mapRole(row) {
  if (!row) return null;
  return {
    id:          row.id,
    name:        row.name,
    label:       row.label,
    description: row.description ?? null,
    isSystem:    row.is_system,
    permissions: row.permissions ?? [],
    createdAt:   row.created_at,
  };
}

// ── listRoles ─────────────────────────────────────────────────────────────────

exports.listRoles = async (actor) => {
  if (!actor?.permissions?.includes('roles.manage')) {
    throw ApiError.forbidden('Missing required permission: roles.manage.');
  }
  const { rows } = await pool.query(
    `SELECT r.id, r.name, r.label, r.description, r.is_system, r.created_at,
            COALESCE(
              ARRAY_AGG(DISTINCT p.code) FILTER (WHERE p.code IS NOT NULL),
              '{}'::text[]
            ) AS permissions
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      GROUP BY r.id, r.name, r.label, r.description, r.is_system, r.created_at
      ORDER BY r.is_system DESC, r.name`,
  );
  return rows.map(mapRole);
};

// ── listPermissions (for a specific role) ─────────────────────────────────────

exports.listPermissions = async (roleId) => {
  const { rows: [role] } = await pool.query('SELECT name FROM roles WHERE id = $1', [roleId]);
  if (!role) throw ApiError.notFound('Role not found.');
  return RoleModel.getRolePermissions(role.name);
};

// ── listAllPermissions ────────────────────────────────────────────────────────

exports.listAllPermissions = async () => {
  return RoleModel.listPermissions();
};

// ── addPermission ─────────────────────────────────────────────────────────────

exports.addPermission = async (roleId, body, actor) => {
  if (!actor.permissions?.includes('roles.manage')) {
    throw ApiError.forbidden('Missing required permission: roles.manage.');
  }

  const { rows: [role] } = await pool.query('SELECT * FROM roles WHERE id = $1', [roleId]);
  if (!role) throw ApiError.notFound('Role not found.');

  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (role.is_system && !isSuperAdmin) {
    throw ApiError.forbidden('System roles can only be modified by super admins.');
  }

  const { permissionCode } = body;
  const { rows: [perm] }   = await pool.query('SELECT id FROM permissions WHERE code = $1', [permissionCode]);
  if (!perm) throw ApiError.notFound(`Permission '${permissionCode}' not found.`);

  await pool.query(
    'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
    [roleId, perm.id],
  );

  await invalidateRolePermCaches(roleId);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'role.permission_add', entityType: 'Role', entityId: roleId,
    delta: { after: { permissionCode } },
  });

  return RoleModel.getRolePermissions(role.name);
};

// ── removePermission ──────────────────────────────────────────────────────────

exports.removePermission = async (roleId, permId, actor) => {
  if (!actor.permissions?.includes('roles.manage')) {
    throw ApiError.forbidden('Missing required permission: roles.manage.');
  }

  const { rows: [role] } = await pool.query('SELECT * FROM roles WHERE id = $1', [roleId]);
  if (!role) throw ApiError.notFound('Role not found.');
  if (role.is_system) {
    throw ApiError.forbidden('Cannot modify permissions of a system role.');
  }

  await pool.query(
    'DELETE FROM role_permissions WHERE role_id = $1 AND permission_id = $2',
    [roleId, permId],
  );

  await invalidateRolePermCaches(roleId);

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'role.permission_remove', entityType: 'Role', entityId: roleId,
    delta: { before: { permId } },
  });
};

// ── assignRole (called from roles.routes /assign endpoint) ───────────────────

exports.assignRole = async (body, actor) => {
  const canAssign = actor.permissions?.includes('roles.manage') || actor.permissions?.includes('users.update_all');
  if (!canAssign) throw ApiError.forbidden('Missing required permission: roles.manage.');

  const { userId, roleName, institutionId: targetInstitution } = body;
  const effectiveInstitution = targetInstitution ?? actor.institutionId;
  const isSuperAdmin         = actor.roles?.includes('super_admin');

  if (SUPER_ONLY_ROLES.includes(roleName) && !isSuperAdmin) {
    throw ApiError.forbidden(`Only super admins can assign the ${roleName} role.`);
  }
  if (!isSuperAdmin && effectiveInstitution !== actor.institutionId) {
    throw ApiError.forbidden('You can only assign roles within your own institution.');
  }

  const target = await UserModel.findById(userId);
  if (!target) throw ApiError.notFound('User not found.');

  await RoleModel.assignRole(userId, roleName, effectiveInstitution, actor.id);
  redis.del(`user_perms:${userId}:${effectiveInstitution ?? 'null'}`).catch(() => {});

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'role.assign', entityType: 'User', entityId: userId,
    delta: { after: { roleName } },
  });

  return RoleModel.getUserRolesWithPermissions(userId, effectiveInstitution);
};

// ── revokeRole ────────────────────────────────────────────────────────────────

exports.revokeRole = async (userId, roleId, actor) => {
  const canRevoke = actor.permissions?.includes('roles.manage') || actor.permissions?.includes('users.update_all');
  if (!canRevoke) throw ApiError.forbidden('Missing required permission: roles.manage.');

  const { rows: [role] } = await pool.query('SELECT name FROM roles WHERE id = $1', [roleId]);
  if (!role) throw ApiError.notFound('Role not found.');

  if (actor.id === userId && role.name === 'super_admin') {
    throw ApiError.badRequest('You cannot revoke your own super admin role.');
  }

  await RoleModel.revokeRole(userId, role.name, actor.institutionId);
  redis.del(`user_perms:${userId}:${actor.institutionId ?? 'null'}`).catch(() => {});

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'role.revoke', entityType: 'User', entityId: userId,
    delta: { before: { roleName: role.name } },
  });
};

// ── createRole (PERM-03 — custom roles) ──────────────────────────────────────

exports.createRole = async (body, actor) => {
  if (!actor.permissions?.includes('roles.manage')) {
    throw ApiError.forbidden('Missing required permission: roles.manage.');
  }

  const { name, label, description, permissionCodes = [] } = body;

  const { rows: existing } = await pool.query('SELECT id FROM roles WHERE name = $1', [name]);
  if (existing.length) throw ApiError.conflict(`Role name '${name}' is already taken.`);

  const { rows: [role] } = await pool.query(
    `INSERT INTO roles (name, label, description, is_system)
     VALUES ($1, $2, $3, FALSE) RETURNING *`,
    [name, label, description ?? null],
  );

  if (permissionCodes.length) {
    const { rows: perms } = await pool.query(
      'SELECT id FROM permissions WHERE code = ANY($1)', [permissionCodes],
    );
    for (const { id: permId } of perms) {
      await pool.query(
        'INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [role.id, permId],
      );
    }
  }

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'role.create', entityType: 'Role', entityId: role.id,
    delta: { after: { name, label, permissionCodes } },
  });

  return { ...mapRole(role), permissions: permissionCodes };
};

// ── assignDepartment ──────────────────────────────────────────────────────────

exports.assignDepartment = async (body, actor) => {
  const canAssign = actor.permissions?.includes('departments.assign_manager') ||
                    actor.permissions?.includes('users.assign_department');
  if (!canAssign) throw ApiError.forbidden('Missing required permission: departments.assign_manager.');

  const { userId, departmentId } = body;
  const { rows: [dept] } = await pool.query(
    'SELECT id, institution_id FROM departments WHERE id = $1', [departmentId],
  );
  if (!dept) throw ApiError.notFound('Department not found.');

  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (!isSuperAdmin && dept.institution_id !== actor.institutionId) {
    throw ApiError.forbidden('Department does not belong to your institution.');
  }

  const result = await RoleModel.assignDepartment(userId, departmentId, actor.id);
  redis.del(`user_perms:${userId}:${dept.institution_id ?? 'null'}`).catch(() => {});

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'dept_manager.assign', entityType: 'User', entityId: userId,
    delta: { after: { departmentId } },
  });

  return result;
};

// ── revokeDepartment ──────────────────────────────────────────────────────────

exports.revokeDepartment = async (userId, deptId, actor) => {
  const canRevoke = actor.permissions?.includes('departments.assign_manager') ||
                    actor.permissions?.includes('users.assign_department');
  if (!canRevoke) throw ApiError.forbidden('Missing required permission: departments.assign_manager.');

  // Validate department belongs to actor's institution (prevents cross-institution revocation)
  const isSuperAdmin = actor.roles?.includes('super_admin');
  if (!isSuperAdmin) {
    const { rows: [dept] } = await pool.query(
      'SELECT institution_id FROM departments WHERE id = $1', [deptId],
    );
    if (!dept || dept.institution_id !== actor.institutionId) {
      throw ApiError.notFound('Department not found.');
    }
  }

  await RoleModel.revokeDepartment(userId, deptId);
  redis.del(`user_perms:${userId}:${actor.institutionId ?? 'null'}`).catch(() => {});

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'dept_manager.revoke', entityType: 'User', entityId: userId,
    delta: { before: { departmentId: deptId } },
  });
};

// ── assignTA ──────────────────────────────────────────────────────────────────

exports.assignTA = async (body, actor) => {
  const canAssign = actor.permissions?.includes('courses.assign_ta');
  if (!canAssign) throw ApiError.forbidden('Missing required permission: courses.assign_ta.');

  const { courseId, userId } = body;
  const isSuperAdmin = actor.roles?.includes('super_admin');

  // Validate course belongs to actor's institution and actor owns it
  const { rows: [course] } = await pool.query(
    'SELECT institution_id, instructor_id FROM courses WHERE id = $1 AND deleted_at IS NULL',
    [courseId],
  );
  if (!course) throw ApiError.notFound('Course not found.');
  if (!isSuperAdmin && course.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Course not found.');
  }

  // Instructors can only assign TAs to their own courses
  const isAdmin = actor.roles?.includes('institution_admin');
  if (!isSuperAdmin && !isAdmin && course.instructor_id !== actor.id) {
    throw ApiError.forbidden('You can only assign teaching assistants to your own courses.');
  }

  // Validate TA user belongs to same institution
  if (!isSuperAdmin) {
    const { rows: [targetUser] } = await pool.query(
      'SELECT institution_id FROM users WHERE id = $1 AND deleted_at IS NULL', [userId],
    );
    if (!targetUser || targetUser.institution_id !== actor.institutionId) {
      throw ApiError.notFound('User not found.');
    }
  }

  const result = await RoleModel.assignTA(courseId, userId, actor.id);
  redis.del(`user_perms:${userId}:${actor.institutionId ?? 'null'}`).catch(() => {});

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'ta.assign', entityType: 'Course', entityId: courseId,
    delta: { after: { userId } },
  });

  return result;
};

// ── revokeTA ──────────────────────────────────────────────────────────────────

exports.revokeTA = async (courseId, userId, actor) => {
  const canRevoke = actor.permissions?.includes('courses.assign_ta');
  if (!canRevoke) throw ApiError.forbidden('Missing required permission: courses.assign_ta.');

  const isSuperAdmin = actor.roles?.includes('super_admin');
  const { rows: [course] } = await pool.query(
    'SELECT institution_id, instructor_id FROM courses WHERE id = $1 AND deleted_at IS NULL',
    [courseId],
  );
  if (!course) throw ApiError.notFound('Course not found.');
  if (!isSuperAdmin && course.institution_id !== actor.institutionId) {
    throw ApiError.notFound('Course not found.');
  }

  const isAdmin = actor.roles?.includes('institution_admin');
  if (!isSuperAdmin && !isAdmin && course.instructor_id !== actor.id) {
    throw ApiError.forbidden('You can only manage teaching assistants for your own courses.');
  }

  await RoleModel.revokeTA(courseId, userId);
  redis.del(`user_perms:${userId}:${actor.institutionId ?? 'null'}`).catch(() => {});

  await AuditModel.log({
    institutionId: actor.institutionId, actorId: actor.id, actorEmail: actor.email,
    action: 'ta.revoke', entityType: 'Course', entityId: courseId,
    delta: { before: { userId } },
  });
};
