import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { FreshbooksApiService } from './freshbooks-api.service';
import { FreshbooksAuthController } from './freshbooks-auth.controller';
import { FreshbooksOauthService } from './freshbooks-oauth.service';
import { FreshbooksWebhooksService } from './freshbooks-webhooks.service';

@Module({
  imports: [HttpModule],
  controllers: [FreshbooksAuthController],
  providers: [
    FreshbooksOauthService,
    FreshbooksApiService,
    FreshbooksWebhooksService,
  ],
  exports: [
    FreshbooksOauthService,
    FreshbooksApiService,
    FreshbooksWebhooksService,
  ],
})
export class FreshbooksModule {}
