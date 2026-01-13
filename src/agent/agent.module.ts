import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { HttpModule } from '@nestjs/axios';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Agent, AgentSchema } from './agent.schema';
import { AgentService } from './agent.service';
import { AgentController } from './agent.controller';
import { UltravoxService } from './ultravox.service';
import { UserModule } from '../user/user.module';
import { SharedModule } from '../shared.module';

@Module({
  imports: [
    MongooseModule.forFeature([{ name: Agent.name, schema: AgentSchema }]),
    HttpModule,
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
  providers: [AgentService, UltravoxService],
  controllers: [AgentController],
  exports: [AgentService],
})
export class AgentModule {}
