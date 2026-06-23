import { HttpService } from '@nestjs/axios';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfig } from '../config/configuration';
import { withRetry } from '../common/retry';
import { PrismaService } from '../prisma/prisma.service';
import { FreshbooksOauthService } from './freshbooks-oauth.service';

interface FbCallback {
  callbackid: number;
  id: number;
  event: string;
  uri: string;
  verified: boolean;
}

interface FbCallbackResponse {
  response: { result: { callback: FbCallback } };
}

interface FbCallbackListResponse {
  response: { result: { callbacks: FbCallback[] } };
}

@Injectable()
export class FreshbooksWebhooksService {
  private readonly logger = new Logger(FreshbooksWebhooksService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly oauth: FreshbooksOauthService,
    private readonly prisma: PrismaService,
  ) {}

  private async baseUrl(): Promise<string> {
    const { apiBase } = this.config.get('freshbooks', { infer: true });
    const accountId = await this.oauth.getAccountId();
    return `${apiBase}/events/account/${accountId}/events/callbacks`;
  }

  private async headers(): Promise<Record<string, string>> {
    const token = await this.oauth.getValidAccessToken();
    return {
      Authorization: `Bearer ${token}`,
      'Api-Version': 'alpha',
      'Content-Type': 'application/json',
    };
  }

  private callbackUri(): string {
    const { publicBaseUrl } = this.config.get('webhook', { infer: true });
    if (!publicBaseUrl) {
      throw new Error(
        'PUBLIC_BASE_URL is not set — needed to register webhook callbacks.',
      );
    }
    return `${publicBaseUrl.replace(/\/$/, '')}/webhooks/freshbooks`;
  }

  /** Register a callback per event and persist it (unverified until handshake). */
  async register(events: string[]): Promise<FbCallback[]> {
    const url = await this.baseUrl();
    const uri = this.callbackUri();
    const headers = await this.headers();
    const created: FbCallback[] = [];

    for (const event of events) {
      const { data } = await withRetry(
        () =>
          firstValueFrom(
            this.http.post<FbCallbackResponse>(
              url,
              { callback: { event, uri } },
              { headers },
            ),
          ),
        { label: `fb register callback ${event}` },
      );
      const cb = data.response.result.callback;
      await this.prisma.webhookCallback.upsert({
        where: { callbackId: cb.callbackid },
        create: {
          callbackId: cb.callbackid,
          event: cb.event,
          uri: cb.uri,
          verified: cb.verified,
        },
        update: { event: cb.event, uri: cb.uri, verified: cb.verified },
      });
      created.push(cb);
      this.logger.log(
        `Registered callback ${cb.callbackid} for ${event} (verified=${cb.verified}).`,
      );
    }
    return created;
  }

  /** List callbacks registered at FreshBooks. */
  async list(): Promise<FbCallback[]> {
    const url = await this.baseUrl();
    const headers = await this.headers();
    const { data } = await withRetry(
      () =>
        firstValueFrom(this.http.get<FbCallbackListResponse>(url, { headers })),
      { label: 'fb list callbacks' },
    );
    return data.response.result.callbacks;
  }

  /** Delete a callback at FreshBooks and locally. */
  async remove(callbackId: number): Promise<void> {
    const url = `${await this.baseUrl()}/${callbackId}`;
    const headers = await this.headers();
    await withRetry(() => firstValueFrom(this.http.delete(url, { headers })), {
      label: `fb delete callback ${callbackId}`,
    });
    await this.prisma.webhookCallback
      .delete({ where: { callbackId } })
      .catch(() => undefined);
    this.logger.log(`Deleted callback ${callbackId}.`);
  }

  /** Confirm the verification handshake by echoing the verifier back. */
  async confirm(callbackId: number, verifier: string): Promise<void> {
    const url = `${await this.baseUrl()}/${callbackId}`;
    const headers = await this.headers();
    await withRetry(
      () =>
        firstValueFrom(
          this.http.put(url, { callback: { verifier } }, { headers }),
        ),
      { label: `fb confirm callback ${callbackId}` },
    );
    await this.prisma.webhookCallback.upsert({
      where: { callbackId },
      create: {
        callbackId,
        event: 'unknown',
        uri: this.safeUri(),
        verifier,
        verified: true,
      },
      update: { verifier, verified: true },
    });
    this.logger.log(`Confirmed callback ${callbackId}.`);
  }

  /** Ask FreshBooks to re-send the verification request to our URI. */
  async resend(callbackId: number): Promise<void> {
    const url = `${await this.baseUrl()}/${callbackId}`;
    const headers = await this.headers();
    await withRetry(
      () =>
        firstValueFrom(
          this.http.put(url, { callback: { resend: true } }, { headers }),
        ),
      { label: `fb resend callback ${callbackId}` },
    );
    this.logger.log(
      `Requested verification resend for callback ${callbackId}.`,
    );
  }

  /** All stored verifiers — HMAC keys for authenticating incoming events. */
  async verifiers(): Promise<string[]> {
    const rows = await this.prisma.webhookCallback.findMany({
      where: { verifier: { not: null } },
      select: { verifier: true },
    });
    return rows.map((r) => r.verifier as string);
  }

  private safeUri(): string {
    try {
      return this.callbackUri();
    } catch {
      return '';
    }
  }
}
