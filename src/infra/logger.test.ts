import { pino } from 'pino';
import { describe, it, expect } from 'vitest';

import { loadConfig } from './config';
import { loggerOptions } from './logger';

const SECRET = 'sk-secret-should-never-appear';

/** Logs `payload` through the real redact config (production mode: no pretty transport). */
const logged = (payload: object): string => {
  const lines: string[] = [];
  const logger = pino(loggerOptions(loadConfig({ NODE_ENV: 'production' })), {
    write: (line: string) => void lines.push(line),
  });
  logger.info(payload, 'test');
  return lines.join('');
};

describe('logger redaction', () => {
  it.each([
    ['a top-level apiKey', { apiKey: SECRET }],
    ['a top-level temporalApiKey', { temporalApiKey: SECRET }],
    ['ai.apiKey', { ai: { provider: 'claude', apiKey: SECRET } }],
    ['temporal.connection.apiKey', { temporal: { connection: { apiKey: SECRET } } }],
    ['a whole config logged as `config`', { config: { ai: { apiKey: SECRET } } }],
    [
      'a whole config logged as `config` (temporal)',
      { config: { temporal: { connection: { apiKey: SECRET } } } },
    ],
    ['an apiKey one level down', { options: { apiKey: SECRET } }],
    ['an authorization header', { req: { headers: { authorization: SECRET } } }],
    ['a cookie header', { headers: { cookie: SECRET } }],
  ])('redacts %s', (_name, payload) => {
    expect(logged(payload)).not.toContain(SECRET);
  });

  it('keeps non-secret fields readable', () => {
    const output = logged({ ai: { provider: 'claude', model: 'claude-sonnet-5', apiKey: SECRET } });

    expect(output).toContain('claude-sonnet-5');
    expect(output).toContain('[Redacted]');
  });
});
