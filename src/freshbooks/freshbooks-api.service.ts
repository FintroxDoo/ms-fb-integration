import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfig } from '../config/configuration';
import { withRetry } from '../common/retry';
import { FreshbooksOauthService } from './freshbooks-oauth.service';
import {
  FbClient,
  FbClientSingleResponse,
  FbClientsListResponse,
  FbInvoice,
  FbInvoiceSingleResponse,
  FbInvoicesListResponse,
} from './freshbooks.types';

const PER_PAGE = 100; // FreshBooks caps list pages at 100.

@Injectable()
export class FreshbooksApiService {
  private readonly logger = new Logger(FreshbooksApiService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly oauth: FreshbooksOauthService,
  ) {}

  private get apiBase(): string {
    return this.config.get('freshbooks', { infer: true }).apiBase;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.oauth.getValidAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    };
  }

  /** GET active clients, optionally filtered by email. Follows pagination. */
  async listClients(opts: { email?: string } = {}): Promise<FbClient[]> {
    const accountId = await this.oauth.getAccountId();
    const url = `${this.apiBase}/accounting/account/${accountId}/users/clients`;
    const params: Record<string, string> = {};
    if (opts.email) {
      params['search[email]'] = opts.email;
    }
    return this.paginate<FbClient>(url, params, (data) => {
      const result = (data as FbClientsListResponse).response.result;
      return { items: result.clients, pages: result.pages };
    });
  }

  /**
   * GET invoices (with line items), optionally filtered by update watermark
   * and/or a single client id. Follows pagination to completion.
   */
  async listInvoices(
    opts: { updatedMin?: string; customerId?: number | string } = {},
  ): Promise<FbInvoice[]> {
    const accountId = await this.oauth.getAccountId();
    const url = `${this.apiBase}/accounting/account/${accountId}/invoices/invoices`;
    const params: Record<string, string> = { 'include[]': 'lines' };
    if (opts.updatedMin) {
      params['search[updated_min]'] = opts.updatedMin;
    }
    if (opts.customerId !== undefined) {
      params['search[customerid]'] = String(opts.customerId);
    }
    return this.paginate<FbInvoice>(url, params, (data) => {
      const result = (data as FbInvoicesListResponse).response.result;
      return { items: result.invoices, pages: result.pages };
    });
  }

  /** GET a single client by id. */
  async getClient(clientId: string | number): Promise<FbClient> {
    const accountId = await this.oauth.getAccountId();
    const url = `${this.apiBase}/accounting/account/${accountId}/users/clients/${clientId}`;
    const headers = await this.authHeaders();
    const { data } = await withRetry(
      () =>
        firstValueFrom(this.http.get<FbClientSingleResponse>(url, { headers })),
      { label: `fb getClient ${clientId}` },
    );
    return data.response.result.client;
  }

  /** GET a single invoice with line items. */
  async getInvoice(invoiceId: string | number): Promise<FbInvoice> {
    const accountId = await this.oauth.getAccountId();
    const url = `${this.apiBase}/accounting/account/${accountId}/invoices/invoices/${invoiceId}`;
    const headers = await this.authHeaders();
    const { data } = await withRetry(
      () =>
        firstValueFrom(
          this.http.get<FbInvoiceSingleResponse>(url, {
            headers,
            params: { 'include[]': 'lines' },
          }),
        ),
      { label: `fb getInvoice ${invoiceId}` },
    );
    return data.response.result.invoice;
  }

  private async paginate<T>(
    url: string,
    baseParams: Record<string, string>,
    extract: (data: unknown) => { items: T[]; pages: number },
  ): Promise<T[]> {
    const all: T[] = [];
    let page = 1;
    let totalPages = 1;
    do {
      const headers = await this.authHeaders();
      const params = {
        ...baseParams,
        page: String(page),
        per_page: String(PER_PAGE),
      };
      const { data } = await withRetry(
        () => firstValueFrom(this.http.get(url, { headers, params })),
        { label: `fb GET ${url} p${page}` },
      );
      const { items, pages } = extract(data);
      all.push(...items);
      totalPages = pages;
      page += 1;
    } while (page <= totalPages);
    this.logger.log(`Fetched ${all.length} item(s) from ${url}`);
    return all;
  }
}
