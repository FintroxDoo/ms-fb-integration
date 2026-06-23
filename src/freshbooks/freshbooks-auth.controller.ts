import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Res,
} from '@nestjs/common';
import { Response } from 'express';
import { FreshbooksOauthService } from './freshbooks-oauth.service';

// One-time OAuth flow. Visit GET /auth/freshbooks in a browser to authorize.
@Controller('auth/freshbooks')
export class FreshbooksAuthController {
  constructor(private readonly oauth: FreshbooksOauthService) {}

  @Get()
  start(@Res() res: Response): void {
    res.redirect(this.oauth.getAuthorizationUrl());
  }

  @Get('callback')
  async callback(
    @Query('code') code?: string,
    @Query('error') error?: string,
  ): Promise<{ status: string; accountId: string }> {
    if (error) {
      throw new BadRequestException(
        `FreshBooks authorization failed: ${error}`,
      );
    }
    if (!code) {
      throw new BadRequestException('Missing authorization code.');
    }
    const { accountId } = await this.oauth.handleCallback(code);
    return { status: 'authorized', accountId };
  }
}
