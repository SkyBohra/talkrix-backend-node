import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';

// Contact schema for campaign contacts
@Schema({ _id: true, timestamps: true })
export class CampaignContact {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  phoneNumber: string; // Phone number with country code (with or without +)

  @Prop({ default: 'pending' })
  callStatus: 'pending' | 'completed' | 'failed' | 'in-progress' | 'no-answer';

  @Prop()
  callId?: string; // Reference to call history

  @Prop()
  calledAt?: Date;

  @Prop()
  callDuration?: number; // in seconds

  @Prop()
  callNotes?: string;
}

export const CampaignContactSchema = SchemaFactory.createForClass(CampaignContact);

// Campaign schedule for outbound campaigns
@Schema({ _id: false })
export class CampaignSchedule {
  @Prop({ required: true })
  scheduledDate: Date;

  @Prop({ required: true })
  scheduledTime: string; // HH:mm format

  @Prop({ required: true })
  timezone: string; // e.g., 'America/New_York', 'Asia/Kolkata'
}

export const CampaignScheduleSchema = SchemaFactory.createForClass(CampaignSchedule);

// Main Campaign schema
@Schema({ timestamps: true })
export class Campaign extends Document {
  @Prop({ required: true })
  name: string;

  @Prop({ required: true })
  userId: string;

  @Prop({ required: true, enum: ['outbound', 'inbound', 'ondemand'] })
  type: 'outbound' | 'inbound' | 'ondemand';

  @Prop({ required: true })
  agentId: string; // Reference to the agent

  @Prop()
  agentName?: string; // Cached agent name for display

  @Prop({ default: 'draft', enum: ['draft', 'active', 'paused', 'completed', 'scheduled'] })
  status: 'draft' | 'active' | 'paused' | 'completed' | 'scheduled';

  @Prop({ type: [CampaignContactSchema], default: [] })
  contacts: CampaignContact[];

  @Prop({ type: CampaignScheduleSchema })
  schedule?: CampaignSchedule; // Only required for outbound campaigns

  @Prop()
  description?: string;

  @Prop({ default: 0 })
  totalContacts: number;

  @Prop({ default: 0 })
  completedCalls: number;

  @Prop({ default: 0 })
  successfulCalls: number;

  @Prop({ default: 0 })
  failedCalls: number;

  @Prop()
  startedAt?: Date;

  @Prop()
  completedAt?: Date;

  // Inbound/OnDemand specific fields
  @Prop()
  inboundPhoneNumber?: string; // Phone number assigned for inbound campaigns

  @Prop({ default: true })
  isActive: boolean;
}

export const CampaignSchema = SchemaFactory.createForClass(Campaign);

// Add indexes for better query performance
CampaignSchema.index({ userId: 1 });
CampaignSchema.index({ status: 1 });
CampaignSchema.index({ type: 1 });
CampaignSchema.index({ agentId: 1 });
