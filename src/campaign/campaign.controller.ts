import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Put,
  Delete,
  UseGuards,
  Req,
  Query,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CampaignService } from './campaign.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { Campaign, CampaignContact } from './campaign.schema';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';
import { AgentService } from '../agent/agent.service';
import { UltravoxService } from '../agent/ultravox.service';
import { UserService } from '../user/user.service';
import { CallHistoryService } from '../call-history/call-history.service';
import * as XLSX from 'xlsx';

@Controller('campaigns')
export class CampaignController {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly campaignSchedulerService: CampaignSchedulerService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
    private readonly agentService: AgentService,
    private readonly ultravoxService: UltravoxService,
    private readonly userService: UserService,
    private readonly callHistoryService: CallHistoryService,
  ) {}

  // Helper to extract user info from JWT token or API key
  private getUserFromRequest(req: any): { userId: string; email?: string } | null {
    if (req.user?.sub) {
      return { userId: String(req.user.sub), email: req.user.email };
    }
    if (req.apiUser?._id) {
      return { userId: String(req.apiUser._id), email: req.apiUser.email };
    }
    return null;
  }

  // Create a new campaign
  @UseGuards(AuthOrApiKeyGuard)
  @Post()
  async create(@Body() campaignData: any, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      this.logger.warn('userId missing or invalid in create campaign');
      return this.responseHelper.error('userId is required', 400);
    }

    try {
      // Validate agent exists
      if (campaignData.agentId) {
        const agent = await this.agentService.findOne(campaignData.agentId);
        if (!agent) {
          return this.responseHelper.error('Agent not found', 404);
        }
        campaignData.agentName = agent.name;
      }

      // Validate schedule for outbound campaigns
      if (campaignData.type === 'outbound' && !campaignData.schedule) {
        return this.responseHelper.error('Schedule is required for outbound campaigns', 400);
      }

      // Validate contacts for outbound campaigns - must have at least one contact
      if (campaignData.type === 'outbound' && (!campaignData.contacts || campaignData.contacts.length === 0)) {
        return this.responseHelper.error('Contacts are required for outbound campaigns. Please upload a file with valid contacts (name and phone number).', 400);
      }

      const campaign = await this.campaignService.create({
        ...campaignData,
        userId: userInfo.userId,
      });

      this.logger.log(`Campaign created for user ${userInfo.userId}`);
      return this.responseHelper.success(campaign, 'Campaign created', 201);
    } catch (err) {
      this.logger.error('Error creating campaign', err);
      return this.responseHelper.error('Failed to create campaign', 500, err?.message || err);
    }
  }

  // Get all campaigns for the authenticated user with pagination
  @UseGuards(AuthOrApiKeyGuard)
  @Get()
  async findAll(
    @Req() req: any,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }

    try {
      const result = await this.campaignService.findByUserId(
        userInfo.userId,
        page ? parseInt(page, 10) : 1,
        limit ? parseInt(limit, 10) : 10,
      );
      return this.responseHelper.success(result, 'Campaigns fetched');
    } catch (err) {
      this.logger.error('Error fetching campaigns', err);
      return this.responseHelper.error('Failed to fetch campaigns', 500, err?.message || err);
    }
  }

  // Get campaigns by user ID with pagination (admin route)
  @UseGuards(AuthOrApiKeyGuard)
  @Get('user/:userId')
  async findByUserId(
    @Param('userId') userId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    try {
      const result = await this.campaignService.findByUserId(
        userId,
        page ? parseInt(page, 10) : 1,
        limit ? parseInt(limit, 10) : 10,
      );
      return this.responseHelper.success(result, 'Campaigns fetched');
    } catch (err) {
      this.logger.error('Error fetching campaigns by user', err);
      return this.responseHelper.error('Failed to fetch campaigns', 500, err?.message || err);
    }
  }

  // Get user call state - shows current active calls and max concurrent
  // NOTE: This route MUST be defined BEFORE the :id route to avoid being caught by it
  @UseGuards(AuthOrApiKeyGuard)
  @Get('call-state')
  async getCallState(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const state = this.campaignSchedulerService.getUserCallState(userInfo.userId);
      const user = await this.userService.findById(userInfo.userId);
      const maxConcurrentCalls = user?.settings?.maxConcurrentCalls || 1;

      return this.responseHelper.success({
        userId: userInfo.userId,
        activeCalls: state?.activeCalls ?? 0,
        maxConcurrentCalls: state?.maxConcurrentCalls ?? maxConcurrentCalls,
        isProcessing: state?.isProcessing ?? false,
        activeCampaigns: state ? Array.from(state.activeCampaigns) : [],
      }, 'Call state fetched');
    } catch (err) {
      this.logger.error('Error fetching call state', err);
      return this.responseHelper.error('Failed to fetch call state', 500, err?.message || err);
    }
  }

  // Reset user call state - clears stuck active calls
  // NOTE: This route MUST be defined BEFORE the :id route to avoid being caught by it
  @UseGuards(AuthOrApiKeyGuard)
  @Post('reset-call-state')
  async resetCallState(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const result = await this.campaignSchedulerService.resetUserCallState(userInfo.userId);
      
      if (result.success) {
        return this.responseHelper.success(result, 'Call state reset successfully');
      } else {
        return this.responseHelper.error(result.message, 500);
      }
    } catch (err) {
      this.logger.error('Error resetting call state', err);
      return this.responseHelper.error('Failed to reset call state', 500, err?.message || err);
    }
  }

  // Get all campaigns with pending contacts that can be resumed in their time window
  // These are campaigns in 'paused-time-window' status with pending contacts
  // NOTE: This route MUST be defined BEFORE the :id route to avoid being caught by it
  @UseGuards(AuthOrApiKeyGuard)
  @Get('resumable')
  async getResumableCampaigns(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const result = await this.campaignSchedulerService.getResumableCampaigns(userInfo.userId);
      return this.responseHelper.success(result, 'Resumable campaigns fetched');
    } catch (err) {
      this.logger.error('Error fetching resumable campaigns', err);
      return this.responseHelper.error('Failed to fetch resumable campaigns', 500, err?.message || err);
    }
  }

  // Get summary of all campaigns with pending contacts grouped by status
  // NOTE: This route MUST be defined BEFORE the :id route to avoid being caught by it
  @UseGuards(AuthOrApiKeyGuard)
  @Get('pending-summary')
  async getPendingContactsSummary(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const result = await this.campaignSchedulerService.getPendingContactsSummary(userInfo.userId);
      return this.responseHelper.success(result, 'Pending contacts summary fetched');
    } catch (err) {
      this.logger.error('Error fetching pending contacts summary', err);
      return this.responseHelper.error('Failed to fetch pending contacts summary', 500, err?.message || err);
    }
  }

  // Get a single campaign by ID
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const campaign = await this.campaignService.findOne(id);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }
      return this.responseHelper.success(campaign, 'Campaign fetched');
    } catch (err) {
      this.logger.error('Error fetching campaign', err);
      return this.responseHelper.error('Failed to fetch campaign', 500, err?.message || err);
    }
  }

  // Update a campaign
  @UseGuards(AuthOrApiKeyGuard)
  @Put(':id')
  async update(@Param('id') id: string, @Body() updateData: Partial<Campaign>) {
    try {
      // If updating agentId, fetch and update agentName
      if (updateData.agentId) {
        const agent = await this.agentService.findOne(updateData.agentId);
        if (!agent) {
          return this.responseHelper.error('Agent not found', 404);
        }
        updateData.agentName = agent.name;
      }

      const campaign = await this.campaignService.update(id, updateData);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      this.logger.log(`Campaign ${id} updated`);
      return this.responseHelper.success(campaign, 'Campaign updated');
    } catch (err) {
      this.logger.error('Error updating campaign', err);
      return this.responseHelper.error('Failed to update campaign', 500, err?.message || err);
    }
  }

  // Update campaign status
  @UseGuards(AuthOrApiKeyGuard)
  @Put(':id/status')
  async updateStatus(@Param('id') id: string, @Body('status') status: Campaign['status']) {
    try {
      const campaign = await this.campaignService.updateStatus(id, status);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      this.logger.log(`Campaign ${id} status updated to ${status}`);
      return this.responseHelper.success(campaign, 'Campaign status updated');
    } catch (err) {
      this.logger.error('Error updating campaign status', err);
      return this.responseHelper.error('Failed to update campaign status', 500, err?.message || err);
    }
  }

  // Delete a campaign
  @UseGuards(AuthOrApiKeyGuard)
  @Delete(':id')
  async delete(@Param('id') id: string) {
    try {
      const campaign = await this.campaignService.delete(id);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      this.logger.log(`Campaign ${id} deleted`);
      return this.responseHelper.success(campaign, 'Campaign deleted');
    } catch (err) {
      this.logger.error('Error deleting campaign', err);
      return this.responseHelper.error('Failed to delete campaign', 500, err?.message || err);
    }
  }

  // Get contacts for a campaign with pagination
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id/contacts')
  async getContacts(
    @Param('id') id: string,
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '50',
  ) {
    try {
      const result = await this.campaignService.getContacts(
        id,
        parseInt(page, 10),
        parseInt(limit, 10),
      );
      return this.responseHelper.success(result, 'Contacts fetched');
    } catch (err) {
      this.logger.error('Error fetching contacts', err);
      return this.responseHelper.error('Failed to fetch contacts', 500, err?.message || err);
    }
  }

  // Add contacts to a campaign
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/contacts')
  async addContacts(
    @Param('id') id: string,
    @Body() body: { contacts: { name: string; phoneNumber: string }[] },
  ) {
    try {
      const campaign = await this.campaignService.addContacts(id, body.contacts);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      this.logger.log(`${body.contacts.length} contacts added to campaign ${id}`);
      return this.responseHelper.success(campaign, 'Contacts added');
    } catch (err) {
      this.logger.error('Error adding contacts', err);
      return this.responseHelper.error('Failed to add contacts', 500, err?.message || err);
    }
  }

  // Update a single contact
  @UseGuards(AuthOrApiKeyGuard)
  @Put(':id/contacts/:contactId')
  async updateContact(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body() contactData: Partial<CampaignContact>,
  ) {
    try {
      const campaign = await this.campaignService.updateContact(id, contactId, contactData);
      if (!campaign) {
        return this.responseHelper.error('Campaign or contact not found', 404);
      }

      this.logger.log(`Contact ${contactId} updated in campaign ${id}`);
      return this.responseHelper.success(campaign, 'Contact updated');
    } catch (err) {
      this.logger.error('Error updating contact', err);
      return this.responseHelper.error('Failed to update contact', 500, err?.message || err);
    }
  }

  // Delete a contact from a campaign
  @UseGuards(AuthOrApiKeyGuard)
  @Delete(':id/contacts/:contactId')
  async deleteContact(@Param('id') id: string, @Param('contactId') contactId: string) {
    try {
      const campaign = await this.campaignService.deleteContact(id, contactId);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      this.logger.log(`Contact ${contactId} deleted from campaign ${id}`);
      return this.responseHelper.success(campaign, 'Contact deleted');
    } catch (err) {
      this.logger.error('Error deleting contact', err);
      return this.responseHelper.error('Failed to delete contact', 500, err?.message || err);
    }
  }

  // Upload Excel file with contacts
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/upload')
  @UseInterceptors(FileInterceptor('file'))
  async uploadContacts(@Param('id') id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) {
      return this.responseHelper.error('No file uploaded', 400);
    }

    try {
      // Parse the Excel file
      const workbook = XLSX.read(file.buffer, { type: 'buffer' });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data: any[] = XLSX.utils.sheet_to_json(worksheet);

      if (data.length === 0) {
        return this.responseHelper.error('Excel file is empty', 400);
      }

      // Extract contacts from Excel data
      // Support various column name formats
      const contacts: { name: string; phoneNumber: string }[] = [];

      for (const row of data) {
        // Try to find name column (case-insensitive)
        const name =
          row.name ||
          row.Name ||
          row.NAME ||
          row['Full Name'] ||
          row['full name'] ||
          row['Contact Name'] ||
          row['contact name'] ||
          '';

        // Try to find phone column (case-insensitive)
        const phone =
          row.phone ||
          row.Phone ||
          row.PHONE ||
          row.phoneNumber ||
          row.PhoneNumber ||
          row['Phone Number'] ||
          row['phone number'] ||
          row.mobile ||
          row.Mobile ||
          row.MOBILE ||
          row['Mobile Number'] ||
          row['mobile number'] ||
          '';

        if (name && phone) {
          contacts.push({
            name: String(name).trim(),
            phoneNumber: String(phone).trim(),
          });
        }
      }

      if (contacts.length === 0) {
        return this.responseHelper.error(
          'No valid contacts found. Make sure your Excel file has "name" and "phone" columns.',
          400,
        );
      }

      // Bulk import contacts
      const campaign = await this.campaignService.bulkImportContacts(id, contacts);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      this.logger.log(`${contacts.length} contacts uploaded to campaign ${id}`);
      return this.responseHelper.success(
        { importedCount: contacts.length, campaign },
        `${contacts.length} contacts imported successfully`,
      );
    } catch (err) {
      this.logger.error('Error uploading contacts', err);
      return this.responseHelper.error('Failed to process Excel file', 500, err?.message || err);
    }
  }

  // Get campaign statistics
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id/stats')
  async getStats(@Param('id') id: string) {
    try {
      const stats = await this.campaignService.getCampaignStats(id);
      if (!stats) {
        return this.responseHelper.error('Campaign not found', 404);
      }
      return this.responseHelper.success(stats, 'Campaign stats fetched');
    } catch (err) {
      this.logger.error('Error fetching campaign stats', err);
      return this.responseHelper.error('Failed to fetch campaign stats', 500, err?.message || err);
    }
  }

  // Update contact call status (used after a call)
  @UseGuards(AuthOrApiKeyGuard)
  @Put(':id/contacts/:contactId/call-status')
  async updateContactCallStatus(
    @Param('id') id: string,
    @Param('contactId') contactId: string,
    @Body()
    body: {
      callStatus: CampaignContact['callStatus'];
      callId?: string;
      callDuration?: number;
      callNotes?: string;
    },
  ) {
    try {
      const campaign = await this.campaignService.updateContactCallStatus(
        id,
        contactId,
        body.callStatus,
        {
          callId: body.callId,
          callDuration: body.callDuration,
          callNotes: body.callNotes,
        },
      );

      if (!campaign) {
        return this.responseHelper.error('Campaign or contact not found', 404);
      }

      this.logger.log(`Contact ${contactId} call status updated to ${body.callStatus}`);
      return this.responseHelper.success(campaign, 'Contact call status updated');
    } catch (err) {
      this.logger.error('Error updating contact call status', err);
      return this.responseHelper.error('Failed to update contact call status', 500, err?.message || err);
    }
  }

  // Trigger calls for on-demand campaign contacts
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/trigger-calls')
  async triggerCalls(
    @Param('id') id: string,
    @Body() body: { contactIds: string[] },
    @Req() req: any,
  ) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      this.logger.warn('Trigger calls: Unauthorized - no user info');
      return this.responseHelper.error('Unauthorized', 401);
    }

    this.logger.log(`Trigger calls request for campaign ${id} with ${body.contactIds?.length || 0} contact IDs`);

    try {
      // Get the campaign
      const campaign = await this.campaignService.findOne(id);
      if (!campaign) {
        this.logger.warn(`Trigger calls: Campaign ${id} not found`);
        return this.responseHelper.error('Campaign not found', 404);
      }

      // Verify campaign is on-demand type
      if (campaign.type !== 'ondemand') {
        return this.responseHelper.error('Only on-demand campaigns support manual call triggering', 400);
      }

      // Verify contact IDs are provided
      if (!body.contactIds || body.contactIds.length === 0) {
        return this.responseHelper.error('Contact IDs are required', 400);
      }

      // Verify outbound phone number is configured
      if (!campaign.outboundProvider || !campaign.outboundPhoneNumber) {
        return this.responseHelper.error('Outbound phone number is not configured for this campaign', 400);
      }

      // Get user telephony settings
      const user = await this.userService.findById(userInfo.userId);
      if (!user) {
        return this.responseHelper.error('User not found', 404);
      }

      const telephony = user.settings?.telephony;
      if (!telephony) {
        return this.responseHelper.error('Telephony settings not configured', 400);
      }

      // Get agent for this campaign
      const agent = await this.agentService.findOne(campaign.agentId);
      if (!agent) {
        return this.responseHelper.error('Agent not found for this campaign', 404);
      }

      // Find contacts to call - allow pending or failed contacts to be called/retried
      const contactsToCall = campaign.contacts.filter(
        (c) => body.contactIds.includes(c._id?.toString() || '') && 
               (c.callStatus === 'pending' || c.callStatus === 'failed')
      );

      if (contactsToCall.length === 0) {
        // Provide more helpful error message
        const selectedContacts = campaign.contacts.filter(
          (c) => body.contactIds.includes(c._id?.toString() || '')
        );
        if (selectedContacts.length === 0) {
          return this.responseHelper.error('No contacts found with the provided IDs', 400);
        }
        const statuses = selectedContacts.map(c => c.callStatus);
        return this.responseHelper.error(
          `No callable contacts found. Selected contacts have statuses: ${statuses.join(', ')}. Only pending or failed contacts can be called.`,
          400
        );
      }

      const results: Array<{
        contactId: string;
        contactName: string;
        phoneNumber: string;
        success: boolean;
        callId?: string;
        joinUrl?: string;
        error?: string;
      }> = [];

      // Process each contact
      for (const contact of contactsToCall) {
        try {
          // Update contact status to in-progress
          await this.campaignService.updateContactCallStatus(id, contact._id!.toString(), 'in-progress');

          // Create the call with the selected provider
          const callResult = await this.ultravoxService.createOutboundCallWithMedium(
            agent.talkrixAgentId,
            {
              provider: campaign.outboundProvider!,
              fromPhoneNumber: campaign.outboundPhoneNumber!,
              toPhoneNumber: contact.phoneNumber,
              maxDuration: '600s',
              recordingEnabled: true,
              // Pass credentials based on provider
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
            const callHistory = await this.callHistoryService.create({
              agentId: campaign.agentId,
              userId: userInfo.userId,
              talkrixCallId: callResult.data.callId,
              callType: 'outbound',
              agentName: agent.name,
              customerName: contact.name,
              customerPhone: contact.phoneNumber,
              recordingEnabled: true,
              joinUrl: callResult.data.joinUrl,
              callData: callResult.data,
              metadata: {
                campaignId: campaign._id,
                campaignName: campaign.name,
                provider: campaign.outboundProvider,
                fromPhoneNumber: campaign.outboundPhoneNumber,
              },
            });

            // Update contact with call ID
            await this.campaignService.updateContactCallStatus(
              id, 
              contact._id!.toString(), 
              'in-progress',
              { callId: callResult.data.callId }
            );

            results.push({
              contactId: contact._id!.toString(),
              contactName: contact.name,
              phoneNumber: contact.phoneNumber,
              success: true,
              callId: callResult.data.callId,
              joinUrl: callResult.data.joinUrl,
            });

            this.logger.log(`Call triggered for contact ${contact.name} (${contact.phoneNumber}) in campaign ${campaign.name}`);
          } else {
            // Call creation failed
            await this.campaignService.updateContactCallStatus(id, contact._id!.toString(), 'failed');
            results.push({
              contactId: contact._id!.toString(),
              contactName: contact.name,
              phoneNumber: contact.phoneNumber,
              success: false,
              error: callResult.message || 'Failed to create call',
            });
          }
        } catch (contactErr) {
          this.logger.error(`Error triggering call for contact ${contact.name}:`, contactErr);
          await this.campaignService.updateContactCallStatus(id, contact._id!.toString(), 'failed');
          results.push({
            contactId: contact._id!.toString(),
            contactName: contact.name,
            phoneNumber: contact.phoneNumber,
            success: false,
            error: contactErr?.message || 'Unknown error',
          });
        }
      }

      const successCount = results.filter(r => r.success).length;
      const failedCount = results.filter(r => !r.success).length;

      this.logger.log(`Campaign ${campaign.name}: ${successCount} calls triggered, ${failedCount} failed`);

      return this.responseHelper.success({
        results,
        summary: {
          total: contactsToCall.length,
          success: successCount,
          failed: failedCount,
        },
      }, `${successCount} call(s) triggered successfully`);
    } catch (err) {
      this.logger.error('Error triggering calls', err);
      return this.responseHelper.error('Failed to trigger calls', 500, err?.message || err);
    }
  }

  // Start a scheduled outbound campaign immediately
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/start')
  async startCampaign(@Param('id') id: string, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const campaign = await this.campaignService.findOne(id);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      // Verify ownership
      if (campaign.userId !== userInfo.userId) {
        return this.responseHelper.error('Unauthorized', 403);
      }

      // Only outbound campaigns can be started this way
      if (campaign.type !== 'outbound') {
        return this.responseHelper.error('Only outbound campaigns can be started', 400);
      }

      // Check if campaign can be started
      if (campaign.status !== 'scheduled' && campaign.status !== 'draft' && campaign.status !== 'paused') {
        return this.responseHelper.error(`Campaign cannot be started from ${campaign.status} status`, 400);
      }

      // Verify outbound configuration
      if (!campaign.outboundProvider || !campaign.outboundPhoneNumber) {
        return this.responseHelper.error('Outbound phone number is not configured for this campaign', 400);
      }

      // Verify there are pending contacts
      const pendingContacts = campaign.contacts.filter(c => c.callStatus === 'pending');
      if (pendingContacts.length === 0) {
        return this.responseHelper.error('No pending contacts to call', 400);
      }

      // Start the campaign
      if (campaign.status === 'paused') {
        await this.campaignSchedulerService.resumeCampaign(id);
      } else {
        await this.campaignSchedulerService.startCampaignNow(id);
      }

      this.logger.log(`Campaign ${campaign.name} started by user ${userInfo.userId}`);
      
      const updatedCampaign = await this.campaignService.findOne(id);
      return this.responseHelper.success(updatedCampaign, 'Campaign started successfully');
    } catch (err) {
      this.logger.error('Error starting campaign', err);
      return this.responseHelper.error('Failed to start campaign', 500, err?.message || err);
    }
  }

  // Pause an active campaign
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/pause')
  async pauseCampaign(@Param('id') id: string, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const campaign = await this.campaignService.findOne(id);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      // Verify ownership
      if (campaign.userId !== userInfo.userId) {
        return this.responseHelper.error('Unauthorized', 403);
      }

      // Only active campaigns can be paused
      if (campaign.status !== 'active') {
        return this.responseHelper.error('Only active campaigns can be paused', 400);
      }

      await this.campaignSchedulerService.pauseCampaign(id);

      this.logger.log(`Campaign ${campaign.name} paused by user ${userInfo.userId}`);
      
      const updatedCampaign = await this.campaignService.findOne(id);
      return this.responseHelper.success(updatedCampaign, 'Campaign paused successfully');
    } catch (err) {
      this.logger.error('Error pausing campaign', err);
      return this.responseHelper.error('Failed to pause campaign', 500, err?.message || err);
    }
  }

  // Resume a paused campaign
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/resume')
  async resumeCampaign(@Param('id') id: string, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const campaign = await this.campaignService.findOne(id);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      // Verify ownership
      if (campaign.userId !== userInfo.userId) {
        return this.responseHelper.error('Unauthorized', 403);
      }

      // Check if campaign can be resumed (paused or paused-time-window)
      if (campaign.status !== 'paused' && campaign.status !== 'paused-time-window') {
        return this.responseHelper.error('Only paused campaigns can be resumed', 400);
      }

      // Verify there are pending contacts
      const pendingContacts = campaign.contacts.filter(c => c.callStatus === 'pending');
      if (pendingContacts.length === 0) {
        return this.responseHelper.error('No pending contacts to call', 400);
      }

      // Verify outbound configuration
      if (!campaign.outboundProvider || !campaign.outboundPhoneNumber) {
        return this.responseHelper.error('Outbound phone number is not configured for this campaign', 400);
      }

      // Resume the campaign
      await this.campaignSchedulerService.resumeCampaign(id);

      this.logger.log(`Campaign ${campaign.name} resumed by user ${userInfo.userId} with ${pendingContacts.length} pending contacts`);
      
      const updatedCampaign = await this.campaignService.findOne(id);
      return this.responseHelper.success({
        campaign: updatedCampaign,
        pendingContacts: pendingContacts.length,
      }, 'Campaign resumed successfully');
    } catch (err) {
      this.logger.error('Error resuming campaign', err);
      return this.responseHelper.error('Failed to resume campaign', 500, err?.message || err);
    }
  }

  // Debug endpoint to check scheduler status
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id/debug-schedule')
  async debugSchedule(@Param('id') id: string, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const campaign = await this.campaignService.findOne(id);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      // Verify ownership
      if (campaign.userId !== userInfo.userId) {
        return this.responseHelper.error('Unauthorized', 403);
      }

      const user = await this.userService.findById(userInfo.userId);
      
      // Get current time in campaign's timezone
      const timezone = campaign.schedule?.timezone || 'UTC';
      let nowInTimezone: Date | null = null;
      
      try {
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: timezone,
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
          hour12: false,
        });
        const parts = formatter.formatToParts(new Date());
        const get = (type: string) => parts.find((p) => p.type === type)?.value;
        nowInTimezone = new Date(
          parseInt(get('year')!),
          parseInt(get('month')!) - 1,
          parseInt(get('day')!),
          parseInt(get('hour')!),
          parseInt(get('minute')!),
          parseInt(get('second')!),
        );
      } catch {
        nowInTimezone = new Date();
      }

      // Calculate scheduled datetime
      const scheduledDate = campaign.schedule?.scheduledDate ? new Date(campaign.schedule.scheduledDate) : null;
      const scheduledTime = campaign.schedule?.scheduledTime;
      
      let scheduledDateTime: Date | null = null;
      let timeDiff: number | null = null;
      
      if (scheduledDate && scheduledTime) {
        const year = scheduledDate.getUTCFullYear();
        const month = scheduledDate.getUTCMonth();
        const day = scheduledDate.getUTCDate();
        const [hours, minutes] = scheduledTime.split(':').map(Number);
        scheduledDateTime = new Date(year, month, day, hours, minutes, 0, 0);
        timeDiff = nowInTimezone!.getTime() - scheduledDateTime.getTime();
      }

      const pendingContacts = campaign.contacts.filter(c => c.callStatus === 'pending');
      
      return this.responseHelper.success({
        campaignId: id,
        campaignName: campaign.name,
        campaignType: campaign.type,
        campaignStatus: campaign.status,
        schedule: {
          scheduledDate: campaign.schedule?.scheduledDate,
          scheduledTime: campaign.schedule?.scheduledTime,
          timezone: campaign.schedule?.timezone,
        },
        computed: {
          timezone,
          nowInTimezone: nowInTimezone?.toISOString(),
          nowInTimezoneLocal: nowInTimezone ? `${nowInTimezone.getFullYear()}-${String(nowInTimezone.getMonth() + 1).padStart(2, '0')}-${String(nowInTimezone.getDate()).padStart(2, '0')} ${String(nowInTimezone.getHours()).padStart(2, '0')}:${String(nowInTimezone.getMinutes()).padStart(2, '0')}` : null,
          scheduledDateTime: scheduledDateTime?.toISOString(),
          timeDiffSeconds: timeDiff !== null ? Math.round(timeDiff / 1000) : null,
          shouldStart: timeDiff !== null ? (timeDiff >= 0 && timeDiff < 5 * 60 * 1000) : false,
        },
        outboundConfig: {
          provider: campaign.outboundProvider,
          phoneNumber: campaign.outboundPhoneNumber,
        },
        userSettings: {
          maxConcurrentCalls: user?.settings?.maxConcurrentCalls || 1,
        },
        contactStats: {
          total: campaign.contacts.length,
          pending: pendingContacts.length,
        },
        checks: {
          isOutbound: campaign.type === 'outbound',
          isScheduled: campaign.status === 'scheduled',
          hasScheduleDate: !!campaign.schedule?.scheduledDate,
          hasScheduleTime: !!campaign.schedule?.scheduledTime,
          hasOutboundProvider: !!campaign.outboundProvider,
          hasOutboundPhoneNumber: !!campaign.outboundPhoneNumber,
          hasPendingContacts: pendingContacts.length > 0,
        },
      }, 'Debug info fetched');
    } catch (err) {
      this.logger.error('Error fetching debug info', err);
      return this.responseHelper.error('Failed to fetch debug info', 500, err?.message || err);
    }
  }

  // Get campaign real-time state (active calls, etc.)
  @UseGuards(AuthOrApiKeyGuard)
  @Get(':id/state')
  async getCampaignState(@Param('id') id: string, @Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized', 401);
    }

    try {
      const campaign = await this.campaignService.findOne(id);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      // Verify ownership
      if (campaign.userId !== userInfo.userId) {
        return this.responseHelper.error('Unauthorized', 403);
      }

      // Get user's maxConcurrentCalls setting
      const user = await this.userService.findById(userInfo.userId);
      const maxConcurrentCalls = user?.settings?.maxConcurrentCalls || 1;

      const state = this.campaignSchedulerService.getCampaignState(id);
      
      // Calculate from campaign data if state not in memory
      const pendingContacts = campaign.contacts.filter(c => c.callStatus === 'pending').length;
      const inProgressContacts = campaign.contacts.filter(c => c.callStatus === 'in-progress').length;
      const completedContacts = campaign.contacts.filter(c => c.callStatus === 'completed').length;
      const failedContacts = campaign.contacts.filter(c => c.callStatus === 'failed' || c.callStatus === 'no-answer').length;

      return this.responseHelper.success({
        campaignId: id,
        status: campaign.status,
        // User's maxConcurrentCalls applies to ALL campaigns combined
        activeCalls: state?.activeCalls ?? inProgressContacts,
        maxConcurrentCalls: state?.maxConcurrentCalls ?? maxConcurrentCalls,
        isActive: state?.isActive ?? false,
        contactStats: {
          total: campaign.contacts.length,
          pending: pendingContacts,
          inProgress: inProgressContacts,
          completed: completedContacts,
          failed: failedContacts,
        },
      }, 'Campaign state fetched');
    } catch (err) {
      this.logger.error('Error fetching campaign state', err);
      return this.responseHelper.error('Failed to fetch campaign state', 500, err?.message || err);
    }
  }

  // API Trigger: Add contact and immediately trigger a call
  // This endpoint allows external systems to push contacts via API and trigger calls instantly
  // Works for both 'ondemand' and 'outbound' campaign types
  @UseGuards(AuthOrApiKeyGuard)
  @Post(':id/generate-instant-call')
  async apiTriggerCall(
    @Param('id') id: string,
    @Body() body: { 
      name: string; 
      phoneNumber: string;
      metadata?: Record<string, any>; // Optional custom metadata
    },
    @Req() req: any,
  ) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('Unauthorized - Valid API key required', 401);
    }

    try {
      // Validate required fields
      if (!body.name || !body.phoneNumber) {
        return this.responseHelper.error('Name and phoneNumber are required', 400);
      }

      // Get the campaign
      const campaign = await this.campaignService.findOne(id);
      if (!campaign) {
        return this.responseHelper.error('Campaign not found', 404);
      }

      // Verify ownership
      if (campaign.userId !== userInfo.userId) {
        return this.responseHelper.error('Unauthorized - Campaign does not belong to this user', 403);
      }

      // Only allow ondemand and outbound campaigns
      if (campaign.type !== 'ondemand' && campaign.type !== 'outbound') {
        return this.responseHelper.error('API trigger is only available for ondemand and outbound campaigns', 400);
      }

      // Check if API trigger is enabled for this campaign
      if (!campaign.apiTriggerEnabled) {
        return this.responseHelper.error('API trigger is not enabled for this campaign. Enable it in campaign settings.', 403);
      }

      // Verify outbound phone number is configured
      if (!campaign.outboundProvider || !campaign.outboundPhoneNumber) {
        return this.responseHelper.error('Outbound phone number is not configured for this campaign', 400);
      }

      // Get user telephony settings
      const user = await this.userService.findById(userInfo.userId);
      if (!user) {
        return this.responseHelper.error('User not found', 404);
      }

      const telephony = user.settings?.telephony;
      if (!telephony) {
        return this.responseHelper.error('Telephony settings not configured', 400);
      }

      // Get agent for this campaign
      const agent = await this.agentService.findOne(campaign.agentId);
      if (!agent) {
        return this.responseHelper.error('Agent not found for this campaign', 404);
      }

      // Add the contact to the campaign
      const newContact = {
        name: body.name.trim(),
        phoneNumber: body.phoneNumber.trim(),
        callStatus: 'pending' as const,
        isLocked: true, // Lock contact when created via API trigger
      };

      const updatedCampaign = await this.campaignService.addContacts(id, [newContact]);
      if (!updatedCampaign) {
        return this.responseHelper.error('Failed to add contact to campaign', 500);
      }

      // Find the newly added contact (it will be the last one with matching phone number)
      const addedContact = updatedCampaign.contacts
        .filter(c => c.phoneNumber === newContact.phoneNumber && c.name === newContact.name)
        .pop();

      if (!addedContact || !addedContact._id) {
        return this.responseHelper.error('Failed to find added contact', 500);
      }

      // Update contact status to in-progress
      await this.campaignService.updateContactCallStatus(id, addedContact._id.toString(), 'in-progress');

      // Create the call with the selected provider
      // Pass campaignId and contactId for webhook tracking
      const callResult = await this.ultravoxService.createOutboundCallWithMedium(
        agent.talkrixAgentId,
        {
          provider: campaign.outboundProvider!,
          fromPhoneNumber: campaign.outboundPhoneNumber!,
          toPhoneNumber: addedContact.phoneNumber,
          maxDuration: '600s',
          recordingEnabled: true,
          // Pass credentials based on provider
          twilioAccountSid: telephony.twilioAccountSid,
          twilioAuthToken: telephony.twilioAuthToken,
          plivoAuthId: telephony.plivoAuthId,
          plivoAuthToken: telephony.plivoAuthToken,
          telnyxApiKey: telephony.telnyxApiKey,
          telnyxConnectionId: telephony.telnyxConnectionId,
          // Pass tracking info for webhook callbacks
          campaignId: id,
          contactId: addedContact._id.toString(),
        }
      );

      if (callResult.statusCode === 201 && callResult.data) {
        // Create call history record
        const callHistory = await this.callHistoryService.create({
          agentId: campaign.agentId,
          userId: userInfo.userId,
          talkrixCallId: callResult.data.callId,
          callType: 'outbound',
          agentName: agent.name,
          customerName: addedContact.name,
          customerPhone: addedContact.phoneNumber,
          recordingEnabled: true,
          joinUrl: callResult.data.joinUrl,
          callData: callResult.data,
          metadata: {
            campaignId: campaign._id,
            campaignName: campaign.name,
            provider: campaign.outboundProvider,
            fromPhoneNumber: campaign.outboundPhoneNumber,
            apiTriggered: true,
            customMetadata: body.metadata,
          },
        });

        // Update contact with call ID and history reference
        await this.campaignService.updateContactCallStatus(
          id,
          addedContact._id.toString(),
          'in-progress',
          { 
            callId: callResult.data.callId,
            callHistoryId: callHistory._id?.toString(),
          }
        );

        this.logger.log(`API Trigger: Call initiated for ${addedContact.name} (${addedContact.phoneNumber}) in campaign ${campaign.name}`);

        return this.responseHelper.success({
          contactId: addedContact._id.toString(),
          contactName: addedContact.name,
          phoneNumber: addedContact.phoneNumber,
          callId: callResult.data.callId,
          callHistoryId: callHistory._id?.toString(),
          campaignId: campaign._id,
          campaignName: campaign.name,
        }, 'Call triggered successfully', 201);
      } else {
        // Call creation failed - update contact status
        await this.campaignService.updateContactCallStatus(id, addedContact._id.toString(), 'failed');
        
        this.logger.error(`API Trigger: Failed to create call for ${addedContact.name}: ${callResult.message}`);
        
        return this.responseHelper.error(
          callResult.message || 'Failed to create call',
          callResult.statusCode || 500,
          { contactId: addedContact._id.toString() }
        );
      }
    } catch (err) {
      this.logger.error('Error in API trigger call', err);
      return this.responseHelper.error('Failed to trigger call', 500, err?.message || err);
    }
  }
}

