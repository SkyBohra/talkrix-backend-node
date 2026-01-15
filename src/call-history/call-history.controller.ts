import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  Req,
} from '@nestjs/common';
import { CallHistoryService } from './call-history.service';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';

@Controller('call-history')
export class CallHistoryController {
  constructor(
    private readonly callHistoryService: CallHistoryService,
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
   * Get all call history for the current user with pagination and filters
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get()
  async findAll(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: string,
    @Query('callType') callType?: string,
    @Query('agentId') agentId?: string,
  ) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      this.logger.warn('userId missing in get call history');
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const result = await this.callHistoryService.findByUserId(userInfo.userId, {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
        status: status as any,
        callType: callType as any,
        agentId,
      });
      return this.responseHelper.success(result, 'Call history fetched');
    } catch (err) {
      this.logger.error('Error fetching call history', err);
      return this.responseHelper.error('Failed to fetch call history', 500, err?.message || err);
    }
  }

  /**
   * Get call statistics for the current user
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get('stats')
  async getStats(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      this.logger.warn('userId missing in get call stats');
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const stats = await this.callHistoryService.getStatsByUserId(userInfo.userId);
      return this.responseHelper.success(stats, 'Call stats fetched');
    } catch (err) {
      this.logger.error('Error fetching call stats', err);
      return this.responseHelper.error('Failed to fetch call stats', 500, err?.message || err);
    }
  }

  /**
   * Get call history for a specific agent
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get('agent/:agentId')
  async findByAgent(
    @Param('agentId') agentId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const result = await this.callHistoryService.findByAgentId(agentId, {
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? parseInt(limit, 10) : 20,
      });
      return this.responseHelper.success(result, 'Call history for agent fetched');
    } catch (err) {
      this.logger.error('Error fetching call history for agent', err);
      return this.responseHelper.error('Failed to fetch call history', 500, err?.message || err);
    }
  }

  /**
   * Get call statistics for a specific agent
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get('agent/:agentId/stats')
  async getAgentStats(@Param('agentId') agentId: string) {
    try {
      const stats = await this.callHistoryService.getStatsByAgentId(agentId);
      return this.responseHelper.success(stats, 'Agent call stats fetched');
    } catch (err) {
      this.logger.error('Error fetching agent call stats', err);
      return this.responseHelper.error('Failed to fetch agent stats', 500, err?.message || err);
    }
  }

  /**
   * Get a single call history record
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const callHistory = await this.callHistoryService.findById(id);
      if (!callHistory) {
        return this.responseHelper.error('Call history not found', 404);
      }
      return this.responseHelper.success(callHistory, 'Call history fetched');
    } catch (err) {
      this.logger.error('Error fetching call history', err);
      return this.responseHelper.error('Failed to fetch call history', 500, err?.message || err);
    }
  }

  /**
   * Update a call history record (e.g., when call ends)
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: any) {
    try {
      const callHistory = await this.callHistoryService.update(id, updateData);
      if (!callHistory) {
        return this.responseHelper.error('Call history not found', 404);
      }
      this.logger.log(`Call history ${id} updated`);
      return this.responseHelper.success(callHistory, 'Call history updated');
    } catch (err) {
      this.logger.error('Error updating call history', err);
      return this.responseHelper.error('Failed to update call history', 500, err?.message || err);
    }
  }

  /**
   * Update a call history by Talkrix call ID
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Put('by-call-id/:talkrixCallId')
  async updateByTalkrixId(
    @Param('talkrixCallId') talkrixCallId: string,
    @Body() updateData: any,
  ) {
    try {
      const callHistory = await this.callHistoryService.updateByTalkrixCallId(
        talkrixCallId,
        updateData,
      );
      if (!callHistory) {
        return this.responseHelper.error('Call history not found', 404);
      }
      this.logger.log(`Call history updated by Talkrix ID: ${talkrixCallId}`);
      return this.responseHelper.success(callHistory, 'Call history updated');
    } catch (err) {
      this.logger.error('Error updating call history', err);
      return this.responseHelper.error('Failed to update call history', 500, err?.message || err);
    }
  }

  /**
   * Delete a call history record
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      const callHistory = await this.callHistoryService.delete(id);
      if (!callHistory) {
        return this.responseHelper.error('Call history not found', 404);
      }
      this.logger.log(`Call history ${id} deleted`);
      return this.responseHelper.success(callHistory, 'Call history deleted');
    } catch (err) {
      this.logger.error('Error deleting call history', err);
      return this.responseHelper.error('Failed to delete call history', 500, err?.message || err);
    }
  }
}
