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

  private async clientsRequest(opts: { email?: string }): Promise<{
    url: string;
    params: Record<string, string>;
    extract: (data: unknown) => { items: FbClient[]; pages: number };
  }> {
    const accountId = await this.oauth.getAccountId();
    const url = `${this.apiBase}/accounting/account/${accountId}/users/clients`;
    const params: Record<string, string> = {};
    if (opts.email) {
      params['search[email]'] = opts.email;
    }
    return {
      url,
      params,
      extract: (data) => {
        const result = (data as FbClientsListResponse).response.result;
        return { items: result.clients, pages: result.pages };
      },
    };
  }

  /** GET active clients, optionally filtered by email. Follows pagination. */
  async listClients(opts: { email?: string } = {}): Promise<FbClient[]> {
    const { url, params, extract } = await this.clientsRequest(opts);
    return this.paginate<FbClient>(url, params, extract);
  }

  /** Stream clients page-by-page (memory-bounded, resumable via startPage). */
  async listClientsEach(
    onPage: (clients: FbClient[], page: number) => Promise<void>,
    opts: { email?: string; startPage?: number } = {},
  ): Promise<void> {
    const { url, params, extract } = await this.clientsRequest(opts);
    await this.paginateEach<FbClient>(
      url,
      params,
      extract,
      onPage,
      opts.startPage,
    );
  }

  /**
   * GET invoices (with line items), optionally filtered by update watermark
   * and/or a single client id. Follows pagination to completion.
   */
  async listInvoices(
    opts: { updatedMin?: string; customerId?: number | string } = {},
  ): Promise<FbInvoice[]> {
    const { url, params, extract } = await this.invoicesRequest(opts);
    return this.paginate<FbInvoice>(url, params, extract);
  }

  /** Stream invoices page-by-page (memory-bounded, resumable via startPage). */
  async listInvoicesEach(
    onPage: (invoices: FbInvoice[], page: number) => Promise<void>,
    opts: {
      updatedMin?: string;
      customerId?: number | string;
      startPage?: number;
    } = {},
  ): Promise<void> {
    const { url, params, extract } = await this.invoicesRequest(opts);
    await this.paginateEach<FbInvoice>(
      url,
      params,
      extract,
      onPage,
      opts.startPage,
    );
  }

  private async invoicesRequest(opts: {
    updatedMin?: string;
    customerId?: number | string;
  }): Promise<{
    url: string;
    params: Record<string, string>;
    extract: (data: unknown) => { items: FbInvoice[]; pages: number };
  }> {
    const accountId = await this.oauth.getAccountId();
    const url = `${this.apiBase}/accounting/account/${accountId}/invoices/invoices`;
    const params: Record<string, string> = { 'include[]': 'lines' };
    if (opts.updatedMin) {
      params['search[updated_min]'] = opts.updatedMin;
    }
    if (opts.customerId !== undefined) {
      params['search[customerid]'] = String(opts.customerId);
    }
    return {
      url,
      params,
      extract: (data) => {
        const result = (data as FbInvoicesListResponse).response.result;
        return { items: result.invoices, pages: result.pages };
      },
    };
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

  /**
   * Stream pages: fetch one page at a time and hand it to `onPage`, never
   * accumulating the whole result set. Memory stays bounded to a single page
   * (PER_PAGE items) regardless of total size — required for large backfills.
   * `startPage` lets a resumed run skip pages already processed.
   */
  private async paginateEach<T>(
    url: string,
    baseParams: Record<string, string>,
    extract: (data: unknown) => { items: T[]; pages: number },
    onPage: (items: T[], page: number) => Promise<void>,
    startPage = 1,
  ): Promise<void> {
    let page = Math.max(1, startPage);
    let totalPages = page;
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
      totalPages = pages;
      if (items.length) await onPage(items, page);
      page += 1;
    } while (page <= totalPages);
  }

  /** Collect every page into one array (small/bounded result sets only). */
  private async paginate<T>(
    url: string,
    baseParams: Record<string, string>,
    extract: (data: unknown) => { items: T[]; pages: number },
  ): Promise<T[]> {
    const all: T[] = [];
    await this.paginateEach<T>(url, baseParams, extract, async (items) => {
      all.push(...items);
    });
    this.logger.log(`Fetched ${all.length} item(s) from ${url}`);
    return all;
  }
}
