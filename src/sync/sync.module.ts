import { Module } from '@nestjs/common';
import { FreshbooksModule } from '../freshbooks/freshbooks.module';
import { UpflowModule } from '../upflow/upflow.module';
import { SyncController } from './sync.controller';
import { SyncCron } from './sync.cron';
import { SyncService } from './sync.service';

@Module({
  imports: [FreshbooksModule, UpflowModule],
  controllers: [SyncController],
  providers: [SyncService, SyncCron],
  exports: [SyncService],
})
export class SyncModule {}
