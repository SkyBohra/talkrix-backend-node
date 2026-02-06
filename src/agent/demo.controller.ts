import { Controller, Post, Body, Get } from '@nestjs/common';
import { UltravoxService } from './ultravox.service';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';
import { ConfigService } from '@nestjs/config';

/**
 * Public Demo Controller
 * Allows unauthenticated users to try the voice AI demo
 * Uses a pre-configured demo agent
 */
@Controller('demo')
export class DemoController {
  constructor(
    private readonly ultravoxService: UltravoxService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Create a demo call for testing
   * This endpoint is public (no auth required)
   * Uses a pre-configured demo agent ID from environment
   */
  @Post('call')
  async createDemoCall(@Body() body: any) {
    try {
      // Get the demo agent ID from environment
      const demoAgentId = this.configService.get<string>('DEMO_AGENT_ID');
      
      if (!demoAgentId) {
        this.logger.warn('DEMO_AGENT_ID not configured in environment');
        return this.responseHelper.error(
          'Demo is not configured. Please contact support.',
          503,
        );
      }

      // Create a call with limited duration for demo
      const result = await this.ultravoxService.createCallForAgent(demoAgentId, {
        maxDuration: body.maxDuration || '180s', // 3 minutes max for demo
        recordingEnabled: false, // Don't record demo calls
      });

      if (result.statusCode === 201 && result.data) {
        this.logger.log(`Demo call created: ${result.data.callId}`);
        return this.responseHelper.success(
          {
            callId: result.data.callId,
            joinUrl: result.data.joinUrl,
          },
          'Demo call created',
          201,
        );
      }

      return result;
    } catch (err) {
      this.logger.error('Error creating demo call', err);
      return this.responseHelper.error(
        'Failed to create demo call',
        500,
        err?.message || err,
      );
    }
  }

  /**
   * Check if demo is available
   */
  @Get('status')
  async getDemoStatus() {
    const demoAgentId = this.configService.get<string>('DEMO_AGENT_ID');
    const isAvailable = !!demoAgentId;

    return this.responseHelper.success(
      {
        available: isAvailable,
        message: isAvailable
          ? 'Demo is available'
          : 'Demo is not configured',
      },
      'Demo status',
    );
  }
}
