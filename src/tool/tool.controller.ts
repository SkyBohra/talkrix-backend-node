import { Controller, Get, Post, Body, Param, Put, Delete, UseGuards, Req } from '@nestjs/common';
import { ToolService } from './tool.service';
import { UltravoxToolService } from './ultravox-tool.service';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';

@Controller('tools')
export class ToolController {
  constructor(
    private readonly toolService: ToolService,
    private readonly ultravoxToolService: UltravoxToolService,
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

  /**
   * Create a new tool
   * Creates in Ultravox and stores in local database
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post()
  async create(@Body() toolData: any, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      this.logger.warn('userId missing or invalid in create tool');
      return this.responseHelper.error('userId is required', 400);
    }
    const userId = userInfo.userId;
    try {
      const result = await this.ultravoxToolService.createTool(toolData, userId);
      this.logger.log(`Tool created for user ${userId}`);
      return result;
    } catch (err) {
      this.logger.error('Error creating tool', err);
      return this.responseHelper.error('Failed to create tool', 500, err?.message || err);
    }
  }

  /**
   * Get all tools stored locally (from database)
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get()
  async findAll(@Req() req: any) {
    try {
      const tools = await this.toolService.findAll();
      return this.responseHelper.success(tools, 'Tools fetched');
    } catch (err) {
      this.logger.error('Error fetching tools', err);
      return this.responseHelper.error('Failed to fetch tools', 500, err?.message || err);
    }
  }

  /**
   * Get tools for the current user
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get('user/me')
  async findMyTools(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }
    try {
      const result = await this.ultravoxToolService.getUserTools(userInfo.userId);
      return result;
    } catch (err) {
      this.logger.error('Error fetching user tools', err);
      return this.responseHelper.error('Failed to fetch user tools', 500, err?.message || err);
    }
  }

  /**
   * Get tools for a specific user
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get('user/:userId')
  async findByUserId(@Param('userId') userId: string) {
    try {
      const result = await this.ultravoxToolService.getUserTools(userId);
      return result;
    } catch (err) {
      this.logger.error('Error fetching tools by user', err);
      return this.responseHelper.error('Failed to fetch tools', 500, err?.message || err);
    }
  }

  /**
   * Get a specific tool by local database ID
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const tool = await this.toolService.findOne(id);
      if (!tool) {
        return this.responseHelper.error('Tool not found', 404);
      }
      return this.responseHelper.success(tool, 'Tool fetched');
    } catch (err) {
      this.logger.error('Error fetching tool', err);
      return this.responseHelper.error('Failed to fetch tool', 500, err?.message || err);
    }
  }

  /**
   * Update a tool
   * Updates in Ultravox and local database
   * Note: Ultravox requires full tool definition replacement
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: any) {
    try {
      const result = await this.ultravoxToolService.updateTool(id, updateData);
      this.logger.log(`Tool ${id} updated`);
      return result;
    } catch (err) {
      this.logger.error('Error updating tool', err);
      return this.responseHelper.error('Failed to update tool', 500, err?.message || err);
    }
  }

  /**
   * Delete a tool
   * Deletes from Ultravox and local database
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      const result = await this.ultravoxToolService.deleteTool(id);
      this.logger.log(`Tool ${id} deleted`);
      return result;
    } catch (err) {
      this.logger.error('Error deleting tool', err);
      return this.responseHelper.error('Failed to delete tool', 500, err?.message || err);
    }
  }
}
