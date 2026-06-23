import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfig } from '../config/configuration';
import { withRetry } from '../common/retry';
import {
  UpflowCustomerInput,
  UpflowEntityResponse,
  UpflowInvoiceInput,
} from './upflow.types';

@Injectable()
export class UpflowApiService {
  private readonly logger = new Logger(UpflowApiService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  private get upflow() {
    return this.config.get('upflow', { infer: true });
  }

  private headers(): Record<string, string> {
    const { apiKey, apiSecret } = this.upflow;
    return {
      'X-Api-Key': apiKey,
      'X-Api-Secret': apiSecret,
      'Content-Type': 'application/json',
    };
  }

  /** Create-or-update a customer (idempotent by externalId). */
  async upsertCustomer(
    input: UpflowCustomerInput,
  ): Promise<UpflowEntityResponse> {
    const { data } = await withRetry(
      () =>
        firstValueFrom(
          this.http.post<UpflowEntityResponse>(
            `${this.upflow.apiBase}/customers`,
            input,
            { headers: this.headers() },
          ),
        ),
      { label: `upflow upsertCustomer ${input.externalId ?? input.name}` },
    );
    this.logger.debug(
      `Upserted customer externalId=${input.externalId} -> ${data.id}`,
    );
    return data;
  }

  /** Create-or-update an invoice (idempotent by externalId). */
  async upsertInvoice(
    input: UpflowInvoiceInput,
  ): Promise<UpflowEntityResponse> {
    const { data } = await withRetry(
      () =>
        firstValueFrom(
          this.http.post<UpflowEntityResponse>(
            `${this.upflow.apiBase}/invoices`,
            input,
            { headers: this.headers() },
          ),
        ),
      { label: `upflow upsertInvoice ${input.externalId ?? input.customId}` },
    );
    this.logger.debug(
      `Upserted invoice externalId=${input.externalId} -> ${data.id}`,
    );
    return data;
  }

  /** Delete an invoice by its external id (FreshBooks-derived). */
  async deleteInvoice(externalId: string): Promise<void> {
    await withRetry(
      () =>
        firstValueFrom(
          this.http.delete(
            `${this.upflow.apiBase}/invoices/external:${externalId}`,
            { headers: this.headers() },
          ),
        ),
      { label: `upflow deleteInvoice ${externalId}` },
    );
    this.logger.debug(`Deleted invoice externalId=${externalId}`);
  }

  /** Delete a customer by its external id (FreshBooks-derived). */
  async deleteCustomer(externalId: string): Promise<void> {
    await withRetry(
      () =>
        firstValueFrom(
          this.http.delete(
            `${this.upflow.apiBase}/customers/external:${externalId}`,
            { headers: this.headers() },
          ),
        ),
      { label: `upflow deleteCustomer ${externalId}` },
    );
    this.logger.debug(`Deleted customer externalId=${externalId}`);
  }
}
