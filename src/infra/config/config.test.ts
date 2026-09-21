import { describe, it, expect } from 'vitest';

import { loadConfig } from './index';

describe('loadConfig', () => {
  it('returns defaults for an empty environment (runs with no env files)', () => {
    const config = loadConfig({});
    expect(config).toMatchObject({
      nodeEnv: 'development',
      temporalAddress: 'localhost:7233',
      temporalNamespace: 'default',
      taskQueue: 'ai-agent',
      httpPort: 3000,
      httpHost: '0.0.0.0',
      corsOrigin: '*',
      logLevel: 'info',
    });
    expect(config.temporalApiKey).toBeUndefined();
  });

  it('reads provided values (real env overrides defaults) and coerces types', () => {
    const config = loadConfig({
      TEMPORAL_ADDRESS: 'my.namespace.tmprl.cloud:7233',
      TEMPORAL_API_KEY: 'secret',
      LOG_LEVEL: 'debug',
      HTTP_PORT: '8080',
    });
    expect(config.temporalAddress).toBe('my.namespace.tmprl.cloud:7233');
    expect(config.temporalApiKey).toBe('secret');
    expect(config.logLevel).toBe('debug');
    expect(config.httpPort).toBe(8080);
  });

  it('throws on invalid values', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ HTTP_PORT: 'not-a-number' })).toThrow(/Invalid configuration/);
  });

  it('returns a frozen config', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});
