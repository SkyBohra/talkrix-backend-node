import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Campaign, CampaignContact } from './campaign.schema';

@Injectable()
export class CampaignService {
  constructor(@InjectModel(Campaign.name) private campaignModel: Model<Campaign>) {}

  // Create a new campaign
  async create(campaignData: Partial<Campaign>): Promise<Campaign> {
    const campaign = new this.campaignModel({
      ...campaignData,
      totalContacts: campaignData.contacts?.length || 0,
    });
    return campaign.save();
  }

  // Find all campaigns
  async findAll(): Promise<Campaign[]> {
    return this.campaignModel.find().sort({ createdAt: -1 }).exec();
  }

  // Find campaigns by user ID with pagination
  async findByUserId(userId: string, page: number = 1, limit: number = 10): Promise<{
    campaigns: Campaign[];
    total: number;
    page: number;
    pages: number;
    limit: number;
  }> {
    const skip = (page - 1) * limit;
    const [campaigns, total] = await Promise.all([
      this.campaignModel.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.campaignModel.countDocuments({ userId }).exec(),
    ]);
    
    return {
      campaigns,
      total,
      page,
      pages: Math.ceil(total / limit),
      limit,
    };
  }

  // Find campaigns by user ID (all, no pagination) - for dropdowns etc
  async findAllByUserId(userId: string): Promise<Campaign[]> {
    return this.campaignModel.find({ userId }).sort({ createdAt: -1 }).exec();
  }

  // Find a single campaign by ID
  async findOne(id: string): Promise<Campaign | null> {
    return this.campaignModel.findById(id).exec();
  }

