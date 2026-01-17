import { Module } from '@nestjs/common';
import { WebhookController } from './webhook.controller';
import { CallHistoryModule } from '../call-history/call-history.module';
import { CampaignModule } from '../campaign/campaign.module';
import { SharedModule } from '../shared.module';

@Module({
  imports: [CallHistoryModule, CampaignModule, SharedModule],
  controllers: [WebhookController],
})
export class WebhookModule {}
