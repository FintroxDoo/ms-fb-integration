import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { SyncService } from '../sync/sync.service';

// Standalone full import: `npm run backfill`.
// Boots the Nest DI container without the HTTP server, runs backfill, exits.
async function main(): Promise<void> {
  const logger = new Logger('backfill');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const sync = app.get(SyncService);
    const result = await sync.backfill();
    logger.log(`Backfill complete: ${JSON.stringify(result)}`);
  } catch (err) {
    logger.error(`Backfill failed: ${String(err)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
