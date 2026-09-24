import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

import { ErrorCode } from './error-code';
import { registerErrorHandler } from './error-handler';

const buildTestApp = () => {
  const app = Fastify({ logger: false });
  registerErrorHandler(app);
  app.get('/boom', () => {
    throw new Error('unexpected failure with internal details');
  });
  return app;
};

describe('registerErrorHandler', () => {
  it('maps an unexpected error to a generic 500 envelope (no internal details leaked)', async () => {
    const app = buildTestApp();

    const res = await app.inject({ method: 'GET', url: '/boom' });

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({
      error: { code: ErrorCode.INTERNAL, message: 'Internal server error' },
    });
  });
});
