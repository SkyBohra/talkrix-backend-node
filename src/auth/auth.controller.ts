import { Controller, Post, Body } from '@nestjs/common';
import { AuthService } from './auth.service';
import { UserService } from '../user/user.service';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';

@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private userService: UserService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
  ) {}

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
