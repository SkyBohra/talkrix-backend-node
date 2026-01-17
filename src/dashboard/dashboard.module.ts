import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { CallHistory, CallHistorySchema } from '../call-history/call-history.schema';
import { Agent, AgentSchema } from '../agent/agent.schema';
import { Campaign, CampaignSchema } from '../campaign/campaign.schema';
import { SharedModule } from '../shared.module';
import { UserModule } from '../user/user.module';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: CallHistory.name, schema: CallHistorySchema },
      { name: Agent.name, schema: AgentSchema },
      { name: Campaign.name, schema: CampaignSchema },
    ]),
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
  ],
  controllers: [DashboardController],
  providers: [DashboardService],
  exports: [DashboardService],
})
export class DashboardModule {}
