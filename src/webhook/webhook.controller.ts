import { Controller, Post, Body, Headers, HttpCode } from '@nestjs/common';
import { CallHistoryService } from '../call-history/call-history.service';
import { CampaignService } from '../campaign/campaign.service';
import { AppLogger } from '../app.logger';
import { ResponseHelper } from '../response.helper';
import * as crypto from 'crypto';

interface TalkrixWebhookPayload {
  event: 'call.started' | 'call.joined' | 'call.ended' | 'call.billed';
  call: {
    callId: string;
    created: string;
    joined?: string;
    ended?: string;
    endReason?: string;
    billedDuration?: string;
    billingStatus?: string;
    shortSummary?: string;
    summary?: string;
    recordingEnabled?: boolean;
    recordingUrl?: string;
    recording?: string;
    agentId?: string;
    metadata?: Record<string, string>;
  };
}

@Controller('webhook')
export class WebhookController {
  constructor(
    private readonly callHistoryService: CallHistoryService,
    private readonly campaignService: CampaignService,
    private readonly logger: AppLogger,
    private readonly responseHelper: ResponseHelper,
  ) {}

  /**
   * Talkrix Webhook Endpoint
   * Receives webhook events when call events occur
   * POST /webhook/talkrix
   */
  @Post('talkrix')
  @HttpCode(200)
  async handleTalkrixWebhook(
    @Body() payload: TalkrixWebhookPayload,
    @Headers('x-webhook-secret') webhookSecret: string,
    @Headers('x-webhook-signature') webhookSignature: string,
  ) {
    try {
      this.logger.log(`Received Talkrix webhook: ${payload.event} for call ${payload.call?.callId}`);

      // Verify webhook signature if secret is configured
      const configuredSecret = process.env.TALKRIX_WEBHOOK_SECRET;
      if (configuredSecret && webhookSignature) {
        const rawBody = JSON.stringify(payload);
        const expectedSignature = crypto
          .createHmac('sha256', configuredSecret)
          .update(rawBody)
          .digest('hex');
        
        if (webhookSignature !== expectedSignature) {
          this.logger.warn('Invalid webhook signature');
          return { status: 'error', message: 'Invalid signature' };
        }
      }

      if (!payload.call?.callId) {
        this.logger.warn('Webhook payload missing callId');
        return { status: 'ok', message: 'No callId in payload' };
      }

      const { event, call } = payload;

      switch (event) {
        case 'call.started':
          await this.handleCallStarted(call);
          break;
        case 'call.joined':
          await this.handleCallJoined(call);
          break;
        case 'call.ended':
          await this.handleCallEnded(call);
          break;
        case 'call.billed':
          await this.handleCallBilled(call);
          break;
        default:
          this.logger.log(`Unhandled webhook event: ${event}`);
      }

      return { status: 'ok' };
    } catch (err) {
      this.logger.error('Error processing webhook', err?.message || err);
      // Return 200 to prevent retries for processing errors
      return { status: 'error', message: 'Processing error' };
    }
  }

  /**
   * Handle call.started event
   */
  private async handleCallStarted(call: TalkrixWebhookPayload['call']) {
    this.logger.log(`Call started: ${call.callId}`);
    // Call history is already created when the call is initiated via our API
    // This webhook is mainly useful for telephony-initiated calls
  }

  /**
   * Handle call.joined event
   */
  private async handleCallJoined(call: TalkrixWebhookPayload['call']) {
    this.logger.log(`Call joined: ${call.callId}`);
    
    // Update call status to in-progress and set startedAt
    try {
      const callHistory = await this.callHistoryService.findByTalkrixCallId(call.callId);
      if (callHistory) {
        const startedAt = call.joined ? new Date(call.joined) : new Date();
        await this.callHistoryService.update(callHistory._id.toString(), {
          status: 'in-progress',
          startedAt,
        });
        this.logger.log(`Updated call ${call.callId} to in-progress with startedAt: ${startedAt.toISOString()}`);
      }
    } catch (err) {
      this.logger.warn(`Could not update call ${call.callId} on joined: ${err?.message}`);
    }
  }

