import { Injectable } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { CorpusService } from './corpus.service';
import { ResponseHelper, StandardResponse } from '../response.helper';
import { AppLogger } from '../app.logger';

const ULTRAVOX_API_BASE = 'https://api.ultravox.ai/api';

@Injectable()
export class TalkrixCorpusService {
  constructor(
    private readonly httpService: HttpService,
    private readonly corpusService: CorpusService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
  ) {}

  private getHeaders() {
    const apiKey = process.env.ULTRAVOX_API_KEY;
    return {
      'X-API-Key': apiKey,
      'Content-Type': 'application/json',
      'Referer': 'https://api.ultravox.ai/',
      'Origin': 'https://api.ultravox.ai',
    };
  }

  // ==================== CORPUS OPERATIONS ====================

  /**
   * Create a new corpus
   * Creates in Ultravox API and stores in local database
   */
  async createCorpus(corpusData: { name: string; description?: string }, userId: string): Promise<StandardResponse> {
    try {
      // Create corpus in Ultravox
      const response = await this.httpService.post(
        `${ULTRAVOX_API_BASE}/corpora`,
        {
          name: corpusData.name,
          description: corpusData.description,
        },
        { headers: this.getHeaders() },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return corpus data');
        return this.responseHelper.error('Ultravox API did not return corpus data', 502);
      }

      const ultravoxCorpusId = response.data.corpusId;

      // Save to local database
      const corpus = await this.corpusService.createCorpus({
        talkrixCorpusId: ultravoxCorpusId,
        userId,
        name: corpusData.name,
        description: corpusData.description,
        stats: response.data.stats,
      });

      this.logger.log(`Corpus created for user ${userId}: ${ultravoxCorpusId}`);
      return this.responseHelper.success(corpus, 'Corpus created', 201);
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error creating corpus', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create corpus', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * List all corpora for a user
   */
  async listUserCorpora(userId: string): Promise<StandardResponse> {
    try {
      const corpora = await this.corpusService.findCorporaByUserId(userId);
      return this.responseHelper.success(corpora, 'Corpora fetched');
    } catch (err) {
      this.logger.error('Error fetching user corpora', err?.message || err);
      return this.responseHelper.error('Failed to fetch corpora', 500, err?.message || err);
    }
  }

  /**
   * Get corpus by ID
   */
  async getCorpus(id: string): Promise<StandardResponse> {
    try {
      const corpus = await this.corpusService.findCorpusById(id);
      if (!corpus) {
        return this.responseHelper.error('Corpus not found', 404);
      }

      // Optionally sync with Ultravox to get latest stats
      try {
        const response = await this.httpService.get(
          `${ULTRAVOX_API_BASE}/corpora/${corpus.talkrixCorpusId}`,
          { headers: this.getHeaders() },
        ).toPromise();

        if (response?.data?.stats) {
          // Update local stats
          await this.corpusService.updateCorpus(id, { stats: response.data.stats });
          corpus.stats = response.data.stats;
        }
      } catch (syncErr) {
        this.logger.warn('Could not sync corpus stats from Ultravox', syncErr?.message);
      }

      return this.responseHelper.success(corpus, 'Corpus fetched');
    } catch (err) {
      this.logger.error('Error fetching corpus', err?.message || err);
      return this.responseHelper.error('Failed to fetch corpus', 500, err?.message || err);
    }
  }

  /**
   * Update a corpus
   */
  async updateCorpus(id: string, updateData: { name?: string; description?: string }): Promise<StandardResponse> {
    try {
      const corpus = await this.corpusService.findCorpusById(id);
      if (!corpus) {
        return this.responseHelper.error('Corpus not found', 404);
      }

      // Update in Ultravox
      const payload: any = {};
      if (updateData.name) payload.name = updateData.name;
      if (updateData.description !== undefined) payload.description = updateData.description;

      const response = await this.httpService.patch(
        `${ULTRAVOX_API_BASE}/corpora/${corpus.talkrixCorpusId}`,
        payload,
        { headers: this.getHeaders() },
      ).toPromise();

      if (!response || !response.data) {
        this.logger.warn('Ultravox API did not return updated corpus data');
        return this.responseHelper.error('Ultravox API did not return updated corpus data', 502);
      }

      // Update local database
      const updatedCorpus = await this.corpusService.updateCorpus(id, {
        name: response.data.name || corpus.name,
        description: response.data.description,
        stats: response.data.stats,
      });

      this.logger.log(`Corpus ${id} updated`);
      return this.responseHelper.success(updatedCorpus, 'Corpus updated');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error updating corpus', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to update corpus', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Delete a corpus
   */
  async deleteCorpus(id: string): Promise<StandardResponse> {
    try {
      const corpus = await this.corpusService.findCorpusById(id);
      if (!corpus) {
        return this.responseHelper.error('Corpus not found', 404);
      }

      // Delete from Ultravox
      await this.httpService.delete(
        `${ULTRAVOX_API_BASE}/corpora/${corpus.talkrixCorpusId}`,
        { headers: this.getHeaders() },
      ).toPromise();

      // Delete from local database (cascades to sources and documents)
      await this.corpusService.deleteCorpus(id);

      this.logger.log(`Corpus ${id} deleted`);
      return this.responseHelper.success(null, 'Corpus deleted');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error deleting corpus', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to delete corpus', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Query a corpus
   */
  async queryCorpus(id: string, query: string, maxResults?: number): Promise<StandardResponse> {
    try {
      const corpus = await this.corpusService.findCorpusById(id);
      if (!corpus) {
        return this.responseHelper.error('Corpus not found', 404);
      }

      const response = await this.httpService.post(
        `${ULTRAVOX_API_BASE}/corpora/${corpus.talkrixCorpusId}/query`,
        {
          query,
          maxResults: maxResults || 5,
        },
        { headers: this.getHeaders() },
      ).toPromise();

      if (!response || !response.data) {
        return this.responseHelper.error('No query results', 404);
      }

      return this.responseHelper.success(response.data, 'Query executed');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error querying corpus', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to query corpus', err?.response?.status || 500, errorDetails);
    }
  }

  // ==================== SOURCE OPERATIONS ====================

  /**
   * Create a source (web crawl)
   */
  async createCrawlSource(
    corpusId: string,
    sourceData: {
      name: string;
      description?: string;
      startUrls: string[];
      maxDocuments?: number;
      maxDepth?: number;
    },
    userId: string,
  ): Promise<StandardResponse> {
    try {
      const corpus = await this.corpusService.findCorpusById(corpusId);
      if (!corpus) {
        return this.responseHelper.error('Corpus not found', 404);
      }

      const crawlConfig: any = {
        startUrls: sourceData.startUrls,
      };
      if (sourceData.maxDocuments) crawlConfig.maxDocuments = sourceData.maxDocuments;
      if (sourceData.maxDepth) crawlConfig.maxDepth = sourceData.maxDepth;

      const response = await this.httpService.post(
        `${ULTRAVOX_API_BASE}/corpora/${corpus.talkrixCorpusId}/sources`,
        {
          name: sourceData.name,
          description: sourceData.description,
          crawl: crawlConfig,
        },
        { headers: this.getHeaders() },
      ).toPromise();

      if (!response || !response.data) {
        return this.responseHelper.error('Ultravox API did not return source data', 502);
      }

      // Save to local database
      const source = await this.corpusService.createSource({
        talkrixCorpusId: corpusId,
        corpusId: corpus.talkrixCorpusId,
        sourceId: response.data.sourceId,
        userId,
        name: sourceData.name,
        description: sourceData.description,
        stats: response.data.stats,
        crawl: response.data.crawl,
      });

      this.logger.log(`Crawl source created for corpus ${corpusId}`);
      return this.responseHelper.success(source, 'Source created', 201);
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error creating crawl source', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create source', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Create a source for file uploads
   */
  async createUploadSource(
    corpusId: string,
    sourceData: {
      name: string;
      description?: string;
      documentIds: string[];
    },
    userId: string,
  ): Promise<StandardResponse> {
    try {
      const corpus = await this.corpusService.findCorpusById(corpusId);
      if (!corpus) {
        return this.responseHelper.error('Corpus not found', 404);
      }

      const response = await this.httpService.post(
        `${ULTRAVOX_API_BASE}/corpora/${corpus.talkrixCorpusId}/sources`,
        {
          name: sourceData.name,
          description: sourceData.description,
          upload: {
            documentIds: sourceData.documentIds,
          },
        },
        { headers: this.getHeaders() },
      ).toPromise();

      if (!response || !response.data) {
        return this.responseHelper.error('Ultravox API did not return source data', 502);
      }

      // Save to local database
      const source = await this.corpusService.createSource({
        talkrixCorpusId: corpusId,
        corpusId: corpus.talkrixCorpusId,
        sourceId: response.data.sourceId,
        userId,
        name: sourceData.name,
        description: sourceData.description,
        stats: response.data.stats,
        upload: response.data.upload,
      });

      this.logger.log(`Upload source created for corpus ${corpusId}`);
      return this.responseHelper.success(source, 'Source created', 201);
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error creating upload source', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create source', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * List sources for a corpus
   */
  async listCorpusSources(corpusId: string): Promise<StandardResponse> {
    try {
      const corpus = await this.corpusService.findCorpusById(corpusId);
      if (!corpus) {
        return this.responseHelper.error('Corpus not found', 404);
      }

      const sources = await this.corpusService.findSourcesByTalkrixCorpusId(corpusId);
      return this.responseHelper.success(sources, 'Sources fetched');
    } catch (err) {
      this.logger.error('Error fetching sources', err?.message || err);
      return this.responseHelper.error('Failed to fetch sources', 500, err?.message || err);
    }
  }

  /**
   * Get a source by ID
   */
  async getSource(id: string): Promise<StandardResponse> {
    try {
      const source = await this.corpusService.findSourceById(id);
      if (!source) {
        return this.responseHelper.error('Source not found', 404);
      }

      // Optionally sync with Ultravox
      try {
        const response = await this.httpService.get(
          `${ULTRAVOX_API_BASE}/corpora/${source.corpusId}/sources/${source.sourceId}`,
          { headers: this.getHeaders() },
        ).toPromise();

        if (response?.data?.stats) {
          await this.corpusService.updateSource(id, { stats: response.data.stats });
          source.stats = response.data.stats;
        }
      } catch (syncErr) {
        this.logger.warn('Could not sync source stats from Ultravox', syncErr?.message);
      }

      return this.responseHelper.success(source, 'Source fetched');
    } catch (err) {
      this.logger.error('Error fetching source', err?.message || err);
      return this.responseHelper.error('Failed to fetch source', 500, err?.message || err);
    }
  }

  /**
   * Update a source
   */
  async updateSource(id: string, updateData: any): Promise<StandardResponse> {
    try {
      const source = await this.corpusService.findSourceById(id);
      if (!source) {
        return this.responseHelper.error('Source not found', 404);
      }

      const response = await this.httpService.patch(
        `${ULTRAVOX_API_BASE}/corpora/${source.corpusId}/sources/${source.sourceId}`,
        updateData,
        { headers: this.getHeaders() },
      ).toPromise();

      if (!response || !response.data) {
        return this.responseHelper.error('Ultravox API did not return updated source data', 502);
      }

      const updatedSource = await this.corpusService.updateSource(id, {
        name: response.data.name,
        description: response.data.description,
        stats: response.data.stats,
        crawl: response.data.crawl,
        upload: response.data.upload,
        advanced: response.data.advanced,
      });

      this.logger.log(`Source ${id} updated`);
      return this.responseHelper.success(updatedSource, 'Source updated');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error updating source', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to update source', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Delete a source
   */
  async deleteSource(id: string): Promise<StandardResponse> {
    try {
      const source = await this.corpusService.findSourceById(id);
      if (!source) {
        return this.responseHelper.error('Source not found', 404);
      }

      await this.httpService.delete(
        `${ULTRAVOX_API_BASE}/corpora/${source.corpusId}/sources/${source.sourceId}`,
        { headers: this.getHeaders() },
      ).toPromise();

      await this.corpusService.deleteSource(id);

      this.logger.log(`Source ${id} deleted`);
      return this.responseHelper.success(null, 'Source deleted');
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error deleting source', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to delete source', err?.response?.status || 500, errorDetails);
    }
  }

  // ==================== DOCUMENT OPERATIONS ====================

  /**
   * List documents for a source
   */
  async listSourceDocuments(sourceId: string): Promise<StandardResponse> {
    try {
      const source = await this.corpusService.findSourceById(sourceId);
      if (!source) {
        return this.responseHelper.error('Source not found', 404);
      }

      // Fetch from Ultravox API to get latest documents
      try {
        const response = await this.httpService.get(
          `${ULTRAVOX_API_BASE}/corpora/${source.corpusId}/sources/${source.sourceId}/documents`,
          { headers: this.getHeaders() },
        ).toPromise();

        if (response?.data?.results) {
          return this.responseHelper.success(response.data.results, 'Documents fetched');
        }
      } catch (apiErr) {
        this.logger.warn('Could not fetch documents from Ultravox API', apiErr?.message);
      }

      // Fallback to local documents
      const documents = await this.corpusService.findDocumentsBySourceId(source.sourceId);
      return this.responseHelper.success(documents, 'Documents fetched');
    } catch (err) {
      this.logger.error('Error fetching documents', err?.message || err);
      return this.responseHelper.error('Failed to fetch documents', 500, err?.message || err);
    }
  }

  /**
   * Create a file upload URL
   * Returns a presigned URL for uploading a document
   */
  async createFileUpload(
    corpusId: string,
    uploadData: { mimeType: string; fileName?: string },
    userId: string,
  ): Promise<StandardResponse> {
    try {
      const corpus = await this.corpusService.findCorpusById(corpusId);
      if (!corpus) {
        return this.responseHelper.error('Corpus not found', 404);
      }

      const response = await this.httpService.post(
        `${ULTRAVOX_API_BASE}/corpora/${corpus.talkrixCorpusId}/uploads`,
        {
          mimeType: uploadData.mimeType,
          fileName: uploadData.fileName || '',
        },
        { headers: this.getHeaders() },
      ).toPromise();

      if (!response || !response.data) {
        return this.responseHelper.error('Ultravox API did not return upload URL', 502);
      }

      // Save document record to local database
      const document = await this.corpusService.createDocument({
        corpusId: corpus.talkrixCorpusId,
        sourceId: '', // Will be updated when source is created
        documentId: response.data.documentId,
        userId,
        mimeType: uploadData.mimeType,
        fileName: uploadData.fileName || '',
      });

      this.logger.log(`File upload URL created for corpus ${corpusId}`);
      return this.responseHelper.success(
        {
          documentId: response.data.documentId,
          presignedUrl: response.data.presignedUrl,
          localDocumentId: document._id,
        },
        'Upload URL created',
        201,
      );
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error creating file upload', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to create upload URL', err?.response?.status || 500, errorDetails);
    }
  }

  /**
   * Sync corpora from Ultravox API to local database
   * Useful for initial setup or recovery
   */
  async syncFromUltravox(userId: string): Promise<StandardResponse> {
    try {
      const response = await this.httpService.get(
        `${ULTRAVOX_API_BASE}/corpora`,
        { headers: this.getHeaders() },
      ).toPromise();

      if (!response?.data?.results) {
        return this.responseHelper.success([], 'No corpora found');
      }

      const synced = [];
      for (const ultravoxCorpus of response.data.results) {
        // Check if already exists locally
        let localCorpus = await this.corpusService.findCorpusByTalkrixId(ultravoxCorpus.corpusId);
        
        if (!localCorpus) {
          // Create local record
          localCorpus = await this.corpusService.createCorpus({
            talkrixCorpusId: ultravoxCorpus.corpusId,
            userId,
            name: ultravoxCorpus.name,
            description: ultravoxCorpus.description,
            stats: ultravoxCorpus.stats,
          });
        } else {
          // Update stats
          await this.corpusService.updateCorpus(String(localCorpus._id), {
            name: ultravoxCorpus.name,
            description: ultravoxCorpus.description,
            stats: ultravoxCorpus.stats,
          });
        }
        synced.push(localCorpus);
      }

      this.logger.log(`Synced ${synced.length} corpora from Ultravox`);
      return this.responseHelper.success(synced, `Synced ${synced.length} corpora`);
    } catch (err) {
      if (err?.response?.data) {
        this.logger.error('Ultravox API error response:', JSON.stringify(err.response.data, null, 2));
      }
      this.logger.error('Error syncing from Ultravox', err?.message || err);
      const errorDetails = err?.response?.data || err?.message || err;
      return this.responseHelper.error('Failed to sync corpora', err?.response?.status || 500, errorDetails);
    }
  }
}
