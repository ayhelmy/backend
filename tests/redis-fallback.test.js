describe('Redis config fallback', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
    delete process.env.REDIS_URL;
    delete process.env.REDISCLOUD_URL;
    delete process.env.REDIS_HOST;
    delete process.env.REDIS_PORT;
    delete process.env.REDIS_PASSWORD;
    delete process.env.REDIS_USER;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  test('provides a safe no-op client when Redis is not configured', async () => {
    const redis = require('../src/config/redis');

    await expect(redis.get('missing-key')).resolves.toBeNull();
    await expect(redis.setex('some-key', 60, 'value')).resolves.toBeUndefined();
    await expect(redis.del('some-key')).resolves.toBeUndefined();
  });
});
