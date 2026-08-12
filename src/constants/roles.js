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

// Numeric rank — lower number means higher privilege in the hierarchy.
// Used to pick a user's "highest active role" (e.g. dashboard routing) and to
// filter role-list visibility so users can never see peers above them.
const ROLE_RANK = {
  [ROLES.SUPER_ADMIN]:        0,
  [ROLES.INSTITUTION_ADMIN]:  1,
  [ROLES.DEPT_MANAGER]:       2,
  [ROLES.INSTRUCTOR]:         3,
  [ROLES.TEACHING_ASSISTANT]: 4,
  [ROLES.STUDENT]:            5,
  [ROLES.GUEST]:              6,
};

module.exports = { ROLES, ADMIN_ROLES, STAFF_ROLES, INSTRUCTOR_ROLES, ASSIGNABLE_ROLES, SUPER_ONLY_ROLES, ROLE_RANK };
