import { Controller, Post, Body, Headers, HttpCode, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CallHistoryService } from '../call-history/call-history.service';
import { CampaignService } from '../campaign/campaign.service';
import { CampaignSchedulerService } from '../campaign/campaign-scheduler.service';
import { AppLogger } from '../app.logger';
import { ResponseHelper } from '../response.helper';
import * as crypto from 'crypto';

// Twilio Status Callback payload
interface TwilioStatusCallback {
  CallSid: string;
  AccountSid: string;
  From: string;
  To: string;
  CallStatus: 'queued' | 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'no-answer' | 'canceled';
  CallDuration?: string; // Duration in seconds (only on completed)
  Duration?: string; // Alias for CallDuration
  Timestamp?: string;
  SequenceNumber?: string;
  CallbackSource?: string;
  // Additional fields that may be present
  Direction?: string;
  ForwardedFrom?: string;
  CallerName?: string;
  ParentCallSid?: string;
  ErrorCode?: string;
  ErrorMessage?: string;
}

// Plivo callback payload
interface PlivoCallback {
  CallUUID: string;
  From: string;
  To: string;
  CallStatus: 'ringing' | 'in-progress' | 'completed' | 'busy' | 'failed' | 'timeout' | 'no-answer' | 'cancel' | 'machine';
  Duration?: string; // Duration in seconds
  BillDuration?: string;
  BillRate?: string;
  TotalCost?: string;
  Direction?: string;
  AnswerTime?: string;
  EndTime?: string;
  HangupCause?: string;
  HangupCauseCode?: string;
  // For machine detection
  MachineDetection?: string;
  // Event type for different webhooks
  Event?: string;
}

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
    private readonly campaignSchedulerService: CampaignSchedulerService,
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
        
        // Trigger next call in the campaign queue
        // This handles the concurrency logic - when one call ends, start the next
        await this.campaignSchedulerService.onCallEnded(campaignId, callId);
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

  // ==========================================
  // TWILIO STATUS CALLBACK WEBHOOK
  // ==========================================

  /**
   * Twilio Status Callback Endpoint
   * Receives status updates when call events occur via Twilio
   * POST /webhook/twilio/status
   * 
   * Configure this URL in Twilio as the StatusCallback URL when making outbound calls
   * URL format: https://your-domain.com/webhook/twilio/status?campaignId=xxx&contactId=xxx&callHistoryId=xxx
   * 
   * Note: Twilio sends data as application/x-www-form-urlencoded
   */
  @Post('twilio/status')
  @HttpCode(200)
  async handleTwilioStatusCallback(
    @Body() payload: TwilioStatusCallback,
    @Query('campaignId') campaignId: string,
    @Query('contactId') contactId: string,
    @Query('callHistoryId') callHistoryId: string,
    @Res() res: Response,
  ) {
    try {
      // Log raw payload for debugging
      this.logger.log(`Twilio raw payload: ${JSON.stringify(payload)}`);
      this.logger.log(`Twilio query params: campaignId=${campaignId}, contactId=${contactId}, callHistoryId=${callHistoryId}`);
      
      // Validate required fields - Twilio sends form-urlencoded data
      if (!payload || !payload.CallStatus) {
        this.logger.warn('Twilio webhook missing required fields, returning OK to prevent retries');
        res.type('text/xml');
        return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
      }

      this.logger.log(
        `Received Twilio status callback: CallSid=${payload.CallSid}, Status=${payload.CallStatus}, ` +
        `Duration=${payload.CallDuration || payload.Duration || '0'}, campaignId=${campaignId}`
      );

      // Handle different call statuses
      switch (payload.CallStatus) {
        case 'ringing':
          this.logger.log(`Twilio call ${payload.CallSid} is ringing`);
          break;

        case 'in-progress':
          this.logger.log(`Twilio call ${payload.CallSid} is in-progress`);
          // Update call history to in-progress
          if (callHistoryId) {
            await this.callHistoryService.update(callHistoryId, {
              status: 'in-progress',
              startedAt: new Date(),
            });
          }
          break;

        case 'completed':
        case 'busy':
        case 'failed':
        case 'no-answer':
        case 'canceled':
          await this.handleTwilioCallEnded(payload, campaignId, contactId, callHistoryId);
          break;

        default:
          this.logger.log(`Unhandled Twilio status: ${payload.CallStatus}`);
      }

      // Return empty TwiML response (Twilio expects XML response)
      res.type('text/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    } catch (err) {
      this.logger.error('Error processing Twilio webhook', err?.message || err);
      res.type('text/xml');
      return res.send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
    }
  }

  /**
   * Handle Twilio call ended (completed, busy, failed, no-answer, canceled)
   */
  private async handleTwilioCallEnded(
    payload: TwilioStatusCallback,
    campaignId: string,
    contactId: string,
    callHistoryId: string,
  ) {
    try {
      const durationSeconds = parseInt(payload.CallDuration || payload.Duration || '0', 10);
      
      // Map Twilio status to our call status
      let callStatus: 'completed' | 'failed' | 'no-answer' = 'completed';
      let endReason: string = 'hangup';

      switch (payload.CallStatus) {
        case 'completed':
          callStatus = 'completed';
          endReason = 'hangup';
          break;
        case 'busy':
          callStatus = 'failed';
          endReason = 'busy';
          break;
        case 'failed':
          callStatus = 'failed';
          endReason = payload.ErrorMessage || 'connection_error';
          break;
        case 'no-answer':
          callStatus = 'no-answer';
          endReason = 'no-answer';
          break;
        case 'canceled':
          callStatus = 'failed';
          endReason = 'canceled';
          break;
      }

      this.logger.log(
        `Twilio call ended: CallSid=${payload.CallSid}, Status=${callStatus}, ` +
        `Duration=${durationSeconds}s, EndReason=${endReason}`
      );

      // Update call history
      if (callHistoryId) {
        await this.callHistoryService.update(callHistoryId, {
          status: callStatus === 'no-answer' ? 'missed' : callStatus,
          endedAt: new Date(),
          durationSeconds,
          endReason: endReason as any,
          billedDuration: durationSeconds > 0 ? `${Math.ceil(durationSeconds / 60)}m` : '0m',
        });
        this.logger.log(`Updated call history ${callHistoryId} via Twilio webhook`);
      }

      // Update campaign contact status and trigger next call
      if (campaignId && contactId) {
        await this.campaignService.updateContactCallStatus(
          campaignId,
          contactId,
          callStatus,
          {
            callDuration: durationSeconds,
            callNotes: `Twilio: ${payload.CallStatus}${payload.ErrorMessage ? ' - ' + payload.ErrorMessage : ''}`,
          }
        );
        this.logger.log(`Updated campaign ${campaignId} contact ${contactId} status to ${callStatus}`);

        // Trigger scheduler to process next call
        // Use CallSid as the callId for tracking
        await this.campaignSchedulerService.onCallEnded(campaignId, payload.CallSid);
      }
    } catch (err) {
      this.logger.error(`Error handling Twilio call ended: ${err?.message}`);
    }
  }

  // ==========================================
  // PLIVO STATUS CALLBACK WEBHOOK
  // ==========================================

  /**
   * Plivo Callback Endpoint
   * Receives status updates when call events occur via Plivo
   * POST /webhook/plivo/status
   * 
   * Configure this URL in Plivo as the callback URL when making outbound calls
   * URL format: https://your-domain.com/webhook/plivo/status?campaignId=xxx&contactId=xxx&callHistoryId=xxx
   */
  @Post('plivo/status')
  @HttpCode(200)
  async handlePlivoStatusCallback(
    @Body() payload: PlivoCallback,
    @Query('campaignId') campaignId: string,
    @Query('contactId') contactId: string,
    @Query('callHistoryId') callHistoryId: string,
  ) {
    try {
      this.logger.log(
        `Received Plivo status callback: CallUUID=${payload.CallUUID}, Status=${payload.CallStatus}, ` +
        `Duration=${payload.Duration || '0'}, campaignId=${campaignId}`
      );

      // Handle different call statuses
      switch (payload.CallStatus) {
        case 'ringing':
          this.logger.log(`Plivo call ${payload.CallUUID} is ringing`);
          break;

        case 'in-progress':
          this.logger.log(`Plivo call ${payload.CallUUID} is in-progress`);
          // Update call history to in-progress
          if (callHistoryId) {
            await this.callHistoryService.update(callHistoryId, {
              status: 'in-progress',
              startedAt: payload.AnswerTime ? new Date(payload.AnswerTime) : new Date(),
            });
          }
          break;

        case 'completed':
        case 'busy':
        case 'failed':
        case 'no-answer':
        case 'timeout':
        case 'cancel':
        case 'machine':
          await this.handlePlivoCallEnded(payload, campaignId, contactId, callHistoryId);
          break;

        default:
          this.logger.log(`Unhandled Plivo status: ${payload.CallStatus}`);
      }

      return { status: 'ok' };
    } catch (err) {
      this.logger.error('Error processing Plivo webhook', err?.message || err);
      return { status: 'ok' };
    }
  }

  /**
   * Handle Plivo call ended
   */
  private async handlePlivoCallEnded(
    payload: PlivoCallback,
    campaignId: string,
    contactId: string,
    callHistoryId: string,
  ) {
    try {
      const durationSeconds = parseInt(payload.Duration || '0', 10);
      const billDuration = parseInt(payload.BillDuration || '0', 10);
      
      // Map Plivo status to our call status
      let callStatus: 'completed' | 'failed' | 'no-answer' = 'completed';
      let endReason: string = 'hangup';

      switch (payload.CallStatus) {
        case 'completed':
          callStatus = 'completed';
          endReason = payload.HangupCause || 'hangup';
          break;
        case 'busy':
          callStatus = 'failed';
          endReason = 'busy';
          break;
        case 'failed':
          callStatus = 'failed';
          endReason = payload.HangupCause || 'connection_error';
          break;
        case 'no-answer':
        case 'timeout':
          callStatus = 'no-answer';
          endReason = payload.CallStatus;
          break;
        case 'cancel':
          callStatus = 'failed';
          endReason = 'canceled';
          break;
        case 'machine':
          // Answering machine detected
          callStatus = 'failed';
          endReason = 'answering_machine';
          break;
      }

      this.logger.log(
        `Plivo call ended: CallUUID=${payload.CallUUID}, Status=${callStatus}, ` +
        `Duration=${durationSeconds}s, BillDuration=${billDuration}s, EndReason=${endReason}`
      );

      // Update call history
      if (callHistoryId) {
        await this.callHistoryService.update(callHistoryId, {
          status: callStatus === 'no-answer' ? 'missed' : callStatus,
          endedAt: payload.EndTime ? new Date(payload.EndTime) : new Date(),
          durationSeconds,
          endReason: endReason as any,
          billedDuration: billDuration > 0 ? `${Math.ceil(billDuration / 60)}m` : '0m',
          billingStatus: payload.TotalCost ? 'billed' : undefined,
          metadata: {
            plivoCallUUID: payload.CallUUID,
            plivoHangupCause: payload.HangupCause,
            plivoHangupCauseCode: payload.HangupCauseCode,
            plivoTotalCost: payload.TotalCost,
            plivoBillRate: payload.BillRate,
          },
        });
        this.logger.log(`Updated call history ${callHistoryId} via Plivo webhook`);
      }

      // Update campaign contact status and trigger next call
      if (campaignId && contactId) {
        await this.campaignService.updateContactCallStatus(
          campaignId,
          contactId,
          callStatus,
          {
            callDuration: durationSeconds,
            callNotes: `Plivo: ${payload.CallStatus}${payload.HangupCause ? ' - ' + payload.HangupCause : ''}`,
          }
        );
        this.logger.log(`Updated campaign ${campaignId} contact ${contactId} status to ${callStatus}`);

        // Trigger scheduler to process next call
        await this.campaignSchedulerService.onCallEnded(campaignId, payload.CallUUID);
      }
    } catch (err) {
      this.logger.error(`Error handling Plivo call ended: ${err?.message}`);
    }
  }

  // ==========================================
  // TELNYX STATUS CALLBACK WEBHOOK (Bonus)
  // ==========================================

  /**
   * Telnyx Callback Endpoint
   * Receives status updates when call events occur via Telnyx
   * POST /webhook/telnyx/status
   */
  @Post('telnyx/status')
  @HttpCode(200)
  async handleTelnyxStatusCallback(
    @Body() payload: any,
    @Query('campaignId') campaignId: string,
    @Query('contactId') contactId: string,
    @Query('callHistoryId') callHistoryId: string,
  ) {
    try {
      // Telnyx sends events in a different format
      const event = payload.data;
      const eventType = event?.event_type;
      const callControlId = event?.payload?.call_control_id;
      const callLegId = event?.payload?.call_leg_id;

      this.logger.log(
        `Received Telnyx callback: event_type=${eventType}, call_control_id=${callControlId}, campaignId=${campaignId}`
      );

      switch (eventType) {
        case 'call.initiated':
        case 'call.ringing':
          this.logger.log(`Telnyx call ${callControlId} is ${eventType}`);
          break;

        case 'call.answered':
          this.logger.log(`Telnyx call ${callControlId} answered`);
          if (callHistoryId) {
            await this.callHistoryService.update(callHistoryId, {
              status: 'in-progress',
              startedAt: new Date(),
            });
          }
          break;

        case 'call.hangup':
          await this.handleTelnyxCallEnded(event, campaignId, contactId, callHistoryId);
          break;

        default:
          this.logger.log(`Unhandled Telnyx event: ${eventType}`);
      }

      return { status: 'ok' };
    } catch (err) {
      this.logger.error('Error processing Telnyx webhook', err?.message || err);
      return { status: 'ok' };
    }
  }

  /**
   * Handle Telnyx call ended
   */
  private async handleTelnyxCallEnded(
    event: any,
    campaignId: string,
    contactId: string,
    callHistoryId: string,
  ) {
    try {
      const payload = event?.payload || {};
      const hangupCause = payload.hangup_cause;
      const hangupSource = payload.hangup_source;
      const callControlId = payload.call_control_id;
      
      // Calculate duration from timestamps if available
      let durationSeconds = 0;
      if (payload.start_time && payload.end_time) {
        const startTime = new Date(payload.start_time);
        const endTime = new Date(payload.end_time);
        durationSeconds = Math.round((endTime.getTime() - startTime.getTime()) / 1000);
      }

      // Map Telnyx hangup cause to our status
      let callStatus: 'completed' | 'failed' | 'no-answer' = 'completed';
      let endReason: string = 'hangup';

      switch (hangupCause) {
        case 'normal_clearing':
        case 'normal':
          callStatus = 'completed';
          endReason = 'hangup';
          break;
        case 'user_busy':
          callStatus = 'failed';
          endReason = 'busy';
          break;
        case 'no_answer':
        case 'no_user_response':
          callStatus = 'no-answer';
          endReason = 'no-answer';
          break;
        case 'call_rejected':
        case 'unallocated_number':
        case 'number_changed':
          callStatus = 'failed';
          endReason = hangupCause;
          break;
        default:
          if (hangupCause?.includes('error') || hangupCause?.includes('fail')) {
            callStatus = 'failed';
          }
          endReason = hangupCause || 'unknown';
      }

      this.logger.log(
        `Telnyx call ended: call_control_id=${callControlId}, Status=${callStatus}, ` +
        `Duration=${durationSeconds}s, EndReason=${endReason}`
      );

      // Update call history
      if (callHistoryId) {
        await this.callHistoryService.update(callHistoryId, {
          status: callStatus === 'no-answer' ? 'missed' : callStatus,
          endedAt: payload.end_time ? new Date(payload.end_time) : new Date(),
          durationSeconds,
          endReason: endReason as any,
          billedDuration: durationSeconds > 0 ? `${Math.ceil(durationSeconds / 60)}m` : '0m',
          metadata: {
            telnyxCallControlId: callControlId,
            telnyxHangupCause: hangupCause,
            telnyxHangupSource: hangupSource,
          },
        });
        this.logger.log(`Updated call history ${callHistoryId} via Telnyx webhook`);
      }

      // Update campaign contact status and trigger next call
      if (campaignId && contactId) {
        await this.campaignService.updateContactCallStatus(
          campaignId,
          contactId,
          callStatus,
          {
            callDuration: durationSeconds,
            callNotes: `Telnyx: ${hangupCause || 'completed'}`,
          }
        );
        this.logger.log(`Updated campaign ${campaignId} contact ${contactId} status to ${callStatus}`);

        // Trigger scheduler to process next call
        await this.campaignSchedulerService.onCallEnded(campaignId, callControlId);
      }
    } catch (err) {
      this.logger.error(`Error handling Telnyx call ended: ${err?.message}`);
    }
  }
}
