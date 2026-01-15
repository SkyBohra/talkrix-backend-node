import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

export type CallType = 'test' | 'inbound' | 'outbound';
export type CallStatus = 'initiated' | 'in-progress' | 'completed' | 'missed' | 'failed';

@Schema({ timestamps: true })
export class CallHistory extends Document {
  @Prop({ required: true, type: MongooseSchema.Types.ObjectId, ref: 'Agent' })
  agentId: MongooseSchema.Types.ObjectId;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true })
  talkrixCallId: string;

  @Prop({ required: true, enum: ['test', 'inbound', 'outbound'], default: 'test' })
  callType: CallType;

  @Prop({ required: true, enum: ['initiated', 'in-progress', 'completed', 'missed', 'failed'], default: 'initiated' })
  status: CallStatus;

  @Prop()
  agentName: string;

  // Customer info - optional for test calls
  @Prop()
  customerName?: string;

  @Prop()
  customerPhone?: string;

  // Call timing
  @Prop()
  startedAt?: Date;

  @Prop()
  endedAt?: Date;

  @Prop({ default: 0 })
  durationSeconds: number;

  // Recording info
  @Prop({ default: false })
  recordingEnabled: boolean;

  @Prop()
  recordingUrl?: string;

  // Call specific data
  @Prop()
  joinUrl?: string;

  @Prop({ type: Object })
  callData?: Record<string, any>;

  // Additional metadata
  @Prop({ type: Object })
  metadata?: Record<string, any>;
}

export const CallHistorySchema = SchemaFactory.createForClass(CallHistory);

// Add indexes for efficient queries
CallHistorySchema.index({ userId: 1, createdAt: -1 });
CallHistorySchema.index({ agentId: 1, createdAt: -1 });
CallHistorySchema.index({ status: 1 });
CallHistorySchema.index({ callType: 1 });
CallHistorySchema.index({ talkrixCallId: 1 }, { unique: true });