  /**
   * Handle call.ended event
   */
  private async handleCallEnded(call: TalkrixWebhookPayload['call']) {
    this.logger.log(`Call ended: ${call.callId}, reason: ${call.endReason}`);

    try {
      const callHistory = await this.callHistoryService.findByTalkrixCallId(call.callId);
      if (!callHistory) {
        this.logger.warn(`Call history not found for callId: ${call.callId}`);
        return;
      }

      // Calculate duration from timestamps
      let durationSeconds = 0;
      if (call.joined && call.ended) {
        const joined = new Date(call.joined);
        const ended = new Date(call.ended);
        durationSeconds = Math.round((ended.getTime() - joined.getTime()) / 1000);
      } else if (callHistory.startedAt && call.ended) {
        // Fallback: use stored startedAt if webhook joined timestamp is missing
        const started = new Date(callHistory.startedAt);
        const ended = new Date(call.ended);
        durationSeconds = Math.round((ended.getTime() - started.getTime()) / 1000);
      }

      // Calculate billed duration - minimum 1 minute for any call with duration
      let billedDuration = call.billedDuration;
      if ((!billedDuration || billedDuration === '0s' || billedDuration === '0') && durationSeconds > 0) {
        const billedMinutes = Math.max(1, Math.ceil(durationSeconds / 60));
        billedDuration = `${billedMinutes}m`;
      }

      const updateData: any = {
        status: 'completed',
        endedAt: call.ended ? new Date(call.ended) : new Date(),
        endReason: call.endReason,
      };

      if (durationSeconds > 0) {
        updateData.durationSeconds = durationSeconds;
      }

      if (call.shortSummary) {
        updateData.shortSummary = call.shortSummary;
      }

      if (call.summary) {
        updateData.summary = call.summary;
      }

      if (billedDuration) {
        updateData.billedDuration = billedDuration;
      }

      if (call.billingStatus) {
        updateData.billingStatus = call.billingStatus;
      }

      // Handle recording URL (may use 'recording' or 'recordingUrl')
      const recordingUrl = call.recordingUrl || call.recording;
      if (recordingUrl) {
        updateData.recordingUrl = recordingUrl;
      }

      await this.callHistoryService.update(callHistory._id.toString(), updateData);
      this.logger.log(`Updated call history for ${call.callId} via webhook`);

      // Update campaign contact status if this call was part of a campaign
      if (callHistory.metadata?.campaignId) {
        await this.updateCampaignContactStatus(
          callHistory.metadata.campaignId as string,
          call.callId,
          call.endReason,
          durationSeconds
        );
      }
    } catch (err) {
      this.logger.error(`Error updating call ${call.callId} on ended: ${err?.message}`);
    }
  }

  /**
   * Update campaign contact status when call ends
   */
  private async updateCampaignContactStatus(
    campaignId: string,
    callId: string,
    endReason?: string,
    durationSeconds?: number
  ) {
    try {
      // Determine call status based on end reason
      let callStatus: 'completed' | 'failed' | 'no-answer' = 'completed';
      if (endReason === 'unjoined' || endReason === 'timeout') {
        callStatus = 'no-answer';
      } else if (endReason === 'connection_error' || endReason === 'system_error') {
        callStatus = 'failed';
      }
      // hangup, agent_hangup are considered completed

      this.logger.log(`Updating campaign contact status to ${callStatus} for call ${callId} (endReason: ${endReason})`);

      // Use the new method that searches by callId directly
      const campaign = await this.campaignService.updateContactCallStatusByCallId(
        campaignId,
        callId,
        callStatus,
        {
          callDuration: durationSeconds || 0,
        }
      );

      if (campaign) {
        this.logger.log(`Updated campaign contact status to ${callStatus} for call ${callId}`);
      } else {
        this.logger.warn(`Failed to update campaign contact - campaign ${campaignId} or contact with callId ${callId} not found`);
      }
    } catch (err) {
      this.logger.error(`Error updating campaign contact status: ${err?.message}`);
    }
  }

  /**
   * Handle call.billed event
   */
  private async handleCallBilled(call: TalkrixWebhookPayload['call']) {
    this.logger.log(`Call billed: ${call.callId}, duration: ${call.billedDuration}`);

    try {
      const callHistory = await this.callHistoryService.findByTalkrixCallId(call.callId);
      if (!callHistory) {
        this.logger.warn(`Call history not found for callId: ${call.callId}`);
        return;
      }

      const updateData: any = {
        billingStatus: call.billingStatus || 'billed',
      };

      if (call.billedDuration) {
        updateData.billedDuration = call.billedDuration;
      }

      await this.callHistoryService.update(callHistory._id.toString(), updateData);
      this.logger.log(`Updated billing info for ${call.callId} via webhook`);
    } catch (err) {
      this.logger.error(`Error updating call ${call.callId} on billed: ${err?.message}`);
    }
  }
}
