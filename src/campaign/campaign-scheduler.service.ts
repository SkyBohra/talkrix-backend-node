import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Campaign, CampaignContact } from './campaign.schema';
import { CampaignService } from './campaign.service';
import { AgentService } from '../agent/agent.service';
import { UltravoxService } from '../agent/ultravox.service';
import { UserService } from '../user/user.service';
import { CallHistoryService } from '../call-history/call-history.service';
import { AppLogger } from '../app.logger';

// Track active calls per user (across all campaigns)
// User's maxConcurrentCalls applies to ALL campaigns combined
interface UserCallState {
  userId: string;
  activeCalls: number;
  maxConcurrentCalls: number; // From user.settings.maxConcurrentCalls
  isProcessing: boolean;
  activeCampaigns: Set<string>; // Campaign IDs currently being processed
}

@Injectable()
export class CampaignSchedulerService implements OnModuleInit, OnModuleDestroy {
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;
  private userCallStates: Map<string, UserCallState> = new Map();
  private readonly SCHEDULER_INTERVAL_MS = 30000; // Check every 30 seconds

  constructor(
    @InjectModel(Campaign.name) private campaignModel: Model<Campaign>,
    private readonly campaignService: CampaignService,
    private readonly agentService: AgentService,
    private readonly ultravoxService: UltravoxService,
    private readonly userService: UserService,
    private readonly callHistoryService: CallHistoryService,
    private readonly logger: AppLogger,
  ) {}

  onModuleInit() {
    this.startScheduler();
    this.logger.log('Campaign Scheduler Service started');
  }

  onModuleDestroy() {
    this.stopScheduler();
    this.logger.log('Campaign Scheduler Service stopped');
  }

  /**
   * Start the scheduler that checks for campaigns to run
   */
  private startScheduler() {
    // Check immediately on startup
    this.checkScheduledCampaigns();

    // Then check every interval
    this.schedulerInterval = setInterval(() => {
      this.checkScheduledCampaigns();
    }, this.SCHEDULER_INTERVAL_MS);
  }

  /**
   * Stop the scheduler
   */
  private stopScheduler() {
    if (this.schedulerInterval) {
      clearInterval(this.schedulerInterval);
      this.schedulerInterval = null;
    }
  }

  /**
   * Check for scheduled campaigns that need to start
   */
  private async checkScheduledCampaigns() {
    try {
      // Find all scheduled outbound campaigns
      const scheduledCampaigns = await this.campaignModel.find({
        status: 'scheduled',
        type: 'outbound',
        'schedule.scheduledDate': { $exists: true },
      }).exec();

      this.logger.log(`Scheduler check: Found ${scheduledCampaigns.length} scheduled outbound campaigns`);

      for (const campaign of scheduledCampaigns) {
        const shouldStart = this.shouldStartCampaign(campaign);
        this.logger.log(`Campaign "${campaign.name}": shouldStart=${shouldStart}`);
        
        if (shouldStart) {
          this.logger.log(`Starting scheduled campaign: ${campaign.name} (${campaign._id})`);
          await this.startCampaign(campaign);
        }
      }

      // Also process active campaigns (in case server restarted)
      const activeCampaigns = await this.campaignModel.find({
        status: 'active',
        type: 'outbound',
      }).exec();

      this.logger.log(`Scheduler check: Found ${activeCampaigns.length} active outbound campaigns`);

      // Check if any active campaign should stop (reached end time)
      for (const campaign of activeCampaigns) {
        if (this.shouldStopCampaign(campaign)) {
          this.logger.log(`Campaign "${campaign.name}" reached end time, completing campaign`);
          await this.completeCampaignDueToEndTime(campaign._id.toString());
        }
      }

      // Filter out campaigns that were just stopped
      const stillActiveCampaigns = activeCampaigns.filter(c => c.status === 'active');

      // Group campaigns by user
      const campaignsByUser = new Map<string, Campaign[]>();
      for (const campaign of stillActiveCampaigns) {
        const userId = campaign.userId;
        if (!campaignsByUser.has(userId)) {
          campaignsByUser.set(userId, []);
        }
        campaignsByUser.get(userId)!.push(campaign);
      }

      // Process each user's campaigns
      for (const [userId, userCampaigns] of campaignsByUser) {
        // Initialize user state if not exists
        if (!this.userCallStates.has(userId)) {
          await this.initializeUserState(userId, userCampaigns);
        }
        // Process calls for this user's campaigns
        await this.processUserCalls(userId);
      }
    } catch (err) {
      this.logger.error('Error checking scheduled campaigns:', err?.message || err);
    }
  }

