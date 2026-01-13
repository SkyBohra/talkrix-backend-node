import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';

@Injectable()
export class AuthOrApiKeyGuard implements CanActivate {
  constructor(private jwtService: JwtService, private userService: UserService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const authHeader = req.headers['authorization'];
    const apiKey = req.headers['x-api-key'];

    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.slice(7);
      try {
        const payload = this.jwtService.verify(token);
        req.user = payload;
        return true;
      } catch (err) {
         console.error('JWT verification error:', err);
        throw new UnauthorizedException('Invalid JWT');
      }
    }

    if (apiKey) {
      const user = await this.userService.findByApiKey(apiKey);
      if (!user) throw new UnauthorizedException('Invalid API key');
      req.apiUser = user;
      return true;
    }

    throw new UnauthorizedException('No valid auth provided');
  }
}
