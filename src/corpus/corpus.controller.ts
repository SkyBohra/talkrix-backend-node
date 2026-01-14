import { Controller, Get, Post, Body, Param, Patch, Delete, UseGuards, Req, Query } from '@nestjs/common';
import { TalkrixCorpusService } from './talkrix-corpus.service';
import { CorpusService } from './corpus.service';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';

@Controller('corpora')
export class CorpusController {
  constructor(
    private readonly talkrixCorpusService: TalkrixCorpusService,
    private readonly corpusService: CorpusService,
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

  // ==================== CORPUS ENDPOINTS ====================

  /**
   * Create a new corpus
   * POST /corpora
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post()
  async createCorpus(@Body() corpusData: { name: string; description?: string }, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }
    try {
      const result = await this.talkrixCorpusService.createCorpus(corpusData, userInfo.userId);
      return result;
    } catch (err) {
      this.logger.error('Error creating corpus', err);
      return this.responseHelper.error('Failed to create corpus', 500, err?.message || err);
    }
  }

  /**
   * List all corpora for current user
   * GET /corpora
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get()
  async listCorpora(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }
    try {
      const result = await this.talkrixCorpusService.listUserCorpora(userInfo.userId);
      return result;
    } catch (err) {
      this.logger.error('Error listing corpora', err);
      return this.responseHelper.error('Failed to list corpora', 500, err?.message || err);
    }
  }

  /**
   * Sync corpora from Ultravox API
   * POST /corpora/sync
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post('sync')
  async syncCorpora(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }
    try {
      const result = await this.talkrixCorpusService.syncFromUltravox(userInfo.userId);
      return result;
    } catch (err) {
      this.logger.error('Error syncing corpora', err);
      return this.responseHelper.error('Failed to sync corpora', 500, err?.message || err);
    }
  }

  /**
   * Get a specific corpus
   * GET /corpora/:id
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id')
  async getCorpus(@Param('id') id: string) {
    try {
      const result = await this.talkrixCorpusService.getCorpus(id);
      return result;
    } catch (err) {
      this.logger.error('Error fetching corpus', err);
      return this.responseHelper.error('Failed to fetch corpus', 500, err?.message || err);
    }
  }

  /**
   * Update a corpus
   * PATCH /corpora/:id
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Patch(':id')
  async updateCorpus(@Param('id') id: string, @Body() updateData: { name?: string; description?: string }) {
    try {
      const result = await this.talkrixCorpusService.updateCorpus(id, updateData);
      return result;
    } catch (err) {
      this.logger.error('Error updating corpus', err);
      return this.responseHelper.error('Failed to update corpus', 500, err?.message || err);
    }
  }

  /**
   * Delete a corpus
   * DELETE /corpora/:id
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Delete(':id')
  async deleteCorpus(@Param('id') id: string) {
    try {
      const result = await this.talkrixCorpusService.deleteCorpus(id);
      return result;
    } catch (err) {
      this.logger.error('Error deleting corpus', err);
      return this.responseHelper.error('Failed to delete corpus', 500, err?.message || err);
    }
  }

  /**
   * Query a corpus
   * POST /corpora/:id/query
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/query')
  async queryCorpus(
    @Param('id') id: string,
    @Body() queryData: { query: string; maxResults?: number },
  ) {
    try {
      const result = await this.talkrixCorpusService.queryCorpus(id, queryData.query, queryData.maxResults);
      return result;
    } catch (err) {
      this.logger.error('Error querying corpus', err);
      return this.responseHelper.error('Failed to query corpus', 500, err?.message || err);
    }
  }

  // ==================== SOURCE ENDPOINTS ====================

  /**
   * Create a crawl source for a corpus
   * POST /corpora/:corpusId/sources/crawl
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':corpusId/sources/crawl')
  async createCrawlSource(
    @Param('corpusId') corpusId: string,
    @Body() sourceData: {
      name: string;
      description?: string;
      startUrls: string[];
      maxDocuments?: number;
      maxDepth?: number;
    },
    @Req() req: any,
  ) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }
    try {
      const result = await this.talkrixCorpusService.createCrawlSource(corpusId, sourceData, userInfo.userId);
      return result;
    } catch (err) {
      this.logger.error('Error creating crawl source', err);
      return this.responseHelper.error('Failed to create source', 500, err?.message || err);
    }
  }

  /**
   * Create an upload source for a corpus
   * POST /corpora/:corpusId/sources/upload
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':corpusId/sources/upload')
  async createUploadSource(
    @Param('corpusId') corpusId: string,
    @Body() sourceData: {
      name: string;
      description?: string;
      documentIds: string[];
    },
    @Req() req: any,
  ) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }
    try {
      const result = await this.talkrixCorpusService.createUploadSource(corpusId, sourceData, userInfo.userId);
      return result;
    } catch (err) {
      this.logger.error('Error creating upload source', err);
      return this.responseHelper.error('Failed to create source', 500, err?.message || err);
    }
  }

  /**
   * List sources for a corpus
   * GET /corpora/:corpusId/sources
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':corpusId/sources')
  async listSources(@Param('corpusId') corpusId: string) {
    try {
      const result = await this.talkrixCorpusService.listCorpusSources(corpusId);
      return result;
    } catch (err) {
      this.logger.error('Error listing sources', err);
      return this.responseHelper.error('Failed to list sources', 500, err?.message || err);
    }
  }

  /**
   * Get a specific source
   * GET /corpora/:corpusId/sources/:sourceId
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':corpusId/sources/:sourceId')
  async getSource(@Param('sourceId') sourceId: string) {
    try {
      const result = await this.talkrixCorpusService.getSource(sourceId);
      return result;
    } catch (err) {
      this.logger.error('Error fetching source', err);
      return this.responseHelper.error('Failed to fetch source', 500, err?.message || err);
    }
  }

  /**
   * Update a source
   * PATCH /corpora/:corpusId/sources/:sourceId
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Patch(':corpusId/sources/:sourceId')
  async updateSource(@Param('sourceId') sourceId: string, @Body() updateData: any) {
    try {
      const result = await this.talkrixCorpusService.updateSource(sourceId, updateData);
      return result;
    } catch (err) {
      this.logger.error('Error updating source', err);
      return this.responseHelper.error('Failed to update source', 500, err?.message || err);
    }
  }

  /**
   * Delete a source
   * DELETE /corpora/:corpusId/sources/:sourceId
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Delete(':corpusId/sources/:sourceId')
  async deleteSource(@Param('sourceId') sourceId: string) {
    try {
      const result = await this.talkrixCorpusService.deleteSource(sourceId);
      return result;
    } catch (err) {
      this.logger.error('Error deleting source', err);
      return this.responseHelper.error('Failed to delete source', 500, err?.message || err);
    }
  }

  // ==================== DOCUMENT ENDPOINTS ====================

  /**
   * List documents for a source
   * GET /corpora/:corpusId/sources/:sourceId/documents
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':corpusId/sources/:sourceId/documents')
  async listDocuments(@Param('sourceId') sourceId: string) {
    try {
      const result = await this.talkrixCorpusService.listSourceDocuments(sourceId);
      return result;
    } catch (err) {
      this.logger.error('Error listing documents', err);
      return this.responseHelper.error('Failed to list documents', 500, err?.message || err);
    }
  }

  /**
   * Create a file upload URL
   * POST /corpora/:corpusId/uploads
   */
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':corpusId/uploads')
  async createFileUpload(
    @Param('corpusId') corpusId: string,
    @Body() uploadData: { mimeType: string; fileName?: string },
    @Req() req: any,
  ) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }
    try {
      const result = await this.talkrixCorpusService.createFileUpload(corpusId, uploadData, userInfo.userId);
      return result;
    } catch (err) {
      this.logger.error('Error creating file upload', err);
      return this.responseHelper.error('Failed to create upload URL', 500, err?.message || err);
    }
  }
}
