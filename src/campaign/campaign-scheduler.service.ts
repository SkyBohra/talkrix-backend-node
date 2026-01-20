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

// Track individual active calls for timeout detection
interface ActiveCallInfo {
  callId: string;
  contactId: string;
  campaignId: string;
  userId: string;
  startedAt: Date;
}

@Injectable()
export class CampaignSchedulerService implements OnModuleInit, OnModuleDestroy {
  private schedulerInterval: ReturnType<typeof setInterval> | null = null;
  private userCallStates: Map<string, UserCallState> = new Map();
  private activeCallsTracker: Map<string, ActiveCallInfo> = new Map(); // Track calls by callId for timeout detection
  private readonly SCHEDULER_INTERVAL_MS = 30000; // Check every 30 seconds
  private readonly CALL_TIMEOUT_MS = 15 * 60 * 1000; // 15 minutes timeout for stale calls

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
      // First, check and cleanup stale calls that haven't received disconnection webhook
      await this.checkAndCleanupStaleCalls();

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

      // Check for paused-time-window campaigns that can be resumed
      // These are campaigns that have pending contacts and are within their time window
      const pausedWindowCampaigns = await this.campaignModel.find({
        status: 'paused-time-window',
        type: 'outbound',
        'schedule.scheduledDate': { $exists: true },
      }).exec();

      this.logger.log(`Scheduler check: Found ${pausedWindowCampaigns.length} paused-time-window campaigns`);

