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
      
      // Build the Ultravox API payload - only include fields that have values
      const ultravoxPayload: any = {
        name: agentData.name,
      };

      // Build callTemplate if provided
      if (agentData.callTemplate) {
        ultravoxPayload.callTemplate = {};
        const ct = agentData.callTemplate;
        
        // Core fields
        if (ct.name) ultravoxPayload.callTemplate.name = ct.name;
        if (ct.systemPrompt) ultravoxPayload.callTemplate.systemPrompt = ct.systemPrompt;
        if (ct.voice) ultravoxPayload.callTemplate.voice = ct.voice;
        if (ct.model) ultravoxPayload.callTemplate.model = ct.model;
        if (ct.temperature !== undefined) ultravoxPayload.callTemplate.temperature = ct.temperature;
        
        // Timing fields
        if (ct.joinTimeout) ultravoxPayload.callTemplate.joinTimeout = ct.joinTimeout;
        if (ct.maxDuration) ultravoxPayload.callTemplate.maxDuration = ct.maxDuration;
        
        // Output and language
        if (ct.initialOutputMedium) ultravoxPayload.callTemplate.initialOutputMedium = ct.initialOutputMedium;
        if (ct.languageHint) ultravoxPayload.callTemplate.languageHint = ct.languageHint;
        if (ct.timeExceededMessage) ultravoxPayload.callTemplate.timeExceededMessage = ct.timeExceededMessage;
        
        // Recording
        if (ct.recordingEnabled !== undefined) ultravoxPayload.callTemplate.recordingEnabled = ct.recordingEnabled;
        
        // First speaker settings
        if (ct.firstSpeakerSettings) {
          ultravoxPayload.callTemplate.firstSpeakerSettings = ct.firstSpeakerSettings;
        }
        
        // VAD settings - only include if any fields are set
        if (ct.vadSettings) {
          const vad: any = {};
          if (ct.vadSettings.turnEndpointDelay) vad.turnEndpointDelay = ct.vadSettings.turnEndpointDelay;
          if (ct.vadSettings.minimumTurnDuration) vad.minimumTurnDuration = ct.vadSettings.minimumTurnDuration;
          if (ct.vadSettings.minimumInterruptionDuration) vad.minimumInterruptionDuration = ct.vadSettings.minimumInterruptionDuration;
          if (ct.vadSettings.frameActivationThreshold) vad.frameActivationThreshold = ct.vadSettings.frameActivationThreshold;
          if (Object.keys(vad).length > 0) {
            ultravoxPayload.callTemplate.vadSettings = vad;
          }
        }
        
        // Inactivity messages
        if (ct.inactivityMessages && ct.inactivityMessages.length > 0) {
          ultravoxPayload.callTemplate.inactivityMessages = ct.inactivityMessages;
        }
        
        // External voice (for ElevenLabs, Cartesia, etc.)
        if (ct.externalVoice) {
          ultravoxPayload.callTemplate.externalVoice = ct.externalVoice;
        }
        
        // Medium settings (for WebRTC, Twilio, etc.)
        if (ct.medium) {
          ultravoxPayload.callTemplate.medium = ct.medium;
        }
        
        // Selected tools
        if (ct.selectedTools && ct.selectedTools.length > 0) {
          ultravoxPayload.callTemplate.selectedTools = ct.selectedTools;
        }
        
        // Data connection
        if (ct.dataConnection) {
          ultravoxPayload.callTemplate.dataConnection = ct.dataConnection;
        }
        
        // Context schema
        if (ct.contextSchema) {
          ultravoxPayload.callTemplate.contextSchema = ct.contextSchema;
        }
      }
      
      const response = await this.httpService.post(
        'https://api.ultravox.ai/api/agents',
        ultravoxPayload,
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

      // Build the Ultravox API payload - only include fields that have values
      const ultravoxPayload: any = {};
      
      if (updateData.name) ultravoxPayload.name = updateData.name;

      // Build callTemplate if provided
      if (updateData.callTemplate) {
        ultravoxPayload.callTemplate = {};
        const ct = updateData.callTemplate;
        
        // Core fields
        if (ct.name) ultravoxPayload.callTemplate.name = ct.name;
        if (ct.systemPrompt) ultravoxPayload.callTemplate.systemPrompt = ct.systemPrompt;
        if (ct.voice) ultravoxPayload.callTemplate.voice = ct.voice;
        if (ct.model) ultravoxPayload.callTemplate.model = ct.model;
        if (ct.temperature !== undefined) ultravoxPayload.callTemplate.temperature = ct.temperature;
        
        // Timing fields
        if (ct.joinTimeout) ultravoxPayload.callTemplate.joinTimeout = ct.joinTimeout;
        if (ct.maxDuration) ultravoxPayload.callTemplate.maxDuration = ct.maxDuration;
        
        // Output and language
        if (ct.initialOutputMedium) ultravoxPayload.callTemplate.initialOutputMedium = ct.initialOutputMedium;
        if (ct.languageHint) ultravoxPayload.callTemplate.languageHint = ct.languageHint;
        if (ct.timeExceededMessage) ultravoxPayload.callTemplate.timeExceededMessage = ct.timeExceededMessage;
        
        // Recording
        if (ct.recordingEnabled !== undefined) ultravoxPayload.callTemplate.recordingEnabled = ct.recordingEnabled;
        
        // First speaker settings
        if (ct.firstSpeakerSettings) {
          ultravoxPayload.callTemplate.firstSpeakerSettings = ct.firstSpeakerSettings;
        }
        
        // VAD settings - only include if any fields are set
        if (ct.vadSettings) {
          const vad: any = {};
          if (ct.vadSettings.turnEndpointDelay) vad.turnEndpointDelay = ct.vadSettings.turnEndpointDelay;
          if (ct.vadSettings.minimumTurnDuration) vad.minimumTurnDuration = ct.vadSettings.minimumTurnDuration;
          if (ct.vadSettings.minimumInterruptionDuration) vad.minimumInterruptionDuration = ct.vadSettings.minimumInterruptionDuration;
          if (ct.vadSettings.frameActivationThreshold) vad.frameActivationThreshold = ct.vadSettings.frameActivationThreshold;
          if (Object.keys(vad).length > 0) {
            ultravoxPayload.callTemplate.vadSettings = vad;
          }
        }
        
        // Inactivity messages
        if (ct.inactivityMessages && ct.inactivityMessages.length > 0) {
          ultravoxPayload.callTemplate.inactivityMessages = ct.inactivityMessages;
        }
        
        // External voice
        if (ct.externalVoice) {
          ultravoxPayload.callTemplate.externalVoice = ct.externalVoice;
        }
        
        // Medium settings
        if (ct.medium) {
          ultravoxPayload.callTemplate.medium = ct.medium;
        }
        
        // Selected tools
        if (ct.selectedTools && ct.selectedTools.length > 0) {
          ultravoxPayload.callTemplate.selectedTools = ct.selectedTools;
        }
        
        // Data connection
        if (ct.dataConnection) {
          ultravoxPayload.callTemplate.dataConnection = ct.dataConnection;
        }
        
        // Context schema
        if (ct.contextSchema) {
          ultravoxPayload.callTemplate.contextSchema = ct.contextSchema;
        }
      }

      // Update agent in Ultravox
      const response = await this.httpService.patch(
        `https://api.ultravox.ai/api/agents/${ultravoxAgentId}`,
        ultravoxPayload,
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

  async getVoices(search?: string): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;
      
      // Build query params
      const params = new URLSearchParams();
      if (search && search.trim()) {
        params.append('search', search.trim());
      }
      params.append('pageSize', '100'); // Get more results
      
      const url = `https://api.ultravox.ai/api/voices${params.toString() ? '?' + params.toString() : ''}`;
      
      const response = await this.httpService.get(
        url,
        {
          headers: {
            'X-API-Key': apiKey,
          },
        },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return voices data');
        return this.responseHelper.error('Ultravox API did not return voices data', 502);
      }

      this.logger.log(`Voices fetched from Ultravox${search ? ` with search: ${search}` : ''}`);
      return this.responseHelper.success(response.data, 'Voices fetched');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in getVoices', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to fetch voices', err?.response?.status || 500, errorDetails);
    }
  }
}
