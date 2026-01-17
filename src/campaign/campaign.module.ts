import { Module, forwardRef } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { MulterModule } from '@nestjs/platform-express';
import { Campaign, CampaignSchema } from './campaign.schema';
import { CampaignService } from './campaign.service';
import { CampaignSchedulerService } from './campaign-scheduler.service';
import { CampaignController } from './campaign.controller';
import { UserModule } from '../user/user.module';
import { SharedModule } from '../shared.module';
import { AgentModule } from '../agent/agent.module';
import { CallHistoryModule } from '../call-history/call-history.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Campaign.name, schema: CampaignSchema }]),
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024, // 10MB limit
      },
    }),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get('JWT_SECRET'),
        signOptions: { expiresIn: '1d' },
      }),
      inject: [ConfigService],
    }),
    UserModule,
    SharedModule,
    forwardRef(() => AgentModule),
    forwardRef(() => CallHistoryModule),
  ],
  providers: [CampaignService, CampaignSchedulerService],
  controllers: [CampaignController],
  exports: [CampaignService, CampaignSchedulerService],
})
export class CampaignModule {}
