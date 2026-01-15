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
import { Campaign, CampaignContact } from './campaign.schema';
import { AuthOrApiKeyGuard } from '../auth/auth-or-apikey.guard';
import { ResponseHelper } from '../response.helper';
import { AppLogger } from '../app.logger';
import { AgentService } from '../agent/agent.service';
import * as XLSX from 'xlsx';

@Controller('campaigns')
export class CampaignController {
  constructor(
    private readonly campaignService: CampaignService,
    private readonly responseHelper: ResponseHelper,
    private readonly logger: AppLogger,
    private readonly agentService: AgentService,
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

  // Get all campaigns for the authenticated user
  @UseGuards(AuthOrApiKeyGuard)
  @Get()
  async findAll(@Req() req: any) {
    const userInfo = this.getUserFromRequest(req);
    if (!userInfo || !userInfo.userId) {
      return this.responseHelper.error('userId is required', 400);
    }

    try {
      const campaigns = await this.campaignService.findByUserId(userInfo.userId);
      return this.responseHelper.success(campaigns, 'Campaigns fetched');
    } catch (err) {
      this.logger.error('Error fetching campaigns', err);
      return this.responseHelper.error('Failed to fetch campaigns', 500, err?.message || err);
    }
  }

  // Get campaigns by user ID (admin route)
  @UseGuards(AuthOrApiKeyGuard)
  @Get('user/:userId')
  async findByUserId(@Param('userId') userId: string) {
    try {
      const campaigns = await this.campaignService.findByUserId(userId);
      return this.responseHelper.success(campaigns, 'Campaigns fetched');
    } catch (err) {
      this.logger.error('Error fetching campaigns by user', err);
      return this.responseHelper.error('Failed to fetch campaigns', 500, err?.message || err);
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
}
