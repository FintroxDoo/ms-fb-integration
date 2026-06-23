import { readFileSync } from 'node:fs';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { HttpsOptions } from '@nestjs/common/interfaces/external/https-options.interface';
import * as dotenv from 'dotenv';
import { AppModule } from './app.module';
import { AppConfig } from './config/configuration';

// Load .env before bootstrap so HTTPS cert paths are available pre-create.
dotenv.config();

function loadHttpsOptions(): HttpsOptions | undefined {
  if (process.env.HTTPS_ENABLED !== 'true') return undefined;
  const keyFile = process.env.HTTPS_KEY_FILE ?? './certs/key.pem';
  const certFile = process.env.HTTPS_CERT_FILE ?? './certs/cert.pem';
  try {
    return {
      key: readFileSync(keyFile),
      cert: readFileSync(certFile),
    };
  } catch (err) {
    throw new Error(
      `HTTPS_ENABLED=true but cert files unreadable (${keyFile}, ${certFile}). ` +
        `Generate them (see README "Local HTTPS"). Cause: ${String(err)}`,
    );
  }
}

async function bootstrap(): Promise<void> {
  const httpsOptions = loadHttpsOptions();
  const app = await NestFactory.create(AppModule, { httpsOptions });
  // Express (default) parses JSON + urlencoded bodies — covers FreshBooks
  // form-encoded webhooks. No global ValidationPipe: we have no class-validator
  // DTOs yet (add the package + DTOs if/when request validation is needed).

  const config = app.get(ConfigService<AppConfig, true>);
  const port = config.get('port', { infer: true });
  await app.listen(port);
  const scheme = httpsOptions ? 'https' : 'http';
  new Logger('Bootstrap').log(`Listening on ${scheme}://localhost:${port}`);
}

void bootstrap();
