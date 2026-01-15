import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CallHistory, CallHistorySchema } from './call-history.schema';
import { CallHistoryService } from './call-history.service';
import { CallHistoryController } from './call-history.controller';
import { UserModule } from '../user/user.module';
import { SharedModule } from '../shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: CallHistory.name, schema: CallHistorySchema }]),
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
  providers: [CallHistoryService],
  controllers: [CallHistoryController],
  exports: [CallHistoryService],
})
export class CallHistoryModule {}
