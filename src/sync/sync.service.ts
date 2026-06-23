import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import pLimit from 'p-limit';
import { AppConfig } from '../config/configuration';
import { FreshbooksApiService } from '../freshbooks/freshbooks-api.service';
import { FbClient, FbInvoice } from '../freshbooks/freshbooks.types';
import { PrismaService } from '../prisma/prisma.service';
import { UpflowApiService } from '../upflow/upflow-api.service';
import {
  UpflowCustomerInput,
  UpflowInvoiceInput,
} from '../upflow/upflow.types';
import {
  mapClientToCustomer,
  mapInvoiceToInvoice,
  toExternalCustomerId,
  toExternalInvoiceId,
} from './mappers';

const CURSOR_KEY = 'invoices.updated_min';

export interface SyncCounts {
  ok: number;
  failed: number;
}

export interface SyncResult {
  customers: SyncCounts;
  invoices: SyncCounts;
}

export interface TestSyncResult {
  dryRun: boolean;
  matchedClient: { fbClientId: number; name: string; email: string };
  invoiceCount: number;
  // populated when dryRun=true: exactly what WOULD be sent to UpFlow
  preview?: { customer: UpflowCustomerInput; invoices: UpflowInvoiceInput[] };
  // populated when dryRun=false: result of the actual UpFlow push
  pushed?: SyncResult;
}

function errMessage(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    return String((err as { message: unknown }).message);
  }
  return String(err);
}

