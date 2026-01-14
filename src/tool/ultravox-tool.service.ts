import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { ToolService } from './tool.service';
import { ResponseHelper, StandardResponse } from '../response.helper';
import { AppLogger } from '../app.logger';

@Injectable()
export class UltravoxToolService {
  private readonly baseUrl = 'https://api.ultravox.ai/api/tools';

  constructor(
    private readonly httpService: HttpService,
    private readonly toolService: ToolService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
  ) {}

  /**
   * Create a new tool in Ultravox and store it in the database
   * POST /api/tools
   */
  async createTool(toolData: any, userId: string): Promise<StandardResponse> {
    try {
      const apiKey = process.env.ULTRAVOX_API_KEY;

      // Build the Ultravox API payload
      const ultravoxPayload = this.buildToolPayload(toolData);

      const response = await this.httpService.post(
        this.baseUrl,
        ultravoxPayload,
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
        },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return tool data');
        return this.responseHelper.error('Ultravox API did not return tool data', 502);
      }

      const ultravoxTool = response.data;

      // Store in local database
      const tool = await this.toolService.create({
        talkrixToolId: ultravoxTool.toolId,
        userId,
        name: ultravoxTool.name,
        definition: ultravoxTool.definition,
        ownership: ultravoxTool.ownership,
        talkrixCreated: new Date(ultravoxTool.created),
      });

      this.logger.log(`Tool created for user ${userId}: ${ultravoxTool.toolId}`);
      return this.responseHelper.success(tool, 'Tool created', 201);
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in createTool', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create tool', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Update a tool in Ultravox and database
   * PUT /api/tools/{tool_id}
   * Note: Ultravox requires the entire tool definition to be provided (no partial updates)
   */
  async updateTool(id: string, updateData: any): Promise<StandardResponse> {
    try {
      // Get the local tool to retrieve the Ultravox toolId
      const tool = await this.toolService.findOne(id);
      if (!tool) {
        return this.responseHelper.error('Tool not found', 404);
      }

      const apiKey = process.env.ULTRAVOX_API_KEY;
      const talkrixToolId = tool.talkrixToolId;

      // Build the Ultravox API payload (full replacement)
      const ultravoxPayload = this.buildToolPayload(updateData);

      const response = await this.httpService.put(
        `${this.baseUrl}/${talkrixToolId}`,
        ultravoxPayload,
        {
          headers: {
            'X-API-Key': apiKey,
            'Content-Type': 'application/json',
          },
        },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return updated tool data');
        return this.responseHelper.error('Ultravox API did not return updated tool data', 502);
      }

      const ultravoxTool = response.data;

      // Update in local database
      const updatedTool = await this.toolService.update(id, {
        name: ultravoxTool.name,
        definition: ultravoxTool.definition,
        ownership: ultravoxTool.ownership,
      });

      this.logger.log(`Tool ${talkrixToolId} updated`);
      return this.responseHelper.success(updatedTool, 'Tool updated');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in updateTool', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to update tool', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Delete a tool from Ultravox and database
   * DELETE /api/tools/{tool_id}
   */
  async deleteTool(id: string): Promise<StandardResponse> {
    try {
      // Get the local tool to retrieve the Talkrix toolId
      const tool = await this.toolService.findOne(id);
      if (!tool) {
        return this.responseHelper.error('Tool not found', 404);
      }

      const apiKey = process.env.ULTRAVOX_API_KEY;
      const talkrixToolId = tool.talkrixToolId;

      // Delete from Talkrix API
      await this.httpService.delete(`${this.baseUrl}/${talkrixToolId}`, {
        headers: {
          'X-API-Key': apiKey,
        },
      }).toPromise();

      // Delete from local database
      const deletedTool = await this.toolService.delete(id);

      this.logger.log(`Tool ${talkrixToolId} deleted`);
      return this.responseHelper.success(deletedTool, 'Tool deleted');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error in deleteTool', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to delete tool', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Get tools stored in local database for a user (custom tools only)
   */
  async getUserTools(userId: string): Promise<StandardResponse> {
    try {
      // Only fetch user's custom tools from local database
      // Built-in tools are now hardcoded on the frontend
      const tools = await this.toolService.findByUserId(userId);
      return this.responseHelper.success(tools, 'User tools fetched');
    } catch (err) {
      this.logger.error('Error in getUserTools', err?.message || err);
      return this.responseHelper.error('Failed to fetch user tools', 500, err?.message || err);
    }
  }

  /**
   * Sanitize a string to match Ultravox modelToolName pattern: ^[a-zA-Z0-9_-]{1,64}$
   */
  private sanitizeModelToolName(name: string): string {
    if (!name) return 'tool';
    // Replace spaces with underscores, remove invalid characters, limit to 64 chars
    return name
      .replace(/\s+/g, '_')           // Replace spaces with underscores
      .replace(/[^a-zA-Z0-9_-]/g, '') // Remove invalid characters
      .substring(0, 64)               // Limit to 64 characters
      || 'tool';                      // Fallback if empty
  }

  /**
   * Build the Ultravox tool payload from the input data
   */
  private buildToolPayload(toolData: any): any {
    const payload: any = {
      name: toolData.name,
      definition: {},
    };

    const def = toolData.definition || {};

    // Model tool name - sanitize to match pattern ^[a-zA-Z0-9_-]{1,64}$
    const rawModelToolName = def.modelToolName || toolData.name || 'tool';
    payload.definition.modelToolName = this.sanitizeModelToolName(rawModelToolName);
    
    // Description
    if (def.description) payload.definition.description = def.description;

    // Dynamic parameters (user input during call)
    if (def.dynamicParameters && def.dynamicParameters.length > 0) {
      payload.definition.dynamicParameters = def.dynamicParameters.map((p: any) => {
        const param: any = { name: p.name };
        if (p.location) param.location = p.location;
        if (p.schema) param.schema = p.schema;
        if (p.required !== undefined) param.required = p.required;
        return param;
      });
    }

    // Static parameters (fixed values)
    if (def.staticParameters && def.staticParameters.length > 0) {
      payload.definition.staticParameters = def.staticParameters.map((p: any) => {
        const param: any = { name: p.name };
        if (p.location) param.location = p.location;
        if (p.value !== undefined) param.value = p.value;
        return param;
      });
    }

    // Automatic parameters (system-provided values)
    if (def.automaticParameters && def.automaticParameters.length > 0) {
      payload.definition.automaticParameters = def.automaticParameters.map((p: any) => {
        const param: any = { name: p.name };
        if (p.location) param.location = p.location;
        if (p.knownValue) param.knownValue = p.knownValue;
        return param;
      });
    }

    // Requirements (security options)
    if (def.requirements) {
      payload.definition.requirements = def.requirements;
    }

    // Timeout
    if (def.timeout) payload.definition.timeout = def.timeout;

    // Precomputable flag
    if (def.precomputable !== undefined) payload.definition.precomputable = def.precomputable;

    // HTTP tool implementation
    if (def.http) {
      payload.definition.http = {};
      if (def.http.baseUrlPattern) payload.definition.http.baseUrlPattern = def.http.baseUrlPattern;
      if (def.http.httpMethod) payload.definition.http.httpMethod = def.http.httpMethod;
    }

    // Client tool implementation (for client-side tools)
    if (def.client) {
      payload.definition.client = def.client;
    }

    // Data connection
    if (def.dataConnection) {
      payload.definition.dataConnection = def.dataConnection;
    }

    // Default reaction
    if (def.defaultReaction) payload.definition.defaultReaction = def.defaultReaction;

    // Static response (for tools that return fixed responses)
    if (def.staticResponse) {
      payload.definition.staticResponse = def.staticResponse;
    }

    return payload;
  }
}