      for (const campaign of pausedWindowCampaigns) {
        const canResume = this.canResumeCampaignInWindow(campaign);
        const hasPendingContacts = campaign.contacts.some(c => c.callStatus === 'pending');
        
        this.logger.log(`Paused campaign "${campaign.name}": canResume=${canResume}, hasPendingContacts=${hasPendingContacts}`);
        
        if (canResume && hasPendingContacts) {
          this.logger.log(`Resuming paused-time-window campaign: ${campaign.name} (${campaign._id})`);
          await this.resumePausedWindowCampaign(campaign);
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
   * Uses atomic operations to prevent duplicate calls
   */
  async processUserCalls(userId: string): Promise<void> {
    const state = this.userCallStates.get(userId);
    if (!state) {
      this.logger.warn(`User state not found for ${userId}`);
      return;
    }

    // Prevent concurrent processing for this user
    if (state.isProcessing) {
      this.logger.log(`User ${userId}: Already processing, skipping`);
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

      // Get all active campaign IDs for this user
      const activeCampaigns = await this.campaignModel.find({
        userId,
        status: 'active',
        type: 'outbound',
      }).select('_id name').exec();

      if (activeCampaigns.length === 0) {
        this.logger.log(`User ${userId}: No active campaigns`);
        return;
      }

      this.logger.log(`User ${userId}: Found ${activeCampaigns.length} active campaigns, ${availableSlots} slots available`);

      // Use atomic claim to get contacts - round robin across campaigns
      // This prevents race conditions where same contact is picked twice
      let claimsProcessed = 0;
      let campaignIndex = 0;
      const maxAttempts = availableSlots * activeCampaigns.length; // Prevent infinite loop
      let attempts = 0;

      while (claimsProcessed < availableSlots && attempts < maxAttempts) {
        attempts++;
        const campaign = activeCampaigns[campaignIndex % activeCampaigns.length];
        campaignIndex++;

        // Atomically claim a pending contact from this campaign
        const claimed = await this.campaignService.claimPendingContact(campaign._id.toString());
        
        if (claimed) {
          claimsProcessed++;
          this.logger.log(
            `User ${userId}: Claimed contact ${claimed.contact.name} (${claimed.contact.phoneNumber}) ` +
            `from campaign ${campaign.name}, slot ${claimsProcessed}/${availableSlots}`
          );

          // Initiate the call (contact is already marked as in-progress atomically)
          await this.initiateClaimedCall(claimed.campaign, claimed.contact, claimed.contactId, state);
        }

        // If we've gone through all campaigns once without finding pending contacts, break
        if (campaignIndex >= activeCampaigns.length && claimsProcessed === 0) {
          break;
        }
      }

      if (claimsProcessed === 0) {
        // No pending contacts found, check if campaigns should be completed
        const fullCampaigns = await this.campaignModel.find({
          userId,
          status: 'active',
          type: 'outbound',
        }).exec();
        await this.checkAndCompleteCampaigns(fullCampaigns);
      } else {
        this.logger.log(`User ${userId}: Initiated ${claimsProcessed} calls`);
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
      // Re-fetch to get latest status
      const freshCampaign = await this.campaignModel.findById(campaign._id).exec();
      if (!freshCampaign) continue;

      const pendingContacts = freshCampaign.contacts.filter(c => c.callStatus === 'pending');
      const inProgressContacts = freshCampaign.contacts.filter(c => c.callStatus === 'in-progress');

      if (pendingContacts.length === 0 && inProgressContacts.length === 0) {
        await this.completeCampaign(campaign._id.toString(), campaign.userId);
      }
    }
  }

  /**
   * Initiate a call for an already-claimed contact (atomically marked as in-progress)
   * This method assumes contact is already in 'in-progress' status from atomic claim
   */
  private async initiateClaimedCall(
    campaign: Campaign,
    contact: CampaignContact,
    contactId: string,
    userState: UserCallState
  ): Promise<void> {
    const campaignId = campaign._id.toString();

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

      // Contact is already marked as in-progress from atomic claim
      // Increment active calls count for user (across all campaigns)
      userState.activeCalls++;

      // Track this call for timeout detection (will be updated with actual callId after creation)
      const tempTrackingId = `pending_${campaignId}_${contactId}`;
      this.activeCallsTracker.set(tempTrackingId, {
        callId: tempTrackingId,
        contactId,
        campaignId,
        userId: campaign.userId,
        startedAt: new Date(),
      });

      // Create the outbound call to get actual Ultravox callId
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
          // Pass tracking info for webhook callback
          campaignId: campaignId,
          contactId: contactId,
        }
      );

      if (callResult.statusCode === 201 && callResult.data) {
        const ultravoxCallId = callResult.data.callId;
        
        // Remove temporary tracking and add with actual callId
        this.activeCallsTracker.delete(tempTrackingId);
        this.activeCallsTracker.set(ultravoxCallId, {
          callId: ultravoxCallId,
          contactId,
          campaignId,
          userId: campaign.userId,
          startedAt: new Date(),
        });

        // Create call history with actual Ultravox callId
        const callHistory = await this.callHistoryService.create({
          agentId: campaign.agentId,
          userId: campaign.userId,
          talkrixCallId: ultravoxCallId,
          callType: 'outbound',
          agentName: agent.name,
          customerName: contact.name,
          customerPhone: contact.phoneNumber,
          recordingEnabled: true,
          joinUrl: callResult.data.joinUrl,
          status: 'in-progress',
          callData: callResult.data,
          metadata: {
            campaignId: campaign._id.toString(),
            campaignName: campaign.name,
            contactId: contactId,
            provider: campaign.outboundProvider,
            fromPhoneNumber: campaign.outboundPhoneNumber,
          },
        });

        // Update contact with call ID and callHistoryId
        await this.campaignService.updateContactCallStatus(
          campaignId,
          contactId,
          'in-progress',
          { 
            callId: ultravoxCallId,
            callHistoryId: callHistory._id.toString(),
          }
        );

        this.logger.log(`Call initiated for ${contact.name} (${contact.phoneNumber}) in campaign ${campaign.name}, callId: ${ultravoxCallId}`);
      } else {
        // Call creation failed - decrement counter, remove tracking, and mark as failed
        userState.activeCalls = Math.max(0, userState.activeCalls - 1);
        this.activeCallsTracker.delete(tempTrackingId);
        
        // Mark contact as failed
        await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
          callNotes: callResult.message || 'Failed to create call',
        });

        this.logger.error(`Failed to create call for ${contact.name}: ${callResult.message}`);
      }
    } catch (err) {
      this.logger.error(`Error initiating call for ${contact.name}:`, err?.message || err);

      // Decrement active calls count on error and remove tracking
      userState.activeCalls = Math.max(0, userState.activeCalls - 1);
      this.activeCallsTracker.delete(`pending_${campaignId}_${contactId}`);

      await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
        callNotes: err?.message || 'Unknown error',
      });
    }
  }

  /**
   * Initiate a call to a contact (DEPRECATED - use initiateClaimedCall instead)
   * Kept for backward compatibility with manual campaign operations
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

      // Update contact status to in-progress FIRST - this marks the contact as "being called"
      // This ensures the contact won't be picked up again (only pending contacts are selected)
      await this.campaignService.updateContactCallStatus(campaignId, contactId, 'in-progress');

      // Increment active calls count for user (across all campaigns)
      userState.activeCalls++;

      // Track this call for timeout detection (will be updated with actual callId after creation)
      const tempTrackingId = `pending_${campaignId}_${contactId}`;
      this.activeCallsTracker.set(tempTrackingId, {
        callId: tempTrackingId,
        contactId,
        campaignId,
        userId: campaign.userId,
        startedAt: new Date(),
      });

      // FIRST: Create the outbound call to get actual Ultravox callId
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
          // Pass tracking info for webhook callback (callHistoryId will be looked up by campaignId+contactId)
          campaignId: campaignId,
          contactId: contactId,
        }
      );

      if (callResult.statusCode === 201 && callResult.data) {
        const ultravoxCallId = callResult.data.callId;
        
        // Remove temporary tracking and add with actual callId
        this.activeCallsTracker.delete(tempTrackingId);
        this.activeCallsTracker.set(ultravoxCallId, {
          callId: ultravoxCallId,
          contactId,
          campaignId,
          userId: campaign.userId,
          startedAt: new Date(),
        });

        // THEN: Create call history with actual Ultravox callId
        const callHistory = await this.callHistoryService.create({
          agentId: campaign.agentId,
          userId: campaign.userId,
          talkrixCallId: ultravoxCallId, // Actual Ultravox call ID
          callType: 'outbound',
          agentName: agent.name,
          customerName: contact.name,
          customerPhone: contact.phoneNumber,
          recordingEnabled: true,
          joinUrl: callResult.data.joinUrl,
          status: 'in-progress',
          callData: callResult.data,
          metadata: {
            campaignId: campaign._id.toString(),
            campaignName: campaign.name,
            contactId: contactId,
            provider: campaign.outboundProvider,
            fromPhoneNumber: campaign.outboundPhoneNumber,
          },
        });

        // Update contact with call ID and callHistoryId
        await this.campaignService.updateContactCallStatus(
          campaignId,
          contactId,
          'in-progress',
          { 
            callId: ultravoxCallId,
            callHistoryId: callHistory._id.toString(),
          }
        );

        this.logger.log(`Call initiated for ${contact.name} (${contact.phoneNumber}) in campaign ${campaign.name}, callId: ${ultravoxCallId}`);
      } else {
        // Call creation failed - decrement counter, remove tracking, and mark as failed
        userState.activeCalls = Math.max(0, userState.activeCalls - 1);
        this.activeCallsTracker.delete(tempTrackingId);
        
        // Mark contact as failed (not in-progress) - won't be retried
        await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
          callNotes: callResult.message || 'Failed to create call',
        });

        this.logger.error(`Failed to create call for ${contact.name}: ${callResult.message}`);
      }
    } catch (err) {
      this.logger.error(`Error initiating call for ${contact.name}:`, err?.message || err);

      // Decrement active calls count on error and remove tracking
      userState.activeCalls = Math.max(0, userState.activeCalls - 1);
      this.activeCallsTracker.delete(`pending_${campaignId}_${contactId}`);

      await this.campaignService.updateContactCallStatus(campaignId, contactId, 'failed', {
        callNotes: err?.message || 'Unknown error',
      });
    }
  }

  /**
   * Check and cleanup stale calls that have been in-progress for more than 10 minutes
   * This handles cases where disconnection webhook is not received
   */
  private async checkAndCleanupStaleCalls(): Promise<void> {
    const now = new Date();
    const staleCalls: ActiveCallInfo[] = [];

    // Find all calls that have exceeded the timeout
    for (const [callId, callInfo] of this.activeCallsTracker) {
      const elapsedMs = now.getTime() - callInfo.startedAt.getTime();
      if (elapsedMs >= this.CALL_TIMEOUT_MS) {
        staleCalls.push(callInfo);
      }
    }

    if (staleCalls.length === 0) {
      return;
    }

    this.logger.warn(`Found ${staleCalls.length} stale calls (>10 min without disconnection), cleaning up...`);

    for (const callInfo of staleCalls) {
      try {
        // Remove from tracker
        this.activeCallsTracker.delete(callInfo.callId);

        // Get user state and decrement active calls
        const state = this.userCallStates.get(callInfo.userId);
        if (state) {
          state.activeCalls = Math.max(0, state.activeCalls - 1);
          this.logger.log(
            `Released stale call resource for user ${callInfo.userId}. ` +
            `Active calls: ${state.activeCalls}/${state.maxConcurrentCalls}`
          );
        }

        // Update contact status to failed with timeout reason
        await this.campaignService.updateContactCallStatus(
          callInfo.campaignId,
          callInfo.contactId,
          'failed',
          {
            callNotes: 'Call timed out - no disconnection received after 10 minutes',
          }
        );

        this.logger.log(
          `Cleaned up stale call: callId=${callInfo.callId}, campaignId=${callInfo.campaignId}, ` +
          `contactId=${callInfo.contactId}, elapsed=${Math.round((now.getTime() - callInfo.startedAt.getTime()) / 1000 / 60)} minutes`
        );

        // Trigger next call processing for this user
        if (state) {
          setTimeout(() => {
            this.processUserCalls(callInfo.userId).catch(err => {
              this.logger.error(`Error processing next calls after stale cleanup:`, err?.message || err);
            });
          }, 1000);
        }
      } catch (err) {
        this.logger.error(`Error cleaning up stale call ${callInfo.callId}:`, err?.message || err);
      }
    }
  }

  /**
   * Handle call ended event - triggered by webhook
   * This will decrement user's active calls, check if campaign is complete, and trigger next call
   */
  async onCallEnded(campaignId: string, callId: string): Promise<void> {
    try {
      // Remove call from tracker
      this.activeCallsTracker.delete(callId);

      // Get campaign to find user and check completion
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
      }

      // Check if all contacts have been called (no pending, no in-progress)
      const pendingContacts = campaign.contacts.filter(c => c.callStatus === 'pending');
      const inProgressContacts = campaign.contacts.filter(c => c.callStatus === 'in-progress');

      if (pendingContacts.length === 0 && inProgressContacts.length === 0) {
        // All contacts have been called - mark campaign as completed
        this.logger.log(`Campaign ${campaign.name} - all contacts called. Marking as completed.`);
        await this.completeCampaign(campaignId, userId);
        return; // No need to process more calls for this campaign
      }

      // If there are still pending contacts, trigger next calls
      if (state) {
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
      // Get campaign to calculate final stats
      const campaign = await this.campaignService.findOne(campaignId);
      if (campaign) {
        const completedCount = campaign.contacts.filter(c => c.callStatus === 'completed').length;
        const failedCount = campaign.contacts.filter(c => c.callStatus === 'failed' || c.callStatus === 'no-answer').length;
        
        // Update campaign with final stats and completed status
        await this.campaignModel.findByIdAndUpdate(campaignId, {
          status: 'completed',
          completedAt: new Date(),
          completedCalls: completedCount + failedCount, // Total calls made
          successfulCalls: completedCount,
          failedCalls: failedCount,
        }).exec();

        this.logger.log(
          `Campaign "${campaign.name}" completed. ` +
          `Total: ${campaign.contacts.length}, Successful: ${completedCount}, Failed: ${failedCount}`
        );
      } else {
        await this.campaignService.updateStatus(campaignId, 'completed');
      }

      const state = this.userCallStates.get(userId);
      if (state) {
        state.activeCampaigns.delete(campaignId);
      }
    } catch (err) {
      this.logger.error(`Error completing campaign ${campaignId}:`, err?.message || err);
    }
  }

  /**
   * Complete a campaign due to reaching end time
   * Mark as 'paused-time-window' if there are pending contacts (can be resumed next day)
   * Mark as 'completed' if all contacts have been processed
   */
  private async completeCampaignDueToEndTime(campaignId: string): Promise<void> {
    try {
      const campaign = await this.campaignService.findOne(campaignId);
      if (!campaign) return;

      // Count remaining pending contacts
      const pendingCount = campaign.contacts.filter(c => c.callStatus === 'pending').length;

      // Remove from user state
      const state = this.userCallStates.get(campaign.userId);
      if (state) {
        state.activeCampaigns.delete(campaignId);
      }

      if (pendingCount > 0) {
        // If there are pending contacts, mark as 'paused-time-window'
        // This allows the campaign to be resumed in the same time window on subsequent days
        await this.campaignModel.findByIdAndUpdate(campaignId, {
          status: 'paused-time-window',
          pausedReason: 'end-time-reached',
          lastProcessedAt: new Date(),
        }).exec();

        this.logger.log(
          `Campaign "${campaign.name}" paused due to end time. ` +
          `${pendingCount} contacts pending - can be resumed in the same time window.`
        );
      } else {
        // All contacts processed, mark as completed
        await this.campaignService.updateStatus(campaignId, 'completed');

        this.logger.log(
          `Campaign "${campaign.name}" completed - all contacts processed.`
        );
      }
    } catch (err) {
      this.logger.error(`Error completing campaign due to end time:`, err?.message || err);
    }
  }

  /**
   * Check if a paused-time-window campaign can be resumed
   * Returns true if current time is within the campaign's scheduled window
   */
  private canResumeCampaignInWindow(campaign: Campaign): boolean {
    if (!campaign.schedule?.scheduledDate || !campaign.schedule?.scheduledTime) {
      return false;
    }

    const timezone = campaign.schedule.timezone || 'UTC';
    const scheduledTime = campaign.schedule.scheduledTime; // HH:mm format (start time)
    const endTime = campaign.schedule.endTime; // HH:mm format (end time)

    if (!endTime) {
      return false; // Need end time to determine window
    }

    // Get current time in the campaign's timezone
    const nowInTimezone = this.getCurrentTimeInTimezone(timezone);

    // Parse start and end times
    const [startHours, startMinutes] = scheduledTime.split(':').map(Number);
    const [endHours, endMinutes] = endTime.split(':').map(Number);

    // Create time comparison (using today's date)
    const today = nowInTimezone;
    const startDateTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), startHours, startMinutes, 0, 0);
    let endDateTime = new Date(today.getFullYear(), today.getMonth(), today.getDate(), endHours, endMinutes, 0, 0);

    // Handle case where end time is past midnight
    if (endDateTime.getTime() < startDateTime.getTime()) {
      endDateTime.setDate(endDateTime.getDate() + 1);
    }

    const isAfterStartTime = nowInTimezone.getTime() >= startDateTime.getTime();
    const isBeforeEndTime = nowInTimezone.getTime() < endDateTime.getTime();

    this.logger.log(
      `Campaign "${campaign.name}" window check: ` +
      `timezone=${timezone}, ` +
      `startTime=${scheduledTime}, ` +
      `endTime=${endTime}, ` +
      `nowInTz=${nowInTimezone.getHours().toString().padStart(2, '0')}:${nowInTimezone.getMinutes().toString().padStart(2, '0')}, ` +
      `isAfterStartTime=${isAfterStartTime}, isBeforeEndTime=${isBeforeEndTime}`
    );

    return isAfterStartTime && isBeforeEndTime;
  }

  /**
   * Resume a paused-time-window campaign
   */
  private async resumePausedWindowCampaign(campaign: Campaign): Promise<void> {
    try {
      const userId = campaign.userId;

      // Update campaign status to active
      await this.campaignModel.findByIdAndUpdate(campaign._id, {
        status: 'active',
        pausedReason: null,
        startedAt: new Date(),
      }).exec();

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

      const pendingCount = campaign.contacts.filter(c => c.callStatus === 'pending').length;
      this.logger.log(`Resumed paused-time-window campaign ${campaign.name} with ${pendingCount} pending contacts`);
    } catch (err) {
      this.logger.error(`Error resuming paused-time-window campaign ${campaign._id}:`, err?.message || err);
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
   * Resume a paused campaign (handles both 'paused' and 'paused-time-window' status)
   */
  async resumeCampaign(campaignId: string): Promise<void> {
    const campaign = await this.campaignService.findOne(campaignId);
    if (!campaign || (campaign.status !== 'paused' && campaign.status !== 'paused-time-window')) return;

    await this.campaignModel.findByIdAndUpdate(campaignId, {
      status: 'active',
      pausedReason: null,
      startedAt: new Date(),
    }).exec();

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

    const pendingCount = campaign.contacts.filter(c => c.callStatus === 'pending').length;
    this.logger.log(`Campaign ${campaignId} resumed with ${pendingCount} pending contacts`);
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

  /**
   * Reset user call state - clears stuck active calls counter
   * Use this when calls are stuck due to missed webhooks or deployments
   */
  async resetUserCallState(userId: string): Promise<{ success: boolean; message: string; previousState?: any }> {
    try {
      const existingState = this.userCallStates.get(userId);
      const previousState = existingState ? {
        activeCalls: existingState.activeCalls,
        maxConcurrentCalls: existingState.maxConcurrentCalls,
        activeCampaigns: Array.from(existingState.activeCampaigns),
      } : null;

      // Clear all tracked calls for this user
      for (const [callId, callInfo] of this.activeCallsTracker) {
        if (callInfo.userId === userId) {
          this.activeCallsTracker.delete(callId);
        }
      }

      // Reset the user state
      if (existingState) {
        existingState.activeCalls = 0;
        existingState.isProcessing = false;
        this.logger.log(`Reset user call state for ${userId}. Previous active calls: ${previousState?.activeCalls}`);
      }

      // Also reset any in-progress contacts in active campaigns to pending
      const activeCampaigns = await this.campaignModel.find({
        userId,
        status: 'active',
        type: 'outbound',
      }).exec();

      let resetContactsCount = 0;
      for (const campaign of activeCampaigns) {
        for (const contact of campaign.contacts) {
          if (contact.callStatus === 'in-progress') {
            await this.campaignService.updateContactCallStatus(
              campaign._id.toString(),
              contact._id!.toString(),
              'failed',
              { callNotes: 'Reset due to manual state clear' }
            );
            resetContactsCount++;
          }
        }
      }

      return {
        success: true,
        message: `User call state reset successfully. Reset ${resetContactsCount} in-progress contacts.`,
        previousState,
      };
    } catch (err) {
      this.logger.error(`Error resetting user call state for ${userId}:`, err?.message || err);
      return {
        success: false,
        message: err?.message || 'Failed to reset user call state',
      };
    }
  }

  /**
   * Get all campaigns that can be resumed in the current time window
   * Returns campaigns with 'paused-time-window' status that have pending contacts
   * and are currently within their scheduled time window
   */
  async getResumableCampaigns(userId: string): Promise<{
    campaigns: Array<{
      _id: string;
      name: string;
      status: string;
      totalContacts: number;
      pendingContacts: number;
      completedContacts: number;
      failedContacts: number;
      schedule: any;
      isInWindow: boolean;
      canResumeNow: boolean;
    }>;
    totalPendingContacts: number;
  }> {
    // Get all paused-time-window campaigns for this user
    const pausedCampaigns = await this.campaignModel.find({
      userId,
      status: 'paused-time-window',
      type: 'outbound',
    }).exec();

    const result = [];
    let totalPendingContacts = 0;

    for (const campaign of pausedCampaigns) {
      const pendingCount = campaign.contacts.filter(c => c.callStatus === 'pending').length;
      const completedCount = campaign.contacts.filter(c => c.callStatus === 'completed').length;
      const failedCount = campaign.contacts.filter(c => c.callStatus === 'failed' || c.callStatus === 'no-answer').length;
      
      const isInWindow = this.canResumeCampaignInWindow(campaign);
      
      if (pendingCount > 0) {
        totalPendingContacts += pendingCount;
        result.push({
          _id: campaign._id.toString(),
          name: campaign.name,
          status: campaign.status,
          totalContacts: campaign.contacts.length,
          pendingContacts: pendingCount,
          completedContacts: completedCount,
          failedContacts: failedCount,
          schedule: campaign.schedule,
          isInWindow,
          canResumeNow: isInWindow && pendingCount > 0,
        });
      }
    }

    return {
      campaigns: result,
      totalPendingContacts,
    };
  }

  /**
   * Get summary of all campaigns with pending contacts, grouped by status
   * Useful for showing a dashboard of how many contacts are waiting across all campaigns
   */
  async getPendingContactsSummary(userId: string): Promise<{
    byStatus: Record<string, {
      campaignCount: number;
      totalContacts: number;
      pendingContacts: number;
      campaigns: Array<{
        _id: string;
        name: string;
        pendingContacts: number;
        totalContacts: number;
      }>;
    }>;
    totals: {
      totalCampaigns: number;
      totalContacts: number;
      totalPending: number;
      totalCompleted: number;
      totalFailed: number;
    };
  }> {
    const allCampaigns = await this.campaignModel.find({
      userId,
      type: 'outbound',
    }).exec();

    const byStatus: Record<string, {
      campaignCount: number;
      totalContacts: number;
      pendingContacts: number;
      campaigns: Array<{
        _id: string;
        name: string;
        pendingContacts: number;
        totalContacts: number;
      }>;
    }> = {};

    let totalPending = 0;
    let totalCompleted = 0;
    let totalFailed = 0;
    let totalContacts = 0;

    for (const campaign of allCampaigns) {
      const pendingCount = campaign.contacts.filter(c => c.callStatus === 'pending').length;
      const completedCount = campaign.contacts.filter(c => c.callStatus === 'completed').length;
      const failedCount = campaign.contacts.filter(c => c.callStatus === 'failed' || c.callStatus === 'no-answer').length;
      
      totalPending += pendingCount;
      totalCompleted += completedCount;
      totalFailed += failedCount;
      totalContacts += campaign.contacts.length;

      if (!byStatus[campaign.status]) {
        byStatus[campaign.status] = {
          campaignCount: 0,
          totalContacts: 0,
          pendingContacts: 0,
          campaigns: [],
        };
      }

      byStatus[campaign.status].campaignCount++;
      byStatus[campaign.status].totalContacts += campaign.contacts.length;
      byStatus[campaign.status].pendingContacts += pendingCount;
      
      if (pendingCount > 0) {
        byStatus[campaign.status].campaigns.push({
          _id: campaign._id.toString(),
          name: campaign.name,
          pendingContacts: pendingCount,
          totalContacts: campaign.contacts.length,
        });
      }
    }

    return {
      byStatus,
      totals: {
        totalCampaigns: allCampaigns.length,
        totalContacts,
        totalPending,
        totalCompleted,
        totalFailed,
      },
    };
  }
}
