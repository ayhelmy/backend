'use strict';

const ROLES = Object.freeze({
  SUPER_ADMIN:        'super_admin',
  INSTITUTION_ADMIN:  'institution_admin',
  DEPT_MANAGER:       'dept_manager',
  INSTRUCTOR:         'instructor',
  TEACHING_ASSISTANT: 'teaching_assistant',
  STUDENT:            'student',
  GUEST:              'guest',
});

const ADMIN_ROLES      = [ROLES.SUPER_ADMIN, ROLES.INSTITUTION_ADMIN];
const STAFF_ROLES      = [...ADMIN_ROLES, ROLES.DEPT_MANAGER, ROLES.INSTRUCTOR, ROLES.TEACHING_ASSISTANT];
const INSTRUCTOR_ROLES = [ROLES.INSTRUCTOR, ROLES.TEACHING_ASSISTANT];

// Roles that can be assigned by institution_admin or dept_manager
const ASSIGNABLE_ROLES = [
  ROLES.INSTRUCTOR, ROLES.TEACHING_ASSISTANT, ROLES.STUDENT, ROLES.DEPT_MANAGER,
   ROLES.INSTITUTION_ADMIN
];

// Roles only super_admin can assign
const SUPER_ONLY_ROLES = [ROLES.SUPER_ADMIN];

module.exports = { ROLES, ADMIN_ROLES, STAFF_ROLES, INSTRUCTOR_ROLES, ASSIGNABLE_ROLES, SUPER_ONLY_ROLES };
