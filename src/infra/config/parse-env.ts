import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

import type { RawEnv } from './types';

const parseFile = (path: string): RawEnv => {
  try {
    return parseEnv(readFileSync(path, 'utf8'));
  } catch {
    return {}; // missing/unreadable file → contributes nothing
  }
};

/** Merge env sources with precedence: `process.env` > `.env.local` > `.env`. */
export const readEnv = (): RawEnv => ({
  ...parseFile('.env'),
  ...parseFile('.env.local'),
  ...process.env,
});
