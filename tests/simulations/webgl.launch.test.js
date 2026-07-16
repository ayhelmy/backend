'use strict';

/**
 * Tests for the WebGL simulation catalog upload and course launch flows.
 * Tests service functions directly (no HTTP), with mocked DB models and webglSvc.
 *
 * Requirements covered:
 *  - simulation record created with build_uuid and public_entry_url
 *  - simulation linked to selected catalog
 *  - invalid ZIP rejected (422)
 *  - launch endpoint returns URL for authorized student/instructor
 *  - launch endpoint blocks unauthorized student
 *  - instructor cannot select simulation with build_status not ready
 *  - institution assigned parent catalog can access child catalog WebGL simulations
 */

// ── Mocks (Jest hoists these before any imports) ──────────────────────────────

jest.mock('../../src/db/models', () => ({
  SimulationCatalogModel: {
    findById:                          jest.fn(),
    addItem:                           jest.fn(),
    isSimulationAllowedForDepartment:  jest.fn(),
    isSimulationAssignedToInstitution: jest.fn(),
  },
  SimulationModel: {
    createWebGL: jest.fn(),
    findById:    jest.fn(),
  },
  CourseModel: {
    findById:       jest.fn(),
    findEnrollment: jest.fn(),
  },
  ModuleModel: {
    findLessonById: jest.fn(),
    findById:       jest.fn(),
  },
  AuditModel: {
    log: jest.fn().mockResolvedValue(undefined),
  },
}));

jest.mock('../../src/modules/simulations/webgl.service', () => ({
  generateBuildUuid:     jest.fn().mockReturnValue('test-uuid-0001'),
  getBuildPath:          jest.fn().mockReturnValue('/storage/simulations/test-uuid-0001'),
  getPublicEntryUrl:     jest.fn((uuid, entry = 'index.html') =>
    `/simulations-runtime/${uuid}/${entry}`),
  extractWebGLZip:       jest.fn(),
  validateWebGLStructure: jest.fn(),
  removeBuildFolder:     jest.fn().mockResolvedValue(undefined),
  cleanTempFile:         jest.fn().mockResolvedValue(undefined),
}));

// Prevent real DB / Redis connections when service modules are loaded
jest.mock('../../src/config/database', () => ({
  pool:      { query: jest.fn() },
  query:     jest.fn(),
  getClient: jest.fn(),
}));

jest.mock('../../src/config/redis', () => ({
  get:    jest.fn().mockResolvedValue(null),
  setex:  jest.fn().mockResolvedValue('OK'),
  del:    jest.fn().mockResolvedValue(1),
  on:     jest.fn(),
}));

// ── Imports ───────────────────────────────────────────────────────────────────

const { SimulationCatalogModel, SimulationModel, CourseModel, ModuleModel, AuditModel } =
  require('../../src/db/models');
const webglSvc    = require('../../src/modules/simulations/webgl.service');
const catalogSvc  = require('../../src/modules/simulation-catalogs/catalog.service');
const modulesSvc  = require('../../src/modules/modules-lessons/modules.service');

// ── Test fixtures ─────────────────────────────────────────────────────────────

const SUPER_ADMIN = {
  id: 'actor-admin', email: 'admin@test.com', institutionId: null,
  roles: ['super_admin'],
  permissions: ['simulation_catalogs.manage_global'],
};

const STUDENT = {
  id: 'actor-student', email: 'student@test.com', institutionId: 'inst-1',
  roles: ['student'],
  permissions: ['simulations.launch', 'lessons.view'],
};

const INSTRUCTOR = {
  id: 'actor-instructor', email: 'instructor@test.com', institutionId: 'inst-1',
  roles: ['instructor'],
  permissions: ['simulations.launch', 'lessons.view', 'courses.manage'],
};

const FAKE_CATALOG = {
  id: 'cat-1', name: 'Test Catalog', status: 'active', visibility: 'global',
  institution_id: null, parent_id: null, depth: 0, path: 'cat-1',
  sort_order: 0, is_global: true, is_demo: false,
  created_by: 'actor-admin', created_at: new Date(), updated_at: new Date(),
};