/** Format a Date as FreshBooks `updated_min` expects: "YYYY-MM-DD HH:MM:SS". */
function toFbTimestamp(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 19);
}

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private readonly fb: FreshbooksApiService,
    private readonly upflow: UpflowApiService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get limit() {
    return pLimit(this.config.get('sync', { infer: true }).concurrency);
  }

  /** Full import: every client, then every invoice. */
  async backfill(): Promise<SyncResult> {
    this.logger.log('Backfill started.');
    const startedAt = new Date();
    const clients = await this.fb.listClients();
    const customers = await this.syncCustomers(clients);
    const invoices = await this.fb.listInvoices();
    const invoiceCounts = await this.syncInvoices(invoices);
    await this.setCursor(startedAt);
    this.logger.log(
      `Backfill done. customers ok=${customers.ok}/fail=${customers.failed}, invoices ok=${invoiceCounts.ok}/fail=${invoiceCounts.failed}`,
    );
    return { customers, invoices: invoiceCounts };
  }

  /** Incremental: upsert all clients, then invoices changed since the cursor. */
  async incremental(): Promise<SyncResult> {
    const startedAt = new Date();
    const updatedMin = await this.getCursor();
    this.logger.log(`Incremental sync since ${updatedMin ?? 'beginning'}.`);
    const clients = await this.fb.listClients();
    const customers = await this.syncCustomers(clients);
    const invoices = await this.fb.listInvoices({ updatedMin });
    const invoiceCounts = await this.syncInvoices(invoices);
    await this.setCursor(startedAt);
    return { customers, invoices: invoiceCounts };
  }

  private async syncCustomers(clients: FbClient[]): Promise<SyncCounts> {
    const active = clients.filter((c) => c.vis_state === 0);
    const counts: SyncCounts = { ok: 0, failed: 0 };
    const limit = this.limit;
    await Promise.all(
      active.map((client) =>
        limit(async () => {
          const fbClientId = toExternalCustomerId(client.userid);
          try {
            const res = await this.upflow.upsertCustomer(
              mapClientToCustomer(client),
            );
            await this.recordCustomer(fbClientId, res.id, 'ok');
            counts.ok += 1;
          } catch (err) {
            await this.recordCustomer(
              fbClientId,
              null,
              'error',
              errMessage(err),
            );
            counts.failed += 1;
            this.logger.error(
              `Customer ${fbClientId} failed: ${errMessage(err)}`,
            );
          }
        }),
      ),
    );
    return counts;
  }

  private async syncInvoices(invoices: FbInvoice[]): Promise<SyncCounts> {
    const active = invoices.filter((i) => i.vis_state === 0);
    const counts: SyncCounts = { ok: 0, failed: 0 };
    const limit = this.limit;
    await Promise.all(
      active.map((invoice) =>
        limit(async () => {
          const fbInvoiceId = toExternalInvoiceId(invoice.invoiceid);
          try {
            const res = await this.upflow.upsertInvoice(
              mapInvoiceToInvoice(invoice),
            );
            await this.recordInvoice(fbInvoiceId, res.id, 'ok');
            counts.ok += 1;
          } catch (err) {
            await this.recordInvoice(
              fbInvoiceId,
              null,
              'error',
              errMessage(err),
            );
            counts.failed += 1;
            this.logger.error(
              `Invoice ${fbInvoiceId} failed: ${errMessage(err)}`,
            );
          }
        }),
      ),
    );
    return counts;
  }

  /**
   * Test helper: sync exactly one client (matched by email) and their invoices.
   * dryRun=true fetches + maps + returns the payloads WITHOUT pushing to UpFlow.
   */
  async syncByClientEmail(
    email: string,
    opts: { dryRun: boolean },
  ): Promise<TestSyncResult> {
    const clients = await this.fb.listClients({ email });
    const active = clients.filter((c) => c.vis_state === 0);
    const client =
      active.find((c) => c.email?.toLowerCase() === email.toLowerCase()) ??
      active[0];
    if (!client) {
      throw new NotFoundException(
        `No active FreshBooks client found for email "${email}".`,
      );
    }

    const invoices = (
      await this.fb.listInvoices({ customerId: client.userid })
    ).filter((i) => i.vis_state === 0);

    const matchedClient = {
      fbClientId: client.userid,
      name: client.organization || `${client.fname} ${client.lname}`.trim(),
      email: client.email,
    };

    if (opts.dryRun) {
      this.logger.log(
        `DRY RUN for ${email}: 1 client, ${invoices.length} invoice(s). Nothing pushed.`,
      );
      return {
        dryRun: true,
        matchedClient,
        invoiceCount: invoices.length,
        preview: {
          customer: mapClientToCustomer(client),
          invoices: invoices.map(mapInvoiceToInvoice),
        },
      };
    }

    const customers = await this.syncCustomers([client]);
    const invoiceCounts = await this.syncInvoices(invoices);
    return {
      dryRun: false,
      matchedClient,
      invoiceCount: invoices.length,
      pushed: { customers, invoices: invoiceCounts },
    };
  }

  /**
   * Push a single invoice by FreshBooks id (webhook invoice.create/update).
   * Ensures the invoice's client exists in UpFlow first (customer-before-invoice).
   */
  async syncInvoiceById(invoiceId: string | number): Promise<void> {
    const invoice = await this.fb.getInvoice(invoiceId);
    const client = await this.fb.getClient(invoice.customerid);
    await this.syncCustomers([client]);
    await this.syncInvoices([invoice]);
  }

  /** Push a single client by FreshBooks id (webhook client.create/update). */
  async syncClientById(clientId: string | number): Promise<void> {
    const client = await this.fb.getClient(clientId);
    await this.syncCustomers([client]);
  }

  /** Delete an invoice in UpFlow (webhook invoice.delete). */
  async deleteInvoiceByFbId(invoiceId: string | number): Promise<void> {
    const externalId = toExternalInvoiceId(invoiceId);
    try {
      await this.upflow.deleteInvoice(externalId);
      await this.recordInvoice(externalId, null, 'deleted');
      this.logger.log(`Deleted invoice ${externalId} in UpFlow.`);
    } catch (err) {
      await this.recordInvoice(externalId, null, 'error', errMessage(err));
      this.logger.error(
        `Delete invoice ${externalId} failed: ${errMessage(err)}`,
      );
    }
  }

  /** Delete a customer in UpFlow (webhook client.delete). */
  async deleteClientByFbId(clientId: string | number): Promise<void> {
    const externalId = toExternalCustomerId(clientId);
    try {
      await this.upflow.deleteCustomer(externalId);
      await this.recordCustomer(externalId, null, 'deleted');
      this.logger.log(`Deleted customer ${externalId} in UpFlow.`);
    } catch (err) {
      await this.recordCustomer(externalId, null, 'error', errMessage(err));
      this.logger.error(
        `Delete customer ${externalId} failed: ${errMessage(err)}`,
      );
    }
  }

  private async recordCustomer(
    fbClientId: string,
    upflowCustomerId: string | null,
    status: string,
    error?: string,
  ): Promise<void> {
    await this.prisma.customerSync.upsert({
      where: { fbClientId },
      create: { fbClientId, upflowCustomerId, status, error },
      update: { upflowCustomerId, status, error: error ?? null },
    });
  }

  private async recordInvoice(
    fbInvoiceId: string,
    upflowInvoiceId: string | null,
    status: string,
    error?: string,
  ): Promise<void> {
    await this.prisma.invoiceSync.upsert({
      where: { fbInvoiceId },
      create: { fbInvoiceId, upflowInvoiceId, status, error },
      update: { upflowInvoiceId, status, error: error ?? null },
    });
  }

  private async getCursor(): Promise<string | undefined> {
    const row = await this.prisma.syncCursor.findUnique({
      where: { key: CURSOR_KEY },
    });
    return row?.value;
  }

  private async setCursor(date: Date): Promise<void> {
    const value = toFbTimestamp(date);
    await this.prisma.syncCursor.upsert({
      where: { key: CURSOR_KEY },
      create: { key: CURSOR_KEY, value },
      update: { value },
    });
  }
}
