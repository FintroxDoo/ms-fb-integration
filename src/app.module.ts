import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { configuration, validateEnv } from './config/configuration';
import { FreshbooksModule } from './freshbooks/freshbooks.module';
import { PrismaModule } from './prisma/prisma.module';
import { SyncModule } from './sync/sync.module';
import { UpflowModule } from './upflow/upflow.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      validate: validateEnv,
    }),
    ScheduleModule.forRoot(),
    PrismaModule,
    FreshbooksModule,
    UpflowModule,
    SyncModule,
  ],
})
export class AppModule {}
