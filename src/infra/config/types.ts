export type RawEnv = Record<string, string | undefined>;

/**
 * Configuration: the ONLY module that reads `process.env`. Everything else depends on the
 * typed, frozen `AppConfig` returned here (DIP + DRY).
 *
 * Sources are merged with precedence (highest → lowest): real `process.env` → `.env.local`
 * → `.env` → schema defaults. The app runs with no env files at all. Loading uses Node's
 * native `util.parseEnv` (no dotenv dependency).
 */

import { z } from 'zod';

/**
 * The default `ANTHROPIC_MODEL`. The ONLY place this literal is allowed to appear — everything
 * else (tests, docs) either imports it or uses an unrelated placeholder model string.
 *
 * Anthropic's model IDs are permanently pinned snapshots by design (no "evergreen" alias exists
 * that quietly moves forward when a new model ships — see
 * https://platform.claude.com/docs/en/about-claude/models/model-ids-and-versions), so this value
 * WILL need a manual bump when adopting a newer model. When it does, that is rarely just a
 * string swap: re-check `activities/claude-ai-tools.ts`'s request-shaping assumptions (accepted
 * `thinking`/`effort` values, sampling params) against the new model's docs, bump
 * `@anthropic-ai/sdk` if its types don't have a config it needs yet, then verify live with
 * `npm run claude:check` before trusting it. See CLAUDE.md's "Claude adapter" section.
 */
export const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-5-5';

export const AppConfigSchema = z.object({
  nodeEnv: z.enum(['development', 'test', 'production']).default('development'),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  http: z.object({
    port: z.coerce.number().int().positive().default(3000),
    host: z.string().min(1).default('0.0.0.0'),
  }),
  corsOrigin: z.string().min(1).default('*'),
  temporal: z.object({
    connection: z.object({
      address: z.string().min(1).default('localhost:7233'),
      namespace: z.string().min(1).default('default'),
      apiKey: z.string().min(1).optional(),
    }),
    taskQueue: z.string().min(1).default('ai-agent'),
  }),
  ai: z
    .object({
      /** Which `AiToolsActivities` strategy the worker registers. */
      provider: z.enum(['mock', 'claude']).default('mock'),
      model: z.string().min(1).default(DEFAULT_CLAUDE_MODEL),
      /** Only read when `provider` is `claude`; never logged. */
      apiKey: z.string().min(1).optional(),
    })
    .refine((ai) => ai.provider !== 'claude' || ai.apiKey !== undefined, {
      path: ['apiKey'],
      error: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=claude',
    }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
