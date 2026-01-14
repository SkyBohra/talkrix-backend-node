import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

@Schema({ _id: false })
export class VADSettings {
  @Prop()
  turnEndpointDelay: string;
  @Prop()
  minimumTurnDuration: string;
  @Prop()
  minimumInterruptionDuration: string;
  @Prop()
  frameActivationThreshold: number;
}

export const VADSettingsSchema = SchemaFactory.createForClass(VADSettings);

@Schema({ _id: false })
export class CallTemplate {
  @Prop()
  name: string;
  @Prop()
  created: string;
  @Prop()
  updated: string;
  @Prop({ type: Object })
  medium: Record<string, any>;
  @Prop()
  initialOutputMedium: string;
  @Prop()
  joinTimeout: string;
  @Prop()
  maxDuration: string;
  @Prop({ type: VADSettingsSchema })
  vadSettings: VADSettings;
  @Prop()
  recordingEnabled: boolean;
  @Prop({ type: Object })
  firstSpeakerSettings: Record<string, any>;
  @Prop()
  systemPrompt: string;
  @Prop()
  temperature: number;
  @Prop()
  model: string;
  @Prop()
  voice: string;
  @Prop({ type: Object })
  externalVoice: Record<string, any>;
  @Prop()
  languageHint: string;
  @Prop()
  timeExceededMessage: string;
  @Prop({ type: [Object] })
  inactivityMessages: Record<string, any>[];
  @Prop({ type: [Object] })
  selectedTools: Record<string, any>[];
  @Prop()
  corpusId: string;
  @Prop({ type: Object })
  dataConnection: Record<string, any>;
  @Prop({ type: Object })
  contextSchema: Record<string, any>;
}

export const CallTemplateSchema = SchemaFactory.createForClass(CallTemplate);

@Schema()
export class Agent extends Document {
  @Prop({ required: true })
  talkrixAgentId: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  name: string;

  @Prop({ type: CallTemplateSchema, required: true })
  callTemplate: CallTemplate;
  // Add other Ultravox fields here as needed
}

export const AgentSchema = SchemaFactory.createForClass(Agent);
