import { describe, it, expect } from 'vitest';

import { loadConfig } from './index';
import { type AppConfig } from './types';

describe('loadConfig', () => {
  it('returns defaults for an empty environment (runs with no env files)', () => {
    const expected: AppConfig = {
      nodeEnv: 'development',
      temporal: {
        connection: {
          address: 'localhost:7233',
          namespace: 'default',
          apiKey: undefined,
        },
        taskQueue: 'ai-agent',
      },
      http: {
        port: 3000,
        host: '0.0.0.0',
      },
      corsOrigin: '*',
      logLevel: 'info',
      ai: {
        provider: 'mock',
        model: 'claude-sonnet-5',
      },
    };

    const config = loadConfig({});

    expect(config).toMatchObject(expected);
    expect(config.temporal.connection.apiKey).toBeUndefined();
  });

  it('reads provided values (real env overrides defaults) and coerces types', () => {
    const temporal = {
      connection: {
        address: 'my.namespace.tmprl.cloud:7233',
        namespace: 'my-namespace',
        apiKey: 'secret',
      },
      taskQueue: 'my-task-queue',
    };
    const logLevel = 'debug';
    const port = 8080;

    const config = loadConfig({
      TEMPORAL_ADDRESS: temporal.connection.address,
      TEMPORAL_API_KEY: temporal.connection.apiKey,
      TEMPORAL_NAMESPACE: temporal.connection.namespace,
      TEMPORAL_TASK_QUEUE: temporal.taskQueue,
      LOG_LEVEL: logLevel,
      HTTP_PORT: port.toString(),
    });
    expect(config.temporal.connection.address).toBe(temporal.connection.address);
    expect(config.temporal.connection.apiKey).toBe(temporal.connection.apiKey);
    expect(config.temporal.connection.namespace).toBe(temporal.connection.namespace);
    expect(config.temporal.taskQueue).toBe(temporal.taskQueue);
    expect(config.logLevel).toBe(logLevel);
    expect(config.http.port).toBe(port);
  });

  it('throws on invalid values', () => {
    expect(() => loadConfig({ LOG_LEVEL: 'verbose' })).toThrow(/Invalid configuration/);
    expect(() => loadConfig({ HTTP_PORT: 'not-a-number' })).toThrow(/Invalid configuration/);
  });

  it('returns a frozen config', () => {
    expect(Object.isFrozen(loadConfig({}))).toBe(true);
  });
});

describe('loadConfig — ai', () => {
  it('defaults to the mock provider with the default model and no key', () => {
    const { ai } = loadConfig({});

    expect(ai.provider).toBe('mock');
    expect(ai.model).toBe('claude-sonnet-5');
    expect(ai.apiKey).toBeUndefined();
  });

  it('reads provider, model and key from the environment', () => {
    const { ai } = loadConfig({
      AI_PROVIDER: 'claude',
      ANTHROPIC_MODEL: 'claude-haiku-4-5',
      ANTHROPIC_API_KEY: 'sk-test',
    });

    expect(ai).toEqual({ provider: 'claude', model: 'claude-haiku-4-5', apiKey: 'sk-test' });
  });

  it('fails fast when provider=claude has no key, naming the variable', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'claude' })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it('treats a blank key as missing', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'claude', ANTHROPIC_API_KEY: '' })).toThrow(
      /ANTHROPIC_API_KEY/,
    );
  });

  it('ignores a blank key when the provider is mock (e.g. an empty .env placeholder)', () => {
    expect(loadConfig({ ANTHROPIC_API_KEY: '' }).ai.apiKey).toBeUndefined();
  });

  it('rejects an unknown provider', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'openai' })).toThrow(/AI_PROVIDER|ai\.provider/);
  });

  it('never echoes the key in the error message', () => {
    const secret = 'sk-secret-should-not-leak';
    let message = '';

    try {
      loadConfig({ AI_PROVIDER: 'bogus', ANTHROPIC_API_KEY: secret });
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }

    expect(message).toMatch(/ai\.provider/);
    expect(message).not.toContain(secret);
  });
});
