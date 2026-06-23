import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AppConfig } from '../config/configuration';
import { SyncService } from './sync.service';

const JOB_NAME = 'freshbooks-incremental-sync';

/**
 * Registers an incremental-sync cron job at startup, but only when
 * SYNC_CRON_ENABLED=true. Dormant by default (local dev uses manual / backfill).
 */
@Injectable()
export class SyncCron implements OnModuleInit {
  private readonly logger = new Logger(SyncCron.name);
  private running = false;

  constructor(
    private readonly sync: SyncService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    const { cronEnabled, cronExpression } = this.config.get('sync', {
      infer: true,
    });
    if (!cronEnabled) {
      this.logger.log('Sync cron disabled (SYNC_CRON_ENABLED=false).');
      return;
    }
    const job = new CronJob(cronExpression, () => this.tick());
    this.scheduler.addCronJob(JOB_NAME, job as never);
    job.start();
    this.logger.log(`Sync cron enabled: "${cronExpression}".`);
  }

  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous sync still running; skipping this tick.');
      return;
    }
    this.running = true;
    try {
      const res = await this.sync.incremental();
      this.logger.log(
        `Cron sync: customers ok=${res.customers.ok}/fail=${res.customers.failed}, invoices ok=${res.invoices.ok}/fail=${res.invoices.failed}`,
      );
    } catch (err) {
      this.logger.error(`Cron sync failed: ${String(err)}`);
    } finally {
      this.running = false;
    }
  }
}
