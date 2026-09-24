import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { readEnv } from './read-env';

vi.mock('node:fs', () => ({ readFileSync: vi.fn() }));

const mockReadFileSync = vi.mocked(readFileSync);

describe('readEnv', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('contributes nothing when both env files are missing/unreadable', () => {
    mockReadFileSync.mockImplementation(() => {
      throw new Error('ENOENT');
    });

    const env = readEnv();

    expect(env['THIS_KEY_SHOULD_NOT_EXIST']).toBeUndefined();
  });

  it('merges .env then .env.local, with .env.local winning on overlap', () => {
    mockReadFileSync.mockImplementation((path) => {
      if (path === '.env') return 'FOO=from-env\nBAR=from-env\n';
      if (path === '.env.local') return 'BAR=from-env-local\n';
      throw new Error('ENOENT');
    });

    const env = readEnv();

    expect(env['FOO']).toBe('from-env');
    expect(env['BAR']).toBe('from-env-local');
  });

  it('real process.env always overrides file values', () => {
    mockReadFileSync.mockImplementation((path) => {
      if (path === '.env') return 'PATH=fake-path-value\n';
      throw new Error('ENOENT');
    });

    const env = readEnv();

    expect(env['PATH']).toBe(process.env['PATH']);
  });
});
