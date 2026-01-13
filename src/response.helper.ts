import { Injectable } from '@nestjs/common';

export interface StandardResponse<T = any> {
  statusCode: number;
  message: string;
  data?: T;
  error?: any;
}

@Injectable()
export class ResponseHelper {
  success<T>(data: T, message = 'Success', statusCode = 200): StandardResponse<T> {
    return { statusCode, message, data };
  }

  error(message = 'Error', statusCode = 500, error?: any): StandardResponse<null> {
    return { statusCode, message, error };
  }
}