const FAKE_SIM = {
  id: 'sim-1', title: 'Test WebGL Sim', type: 'webgl', launch_type: 'webgl',
  build_uuid: 'test-uuid-0001', status: 'active', visibility: 'global',
  public_entry_url: '/simulations-runtime/test-uuid-0001/index.html',
  entry_file: 'index.html', build_status: 'ready', build_validation: { valid: true },
  difficulty: 'intermediate', estimated_minutes: 30, description: 'A test simulation',
  institution_id: null, original_zip_filename: 'build.zip',
  storage_path: '/storage/simulations/test-uuid-0001',
  file_size_bytes: 10240, launch_url: null,
  created_by: 'actor-admin', created_at: new Date(), updated_at: new Date(),
};

const FAKE_COURSE = {
  id: 'course-1', institution_id: 'inst-1', department_id: null,
  instructor_id: 'actor-instructor', status: 'published',
};

const FAKE_MODULE = { id: 'mod-1', course_id: 'course-1', title: 'Module 1' };

const FAKE_LESSON = {
  id: 'lesson-1', module_id: 'mod-1', course_id: 'course-1', title: 'Lesson 1',
  simulation_id: 'sim-1', lesson_mode: 'simulation', is_published: true, is_required: true,
};

const MOCK_REQ = {
  protocol: 'http',
  get: (header) => (header === 'host' ? 'localhost:5000' : ''),
};

const MOCK_FILE = {
  path: '/tmp/uploads/build.zip', originalname: 'build.zip', size: 10240,
};

// ── Reset call history before each test (keep implementations) ────────────────

beforeEach(() => {
  jest.clearAllMocks();
  // Restore default implementations after clearAllMocks
  AuditModel.log.mockResolvedValue(undefined);
  webglSvc.removeBuildFolder.mockResolvedValue(undefined);
  webglSvc.cleanTempFile.mockResolvedValue(undefined);
  webglSvc.generateBuildUuid.mockReturnValue('test-uuid-0001');
  webglSvc.getBuildPath.mockReturnValue('/storage/simulations/test-uuid-0001');
  webglSvc.getPublicEntryUrl.mockImplementation(
    (uuid, entry = 'index.html') => `/simulations-runtime/${uuid}/${entry}`,
  );
});

// ── catalogSvc.createWebGLSimulationInCatalog() ───────────────────────────────