  /**
   * Check if a campaign should start based on its schedule
   * - Starts EXACTLY at scheduled start time (not before)
   * - Cannot start after end time (if specified)
   */
  private shouldStartCampaign(campaign: Campaign): boolean {
    if (!campaign.schedule?.scheduledDate || !campaign.schedule?.scheduledTime) {
      this.logger.warn(`Campaign "${campaign.name}": Missing schedule date or time`);
      return false;
    }

    const timezone = campaign.schedule.timezone || 'UTC';
    const scheduledDate = new Date(campaign.schedule.scheduledDate);
    const scheduledTime = campaign.schedule.scheduledTime; // HH:mm format (start time)
    const endTime = campaign.schedule.endTime; // HH:mm format (optional end time)

    // Get current time in the campaign's timezone
    const nowInTimezone = this.getCurrentTimeInTimezone(timezone);

    // Extract date parts from scheduledDate
    const year = scheduledDate.getUTCFullYear();
    const month = scheduledDate.getUTCMonth();
    const day = scheduledDate.getUTCDate();

    // Parse start time
    const [startHours, startMinutes] = scheduledTime.split(':').map(Number);
    const scheduledDateTime = new Date(year, month, day, startHours, startMinutes, 0, 0);

    // Calculate time difference from start time
    const timeDiffFromStart = nowInTimezone.getTime() - scheduledDateTime.getTime();

    // Check end time if specified
    let isBeforeEndTime = true;
    let endDateTime: Date | null = null;
    
    if (endTime) {
      const [endHours, endMinutes] = endTime.split(':').map(Number);
      endDateTime = new Date(year, month, day, endHours, endMinutes, 0, 0);
      
      // Handle case where end time is past midnight (next day)
      if (endDateTime.getTime() < scheduledDateTime.getTime()) {
        endDateTime.setDate(endDateTime.getDate() + 1);
      }
      
      isBeforeEndTime = nowInTimezone.getTime() < endDateTime.getTime();
    }

    // Log for debugging
    this.logger.log(
      `Campaign "${campaign.name}" schedule check: ` +
      `timezone=${timezone}, ` +
      `startTime=${scheduledTime}, ` +
      `endTime=${endTime || 'not set'}, ` +
      `nowInTz=${nowInTimezone.getHours().toString().padStart(2, '0')}:${nowInTimezone.getMinutes().toString().padStart(2, '0')}, ` +
      `diffFromStart=${Math.round(timeDiffFromStart / 1000)}s, ` +
      `isBeforeEndTime=${isBeforeEndTime}`
    );

    // Campaign can start:
    // - EXACTLY at or after scheduled start time (timeDiff >= 0)
    // - Must be BEFORE end time (if specified)
    const hasReachedStartTime = timeDiffFromStart >= 0; // Start exactly at scheduled time
    const withinStartWindow = timeDiffFromStart < 30 * 60 * 1000; // Within 30 min of start (for server restarts)
    
    return hasReachedStartTime && withinStartWindow && isBeforeEndTime;
  }

  /**
   * Check if an active campaign should stop based on end time
   */
  private shouldStopCampaign(campaign: Campaign): boolean {
    if (!campaign.schedule?.endTime) {
      return false; // No end time set, don't stop automatically
    }

    const timezone = campaign.schedule.timezone || 'UTC';
    const scheduledDate = new Date(campaign.schedule.scheduledDate);
    const scheduledTime = campaign.schedule.scheduledTime;
    const endTime = campaign.schedule.endTime;

    const nowInTimezone = this.getCurrentTimeInTimezone(timezone);

    const year = scheduledDate.getUTCFullYear();
    const month = scheduledDate.getUTCMonth();
    const day = scheduledDate.getUTCDate();

    // Parse times
    const [startHours, startMinutes] = scheduledTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);

