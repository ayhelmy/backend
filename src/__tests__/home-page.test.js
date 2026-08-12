'use strict';

/**
 * Public home page — backend unit tests.
 * Covers the aggregated GET /page-content/home-page payload (page-content.service)
 * and the featured-simulations query it depends on (simulations.service).
 * Run: npx jest src/__tests__/home-page.test.js
 */

const mockQuery = jest.fn();
jest.mock('../config/database', () => ({
  pool: { query: (...args) => mockQuery(...args) },
}));

const pageContentSvc = require('../modules/page-content/page-content.service');
const simulationsService = require('../modules/simulations/simulations.service');

function pageContentRow(overrides = {}) {
  return {
    id: 'row-1', page: 'home', section: 'hero', sort_order: 0,
    title: null, description: null, icon_name: null, icon_color: null,
    category: null, category_color: null, cta_text: null,
    extra: {}, is_active: true, updated_at: new Date('2026-01-01'),
    ...overrides,
  };
}

beforeEach(() => {
  mockQuery.mockReset();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('page-content.service — getHomePagePayload()', () => {
  test('shapes hero/features/cta and resolves computed + static stat values', async () => {
    jest.spyOn(simulationsService, 'listFeaturedPublic')
      .mockResolvedValue([{ id: 'sim-1', title: 'Featured Sim' }]);

    mockQuery.mockImplementation((sql) => {
      if (sql.includes('FROM page_content')) {
        return Promise.resolve({
          rows: [
            pageContentRow({ id: 'hero-1', section: 'hero', title: 'Explore', description: 'desc' }),
            pageContentRow({ id: 'stat-1', section: 'stats', sort_order: 0, title: 'Simulations', extra: { metric: 'simulations_count', suffix: '+' } }),
            pageContentRow({ id: 'stat-2', section: 'stats', sort_order: 1, title: 'Disciplines', extra: { metric: 'disciplines_count', suffix: '' } }),
            pageContentRow({ id: 'stat-3', section: 'stats', sort_order: 2, title: 'WebGL', extra: { metric: 'static', value: 'WebGL' } }),
            pageContentRow({ id: 'fi-1', section: 'features_intro', title: 'Built for...' }),
            pageContentRow({ id: 'f-1', section: 'features', sort_order: 0, title: 'Feature A' }),
            pageContentRow({ id: 'cta-1', section: 'cta', title: 'Bring BEDO' }),
          ],
        });
      }
      if (sql.includes('simulations_count')) {
        return Promise.resolve({ rows: [{ simulations_count: 19, disciplines_count: 12 }] });
      }
      return Promise.resolve({ rows: [] });
    });

    const result = await pageContentSvc.getHomePagePayload();

    expect(result.hero.title).toBe('Explore');
    expect(result.statistics).toEqual([
      { label: 'Simulations', value: '19+', shortDescription: null, icon: null },
      { label: 'Disciplines', value: '12', shortDescription: null, icon: null },
      { label: 'WebGL', value: 'WebGL', shortDescription: null, icon: null },
    ]);
    expect(result.features.intro.title).toBe('Built for...');
    expect(result.features.cards).toHaveLength(1);
    expect(result.features.cards[0].title).toBe('Feature A');
    expect(result.featuredSimulations.items).toEqual([{ id: 'sim-1', title: 'Featured Sim' }]);
    expect(result.callToAction.title).toBe('Bring BEDO');
    // Sections with no seeded rows in this fixture stay empty, not undefined/throwing.
    expect(result.benefits).toEqual({ intro: null, cards: [] });
    expect(result.lms).toEqual({ intro: null, cards: [] });
    expect(result.demo).toBeNull();
  });

  test('empty state: no active home content and no featured simulations returns nulls/empty arrays, not an error', async () => {
    jest.spyOn(simulationsService, 'listFeaturedPublic').mockResolvedValue([]);
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('FROM page_content')) return Promise.resolve({ rows: [] });
      if (sql.includes('simulations_count')) return Promise.resolve({ rows: [{ simulations_count: 0, disciplines_count: 0 }] });
      return Promise.resolve({ rows: [] });
    });

    const result = await pageContentSvc.getHomePagePayload();

    expect(result.hero).toBeNull();
    expect(result.statistics).toEqual([]);
    expect(result.features).toEqual({ intro: null, cards: [] });
    expect(result.featuredSimulations).toEqual({ intro: null, items: [] });
    expect(result.callToAction).toBeNull();
  });

  test('only active rows for page=home are requested (WHERE clause asserted)', async () => {
    jest.spyOn(simulationsService, 'listFeaturedPublic').mockResolvedValue([]);
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('FROM page_content')) {
        expect(sql).toMatch(/is_active\s*=\s*TRUE/);
        expect(sql).toMatch(/page\s*=\s*'home'/);
        return Promise.resolve({ rows: [] });
      }
      return Promise.resolve({ rows: [{ simulations_count: 0, disciplines_count: 0 }] });
    });

    await pageContentSvc.getHomePagePayload();

    expect(mockQuery).toHaveBeenCalled();
  });

  test('propagates a failure fetching featured simulations rather than swallowing it', async () => {
    jest.spyOn(simulationsService, 'listFeaturedPublic').mockRejectedValue(new Error('db unavailable'));
    mockQuery.mockImplementation((sql) => {
      if (sql.includes('FROM page_content')) return Promise.resolve({ rows: [] });
      return Promise.resolve({ rows: [{ simulations_count: 0, disciplines_count: 0 }] });
    });

    await expect(pageContentSvc.getHomePagePayload()).rejects.toThrow('db unavailable');
  });
});

describe('simulations.service — listFeaturedPublic()', () => {
  test('query filters on is_featured, active status, and demo-eligible visibility, ordered by featured_order', async () => {
    mockQuery.mockImplementation((sql) => {
      expect(sql).toMatch(/is_featured\s*=\s*TRUE/);
      expect(sql).toMatch(/status\s*=\s*'active'/);
      expect(sql).toMatch(/visibility IN \('demo_public', 'demo_and_institution'\)/);
      expect(sql).toMatch(/ORDER BY s\.featured_order NULLS LAST, s\.title/);
      expect(sql).toMatch(/LIMIT 8/);
      return Promise.resolve({ rows: [] });
    });

    const result = await simulationsService.listFeaturedPublic();
    expect(result).toEqual([]);
  });

  test('maps rows to camelCase cards and attaches the resolved discipline label', async () => {
    mockQuery.mockResolvedValue({
      rows: [{
        id: 'sim-1', title: 'Fluid Mechanics Lab', description: 'desc', type: 'webgl',
        thumbnail_url: 'https://x/thumb.png', estimated_minutes: 30, difficulty: 'intermediate',
        visibility: 'demo_public', status: 'active', version: '1.0.0', launch_type: 'webgl',
        build_status: 'ready', is_featured: true, featured_order: 0, created_at: new Date('2026-01-01'),
        discipline_name: 'Mechanical',
      }],
    });

    const [card] = await simulationsService.listFeaturedPublic();

    expect(card.id).toBe('sim-1');
    expect(card.title).toBe('Fluid Mechanics Lab');
    expect(card.discipline).toBe('Mechanical');
    expect(card.isFeatured).toBe(true);
  });

  test('returns an empty array (not null/throw) when there are no featured simulations', async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await expect(simulationsService.listFeaturedPublic()).resolves.toEqual([]);
  });
});
