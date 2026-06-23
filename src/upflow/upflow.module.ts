import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { UpflowApiService } from './upflow-api.service';

@Module({
  imports: [HttpModule],
  providers: [UpflowApiService],
  exports: [UpflowApiService],
})
export class UpflowModule {}
