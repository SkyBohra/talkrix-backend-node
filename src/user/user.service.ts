import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserSettings, TelephonySettings } from './user.schema';
import * as bcrypt from 'bcryptjs';
import { generateApiKey } from './api-key.util';

@Injectable()
export class UserService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  async create(email: string, password: string, name: string) {
    const hash = await bcrypt.hash(password, 10);
    const apiKey = generateApiKey();
    // Default maxCorpusLimit is 1 (set in schema), can be changed per user in database
    const user = new this.userModel({ email, password: hash, name, apiKey });
    return user.save();
  }

  async findByEmail(email: string) {
    return this.userModel.findOne({ email });
  }

  async findByApiKey(apiKey: string) {
    return this.userModel.findOne({ apiKey });
  }

  async findById(id: string) {
    return this.userModel.findById(id);
  }

  async updateMaxCorpusLimit(userId: string, limit: number) {
    return this.userModel.findByIdAndUpdate(userId, { maxCorpusLimit: limit }, { new: true });
  }

  // ===== Settings Management Methods =====

  /**
   * Get user settings
   */
  async getSettings(userId: string): Promise<UserSettings | null> {
    const user = await this.userModel.findById(userId);
    if (!user) return null;
    return user.settings || {};
  }

  /**
   * Update general settings (maxConcurrentCalls, maxRagDocuments, maxAgents)
   */
  async updateGeneralSettings(
    userId: string,
    settings: Partial<Pick<UserSettings, 'maxConcurrentCalls' | 'maxRagDocuments' | 'maxAgents'>>,
  ) {
    const updateFields: Record<string, any> = {};
    
    if (settings.maxConcurrentCalls !== undefined) {
      updateFields['settings.maxConcurrentCalls'] = settings.maxConcurrentCalls;
    }
    if (settings.maxRagDocuments !== undefined) {
      updateFields['settings.maxRagDocuments'] = settings.maxRagDocuments;
    }
    if (settings.maxAgents !== undefined) {
      updateFields['settings.maxAgents'] = settings.maxAgents;
    }

    return this.userModel.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true },
    );
  }

  /**
   * Update telephony settings (provider credentials)
   */
  async updateTelephonySettings(userId: string, telephony: Partial<TelephonySettings> & { plivoPhoneNumbers?: string[]; twilioPhoneNumbers?: string[]; telnyxPhoneNumbers?: string[] }) {
    const updateFields: Record<string, any> = {};

    // Set provider
    if (telephony.provider !== undefined) {
      updateFields['settings.telephony.provider'] = telephony.provider;
    }

    // Plivo settings
    if (telephony.plivoAuthId !== undefined) {
      updateFields['settings.telephony.plivoAuthId'] = telephony.plivoAuthId;
    }
    if (telephony.plivoAuthToken !== undefined) {
      updateFields['settings.telephony.plivoAuthToken'] = telephony.plivoAuthToken;
    }
    if (telephony.plivoPhoneNumbers !== undefined) {
      updateFields['settings.telephony.plivoPhoneNumbers'] = telephony.plivoPhoneNumbers;
    }

    // Twilio settings
    if (telephony.twilioAccountSid !== undefined) {
      updateFields['settings.telephony.twilioAccountSid'] = telephony.twilioAccountSid;
    }
    if (telephony.twilioAuthToken !== undefined) {
      updateFields['settings.telephony.twilioAuthToken'] = telephony.twilioAuthToken;
    }
    if (telephony.twilioPhoneNumbers !== undefined) {
      updateFields['settings.telephony.twilioPhoneNumbers'] = telephony.twilioPhoneNumbers;
    }

    // Telnyx settings
    if (telephony.telnyxApiKey !== undefined) {
      updateFields['settings.telephony.telnyxApiKey'] = telephony.telnyxApiKey;
    }
    if (telephony.telnyxPhoneNumbers !== undefined) {
      updateFields['settings.telephony.telnyxPhoneNumbers'] = telephony.telnyxPhoneNumbers;
    }
    if (telephony.telnyxConnectionId !== undefined) {
      updateFields['settings.telephony.telnyxConnectionId'] = telephony.telnyxConnectionId;
    }

    return this.userModel.findByIdAndUpdate(
      userId,
      { $set: updateFields },
      { new: true },
    );
  }

  /**
   * Get telephony credentials for call generation
   */
  async getTelephonyCredentials(userId: string): Promise<TelephonySettings | null> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.settings?.telephony) return null;
    return user.settings.telephony;
  }

  /**
   * Regenerate API Key
   */
  async regenerateApiKey(userId: string) {
    const newApiKey = generateApiKey();
    return this.userModel.findByIdAndUpdate(
      userId,
      { apiKey: newApiKey },
      { new: true },
    );
  }
}
