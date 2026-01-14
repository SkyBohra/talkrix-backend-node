import { Controller, Post, Body, Get, UseGuards, Req } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';
import { AuthOrApiKeyGuard } from './auth-or-apikey.guard';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UserService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
  ) {}

  // Helper to extract user info from JWT token or API key
  private getUserFromRequest(req: any): { userId: string; email?: string } | null {
    // JWT token: payload has { email, sub: userId }
    if (req.user?.sub) {
      return { userId: String(req.user.sub), email: req.user.email };
    }
    // API key: user document attached directly
    if (req.apiUser?._id) {
      return { userId: String(req.apiUser._id), email: req.apiUser.email };
    }
    return null;
  }

  /**
   * Get current user info including limits
   * GET /auth/me
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get('me')
  async getMe(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }
    try {
      const user = await this.userService.findById(userInfo.userId);
      if (!user) {
        return this.responseHelper.error('User not found', 404);
      }
      return this.responseHelper.success({
        id: user._id,
        email: user.email,
        name: user.name,
        maxCorpusLimit: user.maxCorpusLimit ?? 1,
      }, 'User info fetched');
    } catch (err) {
      this.logger.error('Failed to fetch user info', err);
      return this.responseHelper.error('Failed to fetch user info', 500, err?.message || err);
    }
  }

  @Post('login')
  async login(@Body() body: { email: string; password: string }) {
    try {
      const user = await this.authService.validateUser(body.email, body.password);
      const loginResult = await this.authService.login(user);
      this.logger.log(`User login: ${user.email}`);
      return this.responseHelper.success({
        ...loginResult,
        apiKey: user.apiKey,
        name: user.name,
        email: user.email,
      }, 'Login successful');
    } catch (err) {
      this.logger.error('Login failed', err);
      return this.responseHelper.error('Login failed', 401, err?.message || err);
    }
  }

  @Post('register')
  async register(@Body() body: { email: string; password: string; name: string }) {
    try {
      const user = await this.userService.create(body.email, body.password, body.name);
      const loginResult = await this.authService.login(user);
      this.logger.log(`User registered: ${user.email}`);
      return this.responseHelper.success({
        ...loginResult,
        apiKey: user.apiKey,
        name: user.name,
        email: user.email,
      }, 'Registration successful', 201);
    } catch (err) {
      this.logger.error('Registration failed', err);
      return this.responseHelper.error('Registration failed', 400, err?.message || err);
    }
  }
}
