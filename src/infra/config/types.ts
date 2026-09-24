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
      model: z.string().min(1).default('claude-sonnet-5'),
      /** Only read when `provider` is `claude`; never logged. */
      apiKey: z.string().min(1).optional(),
    })
    .refine((ai) => ai.provider !== 'claude' || ai.apiKey !== undefined, {
      path: ['apiKey'],
      error: 'ANTHROPIC_API_KEY is required when AI_PROVIDER=claude',
    }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
