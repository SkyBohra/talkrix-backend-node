import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  Req,
} from '@nestjs/common';
import { UserService } from './user.service';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { TelephonyProvider } from './user.schema';

// DTOs for settings updates
interface UpdateGeneralSettingsDto {
  maxConcurrentCalls?: number;
  maxRagDocuments?: number;
  maxAgents?: number;
}

interface UpdateTelephonySettingsDto {
  provider?: TelephonyProvider;
  // Plivo
  plivoAuthId?: string;
  plivoAuthToken?: string;
  plivoPhoneNumbers?: string[];
  // Twilio
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioPhoneNumbers?: string[];
  // Telnyx
  telnyxApiKey?: string;
  telnyxPhoneNumbers?: string[];
  telnyxConnectionId?: string;
}

@Controller('settings')
@UseGuards(AuthOrApiKeyGuard)
export class SettingsController {
  constructor(
    private userService: UserService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
  ) {}

  // Helper to extract user info from JWT token or API key
  private getUserFromRequest(req: any): { userId: string; email?: string } | null {
    if (req.user?.sub) {
      return { userId: String(req.user.sub), email: req.user.email };
    }
    if (req.apiUser?._id) {
      return { userId: String(req.apiUser._id), email: req.apiUser.email };
    }
    return null;
  }

  /**
   * Get all user settings
   * GET /settings
   */
  @Get()
  async getSettings(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo?.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const user = await this.userService.findById(userInfo.userId);
      if (!user) {
        return this.responseHelper.error('User not found', 404);
      }

      // Return settings with masked sensitive data
      const settings = user.settings || {};
      const telephony = settings.telephony || {};

      return this.responseHelper.success({
        general: {
          maxConcurrentCalls: settings.maxConcurrentCalls ?? 2,
          maxRagDocuments: settings.maxRagDocuments ?? 1,
          maxAgents: settings.maxAgents ?? 10,
        },
        telephony: {
          provider: telephony.provider || 'none',
          // Plivo - mask sensitive data
          plivoAuthId: telephony.plivoAuthId ? this.maskString(telephony.plivoAuthId) : null,
          plivoAuthToken: telephony.plivoAuthToken ? '********' : null,
          plivoPhoneNumbers: telephony.plivoPhoneNumbers || [],
          // Twilio - mask sensitive data
          twilioAccountSid: telephony.twilioAccountSid ? this.maskString(telephony.twilioAccountSid) : null,
          twilioAuthToken: telephony.twilioAuthToken ? '********' : null,
          twilioPhoneNumbers: telephony.twilioPhoneNumbers || [],
          // Telnyx - mask sensitive data
          telnyxApiKey: telephony.telnyxApiKey ? '********' : null,
          telnyxPhoneNumbers: telephony.telnyxPhoneNumbers || [],
          telnyxConnectionId: telephony.telnyxConnectionId || null,
        },
        apiKey: user.apiKey ? this.maskString(user.apiKey) : null,
        maxCorpusLimit: user.maxCorpusLimit ?? 1,
      }, 'Settings fetched successfully');
    } catch (err) {
      this.logger.error('Failed to fetch settings', err);
      return this.responseHelper.error('Failed to fetch settings', 500, err?.message || err);
    }
  }

  /**
   * Update general settings
   * PUT /settings/general
   */
  @Put('general')
  async updateGeneralSettings(@Req() req: any, @Body() body: UpdateGeneralSettingsDto) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo?.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      // Validate settings
      if (body.maxConcurrentCalls !== undefined && (body.maxConcurrentCalls < 1 || body.maxConcurrentCalls > 100)) {
        return this.responseHelper.error('maxConcurrentCalls must be between 1 and 100', 400);
      }
      if (body.maxRagDocuments !== undefined && (body.maxRagDocuments < 1 || body.maxRagDocuments > 100)) {
        return this.responseHelper.error('maxRagDocuments must be between 1 and 100', 400);
      }
      if (body.maxAgents !== undefined && (body.maxAgents < 1 || body.maxAgents > 50)) {
        return this.responseHelper.error('maxAgents must be between 1 and 50', 400);
      }

      const user = await this.userService.updateGeneralSettings(userInfo.userId, body);
      if (!user) {
        return this.responseHelper.error('User not found', 404);
      }

      this.logger.log(`General settings updated for user: ${userInfo.email || userInfo.userId}`);
      return this.responseHelper.success({
        maxConcurrentCalls: user.settings?.maxConcurrentCalls ?? 2,
        maxRagDocuments: user.settings?.maxRagDocuments ?? 1,
        maxAgents: user.settings?.maxAgents ?? 10,
      }, 'General settings updated successfully');
    } catch (err) {
      this.logger.error('Failed to update general settings', err);
      return this.responseHelper.error('Failed to update general settings', 500, err?.message || err);
    }
  }

  /**
   * Update telephony settings
   * PUT /settings/telephony
   */
  @Put('telephony')
  async updateTelephonySettings(@Req() req: any, @Body() body: UpdateTelephonySettingsDto) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo?.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      // Validate provider
      const validProviders: TelephonyProvider[] = ['plivo', 'twilio', 'telnyx', 'none'];
      if (body.provider && !validProviders.includes(body.provider)) {
        return this.responseHelper.error('Invalid telephony provider', 400);
      }

      const user = await this.userService.updateTelephonySettings(userInfo.userId, body);
      if (!user) {
        return this.responseHelper.error('User not found', 404);
      }

      this.logger.log(`Telephony settings updated for user: ${userInfo.email || userInfo.userId}`);
      
      const telephony = user.settings?.telephony || {};
      return this.responseHelper.success({
        provider: telephony.provider || 'none',
        plivoConfigured: !!(telephony.plivoAuthId && telephony.plivoAuthToken),
        twilioConfigured: !!(telephony.twilioAccountSid && telephony.twilioAuthToken),
        telnyxConfigured: !!(telephony.telnyxApiKey),
      }, 'Telephony settings updated successfully');
    } catch (err) {
      this.logger.error('Failed to update telephony settings', err);
      return this.responseHelper.error('Failed to update telephony settings', 500, err?.message || err);
    }
  }

  /**
   * Regenerate API Key
   * PUT /settings/regenerate-api-key
   */
  @Put('regenerate-api-key')
  async regenerateApiKey(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo?.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const user = await this.userService.regenerateApiKey(userInfo.userId);
      if (!user) {
        return this.responseHelper.error('User not found', 404);
      }

      this.logger.log(`API key regenerated for user: ${userInfo.email || userInfo.userId}`);
      return this.responseHelper.success({
        apiKey: user.apiKey,
      }, 'API key regenerated successfully');
    } catch (err) {
      this.logger.error('Failed to regenerate API key', err);
      return this.responseHelper.error('Failed to regenerate API key', 500, err?.message || err);
    }
  }

  /**
   * Get full API key (for display once)
   * GET /settings/api-key
   */
  @Get('api-key')
  async getApiKey(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo?.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const user = await this.userService.findById(userInfo.userId);
      if (!user) {
        return this.responseHelper.error('User not found', 404);
      }

      return this.responseHelper.success({
        apiKey: user.apiKey,
      }, 'API key fetched successfully');
    } catch (err) {
      this.logger.error('Failed to fetch API key', err);
      return this.responseHelper.error('Failed to fetch API key', 500, err?.message || err);
    }
  }

  // Helper to mask sensitive strings
  private maskString(str: string): string {
    if (!str || str.length < 8) return '****';
    return str.substring(0, 4) + '****' + str.substring(str.length - 4);
  }
}