  // Update a campaign
  async update(id: string, updateData: Partial<Campaign>): Promise<Campaign | null> {
    // If contacts are being updated, recalculate totalContacts
    if (updateData.contacts) {
      updateData.totalContacts = updateData.contacts.length;
    }
    return this.campaignModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  // Delete a campaign
  async delete(id: string): Promise<Campaign | null> {
    return this.campaignModel.findByIdAndDelete(id).exec();
  }

  // Add contacts to a campaign
  async addContacts(campaignId: string, contacts: Partial<CampaignContact>[]): Promise<Campaign | null> {
    const campaign = await this.campaignModel.findById(campaignId).exec();
    if (!campaign) return null;

    const newContacts = contacts.map(contact => ({
      ...contact,
      callStatus: 'pending' as const,
    }));

    campaign.contacts.push(...newContacts as any);
    campaign.totalContacts = campaign.contacts.length;
    return campaign.save();
  }

  // Update a single contact in a campaign
  async updateContact(
    campaignId: string,
    contactId: string,
    contactData: Partial<CampaignContact>
  ): Promise<Campaign | null> {
    return this.campaignModel.findOneAndUpdate(
      { _id: campaignId, 'contacts._id': contactId },
      { $set: { 'contacts.$': { ...contactData, _id: contactId } } },
      { new: true }
    ).exec();
  }

  // Delete a contact from a campaign
  async deleteContact(campaignId: string, contactId: string): Promise<Campaign | null> {
    const campaign = await this.campaignModel.findByIdAndUpdate(
      campaignId,
      { $pull: { contacts: { _id: contactId } } },
      { new: true }
    ).exec();

    if (campaign) {
      campaign.totalContacts = campaign.contacts.length;
      await campaign.save();
    }
    return campaign;
  }

  // Get contacts for a campaign with pagination
  async getContacts(
    campaignId: string,
    page: number = 1,
    limit: number = 50
  ): Promise<{ contacts: CampaignContact[]; total: number; page: number; totalPages: number }> {
    const campaign = await this.campaignModel.findById(campaignId).exec();
    if (!campaign) {
      return { contacts: [], total: 0, page: 1, totalPages: 0 };
    }

    const total = campaign.contacts.length;
    const totalPages = Math.ceil(total / limit);
    const skip = (page - 1) * limit;
    const contacts = campaign.contacts.slice(skip, skip + limit);

    return { contacts, total, page, totalPages };
  }

  // Update campaign status
  async updateStatus(id: string, status: Campaign['status']): Promise<Campaign | null> {
    const updateData: Partial<Campaign> = { status };

    if (status === 'active' || status === 'scheduled') {
      updateData.startedAt = new Date();
    } else if (status === 'completed') {
      updateData.completedAt = new Date();
    }

    return this.campaignModel.findByIdAndUpdate(id, updateData, { new: true }).exec();
  }

  // Update contact call status
  async updateContactCallStatus(
    campaignId: string,
    contactId: string,
    callStatus: CampaignContact['callStatus'],
    callData?: { callId?: string; callDuration?: number; callNotes?: string }
  ): Promise<Campaign | null> {
    const updateFields: Record<string, any> = {
      'contacts.$.callStatus': callStatus,
      'contacts.$.calledAt': new Date(),
    };

    if (callData?.callId) updateFields['contacts.$.callId'] = callData.callId;
    if (callData?.callDuration) updateFields['contacts.$.callDuration'] = callData.callDuration;
    if (callData?.callNotes) updateFields['contacts.$.callNotes'] = callData.callNotes;

    const campaign = await this.campaignModel.findOneAndUpdate(
      { _id: campaignId, 'contacts._id': contactId },
      { $set: updateFields },
      { new: true }
    ).exec();

    // Update campaign statistics
    if (campaign) {
      const stats = this.calculateCampaignStats(campaign);
      await this.campaignModel.findByIdAndUpdate(campaignId, stats).exec();
    }

    return campaign;
  }

  // Calculate campaign statistics
  private calculateCampaignStats(campaign: Campaign) {
    let completedCalls = 0;
    let successfulCalls = 0;
    let failedCalls = 0;

    for (const contact of campaign.contacts) {
      if (contact.callStatus === 'completed') {
        completedCalls++;
        successfulCalls++;
      } else if (contact.callStatus === 'failed' || contact.callStatus === 'no-answer') {
        completedCalls++;
        failedCalls++;
      }
    }

    return { completedCalls, successfulCalls, failedCalls };
  }

  // Bulk import contacts
  async bulkImportContacts(
    campaignId: string,
    contacts: { name: string; phoneNumber: string }[]
  ): Promise<Campaign | null> {
    const normalizedContacts = contacts.map(contact => ({
      name: contact.name.trim(),
      phoneNumber: this.normalizePhoneNumber(contact.phoneNumber),
      callStatus: 'pending' as const,
    }));

    const campaign = await this.campaignModel.findById(campaignId).exec();
    if (!campaign) return null;

    campaign.contacts.push(...normalizedContacts as any);
    campaign.totalContacts = campaign.contacts.length;
    return campaign.save();
  }

  // Normalize phone number (ensure country code format)
  private normalizePhoneNumber(phone: string): string {
    // Remove all non-digit characters except +
    let normalized = phone.replace(/[^\d+]/g, '');
    
    // If it doesn't start with +, add it if there's no leading zero
    if (!normalized.startsWith('+') && !normalized.startsWith('0')) {
      normalized = '+' + normalized;
    }
    
    return normalized;
  }

  // Get campaign statistics
  async getCampaignStats(campaignId: string): Promise<{
    totalContacts: number;
    completedCalls: number;
    successfulCalls: number;
    failedCalls: number;
    pendingCalls: number;
    successRate: number;
  } | null> {
    const campaign = await this.campaignModel.findById(campaignId).exec();
    if (!campaign) return null;

    const pendingCalls = campaign.contacts.filter(c => c.callStatus === 'pending').length;
    const successRate = campaign.completedCalls > 0
      ? Math.round((campaign.successfulCalls / campaign.completedCalls) * 100)
      : 0;

    return {
      totalContacts: campaign.totalContacts,
      completedCalls: campaign.completedCalls,
      successfulCalls: campaign.successfulCalls,
      failedCalls: campaign.failedCalls,
      pendingCalls,
      successRate,
    };
  }
}
