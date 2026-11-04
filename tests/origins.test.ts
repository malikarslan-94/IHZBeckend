import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const { env } = vi.hoisted(() => ({
  env: {
    CLIENT_URL: 'https://office.example',
    NODE_ENV: 'production',
    JWT_SECRET: 'test-secret-for-origin-checks-only',
  },
}));
vi.mock('../src/config/env.js', () => ({ env }));
vi.mock('../src/config/db.js', () => ({ db: {} }));

import { app } from '../src/app.js';

beforeEach(() => {
  env.CLIENT_URL = 'https://office.example';
});

describe('Frontend origin access', () => {
  it('allows the configured frontend and rejects writes from another origin', async () => {
    const allowed = await request(app).get('/health').set('Origin', env.CLIENT_URL);
    expect(allowed.headers['access-control-allow-origin']).toBe(env.CLIENT_URL);
    const denied = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'https://another.example')
      .set('X-Requested-With', 'HomeNursing');
    expect(denied.status).toBe(403);
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each(['https://preview.example', 'http://localhost:5173'])(
    'supports credentialed preflights and writes from %s in wildcard mode',
    async (origin) => {
      env.CLIENT_URL = '*';
      const preflight = await request(app)
        .options('/api/auth/logout')
        .set('Origin', origin)
        .set('Access-Control-Request-Method', 'POST')
        .set('Access-Control-Request-Headers', 'content-type,x-requested-with');
      expect(preflight.status).toBe(204);
      expect(preflight.headers['access-control-allow-origin']).toBe(origin);
      expect(preflight.headers['access-control-allow-credentials']).toBe('true');
      expect(preflight.headers.vary).toContain('Origin');
      expect(preflight.headers['access-control-allow-headers']).toContain('x-requested-with');
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Origin', origin)
        .set('X-Requested-With', 'HomeNursing');
      expect(response.status).toBe(200);
      expect(response.headers['access-control-allow-origin']).toBe(origin);
      expect(response.headers['set-cookie'][0]).toContain('SameSite=None');
      expect(response.headers['set-cookie'][0]).toContain('Secure');
      expect(response.headers['set-cookie'][0]).toContain('HttpOnly');
    },
  );

  it('requires the custom request header in wildcard mode', async () => {
    env.CLIENT_URL = '*';
    const response = await request(app)
      .post('/api/auth/logout')
      .set('Origin', 'https://preview.example');
    expect(response.status).toBe(403);
  });

  it.each(['null', 'file://host', 'https://preview.example/path'])(
    'rejects invalid or opaque browser origins such as %s',
    async (origin) => {
      env.CLIENT_URL = '*';
      const response = await request(app)
        .post('/api/auth/logout')
        .set('Origin', origin)
        .set('X-Requested-With', 'HomeNursing');
      expect(response.status).toBe(403);
      expect(response.headers['access-control-allow-origin']).toBeUndefined();
    },
  );

  it('supports requests without an Origin header', async () => {
    const response = await request(app)
      .post('/api/auth/logout')
      .set('X-Requested-With', 'HomeNursing');
    expect(response.status).toBe(200);
  });
});