    const scheduledDateTime = new Date(year, month, day, startHours, startMinutes, 0, 0);
    let endDateTime = new Date(year, month, day, endHours, endMinutes, 0, 0);

    // Handle case where end time is past midnight
    if (endDateTime.getTime() < scheduledDateTime.getTime()) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }

    const shouldStop = nowInTimezone.getTime() >= endDateTime.getTime();

    if (shouldStop) {
      this.logger.log(
        `Campaign "${campaign.name}" reached end time: ` +
        `endTime=${endTime}, nowInTz=${nowInTimezone.getHours().toString().padStart(2, '0')}:${nowInTimezone.getMinutes().toString().padStart(2, '0')}`
      );
    }

    return shouldStop;
  }

  /**
   * Get current time in a specific timezone as a comparable Date object
   * Returns a Date where getHours(), getMinutes() etc. give the time in that timezone
   */
  private getCurrentTimeInTimezone(timezone: string): Date {
    try {
      const now = new Date();

      // Format current time in the target timezone
      const options: Intl.DateTimeFormatOptions = {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      };

      // Use en-CA locale for YYYY-MM-DD format
      const parts = new Intl.DateTimeFormat('en-CA', options).formatToParts(now);

      const getPart = (type: string) => {
        const part = parts.find(p => p.type === type);
        return part ? parseInt(part.value, 10) : 0;
      };

      const year = getPart('year');
      const month = getPart('month') - 1; // JavaScript months are 0-indexed
      const day = getPart('day');
      const hour = getPart('hour');
      const minute = getPart('minute');
      const second = getPart('second');

      // Return a new Date with these values
      // This Date object's getHours(), getDate() etc. will return the timezone's local values
      return new Date(year, month, day, hour, minute, second);
    } catch (err) {
      this.logger.warn(`Invalid timezone "${timezone}", using server time: ${err?.message}`);
      return new Date();
    }
  }

  /**
   * Initialize user call state
   * maxConcurrentCalls from user settings applies to ALL campaigns combined
   */
  private async initializeUserState(userId: string, campaigns: Campaign[]): Promise<void> {
    const user = await this.userService.findById(userId);
    if (!user) {
      this.logger.warn(`User ${userId} not found, cannot initialize call state`);
      return;
    }

    // Count currently in-progress calls across all user's campaigns
    let totalActiveCalls = 0;
    const activeCampaignIds = new Set<string>();

    for (const campaign of campaigns) {
      const inProgressCalls = campaign.contacts.filter(c => c.callStatus === 'in-progress').length;
      totalActiveCalls += inProgressCalls;
      if (campaign.status === 'active') {
        activeCampaignIds.add(campaign._id.toString());
      }
    }

    const state: UserCallState = {
      userId,
      activeCalls: totalActiveCalls,
      maxConcurrentCalls: user.settings?.maxConcurrentCalls || 1,
      isProcessing: false,
      activeCampaigns: activeCampaignIds,
    };

    this.userCallStates.set(userId, state);
    this.logger.log(`Initialized user state: ${userId}, maxConcurrentCalls: ${state.maxConcurrentCalls}, activeCalls: ${state.activeCalls}, campaigns: ${activeCampaignIds.size}`);
  }

  /**
   * Start a campaign
   */
  async startCampaign(campaign: Campaign): Promise<void> {
    try {
      const userId = campaign.userId;

      // Update campaign status to active
      await this.campaignService.updateStatus(campaign._id.toString(), 'active');

      // Get or initialize user state
      let state = this.userCallStates.get(userId);
      if (!state) {
        const userCampaigns = await this.campaignModel.find({ userId, status: 'active' }).exec();
        await this.initializeUserState(userId, userCampaigns);
        state = this.userCallStates.get(userId);
      }

      if (state) {
        state.activeCampaigns.add(campaign._id.toString());
      }

      // Start processing calls
      await this.processUserCalls(userId);

      this.logger.log(`Campaign ${campaign.name} started successfully`);
    } catch (err) {
      this.logger.error(`Error starting campaign ${campaign._id}:`, err?.message || err);
      await this.campaignService.updateStatus(campaign._id.toString(), 'scheduled');
    }
  }

  /**
   * Process calls for a user (across all their active campaigns)
   * Respects user's maxConcurrentCalls limit across ALL campaigns combined
   */
  async processUserCalls(userId: string): Promise<void> {
    const state = this.userCallStates.get(userId);
    if (!state) {
      this.logger.warn(`User state not found for ${userId}`);
      return;
    }

    // Prevent concurrent processing
    if (state.isProcessing) {
      return;
    }

    state.isProcessing = true;

    try {
      // Refresh user settings (in case maxConcurrentCalls changed)
      const user = await this.userService.findById(userId);
      if (user?.settings?.maxConcurrentCalls) {
        state.maxConcurrentCalls = user.settings.maxConcurrentCalls;
      }

      // Calculate available slots (user's total limit minus all active calls)
      const availableSlots = state.maxConcurrentCalls - state.activeCalls;

      if (availableSlots <= 0) {
        this.logger.log(`User ${userId}: No available slots (${state.activeCalls}/${state.maxConcurrentCalls} concurrent calls)`);
        return;
      }

      // Get all active campaigns for this user
      const activeCampaigns = await this.campaignModel.find({
        userId,
        status: 'active',
        type: 'outbound',
      }).exec();

      if (activeCampaigns.length === 0) {
        this.logger.log(`User ${userId}: No active campaigns`);
        return;
      }

      // Collect all pending contacts from all campaigns (round-robin for fairness)
      const pendingContactsWithCampaign: Array<{
        campaign: Campaign;
        contact: CampaignContact;
      }> = [];

      // Round-robin: take one contact from each campaign at a time
      let hasMore = true;
      let index = 0;
      while (hasMore && pendingContactsWithCampaign.length < availableSlots) {
        hasMore = false;
        for (const campaign of activeCampaigns) {
          const pendingContacts = campaign.contacts.filter(c => c.callStatus === 'pending');
          if (index < pendingContacts.length) {
            pendingContactsWithCampaign.push({ campaign, contact: pendingContacts[index] });
            hasMore = true;
            if (pendingContactsWithCampaign.length >= availableSlots) break;
          }
        }
        index++;
      }

      if (pendingContactsWithCampaign.length === 0) {
        // Check if all campaigns are done
        await this.checkAndCompleteCampaigns(activeCampaigns);
        return;
      }

      this.logger.log(`User ${userId}: Processing ${pendingContactsWithCampaign.length} calls (${state.activeCalls}/${state.maxConcurrentCalls} active)`);

      // Initiate calls
      for (const { campaign, contact } of pendingContactsWithCampaign) {
        await this.initiateCall(campaign, contact, state);
      }
    } catch (err) {
      this.logger.error(`Error processing calls for user ${userId}:`, err?.message || err);
    } finally {
      state.isProcessing = false;
    }
  }

  /**
   * Check if campaigns should be marked as completed
   */
  private async checkAndCompleteCampaigns(campaigns: Campaign[]): Promise<void> {
    for (const campaign of campaigns) {
      const pendingContacts = campaign.contacts.filter(c => c.callStatus === 'pending');
      const inProgressContacts = campaign.contacts.filter(c => c.callStatus === 'in-progress');

      if (pendingContacts.length === 0 && inProgressContacts.length === 0) {
        await this.completeCampaign(campaign._id.toString(), campaign.userId);
      }
    }
  }

  /**
   * Initiate a call to a contact
   */
  private async initiateCall(
    campaign: Campaign,
    contact: CampaignContact,
    userState: UserCallState
  ): Promise<void> {
    const campaignId = campaign._id.toString();
    const contactId = contact._id?.toString();

    if (!contactId) {
      this.logger.warn(`Contact has no ID in campaign ${campaignId}`);
      return;
    }

    try {
      // Validate outbound configuration
      if (!campaign.outboundProvider || !campaign.outboundPhoneNumber) {
        this.logger.error(`Campaign ${campaignId} missing outbound configuration`);
        await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
          callNotes: 'Missing outbound phone configuration',
        });
        return;
      }

      // Get user telephony settings
      const user = await this.userService.findById(campaign.userId);
      if (!user || !user.settings?.telephony) {
        this.logger.error(`User ${campaign.userId} telephony settings not found`);
        await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
          callNotes: 'User telephony settings not configured',
        });
        return;
      }

      // Get agent
      const agent = await this.agentService.findOne(campaign.agentId);
      if (!agent) {
        this.logger.error(`Agent ${campaign.agentId} not found for campaign ${campaignId}`);
        await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
          callNotes: 'Agent not found',
        });
        return;
      }

      const telephony = user.settings.telephony;

      // Update contact status to in-progress BEFORE incrementing counter
      await this.campaignService.updateContactCallStatus(campaignId, contactId, 'in-progress');

      // Increment active calls count for user (across all campaigns)
      userState.activeCalls++;

      // Create the outbound call
      const callResult = await this.ultravoxService.createOutboundCallWithMedium(
        agent.talkrixAgentId,
        {
          provider: campaign.outboundProvider,
          fromPhoneNumber: campaign.outboundPhoneNumber,
          toPhoneNumber: contact.phoneNumber,
          maxDuration: '600s',
          recordingEnabled: true,
          twilioAccountSid: telephony.twilioAccountSid,
          twilioAuthToken: telephony.twilioAuthToken,
          plivoAuthId: telephony.plivoAuthId,
          plivoAuthToken: telephony.plivoAuthToken,
          telnyxApiKey: telephony.telnyxApiKey,
          telnyxConnectionId: telephony.telnyxConnectionId,
        }
      );

      if (callResult.statusCode === 201 && callResult.data) {
        // Create call history record
        await this.callHistoryService.create({
          agentId: campaign.agentId,
          userId: campaign.userId,
          talkrixCallId: callResult.data.callId,
          callType: 'outbound',
          agentName: agent.name,
          customerName: contact.name,
          customerPhone: contact.phoneNumber,
          recordingEnabled: true,
          joinUrl: callResult.data.joinUrl,
          callData: callResult.data,
          metadata: {
            campaignId: campaign._id.toString(),
            campaignName: campaign.name,
            provider: campaign.outboundProvider,
            fromPhoneNumber: campaign.outboundPhoneNumber,
          },
        });

        // Update contact with call ID
        await this.campaignService.updateContactCallStatus(
          campaignId,
          contactId,
          'in-progress',
          { callId: callResult.data.callId }
        );

        this.logger.log(`Call initiated for ${contact.name} (${contact.phoneNumber}) in campaign ${campaign.name}`);
      } else {
        // Call creation failed - decrement counter and mark as failed
        userState.activeCalls = Math.max(0, userState.activeCalls - 1);

        await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
          callNotes: callResult.message || 'Failed to create call',
        });

        this.logger.error(`Failed to create call for ${contact.name}: ${callResult.message}`);
      }
    } catch (err) {
      this.logger.error(`Error initiating call for ${contact.name}:`, err?.message || err);

      // Decrement active calls count on error
      userState.activeCalls = Math.max(0, userState.activeCalls - 1);

      await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
        callNotes: err?.message || 'Unknown error',
      });
    }
  }

  /**
   * Handle call ended event - triggered by webhook
   * This will decrement user's active calls and trigger next call
   */
  async onCallEnded(campaignId: string, callId: string): Promise<void> {
    try {
      // Get campaign to find user
      const campaign = await this.campaignService.findOne(campaignId);
      if (!campaign) {
        this.logger.warn(`Campaign ${campaignId} not found for call ended event`);
        return;
      }

      const userId = campaign.userId;
      let state = this.userCallStates.get(userId);

      if (state) {
        // Decrement active calls for user
        state.activeCalls = Math.max(0, state.activeCalls - 1);

        this.logger.log(`Call ended for user ${userId}. Active calls: ${state.activeCalls}/${state.maxConcurrentCalls}`);

        // Trigger next calls after a short delay
        setTimeout(() => {
          this.processUserCalls(userId).catch(err => {
            this.logger.error(`Error processing next calls after call ended:`, err?.message || err);
          });
        }, 1000);
      } else {
        // State might not exist if server restarted, reinitialize
        const userCampaigns = await this.campaignModel.find({ userId, status: 'active' }).exec();
        if (userCampaigns.length > 0) {
          await this.initializeUserState(userId, userCampaigns);
          await this.processUserCalls(userId);
        }
      }
    } catch (err) {
      this.logger.error(`Error handling call ended:`, err?.message || err);
    }
  }

  /**
   * Mark campaign as completed
   */
  private async completeCampaign(campaignId: string, userId: string): Promise<void> {
    try {
      await this.campaignService.updateStatus(campaignId, 'completed');

      const state = this.userCallStates.get(userId);
      if (state) {
        state.activeCampaigns.delete(campaignId);
      }

      this.logger.log(`Campaign ${campaignId} completed`);
    } catch (err) {
      this.logger.error(`Error completing campaign ${campaignId}:`, err?.message || err);
    }
  }

  /**
   * Complete a campaign due to reaching end time
   * Mark remaining pending contacts as 'not-called' or keep as pending
   */
  private async completeCampaignDueToEndTime(campaignId: string): Promise<void> {
    try {
      const campaign = await this.campaignService.findOne(campaignId);
      if (!campaign) return;

      // Update campaign status to completed
      await this.campaignService.updateStatus(campaignId, 'completed');

      // Remove from user state
      const state = this.userCallStates.get(campaign.userId);
      if (state) {
        state.activeCampaigns.delete(campaignId);
      }

      // Count remaining pending contacts
      const pendingCount = campaign.contacts.filter(c => c.callStatus === 'pending').length;

      this.logger.log(
        `Campaign "${campaign.name}" completed due to end time. ` +
        `${pendingCount} contacts were not called.`
      );
    } catch (err) {
      this.logger.error(`Error completing campaign due to end time:`, err?.message || err);
    }
  }

  /**
   * Pause a campaign - stop processing new calls for this campaign
   */
  async pauseCampaign(campaignId: string): Promise<void> {
    const campaign = await this.campaignService.findOne(campaignId);
    if (!campaign) return;

    await this.campaignService.updateStatus(campaignId, 'paused');

    const state = this.userCallStates.get(campaign.userId);
    if (state) {
      state.activeCampaigns.delete(campaignId);
    }

    this.logger.log(`Campaign ${campaignId} paused`);
  }

  /**
   * Resume a paused campaign
   */
  async resumeCampaign(campaignId: string): Promise<void> {
    const campaign = await this.campaignService.findOne(campaignId);
    if (!campaign || campaign.status !== 'paused') return;

    await this.campaignService.updateStatus(campaignId, 'active');

    let state = this.userCallStates.get(campaign.userId);
    if (!state) {
      const userCampaigns = await this.campaignModel.find({
        userId: campaign.userId,
        status: 'active'
      }).exec();
      await this.initializeUserState(campaign.userId, [...userCampaigns, campaign]);
      state = this.userCallStates.get(campaign.userId);
    }

    if (state) {
      state.activeCampaigns.add(campaignId);
    }

    // Process calls
    await this.processUserCalls(campaign.userId);

    this.logger.log(`Campaign ${campaignId} resumed`);
  }

  /**
   * Manually start a scheduled campaign immediately
   */
  async startCampaignNow(campaignId: string): Promise<void> {
    const campaign = await this.campaignService.findOne(campaignId);
    if (campaign && (campaign.status === 'scheduled' || campaign.status === 'draft')) {
      await this.startCampaign(campaign);
    }
  }

  /**
   * Get current user call state
   */
  getUserCallState(userId: string): UserCallState | undefined {
    return this.userCallStates.get(userId);
  }

  /**
   * Get campaign state (derived from user state)
   */
  getCampaignState(campaignId: string): { activeCalls: number; maxConcurrentCalls: number; isActive: boolean } | undefined {
    // Find the campaign to get userId
    for (const [, state] of this.userCallStates) {
      if (state.activeCampaigns.has(campaignId)) {
        return {
          activeCalls: state.activeCalls,
          maxConcurrentCalls: state.maxConcurrentCalls,
          isActive: true,
        };
      }
    }
    return undefined;
  }
}
