import { Injectable, LoggerService } from '@nestjs/common';

@Injectable()
export class AppLogger implements LoggerService {
  log(message: string, ...optionalParams: any[]) {
    console.log(`[LOG] ${message}`, ...optionalParams);
  }
  error(message: string, ...optionalParams: any[]) {
    console.error(`[ERROR] ${message}`, ...optionalParams);
  }
  warn(message: string, ...optionalParams: any[]) {
    console.warn(`[WARN] ${message}`, ...optionalParams);
  }
  debug?(message: string, ...optionalParams: any[]) {
    console.debug(`[DEBUG] ${message}`, ...optionalParams);
  }
  verbose?(message: string, ...optionalParams: any[]) {
    console.info(`[VERBOSE] ${message}`, ...optionalParams);
  }
}
