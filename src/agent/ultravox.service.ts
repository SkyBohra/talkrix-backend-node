import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { AgentService } from './agent.service';
import { ResponseHelper, StandardResponse } from '../response.helper';
import { AppLogger } from '../app.logger';
import * as Twilio from 'twilio';

@Injectable()
export class UltravoxService {
  constructor(
    private readonly httpService: HttpService,
    private readonly agentService: AgentService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Sanitize a string to match Ultravox agent name pattern: ^[a-zA-Z0-9_-]{1,64}$
   */
  private sanitizeAgentName(name: string): string {
    if (!name) return 'agent';
    // Replace spaces with underscores, remove invalid characters, limit to 64 chars
    return name
      .replace(/\s+/g, '_')           // Replace spaces with underscores
      .replace(/[^a-zA-Z0-9_-]/g, '') // Remove invalid characters
      .substring(0, 64)               // Limit to 64 characters
      || 'agent';                     // Fallback if empty
  }

  async createAgentForUser(agentData: any, userId: string): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;
      
      // Build the Ultravox API payload - only include fields that have values
      const ultravoxPayload: any = {
        name: this.sanitizeAgentName(agentData.name),
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
        
        // If corpusId is provided, add queryCorpus tool with the corpus
        if (ct.corpusId) {
          // Initialize selectedTools if not exists
          if (!ultravoxPayload.callTemplate.selectedTools) {
            ultravoxPayload.callTemplate.selectedTools = [];
          }
          // Check if queryCorpus tool already exists
          const hasQueryCorpus = ultravoxPayload.callTemplate.selectedTools.some(
            (tool: any) => tool.toolName === 'queryCorpus'
          );
          if (!hasQueryCorpus) {
            ultravoxPayload.callTemplate.selectedTools.push({
              toolName: 'queryCorpus',
              parameterOverrides: {
                corpus_id: ct.corpusId,
              },
            });
          } else {
            // Update existing queryCorpus tool with the corpus_id
            ultravoxPayload.callTemplate.selectedTools = ultravoxPayload.callTemplate.selectedTools.map(
              (tool: any) => {
                if (tool.toolName === 'queryCorpus') {
                  return {
                    ...tool,
                    parameterOverrides: {
                      ...tool.parameterOverrides,
                      corpus_id: ct.corpusId,
                    },
                  };
                }
                return tool;
              }
            );
          }
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
      
      // Create webhook for this agent to receive call events
      let webhookId: string | undefined;
      const webhookUrl = process.env.WEBHOOK_BASE_URL;
      if (webhookUrl) {
        try {
          const webhookResult = await this.createWebhook({
            url: `${webhookUrl}/webhook/talkrix`,
            events: ['call.ended', 'call.billed'],
            agentId: talkrixAgentId,
            secrets: process.env.TALKRIX_WEBHOOK_SECRET ? [process.env.TALKRIX_WEBHOOK_SECRET] : undefined,
          });
          if (webhookResult.statusCode === 201 && webhookResult.data) {
            webhookId = webhookResult.data.webhookId;
            this.logger.log(`Webhook created for agent ${talkrixAgentId}: ${webhookId}`);
          }
        } catch (webhookErr) {
          this.logger.warn(`Could not create webhook for agent: ${webhookErr?.message}`);
        }
      } else {
        this.logger.warn('WEBHOOK_BASE_URL not configured, skipping webhook creation');
      }
      
      const agent = await this.agentService.create({
        talkrixAgentId,
        userId,
        name: agentData.name,
        callTemplate: agentData.callTemplate,
        webhookId,
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
      
      if (updateData.name) ultravoxPayload.name = this.sanitizeAgentName(updateData.name);

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
        
        // If corpusId is provided, add queryCorpus tool with the corpus
        if (ct.corpusId) {
          // Initialize selectedTools if not exists
          if (!ultravoxPayload.callTemplate.selectedTools) {
            ultravoxPayload.callTemplate.selectedTools = [];
          }
          // Check if queryCorpus tool already exists
          const hasQueryCorpus = ultravoxPayload.callTemplate.selectedTools.some(
            (tool: any) => tool.toolName === 'queryCorpus'
          );
          if (!hasQueryCorpus) {
            ultravoxPayload.callTemplate.selectedTools.push({
              toolName: 'queryCorpus',
              parameterOverrides: {
                corpus_id: ct.corpusId,
              },
            });
          } else {
            // Update existing queryCorpus tool with the corpus_id
            ultravoxPayload.callTemplate.selectedTools = ultravoxPayload.callTemplate.selectedTools.map(
              (tool: any) => {
                if (tool.toolName === 'queryCorpus') {
                  return {
                    ...tool,
                    parameterOverrides: {
                      ...tool.parameterOverrides,
                      corpus_id: ct.corpusId,
                    },
                  };
                }
                return tool;
              }
            );
          }
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

      // Delete webhook for this agent if exists
      if (agent.webhookId) {
        try {
          await this.deleteWebhook(agent.webhookId);
          this.logger.log(`Webhook ${agent.webhookId} deleted for agent ${ultravoxAgentId}`);
        } catch (webhookErr) {
          this.logger.warn(`Could not delete webhook ${agent.webhookId}: ${webhookErr?.message}`);
        }
      }

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

  /**
   * Create a call for testing an agent
   * POST /api/agents/{agent_id}/calls
   * Returns joinUrl that can be used with Ultravox Client SDK
   */
  async createCallForAgent(agentId: string, options?: { 
    maxDuration?: string;
    recordingEnabled?: boolean;
  }): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;
      
      // Build the call payload - minimal for testing
      const callPayload: any = {};
      
      if (options?.maxDuration) {
        callPayload.maxDuration = options.maxDuration;
      }
      if (options?.recordingEnabled !== undefined) {
        callPayload.recordingEnabled = options.recordingEnabled;
      }

      const response = await this.httpService.post(
        `https://api.ultravox.ai/api/agents/${agentId}/calls`,
        callPayload,
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
        },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return call data');
        return this.responseHelper.error('Ultravox API did not return call data', 502);
      }

      this.logger.log(`Call created for agent ${agentId}, joinUrl: ${response.data.joinUrl}`);
      return this.responseHelper.success({
        callId: response.data.callId,
        joinUrl: response.data.joinUrl,
        created: response.data.created,
      }, 'Call created', 201);
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in createCallForAgent', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create call', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Create an outbound call with telephony medium (Twilio, Plivo, Telnyx)
   * 
   * Flow:
   * 1. Create Ultravox call with twilio medium (no outgoing) - this creates a joinUrl for incoming Twilio connection
   * 2. Use Twilio SDK to create outbound call that connects to that joinUrl via TwiML <Stream>
   * 
   * The key is using medium.twilio WITHOUT outgoing - this tells Ultravox to expect a Twilio stream
   * connection but doesn't require Ultravox to make the call. We make the call ourselves.
   */
  async createOutboundCallWithMedium(agentId: string, options: {
    provider: 'twilio' | 'plivo' | 'telnyx';
    fromPhoneNumber: string;
    toPhoneNumber: string;
    maxDuration?: string;
    recordingEnabled?: boolean;
    // Provider credentials
    twilioAccountSid?: string;
    twilioAuthToken?: string;
    plivoAuthId?: string;
    plivoAuthToken?: string;
    telnyxApiKey?: string;
    telnyxConnectionId?: string;
  }): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;
      
      // Build call payload with provider-specific medium (without outgoing)
      // This tells Ultravox to expect an incoming stream connection from that provider
      const callPayload: any = {
        maxDuration: options.maxDuration || '600s',
        recordingEnabled: options.recordingEnabled ?? true,
        firstSpeakerSettings: {
          agent: {},
        },
      };

      // Set medium based on provider - empty object means "incoming" connection
      if (options.provider === 'twilio') {
        callPayload.medium = {
          twilio: {}, // Empty = expect incoming Twilio stream
        };
      } else if (options.provider === 'plivo') {
        callPayload.medium = {
          plivo: {}, // Empty = expect incoming Plivo stream
        };
      } else if (options.provider === 'telnyx') {
        callPayload.medium = {
          telnyx: {}, // Empty = expect incoming Telnyx stream
        };
      }

      this.logger.log(`Creating Ultravox call for agent ${agentId} with ${options.provider} medium (incoming mode)`);
      const response = await this.httpService.post(
        `https://api.ultravox.ai/api/agents/${agentId}/calls`,
        callPayload,
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
        },
      ).toPromise();

      if (!response || !response.data || !response.data.joinUrl) {
        this.logger.warn('Ultravox API did not return call data or joinUrl');
        return this.responseHelper.error('Ultravox API did not return call data', 502);
      }

      const ultravoxCallId = response.data.callId;
      const joinUrl = response.data.joinUrl;
      this.logger.log(`Ultravox call created: ${ultravoxCallId}, joinUrl: ${joinUrl}`);

      // Step 2: Use provider SDK to create outbound call connected to the joinUrl
      let providerCallSid: string | undefined;

      if (options.provider === 'twilio') {
        if (!options.twilioAccountSid || !options.twilioAuthToken) {
          return this.responseHelper.error('Twilio credentials are required', 400);
        }

        const twilioClient = Twilio.default(options.twilioAccountSid, options.twilioAuthToken);
        
        // Create TwiML that connects to the Ultravox WebSocket using <Stream>
        // The joinUrl from Ultravox is designed to receive Twilio's mulaw audio format
        const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="${joinUrl}" />
  </Connect>
</Response>`;

        this.logger.log(`Creating Twilio outbound call from ${options.fromPhoneNumber} to ${options.toPhoneNumber}`);
        this.logger.log(`TwiML Stream URL: ${joinUrl}`);
        
        const call = await twilioClient.calls.create({
          from: options.fromPhoneNumber,
          to: options.toPhoneNumber,
          twiml: twiml,
        });
        
        providerCallSid = call.sid;
        this.logger.log(`Twilio call created: ${providerCallSid}`);
      } else if (options.provider === 'plivo') {
        // Plivo requires an answer_url endpoint
        return this.responseHelper.error('Plivo integration requires additional setup (answer_url endpoint)', 400);
      } else if (options.provider === 'telnyx') {
        return this.responseHelper.error('Telnyx integration not yet implemented', 400);
      }

      return this.responseHelper.success({
        callId: ultravoxCallId,
        joinUrl: joinUrl,
        created: response.data.created,
        provider: options.provider,
        providerCallSid: providerCallSid,
        fromPhoneNumber: options.fromPhoneNumber,
        toPhoneNumber: options.toPhoneNumber,
      }, 'Outbound call created', 201);
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in createOutboundCallWithMedium', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create outbound call', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Get call details from Ultravox API
   * GET /api/calls/{call_id}
   * Returns call details including summary, billing, etc.
   */
  async getCallDetails(callId: string): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;

      const response = await this.httpService.get(
        `https://api.ultravox.ai/api/calls/${callId}`,
        {
          headers: {
            'X-API-Key': apiKey,
          },
        },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return call details');
        return this.responseHelper.error('Ultravox API did not return call details', 502);
      }

      const data = response.data;
      return this.responseHelper.success({
        callId: data.callId,
        created: data.created,
        joined: data.joined,
        ended: data.ended,
        endReason: data.endReason,
        billedDuration: data.billedDuration,
        billingStatus: data.billingStatus,
        summary: data.summary,
        shortSummary: data.shortSummary,
        recordingEnabled: data.recordingEnabled,
        recordingUrl: data.recordingUrl || data.recording,
      }, 'Call details fetched');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in getCallDetails', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to fetch call details', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Create a webhook in Ultravox for an agent
   * POST /api/webhooks
   */
  async createWebhook(options: {
    url: string;
    events: ('call.started' | 'call.joined' | 'call.ended' | 'call.billed')[];
    agentId?: string;
    secrets?: string[];
  }): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;

      const webhookPayload: any = {
        url: options.url,
        events: options.events,
      };

      if (options.agentId) {
        webhookPayload.agentId = options.agentId;
      }

      if (options.secrets && options.secrets.length > 0) {
        webhookPayload.secrets = options.secrets;
      }

      const response = await this.httpService.post(
        'https://api.ultravox.ai/api/webhooks',
        webhookPayload,
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
        },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return webhook data');
        return this.responseHelper.error('Ultravox API did not return webhook data', 502);
      }

      this.logger.log(`Webhook created: ${response.data.webhookId} for events: ${options.events.join(', ')}`);
      return this.responseHelper.success({
        webhookId: response.data.webhookId,
        url: response.data.url,
        events: response.data.events,
        agentId: response.data.agentId,
        status: response.data.status,
      }, 'Webhook created', 201);
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error creating webhook', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create webhook', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Delete a webhook from Ultravox
   * DELETE /api/webhooks/{webhook_id}
   */
  async deleteWebhook(webhookId: string): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;

      await this.httpService.delete(
        `https://api.ultravox.ai/api/webhooks/${webhookId}`,
        {
          headers: {
            'X-API-Key': apiKey,
          },
        },
      ).toPromise();

      this.logger.log(`Webhook deleted: ${webhookId}`);
      return this.responseHelper.success(null, 'Webhook deleted');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error deleting webhook', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to delete webhook', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * List webhooks for an agent or all webhooks
   * GET /api/webhooks
   */
  async listWebhooks(agentId?: string): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;

      const params: any = {};
      if (agentId) {
        params.agentId = agentId;
      }

      const response = await this.httpService.get(
        'https://api.ultravox.ai/api/webhooks',
        {
          headers: {
            'X-API-Key': apiKey,
          },
          params,
        },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return webhooks data');
        return this.responseHelper.error('Ultravox API did not return webhooks data', 502);
      }

      return this.responseHelper.success(response.data, 'Webhooks fetched');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error listing webhooks', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to list webhooks', err?.response?.status || 500, errorDetails);
    }
  }
}