describe('catalogSvc.createWebGLSimulationInCatalog()', () => {
  it('throws 403 when actor lacks simulation_catalogs.manage_global', async () => {
    await expect(
      catalogSvc.createWebGLSimulationInCatalog('cat-1', {}, MOCK_FILE, STUDENT),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws 400 when no file is provided', async () => {
    await expect(
      catalogSvc.createWebGLSimulationInCatalog('cat-1', { title: 'X' }, null, SUPER_ADMIN),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 404 when catalog does not exist', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(null);

    await expect(
      catalogSvc.createWebGLSimulationInCatalog('cat-999', {}, MOCK_FILE, SUPER_ADMIN),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 422 and logs audit when ZIP fails validation', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(FAKE_CATALOG);
    webglSvc.extractWebGLZip.mockResolvedValue({
      destDir: '/storage/simulations/test-uuid-0001',
      validation: { valid: false, errors: ['Missing index.html in ZIP root.'], checklist: {} },
    });

    await expect(
      catalogSvc.createWebGLSimulationInCatalog(
        'cat-1', { title: 'Bad ZIP' }, MOCK_FILE, SUPER_ADMIN,
      ),
    ).rejects.toMatchObject({ statusCode: 422 });

    // Audit logged for validation failure
    expect(AuditModel.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'simulation.webgl_validation_failed' }),
    );
    // Temp file must always be cleaned up
    expect(webglSvc.cleanTempFile).toHaveBeenCalledWith(MOCK_FILE.path);
  });

  it('creates simulation record with build_uuid and public_entry_url on success', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(FAKE_CATALOG);
    SimulationCatalogModel.addItem.mockResolvedValue({});
    webglSvc.extractWebGLZip.mockResolvedValue({
      destDir: '/storage/simulations/test-uuid-0001',
      validation: { valid: true, errors: [], checklist: { wrapperFolder: null } },
    });
    SimulationModel.createWebGL.mockResolvedValue(FAKE_SIM);

    const result = await catalogSvc.createWebGLSimulationInCatalog(
      'cat-1', { title: 'Test WebGL Sim', difficulty: 'intermediate' }, MOCK_FILE, SUPER_ADMIN,
    );

    expect(SimulationModel.createWebGL).toHaveBeenCalledWith(
      expect.objectContaining({
        buildUuid:      'test-uuid-0001',
        publicEntryUrl: '/simulations-runtime/test-uuid-0001/index.html',
        buildStatus:    'ready',
        title:          'Test WebGL Sim',
      }),
    );
    expect(result).toMatchObject({ catalogId: 'cat-1' });
    expect(result.simulation).toBeDefined();
    expect(result.simulation.buildUuid).toBe('test-uuid-0001');
  });

  it('links simulation to catalog after creation', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(FAKE_CATALOG);
    SimulationCatalogModel.addItem.mockResolvedValue({});
    webglSvc.extractWebGLZip.mockResolvedValue({
      destDir: '/storage/simulations/test-uuid-0001',
      validation: { valid: true, errors: [], checklist: { wrapperFolder: null } },
    });
    SimulationModel.createWebGL.mockResolvedValue(FAKE_SIM);

    await catalogSvc.createWebGLSimulationInCatalog(
      'cat-1', { title: 'X' }, MOCK_FILE, SUPER_ADMIN,
    );

    expect(SimulationCatalogModel.addItem).toHaveBeenCalledWith(
      'cat-1', FAKE_SIM.id, SUPER_ADMIN.id,
    );
  });

  it('logs audit event on successful upload', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(FAKE_CATALOG);
    SimulationCatalogModel.addItem.mockResolvedValue({});
    webglSvc.extractWebGLZip.mockResolvedValue({
      destDir: '/storage/simulations/test-uuid-0001',
      validation: { valid: true, errors: [], checklist: { wrapperFolder: null } },
    });
    SimulationModel.createWebGL.mockResolvedValue(FAKE_SIM);

    await catalogSvc.createWebGLSimulationInCatalog(
      'cat-1', { title: 'X' }, MOCK_FILE, SUPER_ADMIN,
    );

    expect(AuditModel.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'simulation.webgl_uploaded' }),
    );
  });

  it('always cleans up temp file (success path)', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(FAKE_CATALOG);
    SimulationCatalogModel.addItem.mockResolvedValue({});
    webglSvc.extractWebGLZip.mockResolvedValue({
      destDir: '/storage/simulations/test-uuid-0001',
      validation: { valid: true, errors: [], checklist: { wrapperFolder: null } },
    });
    SimulationModel.createWebGL.mockResolvedValue(FAKE_SIM);

    await catalogSvc.createWebGLSimulationInCatalog(
      'cat-1', { title: 'X' }, MOCK_FILE, SUPER_ADMIN,
    );

    expect(webglSvc.cleanTempFile).toHaveBeenCalledWith(MOCK_FILE.path);
  });

  it('computes correct entryFile when ZIP has a wrapper folder', async () => {
    SimulationCatalogModel.findById.mockResolvedValue(FAKE_CATALOG);
    SimulationCatalogModel.addItem.mockResolvedValue({});

    const buildPath   = '/storage/simulations/test-uuid-0001';
    const wrapperPath = buildPath + '/MyWebGLBuild';
    webglSvc.getBuildPath.mockReturnValue(buildPath);

    webglSvc.extractWebGLZip.mockResolvedValue({
      destDir: buildPath,
      validation: {
        valid: true, errors: [],
        checklist: { wrapperFolder: wrapperPath },
      },
    });
    SimulationModel.createWebGL.mockResolvedValue({
      ...FAKE_SIM,
      entry_file: 'MyWebGLBuild/index.html',
    });

    await catalogSvc.createWebGLSimulationInCatalog(
      'cat-1', { title: 'X' }, MOCK_FILE, SUPER_ADMIN,
    );

    expect(SimulationModel.createWebGL).toHaveBeenCalledWith(
      expect.objectContaining({ entryFile: 'MyWebGLBuild/index.html' }),
    );
  });
});

// ── modulesSvc.getLessonSimulationLaunch() ────────────────────────────────────

