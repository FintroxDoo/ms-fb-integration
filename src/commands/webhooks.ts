import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { FreshbooksWebhooksService } from '../freshbooks/freshbooks-webhooks.service';

// Events we subscribe to (invoice + client lifecycle).
const EVENTS = [
  'invoice.create',
  'invoice.update',
  'invoice.delete',
  'client.create',
  'client.update',
  'client.delete',
];

// CLI: `npm run webhooks:register | webhooks:list | webhooks:clear`.
async function main(): Promise<void> {
  const logger = new Logger('webhooks');
  const action = process.argv[2] ?? 'list';
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['log', 'warn', 'error'],
  });
  try {
    const webhooks = app.get(FreshbooksWebhooksService);
    switch (action) {
      case 'register': {
        const created = await webhooks.register(EVENTS);
        logger.log(
          `Registered ${created.length} callback(s). Now waiting for FreshBooks to POST the verification handshake to your PUBLIC_BASE_URL — make sure the app + tunnel are running.`,
        );
        break;
      }
      case 'list': {
        const callbacks = await webhooks.list();
        logger.log(`Callbacks (${callbacks.length}):`);
        for (const c of callbacks) {
          logger.log(
            `  #${c.callbackid} ${c.event} verified=${c.verified} ${c.uri}`,
          );
        }
        break;
      }
      case 'clear': {
        const callbacks = await webhooks.list();
        for (const c of callbacks) {
          await webhooks.remove(c.callbackid);
        }
        logger.log(`Removed ${callbacks.length} callback(s).`);
        break;
      }
      default:
        logger.error(
          `Unknown action "${action}". Use register | list | clear.`,
        );
        process.exitCode = 1;
    }
  } catch (err) {
    logger.error(`webhooks ${action} failed: ${String(err)}`);
    process.exitCode = 1;
  } finally {
    await app.close();
  }
}

void main();
