/**
 * Model barrel — centralised import point for all database models.
 * Services should require from here:
 *   const { UserModel, CourseModel } = require('../../db/models');
 */
'use strict';

module.exports = {
  AcademicYearModel:           require('./academic_year.model'),
  AuditModel:                  require('./audit.model'),
  CompetencyModel:             require('./competency.model'),
  CourseModel:                 require('./course.model'),
  DomainModel:                 require('./domain.model'),
  GradeModel:                  require('./grade.model'),
  GradeCategoryModel:          require('./grade_category.model'),
  InstitutionModel:            require('./institution.model'),
  LtiPlatformModel:            require('./lti_platform.model'),
  LtiToolKeyModel:             require('./lti_tool_key.model'),
  LtiIdentityModel:            require('./lti_identity.model'),
  LmsRegisteredReleaseModel:    require('./lms_registered_release.model'),
  LmsAssessmentDefinitionModel: require('./lms_assessment_definition.model'),
  LmsLearnerSessionModel:       require('./lms_learner_session.model'),
  LmsExperimentAttemptModel:    require('./lms_experiment_attempt.model'),
  LmsRawEventModel:             require('./lms_raw_event.model'),
  LmsStepStateModel:            require('./lms_step_state.model'),
  LmsAnswerSubmissionModel:     require('./lms_answer_submission.model'),
  LmsSavedResultModel:          require('./lms_saved_result.model'),
  MailModel:                   require('./mail.model'),
  ModuleModel:                 require('./module.model'),
  NotificationModel:           require('./notification.model'),
  NotificationPreferenceModel: require('./notification_preference.model'),
  ProgressModel:               require('./progress.model'),
  QuizModel:                   require('./quiz.model'),
  QuizAttemptModel:            require('./quiz_attempt.model'),
  QuizQuestionModel:           require('./quiz_question.model'),
  RoleModel:                   require('./role.model'),
  SemesterTermModel:           require('./semester_term.model'),
  SessionModel:                       require('./session.model'),
  SimulationActivitySessionModel:     require('./simulation_activity_session.model'),
  SimulationClickEventModel:          require('./simulation_click_event.model'),
  SimulationClickRegionModel:         require('./simulation_click_region.model'),
  SimulationStepModel:                require('./simulation_step.model'),
  SimulationCatalogModel:             require('./simulation_catalog.model'),
  SimulationModel:             require('./simulation.model'),
  SimulationScoreModel:               require('./simulation_score.model'),
  UserAcademicAssignmentModel: require('./user_academic_assignment.model'),
  UserModel:                   require('./user.model'),
};
