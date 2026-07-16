const request = require('supertest');
const app = require('../src/app');

describe('GET /', () => {
  it('returns API information at the root endpoint', async () => {
    const res = await request(app).get('/');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(expect.objectContaining({
      status: 'ok',
      service: 'Bedo SimuLearn API',
      version: 'v1',
    }));
  });
});
