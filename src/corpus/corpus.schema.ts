import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Corpus Stats Schema
@Schema({ _id: false })
export class CorpusStats {
  @Prop({ default: 'CORPUS_STATUS_UNSPECIFIED' })
  status: string;

  @Prop()
  lastUpdated: Date;

  @Prop({ default: 0 })
  numChunks: number;

  @Prop({ default: 0 })
  numDocs: number;

  @Prop({ default: 0 })
  numVectors: number;
}

export const CorpusStatsSchema = SchemaFactory.createForClass(CorpusStats);

// Source Stats Schema
@Schema({ _id: false })
export class SourceStats {
  @Prop({ default: 'SOURCE_STATUS_UNSPECIFIED' })
  status: string;

  @Prop()
  lastUpdated: Date;

  @Prop({ default: 0 })
  numDocs: number;
}

export const SourceStatsSchema = SchemaFactory.createForClass(SourceStats);

// Relevant Document Types Schema
@Schema({ _id: false })
export class DocumentTypeFilter {
  @Prop({ type: [String] })
  mimeTypes: string[];
}

export const DocumentTypeFilterSchema = SchemaFactory.createForClass(DocumentTypeFilter);

@Schema({ _id: false })
export class RelevantDocumentTypes {
  @Prop({ type: DocumentTypeFilterSchema })
  include: DocumentTypeFilter;

  @Prop({ type: DocumentTypeFilterSchema })
  exclude: DocumentTypeFilter;
}

export const RelevantDocumentTypesSchema = SchemaFactory.createForClass(RelevantDocumentTypes);

// Crawl Configuration Schema
@Schema({ _id: false })
export class CrawlConfig {
  @Prop()
  maxDocuments: number;

  @Prop()
  maxDocumentBytes: number;

  @Prop({ type: RelevantDocumentTypesSchema })
  relevantDocumentTypes: RelevantDocumentTypes;

  @Prop({ type: [String] })
  startUrls: string[];

  @Prop()
  maxDepth: number;
}

export const CrawlConfigSchema = SchemaFactory.createForClass(CrawlConfig);

// Upload Configuration Schema
@Schema({ _id: false })
export class UploadConfig {
  @Prop({ type: [String] })
  documentIds: string[];
}

export const UploadConfigSchema = SchemaFactory.createForClass(UploadConfig);

// Advanced Document Configuration
@Schema({ _id: false })
export class AdvancedDocument {
  @Prop()
  documentId: string;

  @Prop({ type: [String] })
  exampleQueries: string[];
}

export const AdvancedDocumentSchema = SchemaFactory.createForClass(AdvancedDocument);

@Schema({ _id: false })
export class AdvancedConfig {
  @Prop({ type: [AdvancedDocumentSchema] })
  documents: AdvancedDocument[];
}

export const AdvancedConfigSchema = SchemaFactory.createForClass(AdvancedConfig);

// Document Metadata Schema
@Schema({ _id: false })
export class DocumentMetadata {
  @Prop()
  publicUrl: string;

  @Prop()
  language: string;

  @Prop()
  title: string;

  @Prop()
  description: string;

  @Prop()
  published: Date;

  @Prop({ type: [String] })
  exampleQueries: string[];
}

export const DocumentMetadataSchema = SchemaFactory.createForClass(DocumentMetadata);

// Corpus Source Schema (stored separately for flexibility)
@Schema({ timestamps: true })
export class CorpusSource extends Document {
  @Prop({ required: true })
  talkrixCorpusId: string; // Reference to local corpus

  @Prop({ required: true })
  corpusId: string; // Ultravox corpus ID

  @Prop({ required: true })
  sourceId: string; // Ultravox source ID

  @Prop({ required: true })
  userId: string;

  @Prop()
  name: string;

  @Prop()
  description: string;

  @Prop({ type: SourceStatsSchema })
  stats: SourceStats;

  @Prop({ type: CrawlConfigSchema })
  crawl: CrawlConfig;

  @Prop({ type: UploadConfigSchema })
  upload: UploadConfig;

  @Prop({ type: AdvancedConfigSchema })
  advanced: AdvancedConfig;
}

export const CorpusSourceSchema = SchemaFactory.createForClass(CorpusSource);

// Main Corpus Schema
@Schema({ timestamps: true })
export class Corpus extends Document {
  @Prop({ required: true })
  talkrixCorpusId: string; // Ultravox corpus ID (named talkrix for branding)

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop()
  description: string;

  @Prop({ type: CorpusStatsSchema })
  stats: CorpusStats;
}

export const CorpusSchema = SchemaFactory.createForClass(Corpus);

// Corpus Document Schema (for tracking uploaded documents)
@Schema({ timestamps: true })
export class CorpusDocument extends Document {
  @Prop({ required: true })
  corpusId: string; // Ultravox corpus ID

  @Prop({ required: false, default: '' })
  sourceId: string; // Ultravox source ID (optional - set after source creation)

  @Prop({ required: true })
  documentId: string; // Ultravox document ID

  @Prop({ required: true })
  userId: string;

  @Prop()
  mimeType: string;

  @Prop()
  fileName: string;

  @Prop()
  sizeBytes: string;

  @Prop({ type: DocumentMetadataSchema })
  metadata: DocumentMetadata;
}

export const CorpusDocumentSchema = SchemaFactory.createForClass(CorpusDocument);
