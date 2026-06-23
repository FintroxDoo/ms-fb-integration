import { z } from 'zod';

// Validate + shape process.env into a typed config tree.
const envSchema = z.object({
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().min(1),

  FRESHBOOKS_CLIENT_ID: z.string().min(1),
  FRESHBOOKS_CLIENT_SECRET: z.string().min(1),
  FRESHBOOKS_REDIRECT_URI: z
    .string()
    .url()
    .default('https://localhost:3000/auth/freshbooks/callback'),
  FRESHBOOKS_API_BASE: z.string().url().default('https://api.freshbooks.com'),
  FRESHBOOKS_AUTH_BASE: z.string().url().default('https://auth.freshbooks.com'),
  FRESHBOOKS_SCOPES: z
    .string()
    .default('user:profile:read user:invoices:read user:clients:read'),

  UPFLOW_API_KEY: z.string().min(1),
  UPFLOW_API_SECRET: z.string().min(1),
  UPFLOW_API_BASE: z.string().url().default('https://api.sandbox.upflow.io/v1'),

  SYNC_CRON_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  SYNC_CRON_EXPRESSION: z.string().default('*/15 * * * *'),
  SYNC_CONCURRENCY: z.coerce.number().int().positive().max(10).default(5),

  HTTPS_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  HTTPS_KEY_FILE: z.string().default('./certs/key.pem'),
  HTTPS_CERT_FILE: z.string().default('./certs/cert.pem'),

  // Public HTTPS base URL (e.g. ngrok) used to register webhook callbacks.
  // Only required for `npm run webhooks:register`; blank otherwise.
  PUBLIC_BASE_URL: z.string().url().or(z.literal('')).default(''),
  WEBHOOK_VERIFY_SIGNATURE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
});

export type Env = z.infer<typeof envSchema>;

export interface AppConfig {
  port: number;
  databaseUrl: string;
  freshbooks: {
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    apiBase: string;
    authBase: string;
    scopes: string;
  };
  upflow: {
    apiKey: string;
    apiSecret: string;
    apiBase: string;
  };
  sync: {
    cronEnabled: boolean;
    cronExpression: string;
    concurrency: number;
  };
  https: {
    enabled: boolean;
    keyFile: string;
    certFile: string;
  };
  webhook: {
    publicBaseUrl: string;
    verifySignature: boolean;
  };
}

// Used by @nestjs/config `validate`. Throws on invalid env (fail fast at boot).
export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment variables:\n${issues}`);
  }
  return parsed.data;
}

// Used by @nestjs/config `load` to expose a typed nested config tree.
export function configuration(): AppConfig {
  const env = validateEnv(process.env);
  return {
    port: env.PORT,
    databaseUrl: env.DATABASE_URL,
    freshbooks: {
      clientId: env.FRESHBOOKS_CLIENT_ID,
      clientSecret: env.FRESHBOOKS_CLIENT_SECRET,
      redirectUri: env.FRESHBOOKS_REDIRECT_URI,
      apiBase: env.FRESHBOOKS_API_BASE,
      authBase: env.FRESHBOOKS_AUTH_BASE,
      scopes: env.FRESHBOOKS_SCOPES,
    },
    upflow: {
      apiKey: env.UPFLOW_API_KEY,
      apiSecret: env.UPFLOW_API_SECRET,
      apiBase: env.UPFLOW_API_BASE,
    },
    sync: {
      cronEnabled: env.SYNC_CRON_ENABLED,
      cronExpression: env.SYNC_CRON_EXPRESSION,
      concurrency: env.SYNC_CONCURRENCY,
    },
    https: {
      enabled: env.HTTPS_ENABLED,
      keyFile: env.HTTPS_KEY_FILE,
      certFile: env.HTTPS_CERT_FILE,
    },
    webhook: {
      publicBaseUrl: env.PUBLIC_BASE_URL,
      verifySignature: env.WEBHOOK_VERIFY_SIGNATURE,
    },
  };
}
