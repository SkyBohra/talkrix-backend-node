import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../user/user.schema';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    @InjectModel(User.name) private userModel: Model<User>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers['authorization'] || '';
    let apiKey = '';

    if (authHeader.startsWith('Bearer ')) {
      // Bearer token (JWT)
      return true; // Let existing JWT guard handle this
    } else if (authHeader.startsWith('Api-Key ')) {
      apiKey = authHeader.replace('Api-Key ', '').trim();
    } else if (request.headers['x-api-key']) {
      apiKey = String(request.headers['x-api-key']);
    }

    if (!apiKey) {
      throw new UnauthorizedException('API key or Bearer token required');
    }

    const user = await this.userModel.findOne({ apiKey });
    if (!user) {
      throw new UnauthorizedException('Invalid API key');
    }
    // Optionally attach user to request
    (request as any).user = user;
    return true;
  }
}
