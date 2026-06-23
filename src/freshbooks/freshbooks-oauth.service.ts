import { HttpService } from '@nestjs/axios';
import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { AppConfig } from '../config/configuration';
import { PrismaService } from '../prisma/prisma.service';
import { FbMeResponse, FbTokenResponse } from './freshbooks.types';

const PROVIDER = 'freshbooks';
// Refresh proactively if the token expires within this window.
const REFRESH_SKEW_MS = 60_000;

@Injectable()
export class FreshbooksOauthService {
  private readonly logger = new Logger(FreshbooksOauthService.name);

  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  private fb() {
    return this.config.get('freshbooks', { infer: true });
  }

  /** Build the FreshBooks consent URL the user visits once to authorize. */
  getAuthorizationUrl(state?: string): string {
    const fb = this.fb();
    const params = new URLSearchParams({
      client_id: fb.clientId,
      response_type: 'code',
      redirect_uri: fb.redirectUri,
      scope: fb.scopes,
    });
    if (state) params.set('state', state);
    return `${fb.authBase}/oauth/authorize?${params.toString()}`;
  }

  /** Exchange the auth code for tokens, resolve account_id, and persist. */
  async handleCallback(code: string): Promise<{ accountId: string }> {
    const token = await this.exchange({
      grant_type: 'authorization_code',
      code,
    });
    const accountId = await this.resolveAccountId(token.access_token);
    await this.persist(token, accountId);
    this.logger.log(`FreshBooks authorized. account_id=${accountId}`);
    return { accountId };
  }

  /** Returns a non-expired access token, refreshing if necessary. */
  async getValidAccessToken(): Promise<string> {
    const stored = await this.prisma.oAuthToken.findUnique({
      where: { provider: PROVIDER },
    });
    if (!stored) {
      throw new UnauthorizedException(
        'FreshBooks not authorized yet. Visit /auth/freshbooks first.',
      );
    }
    if (stored.expiresAt.getTime() - REFRESH_SKEW_MS > Date.now()) {
      return stored.accessToken;
    }
    this.logger.log('FreshBooks access token expiring — refreshing.');
    const token = await this.exchange({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
    });
    await this.persist(token, stored.accountId ?? undefined);
    return token.access_token;
  }

  /** The FreshBooks account_id resolved at authorization time. */
  async getAccountId(): Promise<string> {
    const stored = await this.prisma.oAuthToken.findUnique({
      where: { provider: PROVIDER },
    });
    if (!stored?.accountId) {
      throw new UnauthorizedException(
        'FreshBooks account_id unknown. Re-authorize via /auth/freshbooks.',
      );
    }
    return stored.accountId;
  }

  private async exchange(
    grant: Record<string, string>,
  ): Promise<FbTokenResponse> {
    const fb = this.fb();
    const body = {
      client_id: fb.clientId,
      client_secret: fb.clientSecret,
      redirect_uri: fb.redirectUri,
      ...grant,
    };
    const { data } = await firstValueFrom(
      this.http.post<FbTokenResponse>(`${fb.apiBase}/auth/oauth/token`, body, {
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    return data;
  }

  private async resolveAccountId(accessToken: string): Promise<string> {
    const fb = this.fb();
    const { data } = await firstValueFrom(
      this.http.get<FbMeResponse>(`${fb.apiBase}/auth/api/v1/users/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Api-Version': 'alpha',
        },
      }),
    );
    const membership = data.response.business_memberships?.find(
      (m) => m.business?.account_id,
    );
    if (!membership) {
      throw new Error('No business membership with an account_id found.');
    }
    return membership.business.account_id;
  }

  private async persist(
    token: FbTokenResponse,
    accountId?: string,
  ): Promise<void> {
    const expiresAt = new Date(Date.now() + token.expires_in * 1000);
    await this.prisma.oAuthToken.upsert({
      where: { provider: PROVIDER },
      create: {
        provider: PROVIDER,
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        accountId,
      },
      update: {
        accessToken: token.access_token,
        refreshToken: token.refresh_token,
        expiresAt,
        ...(accountId ? { accountId } : {}),
      },
    });
  }
}