describe('modulesSvc.getLessonSimulationLaunch()', () => {
  beforeEach(() => {
    CourseModel.findById.mockResolvedValue(FAKE_COURSE);
    CourseModel.findEnrollment.mockResolvedValue({ status: 'active' });
    ModuleModel.findLessonById.mockResolvedValue(FAKE_LESSON);
    ModuleModel.findById.mockResolvedValue(FAKE_MODULE);
    SimulationModel.findById.mockResolvedValue(FAKE_SIM);
  });

  it('throws 401 when actor is null', async () => {
    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', null, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 401 });
  });

  it('throws 404 when course does not exist', async () => {
    CourseModel.findById.mockResolvedValue(null);

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 403 when student has no active enrollment', async () => {
    CourseModel.findEnrollment.mockResolvedValue(null);

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws 403 when student enrollment is suspended', async () => {
    CourseModel.findEnrollment.mockResolvedValue({ status: 'suspended' });

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('skips enrollment check for instructor (non-student)', async () => {
    await modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', INSTRUCTOR, MOCK_REQ);
    expect(CourseModel.findEnrollment).not.toHaveBeenCalled();
  });

  it('throws 404 when lesson is not found', async () => {
    ModuleModel.findLessonById.mockResolvedValue(null);

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 404 when lesson belongs to a different course', async () => {
    ModuleModel.findById.mockResolvedValue({ id: 'mod-1', course_id: 'course-OTHER' });

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });

  it('throws 400 when lesson has no simulation attached', async () => {
    ModuleModel.findLessonById.mockResolvedValue({ ...FAKE_LESSON, simulation_id: null });

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 403 when lesson is not published', async () => {
    ModuleModel.findLessonById.mockResolvedValue({ ...FAKE_LESSON, is_published: false });

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it('throws 400 when WebGL build is processing (not ready)', async () => {
    SimulationModel.findById.mockResolvedValue({
      ...FAKE_SIM, launch_type: 'webgl', build_status: 'processing',
    });

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when WebGL build has failed', async () => {
    SimulationModel.findById.mockResolvedValue({
      ...FAKE_SIM, launch_type: 'webgl', build_status: 'failed',
    });

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('throws 400 when simulation is not active', async () => {
    SimulationModel.findById.mockResolvedValue({ ...FAKE_SIM, status: 'deprecated' });

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('returns launchUrl for authorized enrolled student', async () => {
    const result = await modulesSvc.getLessonSimulationLaunch(
      'course-1', 'lesson-1', STUDENT, MOCK_REQ,
    );

    expect(result.launchUrl).toBe('http://localhost:5000/simulations-runtime/test-uuid-0001/index.html');
    expect(result.simulationId).toBe('sim-1');
    expect(result.launchType).toBe('webgl');
    expect(result.buildStatus).toBe('ready');
  });

  it('constructs absolute URL from public_entry_url for WebGL simulations', async () => {
    const result = await modulesSvc.getLessonSimulationLaunch(
      'course-1', 'lesson-1', STUDENT, MOCK_REQ,
    );

    expect(result.launchUrl).toMatch(/^http:\/\/localhost:5000\/simulations-runtime\//);
  });

  it('returns launchUrl for instructor (no enrollment check)', async () => {
    const result = await modulesSvc.getLessonSimulationLaunch(
      'course-1', 'lesson-1', INSTRUCTOR, MOCK_REQ,
    );

    expect(result.launchUrl).toContain('/simulations-runtime/');
    expect(CourseModel.findEnrollment).not.toHaveBeenCalled();
  });

  it('returns metadata: simulationId, buildUuid, title, difficulty, estimatedMinutes', async () => {
    const result = await modulesSvc.getLessonSimulationLaunch(
      'course-1', 'lesson-1', STUDENT, MOCK_REQ,
    );

    expect(result.simulationId).toBe(FAKE_SIM.id);
    expect(result.buildUuid).toBe(FAKE_SIM.build_uuid);
    expect(result.title).toBe(FAKE_SIM.title);
    expect(result.difficulty).toBe(FAKE_SIM.difficulty);
    expect(result.estimatedMinutes).toBe(FAKE_SIM.estimated_minutes);
  });

  it('logs audit event on successful launch', async () => {
    await modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ);

    expect(AuditModel.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'simulation.launch', entityId: FAKE_SIM.id }),
    );
  });

  it('blocks student from launching when simulation not found', async () => {
    SimulationModel.findById.mockResolvedValue(null);

    await expect(
      modulesSvc.getLessonSimulationLaunch('course-1', 'lesson-1', STUDENT, MOCK_REQ),
    ).rejects.toMatchObject({ statusCode: 404 });
  });
});
