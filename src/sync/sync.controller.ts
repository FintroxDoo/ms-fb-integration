import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../config/configuration';
import { FreshbooksWebhooksService } from '../freshbooks/freshbooks-webhooks.service';
import {
  SIGNATURE_HEADER,
  verifyFreshbooksSignature,
} from '../freshbooks/webhook-signature';
import { SyncResult, SyncService, TestSyncResult } from './sync.service';

// FreshBooks webhook payload is form-encoded; these are the fields we care about.
interface FreshbooksWebhookBody {
  name?: string; // event, e.g. "invoice.create" / "invoice.update"
  object_id?: string; // the affected object id
  account_id?: string;
  verifier?: string; // present on the verification handshake
  callbackid?: string; // present on the verification handshake
}

@Controller()
export class SyncController {
  private readonly logger = new Logger(SyncController.name);

  constructor(
    private readonly sync: SyncService,
    private readonly webhooks: FreshbooksWebhooksService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /** Manual incremental sync trigger. */
  @Post('sync')
  async manualSync(): Promise<SyncResult> {
    return this.sync.incremental();
  }

  /** Manual full backfill trigger. */
  @Post('sync/backfill')
  async backfill(): Promise<SyncResult> {
    return this.sync.backfill();
  }

  /**
   * Test a single client by email. Defaults to a DRY RUN (fetch + map + return
   * the UpFlow payloads without pushing). Pass dryRun=false to actually push.
   *   POST /sync/test?email=marijana@superegoholding.net
   *   POST /sync/test?email=marijana@superegoholding.net&dryRun=false
   */
  @Post('sync/test')
  async test(
    @Query('email') email?: string,
    @Query('dryRun') dryRun?: string,
  ): Promise<TestSyncResult> {
    if (!email) {
      throw new BadRequestException('Query param "email" is required.');
    }
    // Safe default: only push when dryRun is explicitly "false".
    const isDryRun = dryRun !== 'false';
    return this.sync.syncByClientEmail(email, { dryRun: isDryRun });
  }

  /**
   * FreshBooks webhook receiver. Handles the verification handshake, verifies
   * the HMAC signature on live events, then dispatches the work asynchronously
   * and returns 200 immediately.
   */
  @Post('webhooks/freshbooks')
  @HttpCode(200)
  async webhook(
    @Body() body: FreshbooksWebhookBody,
    @Headers(SIGNATURE_HEADER) signature?: string,
  ): Promise<{ received: boolean }> {
    // 1. Verification handshake — echo the verifier back to FreshBooks.
    if (body.verifier) {
      const callbackId = Number(body.callbackid ?? body.object_id);
      if (!Number.isFinite(callbackId)) {
        this.logger.error(
          `Handshake received but no callback id in payload: ${JSON.stringify(body)}`,
        );
        return { received: true };
      }
      await this.webhooks.confirm(callbackId, body.verifier);
      this.logger.log(`Verified webhook callback ${callbackId}.`);
      return { received: true };
    }

    // 2. Authenticate the event via HMAC signature.
    const { verifySignature } = this.config.get('webhook', { infer: true });
    if (verifySignature) {
      const verifiers = await this.webhooks.verifiers();
      const fields = body as Record<string, string>;
      if (!verifyFreshbooksSignature(verifiers, fields, signature)) {
        this.logger.warn(
          `Rejected webhook with invalid signature (event=${body.name}).`,
        );
        throw new UnauthorizedException('Invalid webhook signature.');
      }
    }

    // 3. Respond 200 immediately; process the event out-of-band.
    if (body.name && body.object_id) {
      void this.dispatch(body.name, body.object_id).catch((err) =>
        this.logger.error(
          `Webhook ${body.name} (${body.object_id}) failed: ${String(err)}`,
        ),
      );
    }
    return { received: true };
  }

  private async dispatch(name: string, objectId: string): Promise<void> {
    switch (name) {
      case 'invoice.create':
      case 'invoice.update':
        return this.sync.syncInvoiceById(objectId);
      case 'invoice.delete':
        return this.sync.deleteInvoiceByFbId(objectId);
      case 'client.create':
      case 'client.update':
        return this.sync.syncClientById(objectId);
      case 'client.delete':
        return this.sync.deleteClientByFbId(objectId);
      default:
        this.logger.log(`Ignoring unhandled webhook event "${name}".`);
        return;
    }
  }
}
