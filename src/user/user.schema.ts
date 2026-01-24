import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

// Telephony Provider Types
export type TelephonyProvider = 'plivo' | 'twilio' | 'telnyx' | 'none';

// Telephony Settings Sub-Schema
@Schema({ _id: false })
export class TelephonySettings {
  @Prop({ default: 'none' })
  provider: TelephonyProvider;

  // Plivo Settings
  @Prop()
  plivoAuthId?: string;

  @Prop()
  plivoAuthToken?: string;

  @Prop({ type: [String], default: [] })
  plivoPhoneNumbers?: string[];

  // Twilio Settings
  @Prop()
  twilioAccountSid?: string;

  @Prop()
  twilioAuthToken?: string;

  @Prop({ type: [String], default: [] })
  twilioPhoneNumbers?: string[];

  // Telnyx Settings
  @Prop()
  telnyxApiKey?: string;

  @Prop({ type: [String], default: [] })
  telnyxPhoneNumbers?: string[];

  @Prop()
  telnyxConnectionId?: string;
}

export const TelephonySettingsSchema = SchemaFactory.createForClass(TelephonySettings);

// User Settings Sub-Schema
@Schema({ _id: false })
export class UserSettings {
  @Prop({ default: 1 })
  maxConcurrentCalls: number;

  @Prop({ default: 5 })
  maxRagDocuments: number;

  @Prop({ default: 10 })
  maxAgents: number;

  @Prop({ type: TelephonySettingsSchema, default: () => ({}) })
  telephony: TelephonySettings;
}

export const UserSettingsSchema = SchemaFactory.createForClass(UserSettings);

@Schema()
export class User extends Document {
  @Prop({ required: true, unique: true })
  email: string;

  @Prop({ required: true })
  password: string;

  @Prop()
  name: string;

  @Prop({ required: true, unique: true })
  apiKey: string;

  @Prop({ default: 1 })
  maxCorpusLimit: number;

  // Track if user has completed the dashboard tour
  @Prop({ default: false })
  hasCompletedTour: boolean;

  // User Settings - contains all configurable settings
  @Prop({ type: UserSettingsSchema, default: () => ({}) })
  settings: UserSettings;
}

export const UserSchema = SchemaFactory.createForClass(User);
