import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AgentService } from './agent.service';
import { ResponseHelper, StandardResponse } from '../response.helper';
import { AppLogger } from '../app.logger';

@Injectable()
export class UltravoxService {
  constructor(
    private readonly httpService: HttpService,
    private readonly agentService: AgentService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
  ) {}

  async createAgentForUser(agentData: any, userId: string): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;
      const response = await this.httpService.post(
        'https://api.ultravox.ai/api/agents',
        agentData,
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
            'Referer': 'https://api.ultravox.ai/',
            'Origin': 'https://api.ultravox.ai',
          },
        },
      ).toPromise();
      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return agent data');
        return this.responseHelper.error('Ultravox API did not return agent data', 502);
      }
      const talkrixAgentId = response.data.agentId || response.data.id;
      const agent = await this.agentService.create({
        talkrixAgentId,
        userId,
        name: agentData.name,
        callTemplate: agentData.callTemplate,
        // Add other Ultravox fields here as needed
      });
      this.logger.log(`Ultravox agent created for user ${userId}`);
      return this.responseHelper.success(agent, 'Agent created', 201);
    } catch (err) {
      // Log detailed error response from Ultravox API
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in createAgentForUser', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create agent', err?.response?.status || 500, errorDetails);
    }
  }

  async updateAgent(id: string, updateData: any): Promise<StandardResponse> {
    try {
      // First get the agent to retrieve the Ultravox agentId
      const agent = await this.agentService.findOne(id);
      if (!agent) {
        return this.responseHelper.error('Agent not found', 404);
      }

      const apiKey = process.env.ULTRAVOX_API_KEY;
      const ultravoxAgentId = agent.talkrixAgentId;

      // Update agent in Ultravox
      const response = await this.httpService.patch(
        `https://api.ultravox.ai/api/agents/${ultravoxAgentId}`,
        updateData,
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
            'Referer': 'https://api.ultravox.ai/',
            'Origin': 'https://api.ultravox.ai',
          },
        },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return updated agent data');
        return this.responseHelper.error('Ultravox API did not return updated agent data', 502);
      }

      // Update agent in local database
      const updatedAgent = await this.agentService.update(id, {
        name: updateData.name || agent.name,
        callTemplate: updateData.callTemplate || agent.callTemplate,
      });

      this.logger.log(`Ultravox agent ${ultravoxAgentId} updated`);
      return this.responseHelper.success(updatedAgent, 'Agent updated');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in updateAgent', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to update agent', err?.response?.status || 500, errorDetails);
    }
  }

  async deleteAgent(id: string): Promise<StandardResponse> {
    try {
      // First get the agent to retrieve the Ultravox agentId
      const agent = await this.agentService.findOne(id);
      if (!agent) {
        return this.responseHelper.error('Agent not found', 404);
      }

      const apiKey = process.env.ULTRAVOX_API_KEY;
      const ultravoxAgentId = agent.talkrixAgentId;

      // Delete agent from Ultravox
      await this.httpService.delete(
        `https://api.ultravox.ai/api/agents/${ultravoxAgentId}`,
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
            'Referer': 'https://api.ultravox.ai/',
            'Origin': 'https://api.ultravox.ai',
          },
        },
      ).toPromise();

      // Delete agent from local database
      const deletedAgent = await this.agentService.delete(id);

      this.logger.log(`Ultravox agent ${ultravoxAgentId} deleted`);
      return this.responseHelper.success(deletedAgent, 'Agent deleted');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in deleteAgent', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to delete agent', err?.response?.status || 500, errorDetails);
    }
  }
}
