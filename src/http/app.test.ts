import type { Client } from '@temporalio/client';
import { describe, expect, it } from 'vitest';

import { buildApp } from './app';

describe('buildApp', () => {
  it('uses no deprecated Fastify options (no FSTDEP warnings)', async () => {
    const codes: string[] = [];
    const onWarning = (warning: Error & { code?: string }): void => {
      if (warning.code !== undefined) codes.push(warning.code);
    };
    process.on('warning', onWarning);

    try {
      // The client is never used while building or readying the app.
      const app = await buildApp({ client: {} as Client, taskQueue: 'test', corsOrigin: '*' });
      await app.ready();
      // Node emits process warnings on a later tick.
      await new Promise((resolve) => setImmediate(resolve));
      await app.close();
    } finally {
      process.off('warning', onWarning);
    }

    expect(codes.filter((code) => code.startsWith('FSTDEP'))).toEqual([]);
  });

  it("still logs one line per request and not Fastify's default incoming/completed pair", async () => {
    const lines: string[] = [];
    const app = await buildApp({
      client: {} as Client,
      taskQueue: 'test',
      corsOrigin: '*',
      logger: {
        level: 'info',
        stream: { write: (line: string) => void lines.push(line) },
      } as never,
    });
    await app.ready();

    await app.inject({ method: 'GET', url: '/healthz' });
    await app.close();

    const messages = lines.map((line) => (JSON.parse(line) as { msg?: string }).msg);
    expect(messages.filter((message) => message === 'request')).toHaveLength(1);
    expect(messages).not.toContain('incoming request');
    expect(messages).not.toContain('request completed');
  });
});
