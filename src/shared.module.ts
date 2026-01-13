import { Module } from '@nestjs/common';
import { AppLogger } from './app.logger';
import { ResponseHelper } from './response.helper';

@Module({
  providers: [AppLogger, ResponseHelper],
  exports: [AppLogger, ResponseHelper],
})
export class SharedModule {}
