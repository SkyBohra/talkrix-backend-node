import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Corpus, CorpusSource, CorpusDocument } from './corpus.schema';

@Injectable()
export class CorpusService {
  constructor(
    @InjectModel(Corpus.name) private corpusModel: Model<Corpus>,
    @InjectModel(CorpusSource.name) private sourceModel: Model<CorpusSource>,
    @InjectModel(CorpusDocument.name) private documentModel: Model<CorpusDocument>,
  ) {}

  // ==================== CORPUS OPERATIONS ====================

  /**
   * Create a new corpus in local database
   */
  async createCorpus(corpusData: Partial<Corpus>): Promise<Corpus> {
    const corpus = new this.corpusModel(corpusData);
    return corpus.save();
  }

  /**
   * Find all corpora
   */
  async findAllCorpora(): Promise<Corpus[]> {
    return this.corpusModel.find().exec();
  }

  /**
   * Find corpora by user ID
   */
  async findCorporaByUserId(userId: string): Promise<Corpus[]> {
    return this.corpusModel.find({ userId }).exec();
  }

  /**
   * Count corpora by user ID
   */
  async countCorporaByUserId(userId: string): Promise<number> {
    return this.corpusModel.countDocuments({ userId }).exec();
  }

  /**
   * Find a corpus by local ID
   */
  async findCorpusById(id: string): Promise<Corpus | null> {
    return this.corpusModel.findById(id).exec();
  }

  /**
   * Find a corpus by Ultravox corpus ID (talkrixCorpusId)
   */
  async findCorpusByTalkrixId(talkrixCorpusId: string): Promise<Corpus | null> {
    return this.corpusModel.findOne({ talkrixCorpusId }).exec();
  }

  /**
   * Update a corpus
   */
  async updateCorpus(id: string, updateData: Partial<Corpus>): Promise<Corpus | null> {
    return this.corpusModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  /**
   * Delete a corpus and all related sources and documents
   */
  async deleteCorpus(id: string): Promise<boolean> {
    const corpus = await this.corpusModel.findById(id).exec();
    if (!corpus) return false;

    // Delete all related sources and documents
    await this.sourceModel.deleteMany({ talkrixCorpusId: id }).exec();
    await this.documentModel.deleteMany({ corpusId: corpus.talkrixCorpusId }).exec();
    
    await this.corpusModel.findByIdAndDelete(id).exec();
    return true;
  }

  // ==================== SOURCE OPERATIONS ====================

  /**
   * Create a new source in local database
   */
  async createSource(sourceData: Partial<CorpusSource>): Promise<CorpusSource> {
    const source = new this.sourceModel(sourceData);
    return source.save();
  }

  /**
   * Find all sources for a corpus
   */
  async findSourcesByCorpusId(corpusId: string): Promise<CorpusSource[]> {
    return this.sourceModel.find({ corpusId }).exec();
  }

  /**
   * Find all sources for a local corpus ID
   */
  async findSourcesByTalkrixCorpusId(talkrixCorpusId: string): Promise<CorpusSource[]> {
    return this.sourceModel.find({ talkrixCorpusId }).exec();
  }

  /**
   * Find sources by user ID
   */
  async findSourcesByUserId(userId: string): Promise<CorpusSource[]> {
    return this.sourceModel.find({ userId }).exec();
  }

  /**
   * Find a source by local ID
   */
  async findSourceById(id: string): Promise<CorpusSource | null> {
    return this.sourceModel.findById(id).exec();
  }

  /**
   * Find a source by Ultravox source ID
   */
  async findSourceBySourceId(sourceId: string): Promise<CorpusSource | null> {
    return this.sourceModel.findOne({ sourceId }).exec();
  }

  /**
   * Update a source
   */
  async updateSource(id: string, updateData: Partial<CorpusSource>): Promise<CorpusSource | null> {
    return this.sourceModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  /**
   * Delete a source and all related documents
   */
  async deleteSource(id: string): Promise<boolean> {
    const source = await this.sourceModel.findById(id).exec();
    if (!source) return false;

    // Delete all related documents
    await this.documentModel.deleteMany({ sourceId: source.sourceId }).exec();
    
    await this.sourceModel.findByIdAndDelete(id).exec();
    return true;
  }

  // ==================== DOCUMENT OPERATIONS ====================

  /**
   * Create a new document record in local database
   */
  async createDocument(docData: Partial<CorpusDocument>): Promise<CorpusDocument> {
    const document = new this.documentModel(docData);
    return document.save();
  }

  /**
   * Find all documents for a source
   */
  async findDocumentsBySourceId(sourceId: string): Promise<CorpusDocument[]> {
    return this.documentModel.find({ sourceId }).exec();
  }

  /**
   * Find all documents for a corpus
   */
  async findDocumentsByCorpusId(corpusId: string): Promise<CorpusDocument[]> {
    return this.documentModel.find({ corpusId }).exec();
  }

  /**
   * Find documents by user ID
   */
  async findDocumentsByUserId(userId: string): Promise<CorpusDocument[]> {
    return this.documentModel.find({ userId }).exec();
  }

  /**
   * Find a document by local ID
   */
  async findDocumentById(id: string): Promise<CorpusDocument | null> {
    return this.documentModel.findById(id).exec();
  }

  /**
   * Find a document by Ultravox document ID
   */
  async findDocumentByDocumentId(documentId: string): Promise<CorpusDocument | null> {
    return this.documentModel.findOne({ documentId }).exec();
  }

  /**
   * Update a document
   */
  async updateDocument(id: string, updateData: Partial<CorpusDocument>): Promise<CorpusDocument | null> {
    return this.documentModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  /**
   * Delete a document
   */
  async deleteDocument(id: string): Promise<boolean> {
    const result = await this.documentModel.findByIdAndDelete(id).exec();
    return !!result;
  }
}
