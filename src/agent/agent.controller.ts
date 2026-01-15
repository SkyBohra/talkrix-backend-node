import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Req, Inject, Query } from '@nestjs/common';
import { AgentService } from './agent.service';
import { Agent } from './agent.schema';
import { UltravoxService } from './ultravox.service';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';
import { CallHistoryService } from '../call-history/call-history.service';

@Controller('agents')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly ultravoxService: UltravoxService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
    private readonly callHistoryService: CallHistoryService,
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

  @UseGuards(AuthOrApiKeyGuard)
  @Post()
  async create(@Body() agentData: any, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      this.logger.warn('userId missing or invalid in create agent');
      return this.responseHelper.error('userId is required and must be a string', 400);
    }
    const userId = userInfo.userId;
    try {
      const agent = await this.ultravoxService.createAgentForUser(agentData, userId);
      this.logger.log(`Agent created for user ${userId}`);
      return this.responseHelper.success(agent, 'Agent created', 201);
    } catch (err) {
      this.logger.error('Error creating agent', err);
      return this.responseHelper.error('Failed to create agent', 500, err?.message || err);
    }
  }

  @UseGuards(AuthOrApiKeyGuard)
  @Post('ultravox/:userId')
  async createViaUltravox(@Param('userId') userId: string, @Body() agentData: any) {
    try {
      const agent = await this.ultravoxService.createAgentForUser(agentData, userId);
      this.logger.log(`Agent created via Ultravox for user ${userId}`);
      return this.responseHelper.success(agent, 'Agent created', 201);
    } catch (err) {
      this.logger.error('Error creating agent via Ultravox', err);
      return this.responseHelper.error('Failed to create agent', 500, err?.message || err);
    }
  }

  @UseGuards(AuthOrApiKeyGuard)
  @Get('voices')
  async getVoices(@Query('search') search?: string) {
    try {
      const voices = await this.ultravoxService.getVoices(search);
      return voices;
    } catch (err) {
      this.logger.error('Error fetching voices', err);
      return this.responseHelper.error('Failed to fetch voices', 500, err?.message || err);
    }
  }

  @UseGuards(AuthOrApiKeyGuard)
  @Get()
  async findAll(@Req() req: any) {
    try {
      const agents = await this.agentService.findAll();
      return this.responseHelper.success(agents, 'Agents fetched');
    } catch (err) {
      this.logger.error('Error fetching agents', err);
      return this.responseHelper.error('Failed to fetch agents', 500, err?.message || err);
    }
  }

  @UseGuards(AuthOrApiKeyGuard)
  @Get('user/:userId')
  async findByUserId(@Param('userId') userId: string, @Req() req: any) {
    try {
      const agents = await this.agentService.findByUserId(userId);
      return this.responseHelper.success(agents, 'Agents fetched');
    } catch (err) {
      this.logger.error('Error fetching agents by user', err);
      return this.responseHelper.error('Failed to fetch agents', 500, err?.message || err);
    }
  }

  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    try {
      const agent = await this.agentService.findOne(id);
      if (!agent) {
        return this.responseHelper.error('Agent not found', 404);
      }
      return this.responseHelper.success(agent, 'Agent fetched');
    } catch (err) {
      this.logger.error('Error fetching agent', err);
      return this.responseHelper.error('Failed to fetch agent', 500, err?.message || err);
    }
  }

  @UseGuards(AuthOrApiKeyGuard)
  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: Partial<Agent>, @Req() req: any) {
    try {
      const result = await this.ultravoxService.updateAgent(id, updateData);
      this.logger.log(`Agent ${id} updated`);
      return result;
    } catch (err) {
      this.logger.error('Error updating agent', err);
      return this.responseHelper.error('Failed to update agent', 500, err?.message || err);
    }
  }

  @UseGuards(AuthOrApiKeyGuard)
  @Delete(':id')
  async delete(@Param('id') id: string, @Req() req: any) {
    try {
      const result = await this.ultravoxService.deleteAgent(id);
      this.logger.log(`Agent ${id} deleted`);
      return result;
    } catch (err) {
      this.logger.error('Error deleting agent', err);
      return this.responseHelper.error('Failed to delete agent', 500, err?.message || err);
    }
  }

  /**
   * Create a call to test an agent
   * Uses the agent's talkrixAgentId (Ultravox agent ID) to create a call
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/call')
  async createCall(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    try {
      const userInfo = this.getUserFromRequest(req);
      if (!userInfo || !userInfo.userId) {
        this.logger.warn('userId missing in create call');
        return this.responseHelper.error('Unauthorized', 401);
      }

      // Get the agent to retrieve the Ultravox agent ID
      const agent = await this.agentService.findOne(id);
      if (!agent) {
        return this.responseHelper.error('Agent not found', 404);
      }

      const result = await this.ultravoxService.createCallForAgent(agent.talkrixAgentId, {
        maxDuration: body.maxDuration || '300s', // Default 5 minutes for testing
        recordingEnabled: body.recordingEnabled ?? false,
      });

      // If call was created successfully, record it in call history
      if (result.statusCode === 201 && result.data) {
        try {
          const callHistory = await this.callHistoryService.create({
            agentId: id,
            userId: userInfo.userId,
            talkrixCallId: result.data.callId,
            callType: body.callType || 'test',
            agentName: agent.name,
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            recordingEnabled: body.recordingEnabled ?? false,
            joinUrl: result.data.joinUrl,
            callData: result.data,
          });
          
          // Add call history ID to the response
          result.data.callHistoryId = callHistory._id;
          this.logger.log(`Call history created for call ${result.data.callId}`);
        } catch (historyErr) {
          // Log but don't fail the request if history recording fails
          this.logger.error('Error creating call history', historyErr);
        }
      }

      this.logger.log(`Call created for agent ${id}`);
      return result;
    } catch (err) {
      this.logger.error('Error creating call', err);
      return this.responseHelper.error('Failed to create call', 500, err?.message || err);
    }
  }

  /**
   * Update call status when call ends
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Put(':id/call/:callHistoryId/end')
  async endCall(
    @Param('id') id: string,
    @Param('callHistoryId') callHistoryId: string,
    @Body() body: any,
  ) {
    try {
      const updateData: any = {
        status: body.status || 'completed',
        endedAt: new Date(),
      };

      if (body.durationSeconds !== undefined) {
        updateData.durationSeconds = body.durationSeconds;
      }

      if (body.recordingUrl) {
        updateData.recordingUrl = body.recordingUrl;
      }

      const callHistory = await this.callHistoryService.update(callHistoryId, updateData);
      
      if (!callHistory) {
        return this.responseHelper.error('Call history not found', 404);
      }

      this.logger.log(`Call ${callHistoryId} ended with status ${updateData.status}`);
      return this.responseHelper.success(callHistory, 'Call ended');
    } catch (err) {
      this.logger.error('Error ending call', err);
      return this.responseHelper.error('Failed to end call', 500, err?.message || err);
    }
  }

  /**
   * Create an outbound call (with customer phone number)
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/outbound-call')
  async createOutboundCall(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    try {
      const userInfo = this.getUserFromRequest(req);
      if (!userInfo || !userInfo.userId) {
        this.logger.warn('userId missing in create outbound call');
        return this.responseHelper.error('Unauthorized', 401);
      }

      // Validate required fields for outbound call
      if (!body.customerPhone) {
        return this.responseHelper.error('Customer phone number is required', 400);
      }

      // Get the agent to retrieve the Ultravox agent ID
      const agent = await this.agentService.findOne(id);
      if (!agent) {
        return this.responseHelper.error('Agent not found', 404);
      }

      const result = await this.ultravoxService.createCallForAgent(agent.talkrixAgentId, {
        maxDuration: body.maxDuration || '600s', // Default 10 minutes for outbound calls
        recordingEnabled: body.recordingEnabled ?? true,
      });

      // If call was created successfully, record it in call history
      if (result.statusCode === 201 && result.data) {
        try {
          const callHistory = await this.callHistoryService.create({
            agentId: id,
            userId: userInfo.userId,
            talkrixCallId: result.data.callId,
            callType: 'outbound',
            agentName: agent.name,
            customerName: body.customerName,
            customerPhone: body.customerPhone,
            recordingEnabled: body.recordingEnabled ?? true,
            joinUrl: result.data.joinUrl,
            callData: result.data,
            metadata: body.metadata,
          });
          
          result.data.callHistoryId = callHistory._id;
          this.logger.log(`Outbound call history created for call ${result.data.callId}`);
        } catch (historyErr) {
          this.logger.error('Error creating call history', historyErr);
        }
      }

      this.logger.log(`Outbound call created for agent ${id} to ${body.customerPhone}`);
      return result;
    } catch (err) {
      this.logger.error('Error creating outbound call', err);
      return this.responseHelper.error('Failed to create outbound call', 500, err?.message || err);
    }
  }
}
