import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { ResponseHelper } from './response.helper';
import { AppLogger } from './app.logger';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
  ) {}

  @Get()
  getHello() {
    this.logger.log('Hello endpoint called');
    return this.responseHelper.success(this.appService.getHello(), 'Hello World!');
  }
}
