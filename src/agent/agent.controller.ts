import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Req, Inject, Query } from '@nestjs/common';
import { AgentService } from './agent.service';
import { Agent } from './agent.schema';
import { UltravoxService } from './ultravox.service';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';

@Controller('agents')
export class AgentController {
  constructor(
    private readonly agentService: AgentService,
    private readonly ultravoxService: UltravoxService,
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
      // Get the agent to retrieve the Ultravox agent ID
      const agent = await this.agentService.findOne(id);
      if (!agent) {
        return this.responseHelper.error('Agent not found', 404);
      }

      const result = await this.ultravoxService.createCallForAgent(agent.talkrixAgentId, {
        maxDuration: body.maxDuration || '300s', // Default 5 minutes for testing
        recordingEnabled: body.recordingEnabled ?? false,
      });
      this.logger.log(`Call created for agent ${id}`);
      return result;
    } catch (err) {
      this.logger.error('Error creating call', err);
      return this.responseHelper.error('Failed to create call', 500, err?.message || err);
    }
  }
}
